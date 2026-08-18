/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Perfil do cliente (nome, telefone, CPF, PIN).
 *
 * REGRA INEGOCIÁVEL: o PIN nunca é gravado em claro.
 * Ele vira um hash scrypt com sal aleatório por cliente. Consequência prática:
 * ninguém — nem o administrador, nem quem tiver o banco em mãos — consegue
 * descobrir o PIN de alguém. Só dá para CONFERIR se um PIN informado bate.
 *
 * scrypt é proposital: ele é lento e consome memória de propósito. Como o PIN
 * tem só 4 a 6 dígitos, um hash rápido (SHA-256) seria quebrado por força bruta
 * em segundos.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { db } from "./db.server";
import { cpfValido, digitos, nomeCompletoValido, pinValido, telefoneValido } from "../cpf";

const SCRYPT_KEYLEN = 64;

function derivar(pin: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pin, salt, SCRYPT_KEYLEN, (erro, chave) => (erro ? reject(erro) : resolve(chave)));
  });
}

/** Gera "salHex:hashHex". O sal é novo a cada PIN gravado. */
export async function gerarHashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const chave = await derivar(digitos(pin), salt);
  return `${salt.toString("hex")}:${chave.toString("hex")}`;
}

/**
 * Confere um PIN contra o hash gravado.
 * Usa timingSafeEqual: comparar com `===` vazaria, pelo tempo de resposta,
 * quantos caracteres iniciais estavam certos.
 */
export async function conferirPin(pin: string, hashGravado: string | null): Promise<boolean> {
  if (!hashGravado) return false;
  const [saltHex, chaveHex] = hashGravado.split(":");
  if (!saltHex || !chaveHex) return false;
  try {
    const esperado = Buffer.from(chaveHex, "hex");
    const calculado = await derivar(digitos(pin), Buffer.from(saltHex, "hex"));
    if (esperado.length !== calculado.length) return false;
    return timingSafeEqual(esperado, calculado);
  } catch {
    return false;
  }
}

export type DadosPerfil = {
  nomeCompleto: string;
  telefone: string;
  cpf: string;
  pin?: string | null;
};

/**
 * Revalida tudo no SERVIDOR antes de gravar.
 *
 * A tela já valida, mas a validação do navegador é só conforto: qualquer um
 * pode chamar a server function direto. A checagem que protege o banco é esta.
 */
export function validarPerfil(dados: DadosPerfil): { ok: true } | { ok: false; erro: string } {
  if (!nomeCompletoValido(dados.nomeCompleto)) {
    return { ok: false, erro: "Informe seu nome completo (nome e sobrenome)." };
  }
  if (!telefoneValido(dados.telefone)) {
    return { ok: false, erro: "Telefone inválido. Use DDD + número, por exemplo (11) 98765-4321." };
  }
  if (!cpfValido(dados.cpf)) {
    return { ok: false, erro: "CPF inválido. Confira os números digitados." };
  }
  if (dados.pin != null && dados.pin !== "") {
    const r = pinValido(dados.pin);
    if (!r.ok) return { ok: false, erro: r.erro };
  }
  return { ok: true };
}

/**
 * Cria ou atualiza o perfil do cliente autenticado.
 *
 * O `userId` vem do middleware de autenticação, NUNCA do navegador — é o que
 * impede alguém de gravar um perfil no lugar de outra pessoa.
 */
export async function salvarPerfil(
  userId: string,
  email: string,
  dados: DadosPerfil,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  const validacao = validarPerfil(dados);
  if (!validacao.ok) return validacao;

  const cpf = digitos(dados.cpf);
  const telefone = digitos(dados.telefone);

  // Um CPF por conta. Verificamos antes para devolver uma mensagem clara em vez
  // do erro cru de índice único do Postgres.
  const { data: existente } = await db("clientes_perfil")
    .select("user_id")
    .eq("cpf", cpf)
    .maybeSingle();
  if (existente && String(existente.user_id) !== String(userId)) {
    return { ok: false, erro: "Já existe uma conta cadastrada com este CPF." };
  }

  const linha: Record<string, unknown> = {
    user_id: userId,
    nome_completo: dados.nomeCompleto.trim().replace(/\s+/g, " "),
    email: (email ?? "").toLowerCase().trim() || null,
    telefone,
    cpf,
  };
  if (dados.pin) linha["pin_hash"] = await gerarHashPin(dados.pin);

  const { error } = await db("clientes_perfil").upsert(linha, { onConflict: "user_id" });
  if (error) {
    if (error.message?.includes("clientes_perfil_cpf_uidx")) {
      return { ok: false, erro: "Já existe uma conta cadastrada com este CPF." };
    }
    return { ok: false, erro: `Não foi possível salvar o cadastro: ${error.message}` };
  }

  return { ok: true };
}

/** Perfil do próprio cliente. Nunca devolve o hash do PIN. */
export async function buscarPerfil(userId: string) {
  const { data } = await db("clientes_perfil")
    .select("user_id, nome_completo, email, telefone, cpf, pin_hash, criado_em, atualizado_em, ultimo_acesso_em")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;

  const { pin_hash, ...seguro } = data as any;
  return { ...seguro, temPin: Boolean(pin_hash) };
}

/** Marca o acesso do cliente. Informativo — nunca derruba a chamada. */
export async function registrarAcesso(userId: string) {
  try {
    await db("clientes_perfil").update({ ultimo_acesso_em: new Date().toISOString() }).eq("user_id", userId);
  } catch {
    /* acesso é métrica, não regra de negócio */
  }
}
