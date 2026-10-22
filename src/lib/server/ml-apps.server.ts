/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Aplicativos do Mercado Livre (client_id / client_secret).
 *
 * De onde vem o app:
 *   1. o app ATIVO cadastrado na Central (tabela ml_apps) — vale para as
 *      conexões novas;
 *   2. sem nada cadastrado (ou sem a tabela), o do .env (ML_CLIENT_ID /
 *      ML_CLIENT_SECRET) — o comportamento de sempre.
 *
 * Cada conta renova o token com o app que a AUTORIZOU
 * (ml_connections.app_client_id). É o que permite trocar de app sem derrubar
 * ninguém: o Mercado Livre só aceita renovar um token pelo mesmo app que o
 * emitiu. Conta sem esse registro foi autorizada pelo app do .env.
 *
 * O secret fica CIFRADO no banco (AES-GCM). A chave é derivada da
 * SUPABASE_SERVICE_ROLE_KEY: nada novo para configurar, e um dump do banco
 * sozinho não entrega o secret.
 */
import { db } from "./db.server";

// Repetido de ml-api.server de propósito: aquele módulo importa este, e o
// import de volta criaria um ciclo.
const ML_API = "https://api.mercadolibre.com";

export type AppMl = { clientId: string; clientSecret: string; origem: "painel" | "env" };

function env(nome: string) {
  return (process.env[nome] ?? "").trim();
}

/** App do .env, ou null se não estiver configurado. */
export function appDoEnv(): AppMl | null {
  const clientId = env("ML_CLIENT_ID");
  const clientSecret = env("ML_CLIENT_SECRET");
  return clientId && clientSecret ? { clientId, clientSecret, origem: "env" } : null;
}

/* -------------------------------------------------------------------------- */
/* Cifra do secret                                                             */
/* -------------------------------------------------------------------------- */

async function chave(): Promise<CryptoKey> {
  const base = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!base) throw new Error("SUPABASE_SERVICE_ROLE_KEY ausente: não há como proteger o secret.");
  const bruto = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`centralml:ml-apps:${base}`));
  return crypto.subtle.importKey("raw", bruto, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function cifrar(texto: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await chave(), new TextEncoder().encode(texto));
  return `v1:${Buffer.from(iv).toString("base64")}:${Buffer.from(cifrado).toString("base64")}`;
}

async function decifrar(valor: string): Promise<string> {
  const [versao, iv, dados] = String(valor).split(":");
  if (versao !== "v1" || !iv || !dados) throw new Error("Formato de secret desconhecido.");
  const claro = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(iv, "base64") },
    await chave(),
    Buffer.from(dados, "base64"),
  );
  return new TextDecoder().decode(claro);
}

/* -------------------------------------------------------------------------- */
/* Leitura (com cache curto)                                                   */
/* -------------------------------------------------------------------------- */

type Cache = { em: number; ativo: AppMl | null; secrets: Map<string, string> };
let cache: Cache | null = null;
const CACHE_MS = 30_000;

/** Depois de salvar ou trocar o app ativo, para valer na próxima chamada. */
export function limparCacheDosApps() {
  cache = null;
}

async function carregar(): Promise<Cache> {
  if (cache && Date.now() - cache.em < CACHE_MS) return cache;

  const secrets = new Map<string, string>();
  let ativo: AppMl | null = null;

  // Sem a tabela (SQL ainda não rodado) o erro volta aqui e tudo segue no .env.
  const { data, error } = await db("ml_apps").select("client_id, client_secret_cifrado, ativo");
  if (!error) {
    for (const linha of (data ?? []) as any[]) {
      try {
        const secret = await decifrar(linha.client_secret_cifrado);
        secrets.set(String(linha.client_id), secret);
        if (linha.ativo) ativo = { clientId: String(linha.client_id), clientSecret: secret, origem: "painel" };
      } catch {
        /* chave mudou (service role trocada): o app precisa ser recadastrado */
      }
    }
  }

  cache = { em: Date.now(), ativo, secrets };
  return cache;
}

/** App das conexões NOVAS: o ativo da Central; sem ele, o do .env. */
export async function appAtivo(): Promise<AppMl> {
  const app = (await carregar()).ativo ?? appDoEnv();
  if (!app) throw new Error("Integração do Mercado Livre não configurada (ML_CLIENT_ID / ML_CLIENT_SECRET).");
  return app;
}

/**
 * App que deve renovar o token de uma conta (ou concluir uma autorização).
 * Sem registro de app: o do .env, que é quem autorizou as contas antigas.
 */
export async function appDaConta(appClientId?: string | null): Promise<AppMl> {
  const { secrets } = await carregar();
  const doEnv = appDoEnv();
  if (appClientId) {
    const secret = secrets.get(appClientId);
    if (secret) return { clientId: appClientId, clientSecret: secret, origem: "painel" };
    if (doEnv && doEnv.clientId === appClientId) return doEnv;
  } else if (doEnv) {
    return doEnv;
  }
  return appAtivo();
}

/* -------------------------------------------------------------------------- */
/* Teste de credenciais                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Confere client_id + secret no Mercado Livre sem criar nada.
 *
 * Manda um code falso ao /oauth/token. Testado: com credenciais certas o ML
 * responde `invalid_grant` (o code é que não vale); com client_id ou secret
 * errados, `invalid_client`.
 */
export async function testarCredenciais(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): Promise<{ ok: boolean; mensagem: string }> {
  try {
    const res = await fetch(`${ML_API}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        client_secret: clientSecret,
        code: "TG-centralml-teste-de-credencial",
        redirect_uri: redirectUri,
      }),
    });
    const corpo: any = await res.json().catch(() => ({}));
    const erro = String(corpo?.error ?? "");
    if (erro === "invalid_grant") return { ok: true, mensagem: "O Mercado Livre aceitou o Client ID e o Secret." };
    if (erro === "invalid_client") return { ok: false, mensagem: "O Mercado Livre recusou: Client ID ou Secret errado." };
    return {
      ok: false,
      mensagem: `Resposta inesperada do Mercado Livre (HTTP ${res.status}${erro ? `, ${erro}` : ""}). Confira os dados e tente de novo.`,
    };
  } catch {
    return { ok: false, mensagem: "Não foi possível falar com o Mercado Livre agora. Tente de novo." };
  }
}

/* -------------------------------------------------------------------------- */
/* Colunas novas antes do SQL                                                  */
/* -------------------------------------------------------------------------- */

/** O erro é de coluna/tabela que ainda não existe (SQL não rodado)? */
export function faltaEsquema(erro: any, nome: string) {
  const texto = `${erro?.message ?? ""} ${erro?.details ?? ""}`;
  return ["42703", "42P01", "PGRST204", "PGRST205"].includes(String(erro?.code)) || texto.includes(nome);
}

/**
 * Grava o state do OAuth com o app usado. Sem a coluna nova (SQL ainda não
 * rodado), grava sem ela — o retorno então usa o app ativo, como antes.
 */
export async function gravarStateOAuth(linha: Record<string, unknown>, appClientId: string) {
  const r = await db("ml_oauth_states").insert({ ...linha, app_client_id: appClientId });
  if (r.error && faltaEsquema(r.error, "app_client_id")) return db("ml_oauth_states").insert(linha);
  return r;
}
