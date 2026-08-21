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

/**
 * Origem pública da requisição, do ponto de vista do NAVEGADOR.
 *
 * Atrás do proxy da hospedagem o TLS termina antes da aplicação, então
 * `request.url` chega como `http://` mesmo o cliente tendo acessado por
 * `https://`. Os cabeçalhos `x-forwarded-*` são quem preserva o pedido
 * original.
 */
function origemPublica(request: Request): string {
  const url = new URL(request.url);
  const primeiro = (v: string | null) => v?.split(",")[0]?.trim() || "";

  const host = primeiro(request.headers.get("x-forwarded-host"));
  if (host) url.host = host;

  const proto = primeiro(request.headers.get("x-forwarded-proto"));
  if (proto) {
    url.protocol = `${proto}:`;
  } else if (!/^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname)) {
    url.protocol = "https:";
  }
  return url.origin;
}

/*
 * Proteção contra requisições de outros sites.
 *
 * O Start instala isto sozinho quando src/start.ts não existe; ter o arquivo
 * desliga o automático, então reinstalamos explicitamente.
 *
 * O `origin` é informado À MÃO por um motivo concreto: a checagem padrão do
 * TanStack compara o cabeçalho `Origin` com `new URL(ctx.request.url).origin`.
 * Atrás do proxy isso vira `https://site` contra `http://site` — sempre
 * diferente, sempre 403. O efeito para o cliente é a tela de erro genérica
 * logo após uma ação que, no servidor, chegou a ser executada: a mensagem sai
 * para o Mercado Livre e a tela quebra em seguida.
 *
 * Comparar com a origem pública mantém a proteção inteira — segue exigindo
 * mesma origem — e apenas descobre corretamente qual é essa origem.
 */
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
  origin: (origin, ctx) => origin === origemPublica(ctx.request),
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
