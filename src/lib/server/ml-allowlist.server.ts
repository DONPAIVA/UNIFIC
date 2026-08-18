/**
 * Allowlist do API CONSOLE da CentralML.
 *
 * A CentralML NÃƒO Ã© um proxy HTTP arbitrÃ¡rio. SÃ³ passam por aqui caminhos
 * conhecidos da API oficial do Mercado Livre (https://api.mercadolibre.com),
 * com o mÃ©todo que a API realmente aceita.
 *
 * Bloqueado sempre:
 *   - qualquer host que nÃ£o seja api.mercadolibre.com
 *   - localhost / 127.0.0.1 / ::1 / IPs privados / .internal / metadata
 *   - protocolos diferentes de HTTPS
 *   - Authorization vindo do navegador (o header Ã© montado sÃ³ no backend)
 *   - qualquer header perigoso enviado pelo cliente
 */

export const ML_API_HOST = "api.mercadolibre.com";

export type AllowedEndpoint = {
  /** RÃ³tulo mostrado na CentralML. */
  label: string;
  /** PadrÃ£o do caminho; `:id` casa com um segmento sem barra. */
  pattern: string;
  methods: Array<"GET" | "POST" | "PUT">;
  description: string;
};

/**
 * Somente endpoints que existem na API oficial do Mercado Livre.
 * Nada Ã© inventado: cada entrada corresponde a uma rota documentada.
 */
