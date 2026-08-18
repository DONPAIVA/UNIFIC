/**
 * Configuração centralizada de domínio e OAuth.
 * NENHUM domínio de produção é fixado no código — tudo vem de env.
 *   APP_URL          -> base pública da aplicação (opcional; fallback = origem da requisição)
 *   ML_REDIRECT_URI  -> redirect URI cadastrada no app do Mercado Livre
 *                       (opcional; fallback = <APP_URL|origem>/api/public/ml/callback)
 */
import { getRequest } from "@tanstack/react-start/server";

export const ML_CALLBACK_PATH = "/api/public/ml/callback";
export const ML_WEBHOOK_PATH = "/api/public/ml/webhook";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

function requestOrigin(): string {
  try {
    const request = getRequest();
    if (request?.url) return new URL(request.url).origin;
  } catch {
    /* fora de um contexto de requisição */
  }
  return "";
}

/** Base pública da aplicação, sem barra final. */
export function getAppUrl(): string {
  const configured = env("APP_URL");
  const base = configured || requestOrigin();
  return base.replace(/\/+$/, "");
}

/**
 * Redirect URI do OAuth do Mercado Livre.
 *
 * O DOMÍNIO DA REQUISIÇÃO MANDA MAIS QUE A VARIÁVEL DE AMBIENTE.
 *
 * Por quê: o `redirect_uri` entra duas vezes no fluxo — na ida (montando a URL
 * de autorização) e na volta (trocando o code por token). O Mercado Livre exige
 * que os dois sejam iguais, e o retorno só chega se apontar para o host onde o
 * cliente está navegando. Uma env apontando para OUTRO domínio é sempre uma
 * configuração velha, e o efeito é o pior possível: o ML recusa com uma tela
 * genérica, sem dizer o motivo.
 *
 * Foi exatamente o que aconteceu ao trocar de domínio: a variável ficou com o
 * endereço antigo e nenhuma autorização passava, enquanto os dois lados
 * pareciam corretos quando olhados em separado.
 *
 * Fora de uma requisição (cron, script), não há host para consultar — aí vale
 * o que está configurado.
 */
export function getMlRedirectUri(): string {
  const origem = requestOrigin();
  const configurado = env("ML_REDIRECT_URI");

  if (!origem) {
    if (configurado) return configurado;
    const base = getAppUrl();
    if (!base) throw new Error("Configure APP_URL ou ML_REDIRECT_URI.");
    return `${base}${ML_CALLBACK_PATH}`;
  }

  // A env só é usada quando aponta para o MESMO host da requisição — assim um
  // caminho customizado continua respeitado, sem herdar o domínio errado.
  if (configurado) {
    try {
      if (new URL(configurado).origin === origem) return configurado;
    } catch {
      /* env malformada: o host da requisição resolve */
    }
  }
  return `${origem}${ML_CALLBACK_PATH}`;
}

/** URL pública do webhook de notificações do Mercado Livre. */
export function getMlWebhookUrl(): string {
  const base = getAppUrl();
  return base ? `${base}${ML_WEBHOOK_PATH}` : ML_WEBHOOK_PATH;
}

export function getMlCredentials(): { clientId: string; clientSecret: string } {
  const clientId = env("ML_CLIENT_ID");
  const clientSecret = env("ML_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    throw new Error("Integração do Mercado Livre não configurada (ML_CLIENT_ID / ML_CLIENT_SECRET).");
  }
  return { clientId, clientSecret };
}

export function isPkceEnabled(): boolean {
  return env("ML_USE_PKCE").toLowerCase() === "on";
}

export function getAdminBootstrapEmail(): string {
  return env("ADMIN_BOOTSTRAP_EMAIL").toLowerCase();
}

/** Diagnóstico para a tela de Configurações — nunca devolve segredos, só booleanos. */
export function getConfigStatus() {
  let redirectUri = "";
  let redirectError: string | null = null;
  try {
    redirectUri = getMlRedirectUri();
  } catch (e) {
    redirectError = e instanceof Error ? e.message : "erro";
  }
  return {
    appUrl: getAppUrl(),
    appUrlFromEnv: Boolean(env("APP_URL")),
    redirectUri,
    redirectUriFromEnv: Boolean(env("ML_REDIRECT_URI")),
    redirectError,
    webhookUrl: getMlWebhookUrl(),
    hasClientId: Boolean(env("ML_CLIENT_ID")),
    hasClientSecret: Boolean(env("ML_CLIENT_SECRET")),
    hasServiceRoleKey: Boolean(env("SUPABASE_SERVICE_ROLE_KEY")),
    pkce: isPkceEnabled(),
    bootstrapEmailConfigured: Boolean(env("ADMIN_BOOTSTRAP_EMAIL")),
    cronEnabled: Boolean(env("ML_CRON_TOKEN")),
    cronUrl: getAppUrl() ? `${getAppUrl()}/api/public/ml/cron` : "/api/public/ml/cron",
    cronMinMinutes: Number(env("ML_CRON_MIN_MINUTES") || 30),
  };
}
