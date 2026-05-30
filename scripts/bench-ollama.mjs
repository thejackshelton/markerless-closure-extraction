import { readdir, readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { createBoundaryInferenceRequest, parseProjectFiles } from "../src/pipeline.mjs";
import { DEFAULT_OLLAMA_MODEL, inferBoundaryManifestPatchWithOllama } from "../src/ollama-classifier.mjs";

const model = process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
const runs = Number(process.env.OLLAMA_RUNS ?? 3);
const appRoot = resolve("demo/react-app");
const project = parseProjectFiles(await readSourceFiles(resolve(appRoot, "src")), appRoot);
const request = createBoundaryInferenceRequest(project);
const requestBytes = Buffer.byteLength(JSON.stringify(request), "utf8");
const records = [];

console.log(`ollama bench model: ${model}`);
console.log(`runs: ${runs}`);
console.log(`condensed AST request: ${requestBytes} bytes`);

for (let index = 0; index < runs; index += 1) {
  const started = performance.now();
  const result = await inferBoundaryManifestPatchWithOllama(request, { model });
  const wallMs = performance.now() - started;
  const record = {
    run: index + 1,
    wallMs,
    decision: result.decision.decision,
    confidence: result.decision.confidence,
    promptTokensPerSecond: result.performance.promptTokensPerSecond,
    outputTokensPerSecond: result.performance.outputTokensPerSecond,
    promptTokens: result.performance.promptTokens,
    outputTokens: result.performance.outputTokens
  };
  records.push(record);
  console.log(JSON.stringify(record));
}

console.log("summary:");
console.log(
  JSON.stringify(
    {
      wallMs: summarize(records.map((record) => record.wallMs)),
      promptTokensPerSecond: summarize(records.map((record) => record.promptTokensPerSecond).filter(Number.isFinite)),
      outputTokensPerSecond: summarize(records.map((record) => record.outputTokensPerSecond).filter(Number.isFinite))
    },
    null,
    2
  )
);

function summarize(values) {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  return {
    min: sorted[0],
    median: sorted[Math.floor(sorted.length / 2)],
    max: sorted[sorted.length - 1]
  };
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
