/**
 * IP real de quem fez a requisição.
 *
 * Ponto que estava errado antes: o encadeamento com `??` caía em
 * `(headers.get("x-forwarded-for") ?? "").split(",")[0]?.trim()`, que devolve
 * STRING VAZIA quando o cabeçalho não existe. Como "" não é null nem
 * undefined, o `??` aceitava esse vazio e o banco gravava `ip = ""`.
 * Foi por isso que vários registros ficaram com o IP em branco.
 *
 * Aqui cada candidato é testado de fato, e só um valor não-vazio é aceito.
 * Atrás de proxy (ngrok, Cloudflare, load balancer) o IP verdadeiro vem no
 * primeiro item de `x-forwarded-for`.
 */

const CABECALHOS = [
  "cf-connecting-ip", // Cloudflare
  "true-client-ip", // Cloudflare Enterprise / Akamai
  "x-real-ip", // nginx
  "x-client-ip",
  "fastly-client-ip",
  "x-cluster-client-ip",
] as const;

/** Remove porta de IPv4 (1.2.3.4:5678) e colchetes de IPv6 ([::1]:443). */
function limpar(valor: string): string {
  let ip = valor.trim();
  if (!ip) return "";
  if (ip.startsWith("[")) {
    const fim = ip.indexOf("]");
    if (fim > 0) return ip.slice(1, fim);
  }
  // IPv4 com porta — IPv6 sem colchetes tem vários ":" e não deve ser cortado
  const partes = ip.split(":");
  if (partes.length === 2 && partes[0]!.includes(".")) ip = partes[0]!;
  return ip.trim();
}

function ehUtil(ip: string): boolean {
  if (!ip) return false;
  const baixo = ip.toLowerCase();
  return baixo !== "unknown" && baixo !== "undefined" && baixo !== "null";
}

/** Devolve o IP, ou null quando realmente não há como saber. */
export function ipDeHeaders(headers: Headers): string | null {
  for (const nome of CABECALHOS) {
    const bruto = headers.get(nome);
    if (!bruto) continue;
    const ip = limpar(bruto.split(",")[0] ?? "");
    if (ehUtil(ip)) return ip;
  }

  // x-forwarded-for: "cliente, proxy1, proxy2" — o cliente é o primeiro.
  const encaminhado = headers.get("x-forwarded-for");
  if (encaminhado) {
    for (const parte of encaminhado.split(",")) {
      const ip = limpar(parte);
      if (ehUtil(ip)) return ip;
    }
  }

  return null;
}

/** Mesma coisa, a partir de uma Request. */
export function ipDeRequest(request: Request | undefined | null): string | null {
  if (!request?.headers) return null;
  return ipDeHeaders(request.headers);
}
