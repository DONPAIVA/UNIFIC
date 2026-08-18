/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Catálogo e processamento dos tópicos de notificação do Mercado Livre.
 *
 * POR QUE ESTE ARQUIVO EXISTE
 * O painel de notificações do aplicativo do ML oferece dezenas de tópicos.
 * Antes, só orders_v2 e shipments tinham tratamento real; o restante chegava
 * no webhook, virava uma linha de log e o conteúdo se perdia.
 *
 * Aqui ficam:
 *   1. o CATÁLOGO — todo tópico que o painel do ML oferece, com rótulo em
 *      português, grupo e como deve ser tratado;
 *   2. os GRAVADORES — cada tópico de alto valor persiste numa tabela própria
 *      (ml_payments, ml_messages, ml_items, ml_questions, ml_claims,
 *      ml_order_feedback);
 *   3. o TRATAMENTO GENÉRICO — a cauda longa (preços, catálogo, promoções,
 *      leads, estoque, notas fiscais...) lê o recurso notificado e guarda o
 *      corpo em ml_topic_events. Nada é descartado.
 *
 * Pedidos e envios continuam em ml-sync.server.ts, intocados: eles têm
 * sincronização própria (paginação, histórico de rastreio) e não passam por
 * aqui. Este arquivo importa ml-sync apenas de forma dinâmica, para não criar
 * dependência circular.
 */
import { db } from "./db.server";
import {
  fetchClaim,
  fetchClaimActions,
  fetchItem,
  fetchMessage,
  fetchOrderFeedback,
  fetchPackMessages,
  fetchPayment,
  fetchQuestion,
  fetchRecurso,
  type MlAccount,
} from "./ml-api.server";

/* -------------------------------------------------------------------------- */
/* Catálogo                                                                    */
/* -------------------------------------------------------------------------- */

export type GrupoTopico =
  | "orders"
  | "messages"
  | "prices"
  | "items"
  | "catalog"
  | "shipments"
  | "promotions"
  | "vis_leads"
  | "post_purchase"
  | "others";

export type TratamentoTopico =
  /** Tem código dedicado em ml-sync.server.ts (pedidos e envios). */
  | "sync"
  /** Tem gravador dedicado neste arquivo, com tabela própria. */
  | "dedicado"
  /** Lê o recurso e guarda em ml_topic_events. */
  | "generico";

export type DefinicaoTopico = {
  /** Chave canônica usada no banco e nos logs. */
  chave: string;
  grupo: GrupoTopico;
  /** Rótulo em português, mostrado na CentralML. */
  rotulo: string;
  /** Tópicos (já normalizados) que casam com esta definição. */
  aliases: string[];
  /** Trechos de recurso que também identificam este tópico. */
  recursos?: string[];
  tratamento: TratamentoTopico;
  /** action gravada em system_logs. */
  acao: string;
  descricao: string;
};

/**
 * Todo tópico oferecido pelo painel do Mercado Livre.
 * A ordem importa: `identificarTopico` devolve a PRIMEIRA definição que casa,
 * então os tópicos mais específicos vêm antes dos mais genéricos
 * (orders_feedback antes de orders_v2, items_prices antes de items).
 */
