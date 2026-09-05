/** Sons curtos e satisfatórios para os botões mais importantes (WebAudio, sem arquivos). */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx ??= new AC();
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function tone(freq: number, start: number, dur: number, gain = 0.07) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, ac.currentTime + start);
  g.gain.exponentialRampToValueAtTime(gain, ac.currentTime + start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(ac.currentTime + start);
  osc.stop(ac.currentTime + start + dur + 0.02);
}

export function playClick() {
  tone(660, 0, 0.09, 0.05);
}

export function playSuccess() {
  tone(523.25, 0, 0.12);
  tone(659.25, 0.09, 0.12);
  tone(783.99, 0.18, 0.2);
}

export function playError() {
  tone(220, 0, 0.18, 0.06);
  tone(165, 0.14, 0.22, 0.06);
}

/* -------------------------------------------------------------------------- */
/* Abertura falada do painel                                                   */
/* -------------------------------------------------------------------------- */

/** Onde ficam as escolhas da abertura falada. */
const CHAVE_VOZ = "unific:voz-do-painel";
const CHAVE_NOME = "unific:nome-na-saudacao";

/**
 * Como você quer ser chamado na abertura.
 *
 * Guardado à parte porque o e-mail não serve: "paraiausopessoal@gmail.com"
 * viraria "Paraiausopessoal", e ninguém quer ser recebido assim.
 */
export function nomeDaSaudacao(): string {
  try {
    return localStorage.getItem(CHAVE_NOME) ?? "Don";
  } catch {
    return "Don";
  }
}

export function definirNomeDaSaudacao(nome: string) {
  try {
    localStorage.setItem(CHAVE_NOME, nome.trim().slice(0, 40));
  } catch {
    /* aba anônima: vale só nesta sessão */
  }
}

export function vozLigada(): boolean {
  try {
    // Ligada por padrão: só fica muda se você desligar.
    return localStorage.getItem(CHAVE_VOZ) !== "0";
  } catch {
    return false;
  }
}

export function definirVoz(ligada: boolean) {
  try {
    localStorage.setItem(CHAVE_VOZ, ligada ? "1" : "0");
  } catch {
    /* aba anônima: a escolha vale só enquanto a página estiver aberta */
  }
}

/**
 * Escolhe a melhor voz em português disponível no aparelho.
 *
 * A lista de vozes chega de forma assíncrona no Chrome — na primeira chamada
 * costuma vir vazia. Por isso quem chama espera o evento `voiceschanged`.
 * Preferimos pt-BR; sem ela, qualquer português; sem nenhuma, deixamos o
 * navegador escolher, que ainda é melhor do que não falar.
 */
function melhorVoz(): SpeechSynthesisVoice | null {
  const vozes = window.speechSynthesis?.getVoices?.() ?? [];
  if (!vozes.length) return null;
  return (
    vozes.find((v) => /pt[-_]BR/i.test(v.lang)) ??
    vozes.find((v) => /^pt/i.test(v.lang)) ??
    null
  );
}

/**
 * Fala um texto em português.
 *
 * Devolve `false` quando não deu para falar — navegador sem suporte, voz
 * desligada, ou som ainda bloqueado. Nunca lança: um painel não pode quebrar
 * porque o alto-falante não colaborou.
 */
export function falar(texto: string, aoTerminar?: () => void): boolean {
  try {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
    if (!vozLigada()) return false;

    const dizer = () => {
      const fala = new SpeechSynthesisUtterance(texto);
      const voz = melhorVoz();
      if (voz) fala.voice = voz;
      fala.lang = voz?.lang ?? "pt-BR";
      // Um pouco mais devagar e mais grave: dá peso à frase.
      fala.rate = 0.92;
      fala.pitch = 0.85;
      fala.volume = 1;
      if (aoTerminar) fala.onend = aoTerminar;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(fala);
    };

    if (melhorVoz()) {
      dizer();
    } else {
      // Vozes ainda não carregadas: fala assim que a lista chegar.
      window.speechSynthesis.addEventListener("voiceschanged", dizer, { once: true });
      // E tenta de novo em seguida, porque parte dos navegadores nunca dispara
      // aquele evento quando as vozes já estavam prontas.
      setTimeout(dizer, 250);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Abertura do painel: um acorde grave subindo, e então a saudação.
 *
 * O acorde vem antes de propósito — dá o instante de silêncio que faz a voz
 * soar como anúncio, em vez de um alerta seco do sistema.
 */
export function aberturaDoPainel(nome?: string | null) {
  if (!vozLigada()) return;

  // Três notas graves em sequência, subindo.
  tone(110, 0, 0.5, 0.05);
  tone(164.81, 0.18, 0.5, 0.045);
  tone(220, 0.36, 0.7, 0.04);

  const quem = (nome ?? nomeDaSaudacao()).trim();
  const saudacao = quem
    ? `Olá ${quem}. Bem-vindo à central Olho de Deus.`
    : "Bem-vindo à central Olho de Deus.";

  // Espera o acorde terminar antes de falar.
  setTimeout(() => falar(saudacao), 900);
}
