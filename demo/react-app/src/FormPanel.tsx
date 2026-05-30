import type { FormEvent } from "react";
import { Button } from "./Button";

type FormPanelProps = {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
};

export function FormPanel({ onSubmit, onReset }: FormPanelProps) {
  return (
    <form className="form-panel" onSubmit={onSubmit}>
      <label>
        Title
        <input name="title" defaultValue="Compiler notes" />
      </label>
      <div className="form-actions">
        <button type="submit">Submit</button>
        <Button onPress={onReset}>Reset draft</Button>
      </div>
    </form>
  );
}
