import { join, resolve } from "node:path";
import {
  createBoundaryInferenceRequest,
  discoverExtractableClosuresInProject,
  inferBoundaryManifestForProject,
  parseProjectFiles
} from "./pipeline.mjs";

export const SCENARIOS = [
  {
    id: "01-direct-host-event",
    title: "Direct host event",
    level: "basic",
    description: "A component prop is wired directly into button.onClick.",
    files: {
      "src/App.tsx": `
type DirectButtonProps = {
  onPress: () => void;
};

export function DirectButton(props: DirectButtonProps) {
  return <button onClick={props.onPress}>Direct</button>;
}

export default function App() {
  return <DirectButton onPress={() => record("direct")} />;
}
`
    },
    expectedBoundaries: [{ component: "DirectButton", prop: "onPress", kind: "event" }],
    expectedClosures: ["DirectButton.onPress"]
  },
  {
    id: "02-destructured-prop",
    title: "Destructured prop",
    level: "basic",
    description: "A destructured callback prop is wired into a host click event.",
    files: {
      "src/App.tsx": `
type IconButtonProps = {
  onPress: () => void;
};

export function IconButton({ onPress }: IconButtonProps) {
  return <button onClick={onPress}>Icon</button>;
}

export default function App() {
  return <IconButton onPress={() => record("destructured")} />;
}
`
    },
    expectedBoundaries: [{ component: "IconButton", prop: "onPress", kind: "event" }],
    expectedClosures: ["IconButton.onPress"]
  },
  {
    id: "03-props-object",
    title: "Props object",
    level: "basic",
    description: "A props object member is wired into a host click event.",
    files: {
      "src/App.tsx": `
type PropsObjectButtonProps = {
  onPress: () => void;
};

export function PropsObjectButton(props: PropsObjectButtonProps) {
  return <button onClick={props.onPress}>Object prop</button>;
}

export default function App() {
  return <PropsObjectButton onPress={() => record("props-object")} />;
}
`
    },
    expectedBoundaries: [{ component: "PropsObjectButton", prop: "onPress", kind: "event" }],
    expectedClosures: ["PropsObjectButton.onPress"]
  },
  {
    id: "04-renamed-destructuring",
    title: "Renamed destructuring",
    level: "basic",
    description: "A destructured callback prop is renamed before it reaches a host event.",
    files: {
      "src/App.tsx": `
type RenamedButtonProps = {
  onPress: () => void;
};

export function RenamedButton({ onPress: handlePress }: RenamedButtonProps) {
  return <button onClick={handlePress}>Renamed</button>;
}

export default function App() {
  return <RenamedButton onPress={() => record("renamed")} />;
}
`
    },
    expectedBoundaries: [{ component: "RenamedButton", prop: "onPress", kind: "event" }],
    expectedClosures: ["RenamedButton.onPress"]
  },
  {
    id: "05-same-file-wrapper",
    title: "Same-file wrapper",
    level: "intermediate",
    description: "A wrapper component in the same file forwards a callback to a host event.",
    files: {
      "src/App.tsx": `
type SameFileButtonProps = {
  onTrigger: () => void;
};

function SameFileButton({ onTrigger }: SameFileButtonProps) {
  return <button onClick={onTrigger}>Same file</button>;
}

export default function App() {
  return <SameFileButton onTrigger={() => record("same-file")} />;
}
`
    },
    expectedBoundaries: [{ component: "SameFileButton", prop: "onTrigger", kind: "event" }],
    expectedClosures: ["SameFileButton.onTrigger"]
  },
  {
    id: "06-cross-file-wrapper",
    title: "Cross-file wrapper",
    level: "intermediate",
    description: "A callback crosses a local import before reaching a host event.",
    files: {
      "src/App.tsx": `
import { CrossFileButton } from "./CrossFileButton";

export default function App() {
  return <CrossFileButton onPress={() => record("cross-file")} />;
}
`,
      "src/CrossFileButton.tsx": `
type CrossFileButtonProps = {
  onPress: () => void;
};

export function CrossFileButton({ onPress }: CrossFileButtonProps) {
  return <button onClick={onPress}>Cross file</button>;
}
`
    },
    expectedBoundaries: [{ component: "CrossFileButton", prop: "onPress", kind: "event" }],
    expectedClosures: ["CrossFileButton.onPress"]
  },
  {
    id: "07-two-hop-forwarding",
    title: "Two-hop forwarding",
    level: "intermediate",
    description: "A parent forwards a callback through one component before it reaches a host event.",
    files: {
      "src/App.tsx": `
type ActionButtonProps = {
  onTrigger: () => void;
};

function ActionButton({ onTrigger }: ActionButtonProps) {
  return <button onClick={onTrigger}>Trigger</button>;
}

type ActionPanelProps = {
  onAction: () => void;
};

export function ActionPanel({ onAction }: ActionPanelProps) {
  return <ActionButton onTrigger={onAction} />;
}

export default function App() {
  return <ActionPanel onAction={() => record("two-hop")} />;
}
`
    },
    expectedBoundaries: [
      { component: "ActionButton", prop: "onTrigger", kind: "event" },
      { component: "ActionPanel", prop: "onAction", kind: "event" }
    ],
    expectedClosures: ["ActionPanel.onAction"]
  },
  {
    id: "08-three-hop-forwarding",
    title: "Three-hop forwarding",
    level: "advanced",
    description: "A callback crosses three component layers before reaching a host event.",
    files: {
      "src/App.tsx": `
type LeafButtonProps = {
  onTap: () => void;
};

function LeafButton({ onTap }: LeafButtonProps) {
  return <button onClick={onTap}>Leaf</button>;
}

type MiddleActionProps = {
  onRun: () => void;
};

function MiddleAction({ onRun }: MiddleActionProps) {
  return <LeafButton onTap={onRun} />;
}

type DeepPanelProps = {
  onCommit: () => void;
};

export function DeepPanel({ onCommit }: DeepPanelProps) {
  return <MiddleAction onRun={onCommit} />;
}

export default function App() {
  return <DeepPanel onCommit={() => record("three-hop")} />;
}
`
    },
    expectedBoundaries: [
      { component: "DeepPanel", prop: "onCommit", kind: "event" },
      { component: "LeafButton", prop: "onTap", kind: "event" },
      { component: "MiddleAction", prop: "onRun", kind: "event" }
    ],
    expectedClosures: ["DeepPanel.onCommit"]
  },
  {
    id: "09-multiple-host-events",
    title: "Multiple host events",
    level: "intermediate",
    description: "One component exposes several props that map to different host event names.",
    files: {
      "src/App.tsx": `
type PointerSurfaceProps = {
  onEnter: () => void;
  onLeave: () => void;
  onMove: () => void;
};

export function PointerSurface({ onEnter, onLeave, onMove }: PointerSurfaceProps) {
  return <div onMouseEnter={onEnter} onMouseLeave={onLeave} onMouseMove={onMove}>Pointer</div>;
}

export default function App() {
  return (
    <PointerSurface
      onEnter={() => record("enter")}
      onLeave={() => record("leave")}
      onMove={() => record("move")}
    />
  );
}
`
    },
    expectedBoundaries: [
      { component: "PointerSurface", prop: "onEnter", kind: "event" },
      { component: "PointerSurface", prop: "onLeave", kind: "event" },
      { component: "PointerSurface", prop: "onMove", kind: "event" }
    ],
    expectedClosures: ["PointerSurface.onEnter", "PointerSurface.onLeave", "PointerSurface.onMove"]
  },
  {
    id: "10-form-submit",
    title: "Form submit",
    level: "intermediate",
    description: "A form submit callback receives an event object and reaches form.onSubmit.",
    files: {
      "src/App.tsx": `
type SubmitFormProps = {
  onSubmit: (event: unknown) => void;
};

export function SubmitForm({ onSubmit }: SubmitFormProps) {
  return <form onSubmit={onSubmit}><button type="submit">Submit</button></form>;
}

export default function App() {
  return <SubmitForm onSubmit={(event) => record(event)} />;
}
`
    },
    expectedBoundaries: [{ component: "SubmitForm", prop: "onSubmit", kind: "event" }],
    expectedClosures: ["SubmitForm.onSubmit"]
  },
  {
    id: "11-input-change",
    title: "Input change",
    level: "intermediate",
    description: "A callback reaches input.onChange through a controlled input abstraction.",
    files: {
      "src/App.tsx": `
type InputFieldProps = {
  onValueChange: (event: unknown) => void;
};

export function InputField({ onValueChange }: InputFieldProps) {
  return <input name="title" onChange={onValueChange} />;
}

export default function App() {
  return <InputField onValueChange={(event) => record(event)} />;
}
`
    },
    expectedBoundaries: [{ component: "InputField", prop: "onValueChange", kind: "event" }],
    expectedClosures: ["InputField.onValueChange"]
  },
  {
    id: "12-keyboard-event",
    title: "Keyboard event",
    level: "intermediate",
    description: "A keyboard callback reaches a host onKeyDown event.",
    files: {
      "src/App.tsx": `
type KeyboardTrapProps = {
  onKeyDown: (event: unknown) => void;
};

export function KeyboardTrap({ onKeyDown }: KeyboardTrapProps) {
  return <section tabIndex={0} onKeyDown={onKeyDown}>Keyboard</section>;
}

export default function App() {
  return <KeyboardTrap onKeyDown={(event) => record(event)} />;
}
`
    },
    expectedBoundaries: [{ component: "KeyboardTrap", prop: "onKeyDown", kind: "event" }],
    expectedClosures: ["KeyboardTrap.onKeyDown"]
  },
  {
    id: "13-dialog-actions",
    title: "Dialog action composition",
    level: "intermediate",
    description: "A composed action row exposes two independent event boundaries.",
    files: {
      "src/App.tsx": `
type DialogActionsProps = {
  onConfirm: () => void;
  onCancel: () => void;
};

export function DialogActions({ onConfirm, onCancel }: DialogActionsProps) {
  return (
    <div role="group">
      <button onClick={onCancel}>Cancel</button>
      <button onClick={onConfirm}>Confirm</button>
    </div>
  );
}

export default function App() {
  return (
    <DialogActions
      onConfirm={() => record("confirm")}
      onCancel={() => record("cancel")}
    />
  );
}
`
    },
    expectedBoundaries: [
      { component: "DialogActions", prop: "onCancel", kind: "event" },
      { component: "DialogActions", prop: "onConfirm", kind: "event" }
    ],
    expectedClosures: ["DialogActions.onConfirm", "DialogActions.onCancel"]
  },
  {
    id: "14-list-item-forwarding",
    title: "List item forwarding",
    level: "advanced",
    description: "A list component forwards a selection callback into a row component.",
    files: {
      "src/App.tsx": `
type RowProps = {
  label: string;
  onSelect: () => void;
};

function Row({ label, onSelect }: RowProps) {
  return <button onClick={onSelect}>{label}</button>;
}

type ItemListProps = {
  onChoose: () => void;
};

export function ItemList({ onChoose }: ItemListProps) {
  return <ul><li><Row label="First" onSelect={onChoose} /></li></ul>;
}

export default function App() {
  return <ItemList onChoose={() => record("choose")} />;
}
`
    },
    expectedBoundaries: [
      { component: "ItemList", prop: "onChoose", kind: "event" },
      { component: "Row", prop: "onSelect", kind: "event" }
    ],
    expectedClosures: ["ItemList.onChoose"]
  },
  {
    id: "15-render-callback-negative",
    title: "Render callback is not an event",
    level: "negative",
    description: "A callback is invoked during render, not forwarded to a JSX event prop.",
    files: {
      "src/App.tsx": `
type RendererProps = {
  renderItem: () => string;
};

export function Renderer({ renderItem }: RendererProps) {
  return <div>{renderItem()}</div>;
}

export default function App() {
  return <Renderer renderItem={() => "rendered"} />;
}
`
    },
    expectedBoundaries: [],
    expectedClosures: []
  },
  {
    id: "16-plain-function-prop-negative",
    title: "Plain function prop is not an event",
    level: "negative",
    description: "A function prop is called as ordinary computation and should not become a boundary.",
    files: {
      "src/App.tsx": `
type CalculatorProps = {
  onCompute: (value: number) => number;
};

export function Calculator({ onCompute }: CalculatorProps) {
  const value = onCompute(2);
  return <output>{value}</output>;
}

export default function App() {
  return <Calculator onCompute={(value) => value + 1} />;
}
`
    },
    expectedBoundaries: [],
    expectedClosures: []
  },
  {
    id: "17-helper-registration-negative",
    title: "Helper registration stays unknown",
    level: "negative",
    description: "A callback is handed to an unknown helper instead of a JSX event prop.",
    files: {
      "src/App.tsx": `
type RegistrationPanelProps = {
  onReady: () => void;
};

function registerCallback(callback: () => void) {
  return callback;
}

export function RegistrationPanel({ onReady }: RegistrationPanelProps) {
  const registered = registerCallback(onReady);
  return <div>{String(Boolean(registered))}</div>;
}

export default function App() {
  return <RegistrationPanel onReady={() => record("ready")} />;
}
`
    },
    expectedBoundaries: [],
    expectedClosures: []
  },
  {
    id: "18-conditional-forwarding-negative",
    title: "Conditional forwarding stays unknown",
    level: "negative",
    description: "A conditional expression obscures the prop-to-host trace, so this POC should not infer it.",
    files: {
      "src/App.tsx": `
type ConditionalButtonProps = {
  enabled: boolean;
  onActivate: () => void;
};

export function ConditionalButton({ enabled, onActivate }: ConditionalButtonProps) {
  return <button onClick={enabled ? onActivate : undefined}>Conditional</button>;
}

export default function App() {
  return <ConditionalButton enabled={true} onActivate={() => record("conditional")} />;
}
`
    },
    expectedBoundaries: [],
    expectedClosures: []
  },
  {
    id: "19-aliased-import",
    title: "Aliased import",
    level: "advanced",
    description: "A component imported under a local alias still resolves to the exported boundary component.",
    files: {
      "src/App.tsx": `
import { Button as PrimaryAction } from "./Button";

export default function App() {
  return <PrimaryAction onPress={() => record("alias")} />;
}
`,
      "src/Button.tsx": `
type ButtonProps = {
  onPress: () => void;
};

export function Button({ onPress }: ButtonProps) {
  return <button onClick={onPress}>Alias</button>;
}
`
    },
    expectedBoundaries: [{ component: "Button", prop: "onPress", kind: "event" }],
    expectedClosures: ["Button.onPress"]
  },
  {
    id: "20-mixed-positive-negative",
    title: "Mixed positive and negative props",
    level: "advanced",
    description: "One component has event props and a render callback; only event-backed props should extract.",
    files: {
      "src/App.tsx": `
type ButtonProps = {
  onPress: () => void;
  children: string;
};

function Button({ onPress, children }: ButtonProps) {
  return <button onClick={onPress}>{children}</button>;
}

type ArchiveLinkProps = {
  action: () => void;
};

function ArchiveLink({ action }: ArchiveLinkProps) {
  return <a href="#" onClick={action}>Archive</a>;
}

type MixedPanelProps = {
  onSave: () => void;
  onCancel: () => void;
  onArchive: () => void;
  onPreview: () => string;
};

export function MixedPanel({ onSave, onCancel, onArchive, onPreview }: MixedPanelProps) {
  return (
    <section>
      <button onClick={onSave}>Save</button>
      <Button onPress={onCancel}>Cancel</Button>
      <ArchiveLink action={onArchive} />
      <p>{onPreview()}</p>
    </section>
  );
}

export default function App() {
  return (
    <MixedPanel
      onSave={() => record("save")}
      onCancel={() => record("cancel")}
      onArchive={() => record("archive")}
      onPreview={() => "preview"}
    />
  );
}
`
    },
    expectedBoundaries: [
      { component: "ArchiveLink", prop: "action", kind: "event" },
      { component: "Button", prop: "onPress", kind: "event" },
      { component: "MixedPanel", prop: "onArchive", kind: "event" },
      { component: "MixedPanel", prop: "onCancel", kind: "event" },
      { component: "MixedPanel", prop: "onSave", kind: "event" }
    ],
    expectedClosures: ["MixedPanel.onSave", "MixedPanel.onCancel", "MixedPanel.onArchive"]
  }
];

