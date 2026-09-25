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

    /*
     * Nada aqui pode derrubar quem está usando o site.
     *
     * Monitoramento é observação: se a tabela ainda não existe, se o banco
     * oscila, se a consulta falha — o visitante não tem nada a ver com isso e
     * precisa continuar navegando. Por isso o corpo inteiro é protegido, e não
     * só as consultas uma a uma.
     */
    try {
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
        try {
          const { data: perfil } = await db("clientes_perfil")
            .select("nome_completo")
            .eq("user_id", requester.userId)
            .maybeSingle();
          nome = (perfil?.nome_completo as string) ?? null;
        } catch {
          /* sem perfil: a presença vale igual, só sem o nome */
        }
      }

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
          visto_em: new Date().toISOString(),
        },
        { onConflict: "sessao_id" },
      );

      return { ok: true };
    } catch {
      return { ok: false };
    }
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
  .inputValidator(
    (input: { email: string; sucesso: boolean; motivo?: string; painel?: string }) => ({
      email: String(input?.email ?? "").toLowerCase().trim().slice(0, 150),
      sucesso: Boolean(input?.sucesso),
      motivo: String(input?.motivo ?? "").slice(0, 60),
      // Só dois valores aceitos: qualquer outra coisa vira nulo, para o
      // navegador não conseguir escrever texto livre nessa coluna.
      painel: input?.painel === "olho_de_deus" || input?.painel === "rastreios" ? input.painel : null,
    }),
  )
  .handler(async ({ data }) => {
    // Registrar a tentativa NUNCA pode impedir alguém de entrar. Quem tem a
    // credencial certa passa mesmo que o registro falhe.
    const { gravarTentativa } = await import("./server/tentativas.server");
    const ok = await gravarTentativa({
      email: data.email,
      sucesso: data.sucesso,
      motivo: data.motivo || (data.sucesso ? "ok" : "senha_errada"),
      painel: data.painel as "olho_de_deus" | "rastreios" | null,
    });
    return { ok };
  });

/* -------------------------------------------------------------------------- */
/* Bloqueio por IP                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Este endereço está barrado?
 *
 * Consultado pelo Layout a cada carregamento. Barra visitante anônimo também —
 * é justamente para quem não tem conta que o bloqueio por IP existe.
 *
 * Aproveita para contar as batidas na porta: saber que um IP bloqueado voltou
 * 40 vezes é informação diferente de saber que ele desistiu.
 */
export const verificarIp = createServerFn({ method: "GET" }).handler(async () => {
  const liberado = { bloqueado: false, motivo: null as string | null };

  /*
   * Falha aqui LIBERA, nunca bloqueia.
   *
   * Se a tabela ainda não existe ou o banco oscila, a escolha é entre deixar
   * passar um endereço barrado por alguns segundos ou tirar o site do ar para
   * todo mundo. Bloquear IP é decisão comercial, não barreira de segurança —
   * e derrubar todos os clientes é o dano bem maior.
   */
  try {
  const { getRequest } = await import("@tanstack/react-start/server");
  const { db } = await import("./server/db.server");
  const { ipDeHeaders } = await import("./server/ip.server");

  const ip = ipDeHeaders(getRequest().headers);
  if (!ip) return liberado;

  const { data, error } = await db("ips_bloqueados").select("ip, motivo, tentativas_apos").eq("ip", ip).maybeSingle();
  if (error || !data) return liberado;

  try {
    await db("ips_bloqueados")
      .update({
        tentativas_apos: Number((data as any).tentativas_apos ?? 0) + 1,
        ultima_tentativa_em: new Date().toISOString(),
      })
      .eq("ip", ip);
  } catch {
    /* contador é informativo */
  }

  return { bloqueado: true, motivo: ((data as any).motivo as string) ?? null };
  } catch {
    return liberado;
  }
});

