/**
 * Guarda das rotas internas (/internal/*).
 * Exige o header x-internal-token igual a ML_INTERNAL_API_TOKEN.
 * Retorna uma Response quando o acesso deve ser negado, ou null quando liberado.
 */
export function requireInternalToken(request: Request): Response | null {
  const expected = (process.env["ML_INTERNAL_API_TOKEN"] ?? "").trim();
  const deny = (message: string, status: number) =>
    new Response(JSON.stringify({ error: message }), {
      status,
      headers: { "content-type": "application/json" },
    });

  if (!expected) return deny("ML_INTERNAL_API_TOKEN não configurado no servidor.", 503);

  const url = new URL(request.url);
  const provided = (request.headers.get("x-internal-token") ?? url.searchParams.get("token") ?? "").trim();
  if (!provided || provided !== expected) return deny("unauthorized", 401);

  return null;
}

/** E-mail do responsável pela ação, para a auditoria. */
export function adminEmailFrom(request: Request): string | null {
  const email = (request.headers.get("x-admin-email") ?? "").trim().toLowerCase();
  return email || null;
}

/** IP de origem, para a auditoria. */
export function ipFrom(request: Request): string | null {
  const h = request.headers;
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    (h.get("x-forwarded-for") ?? "").split(",")[0]?.trim() ??
    null
  );
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
