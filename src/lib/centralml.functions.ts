/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * API da CentralML.
 *
 * MODELO DE ACESSO (regra que vale para TODAS as funções deste arquivo):
 *   - A CentralML é EXCLUSIVA do administrador do Únific+ (public.admin_users).
 *     Todas as funções exigem requireAdminUser. Cliente comum não tem painel:
 *     ele usa o rastreio e "Minhas compras" (src/lib/minha-conta.functions.ts).
 *   - Nenhum identificador vindo do navegador (accountId, orderId, ml_user_id)
 *     é aceito como prova de autorização: a posse é reconferida no servidor.
 *   - Nenhum token do Mercado Livre é devolvido ao navegador.
 *
 * O escopo por conta (accountScope/scopeByAccount) continua aplicado: para o
 * administrador ele não filtra nada, mas mantém a consulta correta quando uma
 * conta específica é selecionada — e é a rede de segurança se um dia a
 * CentralML voltar a ter acesso não-administrativo.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminUser, scopeByAccount, type Requester } from "./auth-middleware";

/*
 * As funções abaixo tocam o banco, então vivem em server/auth.server.ts e são
 * carregadas por import DINÂMICO — este arquivo é alcançável pelo bundle do
 * cliente e um import estático de server/ vazaria código do servidor.
 */

/** IDs das contas visíveis para o requisitante (null = admin, sem filtro). */
async function accountScope(user: Requester) {
  const { accountScope: fn } = await import("./server/auth.server");
  return fn(user);
}

/** Carrega uma conexão garantindo que o requisitante é o dono (ou é admin). */
async function requireOwnedAccount(user: Requester, accountId: string) {
  const { requireOwnedAccount: fn } = await import("./server/auth.server");
  return fn(user, accountId);
}

const ACCOUNT_FIELDS =
  "id, provider, ml_user_id, nickname, email, first_name, site_id, status, connected_at, created_at, last_sync_at, last_sync_status, last_error, expires_at, owner_user_id, reauth_required_at, last_activity_at";

type ListInput = {
  accountId?: string | null;
  q?: string | null;
  status?: string | null;
  limit?: number;
  offset?: number;
};

function normalizeList(input: ListInput | undefined): Required<ListInput> {
  return {
    accountId: input?.accountId?.trim() || null,
    q: input?.q?.trim() || null,
    status: input?.status?.trim() || null,
    limit: Math.min(Math.max(Number(input?.limit ?? 50), 1), 200),
    offset: Math.max(Number(input?.offset ?? 0), 0),
  };
}

/**
 * Resolve o filtro de contas de uma listagem.
 * Se o navegador pediu uma conta específica, a posse é conferida antes de usar.
 */
async function resolveScope(user: Requester, accountId: string | null): Promise<string[] | null> {
  if (accountId) {
    await requireOwnedAccount(user, accountId); // lança se não for dono
    return [accountId];
  }
  return accountScope(user);
}

/** Situação do access_token — derivada de expires_at. NUNCA devolve o token. */
function tokenStatusOf(a: { expires_at?: string | null; status?: string | null }): {
  state: "valido" | "expirando" | "expirado" | "reautorizacao" | "desconectado";
  expiresAt: string | null;
} {
  const expiresAt = a.expires_at ?? null;
  if (a.status === "reauth_required") return { state: "reautorizacao", expiresAt };
  if (a.status === "disconnected") return { state: "desconectado", expiresAt };
  if (!expiresAt) return { state: "expirado", expiresAt };
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return { state: "expirado", expiresAt };
  if (diff < 60 * 60 * 1000) return { state: "expirando", expiresAt };
  return { state: "valido", expiresAt };
}

/** Remove campos sensíveis antes de qualquer resposta ao navegador. */
function publicAccount(a: any) {
  const {
    access_token: _at,
    refresh_token: _rt,
    scope: _scope,
    owner_user_id: _owner,
    ...seguro
  } = a ?? {};
  return { ...seguro, tokenStatus: tokenStatusOf(a ?? {}) };
}

/* -------------------------------------------------------------------------- */
/* Sessão                                                                      */
/* -------------------------------------------------------------------------- */

export const adminSession = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .handler(async ({ context }) => ({
    email: context.user.email,
    role: context.user.isAdmin ? "admin" : "cliente",
    isAdmin: context.user.isAdmin,
    userId: context.user.userId,
  }));

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                   */
/* -------------------------------------------------------------------------- */

export const adminDashboard = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .handler(async ({ context }) => {
    const { db, admin } = await import("./server/db.server");
    const scope = await accountScope(context.user);

    const count = async (table: string, apply?: (q: any) => any) => {
      let q = admin.from(table).select("id", { count: "exact", head: true });
      q = scopeByAccount(q, scope);
      if (apply) q = apply(q);
      const { count: c } = await q;
      return c ?? 0;
    };

    const countConnections = async (apply?: (q: any) => any) => {
      let q = admin.from("ml_connections").select("id", { count: "exact", head: true });
      if (!context.user.isAdmin) q = q.eq("owner_user_id", context.user.userId);
      if (apply) q = apply(q);
      const { count: c } = await q;
      return c ?? 0;
    };

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [
      accounts,
      accountsActive,
      accountsError,
      accountsReauth,
      orders,
      shipments,
      delivered,
      events,
      syncErrors,
      recentOrders,
      tracking,
      tracking24h,
    ] = await Promise.all([
      countConnections(),
      countConnections((q: any) => q.eq("status", "active")),
      countConnections((q: any) => q.eq("status", "error")),
      countConnections((q: any) => q.eq("status", "reauth_required")),
      count("ml_orders"),
      count("ml_shipments"),
      count("ml_shipments", (q: any) => q.eq("status", "delivered")),
      count("ml_shipment_events"),
      count("ml_sync_runs", (q: any) => q.eq("status", "error")),
      count("ml_orders", (q: any) => q.gte("date_created", since24h)),
      count("rastreio_consultas"),
      count("rastreio_consultas", (q: any) => q.gte("created_at", since24h)),
    ]);

    // Webhooks não têm account_id — o vínculo é por ml_user_id.
    const mlUserIds = await scopedMlUserIds(context.user, scope);
    let webhookQuery = admin.from("ml_webhook_events").select("id", { count: "exact", head: true }).eq("status", "error");
    if (scope !== null) {
      webhookQuery = mlUserIds.length
        ? webhookQuery.in("ml_user_id", mlUserIds)
        : webhookQuery.in("ml_user_id", ["__nenhuma__"]);
    }

    let runsQuery = db("ml_sync_runs")
      .select(
        "id, account_id, kind, status, started_at, finished_at, duration_ms, orders_processed, shipments_processed, events_processed, error",
      )
      .order("started_at", { ascending: false })
      .limit(8);
    runsQuery = scopeByAccount(runsQuery, scope);

    let accountsQuery = db("ml_connections")
      .select("id, nickname, ml_user_id, status, last_sync_at, last_sync_status, expires_at")
      .order("created_at", { ascending: false })
      .limit(8);
    if (!context.user.isAdmin) accountsQuery = accountsQuery.eq("owner_user_id", context.user.userId);

    let trackingQuery = db("rastreio_consultas")
      .select("id, code, found, source, status, account_id, ip, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    trackingQuery = scopeByAccount(trackingQuery, scope);

    let logsQuery = db("system_logs")
      .select("id, level, category, action, message, error, created_at")
      .order("created_at", { ascending: false })
      .limit(10);
    logsQuery = scopeByAccount(logsQuery, scope);

    // Em paralelo: cada ida ao Supabase custa ~1,5 s, então cinco `await`
    // em série viravam ~7 s só nesta parte.
    const [{ count: webhookErrors }, { data: lastRuns }, { data: accountsList }, { data: lastTracking }, { data: lastLogs }] =
      await Promise.all([webhookQuery, runsQuery, accountsQuery, trackingQuery, logsQuery]);

    return {
      isAdmin: context.user.isAdmin,
      totals: {
        accounts,
        accountsActive,
        accountsError,
        accountsReauth,
        orders,
        shipments,
        delivered,
        events,
        syncErrors,
        webhookErrors: webhookErrors ?? 0,
        recentOrders,
        tracking,
        tracking24h,
      },
      lastRuns: lastRuns ?? [],
      accounts: (accountsList ?? []).map((a: any) => ({ ...a, tokenStatus: tokenStatusOf(a) })),
      lastTracking: lastTracking ?? [],
      lastLogs: lastLogs ?? [],
    };
  });

/** ml_user_id das contas visíveis — usado onde a tabela não tem account_id. */
async function scopedMlUserIds(user: Requester, scope: string[] | null): Promise<string[]> {
  const { db } = await import("./server/db.server");
  let q = db("ml_connections").select("ml_user_id");
  if (scope !== null) {
    if (scope.length === 0) return [];
    q = q.in("id", scope);
  } else if (!user.isAdmin) {
    q = q.eq("owner_user_id", user.userId);
  }
  const { data } = await q;
  return (data ?? []).map((r: any) => String(r.ml_user_id));
}

/* -------------------------------------------------------------------------- */
/* Contas                                                                      */
/* -------------------------------------------------------------------------- */

export const adminAccounts = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .handler(async ({ context }) => {
    const { db, admin } = await import("./server/db.server");

    let q = db("ml_connections").select(ACCOUNT_FIELDS).order("created_at", { ascending: false });
    if (!context.user.isAdmin) q = q.eq("owner_user_id", context.user.userId);
    const { data } = await q;
    const accounts = data ?? [];

    if (!accounts.length) return [];
    const ids = accounts.map((a: any) => String(a.id));

    /*
     * Contagem por conta em 5 consultas no total, não 5 POR conta.
     * Antes eram 5×N idas ao Supabase (~1,5 s cada); com 10 contas isso
     * significava 50 requisições só para preencher a tabela.
     * Aqui buscamos apenas a coluna account_id e contamos em memória.
     */
    const tally = async (tabela: string, apply?: (q: any) => any) => {
      let q = admin.from(tabela).select("account_id").in("account_id", ids).limit(50000);
      if (apply) q = apply(q);
      const { data } = await q;
      const mapa = new Map<string, number>();
      for (const linha of data ?? []) {
        const k = String(linha.account_id);
        mapa.set(k, (mapa.get(k) ?? 0) + 1);
      }
      return mapa;
    };

    const [orders, shipments, events, errors, tracking] = await Promise.all([
      tally("ml_orders"),
      tally("ml_shipments"),
      tally("ml_shipment_events"),
      tally("ml_sync_runs", (q: any) => q.eq("status", "error")),
      tally("rastreio_consultas"),
    ]);

    return accounts.map((a: any) => ({
      ...publicAccount(a),
      counts: {
        orders: orders.get(String(a.id)) ?? 0,
        shipments: shipments.get(String(a.id)) ?? 0,
        events: events.get(String(a.id)) ?? 0,
        errors: errors.get(String(a.id)) ?? 0,
        tracking: tracking.get(String(a.id)) ?? 0,
      },
    }));
  });

export const adminAccount = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .inputValidator((input: { id: string }) => ({ id: String(input.id) }))
  .handler(async ({ data, context }) => {
    await requireOwnedAccount(context.user, data.id);

    const { db, admin } = await import("./server/db.server");
    const { data: account } = await db("ml_connections").select(ACCOUNT_FIELDS).eq("id", data.id).maybeSingle();
    if (!account) throw new Error("Conta não encontrada.");

    const c = async (table: string, apply?: (q: any) => any) => {
      let q = admin.from(table).select("id", { count: "exact", head: true }).eq("account_id", data.id);
      if (apply) q = apply(q);
      const { count } = await q;
      return count ?? 0;
    };
    const [orders, shipments, events, errors] = await Promise.all([
      c("ml_orders"),
      c("ml_shipments"),
      c("ml_shipment_events"),
      c("ml_sync_runs", (q: any) => q.eq("status", "error")),
    ]);

    const [{ data: runs }, { data: logs }] = await Promise.all([
      db("ml_sync_runs")
        .select(
          "id, kind, status, started_at, finished_at, duration_ms, orders_processed, shipments_processed, events_processed, error",
        )
        .eq("account_id", data.id)
        .order("started_at", { ascending: false })
        .limit(10),
      db("system_logs")
        .select("id, level, category, action, endpoint, http_status, duration_ms, success, message, error, created_at")
        .eq("account_id", data.id)
        .order("created_at", { ascending: false })
        .limit(30),
    ]);

    return {
      account: publicAccount(account),
      counts: { orders, shipments, events, errors },
      runs: runs ?? [],
      logs: logs ?? [],
    };
  });

export const adminDisconnectAccount = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { id: string }) => ({ id: String(input.id) }))
  .handler(async ({ data, context }) => {
    await requireOwnedAccount(context.user, data.id);

    const { db } = await import("./server/db.server");
    const { logAudit } = await import("./server/audit.server");
    const { error } = await db("ml_connections")
      .update({
        status: "disconnected",
        access_token: "",
        refresh_token: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id);

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "conta.desconectar",
      entity: "ml_connections",
      entityId: data.id,
      accountId: data.id,
      success: !error,
      detail: error ? { message: error.message } : null,
    });
    if (error) throw new Error("Não foi possível desconectar a conta.");
    return { ok: true };
  });

