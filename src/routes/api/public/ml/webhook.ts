import { createFileRoute } from "@tanstack/react-router";

/**
 * Webhook de notificações do Mercado Livre.
 * Cadastre esta URL no aplicativo do ML: <APP_URL>/api/public/ml/webhook
 * O ML exige resposta 200 rápida — por isso gravamos a notificação e processamos
 * em seguida, com idempotência por (topic, resource, sent_at).
 */
export const Route = createFileRoute("/api/public/ml/webhook")({
  server: {
    handlers: {
      // Alguns painéis validam a URL com GET.
      GET: async () => new Response("ok", { status: 200 }),

      POST: async ({ request }) => {
        const ok = () => new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });

        let payload: {
          topic?: string;
          resource?: string;
          user_id?: number | string;
          application_id?: number | string;
          attempts?: number;
          sent?: string;
        };
        try {
          payload = (await request.json()) as typeof payload;
        } catch {
          return ok();
        }

        const topic = String(payload.topic ?? "").trim();
        const resource = String(payload.resource ?? "").trim();
        if (!topic || !resource) return ok();

        const { db } = await import("@/lib/server/db.server");
        const sentAt = payload.sent ? new Date(payload.sent).toISOString() : new Date().toISOString();

        // Idempotência: a mesma notificação nunca é processada duas vezes.
        const { data: existing } = await db("ml_webhook_events")
          .select("id, status")
          .eq("topic", topic)
          .eq("resource", resource)
          .eq("sent_at", sentAt)
          .maybeSingle();
        if (existing && existing.status !== "error") return ok();

        const row = {
          topic,
          resource,
          ml_user_id: payload.user_id != null ? String(payload.user_id) : null,
          application_id: payload.application_id != null ? String(payload.application_id) : null,
          attempts: Number(payload.attempts ?? 1),
          sent_at: sentAt,
          status: "pending",
          raw: payload,
        };

        const { data: saved } = await db("ml_webhook_events")
          .upsert(row, { onConflict: "topic,resource,sent_at" })
          .select("id")
          .maybeSingle();

        const { logEvent } = await import("@/lib/server/logs.server");
        const startedAt = Date.now();

        try {
          const { processNotification } = await import("@/lib/server/ml-sync.server");
          const result = await processNotification({
            topic,
            resource,
            mlUserId: row.ml_user_id,
          });
          if (saved?.id) {
            await db("ml_webhook_events")
              .update({
                status: result.status,
                error: result.error ?? null,
                processed_at: new Date().toISOString(),
              })
              .eq("id", saved.id);
          }
          await logEvent({
            category: "webhook",
            action: `webhook.${result.status}`,
            mlUserId: row.ml_user_id,
            endpoint: resource,
            method: "POST",
            durationMs: Date.now() - startedAt,
            success: result.status !== "error",
            error: result.error ?? null,
            actor: "mercado_livre",
            detail: { topic, attempts: row.attempts, sent_at: sentAt },
          });
        } catch (e) {
          const message = (e instanceof Error ? e.message : "erro").slice(0, 500);
          console.error("[ml/webhook]", message);
          if (saved?.id) {
            await db("ml_webhook_events")
              .update({ status: "error", error: message, processed_at: new Date().toISOString() })
              .eq("id", saved.id);
          }
          await logEvent({
            category: "webhook",
            action: "webhook.erro",
            mlUserId: row.ml_user_id,
            endpoint: resource,
            method: "POST",
            durationMs: Date.now() - startedAt,
            success: false,
            error: message,
            actor: "mercado_livre",
            detail: { topic, sent_at: sentAt },
          });
        }

        return ok();
      },
    },
  },
});