export const ML_ALLOWED_ENDPOINTS: AllowedEndpoint[] = [
  { label: "UsuÃ¡rio autenticado", pattern: "/users/me", methods: ["GET"], description: "Dados da conta que autorizou o app." },
  { label: "UsuÃ¡rio por ID", pattern: "/users/:id", methods: ["GET"], description: "Perfil pÃºblico de um usuÃ¡rio." },
  { label: "EndereÃ§os do usuÃ¡rio", pattern: "/users/:id/addresses", methods: ["GET"], description: "EndereÃ§os cadastrados." },
  { label: "AplicaÃ§Ãµes autorizadas", pattern: "/users/:id/applications/:id", methods: ["GET"], description: "Status da autorizaÃ§Ã£o do app." },
  { label: "Buscar pedidos", pattern: "/orders/search", methods: ["GET"], description: "Busca paginada de pedidos (use ?buyer= ou ?seller=)." },
  { label: "Pedido por ID", pattern: "/orders/:id", methods: ["GET"], description: "Detalhe de um pedido." },
  { label: "Feedback do pedido", pattern: "/orders/:id/feedback", methods: ["GET", "POST"], description: "Feedback de compra/venda do pedido." },
  { label: "Produto do pedido", pattern: "/orders/:id/product", methods: ["GET"], description: "Item associado ao pedido." },
  { label: "Envio do pedido", pattern: "/orders/:id/shipments", methods: ["GET"], description: "Envio vinculado ao pedido." },
  { label: "Envio por ID", pattern: "/shipments/:id", methods: ["GET"], description: "Detalhe do envio." },
  { label: "HistÃ³rico do envio", pattern: "/shipments/:id/history", methods: ["GET"], description: "Eventos de rastreamento do envio." },
  { label: "Itens do envio", pattern: "/shipments/:id/items", methods: ["GET"], description: "Itens do envio." },
  { label: "Custos do envio", pattern: "/shipments/:id/costs", methods: ["GET"], description: "Custos do envio." },
  { label: "SLA do envio", pattern: "/shipments/:id/sla", methods: ["GET"], description: "Prazo acordado do envio." },
  { label: "AnÃºncio", pattern: "/items/:id", methods: ["GET"], description: "Detalhe de um anÃºncio." },
  { label: "DescriÃ§Ã£o do anÃºncio", pattern: "/items/:id/description", methods: ["GET"], description: "DescriÃ§Ã£o do anÃºncio." },
  { label: "Site", pattern: "/sites/:id", methods: ["GET"], description: "ConfiguraÃ§Ã£o do site (MLB, MLA...)." },
  { label: "Categoria", pattern: "/categories/:id", methods: ["GET"], description: "Detalhe de categoria." },
  { label: "Moeda", pattern: "/currencies/:id", methods: ["GET"], description: "Detalhe de moeda." },
  { label: "NotificaÃ§Ãµes perdidas", pattern: "/missed_feeds", methods: ["GET"], description: "NotificaÃ§Ãµes nÃ£o entregues ao webhook." },

  /* ---- Perguntas (o canal de conversa prÃ©-venda) â€” testado: LIBERADO ---- */
  { label: "Perguntas recebidas", pattern: "/my/received_questions/search", methods: ["GET"], description: "Perguntas feitas nos seus anÃºncios." },
  { label: "Buscar perguntas", pattern: "/questions/search", methods: ["GET"], description: "Perguntas por vendedor (?seller_id=) ou por autor (?from=)." },
  { label: "Pergunta por ID", pattern: "/questions/:id", methods: ["GET"], description: "Detalhe de uma pergunta." },
  { label: "Responder pergunta", pattern: "/answers", methods: ["POST"], description: "Responde uma pergunta: { question_id, text }." },

  /* ---- AnÃºncios e vendas ---- */
  { label: "AnÃºncios do usuÃ¡rio", pattern: "/users/:id/items/search", methods: ["GET"], description: "AnÃºncios publicados pela conta." },
  { label: "PromoÃ§Ãµes do vendedor", pattern: "/seller-promotions/users/:id", methods: ["GET"], description: "PromoÃ§Ãµes e ofertas da conta." },

  /* ---- Mensagens pÃ³s-venda ----
     Dependem de um pack_id vindo de um pedido real. Sem pedido nÃ£o foi
     possÃ­vel confirmar o formato, entÃ£o ficam aqui para uso quando houver. */
  { label: "Mensagens do pedido", pattern: "/messages/packs/:id/sellers/:id", methods: ["GET"], description: "Conversa pÃ³s-venda (precisa do pack_id do pedido)." },
  { label: "Mensagens por pack", pattern: "/messages/packs/:id", methods: ["GET"], description: "Mensagens de um pack de pedido." },

  /* ---- Reclamações (pós-venda) — rotas confirmadas por teste ---- */
  { label: "Buscar reclamações", pattern: "/post-purchase/v1/claims/search", methods: ["GET"], description: "Reclamações por estágio (?stage=claim|dispute)." },
  { label: "Reclamação por ID", pattern: "/post-purchase/v1/claims/:id", methods: ["GET"], description: "Detalhe de uma reclamação." },
  { label: "Mensagens da reclamação", pattern: "/post-purchase/v1/claims/:id/messages", methods: ["GET"], description: "Conversa dentro da reclamação." },
  { label: "Ações da reclamação", pattern: "/post-purchase/v1/claims/:id/actions", methods: ["GET"], description: "O que o ML permite fazer nesta reclamação." },
  { label: "Executar ação", pattern: "/post-purchase/v1/claims/:id/actions/:id", methods: ["POST"], description: "Executa uma ação disponível (fechar, responder, devolver...)." },

  /* ---- Pagamentos ----
     O tópico `payments` notifica ora /collections/{id}, ora /payments/{id}.
     Os dois apontam para o mesmo registro do Mercado Pago. */
  { label: "Pagamento (collection)", pattern: "/collections/:id", methods: ["GET"], description: "Detalhe de um pagamento pelo formato antigo." },
  { label: "Pagamento", pattern: "/payments/:id", methods: ["GET"], description: "Detalhe de um pagamento." },
  { label: "Pagamento (v1)", pattern: "/v1/payments/:id", methods: ["GET"], description: "Detalhe de um pagamento pela API do Mercado Pago." },
  { label: "Pagamentos do pedido", pattern: "/orders/:id/payments", methods: ["GET"], description: "Pagamentos vinculados a um pedido." },

  /* ---- Anúncios: preços, estoque e família de produtos ---- */
  { label: "Preços do anúncio", pattern: "/items/:id/prices", methods: ["GET"], description: "Preço base e promocional de um anúncio." },
  { label: "Estoque por local", pattern: "/items/:id/stock", methods: ["GET"], description: "Estoque do anúncio por local." },
  { label: "Locais de estoque", pattern: "/users/:id/stock/locations", methods: ["GET"], description: "Locais de estoque cadastrados na conta." },
  { label: "Famílias de produtos", pattern: "/user-products/families/:id", methods: ["GET"], description: "Família de produtos do usuário." },
  { label: "Produto do usuário", pattern: "/user-products/:id", methods: ["GET"], description: "Produto cadastrado pelo usuário." },
  { label: "Sugestão de preço", pattern: "/suggestions/items/:id/details", methods: ["GET"], description: "Sugestão de preço do ML para um anúncio." },

  /* ---- Catálogo ---- */
  { label: "Concorrência no catálogo", pattern: "/items/:id/price_to_win", methods: ["GET"], description: "O que falta para ganhar a disputa do catálogo." },
  { label: "Competição do anúncio", pattern: "/items/:id/competition", methods: ["GET"], description: "Situação do anúncio na disputa do catálogo." },
  { label: "Produto do catálogo", pattern: "/products/:id", methods: ["GET"], description: "Detalhe de um produto do catálogo." },

  /* ---- Promoções ---- */
  { label: "Ofertas do vendedor", pattern: "/seller-promotions/offers/:id", methods: ["GET"], description: "Detalhe de uma oferta." },
  { label: "Candidatos a promoção", pattern: "/seller-promotions/candidates/:id", methods: ["GET"], description: "Anúncio elegível para uma campanha." },
  { label: "Itens da promoção", pattern: "/seller-promotions/items/:id", methods: ["GET"], description: "Promoções que envolvem um anúncio." },

  /* ---- Envios: Full e Flex ---- */
  { label: "Estoque Full", pattern: "/inventories/:id/stock/fulfillment", methods: ["GET"], description: "Estoque de um item no Fulfillment (Full)." },
  { label: "Operações de estoque Full", pattern: "/stock/fulfillment/operations/search", methods: ["GET"], description: "Movimentações de estoque no Full." },
  { label: "Handshake do Flex", pattern: "/shipments/:id/handshakes", methods: ["GET"], description: "Confirmações de coleta/entrega no Flex." },

  /* ---- Faturamento e cotações ---- */
  { label: "Notas fiscais", pattern: "/billing/integration/monthly/periods", methods: ["GET"], description: "Períodos de faturamento da conta." },
  { label: "Cotações do anúncio", pattern: "/quotations/:id", methods: ["GET"], description: "Detalhe de uma cotação." },
];

