/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from "./db.server";

export type AuditInput = {
  adminUserId?: string | null;
  adminEmail?: string | null;
  action: string;
  entity?: string | null;
  entityId?: string | null;
  accountId?: string | null;
  success?: boolean;
  detail?: any;
  ip?: string | null;
};

/**
 * Auditoria nunca deve derrubar a operação principal.
 * `detail` passa pelo redator: nenhum segredo é gravado.
 */
export async function logAudit(input: AuditInput) {
  try {
    const { redact } = await import("./logs.server");
    const { error } = await db("admin_audit_log").insert({
      admin_user_id: input.adminUserId ?? null,
      admin_email: input.adminEmail ?? null,
      action: input.action,
      entity: input.entity ?? null,
      entity_id: input.entityId ?? null,
      account_id: input.accountId ?? null,
      success: input.success ?? true,
      detail: input.detail == null ? null : redact(input.detail),
      ip: input.ip ?? null,
    });
    // .insert() devolve o erro em vez de lançar — sem isto a falha ficava invisível.
    if (error) console.error("[audit] não gravado:", error.message);
  } catch (e) {
    console.error("[audit]", e instanceof Error ? e.message : e);
  }
}