export const CATALOGO_TOPICOS: DefinicaoTopico[] = [
  /* ---------------------------------- orders ---------------------------------- */
  {
    chave: "orders_feedback",
    grupo: "orders",
    rotulo: "Avaliação do pedido",
    aliases: ["orders_feedback", "order_feedback", "feedback"],
    recursos: ["/feedback"],
    tratamento: "dedicado",
    acao: "pedido.avaliacao",
    descricao: "Comprador ou vendedor avaliou o pedido.",
  },
  {
    chave: "orders_v2",
    grupo: "orders",
    rotulo: "Pedidos",
    aliases: ["orders_v2", "orders", "created_orders"],
    recursos: ["/orders/"],
    tratamento: "sync",
    descricao: "Pedido criado ou atualizado.",
    acao: "pedido.atualizado",
  },

  /* --------------------------------- shipments -------------------------------- */
  {
    chave: "shipments",
    grupo: "shipments",
    rotulo: "Envios",
    aliases: ["shipments", "shipment"],
    recursos: ["/shipments/"],
    tratamento: "sync",
    acao: "envio.atualizado",
    descricao: "Envio criado ou com status alterado.",
  },
  {
    chave: "fbm_stock_operations",
    grupo: "shipments",
    rotulo: "Estoque Full (FBM)",
    aliases: ["fbm_stock_operations", "fbm_stock_operation", "stock_operations"],
    recursos: ["/stock/fulfillment", "/fbm/"],
    tratamento: "generico",
    acao: "estoque_full.operacao",
    descricao: "Movimentação de estoque no Fulfillment (Full).",
  },
  {
    chave: "flex_handshakes",
    grupo: "shipments",
    rotulo: "Handshake do Flex",
    aliases: ["flex_handshakes", "flex_handshake", "handshakes"],
    recursos: ["/handshakes"],
    tratamento: "generico",
    acao: "flex.handshake",
    descricao: "Confirmação de coleta/entrega no Mercado Envios Flex.",
  },

  /* --------------------------------- messages --------------------------------- */
  {
    chave: "insurance_messages",
    grupo: "messages",
    rotulo: "Mensagens de seguro",
    aliases: ["insurance_messages", "insurance_message", "insurance"],
    recursos: ["/insurance"],
    tratamento: "generico",
    acao: "seguro.mensagem",
    descricao: "Mensagem relacionada a um seguro contratado.",
  },
  {
    chave: "messages",
    grupo: "messages",
    rotulo: "Mensagens do pedido",
    aliases: ["messages", "messages_created", "messages_read", "message"],
    recursos: ["/messages/", "/packs/"],
    tratamento: "dedicado",
    acao: "mensagem.recebida",
    descricao: "Mensagem enviada ou lida na conversa pós-venda.",
  },

  /* ---------------------------------- prices ---------------------------------- */
  {
    chave: "price_suggestion",
    grupo: "prices",
    rotulo: "Sugestão de preço",
    aliases: ["price_suggestion", "price_suggestions", "suggestions"],
    recursos: ["/suggestions/"],
    tratamento: "generico",
    acao: "preco.sugestao",
    descricao: "O Mercado Livre sugeriu um novo preço para um anúncio.",
  },

  /* ----------------------------------- items ---------------------------------- */
  {
    chave: "items_prices",
    grupo: "items",
    rotulo: "Preços do anúncio",
    aliases: ["items_prices", "item_prices", "prices"],
    recursos: ["/prices"],
    tratamento: "generico",
    acao: "anuncio.preco_alterado",
    descricao: "Preço de um anúncio mudou.",
  },
  {
    chave: "questions",
    grupo: "items",
    rotulo: "Perguntas",
    aliases: ["questions", "question"],
    recursos: ["/questions/"],
    tratamento: "dedicado",
    acao: "pergunta.recebida",
    descricao: "Pergunta feita ou respondida num anúncio.",
  },
  {
    chave: "quotations",
    grupo: "items",
    rotulo: "Cotações",
    aliases: ["quotations", "quotation"],
    recursos: ["/quotations"],
    tratamento: "generico",
    acao: "cotacao.recebida",
    descricao: "Cotação solicitada num anúncio.",
  },
  {
    chave: "stock_locations",
    grupo: "items",
    rotulo: "Locais de estoque",
    aliases: ["stock_locations", "stock_location", "user_products_stock"],
    recursos: ["/stock/", "/locations"],
    tratamento: "generico",
    acao: "estoque.local_alterado",
    descricao: "Estoque de um local mudou.",
  },
  {
    chave: "user_products_families",
    grupo: "items",
    rotulo: "Famílias de produtos",
    aliases: ["user_products_families", "user_product_families", "user_products_family"],
    recursos: ["/user-products", "/families"],
    tratamento: "generico",
    acao: "produto.familia_alterada",
    descricao: "Família de produtos do usuário foi alterada.",
  },
  {
    chave: "items",
    grupo: "items",
    rotulo: "Anúncios",
    aliases: ["items", "item"],
    recursos: ["/items/"],
    tratamento: "dedicado",
    acao: "anuncio.atualizado",
    descricao: "Anúncio criado, pausado, finalizado ou alterado.",
  },

  /* ---------------------------------- catalog --------------------------------- */
  {
    chave: "item_competition",
    grupo: "catalog",
    rotulo: "Concorrência no catálogo",
    aliases: [
      "item_competition",
      "items_competition",
      "catalog_item_competition",
      "catalog_item_competition_status",
    ],
    recursos: ["/competition"],
    tratamento: "generico",
    acao: "catalogo.concorrencia",
    descricao: "Sua posição na disputa do catálogo mudou.",
  },
  {
    chave: "catalog_suggestions",
    grupo: "catalog",
    rotulo: "Sugestões de catálogo",
    aliases: ["catalog_suggestions", "catalog_suggestion", "catalog_item_suggestions"],
    recursos: ["/catalog_suggestions", "/catalog/"],
    tratamento: "generico",
    acao: "catalogo.sugestao",
    descricao: "O ML sugeriu vincular um anúncio a um produto do catálogo.",
  },

  /* -------------------------------- promotions -------------------------------- */
  {
    chave: "public_offers",
    grupo: "promotions",
    rotulo: "Ofertas públicas",
    aliases: ["public_offers", "public_offer", "offers"],
    recursos: ["/public-offers", "/offers"],
    tratamento: "generico",
    acao: "promocao.oferta",
    descricao: "Campanha/oferta pública que envolve seus anúncios.",
  },
  {
    chave: "public_candidates",
    grupo: "promotions",
    rotulo: "Candidatos a oferta",
    aliases: ["public_candidates", "public_candidate", "candidates"],
    recursos: ["/public-candidates", "/candidates"],
    tratamento: "generico",
    acao: "promocao.candidato",
    descricao: "Anúncio elegível para entrar numa campanha.",
  },

  /* --------------------------------- VIS leads -------------------------------- */
  {
    chave: "vis_leads",
    grupo: "vis_leads",
    rotulo: "Leads (imóveis/veículos/serviços)",
    aliases: [
      "vis_leads",
      "vis_lead",
      "leads",
      "vis_leads_whatsapp",
      "vis_leads_call",
      "vis_leads_question",
      "vis_leads_visit_request",
      "vis_leads_contact_request",
      "vis_leads_reservation",
      "vis_leads_quotations",
    ],
    recursos: ["/vis/", "/leads/"],
    tratamento: "generico",
    acao: "lead.recebido",
    descricao: "Contato recebido: WhatsApp, ligação, visita, reserva ou cotação.",
  },

  /* ------------------------------- post purchase ------------------------------ */
  {
    chave: "claims_actions",
    grupo: "post_purchase",
    rotulo: "Ações da reclamação",
    aliases: ["claims_actions", "claim_actions", "claims_action"],
    recursos: ["/actions"],
    tratamento: "dedicado",
    acao: "reclamacao.acao",
    descricao: "Uma ação ficou disponível ou foi executada numa reclamação.",
  },
  {
    chave: "claims",
    grupo: "post_purchase",
    rotulo: "Reclamações",
    aliases: ["claims", "claim", "created_claims", "post_purchase", "post_purchases", "mediations"],
    recursos: ["/claims/", "/post-purchase/"],
    tratamento: "dedicado",
    acao: "reclamacao.atualizada",
    descricao: "Reclamação aberta, atualizada ou encerrada.",
  },

  /* ---------------------------------- others ---------------------------------- */
  {
    chave: "payments",
    grupo: "others",
    rotulo: "Pagamentos",
    aliases: ["payments", "payment", "collections", "collection"],
    recursos: ["/collections/", "/payments/", "/v1/payments/"],
    tratamento: "dedicado",
    acao: "pagamento.atualizado",
    descricao: "Pagamento criado, aprovado, devolvido ou estornado.",
  },
  {
    chave: "invoices",
    grupo: "others",
    rotulo: "Notas fiscais",
    aliases: ["invoices", "invoice", "billing", "fiscal_documents"],
    recursos: ["/invoices", "/billing"],
    tratamento: "generico",
    acao: "nota_fiscal.atualizada",
    descricao: "Nota fiscal emitida ou atualizada.",
  },
  {
    chave: "leads_credits",
    grupo: "others",
    rotulo: "Créditos de leads",
    aliases: ["leads_credits", "leads_credit", "credits"],
    recursos: ["/credits"],
    tratamento: "generico",
    acao: "creditos.atualizado",
    descricao: "Saldo de créditos para receber leads mudou.",
  },
];

