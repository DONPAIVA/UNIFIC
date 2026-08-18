/**
 * CPF, telefone e PIN — validação e formatação.
 *
 * Este arquivo roda nos DOIS lados (navegador e servidor) de propósito: a tela
 * avisa o cliente na hora, e o servidor revalida antes de gravar. A checagem do
 * navegador é conveniência; a que vale é a do servidor, porque qualquer um pode
 * burlar a do navegador.
 */

/** Deixa só os dígitos. */
export function digitos(valor: string): string {
  return String(valor ?? "").replace(/\D+/g, "");
}

/**
 * Valida CPF pelo dígito verificador (o algoritmo oficial da Receita).
 *
 * Não basta ter 11 números: "111.111.111-11" tem 11 dígitos e é inválido.
 * Por isso a sequência repetida é rejeitada explicitamente — ela passaria no
 * cálculo do dígito, mas não é um CPF real.
 */
export function cpfValido(valor: string): boolean {
  const cpf = digitos(valor);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calcularDigito = (ate: number): number => {
    let soma = 0;
    for (let i = 0; i < ate; i++) {
      soma += Number(cpf[i]) * (ate + 1 - i);
    }
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return calcularDigito(9) === Number(cpf[9]) && calcularDigito(10) === Number(cpf[10]);
}

/** 12345678909 -> 123.456.789-09 */
export function formatarCpf(valor: string): string {
  const cpf = digitos(valor).slice(0, 11);
  if (cpf.length <= 3) return cpf;
  if (cpf.length <= 6) return `${cpf.slice(0, 3)}.${cpf.slice(3)}`;
  if (cpf.length <= 9) return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6)}`;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

/**
 * CPF mascarado para telas administrativas: 123.***.**9-09
 *
 * Mostra o suficiente para o atendente conferir com o cliente ao telefone,
 * sem expor o número inteiro em lista — que é o que a LGPD pede evitar.
 */
export function mascararCpf(valor: string): string {
  const cpf = digitos(valor);
  if (cpf.length !== 11) return "—";
  return `${cpf.slice(0, 3)}.***.**${cpf.slice(8, 9)}-${cpf.slice(9)}`;
}

/** Telefone brasileiro: 10 dígitos (fixo) ou 11 (celular), com DDD. */
export function telefoneValido(valor: string): boolean {
  const tel = digitos(valor);
  if (tel.length < 10 || tel.length > 11) return false;
  const ddd = Number(tel.slice(0, 2));
  if (ddd < 11 || ddd > 99) return false;
  // Celular tem 11 dígitos e o nono sempre começa com 9.
  if (tel.length === 11 && tel[2] !== "9") return false;
  return true;
}

/** 11987654321 -> (11) 98765-4321 */
export function formatarTelefone(valor: string): string {
  const tel = digitos(valor).slice(0, 11);
  if (tel.length <= 2) return tel;
  if (tel.length <= 6) return `(${tel.slice(0, 2)}) ${tel.slice(2)}`;
  if (tel.length <= 10) return `(${tel.slice(0, 2)}) ${tel.slice(2, 6)}-${tel.slice(6)}`;
  return `(${tel.slice(0, 2)}) ${tel.slice(2, 7)}-${tel.slice(7)}`;
}

export const PIN_MIN = 4;
export const PIN_MAX = 6;

/**
 * PIN de 4 a 6 dígitos, recusando os previsíveis.
 *
 * `1111` e `1234` estão entre os primeiros palpites de qualquer tentativa de
 * adivinhação. Como o PIN é curto por natureza, barrar esses casos é o mínimo
 * para ele valer alguma coisa.
 */
export function pinValido(valor: string): { ok: true } | { ok: false; erro: string } {
  const pin = digitos(valor);
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) {
    return { ok: false, erro: `O PIN precisa ter de ${PIN_MIN} a ${PIN_MAX} números.` };
  }
  if (/^(\d)\1+$/.test(pin)) {
    return { ok: false, erro: "Escolha um PIN que não seja o mesmo número repetido." };
  }
  const crescente = "0123456789";
  const decrescente = "9876543210";
  if (crescente.includes(pin) || decrescente.includes(pin)) {
    return { ok: false, erro: "Escolha um PIN que não seja uma sequência (1234, 4321...)." };
  }
  return { ok: true };
}

/** Nome com pelo menos duas palavras — evita cadastro só com o primeiro nome. */
export function nomeCompletoValido(valor: string): boolean {
  const partes = String(valor ?? "")
    .trim()
    .split(/\s+/)
    .filter((p) => p.length >= 2);
  return partes.length >= 2;
}
