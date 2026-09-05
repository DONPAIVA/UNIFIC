/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Cadastro de rastreios — o que o painel de administração chama.
 *
 * Antes o painel falava direto com o banco usando a chave pública, a mesma que
 * vai em toda página do site. Qualquer visitante podia criar, editar e apagar
 * pedido sem nunca abrir o painel: a senha ali era enfeite.
 *
 * Agora tudo passa por aqui, atrás de `requireAdminUser` — que exige
 * administrador E o segundo fator. A escrita direta foi retirada da chave
 * pública na migração `20260905140000_fechar_escrita_publica.sql`.
 *
 * A LEITURA dos pedidos continua pública: é o que faz o rastreio do site
 * funcionar para quem não tem conta.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminUser } from "./auth-middleware";

/**
 * Colunas que o painel pode gravar.
 *
 * Lista fechada de propósito: o formulário manda o objeto inteiro, e sem esse
 * filtro um campo a mais na tela viraria uma coluna gravada sem querer — ou um
 * erro do banco reclamando de coluna que não existe.
 */
const COLUNAS = [
  "tracking_code", "marketplace", "sender", "recipient",
  "dest_address", "dest_city", "dest_state", "dest_cep",
  "origin_city", "origin_state", "status",
  "ship_date", "delivery_date", "hora_coleta",
  "cpf", "product", "product_value", "weight",
  "invoice_number", "invoice_series", "notes",
  "progresso_manual", "pausado", "eventos_ajustes",
] as const;

function limpar(entrada: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const c of COLUNAS) {
    if (c in entrada) saida[c] = entrada[c];
  }
  return saida;
}

/** Todos os rastreios cadastrados, do mais novo para o mais antigo. */
export const adminListarPedidos = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .handler(async () => {
    const { db } = await import("./server/db.server");
    const { data, error } = await db("pedidos")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message || "Não foi possível carregar os rastreios.");
    return { pedidos: data ?? [] };
  });

/** Cria ou atualiza um rastreio. */
export const adminSalvarPedido = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { id?: string; dados: Record<string, unknown> }) => ({
    id: input?.id ? String(input.id) : null,
    dados: (input?.dados ?? {}) as Record<string, unknown>,
  }))
  .handler(async ({ data, context }) => {
    const { db } = await import("./server/db.server");
    const { logAudit } = await import("./server/audit.server");

    const campos = limpar(data.dados);
    const codigo = String(campos["tracking_code"] ?? "").trim();
    if (!codigo) throw new Error("O código de rastreio é obrigatório.");

    const { error } = data.id
      ? await db("pedidos").update(campos).eq("id", data.id)
      : await db("pedidos").insert(campos);

    if (error) {
      if (String((error as any).code) === "23505") {
        throw new Error("Já existe um rastreio com esse código.");
      }
      throw new Error(error.message || "Não foi possível salvar o rastreio.");
    }

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: data.id ? "pedido.editado" : "pedido.criado",
      entity: "pedidos",
      entityId: data.id ?? codigo,
      success: true,
      detail: { tracking_code: codigo },
    });

    return { ok: true };
  });

/**
 * Apaga um rastreio.
 *
 * Guarda o conteúdo na auditoria ANTES de apagar. Um pedido já foi excluído
 * sem querer neste projeto e não havia registro nenhum para reconstruir — só
 * deu para recuperar porque eu tinha consultado aquela linha por outro motivo.
 */
export const adminExcluirPedido = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { id: string }) => ({ id: String(input?.id ?? "") }))
  .handler(async ({ data, context }) => {
    if (!data.id) throw new Error("Rastreio não informado.");

    const { db } = await import("./server/db.server");
    const { logAudit } = await import("./server/audit.server");

    const { data: antes } = await db("pedidos").select("*").eq("id", data.id).maybeSingle();
    if (!antes) throw new Error("Rastreio não encontrado.");

    const { error } = await db("pedidos").delete().eq("id", data.id);
    if (error) throw new Error(error.message || "Não foi possível excluir o rastreio.");

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "pedido.excluido",
      entity: "pedidos",
      entityId: String(antes.tracking_code ?? data.id),
      success: true,
      // A linha inteira, para dar como desfazer.
      detail: { pedido: antes },
    });

    return { ok: true };
  });

/**
 * Cotações de um CPF — consulta pública da página `/cotacao`.
 *
 * O filtro é feito NO SERVIDOR. Antes a página baixava a tabela inteira e
 * filtrava no navegador: qualquer visitante recebia as cotações de todos os
 * clientes, com nome e telefone, bastando abrir a aba de rede.
 *
 * Sem middleware de propósito — é uma página aberta, para quem pediu cotação
 * sem ter conta. O que protege é o filtro: só saem as linhas daquele CPF.
 */
export const cotacoesDoCpf = createServerFn({ method: "POST" })
  .inputValidator((input: { cpf: string }) => ({
    cpf: String(input?.cpf ?? "").replace(/\D/g, "").slice(0, 11),
  }))
  .handler(async ({ data }) => {
    if (data.cpf.length !== 11) return { cotacoes: [] };

    const { db } = await import("./server/db.server");
    const pontuado = `${data.cpf.slice(0, 3)}.${data.cpf.slice(3, 6)}.${data.cpf.slice(6, 9)}-${data.cpf.slice(9)}`;

    const { data: linhas } = await db("cotacoes_frete")
      .select("*")
      // O CPF foi gravado com e sem pontuação ao longo do tempo.
      .or(`cpf.eq.${data.cpf},cpf.eq.${pontuado}`)
      .order("created_at", { ascending: false })
      .limit(50);

    return { cotacoes: (linhas ?? []) as any[] };
  });

/** Conteúdo das tabelas de formulário do site. */
export const adminListarTabela = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .inputValidator((input: { tabela: string }) => ({ tabela: String(input?.tabela ?? "") }))
  .handler(async ({ data }) => {
    const PERMITIDAS = ["reclamacoes", "solicitacoes_nf", "cotacoes_frete"];
    if (!PERMITIDAS.includes(data.tabela)) throw new Error("Tabela não permitida.");

    const { db } = await import("./server/db.server");
    const { data: linhas, error } = await db(data.tabela)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message || "Não foi possível carregar a tabela.");
    return { linhas: linhas ?? [] };
  });
