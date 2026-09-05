/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Verificação em duas etapas do painel, por aplicativo autenticador.
 *
 * Implementa o TOTP (RFC 6238) — o mesmo padrão do Google Authenticator, Authy
 * e 1Password: um número de 6 dígitos derivado de um segredo compartilhado e
 * do relógio, trocado a cada 30 segundos.
 *
 * Feito à mão, sem biblioteca, porque são poucas linhas de HMAC e o projeto
 * não precisa carregar mais uma dependência por causa disso.
 *
 * Arquivo `.server.ts`: nada aqui alcança o navegador. O segredo nunca sai
 * daqui depois de confirmado.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Quanto tempo uma sessão fica liberada depois de passar pelo código. */
const HORAS_LIBERADA = 12;

/** Passo do TOTP, em segundos. 30 é o padrão que os aplicativos usam. */
const PASSO = 30;

/**
 * Quantos passos de folga aceitar para trás e para frente.
 *
 * Relógio de celular quase nunca bate exatamente com o do servidor, e a pessoa
 * leva alguns segundos digitando. Sem essa folga, código certo seria recusado.
 * Um passo para cada lado é o recomendado: aceita ~90 segundos no total.
 */
const FOLGA = 1;

const ALFABETO_BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Segredo aleatório em base32, no formato que os aplicativos leem. */
export function gerarSegredo(bytes = 20): string {
  const brutos = randomBytes(bytes);
  let bits = "";
  for (const b of brutos) bits += b.toString(2).padStart(8, "0");

  let saida = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    saida += ALFABETO_BASE32[parseInt(bits.slice(i, i + 5), 2)];
  }
  return saida;
}

function base32ParaBytes(segredo: string): Buffer {
  const limpo = segredo.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const ch of limpo) {
    const valor = ALFABETO_BASE32.indexOf(ch);
    if (valor < 0) continue;
    bits += valor.toString(2).padStart(5, "0");
  }

  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/** O código de 6 dígitos para um dado instante. */
function codigoNoPasso(segredo: string, passo: number): string {
  const chave = base32ParaBytes(segredo);

  // O contador vai em 8 bytes, do mais significativo para o menos.
  const contador = Buffer.alloc(8);
  let restante = passo;
  for (let i = 7; i >= 0; i--) {
    contador[i] = restante & 0xff;
    restante = Math.floor(restante / 256);
  }

  const hmac = createHmac("sha1", chave).update(contador).digest();

  // "Truncamento dinâmico": os 4 bits finais dizem onde começar a ler.
  const inicio = hmac[hmac.length - 1]! & 0x0f;
  const numero =
    (((hmac[inicio]! & 0x7f) << 24) |
      ((hmac[inicio + 1]! & 0xff) << 16) |
      ((hmac[inicio + 2]! & 0xff) << 8) |
      (hmac[inicio + 3]! & 0xff)) %
    1_000_000;

  return String(numero).padStart(6, "0");
}

/**
 * O código digitado confere?
 *
 * A comparação é feita com `timingSafeEqual` para não vazar, pelo tempo de
 * resposta, quantos dígitos iniciais estavam certos.
 */
export function codigoConfere(segredo: string, digitado: string, agora = Date.now()): boolean {
  const limpo = String(digitado ?? "").replace(/\D/g, "");
  if (limpo.length !== 6) return false;

  const passoAtual = Math.floor(agora / 1000 / PASSO);
  const alvo = Buffer.from(limpo);

  for (let d = -FOLGA; d <= FOLGA; d++) {
    const esperado = Buffer.from(codigoNoPasso(segredo, passoAtual + d));
    if (esperado.length === alvo.length && timingSafeEqual(esperado, alvo)) return true;
  }
  return false;
}

/** Endereço `otpauth://` que o aplicativo autenticador lê pelo QR ou digitando. */
export function enderecoParaApp(email: string, segredo: string): string {
  const conta = encodeURIComponent(email || "administrador");
  const emissor = encodeURIComponent("Olho de Deus ML");
  return `otpauth://totp/${emissor}:${conta}?secret=${segredo}&issuer=${emissor}&period=${PASSO}&digits=6&algorithm=SHA1`;
}

/* -------------------------------------------------------------------------- */
/* Estado no banco                                                             */
/* -------------------------------------------------------------------------- */

/** Hash do token de acesso. Nunca guardamos o token em si. */
async function hashDoToken(token: string): Promise<string> {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(token).digest("hex");
}

/** O administrador tem o segundo fator ativo (gerado E confirmado)? */
export async function temSegundoFator(userId: string): Promise<boolean> {
  try {
    const { db } = await import("./db.server");
    const { data } = await db("admin_2fa")
      .select("confirmado")
      .eq("user_id", userId)
      .maybeSingle();
    return Boolean(data?.confirmado);
  } catch {
    /*
     * Falha de leitura NÃO tranca o painel.
     *
     * A tabela pode nem existir ainda (migração não rodada) e o banco pode
     * oscilar. Entre deixar o administrador de fora do próprio sistema e
     * manter a proteção de antes, a escolha é não piorar o dia dele.
     */
    return false;
  }
}

/** Esta sessão já passou pelo código nas últimas horas? */
export async function sessaoVerificada(userId: string, token: string): Promise<boolean> {
  try {
    const { db } = await import("./db.server");
    const { data } = await db("admin_2fa_sessoes")
      .select("expira_em")
      .eq("token_hash", await hashDoToken(token))
      .eq("user_id", userId)
      .maybeSingle();

    if (!data?.expira_em) return false;
    return new Date(data.expira_em).getTime() > Date.now();
  } catch {
    return false;
  }
}

/** Marca esta sessão como verificada e limpa as vencidas. */
export async function liberarSessao(userId: string, token: string): Promise<void> {
  const { db } = await import("./db.server");
  const expira = new Date(Date.now() + HORAS_LIBERADA * 3600_000).toISOString();

  await db("admin_2fa_sessoes").upsert(
    { token_hash: await hashDoToken(token), user_id: userId, expira_em: expira },
    { onConflict: "token_hash" },
  );

  // Limpeza oportunista, para a tabela não crescer sem fim.
  await db("admin_2fa_sessoes").delete().lt("expira_em", new Date().toISOString());
}

/** Tira a liberação desta sessão (usado ao desativar o segundo fator). */
export async function revogarSessoes(userId: string): Promise<void> {
  const { db } = await import("./db.server");
  await db("admin_2fa_sessoes").delete().eq("user_id", userId);
}

/** O token de acesso desta requisição, para amarrar a liberação à sessão. */
export async function tokenDaRequisicao(): Promise<string | null> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const cabecalho = getRequest()?.headers?.get("authorization") ?? "";
    if (!cabecalho.startsWith("Bearer ")) return null;
    return cabecalho.slice("Bearer ".length).trim() || null;
  } catch {
    return null;
  }
}
