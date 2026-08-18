import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/public/ml/authorize
 *
 * Caminho legado. Antes duplicava a geração de state e gravava
 * `owner_user_id` possivelmente NULO — o que criava conexões sem dono e
 * quebrava o isolamento entre clientes.
 *
 * Agora existe um único ponto de entrada (/api/public/ml/connect), que exige
 * sessão. Este endpoint apenas encaminha para lá, preservando links antigos.
 */
export const Route = createFileRoute("/api/public/ml/authorize")({
  server: {
    handlers: {
      GET: async () =>
        new Response(null, {
          status: 302,
          headers: { Location: "/api/public/ml/connect" },
        }),
    },
  },
});
