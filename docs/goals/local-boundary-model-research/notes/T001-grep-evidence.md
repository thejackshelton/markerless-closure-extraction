# T001 Grep Evidence

## Strongest Practical Cluster: Qwen2.5-Coder via Ollama/GGUF/llama.cpp

- `zed-industries/zed` has Ollama settings tests that explicitly handle `qwen2.5-coder:1.5b` and nearby sizes as local model IDs.
- `voideditor/void` lists `qwen2.5-coder:1.5b` with context window `32_000`, downloadable size `.986` GB, FIM support, and includes it in `ollamaRecommendedModels`.
- `continuedev/continue` uses Ollama local onboarding defaults with `LOCAL_ONBOARDING_FIM_MODEL = "qwen2.5-coder:1.5b-base"` and maps Qwen2.5-Coder sizes through Ollama IDs.
- `ggml-org/llama.cpp` tool benchmark script runs Qwen2.5-Coder 0.5B, 1.5B, 3B, 7B, and 32B at `Q4_K_M`, with both HF GGUF and Ollama IDs.
- `ggml-org/llama.vscode` provides local `llama-server` commands for Qwen2.5-Coder 1.5B CPU-only, 1.5B <= 8GB VRAM, 3B <= 16GB VRAM, and larger tiers.
- `moltis-org/moltis` local model registry defines `qwen2.5-coder-1.5b-q4_k_m` with GGUF and MLX repos, `min_ram_gb: 4`, `context_window: 32_768`, and ChatML hint.
- `carlrobertoh/ProxyAI` lists Qwen2.5-Coder 1.5B Q6/Q8 and 3B Q4/Q6 GGUF sizes.
- `mlc-ai/web-llm` includes MLC/WebGPU entries for Qwen2.5-Coder 1.5B, showing browser-local viability patterns.

## Qwen3 4B Cluster

- `spring-projects/spring-ai` exposes Ollama constants for `qwen3:4b`, `qwen3:4b-thinking`, and `qwen3:1.7b`.
- `langchain-ai/deepagents` tests saving `ollama:qwen3:4b` as a default local model.
- `DontFeedTheAI` hardware catalog treats `qwen3:1.7b` as a default speed/quality tier, `qwen3:4b` as a better accuracy tier, and caps CPU-only machines below 4B for real-time inference.
- `NativeMindBrowser/NativeMindExtension` mock Ollama streaming responses use `qwen3:4b`.

## StarCoder2 3B Cluster

- `continuedev/continue` lists `starcoder2:3b` in OSS model info and Ollama mappings.
- `DevoxxGenieIDEAPlugin` recommends `starcoder2:3b` as lightweight/fast for inline/FIM completion, with Qwen2.5-Coder 7B as a higher-quality alternative.
- `vim-ollama` defaults tab completion to `starcoder2:3b`.

## Structured JSON / Closed Output Evidence

- `langchain-ai/langchainjs` has `ChatOllama({ model: "llama3", format: "json" })` examples.
- `mem0ai/mem0` maps OpenAI-style `responseFormat.type === "json_object"` to Ollama `format: "json"`.
- `HKUDS/LightRAG` normalizes OpenAI `response_format` into Ollama native `format`, including JSON schema pass-through.
- `agno-agi/agno` passes Pydantic model schemas to Ollama `format` for structured outputs.
- `microsoft/agent-framework` documents Ollama `response_format` mapping to `format`, including JSON schema dicts.

## Scout Shortlist

1. Default candidate: `qwen2.5-coder:1.5b-instruct-q4_K_M` or nearby GGUF/Ollama tag, because it has the strongest evidence for code-specific local use on common hardware.
2. Better quality tier: `qwen2.5-coder:3b`/`7b` or `qwen3:4b`, depending on evals. Qwen3 4B may be more generally capable, but grep evidence is less code-classifier-specific.
3. FIM/completion-only fallback: `starcoder2:3b`; useful for completion, weaker fit for JSON classification because it is not primarily an instruct classifier.
4. Runtime: support Ollama first for UX and `format: "json"`; support llama.cpp/GGUF as the lower-level engine path; add MLX as an Apple-specific optimization later.

## Risks and Gaps

- Grep evidence shows usage/config patterns, not accuracy on this boundary-classification task.
- StarCoder2 appears mainly in FIM/autocomplete contexts, not structured classification.
- Qwen3 4B may be a strong quality tier, but primary model-card validation is needed for license, context, and local deployment details.
- Need a local eval harness with Yuku-derived candidates before treating any model as the default.
