/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Middlewares de autenticação das server functions.
 *
 * Este arquivo é alcançável pelo bundle do cliente (as server functions são
 * importadas pelos componentes), então TODO import de `server/` aqui é
 * DINÂMICO — é o que impede o código e os segredos do servidor de vazarem
 * para o navegador. A implementação real vive em server/auth.server.ts.
 */
import { createMiddleware } from "@tanstack/react-start";

/** Identidade já validada no servidor. O navegador nunca a define. */
export type Requester = {
  userId: string;
  email: string;
  isAdmin: boolean;
  ip: string | null;
  /** Acesso suspenso pelo administrador. */
  bloqueado?: boolean;
};

/**
 * Marcador do bloqueio, reconhecido pela interface.
 *
 * A mensagem viaja como texto até o navegador; o prefixo é o que permite a
 * tela distinguir "conta bloqueada" de qualquer outro erro e mostrar o aviso
 * próprio em vez de um erro genérico.
 */
export const ERRO_BLOQUEADO = "CONTA_BLOQUEADA";

/**
 * Marcador do segundo fator pendente.
 *
 * Igual ao bloqueio: viaja como texto e permite à tela pedir o código de 6
 * dígitos em vez de mostrar um erro que não diz o que fazer.
 */
export const ERRO_2FA = "SEGUNDO_FATOR_PENDENTE";

/** Exige um cliente autenticado. O administrador também passa. */
export const requireUser = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { resolveRequester } = await import("./server/auth.server");
  const requester = await resolveRequester();
  if (!requester) throw new Error("Faça login para continuar.");
  // O bloqueio vale para TODA ação: sem ele aqui, bastaria uma tela esquecida
  // para o bloqueado continuar operando.
  if (requester.bloqueado) throw new Error(ERRO_BLOQUEADO);
  return next({ context: { user: requester } });
});

/**
 * Exige administrador, SEM cobrar o segundo fator.
 *
 * Reservado às funções que precisam rodar antes da verificação: consultar se o
 * segundo fator está ativo, ativá-lo e conferir o código. Sem esta exceção não
 * haveria como passar pela trava — a verificação exigiria estar verificado.
 */
export const requireAdminUserSem2fa = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const { resolveRequester } = await import("./server/auth.server");
    const requester = await resolveRequester();
    if (!requester) throw new Error("Faça login para continuar.");
    if (requester.bloqueado) throw new Error(ERRO_BLOQUEADO);
    if (!requester.isAdmin) throw new Error("Acesso restrito: usuário sem permissão administrativa.");
    return next({ context: { user: requester } });
  },
);

/**
 * Exige administrador do sistema (visão global), já com o segundo fator.
 *
 * A cobrança fica AQUI, no ponto por onde toda ação do painel passa, e não na
 * tela de entrada. Se estivesse só na tela, quem chamasse as funções por fora
 * — direto no endereço delas — passaria por cima da verificação inteira.
 */
export const requireAdminUser = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { resolveRequester } = await import("./server/auth.server");
  const requester = await resolveRequester();
  if (!requester) throw new Error("Faça login para continuar.");
  if (requester.bloqueado) throw new Error(ERRO_BLOQUEADO);
  if (!requester.isAdmin) throw new Error("Acesso restrito: usuário sem permissão administrativa.");

  const { temSegundoFator, sessaoVerificada, tokenDaRequisicao } = await import(
    "./server/dois-fatores.server"
  );

  // Quem não ativou o segundo fator segue entrando como sempre entrou.
  if (await temSegundoFator(requester.userId)) {
    const token = await tokenDaRequisicao();
    if (!token || !(await sessaoVerificada(requester.userId, token))) {
      throw new Error(ERRO_2FA);
    }
  }

  return next({ context: { user: requester } });
});

/**
 * Aplica o escopo de contas a uma query PostgREST (função pura, sem servidor).
 *
 * `null`  = administrador, sem filtro.
 * `[]`    = cliente sem nenhuma conta -> PRECISA resultar em lista vazia.
 *           É essa distinção entre "sem filtro" e "filtro vazio" que impede
 *           um cliente sem contas de enxergar os dados de todo mundo.
 */
export function scopeByAccount(query: any, scope: string[] | null, column = "account_id") {
  if (scope === null) return query;
  if (scope.length === 0) return query.in(column, ["00000000-0000-0000-0000-000000000000"]);
  return query.in(column, scope);
}
