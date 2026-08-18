/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Área do CLIENTE — dados REAIS da conta do Mercado Livre dele.
 *
 * Nada aqui vem da tabela `pedidos` do Únific+: tudo sai da conta que o
 * próprio cliente autorizou via OAuth. O escopo é sempre
 * `ml_connections.owner_user_id = usuário autenticado`, resolvido no servidor.
 *
 * Nenhum token sai daqui. As chamadas ao Mercado Livre acontecem no backend,
 * com o token do dono, e só o resultado permitido volta ao navegador.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireUser, type Requester } from "./auth-middleware";

/** Conexões do cliente autenticado. Lança se ele não tem nenhuma. */
async function minhasContas(user: Requester) {
  const { db } = await import("./server/db.server");
  const { data } = await db("ml_connections")
    .select("id, ml_user_id, nickname, status, last_sync_at, expires_at, site_id")
    .eq("provider", "mercado_livre")
    .eq("owner_user_id", user.userId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Array<{
    id: string;
    ml_user_id: string;
    nickname: string | null;
    status: string | null;
    last_sync_at: string | null;
    expires_at: string | null;
    site_id: string | null;
  }>;
}

/** IDs das contas do cliente, para filtrar as tabelas de dados. */
async function meusAccountIds(user: Requester): Promise<string[]> {
  return (await minhasContas(user)).map((c) => c.id);
}

/** Filtro que resulta em lista vazia quando o cliente não tem conta alguma. */
function filtrarPorMinhasContas(query: any, ids: string[]) {
  return ids.length ? query.in("account_id", ids) : query.in("account_id", ["00000000-0000-0000-0000-000000000000"]);
}

/* Tipos do retorno — sem eles o componente perde a inferência (handlers usam any). */
export type EnvioResumo = {
  id: string;
  status: string | null;
  statusTexto: string;
  rastreio: string | null;
  transportadora: string | null;
  previsao: string | null;
  destino: string | null;
  atualizadoEm: string | null;
  entregue: boolean;
};

export type CompraResumo = {
  id: string;
  pedidoML: string;
  titulo: string | null;
  quantidade: number | null;
  itens: unknown[];
  valor: number | null;
  moeda: string | null;
  data: string | null;
  atualizadoEm: string | null;
  status: string | null;
  statusTexto: string;
  envio: EnvioResumo | null;
  recebimentoConfirmado: boolean;
  podeMarcarRecebido: boolean;
};

export type ItemCompra = {
  id: string | null;
  titulo: string | null;
  variacao: string | null;
  quantidade: number | null;
  precoUnitario: number | null;
  moeda: string | null;
  categoria: string | null;
};

export type PagamentoCompra = {
  id: string;
  metodo: string | null;
  tipo: string | null;
  status: string | null;
  statusTexto: string;
  valor: number | null;
  parcelas: number | null;
  data: string | null;
};

function statusPtBr(status?: string | null, substatus?: string | null) {
  const map: Record<string, string> = {
    pending: "Aguardando postagem",
    handling: "Em preparação",
    ready_to_ship: "Pronto para envio",
    shipped: "Em trânsito",
    delivered: "Entregue",
    not_delivered: "Não entregue",
    returning_to_sender: "Retornando ao remetente",
    cancelled: "Cancelado",
    paid: "Pago",
    confirmed: "Confirmado",
    payment_required: "Aguardando pagamento",
    payment_in_process: "Pagamento em processamento",
    partially_paid: "Parcialmente pago",
    invalid: "Inválido",
  };
  const base = map[(status ?? "").toLowerCase()] ?? status ?? "—";
  const sub = substatus ? map[substatus.toLowerCase()] : null;
  return sub && sub !== base ? `${base} — ${sub}` : base;
}

/* -------------------------------------------------------------------------- */
/* Situação da conta                                                           */
/* -------------------------------------------------------------------------- */

export const minhaConexao = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const contas = await minhasContas(context.user);
    const ativa = contas.find((c) => c.status === "active" || c.status === "syncing") ?? null;
    const precisaReconectar = contas.length > 0 && !ativa;

    let totalPedidos = 0;
    if (contas.length) {
      const { admin } = await import("./server/db.server");
      const { count } = await filtrarPorMinhasContas(
        admin.from("ml_orders").select("id", { count: "exact", head: true }),
        contas.map((c) => c.id),
      );
      totalPedidos = count ?? 0;
    }

    return {
      conectado: Boolean(ativa),
      precisaReconectar,
      nickname: ativa?.nickname ?? null,
      mlUserId: ativa?.ml_user_id ?? null,
      ultimaSincronizacao: ativa?.last_sync_at ?? null,
      sincronizando: ativa?.status === "syncing",
      totalPedidos,
    };
  });