/* -------------------------------------------------------------------------- */
/* Pedidos                                                                     */
/* -------------------------------------------------------------------------- */

export const adminOrders = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .inputValidator((input: ListInput | undefined) => normalizeList(input))
  .handler(async ({ data, context }) => {
    const { admin } = await import("./server/db.server");
    const scope = await resolveScope(context.user, data.accountId);

    let q = admin
      .from("ml_orders")
      .select(
        "id, account_id, ml_order_id, status, status_detail, date_created, last_updated, total_amount, currency_id, buyer_nickname, title, quantity, shipping_id, buyer_feedback_at, buyer_feedback_rating",
        { count: "exact" },
      )
      .order("date_created", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    q = scopeByAccount(q, scope);
    if (data.status) q = q.eq("status", data.status);
    if (data.q) {
      const term = data.q.replace(/[%,]/g, "");
      q = q.or(
        `ml_order_id.ilike.%${term}%,title.ilike.%${term}%,buyer_nickname.ilike.%${term}%,shipping_id.ilike.%${term}%`,
      );
    }
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);

    // Traz o tracking do envio junto, sem uma consulta por linha.
    const shippingIds = (rows ?? []).map((r: any) => r.shipping_id).filter(Boolean);
    const porShipment = new Map<string, any>();
    if (shippingIds.length) {
      let sq = admin
        .from("ml_shipments")
        .select("account_id, ml_shipment_id, tracking_number, status, substatus")
        .in("ml_shipment_id", shippingIds);
      sq = scopeByAccount(sq, scope);
      const { data: envios } = await sq;
      for (const s of envios ?? []) porShipment.set(`${s.account_id}:${s.ml_shipment_id}`, s);
    }

    const { canMarkReceived } = await import("./server/ml-api.server");
    return {
      rows: (rows ?? []).map((r: any) => {
        const envio = r.shipping_id ? porShipment.get(`${r.account_id}:${r.shipping_id}`) : null;
        return {
          ...r,
          tracking_code: envio?.tracking_number ?? null,
          shipment_status: envio?.status ?? null,
          canMarkReceived: canMarkReceived(r),
        };
      }),
      total: count ?? 0,
    };
  });