const HOST_BLOCKLIST = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /\.internal$/i,
  /\.local$/i,
  /^metadata\./i,
];

export type AllowlistResult =
  | { ok: true; path: string; method: "GET" | "POST" | "PUT"; matched: AllowedEndpoint }
  | { ok: false; error: string };

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .split("/")
    .map((seg) => (seg === ":id" ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${escaped}$`);
}

/**
 * Valida um pedido do API Console.
 * Aceita caminho relativo ("/orders/search?buyer=1") ou URL absoluta
 * â€” mas a URL absoluta sÃ³ passa se for exatamente https://api.mercadolibre.com.
 */
export function validateMlRequest(rawEndpoint: string, rawMethod: string): AllowlistResult {
  const method = String(rawMethod ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "POST" && method !== "PUT") {
    return { ok: false, error: `MÃ©todo nÃ£o permitido: ${method}. Use GET, POST ou PUT.` };
  }

  const input = String(rawEndpoint ?? "").trim();
  if (!input) return { ok: false, error: "Informe o endpoint." };
  if (input.includes("\n") || input.includes("\r") || input.includes("\0")) {
    return { ok: false, error: "Endpoint contÃ©m caracteres invÃ¡lidos." };
  }

  let url: URL;
  try {
    url = input.startsWith("http://") || input.startsWith("https://")
      ? new URL(input)
      : new URL(input.startsWith("/") ? input : `/${input}`, `https://${ML_API_HOST}`);
  } catch {
    return { ok: false, error: "Endpoint invÃ¡lido." };
  }

  if (url.protocol !== "https:") {
    return { ok: false, error: "Somente HTTPS Ã© permitido." };
  }
  if (HOST_BLOCKLIST.some((re) => re.test(url.hostname))) {
    return { ok: false, error: "Destino interno bloqueado." };
  }
  if (url.hostname.toLowerCase() !== ML_API_HOST) {
    return { ok: false, error: `Somente ${ML_API_HOST} Ã© permitido. Host recebido: ${url.hostname}` };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Credenciais embutidas na URL nÃ£o sÃ£o permitidas." };
  }
  // Evita travessia (/orders/../../admin)
  if (url.pathname.includes("..")) {
    return { ok: false, error: "Caminho invÃ¡lido." };
  }

  const matched = ML_ALLOWED_ENDPOINTS.find((e) => patternToRegex(e.pattern).test(url.pathname));
  if (!matched) {
    return {
      ok: false,
      error: `Endpoint fora da allowlist: ${url.pathname}. Consulte a lista de endpoints permitidos.`,
    };
  }
  if (!matched.methods.includes(method)) {
    return {
      ok: false,
      error: `OperaÃ§Ã£o nÃ£o disponÃ­vel pela API oficial: ${method} ${url.pathname}. Permitido: ${matched.methods.join(", ")}.`,
    };
  }

  return { ok: true, path: `${url.pathname}${url.search}`, method, matched };
}