/** Normaliza o tópico: minúsculas, sem espaços, hífen vira sublinhado. */
export function normalizarTopico(topic: unknown): string {
  return String(topic ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

/**
 * Descobre qual definição do catálogo corresponde à notificação.
 * Casa primeiro pelo tópico; se o ML mandar um tópico desconhecido (acontece
 * quando eles lançam algo novo), tenta pelo formato do recurso.
 */
export function identificarTopico(topic: string, resource = ""): DefinicaoTopico | null {
  const alvo = normalizarTopico(topic);
  const recurso = String(resource ?? "").toLowerCase();

  if (alvo) {
    const exato = CATALOGO_TOPICOS.find((d) => d.aliases.includes(alvo));
    if (exato) return exato;
    // Tópicos derivados: "vis_leads_whatsapp" casa com "vis_leads".
    const porPrefixo = CATALOGO_TOPICOS.find((d) =>
      d.aliases.some((a) => alvo.startsWith(`${a}_`)),
    );
    if (porPrefixo) return porPrefixo;
  }

  if (recurso) {
    const porRecurso = CATALOGO_TOPICOS.find((d) =>
      (d.recursos ?? []).some((r) => recurso.includes(r)),
    );
    if (porRecurso) return porRecurso;
  }

  return null;
}

/** Rótulo em português de um tópico, para telas e relatórios. */
export function rotuloDoTopico(topic: string, resource = ""): string {
  return identificarTopico(topic, resource)?.rotulo ?? String(topic || "Desconhecido");
}

/** Catálogo enxuto para a interface (sem os campos internos de roteamento). */
export function catalogoParaTela() {
  return CATALOGO_TOPICOS.map((d) => ({
    chave: d.chave,
    grupo: d.grupo,
    rotulo: d.rotulo,
    descricao: d.descricao,
    tratamento: d.tratamento,
    topicoMl: d.aliases[0],
  }));
}

/* -------------------------------------------------------------------------- */
/* Utilidades                                                                  */
/* -------------------------------------------------------------------------- */

function iso(value: unknown): string | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function txt(value: unknown, max = 2000): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, max) || null;
  if (typeof value === "object") {
    const o = value as any;
    const s = o.plain ?? o.text ?? o.description ?? o.name ?? null;
    return s == null ? null : String(s).slice(0, max);
  }
  return String(value).slice(0, max);
}

/** Último segmento não vazio do recurso — o id na maioria dos tópicos. */
export function idDoRecurso(resource: string): string {
  return (
    String(resource ?? "")
      .split("?")[0]!
      .split("/")
      .filter(Boolean)
      .pop() ?? ""
  );
}

/** Localiza a linha de ml_orders correspondente, quando o pedido já foi sincronizado. */
async function acharPedido(account: MlAccount, mlOrderId: string | null): Promise<string | null> {
  if (!mlOrderId) return null;
  const { data } = await db("ml_orders")
    .select("id")
    .eq("account_id", account.id)
    .eq("ml_order_id", String(mlOrderId))
    .maybeSingle();
  return (data?.id as string) ?? null;
}

/* -------------------------------------------------------------------------- */
/* Gravadores dedicados                                                        */
/* -------------------------------------------------------------------------- */

