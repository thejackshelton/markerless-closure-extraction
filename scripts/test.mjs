import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "pathe";
import {
  createBoundaryInferenceRequest,
  discoverExtractableClosuresInProject,
  inferBoundaryManifestForProject,
  parseProjectFiles
} from "../src/pipeline.mjs";
import {
  decisionToManifest,
  inferBoundaryManifestPatchWithOllama,
  normalizeBoundaryDecision,
  parseJsonObjectFromModelContent
} from "../src/ollama-classifier.mjs";
import {
  SCENARIOS,
  boundaryLabels,
  evaluateScenario,
  expectedBoundaryEntries,
  expectedUnknownEntries,
  scenarioResultSummary
} from "../src/scenario-suite.mjs";

const extraArgs = process.argv.slice(2);
if (extraArgs.length > 0) {
  console.error(`Unexpected argument(s): ${extraArgs.join(" ")}`);
  console.error("pnpm passes arguments after the script name into that script.");
  console.error("Use `pnpm ollama:smoke`, `pnpm ollama:scenarios`, `pnpm test:gemma`, or `pnpm verify:gemma`.");
  process.exit(1);
}

await testCondensedAstRequest();
testClosureExtractionInventory();
testScenarioSuite();
await testOllamaClientContract();
testModelJsonParsing();
testDecisionValidation();

console.log("tests: pass");

async function testCondensedAstRequest() {
  const appRoot = resolve("demo/react-app");
  const project = parseProjectFiles(await readSourceFiles(resolve(appRoot, "src")), appRoot);
  const request = createBoundaryInferenceRequest(project);

  assertClosureSite(request, "Button", "onPress", "setCount(count + 1)");
  assertClosureSite(request, "Toolbar", "onSave", "setSavedAt");
  assertClosureSite(request, "Toolbar", "onPublish", "setPublished(true)");
  assertClosureSite(request, "ConfirmDialog", "onConfirm", "setConfirmed(true)");
  assertClosureSite(request, "ConfirmDialog", "onCancel", "setCancelled(true)");
  assertClosureSite(request, "FormPanel", "onSubmit", "event.preventDefault()");
  assertClosureSite(request, "FormPanel", "onReset", 'setFormDraft("reset")');
  assert.equal(request.condensedAst.candidates.length, 7);
  assert.deepEqual(
    request.allowedManifestTargets.map((target) => `${target.component}.${target.prop}`),
    [
      "Button.onPress",
      "Toolbar.onSave",
      "Toolbar.onPublish",
      "ConfirmDialog.onConfirm",
      "ConfirmDialog.onCancel",
      "FormPanel.onSubmit",
      "FormPanel.onReset"
    ]
  );

  assertForwardingEdge(request, {
    sourceFile: "src/Button.tsx",
    component: "Button",
    prop: "onPress",
    targetTag: "button",
    targetProp: "onClick"
  });
  assertForwardingEdge(request, {
    sourceFile: "src/Toolbar.tsx",
    component: "Toolbar",
    prop: "onSave",
    targetTag: "ToolbarButton",
    targetProp: "onActivate"
  });
  assertForwardingEdge(request, {
    sourceFile: "src/ConfirmDialog.tsx",
    component: "ConfirmDialog",
    prop: "onCancel",
    targetTag: "DialogActions",
    targetProp: "onSecondary"
  });
  assertForwardingEdge(request, {
    sourceFile: "src/FormPanel.tsx",
    component: "FormPanel",
    prop: "onSubmit",
    targetTag: "form",
    targetProp: "onSubmit"
  });

  const appFile = request.condensedAst.files.find((file) => file.path === "src/App.tsx");
  assert(appFile.imports.some((entry) => entry.localName === "Button" && entry.from === "src/Button.tsx"));
  assert(appFile.imports.some((entry) => entry.localName === "Toolbar" && entry.from === "src/Toolbar.tsx"));
  assert(
    appFile.imports.some((entry) => entry.localName === "ConfirmDialog" && entry.from === "src/ConfirmDialog.tsx")
  );
  assert(appFile.imports.some((entry) => entry.localName === "FormPanel" && entry.from === "src/FormPanel.tsx"));

  const requestBytes = Buffer.byteLength(JSON.stringify(request), "utf8");
  assert(requestBytes < 60_000, `condensed AST request should stay compact, got ${requestBytes} bytes`);
}

