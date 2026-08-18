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
};

/** Exige um cliente autenticado. O administrador também passa. */
export const requireUser = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { resolveRequester } = await import("./server/auth.server");
  const requester = await resolveRequester();
  if (!requester) throw new Error("Faça login para continuar.");
  return next({ context: { user: requester } });
});

/** Exige administrador do sistema (visão global). */
export const requireAdminUser = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { resolveRequester } = await import("./server/auth.server");
  const requester = await resolveRequester();
  if (!requester) throw new Error("Faça login para continuar.");
  if (!requester.isAdmin) throw new Error("Acesso restrito: usuário sem permissão administrativa.");
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
