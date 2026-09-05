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
const CHAVE_ESTILO = "unific:estilo-da-abertura";

export type EstiloAbertura = "padrao" | "jarvis";

export function estiloDaAbertura(): EstiloAbertura {
  try {
    return localStorage.getItem(CHAVE_ESTILO) === "jarvis" ? "jarvis" : "padrao";
  } catch {
    return "padrao";
  }
}

export function definirEstiloDaAbertura(e: EstiloAbertura) {
  try {
    localStorage.setItem(CHAVE_ESTILO, e);
  } catch {
    /* aba anônima: vale só nesta sessão */
  }
}

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

  const brasileiras = vozes.filter((v) => /pt[-_]BR/i.test(v.lang));
  const portuguesas = vozes.filter((v) => /^pt/i.test(v.lang));
  const candidatas = brasileiras.length ? brasileiras : portuguesas;
  if (!candidatas.length) return null;

  /*
   * No modo JARVIS, voz masculina.
   *
   * A API não diz o gênero da voz, então vai pelo nome — os aparelhos
   * brasileiros trazem quase sempre Daniel (masculina) e Maria (feminina).
   * Não achando nenhuma conhecida, fica a primeira, que ainda funciona.
   */
  if (estiloDaAbertura() === "jarvis") {
    const masculina = candidatas.find((v) => /daniel|ricardo|felipe|male|homem/i.test(v.name));
    if (masculina) return masculina;
  }
  return candidatas[0] ?? null;
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
      /*
       * No modo JARVIS, mais grave e mais pausado ainda.
       *
       * Descer o tom além disso passa a soar rasgado — o sintetizador do
       * navegador estica demais a voz e aparece um chiado metálico.
       */
      const jarvis = estiloDaAbertura() === "jarvis";
      fala.rate = jarvis ? 0.86 : 0.92;
      fala.pitch = jarvis ? 0.62 : 0.85;
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
/**
 * Varredura de energia: um tom que sobe e abre o filtro, como um sistema
 * ligando. É o som que dá a sensação de "acordando" antes da voz.
 */
function varredura(inicio: number, dur: number) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + inicio;

  const osc = ac.createOscillator();
  const filtro = ac.createBiquadFilter();
  const g = ac.createGain();

  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(60, t0);
  osc.frequency.exponentialRampToValueAtTime(420, t0 + dur);

  filtro.type = "lowpass";
  filtro.frequency.setValueAtTime(200, t0);
  filtro.frequency.exponentialRampToValueAtTime(3200, t0 + dur);
  filtro.Q.value = 8;

  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.05, t0 + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(filtro).connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/**
 * Zumbido baixo que fica por baixo da fala, como um reator ligado.
 *
 * Devolve a função que o desliga: sem ela o zumbido ficaria tocando para
 * sempre, porque não tem duração definida.
 */
function zumbido(): () => void {
  const ac = audio();
  if (!ac) return () => {};
  const t0 = ac.currentTime;

  const grave = ac.createOscillator();
  const quinta = ac.createOscillator();
  const g = ac.createGain();

  grave.type = "sine";
  grave.frequency.value = 55;
  quinta.type = "sine";
  // Levemente desafinada de propósito: o batimento entre as duas cria o
  // "vivo" do zumbido. Afinadas, soaria como um bipe parado.
  quinta.frequency.value = 82.9;

  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.022, t0 + 0.6);

  grave.connect(g);
  quinta.connect(g);
  g.connect(ac.destination);
  grave.start(t0);
  quinta.start(t0);

  return () => {
    const fim = ac.currentTime;
    g.gain.cancelScheduledValues(fim);
    g.gain.setValueAtTime(g.gain.value, fim);
    g.gain.exponentialRampToValueAtTime(0.0001, fim + 0.9);
    grave.stop(fim + 1);
    quinta.stop(fim + 1);
  };
}

export function aberturaDoPainel(nome?: string | null, estilo?: EstiloAbertura) {
  if (!vozLigada()) return;

  const quem = (nome ?? nomeDaSaudacao()).trim();
  const modo = estilo ?? estiloDaAbertura();

  if (modo === "jarvis") {
    /*
     * Não é a voz do filme — nenhum navegador tem aquela voz, e não há como
     * instalá-la. O que dá para reproduzir é o entorno: a varredura de
     * energia, os blips de leitura e o zumbido sob a fala. É de onde vem a
     * maior parte da sensação; a voz sozinha nunca soaria assim.
     */
    varredura(0, 1.1);
    tone(1318.51, 0.75, 0.06, 0.03); // blips de leitura
    tone(1567.98, 0.88, 0.06, 0.03);
    tone(1975.53, 1.0, 0.08, 0.035);

    const desligar = zumbido();
    const frase = quem
      ? `Bem-vindo de volta, ${quem}. Todos os sistemas operacionais. Central Olho de Deus à sua disposição.`
      : "Todos os sistemas operacionais. Central Olho de Deus à sua disposição.";

    setTimeout(() => {
      const falou = falar(frase, () => {
        tone(880, 0, 0.1, 0.03);
        desligar();
      });
      // Sem voz disponível, o zumbido não pode ficar tocando sozinho.
      if (!falou) setTimeout(desligar, 400);
    }, 1250);
    return;
  }

  // Três notas graves em sequência, subindo.
  tone(110, 0, 0.5, 0.05);
  tone(164.81, 0.18, 0.5, 0.045);
  tone(220, 0.36, 0.7, 0.04);

  const saudacao = quem
    ? `Olá ${quem}. Bem-vindo à central Olho de Deus.`
    : "Bem-vindo à central Olho de Deus.";

  setTimeout(() => falar(saudacao), 900);
}
