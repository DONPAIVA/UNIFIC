/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Cliente da API oficial do Mercado Livre.
 * Tokens NUNCA saem do servidor: leitura, refresh e uso acontecem só aqui.
 */
import { db } from "./db.server";
import { getMlCredentials } from "./config.server";

export const ML_API = "https://api.mercadolibre.com";
export const ML_AUTH_URL = "https://auth.mercadolivre.com.br/authorization";

export type MlAccount = {
  id: string;
  provider: string;
  ml_user_id: string;
  nickname: string | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  status: string | null;
  site_id: string | null;
  /** Permissões concedidas na autorização (não é segredo). */
  scope?: string | null;
};

/**
 * Margem de segurança: renova quando faltarem menos de 10 minutos.
 * Com o cron rodando a cada 5 min, toda conta é renovada bem antes de vencer.
 */
const REFRESH_MARGIN_MS = 10 * 60 * 1000;

/** Tempo máximo que uma trava de renovação fica de pé (protege contra travas órfãs). */
const LOCK_TTL_MS = 2 * 60 * 1000;

export type MotivoFalhaRefresh = "reauth" | "temporario" | "config";

export type ResultadoRefresh =
  | { ok: true; account: MlAccount; rotacionouRefreshToken: boolean }
  | { ok: false; motivo: MotivoFalhaRefresh; mensagem: string; httpStatus: number | null };

/**
 * Classifica a recusa do Mercado Livre no /oauth/token.
 *
 * Esta separação é o coração do requisito "não confundir access_token expirado
 * com conta revogada":
 *   - invalid_grant  -> o refresh_token foi revogado/queimado de verdade
 *   - invalid_client -> nosso ML_CLIENT_ID/SECRET está errado (problema nosso)
 *   - 429 / 5xx      -> indisponibilidade momentânea, tentar de novo depois
 */
function classificarFalha(status: number, corpo: string): { motivo: MotivoFalhaRefresh; mensagem: string } {
  let erro = "";
  try {
    const j = JSON.parse(corpo);
    erro = String(j?.error ?? j?.message ?? "").toLowerCase();
  } catch {
    erro = corpo.slice(0, 120).toLowerCase();
  }

  if (erro.includes("invalid_grant") || erro.includes("invalid_refresh_token") || erro.includes("revoked")) {
    return { motivo: "reauth", mensagem: "Refresh token rejeitado pelo Mercado Livre. Reautorização necessária." };
  }
  if (erro.includes("invalid_client") || erro.includes("unauthorized_client")) {
    return { motivo: "config", mensagem: "Credenciais do aplicativo recusadas (ML_CLIENT_ID/ML_CLIENT_SECRET)." };
  }
  if (status === 429 || status >= 500) {
    return { motivo: "temporario", mensagem: `Mercado Livre indisponível no momento (HTTP ${status}).` };
  }
  if (status === 400 || status === 401) {
    // 400/401 sem invalid_grant explícito: tratamos como temporário e deixamos
    // o contador de tentativas decidir. Marcar reauth aqui poderia desconectar
    // uma conta boa por causa de uma resposta atípica.
    return { motivo: "temporario", mensagem: `Renovação recusada (HTTP ${status}).` };
  }
  return { motivo: "temporario", mensagem: `Falha ao renovar (HTTP ${status}).` };
}

/**
 * Trava a conta para renovação. Devolve false se outra execução já está
 * cuidando dela — é o que impede duas rodadas do cron de rotacionar o mesmo
 * refresh_token ao mesmo tempo e queimar um dos dois.
 */
export async function tentarTravarConta(accountId: string): Promise<boolean> {
  const agora = new Date();
  const limite = new Date(agora.getTime() - LOCK_TTL_MS).toISOString();
  const { data, error } = await db("ml_connections")
    .update({ refresh_lock_at: agora.toISOString() })
    .eq("id", accountId)
    .or(`refresh_lock_at.is.null,refresh_lock_at.lt.${limite}`)
    .select("id");

  if (error) {
    // Coluna ainda não criada (migration pendente): seguimos sem trava.
    // Perder a trava é aceitável; perder o refresh_token não seria.
    console.warn("[refresh] trava indisponível (rode a migration 20260815160000):", error.message);
    return true;
  }
  return Array.isArray(data) ? data.length > 0 : Boolean(data);
}

