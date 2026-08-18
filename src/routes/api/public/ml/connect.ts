import { createFileRoute } from "@tanstack/react-router";

/**
 * GET /api/public/ml/connect
 *
 * Ponto de entrada do botão "Conectar Mercado Livre".
 * Gera um state criptograficamente seguro, grava com expiração curta
 * e redireciona o cliente para o OAuth OFICIAL do Mercado Livre.
 *
 * É o mesmo fluxo de /api/public/ml/authorize — mantemos os dois caminhos
 * porque o front e a documentação já referenciam ambos.
 */
export const Route = createFileRoute("/api/public/ml/connect")({
  server: {
    handlers: {
      GET: async () => {
        const { getMlCredentials, getMlRedirectUri, isPkceEnabled } = await import("@/lib/server/config.server");
        const { ML_AUTH_URL } = await import("@/lib/server/ml-api.server");
        const { db } = await import("@/lib/server/db.server");
        const { resolveRequester } = await import("@/lib/server/auth.server");
        const { logEvent } = await import("@/lib/server/logs.server");

        const fail = async (msg: string) => {
          await logEvent({ category: "oauth", action: "oauth.connect.falha", success: false, error: msg });
          return new Response(null, {
            status: 302,
            headers: { Location: `/?ml=erro&msg=${encodeURIComponent(msg)}` },
          });
        };

        // Toda conexão precisa de um dono. Uma navegação simples (clique em
        // link) não carrega o bearer token do Supabase, então aqui só há
        // sessão quando a chamada vem de JS. Sem dono, recusamos: criar a
        // conexão órfã destruiria o isolamento entre clientes.
        const requester = await resolveRequester();
        if (!requester) {
          return new Response(null, {
            status: 302,
            headers: {
              Location: `/entrar?next=conectar&msg=${encodeURIComponent(
                "Entre na sua conta para conectar o Mercado Livre.",
              )}`,
            },
          });
        }

        let clientId: string;
        let redirectUri: string;
        try {
          ({ clientId } = getMlCredentials());
          redirectUri = getMlRedirectUri();
        } catch (e) {
          return fail(e instanceof Error ? e.message : "Integração não configurada.");
        }

        // 256 bits de entropia via crypto.randomUUID (v4, CSPRNG).
        const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
        const codeVerifier = isPkceEnabled() ? base64Url(crypto.getRandomValues(new Uint8Array(48))) : null;

        const { error } = await db("ml_oauth_states").insert({
          state,
          code_verifier: codeVerifier,
          owner_user_id: requester.userId,
          redirect_uri: redirectUri,
          expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        });
        if (error) return fail("Não foi possível iniciar a conexão.");

        // Limpeza oportunista dos states expirados (sem job externo).
        await db("ml_oauth_states").delete().lt("expires_at", new Date().toISOString());

        const url = new URL(ML_AUTH_URL);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("client_id", clientId);
        url.searchParams.set("redirect_uri", redirectUri);
        url.searchParams.set("state", state);
        if (codeVerifier) {
          url.searchParams.set("code_challenge", await sha256Base64Url(codeVerifier));
          url.searchParams.set("code_challenge_method", "S256");
        }

        await logEvent({
          category: "oauth",
          action: "oauth.connect.iniciado",
          endpoint: "/api/public/ml/connect",
          method: "GET",
          actor: requester.email,
          ip: requester.ip,
          detail: { redirect_uri: redirectUri, pkce: Boolean(codeVerifier) },
        });

        return new Response(null, { status: 302, headers: { Location: url.toString() } });
      },
    },
  },
});

function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}