/** Dispara a sincronização das contas do cliente com o Mercado Livre. */
export const sincronizarMinhaConta = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator((input: { completa?: boolean } | undefined) => ({ completa: Boolean(input?.completa) }))
  .handler(async ({ data, context }) => {
    const contas = await minhasContas(context.user);
    if (!contas.length) throw new Error("Conecte sua conta do Mercado Livre primeiro.");

    const { syncAccount } = await import("./server/ml-sync.server");
    const resultados = [];
    for (const conta of contas) {
      if (conta.status === "reauth_required" || conta.status === "disconnected") {
        resultados.push({ conta: conta.nickname, status: "reconectar", erro: "Autorização expirada." });
        continue;
      }
      const r = await syncAccount(conta.id, {
        kind: data.completa ? "initial" : "manual",
        trigger: `cliente:${context.user.email}`,
        full: data.completa,
      });
      resultados.push({
        conta: conta.nickname,
        status: r.status,
        pedidos: r.orders,
        envios: r.shipments,
        eventos: r.events,
        erro: r.error,
      });
    }
    return { resultados };
  });

/* -------------------------------------------------------------------------- */
/* Compras / pedidos                                                           */
/* -------------------------------------------------------------------------- */

/** Lista as compras REAIS da conta do cliente, com envio e rastreio juntos. */
export const minhasCompras = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .inputValidator((input: { q?: string; status?: string; limit?: number; offset?: number } | undefined) => ({
    q: String(input?.q ?? "").trim().slice(0, 80) || null,
    status: String(input?.status ?? "").trim() || null,
    limit: Math.min(Math.max(Number(input?.limit ?? 30), 1), 100),
    offset: Math.max(Number(input?.offset ?? 0), 0),
  }))
  .handler(async ({ data, context }) => {
    const ids = await meusAccountIds(context.user);
    const { admin } = await import("./server/db.server");

    let q = admin
      .from("ml_orders")
      .select(
        "id, account_id, ml_order_id, status, status_detail, date_created, last_updated, total_amount, currency_id, title, quantity, items, shipping_id, buyer_feedback_at, buyer_feedback_rating",
        { count: "exact" },
      )
      .order("date_created", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    q = filtrarPorMinhasContas(q, ids);
    if (data.status) q = q.eq("status", data.status);
    if (data.q) {
      const termo = data.q.replace(/[%,]/g, "");
      q = q.or(`ml_order_id.ilike.%${termo}%,title.ilike.%${termo}%,shipping_id.ilike.%${termo}%`);
    }

    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);

    // Envio de cada pedido, em uma consulta só.
    const shippingIds = (rows ?? []).map((r: any) => r.shipping_id).filter(Boolean);
    const porEnvio = new Map<string, any>();
    if (shippingIds.length) {
      const { data: envios } = await filtrarPorMinhasContas(
        admin
          .from("ml_shipments")
          .select("account_id, ml_shipment_id, status, substatus, tracking_number, tracking_method, estimated_delivery, receiver_city, receiver_state, last_updated"),
        ids,
      ).in("ml_shipment_id", shippingIds);
      for (const e of envios ?? []) porEnvio.set(`${e.account_id}:${e.ml_shipment_id}`, e);
    }

    const { canMarkReceived } = await import("./server/ml-api.server");

    return {
      total: count ?? 0,
      compras: (rows ?? []).map((o: any): CompraResumo => {
        const envio = o.shipping_id ? porEnvio.get(`${o.account_id}:${o.shipping_id}`) : null;
        return {
          id: o.id,
          pedidoML: o.ml_order_id,
          titulo: o.title,
          quantidade: o.quantity,
          itens: Array.isArray(o.items) ? o.items : [],
          valor: o.total_amount,
          moeda: o.currency_id,
          data: o.date_created,
          atualizadoEm: o.last_updated,
          status: o.status,
          statusTexto: statusPtBr(o.status, o.status_detail),
          envio: envio
            ? {
                id: envio.ml_shipment_id,
                status: envio.status,
                statusTexto: statusPtBr(envio.status, envio.substatus),
                rastreio: envio.tracking_number,
                transportadora: envio.tracking_method,
                previsao: envio.estimated_delivery,
                destino: [envio.receiver_city, envio.receiver_state].filter(Boolean).join("/") || null,
                atualizadoEm: envio.last_updated,
                entregue: (envio.status ?? "").toLowerCase() === "delivered",
              }
            : null,
          recebimentoConfirmado: Boolean(o.buyer_feedback_at),
          podeMarcarRecebido: canMarkReceived(o),
        };
      }),
    };
  });

