---
name: js-path-url-regex-hygiene
description: Use when editing JavaScript or TypeScript that handles filesystem paths, import specifiers, URLs, route-like strings, evidence paths, or regular expressions. Prefer minimal path handling, structured data over encoded strings, pathe for necessary path operations, ufo for URL/query/pathname work, and magic-regexp when a regular expression is genuinely needed.
---

# JS Path URL Regex Hygiene

## Core Rule

Do as little path handling as reasonably possible. Prefer carrying structured values through the system over encoding meaning into strings and parsing it back out.

Use path/URL/regex tools only at clear boundaries:

- Use `pathe` for filesystem paths, import-like paths, extensions, directory names, joins, relatives, and normalized slash behavior.
- Use `ufo` for URLs, URL paths, query strings, route-like strings, and safe path joining when the value is URL-shaped rather than filesystem-shaped.
- Use `magic-regexp` only when a regex is the right tool and a parser/structured helper is not available.
- Avoid raw `RegExp` literals. Use them only when the project cannot add `magic-regexp` or existing local style already requires raw regex.

Do not normalize paths or structured evidence with chains like:

```js
String(value).split("->").map((part) => part.trim().replace(/^c:[^:]+:/, ""))
```

That mixes tokenization, path parsing, prefix handling, and validation in one fragile string pipeline. Prefer not creating that encoded string in the first place.

## Minimal Path Handling Policy

Prefer data shapes like:

```js
{
  kind: "component-prop",
  file: "src/Toolbar.tsx",
  component: "Toolbar",
  prop: "onSave"
}
```

over encoded strings like:

```txt
c:src/Toolbar.tsx:Toolbar.onSave
```

Rules:

- Keep `file`, `component`, `prop`, `exportName`, `localName`, and `kind` as separate fields for as long as possible.
- Use stable IDs only when needed for caches, logs, snapshots, or model evidence references.
- Build display strings at output boundaries, not in core data flow.
- Avoid parsing display strings back into data. If parsing is necessary, isolate it in one tested helper.
- Normalize file paths once near IO/import resolution. Do not repeatedly normalize in business logic.
- For model prompts, prefer structured JSON evidence over path-like mini-languages.

## Workflow

1. Identify the domain of the value before editing:
   - filesystem/import path: `pathe`
   - URL/query/pathname/route string: `ufo`
   - symbolic identifier/evidence token: structured fields first; small named helpers only at boundaries
   - truly pattern-based text: `magic-regexp`
2. Check whether the repo already depends on `pathe`, `ufo`, or `magic-regexp`.
3. If missing, add the narrow dependency that matches the domain.
4. Remove unnecessary path parsing by changing data flow to structured fields when reasonable.
5. Replace remaining ad hoc parsing with named helpers that make each step explicit.
6. Add tests for valid input, malformed input, and ambiguous input.

## Dependency Guidance

Use package imports like:

```js
import { basename, dirname, extname, join, normalize, relative, resolve } from "pathe";
import { joinURL, parseURL, withQuery, withoutTrailingSlash } from "ufo";
```

For `magic-regexp`, check the installed package docs/API and import only the builders actually used by the file.

If the project intentionally avoids dependencies, keep a small local helper, but still minimize encoded strings and separate concerns into named parsing steps and tests.

## Evidence Path Pattern

Avoid evidence paths such as:

```txt
c:src/Toolbar.tsx:Toolbar.onSave->c:src/ToolbarButton.tsx:ToolbarButton.onActivate->button.onClick
```

Prefer structured evidence:

```js
[
  {
    kind: "component-prop",
    file: "src/Toolbar.tsx",
    component: "Toolbar",
    prop: "onSave"
  },
  {
    kind: "component-prop",
    file: "src/ToolbarButton.tsx",
    component: "ToolbarButton",
    prop: "onActivate"
  },
  {
    kind: "host-prop",
    tag: "button",
    prop: "onClick"
  }
]
```

When forced to parse legacy evidence strings:

- Split only on the explicit evidence separator.
- Parse evidence segments with a named helper.
- Use `pathe` only for the source path part, and only if the parsed file path is actually consumed.
- Validate symbolic references separately from file paths.
- Return only normalized symbolic references such as `Toolbar.onSave`.

Recommended shape:

```js
import { normalize as normalizePath } from "pathe";

const EVIDENCE_SEPARATOR = "->";

function normalizeEvidencePath(value) {
  return evidenceSegments(value).flatMap((segment) => {
    const parsed = parseEvidenceSegment(segment);
    return parsed.reference ? [parsed.reference] : [];
  });
}

function evidenceSegments(value) {
  return Array.isArray(value)
    ? value.flatMap((part) => String(part).split(EVIDENCE_SEPARATOR))
    : [];
}

function parseEvidenceSegment(segment) {
  const trimmed = String(segment).trim();
  if (!trimmed) {
    return { reference: null };
  }

  if (trimmed.startsWith("c:")) {
    return parseComponentEvidence(trimmed);
  }

  return {
    reference: isSymbolReference(trimmed) ? trimmed : null
  };
}

function parseComponentEvidence(segment) {
  const withoutPrefix = segment.slice("c:".length);
  const separatorIndex = withoutPrefix.lastIndexOf(":");
  if (separatorIndex < 0) {
    return { reference: null };
  }

  const file = normalizePath(withoutPrefix.slice(0, separatorIndex));
  const reference = withoutPrefix.slice(separatorIndex + 1);
  return {
    file,
    reference: isSymbolReference(reference) ? reference : null
  };
}
```

If `isSymbolReference` needs complex regex validation, prefer `magic-regexp`, but check the installed package docs/API before writing the expression. Keep the pattern isolated behind a named helper and tests.

If the project cannot use `magic-regexp`, a raw regex must at least be named and isolated:

```js
const SYMBOL_REFERENCE_RE = /^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/;
```

Do not inline that regex inside `filter`, `map`, or `replace` chains.

## Review Checklist

Before finishing code that touches paths, URLs, or regexes:

- The design avoids path parsing where structured fields would work.
- Path handling uses `pathe` instead of Node `path` when cross-platform slash-stable behavior matters.
- URL handling uses `ufo` instead of manual string concatenation.
- Regexes are named, tested, and avoided when a parser or helper is clearer.
- Evidence/path parsing separates tokenization, prefix parsing, path normalization, and symbol validation.
- Malformed input returns `unknown`, `null`, or a diagnostic instead of silently producing a plausible wrong value.
