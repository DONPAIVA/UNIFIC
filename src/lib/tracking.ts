export const DELIVERY_DAYS = 15;

import { cidadesNoCaminho } from "./cidades";

export type Pedido = {
  id: string;
  tracking_code: string;
  marketplace: string;
  sender: string;
  recipient: string;
  dest_address: string | null;
  dest_city: string;
  dest_state: string;
  dest_cep: string | null;
  origin_city: string;
  origin_state: string;
  status: string;
  ship_date: string;
  delivery_date: string | null;
  cpf: string | null;
  product: string | null;
  product_value: number | null;
  weight: number | null;
  invoice_number: string | null;
  invoice_series: string | null;
  notes: string | null;
  /** Porcentagem definida à mão (0-100). Nulo = calcula pelas datas. */
  progresso_manual?: number | null;
  /** Caminhão congelado no mapa. Nada é mostrado ao cliente sobre a pausa. */
  pausado?: boolean | null;
  /** Hora da coleta (HH:MM). Nulo = calcula sozinho pelo código. */
  hora_coleta?: string | null;
  /** Data/hora ajustada à mão por evento: {"0": "2026-09-03T17:50"}. */
  eventos_ajustes?: Record<string, string> | null;
  /**
   * Autorização do Mercado Livre escolhida para ESTE pedido.
   * Nulo = segue o botão "Rastreio livre"; "exigir" = sempre pede;
   * "livre" = nunca pede.
   */
  autorizacao_ml?: ModoAutorizacaoMl | null;
  created_at: string;
  updated_at?: string;
};

export type ModoAutorizacaoMl = "exigir" | "livre";

/**
 * Este pedido manda a pessoa autorizar o Mercado Livre antes de abrir?
 *
 * A escolha do pedido ganha do botão geral: assim dá para cobrar a
 * autorização de um cliente só sem desligar o rastreio livre de todos — ou
 * deixar alguns livres com ele desligado. Sem escolha, vale o botão geral.
 */
export function pedeAutorizacaoMl(p: Pick<Pedido, "autorizacao_ml">, rastreioLivre: boolean): boolean {
  if (p.autorizacao_ml === "exigir") return true;
  if (p.autorizacao_ml === "livre") return false;
  return !rastreioLivre;
}

export const STATE_COORDS: Record<string, [number, number]> = {
  AC: [-9.97, -67.81], AL: [-9.65, -35.73], AP: [0.03, -51.06], AM: [-3.11, -60.02],
  BA: [-12.97, -38.51], CE: [-3.73, -38.52], DF: [-15.79, -47.88], ES: [-20.32, -40.34],
  GO: [-16.68, -49.25], MA: [-2.53, -44.3], MT: [-15.6, -56.1], MS: [-20.44, -54.65],
  MG: [-19.92, -43.94], PA: [-1.45, -48.5], PB: [-7.12, -34.86], PR: [-25.43, -49.27],
  PE: [-8.05, -34.9], PI: [-5.09, -42.8], RJ: [-22.91, -43.17], RN: [-5.79, -35.21],
  RS: [-30.03, -51.23], RO: [-8.76, -63.9], RR: [2.82, -60.67], SC: [-27.6, -48.55],
  SP: [-23.55, -46.63], SE: [-10.91, -37.07], TO: [-10.18, -48.33],
};

/**
 * Coordenadas reais das principais cidades brasileiras.
 * Chave: NOME-UF sem acento, em maiúsculas.
 * Antes, o mapa usava só a capital do estado + um deslocamento aleatório —
 * por isso Uberlândia aparecia sobre Belo Horizonte.
 */