/**
 * Detalhe COMPLETO de uma compra.
 * Busca ao vivo no Mercado Livre (pedido + envio + histórico de rastreio) e,
 * se a API falhar, devolve o que já está sincronizado no banco.
 */
export const minhaCompra = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .inputValidator((input: { id: string }) => ({ id: String(input.id) }))
  .handler(async ({ data, context }) => {
    const { db } = await import("./server/db.server");
    const ids = await meusAccountIds(context.user);

    const { data: pedido } = await db("ml_orders").select("*").eq("id", data.id).maybeSingle();
    if (!pedido || !ids.includes(String(pedido.account_id))) {
      // Mesma mensagem para "não existe" e "não é seu": não confirmamos
      // a existência de pedidos de outro cliente.
      throw new Error("Compra não encontrada.");
    }

    const { getAccount, fetchOrder, fetchShipment, fetchShipmentHistory, canMarkReceived } = await import(
      "./server/ml-api.server"
    );
    const conta = await getAccount(String(pedido.account_id));

    // --- ao vivo no Mercado Livre ---
    const aoVivo = await fetchOrder(conta, String(pedido.ml_order_id));
    const o: any = aoVivo.ok && aoVivo.data ? aoVivo.data : pedido.raw ?? {};

    const shippingId = String(o?.shipping?.id ?? pedido.shipping_id ?? "");
    let envio: any = null;
    let eventos: Array<{ data: string | null; status: string; descricao: string | null }> = [];

    if (shippingId) {
      const envioRes = await fetchShipment(conta, shippingId);
      const s: any = envioRes.ok ? envioRes.data : null;

      if (s) {
        const endereco = s.receiver_address ?? s.destination?.shipping_address ?? {};
        envio = {
          id: String(s.id),
          status: s.status ?? null,
          statusTexto: statusPtBr(s.status, typeof s.substatus === "string" ? s.substatus : s.substatus?.description),
          rastreio: s.tracking_number ?? null,
          transportadora: s.tracking_method ?? null,
          modo: s.mode ?? null,
          logistica: s.logistic_type ?? null,
          previsao: s.estimated_delivery_time?.date ?? null,
          destinatario: endereco.receiver_name ?? null,
          endereco: [endereco.street_name, endereco.street_number].filter(Boolean).join(", ") || null,
          cidade: endereco.city?.name ?? endereco.city ?? null,
          estado: endereco.state?.id ?? endereco.state?.name ?? null,
          cep: endereco.zip_code ?? null,
          entregue: (s.status ?? "").toLowerCase() === "delivered",
        };

        const hist = await fetchShipmentHistory(conta, shippingId);
        const lista: any[] = Array.isArray(hist.data)
          ? hist.data
          : Array.isArray((hist.data as any)?.history)
            ? (hist.data as any).history
            : [];
        eventos = lista.map((h: any) => ({
          data: h.date ?? h.date_created ?? null,
          status: statusPtBr(h.status ?? h.to, h.substatus),
          descricao: h.comment ?? h.description ?? null,
        }));
      }

      // Sem histórico ao vivo, usa os eventos já sincronizados.
      if (!eventos.length) {
        const { data: envioLocal } = await db("ml_shipments")
          .select("id")
          .eq("account_id", pedido.account_id)
          .eq("ml_shipment_id", shippingId)
          .maybeSingle();
        if (envioLocal) {
          const { data: ev } = await db("ml_shipment_events")
            .select("status, substatus, description, event_date")
            .eq("shipment_id", envioLocal.id)
            .order("event_date", { ascending: false })
            .limit(100);
          eventos = (ev ?? []).map((e: any) => ({
            data: e.event_date,
            status: statusPtBr(e.status, e.substatus),
            descricao: e.description,
          }));
        }
      }
    }

    const itens: ItemCompra[] = Array.isArray(o?.order_items)
      ? o.order_items.map((it: any) => ({
          id: it?.item?.id ?? null,
          titulo: it?.item?.title ?? null,
          variacao: it?.item?.variation_attributes?.map((v: any) => `${v.name}: ${v.value_name}`).join(", ") || null,
          quantidade: it?.quantity ?? null,
          precoUnitario: it?.unit_price ?? null,
          moeda: it?.currency_id ?? null,
          categoria: it?.item?.category_id ?? null,
        }))
      : Array.isArray(pedido.items)
        ? pedido.items.map((it: any) => ({
            id: it.id,
            titulo: it.title,
            variacao: null,
            quantidade: it.quantity,
            precoUnitario: it.unit_price,
            moeda: pedido.currency_id,
            categoria: null,
          }))
        : [];

    const pagamentos: PagamentoCompra[] = Array.isArray(o?.payments)
      ? o.payments.map((p: any) => ({
          id: String(p.id ?? ""),
          metodo: p.payment_method_id ?? null,
          tipo: p.payment_type ?? null,
          status: p.status ?? null,
          statusTexto: statusPtBr(p.status),
          valor: p.total_paid_amount ?? p.transaction_amount ?? null,
          parcelas: p.installments ?? null,
          data: p.date_created ?? null,
        }))
      : [];

    return {
      // A conta é identificada só pelo apelido/ID público. Nada de token.
      conta: { nickname: conta.nickname, mlUserId: conta.ml_user_id },
      aoVivo: aoVivo.ok,
      avisoAoVivo: aoVivo.ok ? null : "Não foi possível consultar o Mercado Livre agora; exibindo os últimos dados sincronizados.",
      compra: {
        id: pedido.id,
        pedidoML: String(pedido.ml_order_id),
        status: o?.status ?? pedido.status,
        statusTexto: statusPtBr(o?.status ?? pedido.status, o?.status_detail ?? pedido.status_detail),
        data: o?.date_created ?? pedido.date_created,
        atualizadoEm: o?.last_updated ?? pedido.last_updated,
        valor: o?.total_amount ?? pedido.total_amount,
        moeda: o?.currency_id ?? pedido.currency_id,
        vendedor: o?.seller?.nickname ?? null,
        recebimentoConfirmado: Boolean(pedido.buyer_feedback_at),
        avaliacao: pedido.buyer_feedback_rating ?? null,
      },
      itens,
      pagamentos,
      envio,
      eventos,
      podeMarcarRecebido: canMarkReceived(pedido),
    };
  });

