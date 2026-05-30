# Markerless Closure Extraction POC

This proof of concept tests whether normal TSX can be parsed into an AST, condensed into model-readable facts, and used to infer callback execution boundaries without explicit callback/QRL markers in user code.

The demo uses Yuku parser for TSX/JSX parsing across a generated React app under `demo/react-app`. The intended architecture is parser-first: as source changes, Yuku gives the compiler a real AST, the compiler extracts closures and condensed AST facts, and a local model proposes whitelist metadata. The build/report step consumes only the persisted manifest, not live model output.

## Why This Exists

Modern compiler-driven frameworks need to know which closures can be extracted, lazy-loaded, resumed, or moved across execution boundaries. That part is deterministic once the boundary is known: parse the source, extract the closure, compute captures, generate a symbol, and emit errors for unserializable state.

The hard part is author intent across files. A compiler can see that `App.tsx` passes `onSave={() => ...}` into `Toolbar`, and it can see that `Toolbar` eventually forwards `onSave` into `ToolbarButton`. What it cannot reliably know in the general case is whether that prop is intended to be a resumable event boundary, a render callback, a server boundary, a resource boundary, or just an ordinary function prop in a design-system abstraction. The syntax is often the same; the intent is encoded in library conventions and cross-file usage.

Frameworks solve this today with manual compiler hints:

- Qwik uses `$`/QRL conventions such as `component$`, `useTask$`, and event props like `onClick$` so the compiler knows what to extract.
- Server/client frameworks use special exports, special filenames, route conventions, directives, or wrapper APIs such as `server$`.
- DSLs or language extensions can add keywords or decorators, but that creates more cases the compiler and author both have to understand.

Those hints work because they make intent explicit. The tradeoff is that developers must carry framework-specific markers through code that otherwise looks like normal JSX.

This POC explores a different split:

```txt
compiler:
  parse TSX/JSX with Yuku
  extract and identify closure candidates
  emit condensed AST facts
  consume accepted manifest metadata deterministically

local model:
  read condensed AST facts
  infer cross-file callback intent
  propose whitelist/manifest entries
  stay out of the production build path
```

The important claim is not "AI compiles the app." The claim is: **AI-inferred metadata, deterministic compilation**.

The model is a boundary discovery tool. The compiler remains responsible for deterministic extraction and build output.

## Run

```sh
pnpm install
pnpm poc
```

`pnpm poc` reads the TSX files under `demo/react-app/src`, writes `closure-boundaries.json`, prints the extractable closures, and runs verification assertions.

## Local Gemma Inference

The live local inference path uses Ollama with `gemma4:e2b` by default:

```sh
ollama pull gemma4:e2b
pnpm ollama:smoke
pnpm bench:ollama
```

`pnpm ollama:smoke` sends a Yuku-derived condensed AST packet to Gemma 4 E2B and verifies that the model returns manifest patches for all seven closure target props in `App.tsx`.

`pnpm bench:ollama` repeats the same request and prints wall time plus Ollama's prompt/output token rates. Override the model or run count with:

```sh
OLLAMA_MODEL=qwen2.5-coder:1.5b pnpm ollama:smoke
OLLAMA_RUNS=5 pnpm bench:ollama
```

Gemma 4 needs `think: false` on the Ollama chat request for this JSON classifier path. Without it, the model can spend the response budget in `message.thinking` and leave `message.content` empty.

## Tests

```sh
pnpm test
```

The deterministic tests validate the condensed AST request shape and the Ollama client contract without requiring a live model.

Expected manifest:

```json
{
  "components": {
    "Button": {
      "props": {
        "onPress": "event"
      }
    },
    "ConfirmDialog": {
      "props": {
        "onCancel": "event",
        "onConfirm": "event"
      }
    },
    "DialogActions": {
      "props": {
        "onPrimary": "event",
        "onSecondary": "event"
      }
    },
    "FormPanel": {
      "props": {
        "onReset": "event",
        "onSubmit": "event"
      }
    },
    "Toolbar": {
      "props": {
        "onPublish": "event",
        "onSave": "event"
      }
    },
    "ToolbarButton": {
      "props": {
        "onActivate": "event"
      }
    }
  }
}
```

This manifest is the contract between inference and compilation. A watch-mode tool may update or propose changes to it, but a production build should treat it like normal source-controlled metadata.

## Scope

- Uses normal TSX/JSX.
- Uses Yuku parser to create ASTs for a React app-shaped source tree.
- Produces condensed cross-file evidence: `src/App.tsx` imports `Button`, `Toolbar`, `ConfirmDialog`, and `FormPanel`.
- Finds candidate boundary surfaces from the Yuku JSX AST, such as `button.onClick` inside `Button.tsx` and `form.onSubmit` inside `FormPanel.tsx`.
- Covers direct, multi-hop, same-file, and form boundary examples.
- Reports seven extractable callback closures in `App.tsx` from the persisted manifest.
- Includes a pluggable classifier interface with deterministic mock fixture output for ambiguous cases.
- Does not build a framework, runtime layer, TSRX parser, or resumability system.
