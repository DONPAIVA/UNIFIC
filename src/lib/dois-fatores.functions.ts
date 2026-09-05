/**
 * Verificação em duas etapas do painel — o que a tela chama.
 *
 * Todas usam `requireAdminUserSem2fa`: são justamente as funções que precisam
 * funcionar ANTES de a sessão estar verificada. O resto do painel usa
 * `requireAdminUser`, que cobra o código.
 *
 * Como nos demais `*.functions.ts`, tudo que toca servidor entra por import
 * DINÂMICO — este arquivo é alcançável pelo bundle do navegador.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminUserSem2fa } from "./auth-middleware";

/**
 * Registra o que aconteceu no segundo fator junto das tentativas de senha.
 *
 * Vai para `tentativas_painel`, a mesma tabela do login — é ela que a aba
 * "Ao vivo" mostra, com IP e navegador. Separar em outro lugar deixaria a
 * história pela metade: você veria a senha certa e não veria que aquele
 * mesmo acesso empacou (ou passou) no código.
 *
 * Falhar aqui nunca impede a entrada de quem tem a credencial certa.
 */
async function registrar(email: string, sucesso: boolean, motivo: string) {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { db } = await import("./server/db.server");
    const { ipDeHeaders } = await import("./server/ip.server");

    const request = getRequest();
    await db("tentativas_painel").insert({
      email: email || null,
      ip: ipDeHeaders(request.headers),
      navegador: (request.headers.get("user-agent") ?? "").slice(0, 300),
      sucesso,
      motivo,
    });
  } catch {
    /* registro é observação, não pode barrar ninguém */
  }
}

/** Situação do segundo fator para o administrador logado. */
export const meuSegundoFator = createServerFn({ method: "GET" })
  .middleware([requireAdminUserSem2fa])
  .handler(async ({ context }) => {
    const { temSegundoFator, sessaoVerificada, tokenDaRequisicao } = await import(
      "./server/dois-fatores.server"
    );

    const ativo = await temSegundoFator(context.user.userId);
    if (!ativo) return { ativo: false, verificado: true };

    const token = await tokenDaRequisicao();
    const verificado = Boolean(token) && (await sessaoVerificada(context.user.userId, token!));
    return { ativo: true, verificado };
  });

/**
 * Começa a ativação: gera o segredo e devolve o endereço para o aplicativo.
 *
 * O segredo nasce NÃO confirmado. Só passa a valer depois que o administrador
 * digita um código correto — sem isso, um segredo gerado e nunca guardado no
 * celular trancaria a conta dele para fora do próprio painel.
 */
export const ativarSegundoFator = createServerFn({ method: "POST" })
  .middleware([requireAdminUserSem2fa])
  .handler(async ({ context }) => {
    const { gerarSegredo, enderecoParaApp } = await import("./server/dois-fatores.server");
    const { db } = await import("./server/db.server");

    const { data: existente } = await db("admin_2fa")
      .select("confirmado")
      .eq("user_id", context.user.userId)
      .maybeSingle();

    if (existente?.confirmado) {
      throw new Error("A verificação em duas etapas já está ativa nesta conta.");
    }

    const segredo = gerarSegredo();
    const { error } = await db("admin_2fa").upsert(
      {
        user_id: context.user.userId,
        segredo,
        confirmado: false,
        criado_em: new Date().toISOString(),
        confirmado_em: null,
      },
      { onConflict: "user_id" },
    );
    if (error) throw new Error("Não foi possível preparar a verificação em duas etapas.");

    return { segredo, endereco: enderecoParaApp(context.user.email, segredo) };
  });

/**
 * Confere o código de 6 dígitos.
 *
 * Serve para as duas situações: confirmar a ativação e liberar uma sessão nova.
 * O que muda é só o efeito — na primeira vez também marca o segredo como
 * confirmado.
 */
export const conferirSegundoFator = createServerFn({ method: "POST" })
  .middleware([requireAdminUserSem2fa])
  .inputValidator((input: { codigo: string }) => ({
    codigo: String(input?.codigo ?? "").replace(/\D/g, "").slice(0, 6),
  }))
  .handler(async ({ data, context }) => {
    const { codigoConfere, liberarSessao, tokenDaRequisicao } = await import(
      "./server/dois-fatores.server"
    );
    const { db } = await import("./server/db.server");
    const { logEvent } = await import("./server/logs.server");

    const anotar = (ok: boolean, motivo: string) => {
      void registrar(context.user.email, ok, motivo);
      void logEvent({
        category: "login",
        action: ok ? "2fa.codigo_aceito" : "2fa.codigo_recusado",
        actor: context.user.email,
        ip: context.user.ip,
        success: ok,
        error: ok ? null : motivo,
        message: ok ? "Segundo fator conferido." : "Código do segundo fator recusado.",
      }).catch(() => undefined);
    };

    const { data: registro } = await db("admin_2fa")
      .select("segredo, confirmado")
      .eq("user_id", context.user.userId)
      .maybeSingle();

    if (!registro?.segredo) {
      throw new Error("Nenhuma verificação em duas etapas preparada para esta conta.");
    }

    if (!codigoConfere(registro.segredo, data.codigo)) {
      anotar(false, "2fa_codigo_errado");
      throw new Error("Código incorreto. Confira o aplicativo e tente de novo.");
    }

    const token = await tokenDaRequisicao();
    if (!token) throw new Error("Sessão não identificada. Entre novamente.");

    if (!registro.confirmado) {
      await db("admin_2fa")
        .update({ confirmado: true, confirmado_em: new Date().toISOString() })
        .eq("user_id", context.user.userId);
    }

    await liberarSessao(context.user.userId, token);
    anotar(true, registro.confirmado ? "2fa_ok" : "2fa_ativado");

    return { ok: true, ativadoAgora: !registro.confirmado };
  });

/**
 * Desliga o segundo fator.
 *
 * Exige um código válido: sem isso, quem tivesse só a senha desligaria a
 * proteção e ela não protegeria de nada.
 */
export const desativarSegundoFator = createServerFn({ method: "POST" })
  .middleware([requireAdminUserSem2fa])
  .inputValidator((input: { codigo: string }) => ({
    codigo: String(input?.codigo ?? "").replace(/\D/g, "").slice(0, 6),
  }))
  .handler(async ({ data, context }) => {
    const { codigoConfere, revogarSessoes } = await import("./server/dois-fatores.server");
    const { db } = await import("./server/db.server");
    const { logAudit } = await import("./server/audit.server");

    const { data: registro } = await db("admin_2fa")
      .select("segredo, confirmado")
      .eq("user_id", context.user.userId)
      .maybeSingle();

    if (!registro?.segredo || !registro.confirmado) {
      throw new Error("A verificação em duas etapas não está ativa.");
    }

    if (!codigoConfere(registro.segredo, data.codigo)) {
      throw new Error("Código incorreto. A verificação continua ativa.");
    }

    await db("admin_2fa").delete().eq("user_id", context.user.userId);
    await revogarSessoes(context.user.userId);

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "2fa.desativado",
      entity: "admin_2fa",
      entityId: context.user.userId,
      success: true,
    });

    return { ok: true };
  });
