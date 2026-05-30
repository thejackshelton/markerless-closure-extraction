# T999 Final Audit

Result: complete

`full_outcome_complete: true`

## Audit Findings

- mcp__grep evidence is present in `notes/T001-grep-evidence.md`.
- Primary model/runtime validation is present in `notes/T002-primary-validation.md`.
- The Judge recommendation is present in `notes/T003-recommendation.md`.
- The recommendation addresses local/offline execution through Ollama plus llama.cpp/GGUF.
- The recommendation addresses speed by selecting Qwen2.5-Coder 1.5B as the default and limiting model calls to changed compact candidate evidence.
- The recommendation addresses code-awareness through Qwen2.5-Coder and a Yuku-derived evidence contract.
- The recommendation addresses hardware reach through default, quality, workstation, and no-model tiers.
- The recommendation addresses structured output through Ollama JSON/schema mode and local validation.
- The recommendation addresses deterministic compiler constraints by keeping Yuku/import traversal deterministic and treating model output as manifest proposals or `unknown`, not build-time truth.

## Final Recommendation

Use Qwen2.5-Coder 1.5B Instruct in a small local quantized form as the default classifier behind an Ollama-first runtime, with llama.cpp/GGUF compatibility. Keep Qwen2.5-Coder 3B or Qwen3 4B as eval-gated quality tiers, Qwen2.5-Coder 7B as a workstation tier, and static unresolved diagnostics as the no-model fallback.

The research objective is satisfied.
