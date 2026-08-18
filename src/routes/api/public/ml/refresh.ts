import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /api/public/ml/refresh   body: { ml_user_id }
 * Renova o access_token de uma conta. Protegida por x-internal-token —
 * renovar token é operação sensível e não pode ficar aberta na internet.
 * O refresh automático (em 401) já acontece dentro de mlFetch.
 */
export const Route = createFileRoute("/api/public/ml/refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

        const { requireInternalToken } = await import("@/lib/server/internal-auth.server");
        const denied = requireInternalToken(request);
        if (denied) return denied;

        let body: { ml_user_id?: string | number };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return json({ error: "JSON inválido." }, 400);
        }

        const mlUserId = String(body.ml_user_id ?? "").trim();
        if (!mlUserId) return json({ error: "ml_user_id é obrigatório." }, 400);

        const { getAccountByMlUserId, refreshAccessToken } = await import("@/lib/server/ml-api.server");
        const account = await getAccountByMlUserId(mlUserId);
        if (!account) return json({ error: "Conta não encontrada." }, 404);

        try {
          const updated = await refreshAccessToken(account);
          // Devolve apenas metadados — nunca o token.
          return json({ ok: true, ml_user_id: updated.ml_user_id, expires_at: updated.expires_at });
        } catch (e) {
          return json({ ok: false, error: e instanceof Error ? e.message : "Falha ao renovar." }, 502);
        }
      },
    },
  },
});
