/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Sincronização real com a API do Mercado Livre.
 * - inicial: varre o histórico (limitado por páginas)
 * - incremental: só a partir da última sincronização bem-sucedida
 * - webhook: processa apenas o recurso notificado
 * Idempotente: upsert por (account_id, ml_order_id) / (account_id, ml_shipment_id)
 * e eventos por fingerprint.
 */
import { db } from "./db.server";
import {
  fetchOrders,
  fetchOrder,
  fetchShipment,
  fetchShipmentHistory,
  getAccount,
  getAccountByMlUserId,
  type MlAccount,
} from "./ml-api.server";

const PAGE_SIZE = 50;
const MAX_PAGES_INITIAL = 20; // teto de segurança: 1000 pedidos por execução
const MAX_PAGES_INCREMENTAL = 4;

type SyncKind = "initial" | "incremental" | "manual" | "webhook";

export type SyncResult = {
  runId: string | null;
  status: "success" | "error";
  orders: number;
  shipments: number;
  events: number;
  error: string | null;
};

async function startRun(accountId: string | null, kind: SyncKind, trigger: string) {
  const { data } = await db("ml_sync_runs")
    .insert({ account_id: accountId, kind, trigger, status: "running" })
    .select("id")
    .maybeSingle();
  return (data?.id as string) ?? null;
}

async function finishRun(
  runId: string | null,
  startedAt: number,
  patch: Partial<{
    status: string;
    orders_processed: number;
    shipments_processed: number;
    events_processed: number;
    error: string | null;
    detail: any;
  }>,
) {
  if (!runId) return;
  await db("ml_sync_runs")
    .update({
      ...patch,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    })
    .eq("id", runId);
}

function fingerprint(parts: Array<string | null | undefined>) {
  return parts.map((p) => (p ?? "").toString().trim()).join("|").slice(0, 300);
}

