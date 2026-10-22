/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/integrations/supabase/client";

/**
 * O que ainda fala direto com o banco pela chave pública: APENAS o ENVIO dos
 * formulários abertos do site (reclamação, solicitação de nota, cotação).
 *
 * A LEITURA da tabela `pedidos` saiu daqui de propósito. Ela permitia baixar a
 * tabela inteira — nome, endereço e CPF de todo mundo — com a chave que vai em
 * toda página. Agora o rastreio lê pelo servidor (src/lib/rastreio.functions.ts:
 * rastrearPorCodigo / rastrearPorCpf / notificacoesPublicas), que devolve só o
 * registro procurado e sem CPF; e a tabela deixou de ser legível pela chave
 * pública (migração 20261023120000_tranca_leitura_dos_pedidos.sql).
 *
 * O cadastro de pedidos (criar, editar, apagar) é do painel e passa por
 * src/lib/pedidos.functions.ts, atrás de administrador + segundo fator.
 */

export type TableName = "reclamacoes" | "solicitacoes_nf" | "cotacoes_frete";

/**
 * Envia uma linha para um formulário público do site.
 *
 * Só INSERT: estas tabelas têm a escrita aberta (o visitante preenche sem
 * conta), mas a LEITURA é bloqueada no banco — ninguém lê o que os outros
 * enviaram (ali tem nome, e-mail e telefone).
 */
export async function insertTable(table: TableName, row: Record<string, unknown>) {
  const { error } = await (supabase as any).from(table).insert(row);
  if (error) throw error;
}
