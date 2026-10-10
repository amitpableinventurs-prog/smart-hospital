"use client";

import { useState } from "react";
import { Alert, Button, Card, CardHeader, Field, PageHeader, cx, errorRing, inputClass, useToast } from "@/components/ui";
import { ApiClientError, api } from "@/lib/client";
import { PASSWORD_MIN, validatePassword } from "@/lib/validation";

export default function AccountPage() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!current) errs.currentPassword = "Enter your current password";
    const pw = validatePassword(next);
    if (pw) errs.newPassword = pw;
    else if (next === current) errs.newPassword = "Choose a password different from the current one";
    if (next !== confirm) errs.confirm = "Passwords do not match";
    setErrors(errs);
    setFormError(null);
    if (Object.keys(errs).length) return;

    setSaving(true);
    try {
      await api("/api/auth/password", { method: "POST", body: { currentPassword: current, newPassword: next } });
      toast("Password changed. Other sessions were signed out.");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) setErrors(err.fields);
      setFormError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <PageHeader title="Account" description="Manage your sign-in password." />
      <Card className="max-w-lg">
        <CardHeader title="Change password" />
        <form onSubmit={submit} noValidate className="space-y-4 p-5">
          {formError && <Alert>{formError}</Alert>}
          <Field label="Current password" htmlFor="cur" required error={errors.currentPassword}>
            <input id="cur" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={cx(inputClass, errorRing(errors.currentPassword))} />
          </Field>
          <Field label="New password" htmlFor="new" required error={errors.newPassword} hint={`At least ${PASSWORD_MIN} characters with letters and numbers.`}>
            <input id="new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={cx(inputClass, errorRing(errors.newPassword))} />
          </Field>
          <Field label="Confirm new password" htmlFor="conf" required error={errors.confirm}>
            <input id="conf" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={cx(inputClass, errorRing(errors.confirm))} />
          </Field>
          <div className="flex justify-end pt-2">
            <Button type="submit" loading={saving}>Update password</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
