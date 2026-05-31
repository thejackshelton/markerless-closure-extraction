import { withoutTrailingSlash } from "ufo";

export const DEFAULT_OLLAMA_MODEL = "gemma4:e2b";

export const BOUNDARY_MANIFEST_PATCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    decision: {
      type: "string",
      enum: ["add_to_whitelist", "no_boundary", "unknown"]
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low", "none"]
    },
    reason: { type: "string" },
    manifestPatch: {
      type: "object",
      additionalProperties: false,
      properties: {
        components: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              component: { type: "string" },
              prop: { type: "string" },
              kind: {
                type: "string",
                enum: ["event", "server", "resource"]
              }
            },
            required: ["component", "prop", "kind"]
          }
        }
      },
      required: ["components"]
    }
  },
  required: ["decision", "confidence", "reason", "manifestPatch"]
};

const DECISIONS = new Set(["add_to_whitelist", "no_boundary", "unknown"]);
const CONFIDENCES = new Set(["high", "medium", "low", "none"]);
const BOUNDARY_KINDS = new Set(["event", "server", "resource", "unknown"]);

export async function inferBoundaryManifestPatchWithOllama(request, options = {}) {
  const model = options.model ?? process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
  const endpoint = normalizeEndpoint(options.endpoint ?? process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new Error("No fetch implementation is available for Ollama inference.");
  }

  const response = await fetchImpl(`${endpoint}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      think: options.think ?? false,
      keep_alive: options.keepAlive ?? "30m",
      format: BOUNDARY_MANIFEST_PATCH_SCHEMA,
      options: {
        temperature: options.temperature ?? 0,
        num_ctx: options.numCtx ?? Number(process.env.OLLAMA_NUM_CTX ?? 8192),
        num_predict: options.numPredict ?? Number(process.env.OLLAMA_NUM_PREDICT ?? 1024)
      },
      messages: createBoundaryInferenceMessages(request)
    })
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`Ollama request failed with HTTP ${response.status}: ${responseText}`);
  }

  const payload = parseJsonResponse(responseText);
  const content = payload.message?.content ?? payload.response;
  if (typeof content !== "string") {
    throw new Error("Ollama response did not include a message.content string.");
  }

  return {
    model: payload.model ?? model,
    decision: normalizeBoundaryDecision(parseJsonObjectFromModelContent(content)),
    performance: ollamaPerformance(payload),
    raw: payload
  };
}

export function createBoundaryInferenceMessages(request) {
  return [
    {
      role: "system",
      content: [
        "You are the local inference engine for an OSS compiler.",
        "The compiler gives you condensed TSX/JSX AST facts from Yuku.",
        "You own recursive cross-file reasoning over those facts.",
        "Infer which target closure props should be added to the extraction whitelist.",
        "A lowercase JSX tag is a host element. A host prop named on* is an event boundary.",
        "A component prop is an event boundary if propForwardingEdges recursively reaches a host on* prop.",
        "Only add manifestPatch entries when propForwardingEdges contain a complete path from the target closure prop to a host on* prop.",
        "Do not infer boundaries from prop names, targetCandidateIds, or closure source without that complete path.",
        "Do not use kind=component; use event, server, resource, or unknown.",
        "Add one manifestPatch component entry for each targetCandidateId whose candidate target reaches an event boundary.",
        "allowedManifestTargets is the closed list of manifestPatch entries you may return.",
        "Copy component and prop exactly from allowedManifestTargets.",
        "Only output exact component/prop pairs from condensedAst.candidates whose id is in targetCandidateIds.",
        "Use candidate.targetComponent and candidate.targetProp for manifestPatch entries.",
        "Never output candidate.ownerComponent just because the closure is written there.",
        "Never output intermediate forwarded components unless they are also target candidates.",
        "manifestPatch.components is add-only; never put kind=unknown inside it.",
        "If no allowed target is proven, return an empty manifestPatch.components array.",
        "Return only component, prop, and kind for each manifestPatch entry; the compiler derives evidence from propForwardingEdges.",
        "If manifestPatch.components is non-empty, decision must be add_to_whitelist.",
        "Use unknown when the trace is missing, cyclic, or ambiguous.",
        "Keep reason under 12 words.",
        "Do not return trace or evidence.",
        "Return JSON matching the schema. Do not return markdown or prose outside JSON."
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify(request)
    }
  ];
}

export function parseJsonObjectFromModelContent(content) {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const withoutFence = stripJsonCodeFence(trimmed);
    try {
      return JSON.parse(withoutFence);
    } catch {
      const start = withoutFence.indexOf("{");
      const end = withoutFence.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(withoutFence.slice(start, end + 1));
      }
      throw new Error(`Model output was not parseable JSON: ${content}`);
    }
  }
}

export function normalizeBoundaryDecision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Boundary decision must be a JSON object.");
  }

  const decision = String(value.decision ?? "unknown");
  const confidence = String(value.confidence ?? "none");
  if (!DECISIONS.has(decision)) {
    throw new Error(`Unsupported decision: ${decision}`);
  }
  if (!CONFIDENCES.has(confidence)) {
    throw new Error(`Unsupported confidence: ${confidence}`);
  }

  const components = value.manifestPatch?.components ?? [];
  if (!Array.isArray(components)) {
    throw new Error("manifestPatch.components must be an array.");
  }

  return {
    decision,
    confidence,
    reason: String(value.reason ?? ""),
    trace: Array.isArray(value.trace) ? value.trace.map(String) : [],
    manifestPatch: {
      components: components.map(normalizeManifestComponent)
    }
  };
}

export function decisionToManifest(decision, request = null) {
  const manifest = { components: {} };
  if (decision.decision !== "add_to_whitelist") {
    return manifest;
  }
  if (!request) {
    throw new Error("Boundary manifest conversion requires the condensed AST request for evidence derivation.");
  }

  const findEvidencePath = createEvidencePathFinder(request);
  const allowedTargets = createAllowedManifestTargets(request);

  for (const entry of decision.manifestPatch.components) {
    if (entry.kind === "unknown") {
      continue;
    }
    if (allowedTargets && !allowedTargets.has(componentPropReference(entry.component, entry.prop))) {
      continue;
    }
    const evidence = findEvidencePath?.(entry.component, entry.prop);
    if (entry.kind === "event" && !evidence) {
      continue;
    }
    manifest.components[entry.component] ??= { props: {} };
    manifest.components[entry.component].props[entry.prop] = entry.kind;
    if (evidence) {
      manifest.components[entry.component].evidence ??= {};
      manifest.components[entry.component].evidence[entry.prop] = evidence;
    }
  }

  return manifest;
}

export function ollamaPerformance(payload) {
  return {
    totalMs: nanosToMs(payload.total_duration),
    loadMs: nanosToMs(payload.load_duration),
    promptEvalMs: nanosToMs(payload.prompt_eval_duration),
    evalMs: nanosToMs(payload.eval_duration),
    promptTokens: payload.prompt_eval_count ?? null,
    outputTokens: payload.eval_count ?? null,
    promptTokensPerSecond: tokensPerSecond(payload.prompt_eval_count, payload.prompt_eval_duration),
    outputTokensPerSecond: tokensPerSecond(payload.eval_count, payload.eval_duration)
  };
}

function normalizeManifestComponent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("manifestPatch component entries must be objects.");
  }

  const component = String(value.component ?? "");
  const prop = String(value.prop ?? "");
  const kind = String(value.kind ?? "unknown");
  if (!component || !prop) {
    throw new Error("manifestPatch entries require component and prop.");
  }
  if (!BOUNDARY_KINDS.has(kind)) {
    throw new Error(`Unsupported boundary kind: ${kind}`);
  }

  return { component, prop, kind };
}

function createAllowedManifestTargets(request) {
  if (Array.isArray(request?.allowedManifestTargets) && request.allowedManifestTargets.length > 0) {
    return new Set(
      request.allowedManifestTargets
        .map((target) => componentPropReference(String(target.component ?? ""), String(target.prop ?? "")))
        .filter((target) => !target.startsWith(".") && !target.endsWith("."))
    );
  }

  const targetCandidateIds = new Set(Array.isArray(request?.targetCandidateIds) ? request.targetCandidateIds : []);
  const candidates = Array.isArray(request?.condensedAst?.candidates) ? request.condensedAst.candidates : [];
  if (targetCandidateIds.size === 0 || candidates.length === 0) {
    return null;
  }

  const targets = new Set();
  for (const candidate of candidates) {
    if (targetCandidateIds.has(candidate.id) && typeof candidate.target === "string") {
      targets.add(candidate.target);
    }
  }
  return targets;
}

function createEvidencePathFinder(request) {
  const edgesBySource = indexPropForwardingEdges(request?.condensedAst?.propForwardingEdges);

  return (component, prop) => findEventEvidencePath(edgesBySource, component, prop, new Set());
}

function indexPropForwardingEdges(edges) {
  const edgesBySource = new Map();

  for (const edge of Array.isArray(edges) ? edges : []) {
    if (!edge || typeof edge !== "object") {
      continue;
    }

    const component = String(edge.component ?? "");
    const prop = String(edge.prop ?? "");
    if (!component || !prop) {
      continue;
    }

    let propEdges = edgesBySource.get(component);
    if (!propEdges) {
      propEdges = new Map();
      edgesBySource.set(component, propEdges);
    }

    let sourceEdges = propEdges.get(prop);
    if (!sourceEdges) {
      sourceEdges = [];
      propEdges.set(prop, sourceEdges);
    }

    sourceEdges.push(edge);
  }

  return edgesBySource;
}

function findEventEvidencePath(edgesBySource, component, prop, seen) {
  const seenKey = `${component}\u0000${prop}`;
  if (seen.has(seenKey)) {
    return null;
  }

  const nextSeen = new Set(seen);
  nextSeen.add(seenKey);

  for (const edge of edgesBySource.get(component)?.get(prop) ?? []) {
    const sourceReference = componentPropReference(component, prop);
    if (edge.targetKind === "host" && isHostEventProp(edge.targetProp)) {
      return [sourceReference, componentPropReference(edge.targetTag, edge.targetProp)];
    }

    if (edge.targetKind === "component" && edge.targetComponent) {
      const childPath = findEventEvidencePath(edgesBySource, edge.targetComponent, edge.targetProp, nextSeen);
      if (childPath) {
        return [sourceReference, ...childPath];
      }
    }
  }

  return null;
}

function componentPropReference(component, prop) {
  return `${component}.${prop}`;
}

function isHostEventProp(prop) {
  return typeof prop === "string" && prop.length > 2 && prop.startsWith("on") && isAsciiUppercaseCode(prop.charCodeAt(2));
}

function isAsciiUppercaseCode(code) {
  return code >= 65 && code <= 90;
}

function stripJsonCodeFence(value) {
  if (!value.startsWith("```")) {
    return value;
  }

  const firstLineEnd = value.indexOf("\n");
  if (firstLineEnd < 0) {
    return value;
  }

  const language = value.slice(3, firstLineEnd).trim().toLowerCase();
  if (language && language !== "json") {
    return value;
  }

  const body = value.slice(firstLineEnd + 1).trim();
  if (!body.endsWith("```")) {
    return value;
  }

  return body.slice(0, -3).trim();
}

function parseJsonResponse(responseText) {
  try {
    return JSON.parse(responseText);
  } catch (error) {
    throw new Error(`Ollama returned invalid JSON: ${error.message}`);
  }
}

function normalizeEndpoint(endpoint) {
  return withoutTrailingSlash(String(endpoint));
}

function nanosToMs(value) {
  return typeof value === "number" ? value / 1_000_000 : null;
}

function tokensPerSecond(count, durationNanoseconds) {
  if (typeof count !== "number" || typeof durationNanoseconds !== "number" || durationNanoseconds <= 0) {
    return null;
  }
  return count / (durationNanoseconds / 1_000_000_000);
}
