import { Button } from "./Button";

type DialogActionsProps = {
  onPrimary: () => void;
  onSecondary: () => void;
};

export function DialogActions({ onPrimary, onSecondary }: DialogActionsProps) {
  return (
    <div className="dialog-actions">
      <Button onPress={onSecondary}>Cancel</Button>
      <Button onPress={onPrimary}>Confirm</Button>
    </div>
  );
}

type ConfirmDialogProps = {
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({ onConfirm, onCancel }: ConfirmDialogProps) {
  return (
    <div className="dialog" role="dialog" aria-label="Confirm publish">
      <p>Publish the current draft?</p>
      <DialogActions onPrimary={onConfirm} onSecondary={onCancel} />
    </div>
  );
}