export const adminOrder = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .inputValidator((input: { id: string }) => ({ id: String(input.id) }))
  .handler(async ({ data, context }) => {
    const { db } = await import("./server/db.server");
    const { data: order } = await db("ml_orders").select("*").eq("id", data.id).maybeSingle();
    if (!order) throw new Error("Pedido não encontrado.");

    // A posse do PEDIDO é a posse da CONTA dele. Sem esta linha, qualquer
    // cliente leria o pedido de outro só sabendo o id (IDOR).
    await requireOwnedAccount(context.user, order.account_id);

    const { data: account } = await db("ml_connections")
      .select("id, nickname, ml_user_id, site_id, status")
      .eq("id", order.account_id)
      .maybeSingle();

    let shipment: any = null;
    let events: any[] = [];
    if (order.shipping_id) {
      const { data: s } = await db("ml_shipments")
        .select("*")
        .eq("account_id", order.account_id)
        .eq("ml_shipment_id", String(order.shipping_id))
        .maybeSingle();
      shipment = s ?? null;
      if (shipment) {
        const { data: ev } = await db("ml_shipment_events")
          .select("id, status, substatus, description, event_date, source")
          .eq("shipment_id", shipment.id)
          .order("event_date", { ascending: false })
          .limit(100);
        events = ev ?? [];
      }
    }

    /* ---- Enriquecimento AO VIVO na API do Mercado Livre ----
     * Endpoints confirmados com pedido real:
     *   /orders/{id}            200
     *   /orders/{id}/feedback   200  (mostra se já foi marcado como recebido)
     *   /orders/{id}/discounts  200  (cupons aplicados)
     *   /orders/{id}/billing_info 200
     *   /orders/{id}/product    204  (vazio quando não se aplica)
     */
    const { canMarkReceived, getAccount, mlFetch } = await import("./server/ml-api.server");
    const conta = await getAccount(order.account_id);
    const ator = `centralml:${context.user.email}`;
    const puxar = async (p: string) => {
      const r = await mlFetch(conta, p, { actor: ator });
      return r.ok ? r.data : null;
    };

    const [aoVivo, feedback, descontos, faturamento] = await Promise.all([
      puxar(`/orders/${order.ml_order_id}`),
      puxar(`/orders/${order.ml_order_id}/feedback`),
      puxar(`/orders/${order.ml_order_id}/discounts`),
      puxar(`/orders/${order.ml_order_id}/billing_info`),
    ]);

    const v: any = aoVivo ?? {};
    const tags: string[] = Array.isArray(v.tags) ? v.tags : [];
    const semEnvio = tags.includes("no_shipping") || !v?.shipping?.id;

    /* ---- Conversa pós-venda ----
     * Formato correto, descoberto testando contra pedido real:
     *   GET /messages/packs/{pack}/sellers/{SELLER}?tag=post_sale&mark_as_read=false
     *
     * Dois detalhes que fazem toda a diferença:
     *   1. `tag=post_sale` é OBRIGATÓRIO — sem ele a resposta é 404;
     *   2. o id no caminho é o do VENDEDOR DO PEDIDO, não o da conta conectada;
     *   3. quando o pedido não tem pack_id próprio, o pack é o próprio id do pedido.
     *
     * `mark_as_read=false` evita marcar as mensagens como lidas só por
     * abrirmos a tela — quem decide isso é o cliente, não o painel.
     */
    const packId = v.pack_id ?? order.pack_id ?? order.ml_order_id;
    const vendedorId = v.seller?.id ?? null;

    let conversa: { disponivel: boolean; motivo: string; mensagens: any; naoLidas: number } = {
      disponivel: false,
      motivo: "Não foi possível identificar o vendedor deste pedido.",
      mensagens: null,
      naoLidas: 0,
    };

    if (packId && vendedorId) {
      /*
       * A conversa vem PAGINADA. Sem `limit`/`offset` o Mercado Livre devolve
       * só a primeira página, e as mensagens antigas simplesmente somem da
       * tela — dá a impressão de que a conversa foi apagada.
       *
       * Aqui percorremos todas as páginas e montamos o histórico do começo ao
       * fim. O teto de 20 voltas (2000 mensagens) evita laço infinito se o ML
       * devolver paginação estranha.
       */
      const PAGINA = 100;
      const todas: any[] = [];
      let offset = 0;
      let ultimoStatus = 0;
      let algumaPaginaOk = false;

      for (let volta = 0; volta < 20; volta++) {
        const r = await mlFetch(
          conta,
          `/messages/packs/${packId}/sellers/${vendedorId}?tag=post_sale&mark_as_read=false&limit=${PAGINA}&offset=${offset}`,
          { actor: ator },
        );
        ultimoStatus = r.status;
        if (!r.ok) break;
        algumaPaginaOk = true;
        const lote: any[] = (r.data as any)?.messages ?? [];
        todas.push(...lote);
        if (lote.length < PAGINA) break;
        offset += PAGINA;
      }

      if (algumaPaginaOk) {
        // Ordem cronológica: a API não garante, e conversa fora de ordem
        // confunde mais que conversa incompleta.
        const msgs: any[] = todas.sort((a, b) => {
          const da = new Date(a?.message_date?.created ?? 0).getTime();
          const db2 = new Date(b?.message_date?.created ?? 0).getTime();
          return da - db2;
        });

        /*
         * Guarda no banco. A partir daí o histórico deixa de depender do que o
         * Mercado Livre resolve devolver: mensagem lida uma vez fica gravada.
         */
        try {
          const { salvarMensagens } = await import("./server/ml-topics.server");
          await salvarMensagens(conta, msgs, { packId: String(packId) });
        } catch {
          /* histórico é complemento; nunca derruba a tela do pedido */
        }

        conversa = {
          disponivel: true,
          motivo: "",
          naoLidas: msgs.filter((x: any) => !x?.message_date?.read).length,
          mensagens: msgs.map((x: any) => ({
            id: String(x.id ?? ""),
            texto: x.text ?? "",
            deMim: String(x.from?.user_id ?? "") === String(conta.ml_user_id),
            deUsuario: String(x.from?.user_id ?? ""),
            paraUsuario: String(x.to?.user_id ?? ""),
            enviadaEm: x.message_date?.created ?? null,
            lidaEm: x.message_date?.read ?? null,
            moderacao: x.message_moderation?.status ?? null,
            anexos: x.message_attachments ?? null,
          })),
        };
      } else {
        conversa = {
          disponivel: false,
          motivo: semEnvio
            ? `Sem conversa (HTTP ${ultimoStatus}). Este pedido é sem envio — o Mercado Livre nem sempre abre canal nesse caso.`
            : `O Mercado Livre respondeu ${ultimoStatus} para a conversa deste pedido.`,
          mensagens: null,
          naoLidas: 0,
        };
      }
    }

    /*
     * Reclamações DESTE pedido.
     *
     * O Mercado Livre não expõe busca de reclamação por pedido, então lemos os
     * dois estágios e filtramos pelo `resource_id`. São duas chamadas leves e
     * é o único caminho confiável.
     *
     * Para cada uma, perguntamos o que ELE permite fazer agora
     * (/claims/{id}/actions). A lista muda conforme o estágio e conforme você
     * ser comprador ou vendedor — por isso nunca inventamos ação: mostramos o
     * que a API respondeu.
     */
    const reclamacoes: any[] = [];
    try {
      const [emAndamento, emDisputa] = await Promise.all([
        mlFetch(conta, "/post-purchase/v1/claims/search?stage=claim", { actor: ator }),
        mlFetch(conta, "/post-purchase/v1/claims/search?stage=dispute", { actor: ator }),
      ]);

      const doPedido = [emAndamento, emDisputa]
        .flatMap((r) => ((r.data as any)?.data ?? []) as any[])
        .filter((c) => String(c?.resource_id ?? "") === String(order.ml_order_id));

      for (const c of doPedido) {
        const acoes = await mlFetch(conta, `/post-purchase/v1/claims/${c.id}/actions`, { actor: ator });
        const lista = (
          Array.isArray(acoes.data)
            ? acoes.data
            : ((acoes.data as any)?.available_actions ?? (acoes.data as any)?.results ?? [])
        )
          .map((a: any) => (typeof a === "string" ? a : (a?.action ?? a?.name ?? a?.id)))
          .filter(Boolean);

        reclamacoes.push({
          id: String(c.id),
          tipo: c.type ?? null,
          estagio: c.stage ?? null,
          status: c.status ?? null,
          motivo: c.reason_id ?? null,
          abertaEm: c.date_created ?? null,
          atualizadaEm: c.last_updated ?? null,
          acoesDisponiveis: lista,
        });
      }
    } catch {
      /* reclamação é complemento da tela; nunca derruba o pedido */
    }

    const fb: any = (feedback as any)?.purchase ?? null;

    return {
      order,
      account,
      shipment,
      events,
      actions: { canMarkReceived: canMarkReceived(order) },
      reclamacoes,

      aoVivo: {
        ok: Boolean(aoVivo),
        status: v.status ?? null,
        statusDetalhe: v.status_detail ?? null,
        tags,
        semEnvio,
        packId,
        vendedorId: v.seller?.id ?? null,
        vendedorNick: v.seller?.nickname ?? null,
        compradorNick: v.buyer?.nickname ?? null,
        pagoTotal: v.paid_amount ?? null,
        pagamentos: (v.payments ?? []).map((p: any) => ({
          id: String(p.id ?? ""),
          metodo: p.payment_method_id ?? null,
          tipo: p.payment_type ?? null,
          status: p.status ?? null,
          valor: p.total_paid_amount ?? p.transaction_amount ?? null,
          parcelas: p.installments ?? null,
          data: p.date_created ?? null,
        })),
        itens: (v.order_items ?? []).map((it: any) => ({
          id: it.item?.id ?? null,
          titulo: it.item?.title ?? null,
          categoria: it.item?.category_id ?? null,
          quantidade: it.quantity ?? null,
          precoUnitario: it.unit_price ?? null,
        })),
      },

      /* Já marcado como recebido? Vem direto do Mercado Livre. */
      feedback: fb
        ? {
            id: String(fb.id ?? ""),
            avaliacao: fb.rating ?? null,
            recebido: Boolean(fb.fulfilled),
            mensagem: fb.message ?? null,
            enviadoEm: fb.date_created ?? null,
          }
        : null,

      descontos: (descontos as any)?.details ?? [],
      faturamento: (faturamento as any)?.billing_info ?? null,
      conversa,
    };
  });

/* -------------------------------------------------------------------------- */
/* Envios e rastreamentos                                                      */
/* -------------------------------------------------------------------------- */

export const adminShipments = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .inputValidator((input: ListInput | undefined) => normalizeList(input))
  .handler(async ({ data, context }) => {
    const { admin } = await import("./server/db.server");
    const scope = await resolveScope(context.user, data.accountId);

    let q = admin
      .from("ml_shipments")
      .select(
        "id, account_id, order_id, ml_shipment_id, ml_order_id, mode, logistic_type, status, substatus, tracking_number, tracking_method, last_updated, estimated_delivery, receiver_name, receiver_city, receiver_state",
        { count: "exact" },
      )
      .order("last_updated", { ascending: false, nullsFirst: false })
      .range(data.offset, data.offset + data.limit - 1);

    q = scopeByAccount(q, scope);
    if (data.status) q = q.eq("status", data.status);
    if (data.q) {
      const term = data.q.replace(/[%,]/g, "");
      q = q.or(
        `ml_shipment_id.ilike.%${term}%,tracking_number.ilike.%${term}%,ml_order_id.ilike.%${term}%,receiver_name.ilike.%${term}%`,
      );
    }
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

export const adminShipmentEvents = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .inputValidator((input: { shipmentId: string }) => ({ shipmentId: String(input.shipmentId) }))
  .handler(async ({ data, context }) => {
    const { db } = await import("./server/db.server");
    const { data: envio } = await db("ml_shipments").select("id, account_id").eq("id", data.shipmentId).maybeSingle();
    if (!envio) throw new Error("Envio não encontrado.");
    await requireOwnedAccount(context.user, envio.account_id);

    const { data: rows } = await db("ml_shipment_events")
      .select("id, status, substatus, description, event_date, source, created_at")
      .eq("shipment_id", data.shipmentId)
      .order("event_date", { ascending: false })
      .limit(200);
    return rows ?? [];
  });

export const adminTracking = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .inputValidator((input: ListInput | undefined) => normalizeList(input))
  .handler(async ({ data, context }) => {
    const { admin } = await import("./server/db.server");
    const scope = await resolveScope(context.user, data.accountId);

    let q = admin
      .from("ml_shipment_events")
      .select("id, account_id, shipment_id, ml_shipment_id, status, substatus, description, event_date, source", {
        count: "exact",
      })
      .order("event_date", { ascending: false, nullsFirst: false })
      .range(data.offset, data.offset + data.limit - 1);

    q = scopeByAccount(q, scope);
    if (data.q) {
      const term = data.q.replace(/[%,]/g, "");
      q = q.or(`ml_shipment_id.ilike.%${term}%,description.ilike.%${term}%,status.ilike.%${term}%`);
    }
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

export const adminTrackingLive = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .inputValidator((input: ListInput | undefined) => normalizeList(input))
  .handler(async ({ data, context }) => {
    const { db, admin } = await import("./server/db.server");
    const scope = await resolveScope(context.user, data.accountId);

    let q = admin
      .from("rastreio_consultas")
      .select("id, code, marketplace, found, source, status, account_id, ml_shipment_id, ip, user_agent, created_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    q = scopeByAccount(q, scope);
    if (data.q) {
      const term = data.q.replace(/[%,]/g, "");
      q = q.or(`code.ilike.%${term}%,status.ilike.%${term}%`);
    }
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const resumoCount = async (apply?: (q: any) => any) => {
      let c = admin.from("rastreio_consultas").select("id", { count: "exact", head: true });
      c = scopeByAccount(c, scope);
      if (apply) c = apply(c);
      const { count: n } = await c;
      return n ?? 0;
    };
    const [last24h, encontrados, naoEncontrados] = await Promise.all([
      resumoCount((c: any) => c.gte("created_at", since24h)),
      resumoCount((c: any) => c.eq("found", true)),
      resumoCount((c: any) => c.eq("found", false)),
    ]);

    let recentesQuery = db("rastreio_consultas")
      .select("code, created_at, found")
      .order("created_at", { ascending: false })
      .limit(500);
    recentesQuery = scopeByAccount(recentesQuery, scope);
    const { data: recent } = await recentesQuery;

    const byCode = new Map<string, { code: string; consultas: number; ultima: string; found: boolean }>();
    for (const r of recent ?? []) {
      const prev = byCode.get(r.code);
      if (prev) prev.consultas += 1;
      else byCode.set(r.code, { code: r.code, consultas: 1, ultima: r.created_at, found: r.found });
    }
    const topCodes = [...byCode.values()].sort((a, b) => b.consultas - a.consultas).slice(0, 15);

    return {
      rows: rows ?? [],
      total: count ?? 0,
      resumo: { total: count ?? 0, last24h, encontrados, naoEncontrados },
      topCodes,
    };
  });

/* -------------------------------------------------------------------------- */
/* Ações no Mercado Livre                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Confirma o RECEBIMENTO do pedido na API OFICIAL do Mercado Livre
 * (POST /orders/{id}/feedback, fulfilled=true), com o token do dono do pedido.
 * O banco local só é atualizado depois de uma resposta de sucesso do ML.
 */
export const adminMarkReceived = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { orderId: string; rating?: "positive" | "neutral" | "negative"; message?: string }) => ({
    orderId: String(input.orderId),
    rating: (input.rating ?? "positive") as "positive" | "neutral" | "negative",
    message: String(input.message ?? "").slice(0, 160),
  }))
  .handler(async ({ data, context }) => {
    const { db } = await import("./server/db.server");
    const { getAccount, submitOrderFeedback, canMarkReceived } = await import("./server/ml-api.server");
    const { logAudit } = await import("./server/audit.server");
    const { logEvent } = await import("./server/logs.server");

    const { data: order } = await db("ml_orders")
      .select("id, account_id, ml_order_id, status, buyer_feedback_at")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!order) throw new Error("Pedido não encontrado.");

    // Confere que o pedido pertence a uma conta do requisitante ANTES de
    // qualquer chamada ao Mercado Livre.
    const conta = await requireOwnedAccount(context.user, order.account_id);

    if (!canMarkReceived(order)) {
      throw new Error(
        order.buyer_feedback_at
          ? "Este pedido já teve o feedback enviado ao Mercado Livre."
          : "Operação não aplicável a este pedido.",
      );
    }

    const account = await getAccount(order.account_id);
    const res = await submitOrderFeedback(account, order.ml_order_id, {
      fulfilled: true,
      rating: data.rating,
      ...(data.message ? { message: data.message } : {}),
    });

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "pedido.marcar_recebido",
      entity: "ml_orders",
      entityId: order.id,
      accountId: order.account_id,
      success: res.ok,
      detail: {
        ml_order_id: order.ml_order_id,
        ml_user_id: conta.ml_user_id,
        rating: data.rating,
        http_status: res.status,
        response: res.ok ? res.data : res.error,
      },
    });

    await logEvent({
      category: "pedidos",
      action: "pedido.marcar_recebido",
      accountId: order.account_id,
      mlUserId: conta.ml_user_id,
      endpoint: `/orders/${order.ml_order_id}/feedback`,
      method: "POST",
      httpStatus: res.status,
      success: res.ok,
      error: res.ok ? null : res.error,
      actor: context.user.email,
      ip: context.user.ip,
    });

    // NÃO alteramos o banco local quando o Mercado Livre recusa a operação.
    if (!res.ok) throw new Error(`O Mercado Livre não aceitou a operação (${res.error ?? res.status}).`);

    const patch = {
      buyer_feedback_at: new Date().toISOString(),
      buyer_feedback_status: "fulfilled",
      buyer_feedback_rating: data.rating,
    };
    await db("ml_orders").update(patch).eq("id", order.id);
    return { ok: true, ...patch };
  });

