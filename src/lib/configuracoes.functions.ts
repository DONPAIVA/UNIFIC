/**
 * Liga/desliga do site controlado pelo painel.
 *
 * Por enquanto uma só opção: o RASTREIO LIVRE. Ligado, qualquer pessoa que
 * digita um código rastreia direto, sem ser mandada para autorizar o Mercado
 * Livre. Desligado, vale a regra de sempre: sem a conta autorizada, o rastreio
 * não abre.
 *
 * Como nos demais `*.functions.ts`, tudo que toca servidor entra por import
 * DINÂMICO — este arquivo é alcançável pelo bundle do navegador.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireAdminUser } from "./auth-middleware";

const CHAVE_RASTREIO_LIVRE = "rastreio_livre";

/**
 * O rastreio está livre agora?
 *
 * Pública de propósito: é o site que pergunta, para qualquer visitante. Só
 * devolve o sim/não — nunca a tabela.
 *
 * Qualquer falha responde `false`, que é o comportamento de hoje. Assim, se a
 * tabela ainda não existir ou o banco oscilar, o site continua exatamente como
 * está, em vez de abrir sozinho a trava do rastreio.
 */
export const rastreioLivre = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const { db } = await import("./server/db.server");
    const { data } = await db("configuracoes_site")
      .select("valor")
      .eq("chave", CHAVE_RASTREIO_LIVRE)
      .maybeSingle();
    return { livre: data?.valor === true };
  } catch {
    return { livre: false };
  }
});

/**
 * Liga ou desliga o rastreio livre.
 *
 * Exige administrador com o código de duas etapas. Fica registrado na
 * auditoria quem mudou e quando — é uma troca que muda o que TODO visitante
 * vê, então precisa deixar rastro.
 */
export const adminDefinirRastreioLivre = createServerFn({ method: "POST" })
  .middleware([requireAdminUser])
  .inputValidator((input: { livre: boolean }) => ({ livre: input?.livre === true }))
  .handler(async ({ data, context }) => {
    const { db } = await import("./server/db.server");
    const { logAudit } = await import("./server/audit.server");

    const { error } = await db("configuracoes_site").upsert(
      {
        chave: CHAVE_RASTREIO_LIVRE,
        valor: data.livre,
        atualizado_em: new Date().toISOString(),
        atualizado_por: context.user.email,
      },
      { onConflict: "chave" },
    );

    if (error) {
      const semTabela = /configuracoes_site/i.test(String(error.message ?? "")) ||
        ["PGRST205", "42P01"].includes(String((error as { code?: string }).code));
      throw new Error(
        semTabela
          ? "Falta rodar o SQL da tabela de configurações no Supabase."
          : error.message || "Não foi possível salvar.",
      );
    }

    await logAudit({
      adminUserId: context.user.userId,
      adminEmail: context.user.email,
      ip: context.user.ip,
      action: data.livre ? "rastreio_livre.ligado" : "rastreio_livre.desligado",
      entity: "configuracoes_site",
      entityId: CHAVE_RASTREIO_LIVRE,
      success: true,
    });

    return { livre: data.livre };
  });
