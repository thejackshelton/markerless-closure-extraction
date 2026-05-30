# T002 Primary-Source Validation

## Qwen2.5-Coder 1.5B Instruct

Primary source: https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct

- License: Apache-2.0.
- Code-specific Qwen model series with sizes from 0.5B to 32B.
- 1.5B model facts: 1.54B parameters, 32,768-token context.
- Model card exposes local-app/quantization paths for llama.cpp, Ollama, LM Studio, compatible apps, plus vLLM/SGLang/Docker paths.
- Fit for this project: best default local classifier candidate because it is code-specific, small enough for common machines, permissive, and has enough context for compact Yuku evidence chains.

## Qwen2.5-Coder 7B Instruct

Primary source: https://huggingface.co/Qwen/Qwen2.5-Coder-7B-Instruct

- License: Apache-2.0.
- 7.61B parameters, 131,072-token full context, code-specific instruction model.
- Fit for this project: high-quality optional tier, not default, because it is less likely to be fast on "most hardware" even if quantized.

## Qwen3 4B GGUF

Primary source: https://huggingface.co/Qwen/Qwen3-4B-GGUF

- License: Apache-2.0.
- GGUF distribution includes Q4_K_M and other quantizations.
- 4.0B parameters, 32,768-token native context and 131,072 with YaRN.
- Supports local llama.cpp and Ollama usage.
- Qwen3 card emphasizes reasoning/instruction-following and code generation, with `/think` and `/no_think` modes.
- Fit for this project: better-quality local tier when hardware can keep latency acceptable; use `/no_think` or non-thinking mode for the hot path to avoid reasoning latency.

## StarCoder2 3B

Primary source: https://huggingface.co/bigcode/starcoder2-3b

- License: BigCode OpenRAIL-M.
- 3B parameters, trained on 17 programming languages, 16,384-token context, FIM objective.
- The model card says it is not an instruction model and direct instruction commands do not work well.
- Fit for this project: good evidence as a local FIM/autocomplete model, but not a good default for closed-label boundary classification.

## Ollama Structured Outputs

Primary sources:

- https://docs.ollama.com/capabilities/structured-outputs
- https://docs.ollama.com/api/generate

Facts:

- Ollama local API supports `format: "json"` and JSON schema output formats.
- Structured outputs are intended to enforce JSON schema responses.
- `/api/generate` documents `format` as a structured output format that supports `"json"` or a JSON schema object.

Fit for this project:

- Ollama is the best first runtime adapter for developer UX.
- For a manifest classifier, request a tiny schema with `label`, `confidence`, `reason_code`, and `evidence_ids`; parse/validate locally; reject invalid output.

## Validation Conclusion

Recommended direction for Judge:

1. Default: `qwen2.5-coder:1.5b-instruct-q4_K_M` or nearest Ollama/GGUF equivalent.
2. Quality tier: `qwen3:4b` / `Qwen/Qwen3-4B-GGUF:Q4_K_M` in non-thinking mode, or `qwen2.5-coder:7b` for machines that can tolerate it.
3. Fallback: static classifier only, then unresolved diagnostics. Do not force a model.
4. Non-default: StarCoder2 3B for completion/FIM, not boundary classification.
