/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Cadastro do cliente do Únific+.
 *
 * Como nos demais arquivos `*.functions.ts`, tudo que toca o banco entra por
 * import DINÂMICO: este arquivo é alcançável pelo bundle do navegador, e um
 * import estático de `server/` levaria código e segredos do servidor junto.
 *
 * A identidade vem SEMPRE do middleware (`context.user`), nunca de um id
 * enviado pelo navegador.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminUser, requireUser } from "./auth-middleware";
import { digitos, mascararCpf } from "./cpf";

/* -------------------------------------------------------------------------- */
/* Cliente                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Grava o cadastro do cliente logado.
 * Chamada logo depois do signUp, com a sessão já criada.
 */
export const salvarMeuPerfil = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .inputValidator((input: { nomeCompleto: string; telefone: string; cpf: string; pin?: string }) => ({
    nomeCompleto: String(input?.nomeCompleto ?? "").trim().slice(0, 150),
    telefone: String(input?.telefone ?? "").slice(0, 30),
    cpf: String(input?.cpf ?? "").slice(0, 20),
    pin: String(input?.pin ?? "").slice(0, 10),
  }))
  .handler(async ({ data, context }) => {
    const { salvarPerfil } = await import("./server/perfil.server");
    const { logEvent } = await import("./server/logs.server");

    const r = await salvarPerfil(context.user.userId, context.user.email, {
      nomeCompleto: data.nomeCompleto,
      telefone: data.telefone,
      cpf: data.cpf,
      pin: data.pin || null,
    });

    await logEvent({
      category: "login",
      action: r.ok ? "cadastro.perfil_salvo" : "cadastro.perfil_recusado",
      actor: context.user.email,
      ip: context.user.ip,
      success: r.ok,
      error: r.ok ? null : r.erro,
      // Nada de CPF, telefone ou PIN no log — é cadastro de pessoa.
      message: r.ok ? "Cadastro do cliente salvo." : "Cadastro recusado na validação.",
    });

    if (!r.ok) throw new Error(r.erro);
    return { ok: true };
  });

/**
 * O acesso do usuário logado está liberado?
 *
 * Chamada pelo Layout em toda página. NÃO usa `requireUser`: aquele middleware
 * lança quando o usuário está bloqueado, e aqui é justamente o bloqueio que
 * precisamos relatar em vez de virar erro.
 *
 * Sem sessão, devolve liberado — visitante anônimo usa o site normalmente.
 */
export const meuAcesso = createServerFn({ method: "GET" }).handler(async () => {
  const liberado = { autenticado: false, bloqueado: false, motivo: null as string | null };

  // Falha aqui LIBERA: um erro de banco não pode trancar todos os clientes
  // para fora do site.
  try {
    const { resolveRequester } = await import("./server/auth.server");
    const requester = await resolveRequester();
    if (!requester) return liberado;

    if (!requester.bloqueado) {
      return { autenticado: true, bloqueado: false, motivo: null as string | null };
    }

    const { db } = await import("./server/db.server");
    const { data } = await db("clientes_bloqueados")
      .select("motivo")
      .eq("user_id", requester.userId)
      .maybeSingle();

    return { autenticado: true, bloqueado: true, motivo: (data?.motivo as string) ?? null };
  } catch {
    return liberado;
  }
});

/**
 * Bloqueia ou libera o acesso de um cliente.
 *
 * O cache de sessões guarda a identidade por até 60 s. Sem invalidá-lo, o
 * bloqueado continuaria navegando por até um minuto depois do clique — e para
 * quem aperta o botão isso parece que não funcionou.
 */
export const adminBloquearCliente = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { userId: string; bloquear: boolean; motivo?: string }) => ({
    userId: String(input?.userId ?? ""),
    bloquear: Boolean(input?.bloquear),
    motivo: String(input?.motivo ?? "").trim().slice(0, 300),
  }))
  .handler(async ({ data, context }) => {
    if (!data.userId) throw new Error("Cliente não informado.");
    if (data.userId === context.user.userId) {
      throw new Error("Você não pode bloquear a própria conta.");
    }

    const { db } = await import("./server/db.server");
    const { invalidarCacheSessoes } = await import("./server/auth.server");
    const { logAudit } = await import("./server/audit.server");

    const { data: perfil } = await db("clientes_perfil")
      .select("email, nome_completo")
      .eq("user_id", data.userId)
      .maybeSingle();

    if (data.bloquear) {
      const { error } = await db("clientes_bloqueados").upsert(
        {
          user_id: data.userId,
          email: (perfil?.email as string) ?? null,
          motivo: data.motivo || null,
          bloqueado_em: new Date().toISOString(),
          bloqueado_por: context.user.email,
        },
        { onConflict: "user_id" },
      );
      if (error) throw new Error(`Não foi possível bloquear: ${error.message}`);
    } else {
      const { error } = await db("clientes_bloqueados").delete().eq("user_id", data.userId);
      if (error) throw new Error(`Não foi possível desbloquear: ${error.message}`);
    }

    invalidarCacheSessoes();

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: data.bloquear ? "cliente.bloqueado" : "cliente.desbloqueado",
      entity: "clientes_bloqueados",
      entityId: data.userId,
      success: true,
      detail: { cliente: perfil?.nome_completo ?? null, motivo: data.motivo || null },
    });

    return { ok: true, bloqueado: data.bloquear };
  });