async function destravar(accountId: string) {
  await db("ml_connections").update({ refresh_lock_at: null }).eq("id", accountId);
}

export async function getAccount(accountId: string): Promise<MlAccount> {
  const { data, error } = await db("ml_connections").select("*").eq("id", accountId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Conta não encontrada.");
  return data as MlAccount;
}

export async function getAccountByMlUserId(mlUserId: string): Promise<MlAccount | null> {
  const { data } = await db("ml_connections")
    .select("*")
    .eq("provider", "mercado_livre")
    .eq("ml_user_id", String(mlUserId))
    .maybeSingle();
  return (data as MlAccount) ?? null;
}

/**
 * Renova o par de tokens. NÃO lança: devolve um resultado classificado, para
 * quem chama decidir (o cron precisa distinguir "tente de novo" de "acabou").
 *
 * Suporta rotação: se o Mercado Livre devolver um refresh_token novo, o antigo
 * é substituído na mesma gravação.
 */
export async function tentarRenovar(
  account: MlAccount,
  opts: { origem?: string } = {},
): Promise<ResultadoRefresh> {
  const { logEvent } = await import("./logs.server");
  const origem = opts.origem ?? "sistema";

  if (!account.refresh_token) {
    await marcarResultadoRefresh(account.id, {
      status: "reauth_required",
      erro: "Conta sem refresh_token — o cliente precisa autorizar novamente.",
      reauth: true,
    });
    await logEvent({
      category: "refresh_token",
      action: "refresh.sem_refresh_token",
      accountId: account.id,
      mlUserId: account.ml_user_id,
      success: false,
      error: "Conta sem refresh_token.",
      actor: origem,
    });
    return {
      ok: false,
      motivo: "reauth",
      mensagem: "Conta sem refresh_token. É necessário reconectar a conta.",
      httpStatus: null,
    };
  }

  let clientId: string;
  let clientSecret: string;
  try {
    ({ clientId, clientSecret } = getMlCredentials());
  } catch (e) {
    return {
      ok: false,
      motivo: "config",
      mensagem: e instanceof Error ? e.message : "Integração não configurada.",
      httpStatus: null,
    };
  }

  const startedAt = Date.now();
  let res: Response;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      res = await fetch(`${ML_API}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: account.refresh_token,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    // Rede/timeout: nunca é motivo para desconectar a conta.
    const mensagem = e instanceof Error && e.name === "AbortError" ? "Tempo esgotado ao renovar." : "Falha de rede ao renovar.";
    await marcarResultadoRefresh(account.id, { status: "erro_temporario", erro: mensagem });
    await logEvent({
      category: "refresh_token",
      action: "refresh.erro_temporario",
      accountId: account.id,
      mlUserId: account.ml_user_id,
      endpoint: "/oauth/token",
      method: "POST",
      durationMs: Date.now() - startedAt,
      success: false,
      error: mensagem,
      actor: origem,
    });
    return { ok: false, motivo: "temporario", mensagem, httpStatus: null };
  }

  if (!res.ok) {
    const corpo = await safeText(res);
    const { motivo, mensagem } = classificarFalha(res.status, corpo);

    await marcarResultadoRefresh(account.id, {
      status: motivo === "reauth" ? "reauth_required" : "erro_temporario",
      erro: mensagem,
      reauth: motivo === "reauth",
    });

    await logEvent({
      category: "refresh_token",
      action: motivo === "reauth" ? "refresh.reautorizacao_necessaria" : "refresh.falha",
      accountId: account.id,
      mlUserId: account.ml_user_id,
      endpoint: "/oauth/token",
      method: "POST",
      httpStatus: res.status,
      durationMs: Date.now() - startedAt,
      success: false,
      error: mensagem,
      actor: origem,
      // O corpo passa pelo redator de segredos antes de ser gravado.
      detail: { motivo, body: corpo.slice(0, 300) },
    });

    return { ok: false, motivo, mensagem, httpStatus: res.status };
  }

  const tok = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };

  // Rotação: o ML pode (e costuma) devolver um refresh_token novo.
  const rotacionou = Boolean(tok.refresh_token && tok.refresh_token !== account.refresh_token);
  const agora = new Date().toISOString();

  /*
   * Gravação em DUAS etapas, de propósito.
   *
   * Etapa 1 grava só o que é essencial e usa colunas que existem desde sempre.
   * Se a etapa 2 falhar (por exemplo, uma coluna de metadados ainda não criada
   * pela migration), o par de tokens JÁ está salvo. Numa única gravação, um
   * erro de schema descartaria o refresh_token novo e quebraria a conta —
   * o Mercado Livre já teria invalidado o antigo.
   */
  const patch = {
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? account.refresh_token,
    expires_at: new Date(Date.now() + (tok.expires_in ?? 21600) * 1000).toISOString(),
    scope: tok.scope ?? null,
    status: "active",
    last_error: null,
    reauth_required_at: null,
    updated_at: agora,
  };

  const { error: erroGravacao } = await db("ml_connections").update(patch).eq("id", account.id);
  if (erroGravacao) {
    // Falha aqui é grave: o ML já rotacionou e não conseguimos guardar.
    await logEvent({
      category: "refresh_token",
      action: "refresh.falha_ao_gravar",
      accountId: account.id,
      mlUserId: account.ml_user_id,
      success: false,
      error: `Token renovado no Mercado Livre mas não foi possível gravar: ${erroGravacao.message}`,
      actor: origem,
    });
    return {
      ok: false,
      motivo: "config",
      mensagem: `Token renovado, mas a gravação falhou: ${erroGravacao.message}`,
      httpStatus: res.status,
    };
  }

  // Etapa 2: metadados de acompanhamento. Best-effort.
  const { error: erroMeta } = await db("ml_connections")
    .update({
      last_refresh_at: agora,
      last_refresh_status: "ok",
      last_refresh_error: null,
      refresh_attempts: 0,
      refresh_lock_at: null,
    })
    .eq("id", account.id);
  if (erroMeta) {
    console.warn("[refresh] metadados não gravados (rode a migration 20260815160000):", erroMeta.message);
  }

  await logEvent({
    category: "refresh_token",
    action: "refresh.ok",
    accountId: account.id,
    mlUserId: account.ml_user_id,
    endpoint: "/oauth/token",
    method: "POST",
    httpStatus: res.status,
    durationMs: Date.now() - startedAt,
    actor: origem,
    detail: { expires_at: patch.expires_at, rotacionou_refresh_token: rotacionou },
  });

  return { ok: true, account: { ...account, ...patch } as MlAccount, rotacionouRefreshToken: rotacionou };
}

/** Grava o desfecho da tentativa de renovação, sem tocar nos tokens. */
async function marcarResultadoRefresh(
  accountId: string,
  info: { status: "ok" | "erro_temporario" | "reauth_required"; erro?: string | null; reauth?: boolean },
) {
  const agora = new Date().toISOString();
  const patch: Record<string, unknown> = {
    last_refresh_at: agora,
    last_refresh_status: info.status,
    last_refresh_error: info.erro ? String(info.erro).slice(0, 500) : null,
    refresh_lock_at: null,
    updated_at: agora,
  };
  if (info.reauth) {
    patch["status"] = "reauth_required";
    patch["reauth_required_at"] = agora;
    patch["last_error"] = info.erro ?? "Reautorização necessária.";
  }
  await db("ml_connections").update(patch).eq("id", accountId);

  // Contador de tentativas: usado pelo cron para espaçar novas tentativas.
  if (info.status === "erro_temporario") {
    const { data } = await db("ml_connections").select("refresh_attempts").eq("id", accountId).maybeSingle();
    const tentativas = Number(data?.refresh_attempts ?? 0) + 1;
    await db("ml_connections").update({ refresh_attempts: tentativas }).eq("id", accountId);
  }
}

/**
 * Versão que lança — mantida para os chamadores existentes (mlFetch, CentralML).
 * O comportamento visível não mudou.
 */
export async function refreshAccessToken(account: MlAccount): Promise<MlAccount> {
  const r = await tentarRenovar(account, { origem: "sob-demanda" });
  if (r.ok) return r.account;
  throw new Error(
    r.motivo === "reauth"
      ? "A autorização do Mercado Livre expirou ou foi revogada. O cliente precisa conectar a conta novamente."
      : r.mensagem,
  );
}

/** Devolve a conta com access_token válido (renova quando está perto de expirar). */
export async function ensureFreshAccount(account: MlAccount): Promise<MlAccount> {
  const expires = account.expires_at ? new Date(account.expires_at).getTime() : 0;
  if (expires - Date.now() > REFRESH_MARGIN_MS) return account;
  return refreshAccessToken(account);
}

export type MlCallResult<T = any> = { ok: boolean; status: number; data: T | null; error: string | null };

const RATE_LIMIT_MAX_RETRIES = 2;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Chamada autenticada à API do ML.
 * - renova o token ANTES de expirar (ensureFreshAccount)
 * - em 401: tenta o refresh UMA única vez e repete a operação (sem loop)
 * - em 429/503: respeita Retry-After, com no máximo RATE_LIMIT_MAX_RETRIES tentativas
 * - registra api_request/api_response em system_logs (sem token algum)
 */
export async function mlFetch<T = any>(
  account: MlAccount,
  path: string,
  init: RequestInit & { newFormat?: boolean; timeoutMs?: number; actor?: string } = {},
): Promise<MlCallResult<T>> {
  const { logEvent } = await import("./logs.server");
  const method = (init.method ?? "GET").toUpperCase();
  const startedAt = Date.now();
  const timeoutMs = init.timeoutMs ?? 20000;

  let current = await ensureFreshAccount(account);

  const call = async (acc: MlAccount) => {
    const headers = new Headers(init.headers as HeadersInit | undefined);
    headers.set("Authorization", `Bearer ${acc.access_token}`);
    headers.set("Accept", "application/json");
    if (init.newFormat) headers.set("x-format-new", "true");
    if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(path.startsWith("http") ? path : `${ML_API}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let res: Response;
  let refreshed = false;
  let rateLimitRetries = 0;

  try {
    res = await call(current);

    // 401 -> refresh UMA vez -> repete. Nunca mais de uma vez: sem loop infinito.
    if (res.status === 401 && current.refresh_token && !refreshed) {
      refreshed = true;
      current = await refreshAccessToken(current);
      res = await call(current);
    }

    // Rate limit / indisponibilidade temporária
    while ((res.status === 429 || res.status === 503) && rateLimitRetries < RATE_LIMIT_MAX_RETRIES) {
      rateLimitRetries++;
      const retryAfter = Number(res.headers.get("retry-after") ?? 0);
      const waitMs = retryAfter > 0 ? Math.min(retryAfter * 1000, 10000) : rateLimitRetries * 1500;
      await logEvent({
        category: "api_response",
        action: "ml.rate_limit",
        accountId: current.id,
        mlUserId: current.ml_user_id,
        endpoint: path,
        method,
        httpStatus: res.status,
        success: false,
        message: `Aguardando ${waitMs}ms antes de repetir (tentativa ${rateLimitRetries}).`,
        actor: init.actor ?? "sistema",
      });
      await sleep(waitMs);
      res = await call(current);
    }
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    const message = aborted ? `Tempo esgotado após ${timeoutMs}ms.` : e instanceof Error ? e.message : "Falha de rede.";
    await logEvent({
      category: "api_response",
      action: "ml.falha_rede",
      accountId: current.id,
      mlUserId: current.ml_user_id,
      endpoint: path,
      method,
      durationMs: Date.now() - startedAt,
      success: false,
      error: message,
      actor: init.actor ?? "sistema",
    });
    return { ok: false, status: 0, data: null, error: message };
  }

  const text = await safeText(res);
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  const durationMs = Date.now() - startedAt;

  if (!res.ok) {
    // Mensagem sem segredos — nunca inclui tokens.
    const message = (data?.message ?? data?.error ?? text ?? "erro").toString().slice(0, 400);
    await logEvent({
      category: "api_response",
      action: "ml.erro",
      accountId: current.id,
      mlUserId: current.ml_user_id,
      endpoint: path,
      method,
      httpStatus: res.status,
      durationMs,
      success: false,
      error: `${res.status}: ${message}`,
      actor: init.actor ?? "sistema",
    });
    return { ok: false, status: res.status, data, error: `${res.status}: ${message}` };
  }

  await logEvent({
    category: "api_request",
    action: "ml.ok",
    accountId: current.id,
    mlUserId: current.ml_user_id,
    endpoint: path,
    method,
    httpStatus: res.status,
    durationMs,
    actor: init.actor ?? "sistema",
    detail: refreshed ? { token_renovado: true } : null,
  });

  await touchAccountActivity(current.id);
  return { ok: true, status: res.status, data, error: null };
}

export async function markAccountError(accountId: string, message: string) {
  await db("ml_connections")
    .update({ status: "error", last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
    .eq("id", accountId);
}

/**
 * Marca a conta como REAUTORIZAÇÃO NECESSÁRIA.
 * Usado quando o refresh_token foi revogado/invalidado — não fingimos
 * que a conta continua conectada.
 */
export async function markReauthRequired(accountId: string, message: string) {
  await db("ml_connections")
    .update({
      status: "reauth_required",
      last_error: message.slice(0, 500),
      reauth_required_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountId);
}

async function touchAccountActivity(accountId: string) {
  try {
    await db("ml_connections").update({ last_activity_at: new Date().toISOString() }).eq("id", accountId);
  } catch {
    /* atividade é informativa; nunca derruba a chamada */
  }
}

async function safeText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/* -------------------------------------------------------------------------- */
/* Endpoints usados                                                            */
/* -------------------------------------------------------------------------- */

export function fetchMe(account: MlAccount) {
  return mlFetch(account, "/users/me");
}

/**
 * Busca de pedidos do COMPRADOR (paginada).
 * O token é do comprador que autorizou o app, então o filtro é `buyer`, não `seller`.
 */
export function fetchOrders(
  account: MlAccount,
  opts: { offset?: number; limit?: number; createdFrom?: string | null },
) {
  const params = new URLSearchParams({
    buyer: String(account.ml_user_id),
    sort: "date_desc",
    offset: String(opts.offset ?? 0),
    limit: String(opts.limit ?? 50),
  });
  if (opts.createdFrom) params.set("order.date_created.from", opts.createdFrom);
  return mlFetch(account, `/orders/search?${params.toString()}`);
}

export function fetchOrder(account: MlAccount, orderId: string) {
  return mlFetch(account, `/orders/${orderId}`);
}

export function fetchShipment(account: MlAccount, shipmentId: string) {
  return mlFetch(account, `/shipments/${shipmentId}`, { newFormat: true });
}

export function fetchShipmentHistory(account: MlAccount, shipmentId: string) {
  return mlFetch(account, `/shipments/${shipmentId}/history`);
}

/**
 * Confirma o recebimento do pedido pela API OFICIAL do Mercado Livre.
 * Endpoint: POST /orders/{orderId}/feedback  — ação do COMPRADOR.
 * `fulfilled: true` informa que o pedido foi cumprido/recebido.
 * O feedback é ÚNICO e irreversível no lado do Mercado Livre.
 */
export function submitOrderFeedback(
  account: MlAccount,
  orderId: string,
  opts: { fulfilled?: boolean; rating?: "positive" | "neutral" | "negative"; message?: string } = {},
) {
  const body: Record<string, unknown> = {
    fulfilled: opts.fulfilled ?? true,
    rating: opts.rating ?? "positive",
  };
  if (opts.message) body["message"] = opts.message.slice(0, 160);

  return mlFetch(account, `/orders/${orderId}/feedback`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** Regra de elegibilidade da ação "Marcar como recebido" (feedback do comprador). */
export function canMarkReceived(order: {
  ml_order_id?: string | null;
  status?: string | null;
  buyer_feedback_at?: string | null;
}) {
  const status = (order.status ?? "").toLowerCase();
  const blocked = status === "cancelled" || status === "invalid" || status === "payment_required";
  return Boolean(order.ml_order_id) && !order.buyer_feedback_at && !blocked;
}

/** Detalhe de uma pergunta (usado ao processar a notificação questions). */
export async function fetchQuestion(account: MlAccount, questionId: string) {
  return mlFetch(account, `/questions/${questionId}`);
}

/** Detalhe de um anúncio (tópicos items / items_prices). */
export function fetchItem(account: MlAccount, itemId: string) {
  return mlFetch(account, `/items/${itemId}`);
}

/**
 * Detalhe de um pagamento.
 *
 * O Mercado Livre notifica o tópico `payments` com dois formatos de recurso:
 * `/collections/{id}` (formato antigo, ainda em uso) e `/payments/{id}`.
 * Os dois caem no mesmo registro do Mercado Pago, mas nem toda conta enxerga
 * os dois caminhos — então tentamos na ordem e ficamos com o primeiro que
 * responder. Devolver o erro do último é suficiente: quem chama não interrompe
 * o processamento por causa disso.
 */
export async function fetchPayment(account: MlAccount, paymentId: string) {
  const caminhos = [`/collections/${paymentId}`, `/v1/payments/${paymentId}`, `/payments/${paymentId}`];
  let ultimo: MlCallResult = { ok: false, status: 0, data: null, error: "Pagamento não consultado." };
  for (const caminho of caminhos) {
    const r = await mlFetch(account, caminho);
    if (r.ok && r.data) return r;
    ultimo = r;
    // 401/403 indicam falta de permissão para esta conta: trocar de caminho não resolve.
    if (r.status === 401 || r.status === 403) break;
  }
  return ultimo;
}

/** Feedback (avaliação) de um pedido — comprador e vendedor. */
export function fetchOrderFeedback(account: MlAccount, orderId: string) {
  return mlFetch(account, `/orders/${orderId}/feedback`);
}

/** Conversa pós-venda de um pedido. Requer o pack_id (ou o próprio order_id). */
export function fetchPackMessages(account: MlAccount, packId: string, sellerId: string) {
  return mlFetch(account, `/messages/packs/${packId}/sellers/${sellerId}?tag=post_sale`);
}

/** Uma mensagem específica, quando o recurso notificado aponta para ela. */
export function fetchMessage(account: MlAccount, messageId: string) {
  return mlFetch(account, `/messages/${messageId}`);
}

/** Detalhe de uma reclamação (pós-venda). */
export function fetchClaim(account: MlAccount, claimId: string) {
  return mlFetch(account, `/post-purchase/v1/claims/${claimId}`);
}

/** Ações que o Mercado Livre permite executar numa reclamação. */
export function fetchClaimActions(account: MlAccount, claimId: string) {
  return mlFetch(account, `/post-purchase/v1/claims/${claimId}/actions`);
}

/**
 * Lê o recurso notificado exatamente como o Mercado Livre mandou.
 *
 * É o que permite tratar os tópicos da cauda longa (preços, catálogo,
 * promoções, leads, estoque, notas fiscais...) sem precisar de um fetcher
 * dedicado por tópico: o recurso da notificação JÁ é o caminho da API.
 *
 * Só aceita caminho relativo — nunca uma URL absoluta vinda de fora, que
 * poderia apontar para outro host.
 */
export function fetchRecurso(account: MlAccount, resource: string) {
  const caminho = String(resource ?? "").trim();
  if (!caminho.startsWith("/") || caminho.startsWith("//") || caminho.includes("..")) {
    return Promise.resolve<MlCallResult>({
      ok: false,
      status: 0,
      data: null,
      error: `Recurso inválido para leitura direta: ${caminho.slice(0, 120)}`,
    });
  }
  return mlFetch(account, caminho);
}