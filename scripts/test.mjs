import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createBoundaryInferenceRequest, parseProjectFiles } from "../src/pipeline.mjs";
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

await testCondensedAstRequest();
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

async function testOllamaClientContract() {
  let posted;
  const mockDecision = {
    decision: "add_to_whitelist",
    confidence: "high",
    reason: "Button.onPress forwards to host button.onClick.",
      trace: ["src/App.tsx Button.onPress", "src/Button.tsx props.onPress", "button.onClick"],
      manifestPatch: {
        components: [
        { component: "Button", prop: "onPress", kind: "event", evidence: ["Button.onPress", "button.onClick"] },
        {
          component: "Toolbar",
          prop: "onSave",
          kind: "event",
          evidence: ["Toolbar.onSave", "ToolbarButton.onActivate", "button.onClick"]
        }
      ]
    }
  };

  const result = await inferBoundaryManifestPatchWithOllama(
    { task: "test", condensedAst: { files: [] } },
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
  assert.match(
    posted.body.messages[0].content,
    /Only add manifestPatch entries when propForwardingEdges contain a complete path/
  );
  assert.equal(result.decision.decision, "add_to_whitelist");
  assert.equal(result.performance.promptTokensPerSecond, 60);
  assert.equal(result.performance.outputTokensPerSecond, 30);
  assert.deepEqual(decisionToManifest(result.decision), {
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
          onSave: ["Toolbar.onSave", "ToolbarButton.onActivate", "button.onClick"]
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
      assert.match(boundary.evidence.at(-1), /^[a-z][A-Za-z0-9]*\.on[A-Z]/);
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
    }).manifestPatch.components[0].evidence,
    ["Toolbar.onSave", "ToolbarButton.onActivate", "button.onClick"]
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
