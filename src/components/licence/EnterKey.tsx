"use client";

import { useState } from "react";
import { Alert, Button, Field, Modal, cx, errorRing, inputClass } from "../ui";
import { ApiClientError, api } from "@/lib/client";
import type { LicenceView } from "@/lib/licence-protocol";

/** Super admin: renew or change the licence with an offline key from the vendor (works without the internet). */
export function EnterKeyModal({ onClose, onDone }: { onClose: () => void; onDone: (licence: LicenceView) => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldError(undefined);
    try {
      const { data } = await api<{ licence: LicenceView }>("/api/licence/key", { method: "POST", body: { licenceKey: key } });
      onDone(data.licence);
    } catch (err) {
      setError((err as Error).message);
      if (err instanceof ApiClientError) setFieldError(err.fields?.licenceKey);
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title="Enter licence key"
      description="Paste the offline licence key from your vendor. It replaces the current licence; your data stays as it is."
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" form="enter-key" loading={busy} disabled={!key.trim()}>Apply key</Button></>}
    >
      <form id="enter-key" onSubmit={submit} className="space-y-3" noValidate>
        {error && <Alert>{error}</Alert>}
        <Field label="Licence key" htmlFor="offline-key" required error={fieldError}>
          <textarea id="offline-key" value={key} onChange={(e) => setKey(e.target.value)} rows={6} placeholder="SH1.…" autoComplete="off" spellCheck={false} className={cx(inputClass, "resize-none break-all font-mono text-xs", errorRing(fieldError))} />
        </Field>
      </form>
    </Modal>
  );
}