function testClosureExtractionInventory() {
  const rootDir = resolve("demo/closure-inventory");
  const source = `
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useEventListener } from "./useEventListener";
import { debounce } from "./debounce";
import { useMutation } from "@tanstack/react-query";

type PanelProps = {
  onSelect: () => void;
  renderItem: () => string;
};

function Panel({ onSelect, renderItem }: PanelProps) {
  return <button onClick={onSelect}>{renderItem()}</button>;
}

export default function App({ save, subscribe, getSnapshot, nodeRef, setCount }) {
  const count = 1;
  const handler = useCallback(() => save(count), [save, count]);

  useEffect(() => {
    const onKey = (event) => save(event.key, count);
    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [save, count]);

  useEventListener("pointerdown", (event) => save(event.pointerId));
  const debounced = debounce(() => save(count), 100);
  useSyncExternalStore((notify) => subscribe(notify), () => getSnapshot(count));

  useMutation({
    mutationFn: async (value) => save(value),
    onSuccess: () => setCount(count + 1)
  });

  return (
    <Panel
      ref={(node) => {
        nodeRef.current = node;
      }}
      renderItem={() => count.toString()}
      onSelect={() => handler()}
      onHover={debounce(() => save(count), 50)}
    />
  );
}
`;
  const project = parseProjectFiles([{ filename: join(rootDir, "src/App.tsx"), source }], rootDir);
  const request = createBoundaryInferenceRequest(project);
  const summaries = request.condensedAst.extractedClosures.map(closureInventorySummary);
  assert(
    request.condensedAst.extractedClosures.every((closure) => {
      return closure.symbol.startsWith("closure_") && !closure.symbol.includes(":");
    }),
    "expected extracted closures to have stable hash symbols instead of path/span symbols"
  );

  assert.deepEqual(summaries, [
    {
      component: "App",
      context: "call-argument:useCallback:0",
      captures: ["count", "save"],
      async: false
    },
    {
      component: "App",
      context: "call-argument:useEffect:0",
      captures: ["count", "save"],
      async: false
    },
    {
      component: "App",
      context: "variable-init:onKey",
      captures: ["count", "save"],
      async: false
    },
    {
      component: "App",
      context: "return-value",
      captures: ["onKey"],
      async: false
    },
    {
      component: "App",
      context: "call-argument:useEventListener:1",
      captures: ["save"],
      async: false
    },
    {
      component: "App",
      context: "call-argument:debounce:0",
      captures: ["count", "save"],
      async: false
    },
    {
      component: "App",
      context: "call-argument:useSyncExternalStore:0",
      captures: ["subscribe"],
      async: false
    },
    {
      component: "App",
      context: "call-argument:useSyncExternalStore:1",
      captures: ["count", "getSnapshot"],
      async: false
    },
    {
      component: "App",
      context: "object-property:mutationFn",
      captures: ["save"],
      async: true
    },
    {
      component: "App",
      context: "object-property:onSuccess",
      captures: ["count", "setCount"],
      async: false
    },
    {
      component: "App",
      context: "jsx-attribute:Panel.ref",
      captures: ["nodeRef"],
      async: false
    },
    {
      component: "App",
      context: "jsx-attribute:Panel.renderItem",
      captures: ["count"],
      async: false
    },
    {
      component: "App",
      context: "jsx-attribute:Panel.onSelect",
      captures: ["handler"],
      async: false
    },
    {
      component: "App",
      context: "call-argument:debounce:0",
      captures: ["count", "save"],
      async: false
    }
  ]);

  assert.deepEqual(
    request.condensedAst.candidates.map((candidate) => candidate.target),
    ["Panel.ref", "Panel.renderItem", "Panel.onSelect"]
  );

  const inference = inferBoundaryManifestForProject(project, {
    classifyBoundary(candidate) {
      return {
        kind: isHostEventProp(candidate.attribute) ? "event" : "unknown",
        confidence: isHostEventProp(candidate.attribute) ? "high" : "none"
      };
    }
  });
  const whitelistedClosures = discoverExtractableClosuresInProject(project, inference.manifest).map((closure) => ({
    file: closure.file,
    target: closure.target,
    kind: closure.boundaryKind
  }));
  assert.deepEqual(whitelistedClosures, [{ file: "src/App.tsx", target: "Panel.onSelect", kind: "event" }]);
}

