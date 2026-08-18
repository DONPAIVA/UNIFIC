import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /internal/orders/:mlUserId?limit=&offset=&q=&status=
 * Pedidos já sincronizados da conta, com o shipment associado.
 */
export const Route = createFileRoute("/internal/orders/$mlUserId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { requireInternalToken, jsonResponse } = await import("@/lib/server/internal-auth.server");
        const denied = requireInternalToken(request);
        if (denied) return denied;

        const { db, admin } = await import("@/lib/server/db.server");
        const { getAccountByMlUserId, canMarkReceived } = await import("@/lib/server/ml-api.server");

        const account = await getAccountByMlUserId(String(params.mlUserId));
        if (!account) return jsonResponse({ error: "Conta não encontrada." }, 404);

        const url = new URL(request.url);
        const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 200);
        const offset = Math.max(Number(url.searchParams.get("offset") ?? 0), 0);
        const status = url.searchParams.get("status");
        const term = (url.searchParams.get("q") ?? "").replace(/[%,]/g, "");

        let query = admin
          .from("ml_orders")
          .select(
            "id, ml_order_id, status, status_detail, date_created, total_amount, currency_id, buyer_nickname, title, quantity, items, shipping_id, buyer_feedback_at, buyer_feedback_status, buyer_feedback_rating",
            { count: "exact" },
          )
          .eq("account_id", account.id)
          .order("date_created", { ascending: false })
          .range(offset, offset + limit - 1);

        if (status) query = query.eq("status", status);
        if (term) {
          query = query.or(
            `ml_order_id.ilike.%${term}%,title.ilike.%${term}%,buyer_nickname.ilike.%${term}%,shipping_id.ilike.%${term}%`,
          );
        }

        const { data: orders, count, error } = await query;
        if (error) return jsonResponse({ error: error.message }, 500);

        const shippingIds = (orders ?? []).map((o: { shipping_id: string | null }) => o.shipping_id).filter(Boolean);
        const shipmentsById = new Map<string, Record<string, unknown>>();
        if (shippingIds.length) {
          const { data: shipments } = await db("ml_shipments")
            .select("id, ml_shipment_id, status, substatus, mode, logistic_type, tracking_number, tracking_method, last_updated")
            .eq("account_id", account.id)
            .in("ml_shipment_id", shippingIds);
          for (const s of shipments ?? []) shipmentsById.set(String(s.ml_shipment_id), s);
        }

        const rows = (orders ?? []).map((o: Record<string, unknown>) => {
          const shipment = o["shipping_id"] ? shipmentsById.get(String(o["shipping_id"])) ?? null : null;
          return {
            ...o,
            shipment,
            tracking_code: shipment ? (shipment as { tracking_number?: string | null }).tracking_number ?? null : null,
            shipment_status: shipment ? (shipment as { status?: string | null }).status ?? null : null,
            can_mark_received: canMarkReceived(o as never),
          };
        });

        return jsonResponse({
          ml_user_id: account.ml_user_id,
          total: count ?? 0,
          limit,
          offset,
          orders: rows,
        });
      },
    },
  },
});
