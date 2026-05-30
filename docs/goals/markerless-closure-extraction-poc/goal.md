# Markerless Closure Extraction POC

## Objective

Build a narrow proof of concept for an AI-inferred compiler pipeline that removes explicit callback/QRL markers from normal TSX user code by generating a deterministic boundary manifest and reporting extractable closures from that manifest.

## Original Request

Prepare and execute a GoalBuddy run for `markerless-closure-extraction`: create a Scout/Judge/Worker board, then build a POC where `pnpm poc` reads a generated React TSX demo across files, infers `Button.onPress = event` from `button.onClick` in `Button.tsx`, writes `closure-boundaries.json`, reports extractable closures in `App.tsx`, and verifies the pipeline end to end.

## Intake Summary

- Input shape: `existing_plan`
- Audience: project author evaluating whether inferred boundary manifest generation is viable before building a full framework.
- Authority: `requested`
- Proof type: `demo`
- Completion proof: a fresh clone/install can run one documented command, `pnpm poc`, and see `closure-boundaries.json` generated from a cross-file React TSX demo with `Button.onPress = event`, with no explicit marker in the source callback.
- Goal oracle: `pnpm poc` succeeds from the repo root, parses multiple TSX files with Yuku, writes the manifest deterministically, prints discovered closures and boundary kind, and runs a minimal verification test that asserts the manifest and closure report.
- Likely misfire: building resumability, TSRX, a new runtime, or a broad framework instead of proving inferred boundary manifest generation on normal TSX/JSX.
- Blind spots considered: empty repo shape, dependency availability, keeping compiler/build deterministic by consuming persisted manifest rather than live model output, and distinguishing static inference from pluggable classifier fallback.
- Existing plan facts: use normal TSX/JSX; use Yuku parser for TSX/JSX AST creation; demonstrate cross-file analysis; do not build full framework or full resumability; do not start with TSRX; React is acceptable for this demo shape; keep framework-agnostic where possible; collect AST candidates before classifier labeling; add pluggable classifier with deterministic mock fixture; persist manifest before transform/report; provide one documented command.

## Goal Oracle

The oracle for this goal is:

`pnpm poc` exits successfully from the repository root and proves the end-to-end POC: read a generated React TSX demo across files, use Yuku to produce TSX/JSX ASTs, collect `button.onClick` in `Button.tsx` as a candidate boundary surface, persist a classifier whitelist that propagates `Button.onPress -> button.onClick`, write deterministic `closure-boundaries.json`, print extractable closures in `App.tsx` with boundary kind, and run verification that asserts the generated manifest includes `Button.onPress = event` without explicit source callback markers.

The PM must keep comparing task receipts to this oracle. Planning, discovery, a passing tiny slice, or a clean-looking board is not enough. The goal finishes only when a final Judge/PM audit maps receipts and verification back to this oracle and records `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Complete the full first POC milestone in this repo. The current reversible local work package is a minimal TypeScript CLI package with a generated React TSX demo under `demo/react-app`, Yuku project parsing, cross-file component/import analysis, deterministic mock classifier interface, manifest writer, closure reporter, verification test, README command, and `pnpm poc` script.

## Non-Negotiable Constraints

- Do not build a full framework.
- Do not implement full resumability.
- Do not start with TSRX.
- Use normal TSX/JSX.
- Keep the POC framework-agnostic unless a demo runtime becomes necessary.
- The compiler/build/report step must not depend on live nondeterministic model output; it may consume only persisted manifest data.
- Use deterministic static analysis for obvious cases before invoking the mock classifier.
- If classifier fallback is used, it must be deterministic and fixture-backed.
- Preserve `state.yaml` as board truth.

## Stop Rule

Stop only when a final audit proves the full original outcome is complete.

Do not stop after planning, discovery, or Judge selection if a safe Worker task can be activated.

Do not stop after a single verified Worker package when the broader owner outcome still has safe local follow-up work. Advance the board to the next highest-leverage safe Worker package and continue unless a phase, risk, rejected-verification, ambiguity, or final-completion review is due.

## Slice Sizing

Safe means bounded, explicit, verified, and reversible. It does not mean tiny.

A good task is the largest safe useful slice.

Small is not the goal. Useful is the goal.

A Worker should finish the whole assigned slice. A Judge should judge the whole assigned slice. A PM should reorient the board when tasks are safe but not moving the outcome.

## Canonical Board

Machine truth lives at:

`docs/goals/markerless-closure-extraction-poc/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status, active task, receipts, verification freshness, and completion truth.

## Run Command

```text
/goal Follow docs/goals/markerless-closure-extraction-poc/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter.
2. Read `state.yaml`.
3. Run the bundled GoalBuddy update checker when available and mention a newer version without blocking.
4. Re-check the intake: original request, input shape, authority, proof, blind spots, existing plan facts, and likely misfire.
5. Work only on the active board task.
6. Assign Scout, Judge, Worker, or PM according to the task.
7. Write a compact task receipt.
8. Update the board.
9. If safe local work remains, choose the next largest reversible Worker package and continue unless blocked.
10. Review at phase, risk, rejected-verification, ambiguity, or final-completion boundaries; do not review every small Worker by habit.
11. Finish only with a Judge/PM audit receipt that maps receipts and verification back to the original user outcome and records `full_outcome_complete: true`.