export const adminSyncAccount = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { accountId: string; full?: boolean }) => ({
    accountId: String(input.accountId),
    full: Boolean(input.full),
  }))
  .handler(async ({ data, context }) => {
    await requireOwnedAccount(context.user, data.accountId);

    const { syncAccount } = await import("./server/ml-sync.server");
    const { logAudit } = await import("./server/audit.server");
    const result = await syncAccount(data.accountId, {
      kind: data.full ? "initial" : "manual",
      trigger: `centralml:${context.user.email}`,
      full: data.full,
    });
    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: data.full ? "sync.completa" : "sync.manual",
      entity: "ml_connections",
      entityId: data.accountId,
      accountId: data.accountId,
      success: result.status === "success",
      detail: { orders: result.orders, shipments: result.shipments, events: result.events, error: result.error },
    });
    return result;
  });

export const adminRefreshToken = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { accountId: string }) => ({ accountId: String(input.accountId) }))
  .handler(async ({ data, context }) => {
    await requireOwnedAccount(context.user, data.accountId);

    const { getAccount, refreshAccessToken } = await import("./server/ml-api.server");
    const { logAudit } = await import("./server/audit.server");
    const account = await getAccount(data.accountId);
    try {
      const updated = await refreshAccessToken(account);
      await logAudit({
        adminUserId: context.user.userId,
        adminEmail: context.user.email,
        ip: context.user.ip,
        action: "conta.renovar_token",
        entity: "ml_connections",
        entityId: data.accountId,
        accountId: data.accountId,
        success: true,
      });
      // Devolve só a validade — nunca o token.
      return { ok: true, expiresAt: updated.expires_at };
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falha ao renovar.";
      await logAudit({
        adminUserId: context.user.userId,
        adminEmail: context.user.email,
        ip: context.user.ip,
        action: "conta.renovar_token",
        entity: "ml_connections",
        entityId: data.accountId,
        accountId: data.accountId,
        success: false,
        detail: { message },
      });
      throw new Error(message);
    }
  });

/* -------------------------------------------------------------------------- */
/* Sincronizações, webhooks, erros, logs, auditoria                            */
/* -------------------------------------------------------------------------- */

export const adminSyncRuns = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .inputValidator((input: ListInput | undefined) => normalizeList(input))
  .handler(async ({ data, context }) => {
    const { admin } = await import("./server/db.server");
    const scope = await resolveScope(context.user, data.accountId);

    let q = admin
      .from("ml_sync_runs")
      .select(
        "id, account_id, kind, status, trigger, started_at, finished_at, duration_ms, orders_processed, shipments_processed, events_processed, attempt, error",
        { count: "exact" },
      )
      .order("started_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    q = scopeByAccount(q, scope);
    if (data.status) q = q.eq("status", data.status);
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

export const adminErrors = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .handler(async ({ context }) => {
    const { db } = await import("./server/db.server");
    const scope = await accountScope(context.user);
    const mlUserIds = context.user.isAdmin ? [] : await scopedMlUserIds(context.user, scope);

    let syncQuery = db("ml_sync_runs")
      .select("id, account_id, kind, started_at, error")
      .eq("status", "error")
      .order("started_at", { ascending: false })
      .limit(60);
    syncQuery = scopeByAccount(syncQuery, scope);

    let hookQuery = db("ml_webhook_events")
      .select("id, topic, resource, ml_user_id, received_at, attempts, error")
      .eq("status", "error")
      .order("received_at", { ascending: false })
      .limit(60);
    if (scope !== null) {
      hookQuery = mlUserIds.length ? hookQuery.in("ml_user_id", mlUserIds) : hookQuery.in("ml_user_id", ["__nenhuma__"]);
    }

    let accQuery = db("ml_connections")
      .select("id, nickname, ml_user_id, status, last_error, updated_at")
      .not("last_error", "is", null)
      .order("updated_at", { ascending: false })
      .limit(60);
    if (!context.user.isAdmin) accQuery = accQuery.eq("owner_user_id", context.user.userId);

    const [{ data: syncs }, { data: hooks }, { data: accounts }] = await Promise.all([
      syncQuery,
      hookQuery,
      accQuery,
    ]);
    return { syncs: syncs ?? [], webhooks: hooks ?? [], accounts: accounts ?? [] };
  });

export const adminWebhookEvents = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .inputValidator((input: ListInput | undefined) => normalizeList(input))
  .handler(async ({ data, context }) => {
    const { admin } = await import("./server/db.server");
    const scope = await accountScope(context.user);
    const mlUserIds = await scopedMlUserIds(context.user, scope);

    let q = admin
      .from("ml_webhook_events")
      .select("id, topic, resource, ml_user_id, attempts, sent_at, received_at, processed_at, status, error", {
        count: "exact",
      })
      .order("received_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (scope !== null) {
      q = mlUserIds.length ? q.in("ml_user_id", mlUserIds) : q.in("ml_user_id", ["__nenhuma__"]);
    }

    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

/**
 * Recupera as notificações que o Mercado Livre não conseguiu entregar
 * enquanto a aplicação esteve offline (/missed_feeds).
 */
export const adminRecuperarPerdidas = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .handler(async ({ context }) => {
    const { recuperarNotificacoesPerdidas } = await import("./server/ml-missed.server");
    const { logAudit } = await import("./server/audit.server");

    const r = await recuperarNotificacoesPerdidas({ origem: `centralml:${context.user.email}`, limite: 100 });

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "webhook.recuperar_perdidas",
      entity: "ml_webhook_events",
      success: r.erros === 0,
      detail: { lidas: r.lidas, processadas: r.processadas, ignoradas: r.ignoradas, erros: r.erros },
    });

    return r;
  });

export const adminReprocessWebhook = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { id: string }) => ({ id: String(input.id) }))
  .handler(async ({ data, context }) => {
    const { db } = await import("./server/db.server");
    const { processNotification } = await import("./server/ml-sync.server");
    const { logAudit } = await import("./server/audit.server");

    const { data: hook } = await db("ml_webhook_events")
      .select("id, topic, resource, ml_user_id, attempts")
      .eq("id", data.id)
      .maybeSingle();
    if (!hook) throw new Error("Notificação não encontrada.");

    // A notificação pertence à conta do ml_user_id — confere a posse.
    if (!context.user.isAdmin) {
      const { data: conta } = await db("ml_connections")
        .select("id, owner_user_id")
        .eq("ml_user_id", String(hook.ml_user_id ?? ""))
        .maybeSingle();
      if (!conta || String(conta.owner_user_id ?? "") !== context.user.userId) {
        throw new Error("Notificação não encontrada.");
      }
    }

    const result = await processNotification({
      topic: hook.topic,
      resource: hook.resource,
      mlUserId: hook.ml_user_id ?? null,
    });

    await db("ml_webhook_events")
      .update({
        status: result.status,
        error: result.error ?? null,
        attempts: Number(hook.attempts ?? 1) + 1,
        processed_at: new Date().toISOString(),
      })
      .eq("id", hook.id);

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "webhook.reprocessar",
      entity: "ml_webhook_events",
      entityId: hook.id,
      success: result.status === "processed",
      detail: { topic: hook.topic, resource: hook.resource, error: result.error ?? null },
    });

    if (result.status === "error") throw new Error(result.error ?? "Falha ao reprocessar.");
    return { status: result.status, error: result.error ?? null };
  });

