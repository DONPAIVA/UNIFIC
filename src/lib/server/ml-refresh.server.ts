/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Manutenção automática dos tokens do Mercado Livre.
 *
 * Roda sem nenhuma ação do cliente: ele autoriza uma vez e o sistema mantém
 * o access_token válido enquanto o Mercado Livre mantiver a autorização.
 *
 * O botão "Sincronizar" existe só para trazer pedidos — nunca é necessário
 * para manter o OAuth de pé.
 */
import { db } from "./db.server";
import { tentarRenovar, type MlAccount } from "./ml-api.server";

/** Renova quando faltar menos que isto para expirar. */
const MARGEM_MS = 10 * 60 * 1000;

/** Espera crescente entre tentativas após falha temporária: 1, 4, 9, 16… min. */
function proximaTentativaMs(tentativas: number): number {
  const minutos = Math.min(Math.pow(Math.max(tentativas, 1), 2), 60);
  return minutos * 60 * 1000;
}

/** Depois de tantas falhas seguidas, paramos de insistir de perto. */
const MAX_TENTATIVAS = 8;

export type ItemResultado = {
  mlUserId: string;
  resultado: "renovado" | "ainda_valido" | "reautorizacao_necessaria" | "erro_temporario" | "ignorado" | "em_uso";
  expiresAt?: string | null;
  rotacionouRefreshToken?: boolean;
  motivo?: string;
};

export type ResultadoManutencao = {
  verificadas: number;
  renovadas: number;
  jaValidas: number;
  reautorizacao: number;
  errosTemporarios: number;
  duracaoMs: number;
  itens: ItemResultado[];
};

/**
 * Percorre as conexões e renova as que estão perto de vencer.
 *
 * Importante: contas com status `reauth_required` ou `disconnected` são
 * ignoradas — insistir nelas só gastaria chamada, já que o refresh_token
 * foi rejeitado de verdade pelo Mercado Livre.
 */
export async function manterTokens(opts: { limite?: number; forcar?: boolean; origem?: string } = {}): Promise<ResultadoManutencao> {
  const inicio = Date.now();
  const limite = Math.min(Math.max(opts.limite ?? 50, 1), 200);
  const origem = opts.origem ?? "cron";
  const { logEvent } = await import("./logs.server");

  // select("*") de propósito: funciona antes e depois da migration que
  // adiciona as colunas de acompanhamento (refresh_attempts, etc.).
  /*
   * `owner_user_id IS NOT NULL` é obrigatório aqui.
   *
   * Conexão sem dono é a criada antes do login obrigatório: nenhum cliente
   * consegue enxergá-la nem usá-la. Renovar o token dela só gastaria chamada
   * — e, pior, apagaria o marcador de "precisa reconectar" que a migration de
   * multi-tenancy colocou, fazendo a conta parecer saudável sem estar.
   */
  const { data: contas, error: erroBusca } = await db("ml_connections")
    .select("*")
    .eq("provider", "mercado_livre")
    .not("owner_user_id", "is", null)
    .in("status", ["active", "syncing", "error"])
    .order("expires_at", { ascending: true, nullsFirst: true })
    .limit(limite);

  if (erroBusca) {
    await logEvent({
      category: "refresh_token",
      action: "manutencao.falha_consulta",
      actor: origem,
      success: false,
      error: erroBusca.message,
    });
    throw new Error(`Não foi possível listar as conexões: ${erroBusca.message}`);
  }

  const itens: ItemResultado[] = [];
  let renovadas = 0;
  let jaValidas = 0;
  let reautorizacao = 0;
  let errosTemporarios = 0;

  for (const conta of (contas ?? []) as Array<MlAccount & { refresh_attempts?: number; last_refresh_at?: string | null; refresh_lock_at?: string | null }>) {
    const expiraEm = conta.expires_at ? new Date(conta.expires_at).getTime() : 0;
    const faltando = expiraEm - Date.now();

    // Ainda longe de expirar: não gasta chamada.
    if (!opts.forcar && faltando > MARGEM_MS) {
      jaValidas++;
      itens.push({ mlUserId: conta.ml_user_id, resultado: "ainda_valido", expiresAt: conta.expires_at });
      continue;
    }

    // Backoff: respeita a espera após falhas temporárias seguidas.
    const tentativas = Number(conta.refresh_attempts ?? 0);
    if (!opts.forcar && tentativas > 0 && conta.last_refresh_at) {
      const espera = proximaTentativaMs(tentativas);
      const desde = Date.now() - new Date(conta.last_refresh_at).getTime();
      if (desde < espera) {
        itens.push({
          mlUserId: conta.ml_user_id,
          resultado: "ignorado",
          motivo: `aguardando backoff (tentativa ${tentativas})`,
        });
        continue;
      }
      if (tentativas >= MAX_TENTATIVAS) {
        itens.push({
          mlUserId: conta.ml_user_id,
          resultado: "ignorado",
          motivo: `${tentativas} falhas seguidas — aguardando intervenção`,
        });
        continue;
      }
    }

    // Trava: se outra execução já pegou esta conta, saímos sem renovar.
    // É isto que impede duas rodadas simultâneas de rotacionar o mesmo
    // refresh_token e queimar um dos dois.
    const { tentarTravarConta } = await import("./ml-api.server");
    const travou = await tentarTravarConta(conta.id);
    if (!travou) {
      itens.push({ mlUserId: conta.ml_user_id, resultado: "em_uso", motivo: "outra execução já está renovando" });
      continue;
    }

    // Relê a conta depois da trava: se outra execução renovou nesse intervalo,
    // o expires_at já estará longe e não repetimos a rotação.
    const { data: fresca } = await db("ml_connections").select("*").eq("id", conta.id).maybeSingle();
    const atual = (fresca ?? conta) as MlAccount;
    const faltandoAgora = (atual.expires_at ? new Date(atual.expires_at).getTime() : 0) - Date.now();
    if (!opts.forcar && faltandoAgora > MARGEM_MS) {
      await db("ml_connections").update({ refresh_lock_at: null }).eq("id", conta.id);
      jaValidas++;
      itens.push({ mlUserId: conta.ml_user_id, resultado: "ainda_valido", expiresAt: atual.expires_at });
      continue;
    }

    const r = await tentarRenovar(atual, { origem });

    if (r.ok) {
      renovadas++;
      itens.push({
        mlUserId: conta.ml_user_id,
        resultado: "renovado",
        expiresAt: r.account.expires_at,
        rotacionouRefreshToken: r.rotacionouRefreshToken,
      });
    } else if (r.motivo === "reauth") {
      reautorizacao++;
      itens.push({ mlUserId: conta.ml_user_id, resultado: "reautorizacao_necessaria", motivo: r.mensagem });
    } else {
      errosTemporarios++;
      itens.push({ mlUserId: conta.ml_user_id, resultado: "erro_temporario", motivo: r.mensagem });
    }
  }

  const duracaoMs = Date.now() - inicio;

  await logEvent({
    category: "refresh_token",
    action: "manutencao.rodada",
    actor: origem,
    durationMs: duracaoMs,
    success: reautorizacao === 0 && errosTemporarios === 0,
    message: `${contas?.length ?? 0} conta(s) verificada(s): ${renovadas} renovada(s), ${jaValidas} já válida(s).`,
    // Só metadados — nenhum token entra aqui.
    detail: { renovadas, jaValidas, reautorizacao, errosTemporarios, itens },
  });

  return {
    verificadas: contas?.length ?? 0,
    renovadas,
    jaValidas,
    reautorizacao,
    errosTemporarios,
    duracaoMs,
    itens,
  };
}
