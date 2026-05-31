import { dirname, extname, join, normalize, relative, resolve } from "pathe";
import { langFromPath, parse, sourceTypeFromPath } from "yuku-parser";

const NODE_METADATA_KEYS = new Set([
  "type",
  "start",
  "end",
  "loc",
  "range",
  "comments",
  "raw",
  "value",
  "name",
  "optional",
  "computed"
]);

const AST_METADATA_KEYS = new Set(["type", "start", "end", "loc", "range", "comments", "raw"]);
const SOURCE_EXTENSIONS = [".tsx", ".jsx", ".ts", ".js"];
const GLOBAL_IDENTIFIERS = new Set([
  "AbortController",
  "Array",
  "Boolean",
  "Date",
  "Error",
  "IntersectionObserver",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "ResizeObserver",
  "Set",
  "String",
  "clearInterval",
  "clearTimeout",
  "console",
  "document",
  "requestAnimationFrame",
  "setInterval",
  "setTimeout",
  "window"
]);

export class DeterministicMockClassifier {
  constructor(fixtureDocument) {
    this.fixtures = new Map();
    for (const fixture of fixtureDocument.fixtures ?? []) {
      this.fixtures.set(fixture.id, fixture.output);
    }
  }

  classifyBoundary(candidate) {
    const id = candidate.id ?? `component-prop:${candidate.component}:${candidate.prop}`;
    const output = this.fixtures.get(id);
    if (!output) {
      return { kind: "unknown", confidence: "none" };
    }
    return { ...output };
  }
}

export function parseSource(filename, source) {
  const result = parse(source, {
    lang: langFromPath(filename),
    sourceType: sourceTypeFromPath(filename)
  });
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length > 0) {
    const message = errors
      .map((diagnostic) => `${diagnostic.message} at ${diagnostic.start}..${diagnostic.end}`)
      .join("\n");
    throw new Error(`Yuku parser reported errors in ${filename}:\n${message}`);
  }
  return result;
}

export function parseProjectFiles(fileEntries, rootDir) {
  return fileEntries
    .map((entry) => {
      const absolutePath = resolve(entry.filename);
      return {
        filename: normalize(relative(rootDir, absolutePath)),
        absolutePath,
        source: entry.source,
        parseResult: parseSource(absolutePath, entry.source)
      };
    })
    .sort((left, right) => left.filename.localeCompare(right.filename));
}

export function inferBoundaryManifestForProject(project, classifier = new DeterministicMockClassifier({})) {
  const graph = buildProjectGraph(project);
  const edges = collectBoundaryEdges(graph);
  const classifierDecisions = [];
  const boundaries = inferBoundariesFromEdges(edges, classifier, classifierDecisions);

  return {
    manifest: manifestFromBoundaries(boundaries),
    diagnostics: {
      parser: "yuku-parser",
      files: project.map((file) => file.filename),
      componentCount: graph.components.size,
      edgeCount: edges.length,
      astEdges: edges,
      classifierDecisions
    }
  };
}

export function createBoundaryInferenceRequest(project, options = {}) {
  const condensedAst = createCondensedAstForProject(project);
  const targetCandidateIds = options.candidateIds ?? condensedAst.candidates.map((candidate) => candidate.id);
  const allowedManifestTargets = condensedAst.candidates
    .filter((candidate) => targetCandidateIds.includes(candidate.id))
    .map((candidate) => ({
      id: candidate.id,
      component: candidate.targetComponent,
      prop: candidate.targetProp
    }));

  return {
    schemaVersion: 1,
    task: "infer-boundary-manifest-patch",
    parser: "yuku-parser",
    instructions: [
      "Use the condensed AST facts to recursively trace closure candidates across files.",
      "Lowercase JSX tags are host elements. Host on* attributes are event boundaries.",
      "For each targetCandidateId, add the candidate target component prop when its trace reaches a host on* boundary.",
      "Only output exact component/prop pairs from condensedAst.candidates whose id is in targetCandidateIds.",
      "Do not output the component that owns the closure unless that is also the candidate target.",
      "Do not output intermediate forwarded components unless they are target candidates.",
      "Return only a manifest patch for boundaries supported by the trace.",
      "Use unknown when the trace is missing, cyclic, or ambiguous.",
      "manifestPatch.components is add-only; leave it empty for unknown targets.",
      "If manifestPatch.components is non-empty, decision must be add_to_whitelist."
    ],
    targetCandidateIds,
    allowedManifestTargets,
    condensedAst
  };
}