export const CITY_COORDS: Record<string, [number, number]> = {
  // Minas Gerais
  "BELO HORIZONTE-MG": [-19.92, -43.94], "UBERLANDIA-MG": [-18.91, -48.28],
  "CONTAGEM-MG": [-19.93, -44.05], "JUIZ DE FORA-MG": [-21.76, -43.35],
  "BETIM-MG": [-19.97, -44.2], "MONTES CLAROS-MG": [-16.73, -43.86],
  "RIBEIRAO DAS NEVES-MG": [-19.77, -44.09], "UBERABA-MG": [-19.75, -47.93],
  "GOVERNADOR VALADARES-MG": [-18.85, -41.95], "IPATINGA-MG": [-19.47, -42.54],
  "SETE LAGOAS-MG": [-19.46, -44.25], "DIVINOPOLIS-MG": [-20.14, -44.89],
  "SANTA LUZIA-MG": [-19.77, -43.85], "IBIRITE-MG": [-20.02, -44.06],
  "POCOS DE CALDAS-MG": [-21.79, -46.56], "PATOS DE MINAS-MG": [-18.58, -46.52],
  "TEOFILO OTONI-MG": [-17.86, -41.51], "BARBACENA-MG": [-21.23, -43.77],
  "SABARA-MG": [-19.89, -43.81], "VARGINHA-MG": [-21.55, -45.43],
  "ARAGUARI-MG": [-18.65, -48.19], "ITABIRA-MG": [-19.62, -43.23],
  "PASSOS-MG": [-20.72, -46.61], "CORONEL FABRICIANO-MG": [-19.52, -42.63],
  "MURIAE-MG": [-21.13, -42.37], "ARAXA-MG": [-19.59, -46.94],
  "LAVRAS-MG": [-21.25, -44.99], "ITAJUBA-MG": [-22.42, -45.45],
  "POUSO ALEGRE-MG": [-22.23, -45.94], "NOVA LIMA-MG": [-19.99, -43.85],
  "CATAGUASES-MG": [-21.39, -42.7], "SAO JOAO DEL REI-MG": [-21.14, -44.26],
  "UNAI-MG": [-16.36, -46.91], "PARACATU-MG": [-17.22, -46.87],
  "CURVELO-MG": [-18.76, -44.43], "ALFENAS-MG": [-21.43, -45.95],

  // São Paulo
  "SAO PAULO-SP": [-23.55, -46.63], "GUARULHOS-SP": [-23.46, -46.53],
  "CAMPINAS-SP": [-22.91, -47.06], "SAO BERNARDO DO CAMPO-SP": [-23.69, -46.56],
  "SANTO ANDRE-SP": [-23.66, -46.53], "OSASCO-SP": [-23.53, -46.79],
  "RIBEIRAO PRETO-SP": [-21.18, -47.81], "SOROCABA-SP": [-23.5, -47.46],
  "SAO JOSE DOS CAMPOS-SP": [-23.18, -45.89], "SANTOS-SP": [-23.96, -46.33],
  "MAUA-SP": [-23.67, -46.46], "SAO JOSE DO RIO PRETO-SP": [-20.81, -49.38],
  "MOGI DAS CRUZES-SP": [-23.52, -46.19], "DIADEMA-SP": [-23.69, -46.62],
  "JUNDIAI-SP": [-23.19, -46.88], "PIRACICABA-SP": [-22.72, -47.65],
  "CARAPICUIBA-SP": [-23.52, -46.84], "BAURU-SP": [-22.31, -49.06],
  "ITAQUAQUECETUBA-SP": [-23.48, -46.35], "SAO VICENTE-SP": [-23.96, -46.39],
  "FRANCA-SP": [-20.54, -47.4], "PRAIA GRANDE-SP": [-24.0, -46.41],
  "GUARUJA-SP": [-23.99, -46.26], "TAUBATE-SP": [-23.03, -45.56],
  "LIMEIRA-SP": [-22.56, -47.4], "SUZANO-SP": [-23.54, -46.31],
  "TABOAO DA SERRA-SP": [-23.62, -46.79], "SUMARE-SP": [-22.82, -47.27],
  "BARUERI-SP": [-23.51, -46.88], "EMBU DAS ARTES-SP": [-23.65, -46.85],
  "SAO CARLOS-SP": [-22.02, -47.89], "MARILIA-SP": [-22.21, -49.95],
  "INDAIATUBA-SP": [-23.09, -47.22], "COTIA-SP": [-23.6, -46.92],
  "AMERICANA-SP": [-22.74, -47.33], "JACAREI-SP": [-23.31, -45.97],
  "ARARAQUARA-SP": [-21.79, -48.18], "PRESIDENTE PRUDENTE-SP": [-22.13, -51.39],
  "HORTOLANDIA-SP": [-22.86, -47.22], "RIO CLARO-SP": [-22.41, -47.56],
  "ITAPEVI-SP": [-23.55, -46.93], "SAO JOSE DOS PINHAIS-SP": [-23.5, -46.6],
  "ARARAS-SP": [-22.36, -47.38], "BOTUCATU-SP": [-22.89, -48.44],
  "ATIBAIA-SP": [-23.12, -46.55], "BRAGANCA PAULISTA-SP": [-22.95, -46.54],
  "CATANDUVA-SP": [-21.14, -48.98], "SANTA BARBARA D OESTE-SP": [-22.75, -47.41],

  // Rio de Janeiro
  "RIO DE JANEIRO-RJ": [-22.91, -43.17], "SAO GONCALO-RJ": [-22.83, -43.05],
  "DUQUE DE CAXIAS-RJ": [-22.79, -43.31], "NOVA IGUACU-RJ": [-22.76, -43.45],
  "NITEROI-RJ": [-22.88, -43.1], "BELFORD ROXO-RJ": [-22.76, -43.4],
  "CAMPOS DOS GOYTACAZES-RJ": [-21.75, -41.33], "SAO JOAO DE MERITI-RJ": [-22.8, -43.37],
  "PETROPOLIS-RJ": [-22.51, -43.18], "VOLTA REDONDA-RJ": [-22.52, -44.1],
  "MAGE-RJ": [-22.66, -43.04], "MACAE-RJ": [-22.37, -41.79],
  "ITABORAI-RJ": [-22.75, -42.86], "CABO FRIO-RJ": [-22.88, -42.03],
  "ANGRA DOS REIS-RJ": [-23.01, -44.32], "NOVA FRIBURGO-RJ": [-22.28, -42.53],
  "BARRA MANSA-RJ": [-22.54, -44.17], "TERESOPOLIS-RJ": [-22.41, -42.97],
  "RESENDE-RJ": [-22.47, -44.45], "ARARUAMA-RJ": [-22.87, -42.34],

  // Sul
  "CURITIBA-PR": [-25.43, -49.27], "LONDRINA-PR": [-23.31, -51.16],
  "MARINGA-PR": [-23.42, -51.94], "PONTA GROSSA-PR": [-25.09, -50.16],
  "CASCAVEL-PR": [-24.96, -53.46], "FOZ DO IGUACU-PR": [-25.54, -54.59],
  "COLOMBO-PR": [-25.29, -49.22], "GUARAPUAVA-PR": [-25.39, -51.46],
  "PARANAGUA-PR": [-25.52, -48.51], "APUCARANA-PR": [-23.55, -51.46],
  "PORTO ALEGRE-RS": [-30.03, -51.23], "CAXIAS DO SUL-RS": [-29.17, -51.18],
  "PELOTAS-RS": [-31.77, -52.34], "CANOAS-RS": [-29.92, -51.18],
  "SANTA MARIA-RS": [-29.68, -53.81], "GRAVATAI-RS": [-29.94, -50.99],
  "NOVO HAMBURGO-RS": [-29.68, -51.13], "SAO LEOPOLDO-RS": [-29.76, -51.15],
  "RIO GRANDE-RS": [-32.03, -52.1], "PASSO FUNDO-RS": [-28.26, -52.41],
  "FLORIANOPOLIS-SC": [-27.6, -48.55], "JOINVILLE-SC": [-26.3, -48.85],
  "BLUMENAU-SC": [-26.92, -49.07], "SAO JOSE-SC": [-27.61, -48.63],
  "CRICIUMA-SC": [-28.68, -49.37], "CHAPECO-SC": [-27.1, -52.62],
  "ITAJAI-SC": [-26.91, -48.66], "LAGES-SC": [-27.82, -50.33],
  "BALNEARIO CAMBORIU-SC": [-26.99, -48.63], "JARAGUA DO SUL-SC": [-26.49, -49.07],

  // Centro-Oeste
  "BRASILIA-DF": [-15.79, -47.88], "GOIANIA-GO": [-16.68, -49.25],
  "APARECIDA DE GOIANIA-GO": [-16.82, -49.24], "ANAPOLIS-GO": [-16.33, -48.95],
  "RIO VERDE-GO": [-17.79, -50.93], "LUZIANIA-GO": [-16.25, -47.95],
  "CAMPO GRANDE-MS": [-20.44, -54.65], "DOURADOS-MS": [-22.22, -54.81],
  "TRES LAGOAS-MS": [-20.79, -51.7], "CUIABA-MT": [-15.6, -56.1],
  "VARZEA GRANDE-MT": [-15.65, -56.13], "RONDONOPOLIS-MT": [-16.47, -54.64],
  "SINOP-MT": [-11.86, -55.5],

  // Nordeste
  "SALVADOR-BA": [-12.97, -38.51], "FEIRA DE SANTANA-BA": [-12.27, -38.97],
  "VITORIA DA CONQUISTA-BA": [-14.87, -40.84], "CAMACARI-BA": [-12.7, -38.32],
  "ITABUNA-BA": [-14.79, -39.28], "JUAZEIRO-BA": [-9.42, -40.5],
  "ILHEUS-BA": [-14.79, -39.05], "LAURO DE FREITAS-BA": [-12.89, -38.32],
  "BARREIRAS-BA": [-12.15, -44.99], "RECIFE-PE": [-8.05, -34.9],
  "JABOATAO DOS GUARARAPES-PE": [-8.11, -35.01], "OLINDA-PE": [-8.01, -34.86],
  "CARUARU-PE": [-8.28, -35.97], "PETROLINA-PE": [-9.39, -40.5],
  "PAULISTA-PE": [-7.94, -34.87], "FORTALEZA-CE": [-3.73, -38.52],
  "CAUCAIA-CE": [-3.74, -38.65], "JUAZEIRO DO NORTE-CE": [-7.21, -39.32],
  "MARACANAU-CE": [-3.87, -38.63], "SOBRAL-CE": [-3.69, -40.35],
  "SAO LUIS-MA": [-2.53, -44.3], "IMPERATRIZ-MA": [-5.53, -47.48],
  "NATAL-RN": [-5.79, -35.21], "MOSSORO-RN": [-5.19, -37.34],
  "PARNAMIRIM-RN": [-5.92, -35.26], "JOAO PESSOA-PB": [-7.12, -34.86],
  "CAMPINA GRANDE-PB": [-7.22, -35.88], "MACEIO-AL": [-9.65, -35.73],
  "ARAPIRACA-AL": [-9.75, -36.66], "ARACAJU-SE": [-10.91, -37.07],
  "NOSSA SENHORA DO SOCORRO-SE": [-10.85, -37.06], "TERESINA-PI": [-5.09, -42.8],
  "PARNAIBA-PI": [-2.9, -41.78],

  // Norte e Espírito Santo
  "MANAUS-AM": [-3.11, -60.02], "BELEM-PA": [-1.45, -48.5],
  "ANANINDEUA-PA": [-1.37, -48.37], "SANTAREM-PA": [-2.44, -54.71],
  "MARABA-PA": [-5.37, -49.12], "PORTO VELHO-RO": [-8.76, -63.9],
  "JI-PARANA-RO": [-10.88, -61.95], "RIO BRANCO-AC": [-9.97, -67.81],
  "MACAPA-AP": [0.03, -51.06], "BOA VISTA-RR": [2.82, -60.67],
  "PALMAS-TO": [-10.18, -48.33], "ARAGUAINA-TO": [-7.19, -48.21],
  "VITORIA-ES": [-20.32, -40.34], "VILA VELHA-ES": [-20.33, -40.29],
  "SERRA-ES": [-20.13, -40.31], "CARIACICA-ES": [-20.26, -40.42],
  "CACHOEIRO DE ITAPEMIRIM-ES": [-20.85, -41.11], "LINHARES-ES": [-19.39, -40.07],
  "COLATINA-ES": [-19.54, -40.63], "SAO MATEUS-ES": [-18.72, -39.86],
};

