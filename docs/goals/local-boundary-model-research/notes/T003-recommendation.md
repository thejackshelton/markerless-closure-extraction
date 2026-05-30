# T003 Judge Recommendation

## Decision

Use a local classifier tier, not an agentic coding model, for recursive cross-file boundary analysis.

Default runtime:

- Ollama first, because it is the easiest OSS developer default and supports JSON/JSON-schema outputs.
- llama.cpp/GGUF as the lower-level portable engine path.
- MLX/WebGPU can be later adapters, not the default contract.

Default model:

- `qwen2.5-coder:1.5b` / Qwen2.5-Coder 1.5B Instruct in a Q4_K_M or nearest small quantized local form.
- The exact tag should be runtime-specific. Do not bake one provider's tag into the compiler contract.

Rationale:

- It has the strongest OSS usage cluster from grep evidence for local code tooling.
- It is code-specific, permissively licensed, and small enough for common developer machines.
- It has enough context for compact Yuku evidence chains.
- It can run behind an Ollama structured-output call for a closed-label classifier.

## Tiering

1. Default: Qwen2.5-Coder 1.5B Instruct, quantized, local.
2. Better quality: Qwen2.5-Coder 3B or Qwen3 4B GGUF Q4_K_M, selected by eval and hardware. Use Qwen3 in non-thinking mode for the edit loop.
3. Workstation quality: Qwen2.5-Coder 7B Instruct, only when latency is acceptable.
4. No-model fallback: static deterministic classifier plus unresolved diagnostics and a manual manifest entry path.
5. Non-default: StarCoder2 3B is useful for FIM/autocomplete but should not be the default boundary classifier because its model card says it is not an instruction model.

## Compiler Contract

The compiler must not depend on raw model guesses during build.

- Yuku parses TSX/JSX as the user types.
- Deterministic analysis follows imports recursively until it reaches a host JSX boundary, explicit manifest/whitelist entry, external package boundary, unresolved symbol, cycle, or budget limit.
- The model receives only compact evidence chains for candidates the deterministic pass cannot classify confidently.
- The model returns a small validated JSON object.
- Low confidence, invalid JSON, cycles, or missing evidence resolve to `unknown`, not to an extracted boundary.
- The watch loop may produce manifest proposals; production builds should consume deterministic source plus accepted manifest state.

Suggested schema:

```json
{
  "label": "event | server | resource | component | unknown",
  "confidence": "high | medium | low",
  "reason_code": "host_event | prop_forward | import_alias | manifest_match | external_boundary | unresolved | cycle | insufficient_evidence",
  "evidence_ids": ["E1"]
}
```

Suggested hot-path settings:

- `temperature: 0`
- small max output token cap
- JSON/schema mode when available
- cache by normalized candidate evidence hash
- classify only changed candidate subgraphs, not the whole repository

## Eval Plan

Build a fixture set from Yuku-derived evidence chains:

- direct React/Solid host events
- wrapper components that forward handler props
- alias imports and re-exports
- prop destructuring and spread props
- external package boundaries
- server/resource markers
- false positives such as `className`, `ref`, `data-*`, and ordinary callback props
- import cycles and unresolved symbols

Measure:

- per-label precision/recall/F1
- high-confidence false positives
- `unknown` rate
- invalid JSON rate
- repeated-run stability
- p50/p95 warm classification latency
- cold load time and RAM
- manifest churn after edits

Acceptance target for a default:

- no high-confidence false positives in critical boundary labels on fixtures
- invalid JSON below 1 percent with schema mode
- low-confidence or incomplete evidence becomes `unknown`
- warm p95 fast enough for authoring feedback, ideally sub-500 ms for changed candidates on common machines

## Sources Used

- mcp__grep OSS evidence in `notes/T001-grep-evidence.md`
- primary model/runtime validation in `notes/T002-primary-validation.md`
- Qwen2.5-Coder 1.5B Instruct: https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct
- Qwen2.5-Coder 7B Instruct: https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct
- Qwen3 4B GGUF: https://huggingface.co/Qwen/Qwen3-4B-GGUF
- StarCoder2 3B: https://huggingface.co/bigcode/starcoder2-3b
- Ollama structured outputs: https://docs.ollama.com/capabilities/structured-outputs
- Ollama generate API: https://docs.ollama.com/api/generate

## Full Outcome

`full_outcome_complete: true` for the recommendation step. The final audit still needs to verify the full research objective.