export class HostEventClassifier {
  classifyBoundary(candidate) {
    if (typeof candidate.attribute === "string" && /^on[A-Z]/.test(candidate.attribute)) {
      return { kind: "event", confidence: "high" };
    }
    return { kind: "unknown", confidence: "none" };
  }
}

export function createScenarioProject(scenario) {
  const rootDir = resolve("demo/scenarios", scenario.id);
  const fileEntries = Object.entries(scenario.files).map(([filename, source]) => ({
    filename: join(rootDir, filename),
    source: `${source.trim()}\n`
  }));
  return parseProjectFiles(fileEntries, rootDir);
}

export function createScenarioRequest(scenario) {
  return createBoundaryInferenceRequest(createScenarioProject(scenario));
}

export function evaluateScenario(scenario, classifier = new HostEventClassifier()) {
  const project = createScenarioProject(scenario);
  const request = createBoundaryInferenceRequest(project);
  const inference = inferBoundaryManifestForProject(project, classifier);
  const closures = discoverExtractableClosuresInProject(project, inference.manifest);

  return {
    scenario,
    request,
    inference,
    actualBoundaries: boundariesFromManifest(inference.manifest),
    expectedBoundaries: normalizeBoundaryEntries(scenario.expectedBoundaries),
    actualExtractableClosures: normalizeClosureEntries(
      closures.map((closure) => ({
        file: closure.file,
        target: closure.target,
        kind: closure.boundaryKind
      }))
    ),
    expectedExtractableClosures: expectedClosureEntries(scenario)
  };
}