/** Normaliza "Uberlândia" + "MG" -> "UBERLANDIA-MG" */
function cityKey(state: string, city: string): string {
  const uf = (state ?? "").trim().toUpperCase();
  const name = (city ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['´`^~]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
  return `${name}-${uf}`;
}

/**
 * Coordenada da cidade. Posição real quando a cidade é conhecida; senão, o
 * centro do estado — SEM deslocamento.
 *
 * Havia aqui um deslocamento pseudoaleatório de até ±0,8 grau (uns 88 km)
 * aplicado sobre a capital quando a cidade não estava na lista. A intenção era
 * evitar que cidades diferentes caíssem no mesmo ponto, mas o efeito era pior:
 * o mapa mostrava um pino de aparência precisa num lugar onde a encomenda não
 * está. Matozinhos/MG, por exemplo, ia parar ao SUL de Belo Horizonte, quando
 * a cidade fica ao norte.
 *
 * Centro do estado é impreciso e se parece com o que é. Um ponto deslocado ao
 * acaso é impreciso disfarçado de exato — e é isso que engana quem olha.
 * Quem precisa da posição certa deve usar `useCityCoords` (src/lib/geo.ts),
 * que consulta a coordenada real da cidade.
 */
export function coordsFor(state: string, city: string): [number, number] {
  const exact = CITY_COORDS[cityKey(state, city)];
  if (exact) return exact;
  return STATE_COORDS[state?.toUpperCase()] ?? STATE_COORDS["SP"]!;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = (h ^ s.charCodeAt(i)) * 16777619;
  return Math.abs(h);
}

function rand(seed: number) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

/**
 * Só a parte da data (AAAA-MM-DD) de um campo do banco.
 *
 * As colunas de data desta tabela vêm em dois formatos: umas como data pura
 * ("2026-09-09") e outras como instante completo ("2026-09-09T00:00:00+00:00").
 * O código antigo colava a hora no fim do texto — e, quando o valor já trazia
 * hora, o resultado virava "2026-09-09T00:00:00+00:00T18:00:00", uma data
 * INVÁLIDA. A partir dali o progresso dava 0%, o status calculado voltava para
 * "Aguardando postagem" e a entrega prevista sumia da tela, escondendo o que
 * havia sido salvo.
 */
function soData(valor: string): string {
  return String(valor).trim().slice(0, 10);
}

export function shipDateTime(p: Pedido) {
  const d = new Date(`${soData(p.ship_date)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return new Date();

  // Hora escolhida à mão para este pedido, quando existe.
  const escolhida = String(p.hora_coleta ?? "").match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (escolhida) {
    d.setHours(Number(escolhida[1]), Number(escolhida[2]), 0, 0);
    return d;
  }

  /*
   * Sem hora definida, ela é derivada do código — sempre a mesma para o mesmo
   * rastreio, entre 8h e 13h.
   *
   * O `% 60` dos minutos vinha SEM valor absoluto, e `>>` trabalha em 32 bits:
   * hash grande estoura para negativo e o resto também sai negativo. O efeito
   * era a hora andar para TRÁS — o pedido 37543BR virava 07:51, fora da faixa
   * de 8h a 13h que este cálculo promete.
   */
  const h = hash(p.tracking_code);
  d.setHours(8 + (h % 6), Math.abs(h >> 4) % 60, 0, 0);
  return d;
}

export function expectedDate(p: Pedido) {
  if (p.delivery_date) {
    const d = new Date(`${soData(p.delivery_date)}T18:00:00`);
    // Data ilegível não pode derrubar a tela: cai no prazo padrão.
    if (!Number.isNaN(d.getTime())) return d;
  }
  const d = shipDateTime(p);
  d.setDate(d.getDate() + DELIVERY_DAYS);
  d.setHours(18, 0, 0, 0);
  return d;
}

/** Janela diária de operação: caminhão roda das 6h às 23h, para durante a madrugada */
export const WORK_START_HOUR = 6;
export const WORK_END_HOUR = 23;

/** Milissegundos "em rodagem" entre dois instantes, ignorando a madrugada */
export function activeMsBetween(from: number, to: number) {
  if (to <= from) return 0;
  let total = 0;
  const day = new Date(from);
  day.setHours(0, 0, 0, 0);
  for (let i = 0; i < 400; i++) {
    const dayStart = new Date(day);
    dayStart.setDate(dayStart.getDate() + i);
    if (dayStart.getTime() > to) break;
    const winStart = new Date(dayStart);
    winStart.setHours(WORK_START_HOUR, 0, 0, 0);
    const winEnd = new Date(dayStart);
    winEnd.setHours(WORK_END_HOUR, 0, 0, 0);
    const s = Math.max(winStart.getTime(), from);
    const e = Math.min(winEnd.getTime(), to);
    if (e > s) total += e - s;
  }
  return total;
}

/** O caminhão está rodando agora? (falso na madrugada e após a entrega) */
export function isMoving(p: Pedido, now = Date.now()) {
  // Pausado congela o caminhão: ele para de balançar no mapa e o painel deixa
  // de anunciar movimento. Para quem acompanha não aparece aviso nenhum de
  // pausa — o objeto simplesmente não se mexe, como numa parada qualquer.
  if (p.pausado) return false;

  const h = new Date(now).getHours();
  const pr = progressOf(p, now);
  return h >= WORK_START_HOUR && h < WORK_END_HOUR && pr > 0 && pr < 100 && !isDelivered(p);
}

/**
 * Porcentagem definida à mão, quando existe.
 *
 * Devolve `null` sempre que o pedido não tem valor manual — e é por isso que
 * a checagem não pode ser `if (p.progresso_manual)`: zero é um ajuste legítimo
 * ("ainda não saiu") e aquela forma o trataria como ausente.
 */
export function manualProgress(p: Pedido): number | null {
  // O valor chega como texto vindo do formulário e como número vindo do banco,
  // por isso a conversão antes de decidir — `Number("")` daria 0, que é um
  // ajuste válido e faria "sem valor" virar "parado na origem".
  const v = p.progresso_manual as number | string | null | undefined;
  if (v === null || v === undefined || String(v).trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

/**
 * Progresso em tempo real (0-100) contando apenas as horas de operação.
 *
 * O valor manual, quando existe, manda em tudo: é o ponto do ajuste. Como o
 * caminhão do mapa, o texto de tempo restante e o rótulo de status saem todos
 * daqui, mexer na porcentagem move os três juntos.
 */
export function progressOf(p: Pedido, now = Date.now()) {
  const manual = manualProgress(p);
  if (manual !== null) return manual;

  /*
   * A mesma régua do histórico.
   *
   * Sem isto, o pedido pausado tinha o caminhão sem balançar mas ainda
   * DESLIZANDO pelo mapa, porque a posição vinha do relógio. Parado de
   * verdade é parado nas duas coisas.
   */
  const regua = reguaDoTempo(p, now);

  const start = shipDateTime(p).getTime();
  const end = expectedDate(p).getTime();
  if (regua <= start) return 0;
  if (regua >= end || isDelivered(p)) return 100;
  const totalActive = activeMsBetween(start, end);
  if (totalActive <= 0) return 0;
  return Math.min(99.9, (activeMsBetween(start, regua) / totalActive) * 100);
}

/** Tempo restante estimado até a entrega, em texto dinâmico */
export function etaText(p: Pedido, now = Date.now()) {
  if (isDelivered(p)) return "Entrega concluída";
  const end = expectedDate(p).getTime();
  // Pausado também para a contagem: um tempo restante caindo ao lado de um
  // caminhão imóvel e de um histórico congelado entregaria a incoerência.
  const diff = end - reguaDoTempo(p, now);
  if (diff <= 0) return "Chegando hoje";
  const dias = Math.floor(diff / 86400000);
  const horas = Math.floor((diff % 86400000) / 3600000);
  const min = Math.floor((diff % 3600000) / 60000);
  if (dias > 0) return `${dias} dia${dias > 1 ? "s" : ""} e ${horas}h restantes`;
  if (horas > 0) return `${horas}h ${min}min restantes`;
  return `${min}min restantes`;
}


export function isDelivered(p: Pedido) {
  return /entregue/i.test(p.status);
}

export type Movimento = { at: Date; title: string; place: string; done: boolean };

/**
 * Paradas do trajeto entre a origem e o destino DESTE pedido.
 *
 * Antes era uma lista fixa no código — sempre Campinas, Ribeirão Preto,
 * Uberlândia e Montes Claros, para qualquer destino. Uma carga de São Paulo
 * para o Mato Grosso aparecia passando por Uberlândia, que fica em outra
 * direção, e o histórico não batia com a linha desenhada no mapa.
 *
 * Quando a rota é curta demais, ou não há cidade conhecida no meio do caminho,
 * a lista volta vazia e o histórico fica só com origem e destino — melhor do
 * que inventar uma parada em lugar nenhum.
 */
function paradasDoTrajeto(p: Pedido, quantas: number): string[] {
  const semAcento = (s: string) =>
    (s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();

  // A coordenada é resolvida aqui, e não por `geo.ts`, porque aquele arquivo
  // importa este — usá-lo criaria um ciclo entre os dois.
  const ponto = (cidade: string, uf: string): [number, number] => {
    const chave = `${semAcento(cidade)}-${semAcento(uf)}`;
    return CITY_COORDS[chave] ?? STATE_COORDS[semAcento(uf)] ?? STATE_COORDS["SP"]!;
  };

  return cidadesNoCaminho(
    CITY_COORDS,
    ponto(p.origin_city, p.origin_state),
    ponto(p.dest_city, p.dest_state),
    quantas,
  );
}

/**
 * A lista COMPLETA de eventos do histórico, já com os ajustes manuais.
 *
 * Existe separada de `buildMovimentos` porque o painel precisa ver todos os
 * eventos para poder editar suas datas — inclusive os que ainda não
 * aconteceram e que o cliente, portanto, não vê.
 *
 * A posição de cada evento nesta lista é a CHAVE do ajuste. Por isso a ordem
 * aqui é fixa e não pode ser embaralhada: mudar a ordem faria os ajustes já
 * salvos apontarem para o evento errado.
 */
export function eventosDoPedido(p: Pedido): { at: Date; title: string; place: string }[] {
  const start = shipDateTime(p).getTime();
  const end = expectedDate(p).getTime();
  const total = end - start;
  const seed = hash(p.tracking_code);
  // Paradas sobre a rota deste pedido, em ordem de trajeto.
  const hubs = paradasDoTrajeto(p, 4).map((h, i) => ({ h, i }));

  const raw: { at: number; title: string; place: string }[] = [
    { at: start, title: "Objeto postado / coletado", place: `${p.origin_city} / ${p.origin_state}` },
    { at: start + total * 0.08, title: "Objeto recebido no centro de distribuição", place: p.sender },
    { at: start + total * 0.16, title: "Objeto em trânsito — para unidade de tratamento", place: `${p.origin_city} / ${p.origin_state}` },
    ...hubs.map(({ h, i }) => ({
      at: start + total * (0.26 + i * 0.13 + rand(seed + i) * 0.03),
      title: i % 2 === 0 ? "Objeto em trânsito — encaminhado" : "Objeto chegou na unidade de transbordo",
      place: h,
    })),
    { at: start + total * 0.82, title: "Objeto encaminhado para a cidade de destino", place: `${p.dest_city} / ${p.dest_state}` },
    { at: start + total * 0.9, title: "Objeto recebido na unidade de entrega", place: `${p.dest_city} / ${p.dest_state}` },
    { at: start + total * 0.96, title: "Objeto saiu para entrega ao destinatário", place: `${p.dest_city} / ${p.dest_state}` },
    { at: end, title: "Objeto entregue ao destinatário", place: `${p.dest_city} / ${p.dest_state}` },
  ];

  const ajustes = p.eventos_ajustes ?? null;

  return raw.map((r, i) => {
    const escolhido = ajustes ? ajustes[String(i)] : null;
    const data = escolhido ? new Date(escolhido) : null;
    // Ajuste ilegível é ignorado em vez de virar "Invalid Date" na tela.
    const at = data && !Number.isNaN(data.getTime()) ? data : new Date(r.at);
    return { at, title: r.title, place: r.place };
  });
}

/**
 * Momento que serve de régua para dizer o que já aconteceu.
 *
 * Normalmente é agora. Com o pedido PAUSADO, é o instante em que ele foi
 * pausado — a última gravação.
 *
 * Sem isso a pausa congelava só o caminhão do mapa: a lista de eventos
 * continuava andando, e o cliente via o objeto parado num ponto enquanto o
 * histórico anunciava cidades novas. Duas versões da mesma viagem.
 *
 * Data de gravação ilegível cai em "agora": esconder o histórico inteiro por
 * causa de um campo estranho seria pior do que o desalinhamento.
 */
export function reguaDoTempo(p: Pedido, now: number = Date.now()): number {
  if (!p.pausado || !p.updated_at) return now;
  const congelado = new Date(p.updated_at).getTime();
  return Number.isNaN(congelado) ? now : congelado;
}

/** Histórico de movimentação dinâmico: só mostra eventos cuja data/hora já passou */
export function buildMovimentos(p: Pedido, now = Date.now()): Movimento[] {
  const regua = reguaDoTempo(p, now);

  const list = eventosDoPedido(p)
    .map((r) => ({ ...r, done: r.at.getTime() <= regua }))
    .filter((r) => r.done || isDelivered(p));

  /*
   * Ordena pela data em vez de confiar na ordem de montagem.
   *
   * Sem ajustes as duas coincidem, então nada muda. Com ajustes, um evento
   * movido para antes de outro apareceria fora de lugar na linha do tempo —
   * o cliente veria a entrega listada acima da coleta, por exemplo.
   */
  return list.sort((a, b) => b.at.getTime() - a.at.getTime());
}

export function statusFor(p: Pedido, now = Date.now()) {
  if (isDelivered(p)) return "Entregue";
  const pr = progressOf(p, now);
  if (pr <= 0) return "Aguardando postagem";
  if (pr >= 96) return "Saiu para entrega";
  return p.status || "Em trânsito";
}

export function fmtDate(d: Date | string | null) {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d.length <= 10 ? `${d}T12:00:00` : d) : d;
  // Sem esta guarda, um valor estranho vira "Invalid Date" na tela do cliente.
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("pt-BR");
}

export function fmtDateTime(d: Date) {
  return `${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

export function money(v: number | null | undefined) {
  return (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Posição do caminhão interpolada ao longo da rota */
export function truckPosition(from: [number, number], to: [number, number], pct: number): [number, number] {
  const t = Math.max(0, Math.min(1, pct / 100));
  const curve = Math.sin(t * Math.PI) * 1.1;
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t + curve * 0.35];
}
