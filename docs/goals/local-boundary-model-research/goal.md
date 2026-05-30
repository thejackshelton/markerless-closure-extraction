# Local Boundary Model Research

## Objective

Research and choose the best local, fast, code-aware model strategy for recursive cross-file boundary classification in `markerless-closure-extraction`.

## Original Request

Use GoalBuddy to do `mcp__grep` research on the best possible model for recursive cross-file analysis that determines execution boundaries.

## Intake Summary

- Input shape: `specific`
- Audience: framework/tooling author choosing a default local classifier path for an OSS compiler POC.
- Authority: `requested`
- Proof type: `source_backed_answer`
- Completion proof: a source-backed recommendation naming a default local model, fallback tiers, runtime approach, and evaluation criteria for recursive cross-file boundary classification.
- Goal oracle: Scout/Judge receipts cite real-world repo evidence from `mcp__grep`, primary model cards/docs where needed, and map the recommendation back to the product constraints.
- Likely misfire: choosing a large coding-agent model that is too slow for edit-loop classification, or choosing a general tiny model that is fast but weak on code boundary semantics.
- Blind spots considered: local/offline OSS default, common hardware, latency in watch mode, context-window needs, structured-output reliability, licensing, model distribution size, and deterministic compiler behavior.
- Existing plan facts: Yuku provides ASTs as files change; recursive import/symbol analysis expands evidence; the model should classify compact boundary candidates, not walk the repo or drive the compiler; compiler consumes only persisted manifest output.

## Goal Oracle

The oracle for this goal is:

`/goal` produces a concise research recommendation backed by `mcp__grep` evidence and primary model sources, with a default model/runtime choice, fallback tiers, and a small eval plan for boundary classification.

The PM must keep comparing task receipts to this oracle. Planning alone is not enough. The goal finishes only when a final Judge/PM audit records `full_outcome_complete: true`.

## Goal Kind

`specific`

## Current Tranche

Complete the model-selection research tranche only. Do not implement model integration yet unless a later Worker task is explicitly approved.

## Non-Negotiable Constraints

- Default must be local/offline friendly for an OSS framework.
- Must run on most developer hardware with fast responses.
- Must be reasonably code-aware.
- Must classify structured boundary candidates generated from Yuku AST and recursive import analysis.
- Must not put live nondeterministic model output in the compiler/build step; only persisted manifest decisions are consumed.
- Prefer concrete `mcp__grep` evidence from real repos plus primary model cards/docs over generic model-list articles.

## Stop Rule

Stop only when the research recommendation is source-backed and audited against the constraints above.

## Canonical Board

Machine truth lives at:

`docs/goals/local-boundary-model-research/state.yaml`

## Run Command

```text
/goal Follow docs/goals/local-boundary-model-research/goal.md.
```
