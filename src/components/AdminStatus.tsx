"use client";

import type { ModuleKey } from "@/lib/modules";
import { Badge } from "./ui";

export interface AdminRow {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  modules: ModuleKey[];
  active: boolean;
  online: boolean;
  lastLoginAt: string | null;
  lastActiveAt: string | null;
  lastLoginIp: string | null;
  createdAt: string | null;
  actions7d?: number;
}

export function AdminStatus({ admin }: { admin: Pick<AdminRow, "active" | "online"> }) {
  if (!admin.active) return <Badge tone="red">Deactivated</Badge>;
  return admin.online ? (
    <Badge tone="green"><span className="size-1.5 rounded-full bg-emerald-500" aria-hidden /> Online</Badge>
  ) : (
    <Badge tone="slate">Active</Badge>
  );
}
