import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "pathe";
import {
  createBoundaryInferenceRequest,
  discoverExtractableClosuresInProject,
  parseProjectFiles,
  stableJson
} from "../src/pipeline.mjs";
import {
  DEFAULT_OLLAMA_MODEL,
  decisionToManifest,
  inferBoundaryManifestPatchWithOllama
} from "../src/ollama-classifier.mjs";

const model = process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
const appRoot = resolve("demo/react-app");
const srcRoot = resolve(appRoot, "src");
const manifestPath = resolve("closure-boundaries.json");

const sourceFiles = await readSourceFiles(srcRoot);
const project = parseProjectFiles(sourceFiles, appRoot);
const request = createBoundaryInferenceRequest(project);
const requestBytes = Buffer.byteLength(JSON.stringify(request), "utf8");

console.log("markerless-closure-extraction Ollama POC");
console.log("parser: yuku-parser (project TSX/JSX AST)");
console.log(`model: ${model}`);
console.log("demo: demo/react-app");
console.log("manifest: closure-boundaries.json");
console.log(`condensed AST request: ${requestBytes} bytes`);
console.log(`extracted closure inventory: ${request.condensedAst.extractedClosures.length}`);
console.log(`candidate boundary closures: ${request.condensedAst.candidates.length}`);
console.log("");

const result = await inferBoundaryManifestPatchWithOllama(request, { model });
const manifest = decisionToManifest(result.decision, request);
await writeFile(manifestPath, stableJson(manifest));

const closures = discoverExtractableClosuresInProject(project, manifest);

console.log("model decision:");
console.log(JSON.stringify(result.decision, null, 2));
console.log("");
console.log("performance:");
console.log(JSON.stringify(result.performance, null, 2));
console.log("");
console.log("candidate boundary surfaces:");
for (const edge of request.condensedAst.propForwardingEdges) {
  console.log(`  ${edge.sourceFile}: ${edge.component}.${edge.prop} -> ${edge.targetTag}.${edge.targetProp}`);
}
console.log("");
console.log("allowed manifest targets:");
for (const target of request.allowedManifestTargets) {
  console.log(`  ${target.component}.${target.prop}`);
}
console.log("");
console.log("persisted manifest boundaries:");
for (const [component, record] of Object.entries(manifest.components)) {
  for (const [prop, kind] of Object.entries(record.props)) {
    console.log(`  ${component}.${prop} = ${kind}`);
    for (const evidence of record.evidence?.[prop] ?? []) {
      console.log(`    ${evidence}`);
    }
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
console.log("wrote: closure-boundaries.json");
console.log("ollama poc: pass");

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
