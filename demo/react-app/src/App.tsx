import { useState } from "react";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { FormPanel } from "./FormPanel";
import { Toolbar } from "./Toolbar";

export default function App() {
  const [count, setCount] = useState(0);
  const [savedAt, setSavedAt] = useState("never");
  const [published, setPublished] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [formDraft, setFormDraft] = useState("ready");

  return (
    <main className="app-shell">
      <h1>Markerless Closure Extraction</h1>

      <section className="demo-section">
        <h2>Direct component boundary</h2>
        <Button onPress={() => setCount(count + 1)}>Count: {count}</Button>
      </section>

      <section className="demo-section">
        <h2>Multi-hop toolbar boundary</h2>
        <Toolbar
          onSave={() => setSavedAt(new Date(0).toISOString())}
          onPublish={() => setPublished(true)}
        />
        <p>Saved: {savedAt}</p>
        <p>Published: {String(published)}</p>
      </section>

      <section className="demo-section">
        <h2>Dialog action boundaries</h2>
        <ConfirmDialog
          onConfirm={() => setConfirmed(true)}
          onCancel={() => setCancelled(true)}
        />
        <p>
          Confirmed: {String(confirmed)} / Cancelled: {String(cancelled)}
        </p>
      </section>

      <section className="demo-section">
        <h2>Form boundary</h2>
        <FormPanel
          onSubmit={(event) => {
            event.preventDefault();
            setSubmitted(true);
          }}
          onReset={() => setFormDraft("reset")}
        />
        <p>
          Submitted: {String(submitted)} / Draft: {formDraft}
        </p>
      </section>
    </main>
  );
}
