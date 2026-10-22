import { createServerFn } from "@tanstack/react-start";
import { requireUser } from "./auth-middleware";
import { PREFIXO_STATE_PUBLICO } from "./ml-oauth";

/**
 * OAuth do Mercado Livre — iniciado pelo CLIENTE LOGADO dentro do Unific+.
 *
 * Exige sessão: sem dono identificado não há como isolar a conexão depois.
 * Client ID/Secret e tokens permanecem exclusivamente no backend.
 * A Redirect URI vem de ML_REDIRECT_URI (ou APP_URL); nada é fixado no código.
 */
export const startMlConnect = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const { getMlRedirectUri, isPkceEnabled } = await import("./server/config.server");
    const { ML_AUTH_URL } = await import("./server/ml-api.server");
    const { db } = await import("./server/db.server");
    const { appAtivo, gravarStateOAuth } = await import("./server/ml-apps.server");

    const { clientId } = await appAtivo();
    const redirectUri = getMlRedirectUri();

    const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const usePkce = isPkceEnabled();
    const codeVerifier = usePkce ? base64Url(crypto.getRandomValues(new Uint8Array(48))) : null;

    // O dono sai da SESSÃO validada no servidor, nunca de um campo do formulário.
    const ownerUserId = context.user.userId;

    const { error } = await gravarStateOAuth(
      {
        state,
        code_verifier: codeVerifier,
        owner_user_id: ownerUserId,
        redirect_uri: redirectUri,
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      },
      clientId,
    );
    if (error) throw new Error("Não foi possível iniciar a conexão. Tente novamente.");

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

    // Sem este log não dá para distinguir "o cliente nunca clicou" de
    // "o cliente clicou e o Mercado Livre nunca conseguiu voltar".
    const { logEvent } = await import("./server/logs.server");
    await logEvent({
      category: "oauth",
      action: "oauth.connect.iniciado",
      actor: context.user.email,
      message: "Cliente enviado ao OAuth do Mercado Livre.",
      detail: { redirect_uri: redirectUri, pkce: Boolean(codeVerifier) },
    });

    return { authorizationUrl: url.toString() };
  });

/**
 * OAuth do Mercado Livre para quem AINDA NÃO TEM CONTA no Únific+.
 *
 * É o "entrar com o Mercado Livre": o visitante digita o código de rastreio,
 * clica em rastrear e vai direto para a tela de autorização do Mercado Livre.
 * Não há formulário de cadastro no caminho — o acesso do Únific+ é criado no
 * callback, a partir da própria conta autorizada.
 *
 * SEM middleware de sessão, de propósito: é o único ponto público do OAuth.
 * O que protege aqui é o `state` de uso único e com validade, igual ao fluxo
 * logado — o visitante não escolhe nada além de autorizar (ou não) no
 * Mercado Livre, e o token continua saindo apenas do backend.
 */
export const startMlConnectPublico = createServerFn({ method: "POST" }).handler(async () => {
  const { getMlRedirectUri, isPkceEnabled } = await import("./server/config.server");
  const { ML_AUTH_URL } = await import("./server/ml-api.server");
  const { db } = await import("./server/db.server");
  const { appAtivo, gravarStateOAuth } = await import("./server/ml-apps.server");

  const { clientId } = await appAtivo();
  const redirectUri = getMlRedirectUri();

  const state =
    PREFIXO_STATE_PUBLICO +
    crypto.randomUUID().replace(/-/g, "") +
    crypto.randomUUID().replace(/-/g, "");
  const usePkce = isPkceEnabled();
  const codeVerifier = usePkce ? base64Url(crypto.getRandomValues(new Uint8Array(48))) : null;

  // owner_user_id fica NULO: ainda não existe cliente. Quem preenche é o
  // callback, depois de saber qual conta do Mercado Livre autorizou.
  const { error } = await gravarStateOAuth(
    {
      state,
      code_verifier: codeVerifier,
      owner_user_id: null,
      redirect_uri: redirectUri,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    },
    clientId,
  );
  if (error) throw new Error("Não foi possível iniciar a conexão. Tente novamente.");

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

  const { logEvent } = await import("./server/logs.server");
  await logEvent({
    category: "oauth",
    action: "oauth.connect.iniciado_publico",
    actor: "visitante",
    message: "Visitante enviado ao OAuth do Mercado Livre sem cadastro prévio.",
    detail: { redirect_uri: redirectUri, pkce: Boolean(codeVerifier) },
  });

  return { authorizationUrl: url.toString() };
});

/**
 * Status das conexões DO CLIENTE AUTENTICADO. Nunca expõe tokens.
 *
 * Antes esta função devolvia "a conexão mais recente do sistema inteiro",
 * o que mostrava o nickname de um cliente para outro. Agora o filtro por
 * owner_user_id é obrigatório.
 */
export const mlStatus = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const { db } = await import("./server/db.server");

    const { data } = await db("ml_connections")
      .select("id, nickname, ml_user_id, status, last_sync_at, connected_at, created_at, expires_at")
      .eq("provider", "mercado_livre")
      .eq("owner_user_id", context.user.userId)
      .order("created_at", { ascending: false });

    type Conta = {
      id: string;
      nickname: string | null;
      mlUserId: string;
      status: string;
      lastSyncAt: string | null;
      connectedAt: string | null;
      precisaReconectar: boolean;
    };

    const contas: Conta[] = (data ?? []).map((row: any) => ({
      id: row.id,
      nickname: row.nickname ?? null,
      mlUserId: row.ml_user_id,
      status: row.status ?? "active",
      lastSyncAt: row.last_sync_at ?? null,
      connectedAt: row.connected_at ?? row.created_at ?? null,
      precisaReconectar: row.status === "reauth_required" || row.status === "disconnected",
    }));

    const ativa = contas.find((c) => !c.precisaReconectar) ?? null;

    return {
      connected: Boolean(ativa),
      nickname: ativa?.nickname ?? null,
      lastSyncAt: ativa?.lastSyncAt ?? null,
      precisaReconectar: contas.length > 0 && !ativa,
      contas,
    };
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