export function createCondensedAstForProject(project) {
  const graph = buildProjectGraph(project);
  const propForwardingEdges = collectBoundaryEdges(graph);
  const closureSites = collectClosureSites(graph);
  const extractedClosures = collectExtractedClosures(graph);

  return {
    schemaVersion: 1,
    files: project.map((file) => condenseFile(graph, file)),
    propForwardingEdges,
    closureSites,
    extractedClosures,
    candidates: closureSites.map((site) => ({
      id: site.id,
      file: site.file,
      ownerComponent: site.component,
      target: `${site.targetComponent ?? site.targetTag}.${site.prop}`,
      targetComponent: site.targetComponent ?? site.targetTag,
      targetProp: site.prop,
      valueKind: site.valueKind,
      question: `Should closure ${site.id} add ${site.targetComponent ?? site.targetTag}.${site.prop} to the boundary manifest?`
    }))
  };
}

export function discoverExtractedClosuresInProject(project) {
  return collectExtractedClosures(buildProjectGraph(project));
}

export function discoverExtractableClosuresInProject(project, manifest) {
  const graph = buildProjectGraph(project);
  const reports = [];

  for (const component of graph.components.values()) {
    walk(component.node.body, (node) => {
      if (node.type !== "JSXElement") {
        return;
      }

      const tag = jsxNameToString(node.openingElement.name);
      const target = resolveJsxTarget(graph, component.file, tag);
      if (target.kind !== "component") {
        return;
      }

      const componentManifest = manifest.components?.[target.componentName];
      if (!componentManifest) {
        return;
      }

      for (const attribute of node.openingElement.attributes ?? []) {
        if (attribute.type !== "JSXAttribute") {
          continue;
        }

        const prop = jsxNameToString(attribute.name);
        const boundaryKind = componentManifest.props?.[prop];
        const expression = jsxAttributeExpression(attribute);
        if (!boundaryKind || !isClosureExpression(expression)) {
          continue;
        }

        reports.push({
          file: component.file.filename,
          component: component.name,
          target: `${target.componentName}.${prop}`,
          boundaryKind,
          loc: component.file.parseResult.locOf(expression.start),
          span: { start: expression.start, end: expression.end },
          source: component.file.source.slice(expression.start, expression.end)
        });
      }
    });
  }

  return reports.sort((left, right) => {
    const byFile = left.file.localeCompare(right.file);
    return byFile || left.span.start - right.span.start;
  });
}

export function stableJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function buildProjectGraph(project) {
  const filesByPath = new Map(project.map((file) => [file.absolutePath, file]));
  const modules = new Map();
  const components = new Map();

  for (const file of project) {
    const moduleInfo = {
      file,
      imports: collectImports(file.parseResult.program, file.absolutePath, filesByPath),
      exports: new Map()
    };
    modules.set(file.absolutePath, moduleInfo);

    for (const component of collectComponents(file)) {
      const key = componentKey(file.absolutePath, component.name);
      components.set(key, component);
      if (component.exported) {
        moduleInfo.exports.set(component.exportName, component.name);
      }
    }
  }

  return { files: project, modules, components };
}

function collectBoundaryEdges(graph) {
  const edges = [];

  for (const component of graph.components.values()) {
    const propBindings = collectPropBindings(component.node);
    walk(component.node.body, (node) => {
      if (node.type !== "JSXElement") {
        return;
      }

      const tag = jsxNameToString(node.openingElement.name);
      if (!tag) {
        return;
      }

      const target = resolveJsxTarget(graph, component.file, tag);
      for (const attribute of node.openingElement.attributes ?? []) {
        if (attribute.type !== "JSXAttribute") {
          continue;
        }

        const targetProp = jsxNameToString(attribute.name);
        const expression = jsxAttributeExpression(attribute);
        const sourceProp = propReference(expression, propBindings);
        if (!targetProp || !sourceProp) {
          continue;
        }

        edges.push({
          sourceFile: component.file.filename,
          component: component.name,
          prop: sourceProp,
          targetFile: target.file?.filename ?? null,
          targetTag: tag,
          targetComponent: target.componentName ?? null,
          targetProp,
          targetKind: target.kind,
          span: { start: attribute.start, end: attribute.end }
        });
      }
    });
  }

  return edges.sort((left, right) => {
    const byFile = left.sourceFile.localeCompare(right.sourceFile);
    const byComponent = byFile || left.component.localeCompare(right.component);
    return byComponent || left.span.start - right.span.start;
  });
}

