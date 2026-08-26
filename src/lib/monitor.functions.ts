/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Monitoramento ao vivo: quem está no site agora e quem tenta entrar no painel.
 *
 * O IP e o navegador vêm SEMPRE do servidor, nunca do que o navegador envia —
 * qualquer um pode forjar um cabeçalho, e um monitor que aceita o que o
 * visitante diz não monitora nada.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminUser } from "./auth-middleware";

/** Considera "online" quem deu sinal de vida nos últimos 90 segundos. */
const JANELA_ONLINE_MS = 90_000;

/* -------------------------------------------------------------------------- */
/* Coleta (chamada por qualquer visitante)                                     */
/* -------------------------------------------------------------------------- */

/**
 * Batida de presença. O navegador chama a cada 30 s enquanto a aba está aberta.
 *
 * Vale para visitante anônimo também: quem está rastreando um código sem conta
 * aparece na lista sem nome, só com IP e página — que é justamente o que
 * interessa saber.
 */
export const registrarPresenca = createServerFn({ method: "POST" })
  .inputValidator((input: { sessaoId: string; pagina?: string }) => ({
    sessaoId: String(input?.sessaoId ?? "").slice(0, 80),
    pagina: String(input?.pagina ?? "").slice(0, 200),
  }))
  .handler(async ({ data }) => {
    if (!data.sessaoId) return { ok: false };

    const { getRequest } = await import("@tanstack/react-start/server");
    const { db } = await import("./server/db.server");
    const { ipDeHeaders } = await import("./server/ip.server");
    const { resolveRequester } = await import("./server/auth.server");

    const request = getRequest();
    const requester = await resolveRequester();

    // Nome do perfil, quando existir — a lista fica muito mais útil com nome
    // do que só com e-mail.
    let nome: string | null = null;
    if (requester) {
      const { data: perfil } = await db("clientes_perfil")
        .select("nome_completo")
        .eq("user_id", requester.userId)
        .maybeSingle();
      nome = (perfil?.nome_completo as string) ?? null;
    }

    const agora = new Date().toISOString();
    await db("presenca_online").upsert(
      {
        sessao_id: data.sessaoId,
        user_id: requester?.userId ?? null,
        email: requester?.email ?? null,
        nome,
        ip: ipDeHeaders(request.headers),
        navegador: (request.headers.get("user-agent") ?? "").slice(0, 300),
        pagina: data.pagina || "/",
        no_painel: data.pagina.startsWith("/centralml"),
        visto_em: agora,
      },
      { onConflict: "sessao_id" },
    );

    return { ok: true };
  });

/**
 * Registra uma tentativa de entrar no painel.
 *
 * Chamada pela tela de login DEPOIS do resultado. O login em si acontece no
 * navegador (Supabase Auth), então o servidor não veria a tentativa sozinho —
 * sem isto, uma sequência de senhas erradas passaria despercebida.
 *
 * Não recebe e nunca grava a senha.
 */
export const registrarTentativaPainel = createServerFn({ method: "POST" })
  .inputValidator((input: { email: string; sucesso: boolean; motivo?: string }) => ({
    email: String(input?.email ?? "").toLowerCase().trim().slice(0, 150),
    sucesso: Boolean(input?.sucesso),
    motivo: String(input?.motivo ?? "").slice(0, 60),
  }))
  .handler(async ({ data }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { db } = await import("./server/db.server");
    const { ipDeHeaders } = await import("./server/ip.server");

    const request = getRequest();
    await db("tentativas_painel").insert({
      email: data.email || null,
      ip: ipDeHeaders(request.headers),
      navegador: (request.headers.get("user-agent") ?? "").slice(0, 300),
      sucesso: data.sucesso,
      motivo: data.motivo || (data.sucesso ? "ok" : "senha_errada"),
    });

    return { ok: true };
  });

/* -------------------------------------------------------------------------- */
/* Leitura (somente administrador)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Retrato do momento: quem está online e as tentativas recentes de acesso.
 *
 * Aproveita a consulta para limpar presenças velhas — sem job externo, a
 * tabela se mantém pequena sozinha.
 */
