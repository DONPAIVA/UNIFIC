import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Registra uma consulta de rastreio feita no Unific+.
 * É isto que alimenta a aba RASTREAMENTO AO VIVO da CentralML:
 * quem consultou (IP/user-agent), qual código, quando, com que resultado.
 *
 * Nada é inventado: se ninguém consultar, a lista fica vazia.
 * O IP é lido no servidor — o navegador não escolhe o que registrar.
 */
export const registrarConsultaRastreio = createServerFn({ method: "POST" })
  .inputValidator(
    (input: {
      code: string;
      marketplace?: string | null;
      found?: boolean;
      source?: "local" | "mercado_livre" | "nao_encontrado";
      status?: string | null;
    }) => ({
      code: String(input.code ?? "").trim().slice(0, 64),
      marketplace: input.marketplace ? String(input.marketplace).slice(0, 40) : null,
      found: Boolean(input.found),
      source: (["local", "mercado_livre", "nao_encontrado"] as const).includes(input.source as never)
        ? (input.source as "local" | "mercado_livre" | "nao_encontrado")
        : "nao_encontrado",
      status: input.status ? String(input.status).slice(0, 120) : null,
    }),
  )
  .handler(async ({ data }) => {
    if (!data.code) return { ok: false };

    const request = getRequest();
    const h = request.headers;
    const { ipDeHeaders } = await import("./server/ip.server");
    const ip = ipDeHeaders(h);

    const { db } = await import("./server/db.server");

    // Quando o código veio da integração, tentamos amarrar a consulta à conta
    // que realmente possui aquele envio — é assim que a CentralML separa por cliente.
    let accountId: string | null = null;
    let mlShipmentId: string | null = null;
    if (data.source === "mercado_livre") {
      const { data: rows } = await db("ml_shipments")
        .select("account_id, ml_shipment_id")
        .or(`tracking_number.eq.${data.code},ml_shipment_id.eq.${data.code},ml_order_id.eq.${data.code}`)
        .limit(1);
      const hit = rows?.[0];
      accountId = hit?.account_id ?? null;
      mlShipmentId = hit?.ml_shipment_id ?? null;
    }

    await db("rastreio_consultas").insert({
      code: data.code,
      marketplace: data.marketplace,
      found: data.found,
      source: data.source,
      status: data.status,
      account_id: accountId,
      ml_shipment_id: mlShipmentId,
      ip: ip ?? "local",
      user_agent: (h.get("user-agent") ?? "").slice(0, 300) || null,
      path: (() => {
        try {
          return new URL(request.url).pathname.slice(0, 200);
        } catch {
          return null;
        }
      })(),
    });

    const { logEvent } = await import("./server/logs.server");
    await logEvent({
      category: "rastreio",
      action: data.found ? "rastreio.consulta_encontrada" : "rastreio.consulta_sem_resultado",
      accountId,
      endpoint: "/",
      actor: "cliente",
      ip,
      success: data.found,
      message: `Código ${data.code} (${data.source}).`,
    });

    return { ok: true };
  });
