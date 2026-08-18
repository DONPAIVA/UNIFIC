import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /internal/account/:mlUserId
 * Dados da conta no banco + perfil ao vivo no Mercado Livre (reputação, vendas).
 */
export const Route = createFileRoute("/internal/account/$mlUserId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireInternalToken, jsonResponse } = await import("@/lib/server/internal-auth.server");
        const denied = requireInternalToken(request);
        if (denied) return denied;

        const { db } = await import("@/lib/server/db.server");
        const { getAccountByMlUserId, fetchMe } = await import("@/lib/server/ml-api.server");

        const account = await getAccountByMlUserId(String(params.mlUserId));
        if (!account) return jsonResponse({ error: "Conta não encontrada." }, 404);

        const { data: stored } = await db("ml_connections")
          .select(
            "id, provider, ml_user_id, nickname, email, site_id, status, connected_at, last_sync_at, last_sync_status, last_error",
          )
          .eq("id", account.id)
          .maybeSingle();

        const counts: Record<string, number> = {};
        for (const table of ["ml_orders", "ml_shipments", "ml_shipment_events"]) {
          const { count } = await db(table).select("id", { count: "exact", head: true }).eq("account_id", account.id);
          counts[table] = count ?? 0;
        }

        // Perfil ao vivo — se a API falhar, devolvemos o que temos no banco.
        const me = await fetchMe(account);
        const profile = me.ok
          ? {
              nickname: me.data?.nickname ?? null,
              site_id: me.data?.site_id ?? null,
              permalink: me.data?.permalink ?? null,
              user_type: me.data?.user_type ?? null,
              seller_reputation: me.data?.seller_reputation ?? null,
              status: me.data?.status ?? null,
            }
          : null;

        return jsonResponse({
          account: stored,
          counts,
          profile,
          profile_error: me.ok ? null : me.error,
        });
      },
    },
  },
});