export const adminAoVivo = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .handler(async () => {
    const { admin, db } = await import("./server/db.server");

    const corte = new Date(Date.now() - JANELA_ONLINE_MS).toISOString();

    // Faxina: presença com mais de 1 hora não volta mais.
    try {
      await db("presenca_online")
        .delete()
        .lt("visto_em", new Date(Date.now() - 3_600_000).toISOString());
    } catch {
      /* limpeza é higiene, não pode derrubar a tela */
    }

    const { data: online } = await admin
      .from("presenca_online")
      .select("sessao_id, user_id, email, nome, ip, navegador, pagina, no_painel, entrou_em, visto_em")
      .gte("visto_em", corte)
      .order("visto_em", { ascending: false })
      .limit(200);

    const { data: tentativas } = await admin
      .from("tentativas_painel")
      .select("id, email, ip, navegador, sucesso, motivo, criado_em")
      .order("criado_em", { ascending: false })
      .limit(60);

    /*
     * Sinal de ataque: muitas falhas do MESMO IP em pouco tempo.
     *
     * Uma senha errada é distração; cinco do mesmo IP em 15 minutos é alguém
     * tentando adivinhar. O limiar é conservador de propósito — alarme que
     * dispara à toa vira alarme ignorado.
     */
    const quinzeMin = Date.now() - 15 * 60_000;
    const falhasPorIp = new Map<string, number>();
    for (const t of tentativas ?? []) {
      const linha = t as any;
      if (linha.sucesso) continue;
      if (new Date(linha.criado_em).getTime() < quinzeMin) continue;
      const ip = String(linha.ip ?? "desconhecido");
      falhasPorIp.set(ip, (falhasPorIp.get(ip) ?? 0) + 1);
    }
    const alertas = [...falhasPorIp.entries()]
      .filter(([, n]) => n >= 5)
      .map(([ip, n]) => ({ ip, falhas: n }))
      .sort((a, b) => b.falhas - a.falhas);

    const lista = (online ?? []).map((o: any) => ({
      sessaoId: o.sessao_id,
      quem: o.nome || o.email || "Visitante não identificado",
      email: o.email,
      autenticado: Boolean(o.user_id),
      ip: o.ip,
      navegador: resumirNavegador(o.navegador),
      pagina: o.pagina,
      noPainel: o.no_painel,
      desde: o.entrou_em,
      visto: o.visto_em,
    }));

    return {
      online: lista,
      totalOnline: lista.length,
      noPainel: lista.filter((o: any) => o.noPainel).length,
      anonimos: lista.filter((o: any) => !o.autenticado).length,
      tentativas: (tentativas ?? []).map((t: any) => ({
        id: t.id,
        email: t.email,
        ip: t.ip,
        navegador: resumirNavegador(t.navegador),
        sucesso: t.sucesso,
        motivo: t.motivo,
        quando: t.criado_em,
      })),
      alertas,
    };
  });

/** User-agent inteiro é ilegível numa tabela. Aqui vira "Chrome · Android". */
function resumirNavegador(ua: string | null): string {
  const s = String(ua ?? "");
  if (!s) return "—";
  const navegador = /Edg\//.test(s)
    ? "Edge"
    : /OPR\//.test(s)
      ? "Opera"
      : /Chrome\//.test(s)
        ? "Chrome"
        : /Firefox\//.test(s)
          ? "Firefox"
          : /Safari\//.test(s)
            ? "Safari"
            : "Outro";
  const sistema = /Android/.test(s)
    ? "Android"
    : /iPhone|iPad|iPod/.test(s)
      ? "iPhone/iPad"
      : /Windows/.test(s)
        ? "Windows"
        : /Mac OS X/.test(s)
          ? "Mac"
          : /Linux/.test(s)
            ? "Linux"
            : "—";
  return `${navegador} · ${sistema}`;
}
