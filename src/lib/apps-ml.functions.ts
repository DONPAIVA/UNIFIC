/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Aplicativo do Mercado Livre pela Central: ver, cadastrar e trocar.
 *
 * O cadastro testa o Client ID e o Secret no próprio Mercado Livre antes de
 * salvar, e o secret vai cifrado para o banco — nunca volta ao navegador.
 * Trocar o app ativo não derruba ninguém: cada conta continua renovando pelo
 * app que a autorizou (ver server/ml-apps.server.ts).
 *
 * Como nos demais `*.functions.ts`, tudo que toca servidor entra por import
 * DINÂMICO — este arquivo é alcançável pelo bundle do navegador.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminUser } from "./auth-middleware";

const FALTA_SQL = "Falta rodar no Supabase o SQL 20261022120000_apps_do_mercado_livre.sql.";

/**
 * Marca as contas sem registro de app como do app do .env — quem as
 * autorizou. Roda antes de qualquer troca, para que elas continuem
 * renovando pelo app certo depois que outro virar o ativo.
 */
async function fixarContasNoAppDoEnv() {
  const { db } = await import("./server/db.server");
  const { appDoEnv, faltaEsquema } = await import("./server/ml-apps.server");
  const doEnv = appDoEnv();
  if (!doEnv) return;
  const { error } = await db("ml_connections")
    .update({ app_client_id: doEnv.clientId })
    .eq("provider", "mercado_livre")
    .is("app_client_id", null);
  if (error) throw new Error(faltaEsquema(error, "app_client_id") ? FALTA_SQL : error.message);
}

/** O que a tela mostra: app ativo, apps cadastrados e quantas contas usam cada um. */
export const adminAppsMl = createServerFn({ method: "GET" })
  .middleware([requireAdminUser])
  .handler(async () => {
    const { db } = await import("./server/db.server");
    const { appAtivo, appDoEnv } = await import("./server/ml-apps.server");
    const { getMlRedirectUri, getMlWebhookUrl } = await import("./server/config.server");

    const doEnv = appDoEnv();
    const ativo = await appAtivo().catch(() => null);

    const { data: apps, error: erroApps } = await db("ml_apps")
      .select("client_id, nome, ativo, criado_em, criado_por")
      .order("criado_em", { ascending: true });

    // Contas por app. Sem a coluna nova, todas são do app do .env.
    const contas = new Map<string, number>();
    const somar = (id: string | null | undefined) => {
      const chave = id || doEnv?.clientId || "";
      if (chave) contas.set(chave, (contas.get(chave) ?? 0) + 1);
    };
    const comApp = await db("ml_connections").select("app_client_id").eq("provider", "mercado_livre");
    if (comApp.error) {
      const semApp = await db("ml_connections").select("id").eq("provider", "mercado_livre");
      for (const _ of semApp.data ?? []) somar(null);
    } else {
      for (const linha of (comApp.data ?? []) as any[]) somar(linha.app_client_id);
    }

    let redirectUri = "";
    try {
      redirectUri = getMlRedirectUri();
    } catch {
      /* sem domínio configurado: a tela avisa */
    }

    return {
      semTabela: Boolean(erroApps),
      ativo: ativo ? { clientId: ativo.clientId, origem: ativo.origem } : null,
      env: doEnv
        ? {
            clientId: doEnv.clientId,
            contas: contas.get(doEnv.clientId) ?? 0,
            cadastradoNaCentral: (apps ?? []).some((a: any) => String(a.client_id) === doEnv.clientId),
          }
        : null,
      apps: ((apps ?? []) as any[]).map((a) => ({
        clientId: String(a.client_id),
        nome: a.nome ?? null,
        ativo: Boolean(a.ativo),
        criadoEm: a.criado_em ?? null,
        criadoPor: a.criado_por ?? null,
        contas: contas.get(String(a.client_id)) ?? 0,
      })),
      redirectUri,
      webhookUrl: getMlWebhookUrl(),
    };
  });

