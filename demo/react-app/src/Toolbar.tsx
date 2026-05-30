import { ToolbarButton } from "./ToolbarButton";

type ToolbarProps = {
  onSave: () => void;
  onPublish: () => void;
};

export function Toolbar({ onSave, onPublish }: ToolbarProps) {
  return (
    <div className="toolbar" role="toolbar" aria-label="Document actions">
      <ToolbarButton label="Save draft" onActivate={onSave} />
      <ToolbarButton label="Publish" onActivate={onPublish} />
    </div>
  );
}
