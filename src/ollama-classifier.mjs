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
    trace: {
      type: "array",
      items: { type: "string" }
    },
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
                enum: ["event", "server", "resource", "unknown"]
              },
              evidence: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["component", "prop", "kind", "evidence"]
          }
        }
      },
      required: ["components"]
    }
  },
  required: ["decision", "confidence", "reason", "trace", "manifestPatch"]
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
        "Add one manifestPatch component entry for each targetCandidateId whose target prop reaches an event boundary.",
        "Each manifestPatch entry evidence must be the compact path from Component.prop to hostTag.onEvent.",
        "If manifestPatch.components is non-empty, decision must be add_to_whitelist.",
        "Use unknown when the trace is missing, cyclic, or ambiguous.",
        "Keep reason under 12 words and trace entries as compact fact IDs.",
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
    const withoutFence = trimmed
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
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

export function decisionToManifest(decision) {
  const manifest = { components: {} };
  if (decision.decision !== "add_to_whitelist") {
    return manifest;
  }

  for (const entry of decision.manifestPatch.components) {
    if (entry.kind === "unknown") {
      continue;
    }
    manifest.components[entry.component] ??= { props: {} };
    manifest.components[entry.component].props[entry.prop] = entry.kind;
    manifest.components[entry.component].evidence ??= {};
    manifest.components[entry.component].evidence[entry.prop] = entry.evidence;
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

  const evidence = normalizeEvidencePath(value.evidence);

  return { component, prop, kind, evidence };
}

function normalizeEvidencePath(value) {
  const rawParts = Array.isArray(value) ? value : [];
  return rawParts
    .flatMap((part) => String(part).split("->"))
    .map((part) => part.trim().replace(/^c:[^:]+:/, ""))
    .filter((part) => /^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/.test(part));
}

function parseJsonResponse(responseText) {
  try {
    return JSON.parse(responseText);
  } catch (error) {
    throw new Error(`Ollama returned invalid JSON: ${error.message}`);
  }
}

function normalizeEndpoint(endpoint) {
  return endpoint.replace(/\/+$/, "");
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
