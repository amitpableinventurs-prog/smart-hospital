"use client";

import { useState } from "react";
import { ApiClientError, api } from "@/lib/client";
import { Alert, Button, Field, Modal, inputClass } from "../ui";

/** Asks for a reason, then POSTs { reason } to a cancel endpoint. */
export function CancelModal({ url, label, note, onClose, onDone }: { url: string; label: string; note: string; onClose: () => void; onDone: (data: unknown) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { data } = await api(url, { method: "POST", body: { reason } });
      onDone(data);
    } catch (e) {
      setError(e instanceof ApiClientError && e.fields ? Object.values(e.fields)[0] : (e as Error).message);
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} size="md" title={`Cancel ${label}?`} description={note}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Keep it</Button><Button variant="danger" onClick={submit} loading={busy}>Cancel {label.split(" ")[0]}</Button></>}>
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Reason" htmlFor="cancel-reason" required hint="Recorded in the activity log.">
          <input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} className={inputClass} />
        </Field>
      </div>
    </Modal>
  );
}