/** Perfil do próprio cliente, para preencher a tela "minha conta". */
export const meuPerfil = createServerFn({ method: "GET" })
  .middleware([requireUser])
  .handler(async ({ context }) => {
    const { buscarPerfil, registrarAcesso } = await import("./server/perfil.server");
    const perfil = await buscarPerfil(context.user.userId);
    if (perfil) void registrarAcesso(context.user.userId);
    return { perfil };
  });

/* -------------------------------------------------------------------------- */
/* CentralML — visão do administrador                                          */
/* -------------------------------------------------------------------------- */

/**
 * Lista os clientes que criaram conta no Únific+.
 *
 * O CPF sai MASCARADO (123.***.**9-09). Ver o número inteiro exige uma
 * chamada separada (`adminRevelarCpf`), que fica registrada na auditoria —
 * é o que diferencia "consultar a lista" de "acessar dado pessoal".
 */
export const adminClientes = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .inputValidator((input: { q?: string | null; limit?: number; offset?: number } | undefined) => ({
    q: String(input?.q ?? "").trim().slice(0, 80) || null,
    limit: Math.min(Math.max(Number(input?.limit ?? 50), 1), 200),
    offset: Math.max(Number(input?.offset ?? 0), 0),
  }))
  .handler(async ({ data }) => {
    const { admin } = await import("./server/db.server");

    let q = admin
      .from("clientes_perfil")
      .select("user_id, nome_completo, email, telefone, cpf, pin_hash, criado_em, ultimo_acesso_em", {
        count: "exact",
      })
      .order("criado_em", { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);

    if (data.q) {
      const termo = data.q.replace(/[%,]/g, "");
      // Busca por CPF só faz sentido com os dígitos puros do que foi digitado.
      const somenteDigitos = digitos(termo);
      const filtros = [`nome_completo.ilike.%${termo}%`, `email.ilike.%${termo}%`];
      if (somenteDigitos.length >= 3) {
        filtros.push(`cpf.ilike.%${somenteDigitos}%`, `telefone.ilike.%${somenteDigitos}%`);
      }
      q = q.or(filtros.join(","));
    }

    const { data: linhas, count, error } = await q;
    if (error) throw new Error(error.message);

    // Quem está bloqueado, numa consulta só.
    const ids = (linhas ?? []).map((c: any) => c.user_id);
    const bloqueados = new Map<string, string | null>();
    if (ids.length) {
      const { data: bl } = await admin
        .from("clientes_bloqueados")
        .select("user_id, motivo")
        .in("user_id", ids);
      for (const b of bl ?? []) bloqueados.set(String((b as any).user_id), (b as any).motivo ?? null);
    }

    // Contas do Mercado Livre que cada cliente conectou.
    const contasPorDono = new Map<string, string[]>();
    if (ids.length) {
      const { data: contas } = await admin
        .from("ml_connections")
        .select("owner_user_id, nickname")
        .in("owner_user_id", ids);
      for (const c of contas ?? []) {
        const dono = String((c as any).owner_user_id);
        const lista = contasPorDono.get(dono) ?? [];
        lista.push((c as any).nickname ?? "conta ML");
        contasPorDono.set(dono, lista);
      }
    }

    return {
      total: count ?? 0,
      clientes: (linhas ?? []).map((c: any) => ({
        userId: c.user_id,
        nome: c.nome_completo,
        email: c.email,
        telefone: c.telefone,
        cpfMascarado: mascararCpf(c.cpf),
        temPin: Boolean(c.pin_hash),
        criadoEm: c.criado_em,
        ultimoAcessoEm: c.ultimo_acesso_em,
        contasMl: contasPorDono.get(String(c.user_id)) ?? [],
        bloqueado: bloqueados.has(String(c.user_id)),
        motivoBloqueio: bloqueados.get(String(c.user_id)) ?? null,
      })),
    };
  });

/**
 * Revela o CPF completo de um cliente.
 *
 * Existe separado de propósito: dado pessoal não deve sair numa listagem
 * inteira. Cada revelação é individual, intencional e fica na auditoria com
 * o e-mail de quem consultou.
 */
export const adminRevelarCpf = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { userId: string }) => ({ userId: String(input?.userId ?? "") }))
  .handler(async ({ data, context }) => {
    const { db } = await import("./server/db.server");
    const { logAudit } = await import("./server/audit.server");
    const { formatarCpf } = await import("./cpf");

    const { data: cliente } = await db("clientes_perfil")
      .select("user_id, nome_completo, cpf")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (!cliente) throw new Error("Cliente não encontrado.");

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "cliente.cpf_revelado",
      entity: "clientes_perfil",
      entityId: String(cliente.user_id),
      success: true,
      // O CPF em si NÃO entra na auditoria — só o registro de que foi visto.
      detail: { cliente: cliente.nome_completo },
    });

    return { cpf: formatarCpf(cliente.cpf) };
  });
