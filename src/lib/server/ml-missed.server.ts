/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Recuperação de notificações perdidas do Mercado Livre.
 *
 * POR QUE ISSO EXISTE
 * Quando o webhook não está acessível (túnel fora do ar, servidor parado), o
 * Mercado Livre não consegue entregar a notificação — e ela some da fila
 * normal. O ML guarda essas pendências em /missed_feeds.
 *
 * Sem esta rotina, todo evento ocorrido enquanto a aplicação estava offline
 * ficava perdido: pedidos novos, mudanças de envio, mensagens.
 *
 * DETALHE IMPORTANTE
 * /missed_feeds só responde para a conta DONA do aplicativo. As demais contas
 * autorizadas recebem 401 ("You must be the owner of the app"). Por isso a
 * rotina descobre sozinha qual conta consegue ler, em vez de tentar todas.
 */
import { db } from "./db.server";
import { mlFetch, type MlAccount } from "./ml-api.server";
import { identificarTopico } from "./ml-topics.server";

export type ResultadoRecuperacao = {
  lidas: number;
  processadas: number;
  ignoradas: number;
  erros: number;
  jaVistas: number;
  contaLeitora: string | null;
  detalhes: Array<{ recurso: string; topico: string; mlUserId: string | null; resultado: string }>;
};

/**
 * Deriva o tópico a partir do recurso quando o ML não manda o campo.
 *
 * O reconhecimento vem do catálogo (ml-topics.server.ts), o mesmo usado pelo
 * webhook — então tudo que o webhook trata ao vivo também é reconhecido na
 * recuperação. Antes, só orders/shipments/items/questions/messages tinham
 * mapeamento e o resto virava "desconhecido" e era descartado.
 */
function topicoDe(msg: any): string {
  if (msg?.topic) return String(msg.topic);
  const recurso = String(msg?.resource ?? "");
  return identificarTopico("", recurso)?.aliases[0] ?? "desconhecido";
}

/**
 * Busca as notificações pendentes e processa cada uma.
 * Idempotente: cada notificação é registrada em ml_webhook_events pelo
 * `_id` do Mercado Livre, então rodar duas vezes não duplica nada.
 */
export async function recuperarNotificacoesPerdidas(
  opts: { limite?: number; origem?: string } = {},
): Promise<ResultadoRecuperacao> {
  const limite = Math.min(Math.max(opts.limite ?? 50, 1), 200);
  const origem = opts.origem ?? "recuperacao";
  const { logEvent } = await import("./logs.server");
  const appId = (process.env["ML_CLIENT_ID"] ?? "").trim();

  const vazio: ResultadoRecuperacao = {
    lidas: 0,
    processadas: 0,
    ignoradas: 0,
    erros: 0,
    jaVistas: 0,
    contaLeitora: null,
    detalhes: [],
  };
  if (!appId) return vazio;

  // Só a conta dona do app consegue ler /missed_feeds — descobrimos qual é.
  const { data: contas } = await db("ml_connections")
    .select("*")
    .eq("provider", "mercado_livre")
    .not("owner_user_id", "is", null)
    .in("status", ["active", "syncing"]);

  let leitora: MlAccount | null = null;
  let mensagens: any[] = [];

  for (const conta of (contas ?? []) as MlAccount[]) {
    const r = await mlFetch(conta, `/missed_feeds?app_id=${appId}&limit=${limite}`, { actor: origem });
    if (!r.ok) continue; // 401 = não é a dona do app; segue tentando
    leitora = conta;
    const m = (r.data as any)?.messages;
    mensagens = Array.isArray(m) ? m : Array.isArray(m?.results) ? m.results : [];
    break;
  }

  if (!leitora) {
    await logEvent({
      category: "webhook",
      action: "recuperacao.sem_conta_dona",
      actor: origem,
      success: false,
      error: "Nenhuma conta conectada é dona do aplicativo — /missed_feeds indisponível.",
    });
    return vazio;
  }

  const resultado: ResultadoRecuperacao = { ...vazio, lidas: mensagens.length, contaLeitora: leitora.nickname };

  const { processNotification } = await import("./ml-sync.server");

  for (const msg of mensagens) {
    const recurso = String(msg?.resource ?? "");
    const topico = topicoDe(msg);
    const mlUserId = msg?.user_id != null ? String(msg.user_id) : null;
    const idMl = String(msg?._id ?? msg?.id ?? `${topico}:${recurso}`);

    // Idempotência: `sent_at` guarda o id do ML, e a chave única
    // (topic, resource, sent_at) impede reprocessar a mesma notificação.
    const { data: existente } = await db("ml_webhook_events")
      .select("id, status")
      .eq("topic", topico)
      .eq("resource", recurso)
      .eq("ml_user_id", mlUserId)
      .maybeSingle();

    if (existente && existente.status === "processed") {
      resultado.jaVistas++;
      resultado.detalhes.push({ recurso, topico, mlUserId, resultado: "já processada antes" });
      continue;
    }

    const r = await processNotification({ topic: topico, resource: recurso, mlUserId });

    await db("ml_webhook_events").upsert(
      {
        topic: topico,
        resource: recurso,
        ml_user_id: mlUserId,
        attempts: 1,
        sent_at: new Date().toISOString(),
        received_at: new Date().toISOString(),
        processed_at: new Date().toISOString(),
        status: r.status,
        error: r.error ?? null,
        raw: { origem: "missed_feeds", id_ml: idMl, ...msg },
      },
      { onConflict: "topic,resource,sent_at" },
    );

    if (r.status === "processed") resultado.processadas++;
    else if (r.status === "ignored") resultado.ignoradas++;
    else resultado.erros++;

    resultado.detalhes.push({ recurso, topico, mlUserId, resultado: r.status + (r.error ? ` — ${r.error}` : "") });
  }

  await logEvent({
    category: "webhook",
    action: "recuperacao.rodada",
    actor: origem,
    success: resultado.erros === 0,
    message: `${resultado.lidas} pendente(s): ${resultado.processadas} processada(s), ${resultado.ignoradas} ignorada(s), ${resultado.erros} com erro.`,
    detail: { ...resultado, contaLeitora: leitora.nickname },
  });

  return resultado;
}