function collectClosureSites(graph) {
  const closureSites = [];

  for (const component of graph.components.values()) {
    walk(component.node.body, (node) => {
      if (node.type !== "JSXElement") {
        return;
      }

      const tag = jsxNameToString(node.openingElement.name);
      if (!tag) {
        return;
      }

      const target = resolveJsxTarget(graph, component.file, tag);
      for (const attribute of node.openingElement.attributes ?? []) {
        if (attribute.type !== "JSXAttribute") {
          continue;
        }

        const prop = jsxNameToString(attribute.name);
        const expression = jsxAttributeExpression(attribute);
        if (!prop || !isClosureExpression(expression)) {
          continue;
        }

        closureSites.push({
          id: `closure:${component.file.filename}:${expression.start}:${expression.end}`,
          file: component.file.filename,
          component: component.name,
          targetTag: tag,
          targetKind: target.kind,
          targetComponent: target.componentName ?? null,
          targetFile: target.file?.filename ?? null,
          prop,
          valueKind: expression.type,
          loc: component.file.parseResult.locOf(expression.start),
          span: { start: expression.start, end: expression.end },
          source: component.file.source.slice(expression.start, expression.end)
        });
      }
    });
  }

  return closureSites.sort((left, right) => {
    const byFile = left.file.localeCompare(right.file);
    return byFile || left.span.start - right.span.start;
  });
}

function collectExtractedClosures(graph) {
  const closures = [];

  for (const component of graph.components.values()) {
    walkAst(component.node.body, (node, ancestors) => {
      if (!isClosureExpression(node)) {
        return;
      }

      const context = describeClosureContext(graph, component, node, ancestors);
      const source = component.file.source.slice(node.start, node.end);
      closures.push({
        id: `closure:${component.file.filename}:${node.start}:${node.end}`,
        symbol: stableClosureSymbol(component, context, source),
        file: component.file.filename,
        component: component.name,
        valueKind: node.type,
        async: Boolean(node.async),
        context,
        captures: captureListForClosure(node),
        loc: component.file.parseResult.locOf(node.start),
        span: { start: node.start, end: node.end },
        source
      });
    });
  }

  return closures.sort((left, right) => {
    const byFile = left.file.localeCompare(right.file);
    return byFile || left.span.start - right.span.start;
  });
}

function describeClosureContext(graph, component, node, ancestors) {
  const directParent = ancestors.at(-1);
  const jsxAttribute = ancestors.findLast((ancestor) => ancestor.type === "JSXAttribute");
  const jsxElement = ancestors.findLast((ancestor) => ancestor.type === "JSXElement");
  if (jsxAttribute && jsxElement && jsxAttributeExpression(jsxAttribute) === node) {
    const tag = jsxNameToString(jsxElement.openingElement.name);
    const target = resolveJsxTarget(graph, component.file, tag);
    return {
      kind: "jsx-attribute",
      tag,
      prop: jsxNameToString(jsxAttribute.name),
      targetKind: target.kind,
      targetComponent: target.componentName ?? null,
      targetFile: target.file?.filename ?? null
    };
  }

  if (directParent?.type === "VariableDeclarator" && directParent.init === node) {
    return {
      kind: "variable-init",
      bindingName: bindingIdentifierName(directParent.id)
    };
  }

  if (directParent?.type === "Property" && directParent.value === node) {
    return {
      kind: "object-property",
      property: propertyName(directParent.key)
    };
  }

  if (directParent?.type === "ReturnStatement" && directParent.argument === node) {
    return { kind: "return-value" };
  }

  const callExpression = ancestors.findLast((ancestor) => {
    return ancestor.type === "CallExpression" && (ancestor.arguments ?? []).includes(node);
  });
  if (callExpression) {
    return {
      kind: "call-argument",
      callee: expressionName(callExpression.callee),
      argumentIndex: callExpression.arguments.indexOf(node)
    };
  }

  return { kind: "unknown" };
}

