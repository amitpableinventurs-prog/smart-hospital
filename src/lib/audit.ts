import "server-only";
import { clientIp } from "./api";
import type { SessionUser } from "./session";
import { ActivityLog, type ActivityAction } from "@/models/ActivityLog";

interface ActivityInput {
  req: Request;
  user: Pick<SessionUser, "id" | "name" | "email" | "role"> | null;
  action: ActivityAction;
  module: string;
  summary: string;
  resource?: string;
  entityId?: string;
  entityLabel?: string;
  changedFields?: string[];
  actorEmail?: string;
}

/**
 * Append an entry to the audit trail the super admin monitors.
 * Failures are logged but never break the user's request.
 */
export async function logActivity(input: ActivityInput) {
  try {
    await ActivityLog.create({
      actor: input.user?.id,
      actorName: input.user?.name,
      actorEmail: input.user?.email ?? input.actorEmail,
      actorRole: input.user?.role,
      action: input.action,
      module: input.module,
      resource: input.resource,
      entityId: input.entityId,
      entityLabel: input.entityLabel,
      summary: input.summary,
      changedFields: input.changedFields,
      ip: clientIp(input.req),
      userAgent: input.req.headers.get("user-agent")?.slice(0, 300),
    });
  } catch (err) {
    console.error("[audit] failed to record activity:", err);
  }
}
