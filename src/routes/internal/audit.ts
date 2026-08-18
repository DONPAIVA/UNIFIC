import { createFileRoute } from "@tanstack/react-router";

/** GET /internal/audit?limit=&offset=&action=&admin= — ações registradas. */
export const Route = createFileRoute("/internal/audit")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { requireInternalToken, jsonResponse } = await import("@/lib/server/internal-auth.server");
        const denied = requireInternalToken(request);
        if (denied) return denied;

        const { admin } = await import("@/lib/server/db.server");
        const url = new URL(request.url);
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100), 1), 500);
        const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
        const action = url.searchParams.get("action");
        const adminEmail = url.searchParams.get("admin");

        let query = admin
          .from("admin_audit_log")
          .select("id, admin_email, action, entity, entity_id, account_id, success, detail, ip, created_at", {
            count: "exact",
          })
          .order("created_at", { ascending: false })
          .range(offset, offset + limit - 1);

        if (action) query = query.eq("action", action);
        if (adminEmail) query = query.eq("admin_email", adminEmail.toLowerCase());

        const { data, count, error } = await query;
        if (error) return jsonResponse({ error: error.message }, 500);
        return jsonResponse({ total: count ?? 0, limit, offset, entries: data ?? [] });
      },
    },
  },
});
