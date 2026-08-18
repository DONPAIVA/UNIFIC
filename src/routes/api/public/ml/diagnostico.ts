import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/public/ml/diagnostico
 *
 * Mostra QUAL Redirect URI o aplicativo vai enviar ao Mercado Livre a partir
 * deste domínio — o dado que decide se a autorização passa ou é recusada.
 *
 * POR QUE É PÚBLICO
 * Nada aqui é segredo: a Redirect URI já aparece na barra de endereço de
 * qualquer cliente que clique em "Conectar Mercado Livre", e o webhook é uma
 * URL que o próprio ML precisa conhecer. As credenciais saem apenas como
 * booleanos "está configurada?", nunca o valor.
 *
 * Sem isto, conferir a configuração exigia login de administrador — e quando o
 * login é justamente o que está quebrado, não há como diagnosticar.
 */
export const Route = createFileRoute("/api/public/ml/diagnostico")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { getMlRedirectUri, getMlWebhookUrl, getAppUrl } = await import("@/lib/server/config.server");

        let redirectUri = "";
        let erro: string | null = null;
        try {
          redirectUri = getMlRedirectUri();
        } catch (e) {
          erro = e instanceof Error ? e.message : "erro";
        }

        const origem = (() => {
          try {
            return new URL(request.url).origin;
          } catch {
            return "";
          }
        })();

        const env = (nome: string) => (process.env[nome] ?? "").trim();

        const corpo = {
          origemDaRequisicao: origem,
          redirectUriQueSeraEnviada: redirectUri,
          webhookUrl: getMlWebhookUrl(),
          appUrl: getAppUrl(),
          erro,

          // Só a existência, nunca o conteúdo.
          configurado: {
            ML_CLIENT_ID: Boolean(env("ML_CLIENT_ID")),
            ML_CLIENT_SECRET: Boolean(env("ML_CLIENT_SECRET")),
            SUPABASE_URL: Boolean(env("SUPABASE_URL")),
            SUPABASE_SERVICE_ROLE_KEY: Boolean(env("SUPABASE_SERVICE_ROLE_KEY")),
            ML_CRON_TOKEN: Boolean(env("ML_CRON_TOKEN")),
          },

          // Valores de env que amarram o app a um domínio — úteis para ver
          // quando estão desatualizados em relação à origem da requisição.
          envDeDominio: {
            APP_URL: env("APP_URL") || null,
            ML_REDIRECT_URI: env("ML_REDIRECT_URI") || null,
          },

          instrucao:
            "Cadastre 'redirectUriQueSeraEnviada' como Redirect URI no aplicativo do Mercado Livre, exatamente como aparece aqui.",
        };

        return new Response(JSON.stringify(corpo, null, 2), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
        });
      },
    },
  },
});