async function testOllamaClientContract() {
  let posted;
  const mockRequest = {
    task: "test",
    condensedAst: {
      files: [],
      propForwardingEdges: [
        {
          component: "Button",
          prop: "onPress",
          targetKind: "host",
          targetTag: "button",
          targetProp: "onClick"
        },
        {
          component: "ToolbarButton",
          prop: "onActivate",
          targetKind: "component",
          targetTag: "Button",
          targetComponent: "Button",
          targetProp: "onPress"
        },
        {
          component: "Toolbar",
          prop: "onSave",
          targetKind: "component",
          targetTag: "ToolbarButton",
          targetComponent: "ToolbarButton",
          targetProp: "onActivate"
        }
      ]
    }
  };
  const mockDecision = {
    decision: "add_to_whitelist",
    confidence: "high",
    reason: "Button.onPress forwards to host button.onClick.",
    trace: ["src/App.tsx Button.onPress", "src/Button.tsx props.onPress", "button.onClick"],
    manifestPatch: {
      components: [
        { component: "Button", prop: "onPress", kind: "event" },
        { component: "Toolbar", prop: "onSave", kind: "event" }
      ]
    }
  };

  const result = await inferBoundaryManifestPatchWithOllama(
    mockRequest,
    {
      model: "gemma4:e2b",
      fetchImpl: async (url, init) => {
        posted = { url, body: JSON.parse(init.body) };
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              model: "gemma4:e2b",
              message: { content: JSON.stringify(mockDecision) },
              prompt_eval_count: 120,
              prompt_eval_duration: 2_000_000_000,
              eval_count: 30,
              eval_duration: 1_000_000_000,
              total_duration: 3_500_000_000
            });
          }
        };
      }
    }
  );

  assert.equal(posted.url, "http://127.0.0.1:11434/api/chat");
  assert.equal(posted.body.model, "gemma4:e2b");
  assert.equal(posted.body.stream, false);
  assert.equal(posted.body.think, false);
  assert.equal(posted.body.options.num_predict, 1024);
  assert.equal(posted.body.format.required.includes("manifestPatch"), true);
  assert.equal(posted.body.format.required.includes("trace"), false);
  assert.equal(Object.hasOwn(posted.body.format.properties, "trace"), false);
  assert.equal(posted.body.format.properties.manifestPatch.properties.components.items.required.includes("evidence"), false);
  assert.equal(
    posted.body.format.properties.manifestPatch.properties.components.items.properties.kind.enum.includes("unknown"),
    false
  );
  assert(posted.body.messages[0].content.includes("Only add manifestPatch entries when propForwardingEdges contain a complete path"));
  assert(posted.body.messages[0].content.includes("allowedManifestTargets is the closed list"));
  assert(posted.body.messages[0].content.includes("Only output exact component/prop pairs from condensedAst.candidates"));
  assert(posted.body.messages[0].content.includes("Never output candidate.ownerComponent"));
  assert(posted.body.messages[0].content.includes("manifestPatch.components is add-only"));
  assert(posted.body.messages[0].content.includes("Return only component, prop, and kind"));
  assert(posted.body.messages[0].content.includes("Do not return trace or evidence"));
  assert.equal(result.decision.decision, "add_to_whitelist");
  assert.equal(result.performance.promptTokensPerSecond, 60);
  assert.equal(result.performance.outputTokensPerSecond, 30);
  assert.throws(() => decisionToManifest(result.decision), /requires the condensed AST request/);
  assert.deepEqual(decisionToManifest(result.decision, mockRequest), {
    components: {
      Button: {
        props: {
          onPress: "event"
        },
        evidence: {
          onPress: ["Button.onPress", "button.onClick"]
        }
      },
      Toolbar: {
        props: {
          onSave: "event"
        },
        evidence: {
          onSave: ["Toolbar.onSave", "ToolbarButton.onActivate", "Button.onPress", "button.onClick"]
        }
      }
    }
  });
}