/**
 * Confirma o recebimento da compra na API OFICIAL do Mercado Livre
 * (POST /orders/{id}/feedback, fulfilled=true).
 * O feedback é ÚNICO e irreversível do lado do Mercado Livre.
 */
export const marcarCompraRecebida = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator((input: { id: string; avaliacao?: "positive" | "neutral" | "negative"; mensagem?: string }) => ({
    id: String(input.id),
    avaliacao: (input.avaliacao ?? "positive") as "positive" | "neutral" | "negative",
    mensagem: String(input.mensagem ?? "").slice(0, 160),
  }))
  .handler(async ({ data, context }) => {
    const { db } = await import("./server/db.server");
    const ids = await meusAccountIds(context.user);

    const { data: pedido } = await db("ml_orders")
      .select("id, account_id, ml_order_id, status, buyer_feedback_at")
      .eq("id", data.id)
      .maybeSingle();

    // Posse conferida no servidor — o navegador só mandou um id.
    if (!pedido || !ids.includes(String(pedido.account_id))) throw new Error("Compra não encontrada.");

    const { getAccount, submitOrderFeedback, canMarkReceived } = await import("./server/ml-api.server");
    if (!canMarkReceived(pedido)) {
      throw new Error(
        pedido.buyer_feedback_at
          ? "Você já confirmou o recebimento desta compra."
          : "O Mercado Livre não permite confirmar o recebimento no status atual desta compra.",
      );
    }

    const conta = await getAccount(String(pedido.account_id));
    const res = await submitOrderFeedback(conta, String(pedido.ml_order_id), {
      fulfilled: true,
      rating: data.avaliacao,
      ...(data.mensagem ? { message: data.mensagem } : {}),
    });

    const { logAudit } = await import("./server/audit.server");
    const { logEvent } = await import("./server/logs.server");
    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "compra.marcar_recebida",
      entity: "ml_orders",
      entityId: pedido.id,
      accountId: pedido.account_id,
      success: res.ok,
      detail: { ml_order_id: pedido.ml_order_id, avaliacao: data.avaliacao, http_status: res.status },
    });
    await logEvent({
      category: "pedidos",
      action: "compra.marcar_recebida",
      accountId: pedido.account_id,
      mlUserId: conta.ml_user_id,
      endpoint: `/orders/${pedido.ml_order_id}/feedback`,
      method: "POST",
      httpStatus: res.status,
      success: res.ok,
      error: res.ok ? null : res.error,
      actor: context.user.email,
      ip: context.user.ip,
    });

    // Só grava local depois que o Mercado Livre aceitou.
    if (!res.ok) throw new Error(`O Mercado Livre recusou a operação (${res.error ?? res.status}).`);

    await db("ml_orders")
      .update({
        buyer_feedback_at: new Date().toISOString(),
        buyer_feedback_status: "fulfilled",
        buyer_feedback_rating: data.avaliacao,
      })
      .eq("id", pedido.id);

    return { ok: true };
  });

