import { DEFAULT_OLLAMA_MODEL, decisionToManifest, inferBoundaryManifestPatchWithOllama } from "../src/ollama-classifier.mjs";
import {
  SCENARIOS,
  boundariesFromManifest,
  createScenarioRequest,
  entriesEqual,
  expectedModelBoundaryEntries
} from "../src/scenario-suite.mjs";

const model = process.env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL;
const limit = Number(process.env.OLLAMA_SCENARIOS_LIMIT ?? SCENARIOS.length);
const scenarios = SCENARIOS.slice(0, limit);
let failures = 0;

console.log(`ollama scenario model: ${model}`);
console.log(`scenarios: ${scenarios.length}`);

for (const scenario of scenarios) {
  const request = createScenarioRequest(scenario);
  const started = performance.now();
  const result = await inferBoundaryManifestPatchWithOllama(request, { model });
  const wallMs = performance.now() - started;
  const actual = boundariesFromManifest(decisionToManifest(result.decision));
  const expected = expectedModelBoundaryEntries(scenario);
  const pass = entriesEqual(actual, expected);

  console.log(
    JSON.stringify({
      id: scenario.id,
      title: scenario.title,
      level: scenario.level,
      pass,
      decision: result.decision.decision,
      confidence: result.decision.confidence,
      expectedCandidateBoundaryCount: expected.length,
      actualCandidateBoundaryCount: actual.length,
      requestBytes: Buffer.byteLength(JSON.stringify(request), "utf8"),
      wallMs,
      promptTokens: result.performance.promptTokens,
      outputTokens: result.performance.outputTokens
    })
  );

  if (!pass) {
    failures += 1;
    console.log("expected boundaries:");
    console.log(JSON.stringify(expected, null, 2));
    console.log("actual boundaries:");
    console.log(JSON.stringify(actual, null, 2));
    console.log("decision:");
    console.log(JSON.stringify(result.decision, null, 2));
  }
}

console.log("summary:");
console.log(
  JSON.stringify(
    {
      model,
      scenarios: scenarios.length,
      failures
    },
    null,
    2
  )
);

if (failures > 0) {
  throw new Error(`ollama scenario suite failed: ${failures} scenario(s) did not match expectations`);
}

console.log("ollama scenario suite: pass");