function testScenarioSuite() {
  assert.equal(SCENARIOS.length, 20);

  const summaries = SCENARIOS.map((scenario) => {
    const result = evaluateScenario(scenario);
    assert.deepEqual(boundaryLabels(result.actualBoundaries), result.expectedBoundaries, `${scenario.id} deterministic boundaries`);
    assert.deepEqual(
      result.actualExtractableClosures,
      result.expectedExtractableClosures,
      `${scenario.id} extractable closures`
    );
    assert.deepEqual(result.actualUnknowns, result.expectedUnknowns, `${scenario.id} unknown candidates`);
    for (const boundary of result.actualBoundaries) {
      assert(Array.isArray(boundary.evidence), `${scenario.id} ${boundary.component}.${boundary.prop} evidence array`);
      assert(boundary.evidence.length >= 2, `${scenario.id} ${boundary.component}.${boundary.prop} evidence path`);
      assert.equal(boundary.evidence[0], `${boundary.component}.${boundary.prop}`);
      assertHostEventEvidence(boundary.evidence.at(-1));
    }
    return scenarioResultSummary(result);
  });

  const positiveCount = summaries.filter((summary) => summary.expectedBoundaryCount > 0).length;
  const negativeCount = summaries.filter((summary) => summary.category === "negative").length;
  const ambiguousCount = summaries.filter((summary) => summary.category === "ambiguous").length;

  assert.equal(positiveCount, 16);
  assert.equal(negativeCount, 2);
  assert.equal(ambiguousCount, 2);
  assert.equal(expectedBoundaryEntries(SCENARIOS).length, 27);
  assert.equal(expectedUnknownEntries(SCENARIOS).length, 5);
  assert.equal(
    summaries.reduce((sum, summary) => sum + summary.expectedExtractableClosureCount, 0),
    21
  );

  const twoHop = evaluateScenario(SCENARIOS.find((scenario) => scenario.id === "07-two-hop-forwarding"));
  assert.deepEqual(
    twoHop.actualBoundaries.find((boundary) => boundary.component === "ActionPanel").evidence,
    ["ActionPanel.onAction", "ActionButton.onTrigger", "button.onClick"]
  );
}

function assertClosureSite(request, targetComponent, prop, sourceSnippet) {
  const closure = request.condensedAst.closureSites.find((site) => {
    return site.file === "src/App.tsx" && site.targetComponent === targetComponent && site.prop === prop;
  });
  assert(closure, `expected a condensed closure site for App -> ${targetComponent}.${prop}`);
  assert.equal(closure.valueKind, "ArrowFunctionExpression");
  assert(closure.source.includes(sourceSnippet), `expected ${targetComponent}.${prop} closure source`);
}

function assertForwardingEdge(request, expected) {
  const forwardingEdge = request.condensedAst.propForwardingEdges.find((edge) => {
    return Object.entries(expected).every(([key, value]) => edge[key] === value);
  });
  assert(forwardingEdge, `expected condensed forwarding edge ${JSON.stringify(expected)}`);
}

function closureInventorySummary(closure) {
  return {
    component: closure.component,
    context: closureContextLabel(closure.context),
    captures: closure.captures,
    async: closure.async
  };
}

function closureContextLabel(context) {
  if (context.kind === "call-argument") {
    return `${context.kind}:${context.callee}:${context.argumentIndex}`;
  }
  if (context.kind === "variable-init") {
    return `${context.kind}:${context.bindingName}`;
  }
  if (context.kind === "object-property") {
    return `${context.kind}:${context.property}`;
  }
  if (context.kind === "jsx-attribute") {
    return `${context.kind}:${context.tag}.${context.prop}`;
  }
  return context.kind;
}

function testModelJsonParsing() {
  assert.deepEqual(parseJsonObjectFromModelContent('```json\n{"decision":"unknown"}\n```'), {
    decision: "unknown"
  });
  assert.deepEqual(parseJsonObjectFromModelContent('prefix {"decision":"unknown"} suffix'), {
    decision: "unknown"
  });
}