function stableClosureSymbol(component, context, source) {
  return `closure_${stableHash(
    JSON.stringify({
      file: component.file.filename,
      component: component.name,
      context: sortJson(context),
      source
    })
  )}`;
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function captureListForClosure(closure) {
  const localBindings = new Set();
  collectPatternBindings(closure.id, localBindings);
  for (const param of closure.params ?? []) {
    collectPatternBindings(param, localBindings);
  }

  walkAst(closure.body, (node, ancestors) => {
    collectDeclaredBindings(node, localBindings);
  });

  const references = new Set();
  walkAst(closure.body, (node, ancestors) => {
    if (node.type !== "Identifier" || !isIdentifierReference(node, ancestors)) {
      return;
    }
    if (!localBindings.has(node.name) && !GLOBAL_IDENTIFIERS.has(node.name)) {
      references.add(node.name);
    }
  });

  return [...references].sort();
}

function collectDeclaredBindings(node, bindings) {
  if (node.type === "VariableDeclarator") {
    collectPatternBindings(node.id, bindings);
  } else if (node.type === "FunctionDeclaration") {
    collectPatternBindings(node.id, bindings);
    for (const param of node.params ?? []) {
      collectPatternBindings(param, bindings);
    }
  } else if (isClosureExpression(node)) {
    collectPatternBindings(node.id, bindings);
    for (const param of node.params ?? []) {
      collectPatternBindings(param, bindings);
    }
  }
}

function collectPatternBindings(node, bindings) {
  if (!node) {
    return;
  }

  if (node.type === "Identifier") {
    bindings.add(node.name);
    return;
  }

  if (node.type === "AssignmentPattern") {
    collectPatternBindings(node.left, bindings);
    return;
  }

  if (node.type === "RestElement") {
    collectPatternBindings(node.argument, bindings);
    return;
  }

  if (node.type === "ObjectPattern") {
    for (const property of node.properties ?? []) {
      if (property.type === "Property") {
        collectPatternBindings(property.value, bindings);
      } else if (property.type === "RestElement") {
        collectPatternBindings(property.argument, bindings);
      }
    }
    return;
  }

  if (node.type === "ArrayPattern") {
    for (const element of node.elements ?? []) {
      collectPatternBindings(element, bindings);
    }
  }
}

function isIdentifierReference(node, ancestors) {
  const parent = ancestors.at(-1);
  if (!parent) {
    return true;
  }

  if (parent.type === "VariableDeclarator" && parent.id === node) {
    return false;
  }
  if (parent.type === "FunctionDeclaration" && parent.id === node) {
    return false;
  }
  if ((parent.type === "FunctionExpression" || parent.type === "ArrowFunctionExpression") && parent.id === node) {
    return false;
  }
  if ((parent.type === "FunctionExpression" || parent.type === "ArrowFunctionExpression") && (parent.params ?? []).includes(node)) {
    return false;
  }
  if (parent.type === "Property" && parent.key === node && !parent.computed) {
    return false;
  }
  if (parent.type === "MemberExpression" && parent.property === node && !parent.computed) {
    return false;
  }
  if (parent.type === "ImportSpecifier" || parent.type === "ImportDefaultSpecifier" || parent.type === "ImportNamespaceSpecifier") {
    return false;
  }
  if (parent.type?.startsWith("TS")) {
    return false;
  }

  return !ancestors.some((ancestor, index) => {
    const child = index === ancestors.length - 1 ? node : ancestors[index + 1];
    return ancestor.type === "Property" && ancestor.key === child && !ancestor.computed;
  });
}

function condenseFile(graph, file) {
  const moduleInfo = graph.modules.get(file.absolutePath);
  const components = [...graph.components.values()]
    .filter((component) => component.file.absolutePath === file.absolutePath)
    .map((component) => condenseComponent(graph, component));

  return {
    path: file.filename,
    imports: [...(moduleInfo?.imports ?? new Map()).entries()].map(([localName, imported]) => ({
      localName,
      from: graph.modules.get(imported.modulePath)?.file.filename ?? null,
      exportName: imported.exportName
    })),
    exports: [...(moduleInfo?.exports ?? new Map()).entries()].map(([exportName, localName]) => ({
      exportName,
      localName
    })),
    components
  };
}

function condenseComponent(graph, component) {
  const propBindings = collectPropBindings(component.node);
  const jsxElements = [];

  walk(component.node.body, (node) => {
    if (node.type !== "JSXElement") {
      return;
    }

    const tag = jsxNameToString(node.openingElement.name);
    if (!tag) {
      return;
    }

    const target = resolveJsxTarget(graph, component.file, tag);
    jsxElements.push({
      tag,
      targetKind: target.kind,
      targetComponent: target.componentName ?? null,
      targetFile: target.file?.filename ?? null,
      attributes: (node.openingElement.attributes ?? [])
        .filter((attribute) => attribute.type === "JSXAttribute")
        .map((attribute) => condenseJsxAttribute(component.file, attribute, propBindings))
    });
  });

  return {
    name: component.name,
    exported: component.exported,
    exportName: component.exportName,
    props: [...propBindings.entries()].map(([bindingName, binding]) => ({
      bindingName,
      kind: binding.kind,
      prop: binding.prop ?? null
    })),
    jsxElements
  };
}

function condenseJsxAttribute(file, attribute, propBindings) {
  const expression = jsxAttributeExpression(attribute);
  const record = {
    name: jsxNameToString(attribute.name),
    valueKind: expression?.type ?? attribute.value?.type ?? "boolean",
    propReference: propReference(expression, propBindings),
    span: { start: attribute.start, end: attribute.end }
  };

  if (isClosureExpression(expression)) {
    record.closure = {
      valueKind: expression.type,
      source: file.source.slice(expression.start, expression.end)
    };
  }

  return record;
}

function collectComponents(file) {
  const components = [];

  for (const statement of file.parseResult.program.body) {
    if (statement.type === "FunctionDeclaration" && statement.id?.name) {
      components.push(componentRecord(file, statement.id.name, statement, false, statement.id.name));
      continue;
    }

    if (statement.type === "ExportNamedDeclaration" && statement.declaration) {
      const named = declarationComponent(statement.declaration);
      if (named) {
        components.push(componentRecord(file, named.name, named.node, true, named.name));
      }
      continue;
    }

    if (statement.type === "ExportDefaultDeclaration") {
      const named = declarationComponent(statement.declaration);
      if (named) {
        components.push(componentRecord(file, named.name, named.node, true, "default"));
      }
    }
  }

  return components;
}

function collectImports(program, absolutePath, filesByPath) {
  const imports = new Map();

  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || typeof statement.source?.value !== "string") {
      continue;
    }

    const modulePath = resolveImportPath(absolutePath, statement.source.value, filesByPath);
    if (!modulePath) {
      continue;
    }

    for (const specifier of statement.specifiers ?? []) {
      if (specifier.type === "ImportSpecifier") {
        imports.set(specifier.local.name, {
          modulePath,
          exportName: importedName(specifier.imported)
        });
      } else if (specifier.type === "ImportDefaultSpecifier") {
        imports.set(specifier.local.name, {
          modulePath,
          exportName: "default"
        });
      }
    }
  }

  return imports;
}