/** Lista os IPs barrados, para a aba Ao vivo. */
export const adminIpsBloqueados = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .handler(async () => {
    // Lista vazia é resposta válida; erro aqui não pode quebrar a aba inteira.
    try {
      const { admin } = await import("./server/db.server");
      const { data } = await admin
        .from("ips_bloqueados")
        .select("ip, motivo, bloqueado_em, bloqueado_por, tentativas_apos, ultima_tentativa_em")
        .order("bloqueado_em", { ascending: false })
        .limit(200);
      return { ips: data ?? [] };
    } catch {
      return { ips: [] as any[] };
    }
  });

/** Bloqueia ou libera um endereço. */
export const adminBloquearIp = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { ip: string; bloquear: boolean; motivo?: string }) => ({
    ip: String(input?.ip ?? "").trim().slice(0, 60),
    bloquear: Boolean(input?.bloquear),
    motivo: String(input?.motivo ?? "").trim().slice(0, 300),
  }))
  .handler(async ({ data, context }) => {
    if (!data.ip) throw new Error("IP não informado.");

    const { getRequest } = await import("@tanstack/react-start/server");
    const { db } = await import("./server/db.server");
    const { ipDeHeaders } = await import("./server/ip.server");
    const { logAudit } = await import("./server/audit.server");

    // Trancar-se para fora do próprio painel é um erro sem volta pela tela.
    const meuIp = ipDeHeaders(getRequest().headers);
    if (data.bloquear && meuIp && meuIp === data.ip) {
      throw new Error("Este é o SEU endereço agora. Bloqueá-lo tiraria o seu próprio acesso.");
    }

    if (data.bloquear) {
      const { error } = await db("ips_bloqueados").upsert(
        {
          ip: data.ip,
          motivo: data.motivo || null,
          bloqueado_em: new Date().toISOString(),
          bloqueado_por: context.user.email,
        },
        { onConflict: "ip" },
      );
      if (error) throw new Error(`Não foi possível bloquear: ${error.message}`);
    } else {
      const { error } = await db("ips_bloqueados").delete().eq("ip", data.ip);
      if (error) throw new Error(`Não foi possível liberar: ${error.message}`);
    }

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: data.bloquear ? "ip.bloqueado" : "ip.liberado",
      entity: "ips_bloqueados",
      entityId: data.ip,
      success: true,
      detail: { motivo: data.motivo || null },
    });

    return { ok: true, bloqueado: data.bloquear };
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

    /*
     * Cada consulta cai para lista vazia por conta própria.
     *
     * As duas tabelas são independentes: se `tentativas_painel` ainda não
     * existe, quem está online continua aparecendo. Uma falha derrubar a outra
     * seria pior que mostrar meia tela.
     */
    const online = await admin
      .from("presenca_online")
      .select("sessao_id, user_id, email, nome, ip, navegador, pagina, no_painel, entrou_em, visto_em")
      .gte("visto_em", corte)
      .order("visto_em", { ascending: false })
      .limit(200)
      .then((r: any) => r.data ?? [])
      .catch(() => [] as any[]);

    const tentativas = await admin
      .from("tentativas_painel")
      // `*` e não a lista de colunas: pedir `painel` por nome antes de a
      // migração rodar faria a consulta falhar, e a lista de tentativas
      // inteira sumiria da tela. Com `*`, a coluna vem quando existir.
      .select("*")
      .order("criado_em", { ascending: false })
      .limit(60)
      .then((r: any) => r.data ?? [])
      .catch(() => [] as any[]);

    /*
     * Sinal de ataque: muitas falhas do MESMO IP em pouco tempo.
     *
     * Uma senha errada é distração; cinco do mesmo IP em 15 minutos é alguém
     * tentando adivinhar. O limiar é conservador de propósito — alarme que
     * dispara à toa vira alarme ignorado.
     */
    const quinzeMin = Date.now() - 15 * 60_000;
    const falhasPorIp = new Map<string, number>();
    for (const t of tentativas) {
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

    const lista = online.map((o: any) => ({
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
      tentativas: tentativas.map((t: any) => ({
        id: t.id,
        email: t.email,
        ip: t.ip,
        navegador: resumirNavegador(t.navegador),
        sucesso: t.sucesso,
        motivo: t.motivo,
        quando: t.criado_em,
        // Nulo nos registros antigos, de antes da coluna existir.
        painel: (t.painel as string | null | undefined) ?? null,
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
