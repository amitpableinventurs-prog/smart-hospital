"use client";

import { useEffect, useState } from "react";
import { ActivityLogView, type AdminOption } from "@/components/ActivityLogView";
import { PageHeader } from "@/components/ui";
import { api } from "@/lib/client";

export default function ActivityPage() {
  const [admins, setAdmins] = useState<AdminOption[]>([]);
  useEffect(() => {
    api<AdminOption[]>("/api/admins?limit=100")
      .then(({ data }) => setAdmins(data.map((a) => ({ id: a.id, name: a.name }))))
      .catch(() => setAdmins([]));
  }, []);

  return (
    <>
      <PageHeader title="Activity Log" description="Every sign-in, record change, patient record view and access change, across all modules." />
      <ActivityLogView admins={admins} />
    </>
  );
}
