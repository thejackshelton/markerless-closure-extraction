import {
  SCENARIOS,
  entriesEqual,
  evaluateScenario,
  scenarioResultSummary
} from "../src/scenario-suite.mjs";

let failures = 0;
let totalBoundaries = 0;
let totalClosures = 0;

console.log(`scenario suite: ${SCENARIOS.length} cases`);

for (const scenario of SCENARIOS) {
  const result = evaluateScenario(scenario);
  const boundaryPass = entriesEqual(result.actualBoundaries, result.expectedBoundaries);
  const closurePass = entriesEqual(result.actualExtractableClosures, result.expectedExtractableClosures);
  const summary = scenarioResultSummary(result);

  totalBoundaries += result.actualBoundaries.length;
  totalClosures += result.actualExtractableClosures.length;

  console.log(
    JSON.stringify({
      ...summary,
      boundaries: boundaryPass ? "pass" : "fail",
      closures: closurePass ? "pass" : "fail"
    })
  );

  if (!boundaryPass || !closurePass) {
    failures += 1;
    console.log("expected boundaries:");
    console.log(JSON.stringify(result.expectedBoundaries, null, 2));
    console.log("actual boundaries:");
    console.log(JSON.stringify(result.actualBoundaries, null, 2));
    console.log("expected extractable closures:");
    console.log(JSON.stringify(result.expectedExtractableClosures, null, 2));
    console.log("actual extractable closures:");
    console.log(JSON.stringify(result.actualExtractableClosures, null, 2));
  }
}

console.log("summary:");
console.log(
  JSON.stringify(
    {
      scenarios: SCENARIOS.length,
      failures,
      totalBoundaries,
      totalExtractableClosures: totalClosures
    },
    null,
    2
  )
);

if (failures > 0) {
  throw new Error(`scenario suite failed: ${failures} scenario(s) did not match expectations`);
}

console.log("scenario suite: pass");
