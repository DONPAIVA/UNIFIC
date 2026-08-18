import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireAdminUser } from "./auth-middleware";

type LogInput = { action: string; path?: string; detail?: string };

/** Registra o acesso com o IP real do visitante (lido no servidor). */
export const logAcesso = createServerFn({ method: "POST" })
  .inputValidator((input: LogInput) => ({
    action: String(input.action ?? "visita").slice(0, 60),
    path: String(input.path ?? "").slice(0, 200),
    detail: String(input.detail ?? "").slice(0, 200),
  }))
  .handler(async ({ data }) => {
    const request = getRequest();
    const h = request.headers;
    const { ipDeHeaders } = await import("./server/ip.server");
    const ip = ipDeHeaders(h);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("acessos").insert({
      // Sem proxy (acesso por localhost) realmente não há IP para registrar.
      ip: ip ?? "local",
      action: data.action,
      path: data.path || null,
      detail: data.detail || null,
      user_agent: (h.get("user-agent") ?? "").slice(0, 300) || null,
    });
    // .insert() devolve o erro em vez de lançar; sem isto a falha some
    // (foi assim que a tabela `acessos` apagada passou despercebida).
    if (error) console.error("[acessos] não gravado:", error.message);
    return { ok: !error };
  });

/**
 * Lista os últimos acessos para o painel de monitoramento.
 *
 * Exige ADMINISTRADOR: a tabela guarda IP e user-agent de todos os visitantes.
 * Sem essa exigência, qualquer pessoa conseguia baixar o log de acesso inteiro.
 */
export const listAcessos = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .handler(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("acessos")
      .select("id, ip, action, path, detail, user_agent, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    return (data ?? []) as Array<{
      id: string;
      ip: string | null;
      action: string;
      path: string | null;
      detail: string | null;
      user_agent: string | null;
      created_at: string;
    }>;
  });