export const adminLogs = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .inputValidator((input: (ListInput & { category?: string | null; level?: string | null }) | undefined) => ({
    ...normalizeList(input),
    category: input?.category?.trim() || null,
    level: input?.level?.trim() || null,
  }))
  .handler(async ({ data, context }) => {
    const { admin } = await import("./server/db.server");
    const scope = await resolveScope(context.user, data.accountId);

    let q = admin
      .from("system_logs")
      .select(
        "id, level, category, action, account_id, ml_user_id, endpoint, method, http_status, duration_ms, success, message, error, detail, actor, ip, created_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    q = scopeByAccount(q, scope);
    if (data.category) q = q.eq("category", data.category);
    if (data.level) q = q.eq("level", data.level);
    if (data.q) {
      const term = data.q.replace(/[%,]/g, "");
      q = q.or(`action.ilike.%${term}%,message.ilike.%${term}%,endpoint.ilike.%${term}%,error.ilike.%${term}%`);
    }

    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

export const adminAudit = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .inputValidator((input: ListInput | undefined) => normalizeList(input))
  .handler(async ({ data, context }) => {
    const { admin } = await import("./server/db.server");
    const scope = await accountScope(context.user);

    let q = admin
      .from("admin_audit_log")
      .select("id, admin_email, action, entity, entity_id, account_id, success, detail, ip, created_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    q = scopeByAccount(q, scope);
    const { data: rows, count, error } = await q;
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

/* -------------------------------------------------------------------------- */
/* API CONSOLE                                                                 */
/* -------------------------------------------------------------------------- */

export const adminApiCatalog = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .handler(async () => {
    const { ML_ALLOWED_ENDPOINTS, ML_API_HOST } = await import("./server/ml-allowlist.server");
    return { host: ML_API_HOST, endpoints: ML_ALLOWED_ENDPOINTS };
  });

/**
 * Executa uma chamada à API OFICIAL do Mercado Livre com o token da conta
 * escolhida — depois de confirmar que a conta pertence ao requisitante.
 *
 * O navegador informa apenas conta + método + endpoint + body. O header
 * Authorization é montado AQUI e nunca volta na resposta. Não é um proxy
 * genérico: validateMlRequest aplica a allowlist e bloqueia host arbitrário,
 * localhost, rede interna e não-HTTPS (SSRF).
 */
export const adminApiConsole = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { accountId: string; method?: string; endpoint: string; body?: string }) => ({
    accountId: String(input.accountId ?? ""),
    method: String(input.method ?? "GET").toUpperCase(),
    endpoint: String(input.endpoint ?? "").trim().slice(0, 2000),
    body: String(input.body ?? "").slice(0, 20000),
  }))
  .handler(async ({ data, context }) => {
    const { validateMlRequest } = await import("./server/ml-allowlist.server");
    const { getAccount, mlFetch } = await import("./server/ml-api.server");
    const { logAudit } = await import("./server/audit.server");
    const { logEvent } = await import("./server/logs.server");

    if (!data.accountId) throw new Error("Selecione uma conta.");
    await requireOwnedAccount(context.user, data.accountId);

    const check = validateMlRequest(data.endpoint, data.method);
    if (!check.ok) {
      await logEvent({
        category: "api_request",
        action: "console.bloqueado",
        endpoint: data.endpoint,
        method: data.method,
        success: false,
        error: check.error,
        actor: context.user.email,
        ip: context.user.ip,
      });
      throw new Error(check.error);
    }

    let parsedBody: unknown = undefined;
    if (check.method !== "GET" && data.body.trim()) {
      try {
        parsedBody = JSON.parse(data.body);
      } catch {
        throw new Error("O corpo da requisição não é um JSON válido.");
      }
    }

    const account = await getAccount(data.accountId);
    const startedAt = Date.now();

    const res = await mlFetch(account, check.path, {
      method: check.method,
      ...(parsedBody !== undefined ? { body: JSON.stringify(parsedBody) } : {}),
      actor: `console:${context.user.email}`,
    });

    const durationMs = Date.now() - startedAt;

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "api_console.executar",
      entity: "ml_connections",
      entityId: account.id,
      accountId: account.id,
      success: res.ok,
      detail: { method: check.method, path: check.path, http_status: res.status, duration_ms: durationMs },
    });

    return {
      ok: res.ok,
      status: res.status,
      durationMs,
      endpoint: check.path,
      method: check.method,
      account: { id: account.id, mlUserId: account.ml_user_id, nickname: account.nickname },
      data: res.data,
      error: res.error,
    };
  });

/* -------------------------------------------------------------------------- */
/* Mercado Livre ao vivo                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Puxa AO VIVO, com o token da conta, tudo que a API do Mercado Livre libera.
 *
 * Os endpoints abaixo foram testados um a um contra a conta real. O que não
 * está aqui foi testado e NÃO funciona:
 *   - /users/{id}/addresses      -> 403, o app não recebeu essa permissão
 *   - /messages/unread           -> 404, não existe nesse formato
 *   - /reviews/user/{id}         -> 404
 *   - /users/{id}/reputation     -> 404 (a reputação vem dentro de /users/{id})
 *
 * As mensagens PÓS-VENDA dependem do pack_id de um pedido; por isso só são
 * buscadas quando existe pedido sincronizado com esse dado.
 */
export const adminMlAoVivo = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .inputValidator((input: { accountId: string }) => ({ accountId: String(input.accountId) }))
  .handler(async ({ data, context }) => {
    await requireOwnedAccount(context.user, data.accountId);

    const { getAccount, mlFetch } = await import("./server/ml-api.server");
    const conta = await getAccount(data.accountId);
    const id = conta.ml_user_id;
    const ator = `centralml:${context.user.email}`;

    const buscar = async (path: string) => {
      const r = await mlFetch(conta, path, { actor: ator });
      return { ok: r.ok, status: r.status, dados: r.data, erro: r.error };
    };

    const appId = (process.env["ML_CLIENT_ID"] ?? "").trim();

    // Em paralelo: a latência da API do ML soma rápido em série.
    // Cada endpoint abaixo foi testado com token real e devolveu HTTP 200.
    const [
      perfil,
      compras,
      vendas,
      comprasArquivadas,
      anuncios,
      perguntasRecebidas,
      perguntasFeitas,
      promocoes,
      notificacoes,
      autorizacao,
      aplicativo,
      pagamentos,
      envioPrefs,
      tiposAnuncio,
      visitas,
      faturas,
    ] = await Promise.all([
      buscar(`/users/${id}`),
      buscar(`/orders/search?buyer=${id}&sort=date_desc&limit=20`),
      buscar(`/orders/search?seller=${id}&sort=date_desc&limit=20`),
      buscar(`/orders/search/archived?buyer=${id}&limit=20`),
      buscar(`/users/${id}/items/search?limit=20`),
      buscar(`/my/received_questions/search?limit=25`),
      buscar(`/questions/search?from=${id}&limit=25`),
      buscar(`/seller-promotions/users/${id}?app_version=v2`),
      buscar(`/missed_feeds`),
      appId ? buscar(`/users/${id}/applications/${appId}`) : Promise.resolve({ ok: false, status: 0, dados: null, erro: "sem app id" }),
      appId ? buscar(`/applications/${appId}`) : Promise.resolve({ ok: false, status: 0, dados: null, erro: "sem app id" }),
      buscar(`/users/${id}/accepted_payment_methods`),
      buscar(`/users/${id}/shipping_preferences`),
      buscar(`/users/${id}/available_listing_types`),
      buscar(`/users/${id}/items_visits/time_window?last=30&unit=day`),
      buscar(`/billing/integration/monthly/periods?group=ML&document_type=BILL&limit=12`),
    ]);

    // Caixa de mensagens não lidas — exige tag=post_sale (sem ela dá 404).
    const naoLidas = await buscar(`/messages/unread?role=buyer&tag=post_sale`);

    /* ---- Detalhe de cada anúncio ----
     * O /items/{id} só devolve tudo para o DONO do anúncio (com o token de
     * outra conta dá 403), por isso usamos o token da conta selecionada.
     * Buscamos em paralelo, limitado a 20 para não estourar o tempo. */
    const idsAnuncios: string[] = ((anuncios.dados as any)?.results ?? []).slice(0, 20);
    const detalhesAnuncios = await Promise.all(
      idsAnuncios.map(async (itemId: string) => {
        const [item, visitas] = await Promise.all([
          buscar(`/items/${itemId}`),
          buscar(`/items/${itemId}/visits/time_window?last=30&unit=day`),
        ]);
        const i: any = item.dados ?? {};
        return {
          id: itemId,
          titulo: i.title ?? null,
          preco: i.price ?? null,
          moeda: i.currency_id ?? null,
          status: i.status ?? null,
          subStatus: i.sub_status ?? [],
          estoque: i.available_quantity ?? null,
          vendidos: i.sold_quantity ?? null,
          condicao: i.condition ?? null,
          tipoAnuncio: i.listing_type_id ?? null,
          freteGratis: i.shipping?.free_shipping ?? null,
          modoEnvio: i.shipping?.mode ?? null,
          logistica: i.shipping?.logistic_type ?? null,
          retiradaEmMaos: i.shipping?.local_pick_up ?? null,
          permalink: i.permalink ?? null,
          criadoEm: i.date_created ?? null,
          atualizadoEm: i.last_updated ?? null,
          foto: Array.isArray(i.pictures) && i.pictures[0]?.secure_url ? i.pictures[0].secure_url : null,
          garantia:
            (i.sale_terms ?? [])
              .filter((s: any) => /warranty|garantia/i.test(String(s.name ?? "")))
              .map((s: any) => s.value_name)
              .join(", ") || null,
          visitas30d: (visitas.dados as any)?.total_visits ?? 0,
          erro: item.erro,
        };
      }),
    );

    /* ---- Conversas pós-venda: só quando há pedido com pack_id ---- */
    const { db } = await import("./server/db.server");
    const { data: pedidos } = await db("ml_orders")
      .select("ml_order_id, pack_id, title, date_created")
      .eq("account_id", data.accountId)
      .not("pack_id", "is", null)
      .order("date_created", { ascending: false })
      .limit(5);

    // `mensagens: any` de propósito: o formato vem cru do Mercado Livre e o
    // validador de serialização do TanStack recusa `unknown`.
    const conversas: Array<{ pedido: string; pack: string; ok: boolean; mensagens: any; erro: string | null }> = [];
    for (const p of pedidos ?? []) {
      const r = await buscar(`/messages/packs/${p.pack_id}/sellers/${id}`);
      conversas.push({
        pedido: String(p.ml_order_id),
        pack: String(p.pack_id),
        ok: r.ok,
        mensagens: r.dados,
        erro: r.erro,
      });
    }

    const p: any = perfil.dados ?? {};

    return {
      conta: { nickname: conta.nickname, mlUserId: id, siteId: conta.site_id },

      perfil: perfil.ok
        ? {
            nickname: p.nickname ?? null,
            nome: [p.first_name, p.last_name].filter(Boolean).join(" ") || null,
            registradoEm: p.registration_date ?? null,
            tipo: p.user_type ?? null,
            permalink: p.permalink ?? null,
            pais: p.country_id ?? null,
            reputacaoComprador: p.buyer_reputation ?? null,
            reputacaoVendedor: p.seller_reputation ?? null,
            statusConta: p.status ?? null,
          }
        : null,

      compras: { ok: compras.ok, total: (compras.dados as any)?.paging?.total ?? 0, itens: (compras.dados as any)?.results ?? [], erro: compras.erro },
      vendas: { ok: vendas.ok, total: (vendas.dados as any)?.paging?.total ?? 0, itens: (vendas.dados as any)?.results ?? [], erro: vendas.erro },
      anuncios: {
        ok: anuncios.ok,
        total: (anuncios.dados as any)?.paging?.total ?? 0,
        ids: (anuncios.dados as any)?.results ?? [],
        detalhes: detalhesAnuncios,
        erro: anuncios.erro,
      },

      perguntasRecebidas: {
        ok: perguntasRecebidas.ok,
        total: (perguntasRecebidas.dados as any)?.total ?? 0,
        itens: (perguntasRecebidas.dados as any)?.questions ?? [],
        erro: perguntasRecebidas.erro,
      },
      perguntasFeitas: {
        ok: perguntasFeitas.ok,
        total: (perguntasFeitas.dados as any)?.total ?? 0,
        itens: (perguntasFeitas.dados as any)?.questions ?? [],
        erro: perguntasFeitas.erro,
      },

      comprasArquivadas: { ok: comprasArquivadas.ok, total: (comprasArquivadas.dados as any)?.paging?.total ?? 0, erro: comprasArquivadas.erro },
      promocoes: { ok: promocoes.ok, total: (promocoes.dados as any)?.paging?.total ?? 0, erro: promocoes.erro },
      notificacoes: { ok: notificacoes.ok, itens: (notificacoes.dados as any)?.messages ?? [], erro: notificacoes.erro },
      conversas,

      /* ---- autorização do aplicativo ---- */
      autorizacao: autorizacao.ok
        ? {
            appId: String((autorizacao.dados as any)?.app_id ?? ""),
            autorizadoEm: (autorizacao.dados as any)?.date_created ?? null,
            atualizadoEm: (autorizacao.dados as any)?.date_updated ?? null,
            escopos: String(conta.scope ?? "").split(" ").filter(Boolean),
          }
        : null,
      aplicativo: aplicativo.ok
        ? {
            nome: (aplicativo.dados as any)?.name ?? null,
            descricao: (aplicativo.dados as any)?.description ?? null,
            site: (aplicativo.dados as any)?.site_id ?? null,
          }
        : null,

      /* ---- configurações da conta ---- */
      pagamentos: {
        ok: pagamentos.ok,
        itens: Array.isArray(pagamentos.dados) ? (pagamentos.dados as any[]) : [],
        erro: pagamentos.erro,
      },
      envioPreferencias: { ok: envioPrefs.ok, dados: (envioPrefs.dados as any) ?? null, erro: envioPrefs.erro },
      tiposAnuncio: {
        ok: tiposAnuncio.ok,
        disponiveis: (tiposAnuncio.dados as any)?.available ?? [],
        erro: tiposAnuncio.erro,
      },

      /* ---- métricas e faturamento ---- */
      visitas: { ok: visitas.ok, total: (visitas.dados as any)?.total_visits ?? 0, dias: (visitas.dados as any)?.results ?? [], erro: visitas.erro },
      faturas: { ok: faturas.ok, total: (faturas.dados as any)?.paging?.total ?? 0, itens: (faturas.dados as any)?.results ?? [], erro: faturas.erro },

      /* Mensagens pós-venda não lidas, por conversa. */
      mensagensNaoLidas: {
        ok: naoLidas.ok,
        total: (naoLidas.dados as any)?.total ?? 0,
        conversas: ((naoLidas.dados as any)?.results ?? []).map((r: any) => ({
          recurso: r.resource,
          quantidade: r.count,
          // "/packs/{pack}/sellers/{seller}" -> extrai os dois ids
          pack: String(r.resource ?? "").split("/")[2] ?? null,
          vendedor: String(r.resource ?? "").split("/")[4] ?? null,
        })),
        erro: naoLidas.erro,
      },

      // Transparência: cada item abaixo foi testado com token real.
      indisponiveis: [
        { recurso: "Endereços do usuário", motivo: "HTTP 403 — o aplicativo não recebeu essa permissão." },
        { recurso: "Avaliações por usuário", motivo: "HTTP 404 — não há endpoint público." },
        { recurso: "Marcas do usuário", motivo: "HTTP 404 — só para contas de marca/oficial." },
        { recurso: "Lista negra de compradores", motivo: "HTTP 405 — não aceita leitura por este caminho." },
        { recurso: "Feeds do aplicativo", motivo: "HTTP 404 — endpoint descontinuado pelo Mercado Livre." },
      ],
    };
  });

/**
 * Reclamações (claims) da conta.
 *
 * CONSULTAR funciona: GET /post-purchase/v1/claims/search?stage=claim  -> 200
 * ABRIR uma reclamação NÃO tem endpoint público — testado:
 *   /post-purchase/v1/claims/reasons        404
 *   /post-purchase/v1/orders/{id}/actions   404
 *   /marketplace/claims/search              404
 * O Mercado Livre só permite abrir reclamação pelo site/app dele.
 */
export const adminReclamacoes = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .inputValidator((input: { accountId: string }) => ({ accountId: String(input.accountId) }))
  .handler(async ({ data, context }) => {
    await requireOwnedAccount(context.user, data.accountId);
    const { getAccount, mlFetch } = await import("./server/ml-api.server");
    const conta = await getAccount(data.accountId);
    const ator = `centralml:${context.user.email}`;

    const [emAndamento, encerradas] = await Promise.all([
      mlFetch(conta, `/post-purchase/v1/claims/search?stage=claim`, { actor: ator }),
      mlFetch(conta, `/post-purchase/v1/claims/search?stage=dispute`, { actor: ator }),
    ]);

    const mapear = (r: any) =>
      ((r.data as any)?.data ?? []).map((x: any) => ({
        id: String(x.id ?? ""),
        pedido: String(x.resource_id ?? ""),
        tipo: x.type ?? null,
        estagio: x.stage ?? null,
        status: x.status ?? null,
        motivo: x.reason_id ?? null,
        abertaEm: x.date_created ?? null,
        atualizadaEm: x.last_updated ?? null,
      }));

    return {
      emAndamento: { ok: emAndamento.ok, total: (emAndamento.data as any)?.paging?.total ?? 0, itens: mapear(emAndamento), erro: emAndamento.error },
      encerradas: { ok: encerradas.ok, total: (encerradas.data as any)?.paging?.total ?? 0, itens: mapear(encerradas), erro: encerradas.error },
      aviso:
        "Abrir e encerrar reclamação não têm endpoint público na API do Mercado Livre — isso é feito no site/app deles. Aqui você acompanha o andamento.",
    };
  });

/**
 * Detalhe de uma reclamação: dados, mensagens e AÇÕES DISPONÍVEIS.
 *
 * As ações não são inventadas por nós: o próprio Mercado Livre informa, em
 * /claims/{id}/actions, o que pode ser feito naquela reclamação específica —
 * depende do estágio dela e de você ser comprador ou vendedor.
 */
export const adminReclamacaoDetalhe = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .inputValidator((input: { accountId: string; claimId: string }) => ({
    accountId: String(input.accountId),
    claimId: String(input.claimId),
  }))
  .handler(async ({ data, context }) => {
    await requireOwnedAccount(context.user, data.accountId);
    const { getAccount, mlFetch } = await import("./server/ml-api.server");
    const conta = await getAccount(data.accountId);
    const ator = `centralml:${context.user.email}`;

    /* Quatro consultas: as duas últimas são os caminhos que levam ao
     * encerramento. Confirmei por teste que ambas as rotas existem
     * (respondem "Claim not found" para id inexistente, não "resource not
     * found"). Qual delas o Mercado Livre oferece depende da reclamação. */
    const [detalhe, mensagens, acoes, resolucoes] = await Promise.all([
      mlFetch(conta, `/post-purchase/v1/claims/${data.claimId}`, { actor: ator }),
      mlFetch(conta, `/post-purchase/v1/claims/${data.claimId}/messages`, { actor: ator }),
      mlFetch(conta, `/post-purchase/v1/claims/${data.claimId}/actions`, { actor: ator }),
      mlFetch(conta, `/post-purchase/v1/claims/${data.claimId}/expected-resolutions`, { actor: ator }),
    ]);

    const d: any = detalhe.data ?? {};
    const listaAcoes = Array.isArray(acoes.data)
      ? (acoes.data as any[])
      : ((acoes.data as any)?.available_actions ?? (acoes.data as any)?.actions ?? []);

    return {
      ok: detalhe.ok,
      erro: detalhe.error,
      reclamacao: detalhe.ok
        ? {
            id: String(d.id ?? data.claimId),
            pedido: String(d.resource_id ?? ""),
            tipo: d.type ?? null,
            estagio: d.stage ?? null,
            status: d.status ?? null,
            motivo: d.reason_id ?? null,
            abertaEm: d.date_created ?? null,
            atualizadaEm: d.last_updated ?? null,
            jogadores: d.players ?? [],
            resolucao: d.resolution ?? null,
          }
        : null,
      mensagens: Array.isArray(mensagens.data) ? mensagens.data : ((mensagens.data as any)?.messages ?? []),

      // Nomes vindos do próprio ML — a interface só mostra o que ele permitir.
      acoesDisponiveis: (listaAcoes ?? [])
        .map((x: any) => (typeof x === "string" ? x : x?.action ?? x?.name ?? x?.id))
        .filter(Boolean),
      avisoAcoes: acoes.ok ? null : `Ações: HTTP ${acoes.status}. ${acoes.error ?? ""}`,

      /* Resoluções esperadas — é por aqui que normalmente se encerra
       * (devolver, reembolsar, chegar a acordo). O formato varia, então
       * devolvemos cru também, para não esconder nada por engano. */
      resolucoes: {
        ok: resolucoes.ok,
        status: resolucoes.status,
        dados: resolucoes.data ?? null,
        erro: resolucoes.error,
      },

      /* Resposta crua das duas consultas de ação. Se o formato vier diferente
       * do previsto, o operador ainda enxerga tudo em vez de ver a tela vazia. */
      bruto: { acoes: acoes.data ?? null, resolucoes: resolucoes.data ?? null },
    };
  });

/**
 * Executa uma ação numa reclamação — SOMENTE uma das que o Mercado Livre
 * informou como disponível para aquela reclamação.
 *
 * Nunca inventamos nome de ação: se não veio na lista do ML, é recusado aqui
 * antes de sair qualquer chamada.
 */
export const adminReclamacaoAcao = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { accountId: string; claimId: string; acao: string; texto?: string }) => ({
    accountId: String(input.accountId),
    claimId: String(input.claimId),
    acao: String(input.acao ?? "").trim().slice(0, 60),
    texto: String(input.texto ?? "").trim().slice(0, 2000),
  }))
  .handler(async ({ data, context }) => {
    if (!data.acao) throw new Error("Escolha uma ação.");
    await requireOwnedAccount(context.user, data.accountId);

    const { getAccount, mlFetch } = await import("./server/ml-api.server");
    const { logAudit } = await import("./server/audit.server");
    const conta = await getAccount(data.accountId);
    const ator = `centralml:${context.user.email}`;

    // Confere na hora que a ação está mesmo disponível.
    const acoes = await mlFetch(conta, `/post-purchase/v1/claims/${data.claimId}/actions`, { actor: ator });
    const lista = (Array.isArray(acoes.data) ? acoes.data : ((acoes.data as any)?.available_actions ?? []))
      .map((x: any) => (typeof x === "string" ? x : x?.action ?? x?.name))
      .filter(Boolean);

    if (lista.length && !lista.includes(data.acao)) {
      throw new Error(
        `O Mercado Livre não permite “${data.acao}” nesta reclamação agora. Disponíveis: ${lista.join(", ") || "nenhuma"}.`,
      );
    }

    const res = await mlFetch(conta, `/post-purchase/v1/claims/${data.claimId}/actions/${data.acao}`, {
      method: "POST",
      body: JSON.stringify(data.texto ? { message: data.texto } : {}),
      actor: ator,
    });

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: `reclamacao.${data.acao}`,
      entity: "ml_claims",
      entityId: data.claimId,
      accountId: data.accountId,
      success: res.ok,
      detail: { claim_id: data.claimId, acao: data.acao, http_status: res.status },
    });

    if (!res.ok) throw new Error(`O Mercado Livre recusou a ação (${res.error ?? res.status}).`);
    return { ok: true, resposta: res.data };
  });