/** Testa no ML e, se aceito, salva e deixa este app como o ativo. */
export const adminSalvarAppMl = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { clientId: string; clientSecret: string; nome?: string }) => ({
    clientId: String(input?.clientId ?? "").trim(),
    clientSecret: String(input?.clientSecret ?? "").trim(),
    nome: String(input?.nome ?? "").trim().slice(0, 60),
  }))
  .handler(async ({ data, context }) => {
    if (!/^\d{4,25}$/.test(data.clientId)) throw new Error("O Client ID do Mercado Livre tem só números.");
    if (data.clientSecret.length < 8) throw new Error("Cole o Client Secret completo.");

    const { db } = await import("./server/db.server");
    const { cifrar, testarCredenciais, limparCacheDosApps, faltaEsquema } = await import("./server/ml-apps.server");
    const { getMlRedirectUri } = await import("./server/config.server");
    const { logAudit } = await import("./server/audit.server");

    const teste = await testarCredenciais(data.clientId, data.clientSecret, getMlRedirectUri());
    if (!teste.ok) throw new Error(teste.mensagem);

    await fixarContasNoAppDoEnv();

    const desativar = await db("ml_apps").update({ ativo: false }).eq("ativo", true);
    if (desativar.error) throw new Error(faltaEsquema(desativar.error, "ml_apps") ? FALTA_SQL : desativar.error.message);

    const { error } = await db("ml_apps").upsert(
      {
        client_id: data.clientId,
        nome: data.nome || null,
        client_secret_cifrado: await cifrar(data.clientSecret),
        ativo: true,
        criado_por: context.user.email,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "client_id" },
    );
    limparCacheDosApps();

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "app_ml.cadastrado_e_ativado",
      entity: "ml_apps",
      entityId: data.clientId,
      success: !error,
      detail: { nome: data.nome || null },
    });

    if (error) throw new Error(error.message);
    return { ok: true, mensagem: teste.mensagem };
  });

/**
 * Deixa outro app como o ativo. Vale também para voltar ao app do .env:
 * basta passar o Client ID dele.
 */
export const adminAtivarAppMl = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { clientId: string }) => ({ clientId: String(input?.clientId ?? "").trim() }))
  .handler(async ({ data, context }) => {
    const { db } = await import("./server/db.server");
    const { appDoEnv, limparCacheDosApps, faltaEsquema } = await import("./server/ml-apps.server");
    const { logAudit } = await import("./server/audit.server");

    const { data: linha, error: erroLeitura } = await db("ml_apps")
      .select("client_id")
      .eq("client_id", data.clientId)
      .maybeSingle();
    if (erroLeitura) throw new Error(faltaEsquema(erroLeitura, "ml_apps") ? FALTA_SQL : erroLeitura.message);

    const ehDoEnv = appDoEnv()?.clientId === data.clientId;
    if (!linha && !ehDoEnv) throw new Error("Este app não está cadastrado.");

    await fixarContasNoAppDoEnv();

    // App do .env fora da tabela: sem nenhum ativo, ele é o padrão.
    const { error: erroDesativar } = await db("ml_apps").update({ ativo: false }).eq("ativo", true);
    if (erroDesativar) throw new Error(erroDesativar.message);
    if (linha) {
      const { error } = await db("ml_apps")
        .update({ ativo: true, atualizado_em: new Date().toISOString() })
        .eq("client_id", data.clientId);
      if (error) throw new Error(error.message);
    }
    limparCacheDosApps();

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "app_ml.ativado",
      entity: "ml_apps",
      entityId: data.clientId,
      success: true,
      detail: { origem: linha ? "painel" : "env" },
    });
    return { ok: true };
  });

/** Remove um app cadastrado — só se não for o ativo e nenhuma conta depender dele. */
export const adminRemoverAppMl = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { clientId: string }) => ({ clientId: String(input?.clientId ?? "").trim() }))
  .handler(async ({ data, context }) => {
    const { db } = await import("./server/db.server");
    const { limparCacheDosApps } = await import("./server/ml-apps.server");
    const { logAudit } = await import("./server/audit.server");

    const { data: linha } = await db("ml_apps").select("ativo").eq("client_id", data.clientId).maybeSingle();
    if (!linha) throw new Error("Este app não está cadastrado.");
    if (linha.ativo) throw new Error("Este é o app ativo. Ative outro antes de remover.");

    const { data: dependentes } = await db("ml_connections")
      .select("id")
      .eq("provider", "mercado_livre")
      .eq("app_client_id", data.clientId);
    const total = (dependentes ?? []).length;
    if (total > 0) {
      throw new Error(
        `${total} conta(s) ainda foram autorizadas por este app e renovam por ele. Remover agora derrubaria essas contas.`,
      );
    }

    const { error } = await db("ml_apps").delete().eq("client_id", data.clientId);
    limparCacheDosApps();

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: "app_ml.removido",
      entity: "ml_apps",
      entityId: data.clientId,
      success: !error,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
