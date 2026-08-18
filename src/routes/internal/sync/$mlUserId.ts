import { createFileRoute } from "@tanstack/react-router";

/** POST /internal/sync/:mlUserId?full=1 — sincronização manual da conta. */
export const Route = createFileRoute("/internal/sync/$mlUserId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { requireInternalToken, jsonResponse, adminEmailFrom, ipFrom } = await import(
          "@/lib/server/internal-auth.server"
        );
        const denied = requireInternalToken(request);
        if (denied) return denied;

        const { syncOrders } = await import("@/lib/server/ml-sync.server");
        const { logAudit } = await import("@/lib/server/audit.server");

        const url = new URL(request.url);
        const full = url.searchParams.get("full") === "1";
        const adminEmail = adminEmailFrom(request);

        try {
          const result = await syncOrders(String(params.mlUserId), {
            kind: full ? "initial" : "manual",
            trigger: `internal:${adminEmail ?? "api"}`,
            full,
          });
          await logAudit({
            adminEmail,
            ip: ipFrom(request),
            action: full ? "sync.completa" : "sync.manual",
            entity: "ml_connections",
            entityId: String(params.mlUserId),
            success: result.status === "success",
            detail: { orders: result.orders, shipments: result.shipments, events: result.events, error: result.error },
          });
          return jsonResponse(result, result.status === "success" ? 200 : 502);
        } catch (e) {
          const message = e instanceof Error ? e.message : "Falha na sincronização.";
          return jsonResponse({ status: "error", error: message }, 400);
        }
      },
    },
  },
});