/**
 * Suspende ou reativa uma conexão DENTRO DO ÚNIFIC+.
 *
 * O que isto faz: o cliente deixa de ver e usar essa conta no Únific+
 * (compras, rastreio, sincronização). Os tokens ficam intactos, então
 * reativar é imediato e não exige nova autorização.
 *
 * O que isto NÃO faz: não bloqueia a conta da pessoa no Mercado Livre.
 * Ela continua dona da conta dela lá, e continua podendo usar o site do ML
 * e acionar o suporte deles. Nenhuma API permite tirar isso de alguém —
 * e é assim que deve ser.
 */
/**
 * Revoga a autorização do aplicativo DENTRO da conta do Mercado Livre.
 *
 * Diferente de `adminSuspenderConexao`, que só esconde a conta no Únific+ e
 * preserva os tokens: aqui a concessão morre no lado do Mercado Livre. O
 * aplicativo desaparece de "Aplicativos conectados" no app dela.
 *
 * IRREVERSÍVEL: só a própria pessoa pode autorizar de novo.
 *
 * A conexão local é marcada como desconectada e os tokens são apagados —
 * guardar credencial que não vale mais é só superfície exposta à toa.
 */
export const adminRevogarAutorizacao = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { accountId: string }) => ({ accountId: String(input?.accountId ?? "") }))
  .handler(async ({ data, context }) => {
    await requireOwnedAccount(context.user, data.accountId);

    const { db } = await import("./server/db.server");
    const { getAccount, revogarAutorizacao } = await import("./server/ml-api.server");
    const { getMlCredentials } = await import("./server/config.server");
    const { logAudit } = await import("./server/audit.server");

    const conta = await getAccount(data.accountId);
    const { clientId } = getMlCredentials();

    const res = await revogarAutorizacao(conta, clientId);

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "conta.autorizacao_revogada",
      entity: "ml_connections",
      entityId: conta.id,
      accountId: conta.id,
      success: res.ok,
      detail: {
        nickname: conta.nickname,
        ml_user_id: conta.ml_user_id,
        http_status: res.status,
        resposta: res.ok ? null : res.error,
      },
    });

    if (!res.ok) {
      throw new Error(`O Mercado Livre recusou a revogação (${res.error ?? res.status}).`);
    }

    // Só depois da confirmação do ML apagamos os tokens: se a chamada tivesse
    // falhado, jogar fora as credenciais deixaria a conta inacessível sem ter
    // revogado nada de fato.
    await db("ml_connections")
      .update({
        status: "disconnected",
        access_token: null,
        refresh_token: null,
        expires_at: null,
        last_error: `Autorização revogada por ${context.user.email}.`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", conta.id);

    return { ok: true, nickname: conta.nickname };
  });

