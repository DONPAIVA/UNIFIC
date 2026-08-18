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

export async function savePedido(p: Partial<Pedido> & { tracking_code: string }) {
  if (p.id) {
    const { id, created_at: _c, updated_at: _u, ...rest } = p as any;
    const { error } = await db("pedidos").update(rest).eq("id", id);
    if (error) {
      console.error("[pedidos] falha ao atualizar:", error.message, error.details ?? "", error.hint ?? "");
      throw new Error(describeSupabaseError(error));
    }
  } else {
    const { error } = await db("pedidos").insert(p);
    if (error) {
      console.error("[pedidos] falha ao inserir:", error.message, error.details ?? "", error.hint ?? "");
      throw new Error(describeSupabaseError(error));
    }
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

export async function findPedidosByCpf(cpf: string) {
  const { data, error } = await db("pedidos").select("*").eq("cpf", cpf.trim()).order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Pedido[];
}
