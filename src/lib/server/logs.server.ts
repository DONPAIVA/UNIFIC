/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Log unificado do sistema (tabela public.system_logs).
 *
 * REGRA INEGOCIÁVEL: nada de segredo entra aqui.
 * `redact()` remove access_token, refresh_token, client_secret, service_role_key,
 * Authorization e afins antes de qualquer gravação. Se um valor de segredo
 * conhecido aparecer no meio de um texto, ele é substituído por [REDACTED].
 */
import { db } from "./db.server";

export type LogCategory =
  | "login"
  | "oauth"
  | "refresh_token"
  | "sync"
  | "pedidos"
  | "webhook"
  | "api_request"
  | "api_response"
  | "rastreio"
  | "admin"
  | "erro";

export type LogInput = {
  level?: "info" | "warn" | "error";
  category: LogCategory;
  action: string;
  accountId?: string | null;
  mlUserId?: string | null;
  endpoint?: string | null;
  method?: string | null;
  httpStatus?: number | null;
  durationMs?: number | null;
  success?: boolean;
  message?: string | null;
  error?: string | null;
  detail?: unknown;
  actor?: string | null;
  ip?: string | null;
};

const SECRET_KEYS = [
  "access_token",
  "refresh_token",
  "client_secret",
  "service_role_key",
  "supabase_service_role_key",
  "ml_client_secret",
  "ml_internal_api_token",
  "ml_cron_token",
  "authorization",
  "apikey",
  "api_key",
  "code_verifier",
  "password",
  "token",
  "secret",
];

const SECRET_ENV_VARS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "ML_CLIENT_SECRET",
  "ML_INTERNAL_API_TOKEN",
  "ML_CRON_TOKEN",
  "SUPABASE_PUBLISHABLE_KEY",
];

const REDACTED = "[REDACTED]";

/** Valores de segredo conhecidos do ambiente, para varrer strings livres. */
function envSecretValues(): string[] {
  return SECRET_ENV_VARS.map((name) => (process.env[name] ?? "").trim())
    .filter((v) => v.length >= 12)
    .map((v) => v.replace(/^"|"$/g, ""));
}

function scrubString(value: string): string {
  let out = value;
  for (const secret of envSecretValues()) {
    if (secret && out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  // Bearer <jwt/opaco> em texto livre
  out = out.replace(/Bearer\s+[A-Za-z0-9._\-]{8,}/gi, `Bearer ${REDACTED}`);
  return out;
}

/** Remove recursivamente qualquer chave sensível e higieniza strings. */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[depth-limit]";
  if (value == null) return value;
  if (typeof value === "string") return scrubString(value).slice(0, 4000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEYS.includes(k.toLowerCase())) {
        out[k] = REDACTED;
        continue;
      }
      out[k] = redact(v, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, 500);
}

/**
 * Grava um evento. Nunca lança: um problema no log não pode derrubar
 * uma sincronização ou o callback do OAuth.
 */
export async function logEvent(input: LogInput): Promise<void> {
  try {
    await db("system_logs").insert({
      level: input.level ?? (input.success === false ? "error" : "info"),
      category: input.category,
      action: String(input.action).slice(0, 120),
      account_id: input.accountId ?? null,
      ml_user_id: input.mlUserId ? String(input.mlUserId) : null,
      endpoint: input.endpoint ? scrubString(String(input.endpoint)).slice(0, 500) : null,
      method: input.method ?? null,
      http_status: input.httpStatus ?? null,
      duration_ms: input.durationMs ?? null,
      success: input.success ?? true,
      message: input.message ? scrubString(String(input.message)).slice(0, 1000) : null,
      error: input.error ? scrubString(String(input.error)).slice(0, 1000) : null,
      detail: input.detail === undefined ? null : (redact(input.detail) as any),
      actor: input.actor ? String(input.actor).slice(0, 200) : null,
      ip: input.ip ?? null,
    });
  } catch (e) {
    // Só o console, e sem segredos.
    console.error("[system_logs] falha ao gravar:", e instanceof Error ? scrubString(e.message) : "erro");
  }
}