export const adminSuspenderConexao = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { accountId: string; suspender: boolean; motivo?: string }) => ({
    accountId: String(input.accountId),
    suspender: Boolean(input.suspender),
    motivo: String(input.motivo ?? "").slice(0, 300),
  }))
  .handler(async ({ data, context }) => {
    await requireOwnedAccount(context.user, data.accountId);
    const { db } = await import("./server/db.server");
    const { logAudit } = await import("./server/audit.server");

    const agora = new Date().toISOString();
    const patch = data.suspender
      ? {
          status: "suspended",
          last_error: data.motivo || "Acesso suspenso pelo administrador do Únific+.",
          updated_at: agora,
        }
      : { status: "active", last_error: null, updated_at: agora };

    const { error } = await db("ml_connections").update(patch).eq("id", data.accountId);

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: data.suspender ? "conexao.suspender" : "conexao.reativar",
      entity: "ml_connections",
      entityId: data.accountId,
      accountId: data.accountId,
      success: !error,
      detail: { motivo: data.motivo || null },
    });

    if (error) throw new Error(error.message);
    return { ok: true, status: patch.status };
  });

/**
 * Envia uma mensagem na conversa pós-venda de um pedido.
 *
 * Endpoint oficial:
 *   POST /messages/packs/{pack}/sellers/{seller}?tag=post_sale
 *   body: { from: { user_id }, to: { user_id }, text }
 */
export const adminEnviarMensagem = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { orderId: string; texto: string }) => ({
    orderId: String(input.orderId),
    texto: String(input.texto ?? "").trim().slice(0, 2000),
  }))
  .handler(async ({ data, context }) => {
    if (!data.texto) throw new Error("Escreva a mensagem.");

    const { db } = await import("./server/db.server");
    const { data: pedido } = await db("ml_orders")
      .select("id, account_id, ml_order_id, pack_id")
      .eq("id", data.orderId)
      .maybeSingle();
    if (!pedido) throw new Error("Pedido não encontrado.");
    await requireOwnedAccount(context.user, pedido.account_id);

    const { getAccount, mlFetch } = await import("./server/ml-api.server");
    const { logAudit } = await import("./server/audit.server");
    const conta = await getAccount(pedido.account_id);
    const ator = `centralml:${context.user.email}`;

    // Precisamos das DUAS pontas do pedido: quem escreve e para quem.
    const detalhe = await mlFetch(conta, `/orders/${pedido.ml_order_id}`, { actor: ator });
    const pedidoMl = detalhe.data as any;
    const vendedorId = pedidoMl?.seller?.id;
    const compradorId = pedidoMl?.buyer?.id;
    if (!vendedorId) throw new Error("Não foi possível identificar o vendedor do pedido.");

    /*
     * O destinatário é a OUTRA ponta do pedido — nem sempre o vendedor.
     *
     * A conta conectada pode ser a COMPRADORA (e aí fala com o vendedor) ou a
     * VENDEDORA (e aí fala com o comprador). Fixar o vendedor como destinatário
     * funcionava só no primeiro caso: numa conta vendedora, remetente e
     * destinatário ficavam iguais e o Mercado Livre recusava com
     * 400 "Sender and receiver must not be the same".
     *
     * O id do CAMINHO continua sendo o do vendedor do pedido: ele identifica a
     * conversa, não o destinatário. Só o `to` do corpo é que muda.
     */
    const eu = String(conta.ml_user_id);
    const souVendedor = eu === String(vendedorId);
    const destinatarioId = souVendedor ? compradorId : vendedorId;

    if (!destinatarioId) {
      throw new Error(
        souVendedor
          ? "Não foi possível identificar o comprador do pedido."
          : "Não foi possível identificar o vendedor do pedido.",
      );
    }
    if (String(destinatarioId) === eu) {
      throw new Error(
        "Remetente e destinatário seriam a mesma conta. O Mercado Livre não permite enviar mensagem para si mesmo.",
      );
    }

    const pack = pedido.pack_id ?? pedido.ml_order_id;
    const res = await mlFetch(conta, `/messages/packs/${pack}/sellers/${vendedorId}?tag=post_sale`, {
      method: "POST",
      body: JSON.stringify({
        from: { user_id: eu },
        to: { user_id: String(destinatarioId) },
        text: data.texto,
      }),
      actor: ator,
    });

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "mensagem.enviar",
      entity: "ml_orders",
      entityId: pedido.id,
      accountId: pedido.account_id,
      success: res.ok,
      // O texto entra na auditoria: é ação em nome do cliente.
      detail: {
        ml_order_id: pedido.ml_order_id,
        pack,
        http_status: res.status,
        caracteres: data.texto.length,
        papel: souVendedor ? "vendedor" : "comprador",
        destinatario: String(destinatarioId),
      },
    });

    if (!res.ok) throw new Error(`O Mercado Livre recusou a mensagem (${res.error ?? res.status}).`);
    return { ok: true };
  });