function testDecisionValidation() {
  assert.deepEqual(
    normalizeBoundaryDecision({
      decision: "add_to_whitelist",
      confidence: "high",
      reason: "test",
      trace: [],
      manifestPatch: {
        components: [
          {
            component: "Toolbar",
            prop: "onSave",
            kind: "event",
            evidence:
              ["c:src/Toolbar.tsx:Toolbar.onSave->c:src/ToolbarButton.tsx:ToolbarButton.onActivate->button.onClick"]
          }
        ]
      }
    }).manifestPatch.components[0],
    { component: "Toolbar", prop: "onSave", kind: "event" }
  );
  assert.deepEqual(
    decisionToManifest(
      normalizeBoundaryDecision({
        decision: "add_to_whitelist",
        confidence: "high",
        reason: "test",
        trace: [],
        manifestPatch: {
          components: [
            { component: "Button", prop: "onPress", kind: "event" },
            { component: "Missing", prop: "onGuess", kind: "event" }
          ]
        }
      }),
      {
        condensedAst: {
          propForwardingEdges: [
            {
              component: "Button",
              prop: "onPress",
              targetKind: "host",
              targetTag: "button",
              targetProp: "onClick"
            }
          ]
        }
      }
    ),
    {
      components: {
        Button: {
          props: {
            onPress: "event"
          },
          evidence: {
            onPress: ["Button.onPress", "button.onClick"]
          }
        }
      }
    }
  );
  assert.deepEqual(
    decisionToManifest(
      normalizeBoundaryDecision({
        decision: "add_to_whitelist",
        confidence: "high",
        reason: "test",
        trace: [],
        manifestPatch: {
          components: [
            { component: "Button", prop: "onPress", kind: "event" },
            { component: "Toolbar", prop: "onSave", kind: "event" }
          ]
        }
      }),
      {
        targetCandidateIds: ["closure:toolbar"],
        condensedAst: {
          candidates: [{ id: "closure:toolbar", target: "Toolbar.onSave" }],
          propForwardingEdges: [
            {
              component: "Button",
              prop: "onPress",
              targetKind: "host",
              targetTag: "button",
              targetProp: "onClick"
            },
            {
              component: "Toolbar",
              prop: "onSave",
              targetKind: "component",
              targetComponent: "Button",
              targetProp: "onPress"
            }
          ]
        }
      }
    ),
    {
      components: {
        Toolbar: {
          props: {
            onSave: "event"
          },
          evidence: {
            onSave: ["Toolbar.onSave", "Button.onPress", "button.onClick"]
          }
        }
      }
    }
  );
  assert.throws(() => normalizeBoundaryDecision({ decision: "maybe" }), /Unsupported decision/);
  assert.throws(
    () =>
      normalizeBoundaryDecision({
        decision: "add_to_whitelist",
        confidence: "high",
        reason: "",
        trace: [],
        manifestPatch: {
          components: [{ component: "Button", prop: "onPress", kind: "side_effect" }]
        }
      }),
    /Unsupported boundary kind/
  );
}

function assertHostEventEvidence(value) {
  const separator = value.lastIndexOf(".");
  assert(separator > 0, `expected terminal evidence to be tag.prop, got ${value}`);
  assert(isHostJsxTag(value.slice(0, separator)), `expected host JSX tag evidence, got ${value}`);
  assert(isHostEventProp(value.slice(separator + 1)), `expected host event prop evidence, got ${value}`);
}

function isHostJsxTag(tag) {
  return typeof tag === "string" && tag.length > 0 && isAsciiLowercaseCode(tag.charCodeAt(0));
}

function isHostEventProp(prop) {
  return typeof prop === "string" && prop.length > 2 && prop.startsWith("on") && isAsciiUppercaseCode(prop.charCodeAt(2));
}

function isAsciiLowercaseCode(code) {
  return code >= 97 && code <= 122;
}

function isAsciiUppercaseCode(code) {
  return code >= 65 && code <= 90;
}

async function readSourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await readSourceFiles(path)));
    } else if ([".tsx", ".jsx", ".ts", ".js"].includes(extname(entry.name))) {
      files.push({
        filename: path,
        source: await readFile(path, "utf8")
      });
    }
  }

  return files.sort((left, right) => left.filename.localeCompare(right.filename));
}