function iso(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/* -------------------------------------------------------------------------- */
/* Upserts                                                                     */
/* -------------------------------------------------------------------------- */

function mapOrder(account: MlAccount, o: any) {
  const items = Array.isArray(o.order_items) ? o.order_items : [];
  return {
    account_id: account.id,
    provider: "mercado_livre",
    ml_order_id: String(o.id),
    status: o.status ?? null,
    status_detail: typeof o.status_detail === "string" ? o.status_detail : o.status_detail?.description ?? null,
    date_created: iso(o.date_created),
    date_closed: iso(o.date_closed),
    last_updated: iso(o.last_updated),
    total_amount: typeof o.total_amount === "number" ? o.total_amount : null,
    currency_id: o.currency_id ?? null,
    buyer_id: o.buyer?.id ? String(o.buyer.id) : null,
    buyer_nickname: o.buyer?.nickname ?? null,
    buyer_name: [o.buyer?.first_name, o.buyer?.last_name].filter(Boolean).join(" ") || null,
    title: items[0]?.item?.title ?? null,
    quantity: items.reduce((acc: number, it: any) => acc + (Number(it?.quantity) || 0), 0) || null,
    items: items.map((it: any) => ({
      id: it?.item?.id ?? null,
      title: it?.item?.title ?? null,
      quantity: it?.quantity ?? null,
      unit_price: it?.unit_price ?? null,
    })),
    shipping_id: o.shipping?.id ? String(o.shipping.id) : null,
    pack_id: o.pack_id ? String(o.pack_id) : null,
    // Feedback já registrado no ML (o comprador só pode enviar uma vez)
    buyer_feedback_at: iso(o.feedback?.purchase?.date_created),
    buyer_feedback_status:
      o.feedback?.purchase?.fulfilled == null
        ? null
        : o.feedback.purchase.fulfilled
          ? "fulfilled"
          : "not_fulfilled",
    buyer_feedback_rating: o.feedback?.purchase?.rating ?? null,
    raw: o,
    synced_at: new Date().toISOString(),
  };
}

async function upsertOrder(account: MlAccount, o: any) {
  const row = mapOrder(account, o);
  const { data, error } = await db("ml_orders")
    .upsert(row, { onConflict: "account_id,ml_order_id" })
    .select("id, shipping_id")
    .maybeSingle();
  if (error) throw new Error(`Pedido ${row.ml_order_id}: ${error.message}`);

  /*
   * Pagamentos vêm DENTRO do pedido (o.payments[]) e são gravados aqui.
   *
   * Esse é o caminho confiável: consultar /collections/{id} direto costuma
   * responder 403 para contas que não são donas do aplicativo. Gravando a
   * partir do pedido, nenhum pagamento depende do webhook para existir.
   * Falha aqui nunca derruba a sincronização do pedido.
   */
  try {
    const { salvarPagamentosDoPedido } = await import("./ml-topics.server");
    await salvarPagamentosDoPedido(account, o, data?.id ?? null);
  } catch (e) {
    console.warn("[sync] pagamentos do pedido não gravados:", e instanceof Error ? e.message : "erro");
  }

  return data as { id: string; shipping_id: string | null };
}

function mapShipment(account: MlAccount, s: any, orderRowId: string | null) {
  const addr = s.receiver_address ?? s.destination?.shipping_address ?? {};
  return {
    account_id: account.id,
    order_id: orderRowId,
    provider: "mercado_livre",
    ml_shipment_id: String(s.id),
    ml_order_id: s.order_id ? String(s.order_id) : null,
    mode: s.mode ?? null,
    logistic_type: s.logistic_type ?? s.shipping_option?.shipping_method?.type ?? null,
    status: s.status ?? null,
    substatus: typeof s.substatus === "string" ? s.substatus : s.substatus?.description ?? null,
    tracking_number: s.tracking_number ?? null,
    tracking_method: s.tracking_method ?? null,
    date_created: iso(s.date_created),
    last_updated: iso(s.last_updated ?? s.status_history?.date_delivered),
    estimated_delivery: iso(s.estimated_delivery_time?.date ?? s.shipping_option?.estimated_delivery_time?.date),
    receiver_name: addr.receiver_name ?? null,
    receiver_city: addr.city?.name ?? addr.city ?? null,
    receiver_state: addr.state?.id ?? addr.state?.name ?? addr.state ?? null,
    receiver_zip: addr.zip_code ?? null,
    raw: s,
    synced_at: new Date().toISOString(),
  };
}

async function upsertShipment(account: MlAccount, s: any, orderRowId: string | null) {
  const row = mapShipment(account, s, orderRowId);
  const { data, error } = await db("ml_shipments")
    .upsert(row, { onConflict: "account_id,ml_shipment_id" })
    .select("id, ml_shipment_id")
    .maybeSingle();
  if (error) throw new Error(`Shipment ${row.ml_shipment_id}: ${error.message}`);
  return data as { id: string; ml_shipment_id: string };
}

/** Grava eventos ignorando duplicados (idempotência por fingerprint). */
async function upsertEvents(
  account: MlAccount,
  shipmentRowId: string,
  mlShipmentId: string,
  events: Array<{ status?: string; substatus?: string; description?: string; date?: string; raw?: any }>,
) {
  if (!events.length) return 0;
  const rows = events.map((e) => ({
    account_id: account.id,
    shipment_id: shipmentRowId,
    ml_shipment_id: mlShipmentId,
    status: e.status ?? null,
    substatus: e.substatus ?? null,
    description: e.description ?? null,
    event_date: iso(e.date),
    source: "ml_api",
    fingerprint: fingerprint([e.status, e.substatus, e.date, e.description]),
    raw: e.raw ?? null,
  }));
  const { error } = await db("ml_shipment_events").upsert(rows, {
    onConflict: "shipment_id,fingerprint",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`Eventos ${mlShipmentId}: ${error.message}`);
  return rows.length;
}

/** Extrai eventos do histórico oficial e, como complemento, do status_history do shipment. */
function extractEvents(shipment: any, history: any) {
  const out: Array<{ status?: string; substatus?: string; description?: string; date?: string; raw?: any }> = [];

  const list = Array.isArray(history) ? history : Array.isArray(history?.history) ? history.history : [];
  for (const h of list) {
    out.push({
      status: h.status ?? h.to ?? undefined,
      substatus: h.substatus ?? undefined,
      description: h.comment ?? h.description ?? undefined,
      date: h.date ?? h.date_created ?? h.date_shipped ?? undefined,
      raw: h,
    });
  }

  const sh = shipment?.status_history ?? {};
  const map: Record<string, string> = {
    date_handling: "handling",
    date_ready_to_ship: "ready_to_ship",
    date_shipped: "shipped",
    date_first_visit: "first_visit",
    date_delivered: "delivered",
    date_not_delivered: "not_delivered",
    date_returned: "returned",
    date_cancelled: "cancelled",
  };
  for (const [key, status] of Object.entries(map)) {
    if (sh?.[key]) out.push({ status, date: sh[key], raw: { from: "status_history" } });
  }

  if (!out.length && shipment?.status) {
    out.push({
      status: shipment.status,
      substatus: typeof shipment.substatus === "string" ? shipment.substatus : undefined,
      date: shipment.last_updated ?? shipment.date_created,
      raw: { from: "shipment" },
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Sincronização de um shipment                                                */
/* -------------------------------------------------------------------------- */

export async function syncShipment(
  account: MlAccount,
  shipmentId: string,
  orderRowId: string | null,
): Promise<{ shipments: number; events: number }> {
  const shipRes = await fetchShipment(account, shipmentId);
  if (!shipRes.ok || !shipRes.data) {
    // 403/404 são comuns (envio de terceiros, conta sem permissão) — não derruba a sync inteira.
    return { shipments: 0, events: 0 };
  }
  const row = await upsertShipment(account, shipRes.data, orderRowId);
  if (!row) return { shipments: 1, events: 0 };

  const histRes = await fetchShipmentHistory(account, shipmentId);
  const events = extractEvents(shipRes.data, histRes.ok ? histRes.data : null);
  const count = await upsertEvents(account, row.id, row.ml_shipment_id, events);
  return { shipments: 1, events: count };
}

/* -------------------------------------------------------------------------- */
/* Sincronização de conta                                                      */
/* -------------------------------------------------------------------------- */

export async function syncAccount(
  accountId: string,
  opts: { kind?: SyncKind; trigger?: string; full?: boolean } = {},
): Promise<SyncResult> {
  const { logEvent } = await import("./logs.server");
  const account = await getAccount(accountId);
  const kind: SyncKind = opts.kind ?? (opts.full ? "initial" : "incremental");
  const startedAt = Date.now();
  const runId = await startRun(account.id, kind, opts.trigger ?? "manual");

  let orders = 0;
  let shipments = 0;
  let events = 0;

  // A CentralML mostra SINCRONIZANDO enquanto a execução está em curso.
  await db("ml_connections")
    .update({ status: "syncing", updated_at: new Date().toISOString() })
    .eq("id", account.id);

  await logEvent({
    category: "sync",
    action: `sync.${kind}.inicio`,
    accountId: account.id,
    mlUserId: account.ml_user_id,
    actor: opts.trigger ?? "manual",
  });

  try {
    const { data: last } = await db("ml_connections").select("last_sync_at").eq("id", account.id).maybeSingle();
    const createdFrom =
      opts.full || !last?.last_sync_at
        ? null
        : new Date(new Date(last.last_sync_at).getTime() - 24 * 60 * 60 * 1000).toISOString();

    const maxPages = createdFrom ? MAX_PAGES_INCREMENTAL : MAX_PAGES_INITIAL;
    const seenShipments = new Set<string>();

    for (let page = 0; page < maxPages; page++) {
      const res = await fetchOrders(account, { offset: page * PAGE_SIZE, limit: PAGE_SIZE, createdFrom });
      if (!res.ok) throw new Error(res.error ?? "Falha ao consultar pedidos.");
      const results: any[] = res.data?.results ?? [];
      if (!results.length) break;

      for (const o of results) {
        const saved = await upsertOrder(account, o);
        orders++;
        const shippingId = saved?.shipping_id ?? (o.shipping?.id ? String(o.shipping.id) : null);
        if (shippingId && !seenShipments.has(shippingId)) {
          seenShipments.add(shippingId);
          const r = await syncShipment(account, shippingId, saved?.id ?? null);
          shipments += r.shipments;
          events += r.events;
        }
      }

      const total = Number(res.data?.paging?.total ?? 0);
      if ((page + 1) * PAGE_SIZE >= total) break;
    }

    await db("ml_connections")
      .update({
        last_sync_at: new Date().toISOString(),
        last_sync_status: "success",
        last_error: null,
        status: "active",
        last_activity_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id);

    await finishRun(runId, startedAt, {
      status: "success",
      orders_processed: orders,
      shipments_processed: shipments,
      events_processed: events,
      error: null,
    });

    await logEvent({
      category: "sync",
      action: `sync.${kind}.ok`,
      accountId: account.id,
      mlUserId: account.ml_user_id,
      durationMs: Date.now() - startedAt,
      actor: opts.trigger ?? "manual",
      message: `${orders} pedidos, ${shipments} envios, ${events} eventos.`,
      detail: { orders, shipments, events },
    });

    return { runId, status: "success", orders, shipments, events, error: null };
  } catch (e) {
    const message = (e instanceof Error ? e.message : "Erro desconhecido").slice(0, 500);

    // Se o refresh falhou por revogação, ml-api.server já marcou reauth_required.
    // Nesse caso não sobrescrevemos o status para "error".
    const { data: fresh } = await db("ml_connections").select("status").eq("id", account.id).maybeSingle();
    const patch: Record<string, unknown> = {
      last_sync_status: "error",
      last_error: message,
      updated_at: new Date().toISOString(),
    };
    if (fresh?.status !== "reauth_required") patch["status"] = "error";
    await db("ml_connections").update(patch).eq("id", account.id);

    await finishRun(runId, startedAt, {
      status: "error",
      orders_processed: orders,
      shipments_processed: shipments,
      events_processed: events,
      error: message,
    });

    await logEvent({
      category: "sync",
      action: `sync.${kind}.erro`,
      accountId: account.id,
      mlUserId: account.ml_user_id,
      durationMs: Date.now() - startedAt,
      success: false,
      error: message,
      actor: opts.trigger ?? "manual",
      detail: { orders, shipments, events },
    });

    return { runId, status: "error", orders, shipments, events, error: message };
  }
}

/** Sincroniza pelo ml_user_id (usado pelas rotas internas). Reutiliza syncAccount. */
export async function syncOrders(
  mlUserId: string,
  opts: { kind?: SyncKind; trigger?: string; full?: boolean } = {},
): Promise<SyncResult> {
  const account = await getAccountByMlUserId(String(mlUserId));
  if (!account) throw new Error("Conta não encontrada para este ml_user_id.");
  return syncAccount(account.id, opts);
}

/* -------------------------------------------------------------------------- */
/* Processamento de notificação (webhook)                                      */
/* -------------------------------------------------------------------------- */

/**
 * Processa um recurso notificado pelo ML (/orders/123, /shipments/123, ...).
 *
 * COMO O DESTINO É ESCOLHIDO
 * O tópico é identificado pelo catálogo (ml-topics.server.ts), não por
 * `startsWith`. Isso importa: `orders_feedback` também começa com "orders",
 * e pelo teste antigo ele caía no ramo de pedidos, onde o id extraído do
 * recurso `/orders/123/feedback` seria a palavra "feedback".
 *
 * Pedidos e envios continuam sendo tratados aqui, com a sincronização
 * completa deles. Todo o resto — pagamentos, mensagens, anúncios, perguntas,
 * reclamações, preços, catálogo, promoções, leads, estoque, notas fiscais —
 * vai para processarTopico, que grava o conteúdo em tabela própria ou em
 * ml_topic_events. Nenhum tópico é descartado.
 */
export async function processNotification(input: {
  topic: string;
  resource: string;
  mlUserId: string | null;
}): Promise<{ status: "processed" | "ignored" | "error"; error?: string }> {
  const account = input.mlUserId ? await getAccountByMlUserId(input.mlUserId) : null;
  if (!account) return { status: "ignored", error: "Conta não conectada nesta aplicação." };

  const startedAt = Date.now();
  const runId = await startRun(account.id, "webhook", input.topic);

  try {
    const { identificarTopico, processarTopico } = await import("./ml-topics.server");
    const def = identificarTopico(input.topic, input.resource);

    // Sem definição no catálogo, valem os testes antigos — um tópico novo do ML
    // que aponte para /orders/ ou /shipments/ continua sendo sincronizado.
    const ehPedido = def
      ? def.chave === "orders_v2"
      : input.resource.includes("/orders/") || input.topic.startsWith("orders");
    const ehEnvio = def
      ? def.chave === "shipments"
      : input.resource.includes("/shipments/") || input.topic.startsWith("shipments");

    const id = input.resource.split("/").filter(Boolean).pop() ?? "";
    let orders = 0;
    let shipments = 0;
    let events = 0;

    if (ehPedido) {
      const res = await fetchOrder(account, id);
      if (!res.ok || !res.data) throw new Error(res.error ?? "Pedido não encontrado.");
      const saved = await upsertOrder(account, res.data);
      orders = 1;
      const shippingId = saved?.shipping_id ?? (res.data.shipping?.id ? String(res.data.shipping.id) : null);
      if (shippingId) {
        const r = await syncShipment(account, shippingId, saved?.id ?? null);
        shipments = r.shipments;
        events = r.events;
      }
    } else if (ehEnvio) {
      const { data: existing } = await db("ml_shipments")
        .select("order_id")
        .eq("account_id", account.id)
        .eq("ml_shipment_id", id)
        .maybeSingle();
      const r = await syncShipment(account, id, existing?.order_id ?? null);
      shipments = r.shipments;
      events = r.events;
    } else {
      /*
       * Todo o resto: pagamentos, mensagens, anúncios, perguntas, avaliações,
       * reclamações, preços, catálogo, promoções, leads, estoque, notas
       * fiscais e qualquer tópico novo que o Mercado Livre lançar.
       *
       * processarTopico grava o conteúdo (tabela própria ou ml_topic_events)
       * e registra o mesmo evento em system_logs que era registrado antes —
       * as ações de log continuam com os nomes de sempre.
       */
      const r = await processarTopico(account, {
        topic: input.topic,
        resource: input.resource,
        mlUserId: input.mlUserId,
      });
      await finishRun(runId, startedAt, {
        status: r.status === "error" ? "error" : "success",
        error: r.error ?? null,
        detail: r.detalhe,
      });
      return r.error ? { status: r.status, error: r.error } : { status: r.status };
    }

    await db("ml_connections")
      .update({ last_sync_at: new Date().toISOString(), last_sync_status: "success" })
      .eq("id", account.id);

    await finishRun(runId, startedAt, {
      status: "success",
      orders_processed: orders,
      shipments_processed: shipments,
      events_processed: events,
    });
    return { status: "processed" };
  } catch (e) {
    const message = (e instanceof Error ? e.message : "Erro desconhecido").slice(0, 500);
    await finishRun(runId, startedAt, { status: "error", error: message });
    return { status: "error", error: message };
  }
}