/* -------------------------------------------------------------------------- */
/* Rastreio dentro da própria conta                                            */
/* -------------------------------------------------------------------------- */

/**
 * Rastreio da compra REAL do cliente, no formato que o painel de rastreio
 * do Únific+ já desenha (mapa, progresso, linha do tempo).
 *
 * Procura por código de rastreio, número do envio ou número do pedido,
 * SOMENTE dentro das contas do cliente autenticado. Nada vem da tabela
 * `pedidos` do Únific+ — é tudo da conta do Mercado Livre dele.
 */
export const rastrearMinhaCompraCompleta = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator((input: { codigo: string }) => ({
    codigo: String(input.codigo ?? "").trim().replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64),
  }))
  .handler(async ({ data, context }) => {
    if (!data.codigo) return null;
    const ids = await meusAccountIds(context.user);
    if (!ids.length) return null;

    const { admin, db } = await import("./server/db.server");

    // Envio pelo código de rastreio / id do envio
    const { data: envios } = await filtrarPorMinhasContas(
      admin
        .from("ml_shipments")
        .select(
          "id, account_id, ml_order_id, ml_shipment_id, status, substatus, tracking_number, tracking_method, date_created, last_updated, estimated_delivery, receiver_name, receiver_city, receiver_state, receiver_zip",
        ),
      ids,
    )
      .or(`tracking_number.eq.${data.codigo},ml_shipment_id.eq.${data.codigo},ml_order_id.eq.${data.codigo}`)
      .order("last_updated", { ascending: false })
      .limit(1);

    let envio: any = envios?.[0] ?? null;

    // Sem envio: tenta pelo número do pedido e busca o envio ligado a ele.
    let pedido: any = null;
    if (!envio) {
      const { data: pedidos } = await filtrarPorMinhasContas(admin.from("ml_orders").select("*"), ids)
        .eq("ml_order_id", data.codigo)
        .limit(1);
      pedido = pedidos?.[0] ?? null;
      if (!pedido) return null;
      if (pedido.shipping_id) {
        const { data: e2 } = await db("ml_shipments")
          .select("*")
          .eq("account_id", pedido.account_id)
          .eq("ml_shipment_id", String(pedido.shipping_id))
          .maybeSingle();
        envio = e2 ?? null;
      }
    } else {
      const { data: p2 } = await db("ml_orders")
        .select("*")
        .eq("account_id", envio.account_id)
        .eq("ml_order_id", String(envio.ml_order_id ?? ""))
        .maybeSingle();
      pedido = p2 ?? null;
    }

    if (!pedido && !envio) return null;

    // Linha do tempo real do Mercado Livre
    let eventos: Array<{ at: string; title: string; place: string }> = [];
    if (envio?.id) {
      const { data: ev } = await db("ml_shipment_events")
        .select("status, substatus, description, event_date")
        .eq("shipment_id", envio.id)
        .order("event_date", { ascending: false })
        .limit(100);
      eventos = (ev ?? [])
        .filter((e: any) => e.event_date)
        .map((e: any) => ({
          at: e.event_date as string,
          title: e.description || statusPtBr(e.status, e.substatus),
          place: [envio.receiver_city, envio.receiver_state].filter(Boolean).join(" / ") || "Mercado Livre",
        }));
    }

    const entregue = (envio?.status ?? "").toLowerCase() === "delivered";
    const dataEnvio = (envio?.date_created ?? pedido?.date_created ?? new Date().toISOString()).slice(0, 10);

    return {
      compraId: pedido?.id ?? null,
      pedido: {
        id: pedido?.id ?? `ml-${envio?.ml_shipment_id}`,
        tracking_code: envio?.tracking_number || envio?.ml_shipment_id || String(pedido?.ml_order_id ?? data.codigo),
        marketplace: "mercado_livre",
        sender: "Mercado Livre",
        recipient: envio?.receiver_name ?? "Você",
        dest_address: null,
        dest_city: envio?.receiver_city ?? "—",
        dest_state: envio?.receiver_state ?? "SP",
        dest_cep: envio?.receiver_zip ?? null,
        origin_city: "São Paulo",
        origin_state: "SP",
        status: statusPtBr(envio?.status ?? pedido?.status, envio?.substatus),
        ship_date: dataEnvio,
        delivery_date: entregue ? (envio?.last_updated ?? "").slice(0, 10) || null : null,
        cpf: null,
        product: pedido?.title ?? null,
        product_value: pedido?.total_amount ?? 0,
        weight: null,
        invoice_number: null,
        invoice_series: null,
        notes: null,
        created_at: pedido?.date_created ?? envio?.date_created ?? new Date().toISOString(),
      },
      eventos,
    };
  });

