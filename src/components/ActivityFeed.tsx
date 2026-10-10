import Link from "next/link";
import { ACTION_LABELS, formatDateTime, timeAgo } from "@/lib/format";
import { MODULE_MAP, isModuleKey } from "@/lib/modules";
import { Badge } from "./ui";

export interface FeedItem {
  id: string;
  createdAt: string | null;
  actorId: string | null;
  actorName: string | null;
  actorRole?: string | null;
  action: string;
  module: string;
  summary: string;
}

export function actionTone(action: string) {
  if (action === "delete" || action === "login_failed") return "red" as const;
  if (action === "create" || action === "admin_create") return "green" as const;
  if (action === "update" || action.startsWith("admin_") || action === "password_change") return "amber" as const;
  if (action === "view") return "violet" as const;
  return "slate" as const;
}

export function moduleName(key: string) {
  return isModuleKey(key) ? MODULE_MAP[key].label : key === "system" ? "System" : key;
}

export function ActivityFeed({ items, linkActors = true }: { items: FeedItem[]; linkActors?: boolean }) {
  if (items.length === 0) return <p className="px-5 py-6 text-sm text-slate-500">No activity recorded yet.</p>;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((a) => (
        <li key={a.id} className="flex gap-3 px-5 py-3">
          <div className="pt-0.5">
            <Badge tone={actionTone(a.action)}>{ACTION_LABELS[a.action] ?? a.action}</Badge>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-slate-800">{a.summary}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {linkActors && a.actorId && a.actorRole === "admin" ? (
                <Link href={`/super-admin/admins/${a.actorId}`} className="font-medium text-slate-700 hover:text-brand-700">{a.actorName}</Link>
              ) : (
                <span className="font-medium text-slate-700">{a.actorName ?? "Unknown"}</span>
              )}
              {" · "}
              {moduleName(a.module)}
              {" · "}
              <time title={formatDateTime(a.createdAt)}>{timeAgo(a.createdAt)}</time>
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
