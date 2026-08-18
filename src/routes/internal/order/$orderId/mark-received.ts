import { createFileRoute } from "@tanstack/react-router";

/**
 * POST /internal/order/:orderId/mark-received   body: { mlUserId, rating?, message? }
 * :orderId é o ID do pedido no Mercado Livre.
 * Usa o token do COMPRADOR e chama POST /orders/{orderId}/feedback (fulfilled: true).
 * O banco local só é atualizado após resposta de sucesso do ML.
 */
export const Route = createFileRoute("/internal/order/$orderId/mark-received")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { requireInternalToken, jsonResponse, adminEmailFrom, ipFrom } = await import(
          "@/lib/server/internal-auth.server"
        );
        const denied = requireInternalToken(request);
        if (denied) return denied;

        let body: { mlUserId?: string | number; rating?: "positive" | "neutral" | "negative"; message?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          body = {};
        }

        const mlUserId = String(body.mlUserId ?? "").trim();
        if (!mlUserId) return jsonResponse({ error: "mlUserId é obrigatório." }, 400);

        const { db } = await import("@/lib/server/db.server");
        const { getAccountByMlUserId, submitOrderFeedback, canMarkReceived } = await import(
          "@/lib/server/ml-api.server"
        );
        const { logAudit } = await import("@/lib/server/audit.server");

        const account = await getAccountByMlUserId(mlUserId);
        if (!account) return jsonResponse({ error: "Conta não encontrada." }, 404);

        const mlOrderId = String(params.orderId);
        const { data: order } = await db("ml_orders")
          .select("id, ml_order_id, status, buyer_feedback_at")
          .eq("account_id", account.id)
          .eq("ml_order_id", mlOrderId)
          .maybeSingle();

        if (!order) return jsonResponse({ error: "Pedido não encontrado nesta conta." }, 404);
        if (!canMarkReceived(order)) {
          return jsonResponse(
            {
              error: order.buyer_feedback_at
                ? "Feedback já enviado para este pedido."
                : "Operação não aplicável ao status atual do pedido.",
            },
            409,
          );
        }

        const rating = body.rating ?? "positive";
        const message = String(body.message ?? "").slice(0, 160);
        const adminEmail = adminEmailFrom(request);

        const res = await submitOrderFeedback(account, order.ml_order_id, {
          fulfilled: true,
          rating,
          ...(message ? { message } : {}),
        });

        await logAudit({
          adminEmail,
          ip: ipFrom(request),
          action: "pedido.marcar_recebido",
          entity: "ml_orders",
          entityId: order.id,
          accountId: account.id,
          success: res.ok,
          detail: {
            ml_order_id: order.ml_order_id,
            rating,
            http_status: res.status,
            response: res.ok ? res.data : res.error,
          },
        });

        if (!res.ok) {
          return jsonResponse({ ok: false, error: res.error ?? "O Mercado Livre recusou a operação." }, 502);
        }

        const patch = {
          buyer_feedback_at: new Date().toISOString(),
          buyer_feedback_status: "fulfilled",
          buyer_feedback_rating: rating,
        };
        await db("ml_orders").update(patch).eq("id", order.id);

        return jsonResponse({ ok: true, ...patch });
      },
    },
  },
});
