import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/public/ml/status
 *
 * Status das conexões DO USUÁRIO AUTENTICADO.
 *
 * Antes esta rota era anônima e devolvia "a conexão mais recente do sistema",
 * incluindo ml_user_id, nickname e e-mail — ou seja, entregava dados de um
 * cliente para qualquer visitante. Agora exige sessão e filtra por dono.
 *
 * Continua sem devolver access_token/refresh_token em nenhuma hipótese.
 */
export const Route = createFileRoute("/api/public/ml/status")({
  server: {
    handlers: {
      GET: async () => {
        const json = (body: unknown, status = 200) =>
          new Response(JSON.stringify(body), {
            status,
            headers: { "content-type": "application/json", "cache-control": "no-store" },
          });

        const { resolveRequester } = await import("@/lib/server/auth.server");
        const requester = await resolveRequester();
        if (!requester) return json({ connected: false, authenticated: false }, 401);

        const { db } = await import("@/lib/server/db.server");
        const { data } = await db("ml_connections")
          .select("ml_user_id, nickname, status, last_sync_at, connected_at")
          .eq("provider", "mercado_livre")
          .eq("owner_user_id", requester.userId)
          .neq("status", "disconnected")
          .order("created_at", { ascending: false });

        const contas = (data ?? []).map((row: { ml_user_id: string; nickname: string | null; status: string | null; last_sync_at: string | null; connected_at: string | null }) => ({
          ml_user_id: row.ml_user_id,
          nickname: row.nickname ?? null,
          status: row.status ?? "active",
          last_sync_at: row.last_sync_at ?? null,
          connected_at: row.connected_at ?? null,
        }));

        return json({ connected: contas.length > 0, authenticated: true, contas });
      },
    },
  },
});
