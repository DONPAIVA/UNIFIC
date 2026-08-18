import { createFileRoute } from "@tanstack/react-router";

/** GET /internal/accounts — lista as contas conectadas. Nunca devolve tokens. */
export const Route = createFileRoute("/internal/accounts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireInternalToken, jsonResponse } = await import("@/lib/server/internal-auth.server");
        const denied = requireInternalToken(request);
        if (denied) return denied;

        const { db } = await import("@/lib/server/db.server");
        const { data, error } = await db("ml_connections")
          .select(
            "id, provider, ml_user_id, nickname, email, site_id, status, connected_at, last_sync_at, last_sync_status, last_error",
          )
          .order("created_at", { ascending: false });

        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ accounts: data ?? [] });
      },
    },
  },
});
