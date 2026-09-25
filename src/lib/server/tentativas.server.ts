/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Registro das tentativas de entrada nos painéis.
 *
 * Antes havia duas cópias deste insert — uma para a senha, outra para o
 * código do segundo fator — e nenhuma dizia QUAL painel estava sendo acessado.
 * A Olho de Deus ML e o painel de rastreios caíam na mesma lista sem distinção.
 *
 * Registrar nunca pode impedir alguém de entrar: toda falha aqui é engolida.
 */

/** De qual painel veio a tentativa. */
export type Painel = "olho_de_deus" | "rastreios";

export function painelValido(v: unknown): Painel | null {
  return v === "olho_de_deus" || v === "rastreios" ? v : null;
}

export async function gravarTentativa(dados: {
  email: string | null;
  sucesso: boolean;
  motivo: string;
  painel: Painel | null;
}): Promise<boolean> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { db } = await import("./db.server");
    const { ipDeHeaders } = await import("./ip.server");

    const request = getRequest();
    const linha: Record<string, unknown> = {
      email: dados.email || null,
      ip: ipDeHeaders(request.headers),
      navegador: (request.headers.get("user-agent") ?? "").slice(0, 300),
      sucesso: dados.sucesso,
      motivo: dados.motivo,
      painel: dados.painel,
    };

    const { error } = await db("tentativas_painel").insert(linha);
    if (!error) return true;

    /*
     * A coluna `painel` pode ainda não existir — ela nasce de uma migração que
     * roda à parte. Sem esta segunda tentativa, o código novo publicado antes
     * do SQL pararia de registrar QUALQUER tentativa, e você ficaria cego
     * justamente para quem tenta entrar.
     */
    const semColuna = /painel/i.test(String(error.message ?? "")) || ["PGRST204", "42703"].includes(String(error.code));
    if (semColuna) {
      const { painel: _fora, ...semPainel } = linha;
      const segunda = await db("tentativas_painel").insert(semPainel);
      return !segunda.error;
    }
    return false;
  } catch {
    return false;
  }
}