function resolveJsxTarget(graph, file, tag) {
  if (!tag) {
    return { kind: "unknown" };
  }

  if (isHostJsxTag(tag)) {
    return { kind: "host", tag };
  }

  const localKey = componentKey(file.absolutePath, tag);
  const localComponent = graph.components.get(localKey);
  if (localComponent) {
    return {
      kind: "component",
      componentName: localComponent.name,
      file: localComponent.file
    };
  }

  const imported = graph.modules.get(file.absolutePath)?.imports.get(tag);
  if (imported) {
    const targetModule = graph.modules.get(imported.modulePath);
    const componentName = targetModule?.exports.get(imported.exportName) ?? imported.exportName;
    const component = graph.components.get(componentKey(imported.modulePath, componentName));
    if (component) {
      return {
        kind: "component",
        componentName: component.name,
        file: component.file
      };
    }
  }

  return { kind: "component", componentName: tag, file: null };
}

function isHostJsxTag(tag) {
  return typeof tag === "string" && tag.length > 0 && isAsciiLowercaseCode(tag.charCodeAt(0));
}

function isAsciiLowercaseCode(code) {
  return code >= 97 && code <= 122;
}

function inferBoundariesFromEdges(edges, classifier, classifierDecisions) {
  const boundaries = new Map();
  let changed = true;

  while (changed) {
    changed = false;
    for (const edge of edges) {
      let kind = null;
      let reason = null;
      let evidence = null;

      if (edge.targetKind === "host") {
        const candidate = {
          id: `jsx-attribute:${edge.targetTag}:${edge.targetProp}`,
          file: edge.sourceFile,
          tag: edge.targetTag,
          attribute: edge.targetProp,
          propagatedTo: `${edge.component}.${edge.prop}`,
          reason: "Yuku AST shows a component prop is wired into this host JSX attribute."
        };
        const decision = classifier.classifyBoundary(candidate);
        classifierDecisions.push({ candidate, decision });
        if (decision.kind !== "unknown") {
          kind = decision.kind;
          reason = `classifier ${candidate.id}`;
          evidence = [`${edge.component}.${edge.prop}`, `${edge.targetTag}.${edge.targetProp}`];
        }
      } else if (edge.targetKind === "component" && edge.targetComponent) {
        const propagated = boundaries.get(boundaryKey(edge.targetComponent, edge.targetProp));
        if (propagated) {
          kind = propagated.kind;
          reason = `${edge.targetComponent}.${edge.targetProp}`;
          evidence = [`${edge.component}.${edge.prop}`, ...propagated.evidence];
        }
      }

      if (!kind) {
        continue;
      }

      const key = boundaryKey(edge.component, edge.prop);
      if (!boundaries.has(key)) {
        boundaries.set(key, {
          component: edge.component,
          prop: edge.prop,
          kind,
          reason,
          evidence
        });
        changed = true;
      }
    }
  }

  return boundaries;
}