/** Normaliza um pagamento (da API ou vindo dentro do pedido) e grava. */
export async function salvarPagamento(
  account: MlAccount,
  bruto: any,
  opts: { orderRowId?: string | null; mlOrderId?: string | null } = {},
): Promise<string | null> {
  // /collections/{id} devolve { collection: {...} }; /v1/payments/{id} devolve o objeto direto.
  const p = bruto?.collection ?? bruto ?? null;
  const mlPaymentId = p?.id != null ? String(p.id) : null;
  if (!mlPaymentId) return null;

  const mlOrderId =
    opts.mlOrderId != null
      ? String(opts.mlOrderId)
      : p?.order?.id != null
        ? String(p.order.id)
        : p?.order_id != null
          ? String(p.order_id)
          : null;

  const orderRowId = opts.orderRowId ?? (await acharPedido(account, mlOrderId));
  const detalhes = p?.transaction_details ?? {};

  const row = {
    account_id: account.id,
    order_id: orderRowId,
    provider: "mercado_livre",
    ml_payment_id: mlPaymentId,
    ml_order_id: mlOrderId,
    status: p?.status ?? null,
    status_detail: txt(p?.status_detail, 200),
    operation_type: p?.operation_type ?? null,
    payment_type: p?.payment_type ?? p?.payment_type_id ?? null,
    payment_method_id: p?.payment_method_id ?? p?.payment_method?.id ?? null,
    transaction_amount: num(p?.transaction_amount),
    total_paid_amount: num(detalhes?.total_paid_amount ?? p?.total_paid_amount),
    shipping_cost: num(p?.shipping_cost ?? detalhes?.shipping_cost),
    taxes_amount: num(p?.taxes_amount),
    currency_id: p?.currency_id ?? null,
    installments: num(p?.installments),
    date_created: iso(p?.date_created),
    date_approved: iso(p?.date_approved),
    date_last_updated: iso(p?.date_last_updated ?? p?.last_modified),
    raw: p,
    synced_at: new Date().toISOString(),
  };

  const { data, error } = await db("ml_payments")
    .upsert(row, { onConflict: "account_id,ml_payment_id" })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Pagamento ${mlPaymentId}: ${error.message}`);
  return (data?.id as string) ?? null;
}

/**
 * Grava os pagamentos que vêm DENTRO do pedido.
 *
 * É o caminho mais confiável: `/collections/{id}` costuma responder 403 para
 * contas que não são donas do aplicativo, mas o array `payments` do pedido
 * sempre chega. Chamado a cada upsert de pedido, então nenhum pagamento
 * depende do webhook para existir no banco.
 */
export async function salvarPagamentosDoPedido(
  account: MlAccount,
  pedido: any,
  orderRowId: string | null,
): Promise<number> {
  const lista = Array.isArray(pedido?.payments) ? pedido.payments : [];
  if (!lista.length) return 0;
  const mlOrderId = pedido?.id != null ? String(pedido.id) : null;

  let gravados = 0;
  for (const p of lista) {
    try {
      const id = await salvarPagamento(account, p, { orderRowId, mlOrderId });
      if (id) gravados++;
    } catch {
      // Um pagamento problemático não pode derrubar a sincronização do pedido.
    }
  }
  return gravados;
}

/** Grava um anúncio. */
export async function salvarAnuncio(account: MlAccount, item: any): Promise<string | null> {
  const mlItemId = item?.id != null ? String(item.id) : null;
  if (!mlItemId) return null;

  const row = {
    account_id: account.id,
    provider: "mercado_livre",
    ml_item_id: mlItemId,
    title: txt(item?.title, 500),
    status: item?.status ?? null,
    sub_status: Array.isArray(item?.sub_status) ? item.sub_status : [],
    price: num(item?.price),
    base_price: num(item?.base_price),
    original_price: num(item?.original_price),
    currency_id: item?.currency_id ?? null,
    available_quantity: num(item?.available_quantity),
    sold_quantity: num(item?.sold_quantity),
    condition: item?.condition ?? null,
    listing_type_id: item?.listing_type_id ?? null,
    category_id: item?.category_id ?? null,
    catalog_product_id: item?.catalog_product_id ?? null,
    catalog_listing: typeof item?.catalog_listing === "boolean" ? item.catalog_listing : null,
    permalink: txt(item?.permalink, 500),
    thumbnail: txt(item?.secure_thumbnail ?? item?.thumbnail, 500),
    health: num(item?.health),
    logistic_type: item?.shipping?.logistic_type ?? null,
    free_shipping:
      typeof item?.shipping?.free_shipping === "boolean" ? item.shipping.free_shipping : null,
    date_created: iso(item?.date_created),
    last_updated: iso(item?.last_updated),
    raw: item,
    synced_at: new Date().toISOString(),
  };

  const { data, error } = await db("ml_items")
    .upsert(row, { onConflict: "account_id,ml_item_id" })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Anúncio ${mlItemId}: ${error.message}`);
  return (data?.id as string) ?? null;
}