/**
 * Responde uma pergunta no Mercado Livre, com o token da conta.
 * Endpoint oficial: POST /answers { question_id, text }.
 */
export const adminResponderPergunta = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { accountId: string; questionId: string | number; texto: string }) => ({
    accountId: String(input.accountId),
    questionId: String(input.questionId),
    texto: String(input.texto ?? "").trim().slice(0, 2000),
  }))
  .handler(async ({ data, context }) => {
    if (!data.texto) throw new Error("Escreva a resposta.");
    await requireOwnedAccount(context.user, data.accountId);

    const { getAccount, mlFetch } = await import("./server/ml-api.server");
    const { logAudit } = await import("./server/audit.server");
    const conta = await getAccount(data.accountId);

    const res = await mlFetch(conta, "/answers", {
      method: "POST",
      body: JSON.stringify({ question_id: Number(data.questionId), text: data.texto }),
      actor: `centralml:${context.user.email}`,
    });

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "pergunta.responder",
      entity: "ml_questions",
      entityId: data.questionId,
      accountId: data.accountId,
      success: res.ok,
      detail: { question_id: data.questionId, http_status: res.status },
    });

    if (!res.ok) throw new Error(`O Mercado Livre recusou a resposta (${res.error ?? res.status}).`);
    return { ok: true };
  });

/* -------------------------------------------------------------------------- */
/* Diagnóstico do OAuth                                                        */
/* -------------------------------------------------------------------------- */

export const adminDiagnostico = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .handler(async ({ context }) => {
    const { getConfigStatus, getMlRedirectUri } = await import("./server/config.server");
    const { db, admin } = await import("./server/db.server");

    const config = getConfigStatus();

    let redirectUri = "";
    try {
      redirectUri = getMlRedirectUri();
    } catch {
      redirectUri = "";
    }

    type Alcance = { ok: boolean; status: number | null; titulo: string; detalhe: string; comoResolver: string | null };

    let alcance: Alcance = {
      ok: false,
      status: null,
      titulo: "Redirect URI não configurada",
      detalhe: "Defina ML_REDIRECT_URI (ou APP_URL) no .env.",
      comoResolver: "Configure ML_REDIRECT_URI com a URL pública + /api/public/ml/callback.",
    };

    if (redirectUri) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      try {
        const res = await fetch(redirectUri, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
          },
        });
        const body = (await res.text()).slice(0, 600);
        const ngrokError = res.headers.get("ngrok-error-code");
        const location = res.headers.get("location") ?? "";

        if (res.status === 302 && location.includes("ml=erro")) {
          alcance = {
            ok: true,
            status: res.status,
            titulo: "Redirect URI acessível — o callback executa",
            detalhe: `A URL pública chega no handler da aplicação (302 → ${location}).`,
            comoResolver: null,
          };
        } else if (/this host .* is not allowed|Blocked request/i.test(body)) {
          alcance = {
            ok: false,
            status: res.status,
            titulo: "O servidor recusou o host público",
            detalhe: "O Vite respondeu “Blocked request. This host is not allowed”.",
            comoResolver:
              "Coloque o domínio em APP_URL/ML_REDIRECT_URI no .env e reinicie o dev server — vite.config.ts libera o host a partir dessas variáveis.",
          };
        } else if (ngrokError === "ERR_NGROK_6024" || /You are about to visit/i.test(body)) {
          alcance = {
            ok: false,
            status: res.status,
            titulo: "A página de aviso do ngrok está na frente",
            detalhe: "O ngrok gratuito mostra um aviso antes de entregar a requisição, na borda dele.",
            comoResolver:
              "Abra o Únific+ pelo domínio do túnel e clique em “Visit Site” uma vez, ou use domínio próprio / Cloudflare Tunnel.",
          };
        } else if (ngrokError === "ERR_NGROK_3200" || res.status === 404) {
          alcance = {
            ok: false,
            status: res.status,
            titulo: "O túnel não está no ar",
            detalhe: "O endereço público respondeu 404 — nenhum túnel atende esse domínio.",
            comoResolver: "Suba o túnel novamente no MESMO domínio configurado em ML_REDIRECT_URI.",
          };
        } else {
          alcance = {
            ok: false,
            status: res.status,
            titulo: `Resposta inesperada (HTTP ${res.status})`,
            detalhe: body.replace(/\s+/g, " ").slice(0, 300),
            comoResolver: "Confirme que a URL pública aponta para esta aplicação na porta 8080.",
          };
        }
      } catch (e) {
        const abortado = e instanceof Error && e.name === "AbortError";
        alcance = {
          ok: false,
          status: null,
          titulo: abortado ? "A Redirect URI não respondeu a tempo" : "Não foi possível alcançar a Redirect URI",
          detalhe: abortado ? "Tempo esgotado após 12s." : e instanceof Error ? e.message : "Falha de rede.",
          comoResolver: "Verifique se o túnel/domínio está no ar e apontando para esta aplicação.",
        };
      } finally {
        clearTimeout(timer);
      }
    }

    const agora = new Date().toISOString();
    // States são por usuário: o cliente só conta os próprios.
    const statesQuery = (cmp: "gte" | "lt") => {
      let q = admin.from("ml_oauth_states").select("state", { count: "exact", head: true });
      q = cmp === "gte" ? q.gte("expires_at", agora) : q.lt("expires_at", agora);
      if (!context.user.isAdmin) q = q.eq("owner_user_id", context.user.userId);
      return q;
    };

    let contasQuery = admin.from("ml_connections").select("id", { count: "exact", head: true });
    if (!context.user.isAdmin) contasQuery = contasQuery.eq("owner_user_id", context.user.userId);

    const [{ count: statesPendentes }, { count: statesExpirados }, { count: contas }] = await Promise.all([
      statesQuery("gte"),
      statesQuery("lt"),
      contasQuery,
    ]);

    const scope = await accountScope(context.user);
    let eventosQuery = db("system_logs")
      .select("id, created_at, action, success, message, error, detail, actor")
      .eq("category", "oauth")
      .order("created_at", { ascending: false })
      .limit(15);
    if (!context.user.isAdmin) eventosQuery = eventosQuery.eq("actor", context.user.email);
    void scope;

    const { data: eventos } = await eventosQuery;

    const iniciados = (eventos ?? []).filter((e: any) => e.action === "oauth.connect.iniciado").length;
    const concluidos = (eventos ?? []).filter((e: any) => e.action === "oauth.conta_conectada").length;

    return {
      isAdmin: context.user.isAdmin,
      redirectUri,
      webhookUrl: config.webhookUrl,
      hasClientId: config.hasClientId,
      hasClientSecret: config.hasClientSecret,
      alcance,
      contas: contas ?? 0,
      statesPendentes: statesPendentes ?? 0,
      statesExpirados: statesExpirados ?? 0,
      eventos: eventos ?? [],
      resumo: { iniciados, concluidos },
    };
  });

/** Remove states de OAuth já expirados (higiene; não afeta conexões). */
export const adminLimparStates = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .handler(async ({ context }) => {
    const { db } = await import("./server/db.server");
    const { logAudit } = await import("./server/audit.server");

    let q = db("ml_oauth_states").delete().lt("expires_at", new Date().toISOString());
    if (!context.user.isAdmin) q = q.eq("owner_user_id", context.user.userId);
    const { error } = await q;

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "oauth.limpar_states_expirados",
      entity: "ml_oauth_states",
      success: !error,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* -------------------------------------------------------------------------- */
/* Configurações — ADMINISTRADOR                                               */
/* -------------------------------------------------------------------------- */

export const adminConfig = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .handler(async ({ context }) => {
    const { getConfigStatus } = await import("./server/config.server");
    const { db, admin } = await import("./server/db.server");
    const { count: admins } = await admin.from("admin_users").select("email", { count: "exact", head: true });
    const { data: adminList } = await db("admin_users").select("*").order("created_at");
    return {
      ...getConfigStatus(),
      admins: admins ?? 0,
      adminList: (adminList ?? []).map((a: any) => ({
        user_id: a.user_id ?? a.id ?? null,
        email: a.email,
        role: a.role ?? "admin",
        status: a.status ?? "active",
        created_at: a.created_at ?? null,
      })),
      me: { email: context.user.email, role: "admin" },
    };
  });

export const adminAddAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { email: string }) => ({ email: String(input.email).trim().toLowerCase() }))
  .handler(async ({ data, context }) => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) throw new Error("E-mail inválido.");
    const { db, admin } = await import("./server/db.server");
    const { logAudit } = await import("./server/audit.server");

    const { data: list, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) throw new Error("Não foi possível consultar os usuários.");
    const user = (list?.users ?? []).find((u: any) => String(u.email ?? "").toLowerCase() === data.email);
    if (!user) {
      throw new Error("Nenhum usuário com esse e-mail no Supabase Auth. Crie-o primeiro em Authentication > Users.");
    }

    const { error } = await db("admin_users").upsert(
      { user_id: user.id, email: data.email, role: "admin", status: "active" },
      { onConflict: "email" },
    );
    if (error) throw new Error(error.message);

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "admin.adicionar",
      entity: "admin_users",
      entityId: user.id,
      detail: { email: data.email },
    });
    return { ok: true };
  });

export const adminRemoveAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { userId: string }) => ({ userId: String(input.userId) }))
  .handler(async ({ data, context }) => {
    if (data.userId === context.user.userId) throw new Error("Você não pode remover a si mesmo.");
    const { db, admin } = await import("./server/db.server");
    const { logAudit } = await import("./server/audit.server");

    const { count } = await admin.from("admin_users").select("email", { count: "exact", head: true });
    if ((count ?? 0) <= 1) throw new Error("É preciso manter ao menos um administrador.");

    const { error } = await db("admin_users").delete().eq("user_id", data.userId);
    if (error) throw new Error(error.message);

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "admin.remover",
      entity: "admin_users",
      entityId: data.userId,
    });
    return { ok: true };
  });