function collectPropBindings(functionNode) {
  const bindings = new Map();
  const firstParam = functionNode.params?.[0];
  if (!firstParam) {
    return bindings;
  }

  if (firstParam.type === "Identifier") {
    bindings.set(firstParam.name, { kind: "propsObject" });
    return bindings;
  }

  if (firstParam.type === "ObjectPattern") {
    for (const property of firstParam.properties ?? []) {
      if (property.type !== "Property") {
        continue;
      }

      const propName = propertyName(property.key);
      const bindingName = bindingIdentifierName(property.value);
      if (propName && bindingName) {
        bindings.set(bindingName, { kind: "prop", prop: propName });
      }
    }
  }

  return bindings;
}

function manifestFromBoundaries(boundaries) {
  const manifest = { components: {} };
  const sorted = [...boundaries.values()].sort((left, right) => {
    const byComponent = left.component.localeCompare(right.component);
    return byComponent || left.prop.localeCompare(right.prop);
  });

  for (const boundary of sorted) {
    manifest.components[boundary.component] ??= { props: {} };
    manifest.components[boundary.component].props[boundary.prop] = boundary.kind;
    manifest.components[boundary.component].evidence ??= {};
    manifest.components[boundary.component].evidence[boundary.prop] = boundary.evidence;
  }

  return manifest;
}

function declarationComponent(node) {
  if (!node) {
    return null;
  }

  if (node.type === "FunctionDeclaration" && node.id?.name) {
    return { name: node.id.name, node };
  }

  if (node.type === "VariableDeclaration") {
    for (const declarator of node.declarations ?? []) {
      if (
        declarator.id?.type === "Identifier" &&
        (declarator.init?.type === "ArrowFunctionExpression" || declarator.init?.type === "FunctionExpression")
      ) {
        return {
          name: declarator.id.name,
          node: {
            ...declarator.init,
            id: declarator.id,
            params: declarator.init.params,
            body: declarator.init.body
          }
        };
      }
    }
  }

  return null;
}

function componentRecord(file, name, node, exported, exportName) {
  return {
    file,
    name,
    node,
    exported,
    exportName
  };
}