/** Grava uma pergunta (e a resposta, quando já existe). */
export async function salvarPergunta(account: MlAccount, q: any): Promise<string | null> {
  const mlQuestionId = q?.id != null ? String(q.id) : null;
  if (!mlQuestionId) return null;

  const row = {
    account_id: account.id,
    provider: "mercado_livre",
    ml_question_id: mlQuestionId,
    ml_item_id: q?.item_id != null ? String(q.item_id) : null,
    status: q?.status ?? null,
    body: txt(q?.text, 4000),
    answer_text: txt(q?.answer?.text, 4000),
    answer_status: q?.answer?.status ?? null,
    answer_date: iso(q?.answer?.date_created),
    from_user_id: q?.from?.id != null ? String(q.from.id) : null,
    seller_id: q?.seller_id != null ? String(q.seller_id) : null,
    date_created: iso(q?.date_created),
    raw: q,
    synced_at: new Date().toISOString(),
  };

  const { data, error } = await db("ml_questions")
    .upsert(row, { onConflict: "account_id,ml_question_id" })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Pergunta ${mlQuestionId}: ${error.message}`);
  return (data?.id as string) ?? null;
}

/** Grava uma lista de mensagens da conversa pós-venda. Devolve quantas gravou. */
export async function salvarMensagens(
  account: MlAccount,
  mensagens: any[],
  opts: { packId?: string | null } = {},
): Promise<number> {
  const lista = Array.isArray(mensagens) ? mensagens.filter(Boolean) : [];
  if (!lista.length) return 0;

  const rows: any[] = [];
  for (const m of lista) {
    const mlMessageId = m?.id != null ? String(m.id) : null;
    if (!mlMessageId) continue;

    const packId =
      opts.packId ??
      (Array.isArray(m?.message_resources)
        ? (m.message_resources.find((r: any) => r?.name === "packs")?.id ?? null)
        : null);
    const mlOrderId = Array.isArray(m?.message_resources)
      ? (m.message_resources.find((r: any) => r?.name === "orders")?.id ?? null)
      : null;

    const fromId = m?.from?.user_id != null ? String(m.from.user_id) : null;
    const datas = m?.message_date ?? {};

    rows.push({
      account_id: account.id,
      order_id: await acharPedido(account, mlOrderId ? String(mlOrderId) : null),
      provider: "mercado_livre",
      ml_message_id: mlMessageId,
      pack_id: packId != null ? String(packId) : null,
      ml_order_id: mlOrderId != null ? String(mlOrderId) : null,
      from_user_id: fromId,
      to_user_id: m?.to?.user_id != null ? String(m.to.user_id) : null,
      direcao: fromId && fromId === String(account.ml_user_id) ? "enviada" : "recebida",
      subject: txt(m?.subject, 500),
      body: txt(m?.text, 8000),
      status: m?.status ?? null,
      moderation_status: m?.message_moderation?.status ?? null,
      attachments: Array.isArray(m?.message_attachments) ? m.message_attachments : [],
      date_created: iso(datas?.created ?? m?.date_created),
      date_read: iso(datas?.read),
      date_available: iso(datas?.available),
      raw: m,
      synced_at: new Date().toISOString(),
    });
  }

  if (!rows.length) return 0;
  const { error } = await db("ml_messages").upsert(rows, {
    onConflict: "account_id,ml_message_id",
  });
  if (error) throw new Error(`Mensagens: ${error.message}`);
  return rows.length;
}

/** Grava uma reclamação e as ações disponíveis nela. */
export async function salvarReclamacao(
  account: MlAccount,
  claim: any,
  acoes: any[] | null = null,
): Promise<string | null> {
  const mlClaimId = claim?.id != null ? String(claim.id) : null;
  if (!mlClaimId) return null;

  const tipoRecurso = claim?.resource ?? claim?.resource_type ?? null;
  const idRecurso = claim?.resource_id != null ? String(claim.resource_id) : null;
  const mlOrderId =
    tipoRecurso === "order" ? idRecurso : claim?.order_id != null ? String(claim.order_id) : null;

  const row = {
    account_id: account.id,
    order_id: await acharPedido(account, mlOrderId),
    provider: "mercado_livre",
    ml_claim_id: mlClaimId,
    ml_order_id: mlOrderId,
    resource_type: tipoRecurso,
    resource_id: idRecurso,
    type: claim?.type ?? null,
    stage: claim?.stage ?? null,
    status: claim?.status ?? null,
    status_detail: txt(claim?.status_detail ?? claim?.resolution?.reason, 300),
    reason_id: claim?.reason_id != null ? String(claim.reason_id) : null,
    parent_id: claim?.parent_id != null ? String(claim.parent_id) : null,
    players: Array.isArray(claim?.players) ? claim.players : [],
    available_actions: Array.isArray(acoes)
      ? acoes
      : Array.isArray(claim?.available_actions)
        ? claim.available_actions
        : [],
    date_created: iso(claim?.date_created),
    last_updated: iso(claim?.last_updated),
    raw: claim,
    synced_at: new Date().toISOString(),
  };

  const { data, error } = await db("ml_claims")
    .upsert(row, { onConflict: "account_id,ml_claim_id" })
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Reclamação ${mlClaimId}: ${error.message}`);

  const claimRowId = (data?.id as string) ?? null;
  const listaAcoes = Array.isArray(acoes)
    ? acoes
    : Array.isArray(claim?.available_actions)
      ? claim.available_actions
      : [];
  if (listaAcoes.length) await salvarAcoesReclamacao(account, mlClaimId, claimRowId, listaAcoes);

  return claimRowId;
}

