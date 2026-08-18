import { createStart, createCsrfMiddleware, createMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";

const errorMiddleware = createMiddleware().server(async (ctx) => {
  try {
    return await ctx.next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }

    /*
     * Erros de SERVER FUNCTION precisam subir para o TanStack serializar a
     * mensagem e o cliente conseguir exibi-la ("Faça login para continuar.",
     * "Conta não encontrada."). Se devolvêssemos a página HTML aqui, toda
     * falha de autorização viraria um genérico "This page didn't load" —
     * inclusive as intencionais.
     *
     * A detecção é pelo caminho: /_serverFn/ é a rota das server functions
     * (TSS_SERVER_FN_BASE). O middleware de requisição não recebe handlerType.
     */
    const url = (ctx as { request?: Request }).request?.url ?? "";
    if (url.includes("/_serverFn/")) {
      throw error;
    }

    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