function propReference(expression, propBindings) {
  if (!expression) {
    return null;
  }

  if (expression.type === "Identifier") {
    const binding = propBindings.get(expression.name);
    return binding?.kind === "prop" ? binding.prop : null;
  }

  if (
    expression.type === "MemberExpression" &&
    expression.object?.type === "Identifier" &&
    !expression.computed &&
    expression.property?.type === "Identifier"
  ) {
    const binding = propBindings.get(expression.object.name);
    return binding?.kind === "propsObject" ? expression.property.name : null;
  }

  if (expression.type === "ParenthesizedExpression" || expression.type === "TSNonNullExpression") {
    return propReference(expression.expression, propBindings);
  }

  return null;
}

function jsxAttributeExpression(attribute) {
  const value = attribute.value;
  if (!value || value.type !== "JSXExpressionContainer") {
    return null;
  }
  if (!value.expression || value.expression.type === "JSXEmptyExpression") {
    return null;
  }
  return value.expression;
}

function jsxNameToString(name) {
  if (!name) {
    return null;
  }

  if (name.type === "JSXIdentifier" || name.type === "Identifier") {
    return name.name;
  }

  if (name.type === "JSXNamespacedName") {
    return `${jsxNameToString(name.namespace)}:${jsxNameToString(name.name)}`;
  }

  if (name.type === "JSXMemberExpression") {
    return `${jsxNameToString(name.object)}.${jsxNameToString(name.property)}`;
  }

  return null;
}

function resolveImportPath(fromFile, specifier, filesByPath) {
  if (!specifier.startsWith(".")) {
    return null;
  }

  const base = resolve(dirname(fromFile), specifier);
  const candidates = extname(base)
    ? [base]
    : SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`).concat(SOURCE_EXTENSIONS.map((extension) => join(base, `index${extension}`)));

  return candidates.find((candidate) => filesByPath.has(candidate)) ?? null;
}

function importedName(node) {
  if (!node) {
    return null;
  }
  if (node.type === "Identifier") {
    return node.name;
  }
  if (node.type === "Literal") {
    return String(node.value);
  }
  return null;
}

function expressionName(node) {
  if (!node) {
    return null;
  }

  if (node.type === "Identifier") {
    return node.name;
  }

  if (node.type === "MemberExpression") {
    const object = expressionName(node.object);
    const property = node.computed ? null : expressionName(node.property);
    return object && property ? `${object}.${property}` : object ?? property;
  }

  if (node.type === "ChainExpression") {
    return expressionName(node.expression);
  }

  return null;
}

function isClosureExpression(node) {
  return node?.type === "ArrowFunctionExpression" || node?.type === "FunctionExpression";
}

function propertyName(node) {
  if (!node) {
    return null;
  }
  if (node.type === "Identifier" || node.type === "Literal") {
    return String(node.name ?? node.value);
  }
  return null;
}

function bindingIdentifierName(node) {
  if (!node) {
    return null;
  }
  if (node.type === "Identifier") {
    return node.name;
  }
  if (node.type === "AssignmentPattern") {
    return bindingIdentifierName(node.left);
  }
  return null;
}

function componentKey(absolutePath, name) {
  return `${absolutePath}#${name}`;
}

function boundaryKey(component, prop) {
  return `${component}.${prop}`;
}

function walk(node, enter, parent = null) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      walk(item, enter, parent);
    }
    return;
  }

  if (typeof node.type === "string") {
    enter(node, parent);
  }

  for (const [key, value] of Object.entries(node)) {
    if (NODE_METADATA_KEYS.has(key)) {
      continue;
    }
    walk(value, enter, node);
  }
}

function walkAst(node, enter, ancestors = []) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      walkAst(item, enter, ancestors);
    }
    return;
  }

  if (typeof node.type === "string") {
    enter(node, ancestors);
  }

  const nextAncestors = typeof node.type === "string" ? ancestors.concat(node) : ancestors;
  for (const [key, value] of Object.entries(node)) {
    if (AST_METADATA_KEYS.has(key)) {
      continue;
    }
    walkAst(value, enter, nextAncestors);
  }
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sorted = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = sortJson(value[key]);
  }
  return sorted;
}