export function scenarioResultSummary(result) {
  return {
    id: result.scenario.id,
    title: result.scenario.title,
    level: result.scenario.level,
    candidateCount: result.request.condensedAst.candidates.length,
    forwardingEdgeCount: result.request.condensedAst.propForwardingEdges.length,
    expectedBoundaryCount: result.expectedBoundaries.length,
    actualBoundaryCount: result.actualBoundaries.length,
    expectedExtractableClosureCount: result.expectedExtractableClosures.length,
    actualExtractableClosureCount: result.actualExtractableClosures.length
  };
}

export function expectedBoundaryEntries(scenarios = SCENARIOS) {
  return scenarios.flatMap((scenario) => normalizeBoundaryEntries(scenario.expectedBoundaries));
}

export function expectedModelBoundaryEntries(scenario) {
  return normalizeBoundaryEntries(
    scenario.expectedClosures.map((target) => {
      const separator = target.lastIndexOf(".");
      return {
        component: target.slice(0, separator),
        prop: target.slice(separator + 1),
        kind: "event"
      };
    })
  );
}

export function boundariesFromManifest(manifest) {
  const entries = [];
  for (const [component, record] of Object.entries(manifest.components ?? {})) {
    for (const [prop, kind] of Object.entries(record.props ?? {})) {
      entries.push({ component, prop, kind });
    }
  }
  return normalizeBoundaryEntries(entries);
}

export function normalizeBoundaryEntries(entries) {
  return entries
    .map((entry) => ({
      component: entry.component,
      prop: entry.prop,
      kind: entry.kind
    }))
    .sort(compareBoundaryEntries);
}

export function normalizeClosureEntries(entries) {
  return entries
    .map((entry) => ({
      file: entry.file,
      target: entry.target,
      kind: entry.kind
    }))
    .sort(compareClosureEntries);
}

export function entriesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function expectedClosureEntries(scenario) {
  return normalizeClosureEntries(
    scenario.expectedClosures.map((target) => ({
      file: "src/App.tsx",
      target,
      kind: "event"
    }))
  );
}

function compareBoundaryEntries(left, right) {
  return (
    left.component.localeCompare(right.component) ||
    left.prop.localeCompare(right.prop) ||
    left.kind.localeCompare(right.kind)
  );
}

function compareClosureEntries(left, right) {
  return (
    left.file.localeCompare(right.file) ||
    left.target.localeCompare(right.target) ||
    left.kind.localeCompare(right.kind)
  );
}
