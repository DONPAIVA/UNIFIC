import { createFileRoute } from "@tanstack/react-router";

/** GET /internal/health — status simples, sem exigir token. */
export const Route = createFileRoute("/internal/health")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify({ status: "ok", time: new Date().toISOString() }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    },
  },
});
