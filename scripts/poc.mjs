import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import {
  DeterministicMockClassifier,
  discoverExtractableClosuresInProject,
  inferBoundaryManifestForProject,
  parseProjectFiles,
  stableJson
} from "../src/pipeline.mjs";

const appRoot = resolve("demo/react-app");
const srcRoot = resolve(appRoot, "src");
const manifestPath = resolve("closure-boundaries.json");
const classifierFixturePath = resolve("fixtures/mock-classifier.json");

const sourceFiles = await readSourceFiles(srcRoot);
const classifierFixture = JSON.parse(await readFile(classifierFixturePath, "utf8"));
const classifier = new DeterministicMockClassifier(classifierFixture);
const project = parseProjectFiles(sourceFiles, appRoot);

const inference = inferBoundaryManifestForProject(project, classifier);
await writeFile(manifestPath, stableJson(inference.manifest));

const persistedManifest = JSON.parse(await readFile(manifestPath, "utf8"));
const closures = discoverExtractableClosuresInProject(project, persistedManifest);

verify(project, inference, persistedManifest, closures);

console.log("markerless-closure-extraction POC");
console.log("parser: yuku-parser (project TSX/JSX AST)");
console.log("demo: demo/react-app");
console.log("manifest: closure-boundaries.json");
console.log("");
console.log("parsed files:");
for (const file of inference.diagnostics.files) {
  console.log(`  ${file}`);
}
console.log("");
console.log("candidate boundary surfaces:");
for (const edge of inference.diagnostics.astEdges) {
  console.log(
    `  ${edge.sourceFile}: ${edge.component}.${edge.prop} -> ${edge.targetTag}.${edge.targetProp}`
  );
}
console.log("");
console.log("inferred boundaries:");
for (const [component, record] of Object.entries(persistedManifest.components)) {
  for (const [prop, kind] of Object.entries(record.props)) {
    const edge = inference.diagnostics.astEdges.find((candidate) => {
      return candidate.component === component && candidate.prop === prop;
    });
    const reason = edge ? `classifier fixture on ${edge.targetTag}.${edge.targetProp}` : "classifier fixture";
    console.log(`  ${component}.${prop} = ${kind} (${reason})`);
  }
}
console.log("");
console.log("extractable closures from persisted manifest:");
for (const closure of closures) {
  console.log(
    `  ${closure.file}:${closure.loc.line}:${closure.loc.column + 1} ${closure.target} ${closure.boundaryKind} -> ${closure.source}`
  );
}
console.log("");
console.log("verification: pass");

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

function verify(project, inference, manifest, closureReports) {
  const allSource = project.map((file) => file.source).join("\n");
  const expectedBoundaries = [
    ["Button", "onPress"],
    ["ToolbarButton", "onActivate"],
    ["Toolbar", "onSave"],
    ["Toolbar", "onPublish"],
    ["DialogActions", "onPrimary"],
    ["DialogActions", "onSecondary"],
    ["ConfirmDialog", "onConfirm"],
    ["ConfirmDialog", "onCancel"],
    ["FormPanel", "onSubmit"],
    ["FormPanel", "onReset"]
  ];

  for (const [component, prop] of expectedBoundaries) {
    assert(
      manifest.components?.[component]?.props?.[prop] === "event",
      `expected manifest.components.${component}.props.${prop} to equal event`
    );
  }

  assert(!allSource.includes("QRL"), "demo source must not contain a QRL marker");
  assert(!allSource.includes("qrl("), "demo source must not contain a qrl(...) marker");
  assert(!allSource.includes("onPress$"), "demo source must not contain a marked onPress$ callback prop");
  assert(!allSource.includes("onClick$"), "demo source must not contain a marked onClick$ callback prop");

  assertEdge(inference, {
    sourceFile: "src/Button.tsx",
    component: "Button",
    prop: "onPress",
    targetTag: "button",
    targetProp: "onClick"
  });
  assertEdge(inference, {
    sourceFile: "src/Toolbar.tsx",
    component: "Toolbar",
    prop: "onSave",
    targetTag: "ToolbarButton",
    targetProp: "onActivate"
  });
  assertEdge(inference, {
    sourceFile: "src/ConfirmDialog.tsx",
    component: "ConfirmDialog",
    prop: "onConfirm",
    targetTag: "DialogActions",
    targetProp: "onPrimary"
  });
  assertEdge(inference, {
    sourceFile: "src/FormPanel.tsx",
    component: "FormPanel",
    prop: "onSubmit",
    targetTag: "form",
    targetProp: "onSubmit"
  });

  const classifierDecision = inference.diagnostics.classifierDecisions.find((record) => {
    return record.candidate.id === "jsx-attribute:button:onClick" && record.decision.kind === "event";
  });
  assert(classifierDecision, "expected deterministic classifier fixture to label button.onClick as event");

  assertClosure(closureReports, "Button.onPress", "setCount(count + 1)");
  assertClosure(closureReports, "Toolbar.onSave", "setSavedAt");
  assertClosure(closureReports, "Toolbar.onPublish", "setPublished(true)");
  assertClosure(closureReports, "ConfirmDialog.onConfirm", "setConfirmed(true)");
  assertClosure(closureReports, "ConfirmDialog.onCancel", "setCancelled(true)");
  assertClosure(closureReports, "FormPanel.onSubmit", "event.preventDefault()");
  assertClosure(closureReports, "FormPanel.onReset", 'setFormDraft("reset")');
  assert(closureReports.length === 7, `expected 7 extractable closures, got ${closureReports.length}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`verification failed: ${message}`);
  }
}

function assertEdge(inference, expected) {
  const edge = inference.diagnostics.astEdges.find((candidate) => {
    return Object.entries(expected).every(([key, value]) => candidate[key] === value);
  });
  assert(edge, `expected boundary edge ${JSON.stringify(expected)}`);
}

function assertClosure(closureReports, target, sourceSnippet) {
  const closure = closureReports.find((report) => {
    return report.file === "src/App.tsx" && report.target === target && report.boundaryKind === "event";
  });
  assert(closure, `expected extractable closure for ${target} in src/App.tsx`);
  assert(closure.source.includes(sourceSnippet), `expected ${target} closure to include ${sourceSnippet}`);
}
