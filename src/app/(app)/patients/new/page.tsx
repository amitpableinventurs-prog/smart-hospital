"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { RecordFields, clientValidate, initialValues, toPayload, type FormValues } from "@/components/RecordForm";
import { Alert, Button, Card, Kbd, PageHeader, omitKey, useHotkeys, useToast } from "@/components/ui";
import { ApiClientError, api } from "@/lib/client";
import { MODULE_MAP } from "@/lib/modules";

const resource = MODULE_MAP.patients.resources[0];

export default function NewPatientPage() {
  const router = useRouter();
  const toast = useToast();
  const [values, setValues] = useState<FormValues>(() => initialValues(resource));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const formRef = useRef<HTMLFormElement>(null);
  useHotkeys({ "ctrl+s": () => formRef.current?.requestSubmit(), F10: () => formRef.current?.requestSubmit() });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const clientErrors = clientValidate(resource, values);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) {
      setFormError("Please correct the highlighted fields.");
      return;
    }
    setSaving(true);
    try {
      const { data } = await api<{ id: string; code: string }>("/api/patients", { method: "POST", body: toPayload(resource, values) });
      // Success is only reported once the API has confirmed the registration.
      toast(`Patient registered with ID ${data.code}`);
      router.push(`/patients/${data.id}`);
    } catch (err) {
      if (err instanceof ApiClientError && err.fields) setErrors(err.fields);
      setFormError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <>
      <Link href="/patients" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Back to patients
      </Link>
      <PageHeader title="Register patient" description="A unique patient ID is generated automatically once the registration is saved." />
      <Card className="max-w-3xl">
        <form ref={formRef} onSubmit={submit} noValidate className="space-y-5 p-6">
          {formError && <Alert>{formError}</Alert>}
          <RecordFields
            resource={resource}
            values={values}
            errors={errors}
            disabled={saving}
            onChange={(name, v) => {
              setValues((s) => ({ ...s, [name]: v }));
              if (errors[name]) setErrors((e) => omitKey(e, name));
            }}
          />
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-5">
            <Link href="/patients">
              <Button type="button" variant="secondary" disabled={saving}>Cancel</Button>
            </Link>
            <Button type="submit" loading={saving}>{saving ? "Registering…" : "Register patient"} <Kbd>Ctrl+S</Kbd></Button>
          </div>
        </form>
      </Card>
    </>
  );
}
