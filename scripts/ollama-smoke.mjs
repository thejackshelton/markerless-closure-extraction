import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "pathe";
import { createBoundaryInferenceRequest, parseProjectFiles } from "../src/pipeline.mjs";
import {
  DEFAULT_OLLAMA_MODEL,
  decisionToManifest,
  inferBoundaryManifestPatchWithOllama
} from "../src/ollama-classifier.mjs";

const model = process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
const appRoot = resolve("demo/react-app");
const project = parseProjectFiles(await readSourceFiles(resolve(appRoot, "src")), appRoot);
const request = createBoundaryInferenceRequest(project);
const requestBytes = Buffer.byteLength(JSON.stringify(request), "utf8");

console.log(`ollama smoke model: ${model}`);
console.log(`condensed AST request: ${requestBytes} bytes`);
console.log(`candidate count: ${request.condensedAst.candidates.length}`);

const result = await inferBoundaryManifestPatchWithOllama(request, { model });
const manifest = decisionToManifest(result.decision, request);

console.log("decision:");
console.log(JSON.stringify(result.decision, null, 2));
console.log("performance:");
console.log(JSON.stringify(result.performance, null, 2));

const expectedBoundaries = [
  ["Button", "onPress"],
  ["Toolbar", "onSave"],
  ["Toolbar", "onPublish"],
  ["ConfirmDialog", "onConfirm"],
  ["ConfirmDialog", "onCancel"],
  ["FormPanel", "onSubmit"],
  ["FormPanel", "onReset"]
];

for (const [component, prop] of expectedBoundaries) {
  const kind = manifest.components?.[component]?.props?.[prop];
  if (kind !== "event") {
    throw new Error(`expected Gemma to infer ${component}.${prop} = event, got ${kind ?? "missing"}`);
  }
  const evidence = manifest.components?.[component]?.evidence?.[prop];
  if (!Array.isArray(evidence) || evidence.length < 2) {
    throw new Error(`expected compiler to derive evidence for ${component}.${prop}`);
  }
}

console.log("ollama smoke: pass");

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
