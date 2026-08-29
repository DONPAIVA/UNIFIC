/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/integrations/supabase/client";
import type { Pedido } from "./tracking";

const db = (table: string) => (supabase as any).from(table);

export async function findPedido(code: string, marketplace?: string) {
  let q = db("pedidos").select("*").ilike("tracking_code", code.trim());
  if (marketplace) q = q.eq("marketplace", marketplace);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return (data as Pedido | null) ?? null;
}

export async function listPedidos() {
  const { data, error } = await db("pedidos").select("*").order("created_at", { ascending: false });
  if (error) {
    console.error("[pedidos] falha ao listar:", error.message, error.details ?? "", error.hint ?? "");
    throw new Error(error.message || "Não foi possível carregar os rastreios.");
  }
  return (data ?? []) as Pedido[];
}

/**
 * O banco reclamou de uma coluna que não existe? Devolve o nome dela.
 *
 * São DOIS formatos diferentes, e por isso as duas expressões:
 *  - PGRST204, do cache de esquema do PostgREST:
 *      Could not find the 'progresso_manual' column of 'pedidos' ...
 *  - 42703, direto do Postgres:
 *      column pedidos.progresso_manual does not exist
 */
function colunaInexistente(error: any): string | null {
  const code = String(error?.code ?? "");
  const msg = String(error?.message ?? "");
  if (code !== "PGRST204" && code !== "42703" && !/does not exist|could not find/i.test(msg)) {
    return null;
  }
  const cache = msg.match(/could not find the '([a-z0-9_]+)' column/i);
  if (cache?.[1]) return cache[1];
  const pg = msg.match(/column\s+\S*?\.?"?([a-z0-9_]+)"?\s+does not exist/i);
  return pg?.[1] ?? null;
}

export async function savePedido(p: Partial<Pedido> & { tracking_code: string }) {
  /*
   * Salva tolerando coluna que ainda não existe no banco.
   *
   * O painel envia campos novos (como `progresso_manual`) que só passam a
   * existir depois da migração rodar. Sem isto, publicar o código antes de
   * rodar o SQL travaria TODO salvamento de pedido — inclusive mudar o status,
   * que nada tem a ver com o campo novo.
   *
   * Então, quando o banco acusa coluna desconhecida, ela sai do envio e a
   * gravação é refeita. O resto do cadastro é salvo normalmente.
   */
  const gravar = async (dados: any): Promise<void> => {
    const resposta = p.id
      ? await db("pedidos").update(dados).eq("id", p.id)
      : await db("pedidos").insert(dados);

    const error = resposta.error;
    if (!error) return;

    const faltando = colunaInexistente(error);
    if (faltando && faltando in dados) {
      console.warn(`[pedidos] coluna "${faltando}" ainda não existe no banco; salvando sem ela.`);
      const { [faltando]: _fora, ...semAColuna } = dados;
      return gravar(semAColuna);
    }

    console.error("[pedidos] falha ao salvar:", error.message, error.details ?? "", error.hint ?? "");
    throw new Error(describeSupabaseError(error));
  };

  if (p.id) {
    const { id: _id, created_at: _c, updated_at: _u, ...rest } = p as any;
    await gravar(rest);
  } else {
    await gravar({ ...p });
  }
}

/** Traduz os erros mais comuns do Supabase para algo acionável na tela. */
function describeSupabaseError(error: any): string {
  const code = String(error?.code ?? "");
  const msg = String(error?.message ?? "");

  if (code === "23505") return "Já existe um rastreio com esse código.";
  if (code === "23502") return `Uma coluna obrigatória do banco não foi preenchida (${error?.details ?? "ver console"}).`;
  if (code === "42501" || /row-level security/i.test(msg)) {
    return "O banco recusou a gravação por falta de permissão (RLS). Rode o SQL de correção da tabela.";
  }
  if (code === "PGRST204" || /column .* does not exist/i.test(msg)) {
    return "A tabela do Supabase não tem as colunas que o site usa. Rode o SQL de correção da tabela.";
  }
  if (/failed to fetch|networkerror/i.test(msg)) {
    return "Não foi possível falar com o Supabase. Verifique o .env e reinicie o servidor.";
  }
  return msg || "Erro ao salvar o rastreio.";
}

export async function deletePedido(id: string) {
  const { error } = await db("pedidos").delete().eq("id", id);
  if (error) throw error;
}

export type TableName = "reclamacoes" | "solicitacoes_nf" | "cotacoes_frete";

export async function listTable(table: TableName) {
  const { data, error } = await db(table).select("*").order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Record<string, any>[];
}

export async function insertTable(table: TableName, row: Record<string, unknown>) {
  const { error } = await db(table).insert(row);
  if (error) throw error;
}

/**
 * Pedidos cadastrados no CPF informado.
 *
 * O campo `cpf` da tabela `pedidos` é texto livre, preenchido à mão ao longo
 * do tempo — e os dados reais mostram isso: a maioria só com dígitos, mas há
 * registro com pontuação e pelo menos um com ESPAÇO na frente (" 04579707664").
 * Uma comparação exata deixaria esses pedidos invisíveis para sempre.
 *
 * Por isso a busca tenta as duas grafias e, além disso, aceita o número em
 * qualquer posição do campo — é o que alcança o espaço sobrando. Como são 11
 * dígitos exatos, casar por trecho não confunde um CPF com outro.
 */
export async function findPedidosByCpf(cpf: string) {
  const so = cpf.replace(/\D+/g, "");
  if (so.length !== 11) return [];

  const pontuado = `${so.slice(0, 3)}.${so.slice(3, 6)}.${so.slice(6, 9)}-${so.slice(9)}`;

  const { data, error } = await db("pedidos")
    .select("*")
    .or(
      [
        `cpf.eq.${so}`,
        `cpf.eq.${pontuado}`,
        `cpf.ilike.%${so}%`,
        `cpf.ilike.%${pontuado}%`,
      ].join(","),
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Pedido[];
}