/**
 * Procura uma compra do cliente por código de rastreio, número do envio
 * ou número do pedido — SOMENTE dentro das contas dele.
 */
export const rastrearMinhaCompra = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator((input: { codigo: string }) => ({
    codigo: String(input.codigo ?? "").trim().replace(/[^A-Za-z0-9._-]/g, "").slice(0, 64),
  }))
  .handler(async ({ data, context }) => {
    if (!data.codigo) return null;

    const ids = await meusAccountIds(context.user);
    if (!ids.length) return null;

    const { admin } = await import("./server/db.server");

    // 1) o código é de um envio?
    const { data: envios } = await filtrarPorMinhasContas(
      admin.from("ml_shipments").select("account_id, ml_order_id, ml_shipment_id"),
      ids,
    ).or(`tracking_number.eq.${data.codigo},ml_shipment_id.eq.${data.codigo}`);

    const envio = envios?.[0];
    if (envio?.ml_order_id) {
      const { data: pedido } = await filtrarPorMinhasContas(admin.from("ml_orders").select("id"), ids)
        .eq("ml_order_id", String(envio.ml_order_id))
        .limit(1);
      if (pedido?.[0]) return { compraId: pedido[0].id as string };
    }

    // 2) o código é o número do pedido?
    const { data: pedidos } = await filtrarPorMinhasContas(admin.from("ml_orders").select("id"), ids)
      .eq("ml_order_id", data.codigo)
      .limit(1);
    if (pedidos?.[0]) return { compraId: pedidos[0].id as string };

    return null;
  });
