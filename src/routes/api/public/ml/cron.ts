import { createFileRoute } from "@tanstack/react-router";

/**
 * Manutenção agendada das conexões do Mercado Livre.
 *
 * Faz DUAS coisas, nesta ordem:
 *   1. MANTÉM OS TOKENS — renova o access_token das contas que estão perto de
 *      expirar. Isso acontece independentemente de o cliente abrir o site.
 *   2. SINCRONIZA — traz pedidos novos das contas ativas (opcional, controlado
 *      por ML_CRON_MIN_MINUTES; use ?sync=0 para pular).
 *
 * Segurança: exige `x-cron-token` (ou ?token=) igual a ML_CRON_TOKEN.
 * Sem a variável definida o endpoint responde 404 — fica desligado.
 * A resposta NUNCA inclui access_token nem refresh_token.
 */
export const Route = createFileRoute("/api/public/ml/cron")({
  server: {
    handlers: {
      POST: async ({ request }) => run(request),
      GET: async ({ request }) => run(request),
    },
  },
});

/** Comparação em tempo constante: evita descobrir o token por medição de tempo. */
function comparaSegura(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function run(request: Request) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });

  const expected = (process.env["ML_CRON_TOKEN"] ?? "").trim();
  if (!expected) return json({ enabled: false, error: "ML_CRON_TOKEN não configurado." }, 404);

  const url = new URL(request.url);
  const provided = (request.headers.get("x-cron-token") ?? url.searchParams.get("token") ?? "").trim();
  if (!provided || !comparaSegura(provided, expected)) return json({ error: "unauthorized" }, 401);

  const inicio = Date.now();

  /* ---------------- 1) manutenção dos tokens (sempre roda) ---------------- */
  const { manterTokens } = await import("@/lib/server/ml-refresh.server");
  const tokens = await manterTokens({ origem: "cron", limite: 100 });

  /* ------- 2) notificações que o Mercado Livre não conseguiu entregar ------ */
  // Enquanto o túnel/servidor esteve fora do ar, o ML guardou os eventos em
  // /missed_feeds. Sem isto, tudo que aconteceu offline se perderia.
  const { recuperarNotificacoesPerdidas } = await import("@/lib/server/ml-missed.server");
  const perdidas = await recuperarNotificacoesPerdidas({ origem: "cron", limite: 50 });

  /* ---------------- 3) sincronização de pedidos (opcional) ---------------- */
  const querSync = url.searchParams.get("sync") !== "0";
  const sincronizacoes: Array<{ mlUserId: string; status: string; pedidos: number }> = [];

  if (querSync) {
    const minMinutes = Number(process.env["ML_CRON_MIN_MINUTES"] ?? 30);
    const cutoff = new Date(Date.now() - Math.max(minMinutes, 5) * 60 * 1000).toISOString();

    const { db } = await import("@/lib/server/db.server");
    const { syncAccount } = await import("@/lib/server/ml-sync.server");

    const { data: accounts } = await db("ml_connections")
      .select("id, ml_user_id, last_sync_at")
      .eq("provider", "mercado_livre")
      .eq("status", "active")
      .or(`last_sync_at.is.null,last_sync_at.lt.${cutoff}`)
      .limit(10);

    for (const account of accounts ?? []) {
      const r = await syncAccount(account.id, { kind: "incremental", trigger: "cron" });
      sincronizacoes.push({ mlUserId: account.ml_user_id, status: r.status, pedidos: r.orders });
    }
  }

  // Resposta só com metadados: nenhum token, nenhum segredo.
  return json({
    ok: true,
    executadoEm: new Date().toISOString(),
    duracaoMs: Date.now() - inicio,
    tokens: {
      verificadas: tokens.verificadas,
      renovadas: tokens.renovadas,
      jaValidas: tokens.jaValidas,
      reautorizacaoNecessaria: tokens.reautorizacao,
      errosTemporarios: tokens.errosTemporarios,
      itens: tokens.itens,
    },
    notificacoesPerdidas: {
      lidas: perdidas.lidas,
      processadas: perdidas.processadas,
      ignoradas: perdidas.ignoradas,
      erros: perdidas.erros,
      jaVistas: perdidas.jaVistas,
    },
    sincronizacao: querSync ? { contas: sincronizacoes.length, resultados: sincronizacoes } : "pulada",
  });
}
