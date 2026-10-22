/* eslint-disable @typescript-eslint/no-explicit-any */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/* -------------------------------------------------------------------------- */
/* Rastreio público (leitura da tabela `pedidos` pelo SERVIDOR)               */
/*                                                                            */
/* Antes o site lia a tabela `pedidos` direto com a chave pública, e o banco  */
/* permitia baixar a tabela INTEIRA — nome, endereço e CPF de todo mundo.     */
/* Agora a leitura é só por aqui: o servidor devolve apenas o pedido daquele  */
/* código (ou CPF), e sem o CPF. A tabela deixou de ser lida pela chave       */
/* pública (migração 20261023120000_tranca_leitura_dos_pedidos.sql).          */
/*                                                                            */
/* Sem middleware de propósito — é o rastreio aberto, de quem não tem conta.  */
/* O que protege é o filtro: só sai o que casa com o código/CPF informado.    */
/* -------------------------------------------------------------------------- */

/** Devolve o pedido sem o CPF — o cliente digitou o código, não precisa dele de volta. */
function semCpf(p: any): any {
  if (!p) return p;
  return { ...p, cpf: null };
}

const escaparIlike = (s: string) => s.replace(/([\\%_])/g, "\\$1");

/** Busca um rastreio pelo código. Mesma tolerância da versão antiga (espaço, ponto). */
export const rastrearPorCodigo = createServerFn({ method: "POST" })
  .inputValidator((input: { code: string; marketplace?: string | null }) => ({
    code: String(input?.code ?? "").trim().slice(0, 64),
    marketplace: input?.marketplace ? String(input.marketplace).slice(0, 40) : null,
  }))
  .handler(async ({ data }) => {
    if (!data.code) return { pedido: null as any };
    const { db } = await import("./server/db.server");

    const buscar = async (termo: string, parcial = false) => {
      const alvo = parcial ? `%${escaparIlike(termo)}%` : escaparIlike(termo);
      let q = db("pedidos").select("*").ilike("tracking_code", alvo).limit(1);
      if (data.marketplace) q = q.eq("marketplace", data.marketplace);
      const { data: rows } = await q;
      return ((rows ?? []) as any[])[0] ?? null;
    };

    let achado = await buscar(data.code);
    const semPontuacao = data.code.replace(/[.\s]/g, "");
    if (!achado && semPontuacao && semPontuacao !== data.code) achado = await buscar(semPontuacao);
    if (!achado && semPontuacao.length >= 4) achado = await buscar(semPontuacao, true);

    return { pedido: semCpf(achado) };
  });

/** Busca os rastreios cadastrados em um CPF. */
export const rastrearPorCpf = createServerFn({ method: "POST" })
  .inputValidator((input: { cpf: string }) => ({
    cpf: String(input?.cpf ?? "").replace(/\D/g, "").slice(0, 11),
  }))
  .handler(async ({ data }) => {
    if (data.cpf.length !== 11) return { pedidos: [] as any[] };
    const { db } = await import("./server/db.server");
    const p = `${data.cpf.slice(0, 3)}.${data.cpf.slice(3, 6)}.${data.cpf.slice(6, 9)}-${data.cpf.slice(9)}`;

    const { data: rows } = await db("pedidos")
      .select("*")
      .or([`cpf.eq.${data.cpf}`, `cpf.eq.${p}`, `cpf.ilike.%${data.cpf}%`, `cpf.ilike.%${p}%`].join(","))
      .order("created_at", { ascending: false })
      .limit(50);

    return { pedidos: ((rows ?? []) as any[]).map(semCpf) };
  });

/**
 * Avisos da página /notificacoes, montados no SERVIDOR.
 *
 * Só sai o necessário para a lista (código, status, última movimentação) —
 * nada de nome, endereço ou CPF. Antes a página baixava a tabela inteira.
 */
export const notificacoesPublicas = createServerFn({ method: "GET" }).handler(async () => {
  const { db } = await import("./server/db.server");
  const { buildMovimentos, statusFor } = await import("./tracking");

  const { data: rows } = await db("pedidos")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(60);

  const avisos = ((rows ?? []) as any[]).flatMap((p) => {
    const m = buildMovimentos(p)[0];
    return m
      ? [{
          code: String(p.tracking_code ?? ""),
          status: statusFor(p),
          title: m.title,
          place: m.place,
          at: m.at instanceof Date ? m.at.toISOString() : String(m.at),
        }]
      : [];
  });

  return { avisos };
});

/**
 * Registra uma consulta de rastreio feita no Unific+.
 * É isto que alimenta a aba RASTREAMENTO AO VIVO da CentralML:
 * quem consultou (IP/user-agent), qual código, quando, com que resultado.
 *
 * Nada é inventado: se ninguém consultar, a lista fica vazia.
 * O IP é lido no servidor — o navegador não escolhe o que registrar.
 */
export const registrarConsultaRastreio = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      code: string;
      marketplace?: string | null;
      found?: boolean;
      source?: "local" | "mercado_livre" | "nao_encontrado";
      status?: string | null;
    }) => ({
      code: String(input.code ?? "").trim().slice(0, 64),
      marketplace: input.marketplace ? String(input.marketplace).slice(0, 40) : null,
      found: Boolean(input.found),
      source: (["local", "mercado_livre", "nao_encontrado"] as const).includes(input.source as never)
        ? (input.source as "local" | "mercado_livre" | "nao_encontrado")
        : "nao_encontrado",
      status: input.status ? String(input.status).slice(0, 120) : null,
    }),
  )
  .handler(async ({ data }) => {
    if (!data.code) return { ok: false };

    const request = getRequest();
    const h = request.headers;
    const { ipDeHeaders } = await import("./server/ip.server");
    const ip = ipDeHeaders(h);

    const { db } = await import("./server/db.server");

    // Quando o código veio da integração, tentamos amarrar a consulta à conta
    // que realmente possui aquele envio — é assim que a CentralML separa por cliente.
    let accountId: string | null = null;
    let mlShipmentId: string | null = null;
    if (data.source === "mercado_livre") {
      const { data: rows } = await db("ml_shipments")
        .select("account_id, ml_shipment_id")
        .or(`tracking_number.eq.${data.code},ml_shipment_id.eq.${data.code},ml_order_id.eq.${data.code}`)
        .limit(1);
      const hit = rows?.[0];
      accountId = hit?.account_id ?? null;
      mlShipmentId = hit?.ml_shipment_id ?? null;
    }

    await db("rastreio_consultas").insert({
      code: data.code,
      marketplace: data.marketplace,
      found: data.found,
      source: data.source,
      status: data.status,
      account_id: accountId,
      ml_shipment_id: mlShipmentId,
      ip: ip ?? "local",
      user_agent: (h.get("user-agent") ?? "").slice(0, 300) || null,
      path: (() => {
        try {
          return new URL(request.url).pathname.slice(0, 200);
        } catch {
          return null;
        }
      })(),
    });

    const { logEvent } = await import("./server/logs.server");
    await logEvent({
      category: "rastreio",
      action: data.found ? "rastreio.consulta_encontrada" : "rastreio.consulta_sem_resultado",
      accountId,
      endpoint: "/",
      actor: "cliente",
      ip,
      success: data.found,
      message: `Código ${data.code} (${data.source}).`,
    });

    return { ok: true };
  });