/** Grava as ações de uma reclamação, sem duplicar (idempotente por fingerprint). */
export async function salvarAcoesReclamacao(
  account: MlAccount,
  mlClaimId: string,
  claimRowId: string | null,
  acoes: any[],
): Promise<number> {
  const lista = Array.isArray(acoes) ? acoes.filter(Boolean) : [];
  if (!lista.length) return 0;

  const rows = lista.map((a: any) => {
    const nome = typeof a === "string" ? a : (a?.action ?? a?.name ?? a?.id ?? "acao");
    const status = typeof a === "string" ? null : (a?.status ?? null);
    const prazo = typeof a === "string" ? null : iso(a?.due_date ?? a?.expiration_date);
    return {
      account_id: account.id,
      claim_id: claimRowId,
      ml_claim_id: String(mlClaimId),
      action: String(nome).slice(0, 200),
      status,
      mandatory: typeof a === "object" && typeof a?.mandatory === "boolean" ? a.mandatory : null,
      due_date: prazo,
      fingerprint: [nome, status, prazo]
        .map((p) => String(p ?? ""))
        .join("|")
        .slice(0, 300),
      raw: typeof a === "string" ? { action: a } : a,
    };
  });

  const { error } = await db("ml_claim_actions").upsert(rows, {
    onConflict: "account_id,ml_claim_id,fingerprint",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`Ações da reclamação ${mlClaimId}: ${error.message}`);
  return rows.length;
}

/**
 * Grava o feedback de um pedido.
 * O ML devolve `{ purchase: {...}, sale: {...} }` — a avaliação do comprador e
 * a do vendedor. Cada uma vira uma linha, identificada pelo papel.
 */
export async function salvarFeedbackPedido(
  account: MlAccount,
  mlOrderId: string,
  bruto: any,
): Promise<number> {
  if (!bruto || !mlOrderId) return 0;

  const partes: Array<{ role: string; fb: any }> = [];
  if (bruto.purchase || bruto.sale) {
    if (bruto.purchase) partes.push({ role: "purchase", fb: bruto.purchase });
    if (bruto.sale) partes.push({ role: "sale", fb: bruto.sale });
  } else {
    // Resposta plana: o ML devolve só um feedback quando o recurso já aponta para ele.
    partes.push({ role: String(bruto.role ?? bruto.type ?? "purchase"), fb: bruto });
  }

  const orderRowId = await acharPedido(account, mlOrderId);
  const rows = partes
    .filter((p) => p.fb && typeof p.fb === "object")
    .map(({ role, fb }) => ({
      account_id: account.id,
      order_id: orderRowId,
      provider: "mercado_livre",
      ml_order_id: String(mlOrderId),
      role,
      ml_feedback_id: fb?.id != null ? String(fb.id) : null,
      rating: fb?.rating ?? null,
      fulfilled: typeof fb?.fulfilled === "boolean" ? fb.fulfilled : null,
      status: fb?.status ?? null,
      message: txt(fb?.message, 1000),
      reason: txt(fb?.reason, 300),
      date_created: iso(fb?.date_created),
      raw: fb,
      synced_at: new Date().toISOString(),
    }));

  if (!rows.length) return 0;
  const { error } = await db("ml_order_feedback").upsert(rows, {
    onConflict: "account_id,ml_order_id,role",
  });
  if (error) throw new Error(`Feedback do pedido ${mlOrderId}: ${error.message}`);

  // Espelha no pedido o que já existia: a data/estado do feedback do comprador.
  const compra = rows.find((r) => r.role === "purchase");
  if (compra?.date_created && orderRowId) {
    await db("ml_orders")
      .update({
        buyer_feedback_at: compra.date_created,
        buyer_feedback_status:
          compra.fulfilled == null ? null : compra.fulfilled ? "fulfilled" : "not_fulfilled",
        buyer_feedback_rating: compra.rating,
      })
      .eq("id", orderRowId);
  }

  return rows.length;
}

/* -------------------------------------------------------------------------- */
/* Tratamento genérico (cauda longa)                                           */
/* -------------------------------------------------------------------------- */

/** Monta um resumo curto e legível do recurso lido, para aparecer na tela. */
function resumirPayload(def: DefinicaoTopico, payload: any, resourceId: string): string {
  if (!payload || typeof payload !== "object")
    return `${def.rotulo} — ${resourceId || "sem detalhe"}`;
  const p: any = payload;
  const pedacos: string[] = [];
  const candidatos = [p.title, p.name, p.status, p.type, p.reason, p.description, p.state];
  for (const c of candidatos) {
    const s = txt(c, 80);
    if (s && !pedacos.includes(s)) pedacos.push(s);
    if (pedacos.length >= 3) break;
  }
  if (p.price != null) pedacos.push(`preço ${p.price}`);
  if (p.available_quantity != null) pedacos.push(`estoque ${p.available_quantity}`);
  const cauda = pedacos.length ? ` — ${pedacos.join(" · ")}` : "";
  return `${def.rotulo} ${resourceId}${cauda}`.slice(0, 500);
}

/**
 * Lê o recurso notificado e guarda o corpo em ml_topic_events.
 *
 * Nunca lança por causa da API: se o Mercado Livre recusar a leitura (403 em
 * recursos de outra conta, 404 em recurso já removido), a notificação é
 * gravada assim mesmo, com `fetched = false` e o motivo. Perder o corpo é
 * aceitável; perder o registro de que o evento aconteceu, não.
 */
export async function salvarEventoGenerico(
  account: MlAccount,
  def: DefinicaoTopico,
  entrada: { topic: string; resource: string; mlUserId: string | null },
): Promise<{ fetched: boolean; resourceId: string; summary: string }> {
  const resourceId = idDoRecurso(entrada.resource);
  const r = await fetchRecurso(account, entrada.resource);
  const payload = r.ok ? r.data : null;
  const summary = r.ok
    ? resumirPayload(def, payload, resourceId)
    : `${def.rotulo} ${resourceId} — corpo não lido (${r.error ?? "sem detalhe"})`.slice(0, 500);

  // times_seen é contador: precisamos do valor atual antes de gravar.
  const { data: existente } = await db("ml_topic_events")
    .select("id, times_seen, first_seen_at")
    .eq("account_id", account.id)
    .eq("topic", entrada.topic)
    .eq("resource", entrada.resource)
    .maybeSingle();

  const agora = new Date().toISOString();
  const row: Record<string, unknown> = {
    account_id: account.id,
    provider: "mercado_livre",
    topic: entrada.topic,
    topic_key: def.chave,
    topic_group: def.grupo,
    label: def.rotulo,
    resource: entrada.resource,
    resource_id: resourceId || null,
    ml_user_id: entrada.mlUserId,
    fetched: r.ok,
    http_status: r.status || null,
    fetch_error: r.ok ? null : (r.error ?? "").slice(0, 500) || null,
    summary,
    occurred_at:
      iso(
        (payload as any)?.last_updated ??
          (payload as any)?.date_last_updated ??
          (payload as any)?.date_created,
      ) ?? agora,
    times_seen: Number(existente?.times_seen ?? 0) + 1,
    first_seen_at: existente?.first_seen_at ?? agora,
    last_seen_at: agora,
  };
  // Só sobrescreve o corpo quando conseguimos ler algo: uma leitura que falhou
  // não pode apagar o payload bom que já estava gravado.
  if (r.ok) row["payload"] = payload;

  const { error } = await db("ml_topic_events").upsert(row, {
    onConflict: "account_id,topic,resource",
  });
  if (error) throw new Error(`Evento ${def.chave}: ${error.message}`);

  return { fetched: r.ok, resourceId, summary };
}

/* -------------------------------------------------------------------------- */
/* Roteador                                                                    */
/* -------------------------------------------------------------------------- */

export type ResultadoTopico = {
  status: "processed" | "ignored" | "error";
  error?: string;
  detalhe: Record<string, unknown>;
};

/**
 * Processa toda notificação que NÃO é pedido nem envio.
 *
 * Chamado por processNotification (ml-sync.server.ts), que continua cuidando
 * de orders_v2 e shipments com a sincronização completa deles.
 */
export async function processarTopico(
  account: MlAccount,
  entrada: { topic: string; resource: string; mlUserId: string | null },
): Promise<ResultadoTopico> {
  const { logEvent } = await import("./logs.server");
  const def = identificarTopico(entrada.topic, entrada.resource);
  const id = idDoRecurso(entrada.resource);

  if (!def) {
    // Tópico realmente desconhecido (o ML lançou algo novo). Guardamos assim
    // mesmo, sob um rótulo neutro — melhor um registro genérico que nada.
    const generico: DefinicaoTopico = {
      chave: "desconhecido",
      grupo: "others",
      rotulo: "Tópico novo do Mercado Livre",
      aliases: [],
      tratamento: "generico",
      acao: "topico.desconhecido",
      descricao: "Tópico ainda não catalogado.",
    };
    const r = await salvarEventoGenerico(account, generico, entrada);
    await logEvent({
      category: "webhook",
      action: "topico.desconhecido",
      accountId: account.id,
      mlUserId: account.ml_user_id,
      endpoint: entrada.resource,
      message: `Tópico não catalogado: ${entrada.topic}. Conteúdo guardado mesmo assim.`,
      detail: { topic: entrada.topic, resource: entrada.resource, corpo_lido: r.fetched },
    });
    return { status: "processed", detalhe: { topico: "desconhecido", topic: entrada.topic, id } };
  }

  switch (def.chave) {
    /* ------------------------------ perguntas ------------------------------ */
    case "questions": {
      const res = await fetchQuestion(account, id);
      const q: any = res.ok ? res.data : null;
      if (q) await salvarPergunta(account, q);
      await logEvent({
        category: "webhook",
        action: q?.answer ? "pergunta.respondida" : "pergunta.recebida",
        accountId: account.id,
        mlUserId: account.ml_user_id,
        endpoint: entrada.resource,
        message: q?.text ? `Pergunta: ${String(q.text).slice(0, 200)}` : "Pergunta recebida.",
        detail: {
          question_id: id,
          item_id: q?.item_id ?? null,
          status: q?.status ?? null,
          gravada: Boolean(q),
        },
      });
      return { status: "processed", detalhe: { topico: "questions", id, gravada: Boolean(q) } };
    }

    /* -------------------------------- anúncios ------------------------------ */
    case "items": {
      const res = await fetchItem(account, id);
      const item: any = res.ok ? res.data : null;
      if (item) await salvarAnuncio(account, item);
      await logEvent({
        category: "webhook",
        action: "anuncio.atualizado",
        accountId: account.id,
        mlUserId: account.ml_user_id,
        endpoint: entrada.resource,
        message: `Anúncio ${id} teve alteração.`,
        detail: {
          item_id: id,
          titulo: item?.title ?? null,
          status: item?.status ?? null,
          preco: item?.price ?? null,
          estoque: item?.available_quantity ?? null,
          gravado: Boolean(item),
        },
      });
      return { status: "processed", detalhe: { topico: "items", id, gravado: Boolean(item) } };
    }

    /* ------------------------------- mensagens ------------------------------ */
    case "messages": {
      const gravadas = await processarMensagens(account, entrada);
      await logEvent({
        category: "webhook",
        action: "mensagem.recebida",
        accountId: account.id,
        mlUserId: account.ml_user_id,
        endpoint: entrada.resource,
        message: "Nova mensagem na conversa de um pedido.",
        detail: { resource: entrada.resource, mensagens_gravadas: gravadas },
      });
      return { status: "processed", detalhe: { topico: "messages", id, mensagens: gravadas } };
    }

    /* ------------------------------ pagamentos ------------------------------ */
    case "payments": {
      const res = await fetchPayment(account, id);
      let gravado = false;
      if (res.ok && res.data) {
        try {
          gravado = Boolean(await salvarPagamento(account, res.data));
        } catch {
          gravado = false;
        }
      }
      await logEvent({
        category: "webhook",
        action: "pagamento.atualizado",
        accountId: account.id,
        mlUserId: account.ml_user_id,
        endpoint: entrada.resource,
        message: `Pagamento ${id} mudou de estado; sincronizando pedidos.`,
        detail: { payment_id: id, gravado, leitura: res.ok ? "ok" : (res.error ?? "falhou") },
      });
      // Fora do fluxo atual, para não aninhar execuções — o pedido correspondente
      // pode ter virado "paid" e a sincronização incremental resolve sem adivinhar.
      const { syncAccount } = await import("./ml-sync.server");
      void syncAccount(account.id, { kind: "incremental", trigger: "webhook:payments" });
      return { status: "processed", detalhe: { topico: "payments", id, gravado } };
    }

    /* ---------------------------- avaliação do pedido ---------------------- */
    case "orders_feedback": {
      // O recurso é /orders/{orderId}/feedback: o id do pedido NÃO é o último
      // segmento. Sem isso a leitura tentaria buscar um pedido chamado "feedback".
      const mlOrderId = extrairOrderIdDeFeedback(entrada.resource);
      if (!mlOrderId) {
        return {
          status: "ignored",
          error: `Recurso de feedback sem id de pedido: ${entrada.resource}`,
          detalhe: {},
        };
      }
      const res = await fetchOrderFeedback(account, mlOrderId);
      let gravados = 0;
      if (res.ok && res.data) gravados = await salvarFeedbackPedido(account, mlOrderId, res.data);
      await logEvent({
        category: "webhook",
        action: "pedido.avaliacao",
        accountId: account.id,
        mlUserId: account.ml_user_id,
        endpoint: entrada.resource,
        message: `Pedido ${mlOrderId} recebeu avaliação.`,
        detail: {
          order_id: mlOrderId,
          avaliacoes_gravadas: gravados,
          leitura: res.ok ? "ok" : (res.error ?? "falhou"),
        },
      });
      return {
        status: "processed",
        detalhe: { topico: "orders_feedback", order_id: mlOrderId, gravados },
      };
    }

    /* ------------------------------ reclamações ---------------------------- */
    case "claims":
    case "claims_actions": {
      const mlClaimId = extrairClaimId(entrada.resource) || id;
      if (!mlClaimId) {
        return {
          status: "ignored",
          error: `Recurso de reclamação sem id: ${entrada.resource}`,
          detalhe: {},
        };
      }

      const [detalhe, acoes] = await Promise.all([
        fetchClaim(account, mlClaimId),
        fetchClaimActions(account, mlClaimId),
      ]);

      const listaAcoes = acoes.ok ? normalizarAcoes(acoes.data) : null;
      let gravada = false;

      if (detalhe.ok && detalhe.data) {
        await salvarReclamacao(account, detalhe.data, listaAcoes);
        gravada = true;
      } else if (listaAcoes?.length) {
        // A reclamação não pôde ser lida, mas as ações sim: guarda o que dá.
        await salvarAcoesReclamacao(account, mlClaimId, null, listaAcoes);
      }

      await logEvent({
        category: "webhook",
        action: def.chave === "claims_actions" ? "reclamacao.acao" : "reclamacao.atualizada",
        accountId: account.id,
        mlUserId: account.ml_user_id,
        endpoint: entrada.resource,
        message: `Reclamação ${mlClaimId} ${def.chave === "claims_actions" ? "com nova ação disponível" : "aberta ou atualizada"}.`,
        detail: {
          claim_id: mlClaimId,
          gravada,
          acoes: listaAcoes?.length ?? 0,
          status: (detalhe.data as any)?.status ?? null,
          stage: (detalhe.data as any)?.stage ?? null,
        },
      });
      return { status: "processed", detalhe: { topico: def.chave, claim_id: mlClaimId, gravada } };
    }

    /* -------------------------------- restante ------------------------------ */
    default: {
      const r = await salvarEventoGenerico(account, def, entrada);
      await logEvent({
        category: "webhook",
        action: def.acao,
        accountId: account.id,
        mlUserId: account.ml_user_id,
        endpoint: entrada.resource,
        message: r.summary,
        detail: {
          topico: def.chave,
          grupo: def.grupo,
          resource_id: r.resourceId,
          corpo_lido: r.fetched,
        },
      });
      return {
        status: "processed",
        detalhe: { topico: def.chave, id: r.resourceId, corpo_lido: r.fetched },
      };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Auxiliares de roteamento                                                    */
/* -------------------------------------------------------------------------- */

/** `/orders/2000012345/feedback` -> `2000012345` */
function extrairOrderIdDeFeedback(resource: string): string | null {
  const m = /\/orders\/([^/?]+)/i.exec(String(resource ?? ""));
  return m?.[1] ?? null;
}

/** `/post-purchase/v1/claims/5000123/actions` -> `5000123` */
function extrairClaimId(resource: string): string | null {
  const m = /\/claims\/([^/?]+)/i.exec(String(resource ?? ""));
  return m?.[1] ?? null;
}

/** As ações vêm ora como array direto, ora dentro de `results`/`actions`. */
function normalizarAcoes(data: any): any[] {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.actions)) return data.actions;
  if (Array.isArray(data?.available_actions)) return data.available_actions;
  return [];
}

/**
 * Resolve a conversa de um recurso de mensagem e grava o que encontrar.
 *
 * O ML notifica de três jeitos diferentes:
 *   /messages/packs/{pack}/sellers/{seller}  — a conversa inteira
 *   /packs/{pack}/...                        — só o pack
 *   /messages/{id}                           — uma mensagem só
 */
async function processarMensagens(
  account: MlAccount,
  entrada: { topic: string; resource: string },
): Promise<number> {
  const recurso = String(entrada.resource ?? "");
  const packMatch = /\/packs\/([^/?]+)/i.exec(recurso);
  const sellerMatch = /\/sellers\/([^/?]+)/i.exec(recurso);

  if (packMatch?.[1]) {
    const packId = packMatch[1];
    const sellerId = sellerMatch?.[1] ?? String(account.ml_user_id);
    const res = await fetchPackMessages(account, packId, sellerId);
    if (res.ok && res.data) {
      const lista = Array.isArray(res.data)
        ? res.data
        : (res.data.messages ?? res.data.results ?? []);
      return salvarMensagens(account, lista, { packId });
    }
    return 0;
  }

  const mensagemMatch = /\/messages\/([^/?]+)/i.exec(recurso);
  if (mensagemMatch?.[1]) {
    const res = await fetchMessage(account, mensagemMatch[1]);
    if (res.ok && res.data) {
      const lista = Array.isArray(res.data) ? res.data : (res.data.messages ?? [res.data]);
      return salvarMensagens(account, lista);
    }
  }
  return 0;
}
