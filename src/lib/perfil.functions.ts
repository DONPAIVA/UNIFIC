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

    // Contas do Mercado Livre que cada cliente conectou.
    const ids = (linhas ?? []).map((c: any) => c.user_id);
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
