/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Identidade do requisitante — fonte ÚNICA de verdade sobre "quem está falando".
 *
 * Regra do projeto: o navegador NUNCA prova quem é. Ele manda o bearer token do
 * Supabase Auth (anexado por attachSupabaseAuth) e QUEM DECIDE é este arquivo,
 * validando o token no servidor. Nenhuma função pode aceitar user_id,
 * account_id ou ml_user_id vindos do cliente como prova de autorização.
 */
import type { Requester } from "../auth-middleware";
import { ipDeHeaders } from "./ip.server";

export type { Requester };

function isNewSupabaseApiKey(value: string): boolean {
  return value.startsWith("sb_publishable_") || value.startsWith("sb_secret_");
}

function createSupabaseFetch(supabaseKey: string): typeof fetch {
  return (input, init) => {
    const headers = new Headers(
      typeof Request !== "undefined" && input instanceof Request ? input.headers : undefined,
    );
    if (init?.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    if (isNewSupabaseApiKey(supabaseKey) && headers.get("Authorization") === `Bearer ${supabaseKey}`) {
      headers.delete("Authorization");
    }
    headers.set("apikey", supabaseKey);
    return fetch(input, { ...init, headers });
  };
}

/** Delegado para ip.server.ts — a versão anterior gravava string vazia. */
function ipFromHeaders(headers: Headers): string | null {
  return ipDeHeaders(headers);
}

/**
 * Cache de sessões já validadas.
 *
 * Motivo: validar uma sessão custa DUAS idas ao Supabase (getClaims + consulta
 * em admin_users). Medido deste ambiente, cada ida leva ~1,5 s — ou seja, 3 s
 * de espera antes de qualquer trabalho, em TODA server function. Uma tela da
 * CentralML dispara meia dúzia delas.
 *
 * A chave é o próprio token, que já É a credencial: nada é compartilhado entre
 * usuários. O TTL curto garante que uma troca de permissão (virar admin, sair
 * de admin_users) valha em no máximo 60 s. A expiração real do JWT continua
 * sendo respeitada, porque o token expirado deixa de bater na chave e volta a
 * ser validado do zero.
 */
const TTL_SESSAO_MS = 60_000;
const MAX_SESSOES = 500;
const cacheSessoes = new Map<string, { requester: Requester; expiraEm: number }>();

function lerCache(token: string): Requester | null {
  const item = cacheSessoes.get(token);
  if (!item) return null;
  if (item.expiraEm < Date.now()) {
    cacheSessoes.delete(token);
    return null;
  }
  return item.requester;
}

function gravarCache(token: string, requester: Requester) {
  // Poda simples: evita o mapa crescer sem limite em produção.
  if (cacheSessoes.size >= MAX_SESSOES) {
    const agora = Date.now();
    for (const [k, v] of cacheSessoes) if (v.expiraEm < agora) cacheSessoes.delete(k);
    if (cacheSessoes.size >= MAX_SESSOES) {
      const maisAntiga = cacheSessoes.keys().next().value;
      if (maisAntiga) cacheSessoes.delete(maisAntiga);
    }
  }
  cacheSessoes.set(token, { requester, expiraEm: Date.now() + TTL_SESSAO_MS });
}

/** Invalida o cache de um token (usado ao promover/remover administrador). */
export function invalidarCacheSessoes() {
  cacheSessoes.clear();
}

/**
 * Valida o bearer token da requisição atual.
 * Devolve null quando não há sessão — nunca lança, para o caller decidir.
 */
export async function resolveRequester(): Promise<Requester | null> {
  const SUPABASE_URL = process.env["SUPABASE_URL"];
  const SUPABASE_PUBLISHABLE_KEY = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Supabase não configurado no servidor.");
  }

  const { getRequest } = await import("@tanstack/react-start/server");
  const { createClient } = await import("@supabase/supabase-js");

  const request = getRequest();
  const authHeader = request?.headers?.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.slice("Bearer ".length).trim();
  if (token.split(".").length !== 3) return null;

  // Sessão já validada há pouco: evita as duas idas ao Supabase.
  const emCache = lerCache(token);
  if (emCache) {
    return { ...emCache, ip: ipFromHeaders(request.headers) };
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: {
      fetch: createSupabaseFetch(SUPABASE_PUBLISHABLE_KEY),
      headers: { Authorization: `Bearer ${token}` },
    },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getClaims(token);
  const claims = data?.claims as any;
  if (error || !claims?.sub) return null;

  const userId = String(claims.sub);
  const email = String(claims.email ?? "").toLowerCase().trim();

  const requester: Requester = {
    userId,
    email,
    isAdmin: await isAdminUser(userId, email),
    ip: ipFromHeaders(request.headers),
  };

  gravarCache(token, requester);
  return requester;
}

/**
 * Administrador do sistema (visão global). NÃO é o padrão:
 * todo usuário comum é apenas dono das próprias conexões.
 *
 * A tabela admin_users existe em duas formas neste projeto
 * (antiga: id/email/status — nova: user_id/email/role). O `select("*")`
 * e a busca por e-mail funcionam nas duas.
 */
export async function isAdminUser(userId: string, email: string): Promise<boolean> {
  if (!email) return false;
  const { db } = await import("./db.server");

  const { data, error } = await db("admin_users").select("*").eq("email", email).limit(1);
  if (error) return false;

  const row: any = data?.[0];
  if (!row) return await bootstrapAdmin(userId, email);
  if (row.status != null && row.status !== "active") return false;

  // Amarra o registro antigo (só e-mail) ao usuário do Auth, uma vez.
  if (row.user_id == null && "user_id" in row) {
    await db("admin_users").update({ user_id: userId }).eq("email", email);
  }
  return true;
}

/** Bootstrap: só funciona ENQUANTO não existir nenhum admin cadastrado. */
async function bootstrapAdmin(userId: string, email: string): Promise<boolean> {
  const { db } = await import("./db.server");
  const { getAdminBootstrapEmail } = await import("./config.server");

  const bootstrapEmail = getAdminBootstrapEmail();
  if (!bootstrapEmail || bootstrapEmail !== email) return false;

  const { count } = await db("admin_users").select("email", { count: "exact", head: true });
  if (count) return false;

  const { error } = await db("admin_users").insert({
    user_id: userId,
    email,
    role: "admin",
    status: "active",
  });
  if (error) return false;

  const { logAudit } = await import("./audit.server");
  await logAudit({
    adminUserId: userId,
    adminEmail: email,
    action: "admin.bootstrap",
    entity: "admin_users",
    entityId: userId,
  });
  return true;
}

/* -------------------------------------------------------------------------- */
/* Escopo de dados                                                             */
/* -------------------------------------------------------------------------- */

/**
 * IDs das conexões que o requisitante pode enxergar.
 *
 * - cliente comum -> apenas as conexões com owner_user_id = ele
 * - admin         -> todas (visão global explícita)
 *
 * Devolve `null` quando é admin (= sem filtro). Devolve `[]` quando o cliente
 * não tem nenhuma conta — e `[]` PRECISA resultar em lista vazia, nunca em
 * "sem filtro". É essa distinção que impede o vazamento entre clientes.
 */
export async function accountScope(user: Requester): Promise<string[] | null> {
  if (user.isAdmin) return null;
  const { db } = await import("./db.server");
  const { data } = await db("ml_connections").select("id").eq("owner_user_id", user.userId);
  return (data ?? []).map((r: any) => String(r.id));
}

/**
 * Carrega uma conexão GARANTINDO que o requisitante é o dono
 * (ou é admin). Lança em vez de devolver null: acesso indevido é erro.
 */
export async function requireOwnedAccount(user: Requester, accountId: string) {
  const { db } = await import("./db.server");
  const { data } = await db("ml_connections")
    .select("id, owner_user_id, ml_user_id, nickname, status")
    .eq("id", String(accountId))
    .maybeSingle();

  if (!data) throw new Error("Conta não encontrada.");
  if (!user.isAdmin && String(data.owner_user_id ?? "") !== user.userId) {
    // Mesma mensagem de "não encontrada": não confirmamos a existência
    // de recursos de outro cliente (evita enumeração de IDs).
    throw new Error("Conta não encontrada.");
  }
  return data;
}
