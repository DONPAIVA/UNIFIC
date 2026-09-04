/**
 * Escolha das cidades por onde a carga passa.
 *
 * Fica num arquivo próprio, sem importar nada do projeto, para poder ser usado
 * por `tracking.ts` sem criar ciclo de importação. A tabela de coordenadas
 * continua onde sempre esteve, em `tracking.ts`, e chega aqui por parâmetro.
 */

export type Pt = [number, number];

/**
 * Nome de exibição das cidades cuja grafia tem acento.
 *
 * A tabela de coordenadas usa chaves sem acento, para a busca não depender de
 * como o texto foi digitado. Mas o histórico é lido pelo cliente, e "Ji-parana"
 * ou "Cuiaba" denunciam texto gerado por máquina. Só entram aqui os nomes que
 * mudam; o resto é formatado pela regra geral.
 */
const NOMES: Record<string, string> = {
  // Minas Gerais
  "UBERLANDIA-MG": "Uberlândia", "RIBEIRAO DAS NEVES-MG": "Ribeirão das Neves",
  "DIVINOPOLIS-MG": "Divinópolis", "IBIRITE-MG": "Ibirité",
  "POCOS DE CALDAS-MG": "Poços de Caldas", "TEOFILO OTONI-MG": "Teófilo Otoni",
  "SABARA-MG": "Sabará", "MURIAE-MG": "Muriaé", "ARAXA-MG": "Araxá",
  "ITAJUBA-MG": "Itajubá", "SAO JOAO DEL REI-MG": "São João del Rei",
  "UNAI-MG": "Unaí",
  // São Paulo
  "SAO PAULO-SP": "São Paulo", "SAO BERNARDO DO CAMPO-SP": "São Bernardo do Campo",
  "SANTO ANDRE-SP": "Santo André", "RIBEIRAO PRETO-SP": "Ribeirão Preto",
  "SAO JOSE DOS CAMPOS-SP": "São José dos Campos", "MAUA-SP": "Mauá",
  "SAO JOSE DO RIO PRETO-SP": "São José do Rio Preto", "JUNDIAI-SP": "Jundiaí",
  "CARAPICUIBA-SP": "Carapicuíba", "SAO VICENTE-SP": "São Vicente",
  "GUARUJA-SP": "Guarujá", "TAUBATE-SP": "Taubaté",
  "TABOAO DA SERRA-SP": "Taboão da Serra", "SUMARE-SP": "Sumaré",
  "SAO CARLOS-SP": "São Carlos", "MARILIA-SP": "Marília",
  "JACAREI-SP": "Jacareí", "HORTOLANDIA-SP": "Hortolândia",
  "SAO JOSE DOS PINHAIS-SP": "São José dos Pinhais",
  "BRAGANCA PAULISTA-SP": "Bragança Paulista",
  "SANTA BARBARA D OESTE-SP": "Santa Bárbara d'Oeste",
  // Rio de Janeiro
  "SAO GONCALO-RJ": "São Gonçalo", "NOVA IGUACU-RJ": "Nova Iguaçu",
  "NITEROI-RJ": "Niterói", "SAO JOAO DE MERITI-RJ": "São João de Meriti",
  "PETROPOLIS-RJ": "Petrópolis", "MAGE-RJ": "Magé", "MACAE-RJ": "Macaé",
  "ITABORAI-RJ": "Itaboraí", "TERESOPOLIS-RJ": "Teresópolis",
  // Sul
  "MARINGA-PR": "Maringá", "FOZ DO IGUACU-PR": "Foz do Iguaçu",
  "PARANAGUA-PR": "Paranaguá", "GRAVATAI-RS": "Gravataí",
  "FLORIANOPOLIS-SC": "Florianópolis", "SAO JOSE-SC": "São José",
  "CRICIUMA-SC": "Criciúma", "CHAPECO-SC": "Chapecó", "ITAJAI-SC": "Itajaí",
  "BALNEARIO CAMBORIU-SC": "Balneário Camboriú", "JARAGUA DO SUL-SC": "Jaraguá do Sul",
  // Centro-Oeste
  "BRASILIA-DF": "Brasília", "GOIANIA-GO": "Goiânia",
  "APARECIDA DE GOIANIA-GO": "Aparecida de Goiânia", "ANAPOLIS-GO": "Anápolis",
  "LUZIANIA-GO": "Luziânia", "CUIABA-MT": "Cuiabá",
  "VARZEA GRANDE-MT": "Várzea Grande", "RONDONOPOLIS-MT": "Rondonópolis",
  "TRES LAGOAS-MS": "Três Lagoas",
  // Nordeste
  "CAMACARI-BA": "Camaçari", "ILHEUS-BA": "Ilhéus",
  "VITORIA DA CONQUISTA-BA": "Vitória da Conquista",
  "JABOATAO DOS GUARARAPES-PE": "Jaboatão dos Guararapes",
  "MARACANAU-CE": "Maracanaú", "SAO LUIS-MA": "São Luís",
  "MOSSORO-RN": "Mossoró", "JOAO PESSOA-PB": "João Pessoa",
  "MACEIO-AL": "Maceió", "PARNAIBA-PI": "Parnaíba",
  // Norte
  "BELEM-PA": "Belém", "SANTAREM-PA": "Santarém", "MARABA-PA": "Marabá",
  "JI-PARANA-RO": "Ji-Paraná", "MACAPA-AP": "Macapá",
  "ARAGUAINA-TO": "Araguaína",
  // Espírito Santo
  "VITORIA-ES": "Vitória", "SAO MATEUS-ES": "São Mateus",
};

/** "SAO PAULO-SP" vira "São Paulo / SP" — como aparece para o cliente. */
function rotulo(chave: string): string {
  const corte = chave.lastIndexOf("-");
  const uf = chave.slice(corte + 1);
  const conhecido = NOMES[chave];
  if (conhecido) return `${conhecido} / ${uf}`;

  const miudas = ["de", "do", "da", "dos", "das", "e"];
  const bonito = chave
    .slice(0, corte)
    .toLowerCase()
    .split(" ")
    .map((w, i) =>
      i > 0 && miudas.includes(w)
        ? w
        : // Capitaliza também depois do hífen: "ji-parana" viraria "Ji-parana".
          w.replace(/(^|-)([a-zà-ú])/g, (_, sep, letra) => sep + letra.toUpperCase()),
    )
    .join(" ");
  return `${bonito} / ${uf}`;
}

/**
 * Distância aproximada em quilômetros.
 *
 * A longitude é corrigida pelo cosseno da latitude: sem isso, no Brasil, um
 * grau de longitude contaria o mesmo que um de latitude e as distâncias no
 * sentido leste-oeste sairiam bem maiores do que são.
 */
function km(a: Pt, b: Pt): number {
  const dLat = (a[0] - b[0]) * 111;
  const dLon = (a[1] - b[1]) * 111 * Math.cos(((a[0] + b[0]) / 2) * (Math.PI / 180));
  return Math.hypot(dLat, dLon);
}

/**
 * Cidades que ficam SOBRE o caminho entre dois pontos, em ordem de trajeto.
 *
 * Antes as paradas do histórico eram uma lista fixa no código — sempre
 * Campinas, Ribeirão Preto, Uberlândia e Montes Claros, fosse qual fosse o
 * destino. Uma carga de São Paulo para o Mato Grosso aparecia passando por
 * Uberlândia, que fica em outra direção, e o texto não batia com a linha
 * desenhada no mapa.
 *
 * Aqui cada cidade é projetada sobre a reta origem→destino. Sobram as que
 * caem entre as duas pontas e a menos de `desvioMaxKm` da rota.
 *
 * Devolve lista vazia quando a viagem é curta ou não há cidade conhecida no
 * meio do caminho — melhor não ter parada do que inventar uma fora da rota.
 */
export function cidadesNoCaminho(
  tabela: Record<string, Pt>,
  de: Pt,
  para: Pt,
  quantidade: number,
  desvioMaxKm = 220,
): string[] {
  if (quantidade <= 0 || km(de, para) < 60) return [];

  const dLat = para[0] - de[0];
  const dLon = para[1] - de[1];
  const denominador = dLat * dLat + dLon * dLon;
  if (denominador === 0) return [];

  const candidatas: { t: number; nome: string; desvio: number }[] = [];

  for (const [chave, pt] of Object.entries(tabela)) {
    // Onde a cidade cai ao longo da rota: 0 na origem, 1 no destino.
    const t = ((pt[0] - de[0]) * dLat + (pt[1] - de[1]) * dLon) / denominador;
    if (t <= 0.06 || t >= 0.94) continue;

    // Ponto da rota mais próximo dela, para medir o quanto está fora do caminho.
    const naRota: Pt = [de[0] + dLat * t, de[1] + dLon * t];
    const desvio = km(pt, naRota);
    if (desvio > desvioMaxKm) continue;

    candidatas.push({ t, nome: rotulo(chave), desvio });
  }

  if (!candidatas.length) return [];
  candidatas.sort((a, b) => a.t - b.t);

  /*
   * Escolhe as mais próximas de posições igualmente espaçadas na rota.
   *
   * Pegar as primeiras da lista amontoaria tudo no começo do trajeto, que é
   * onde há mais cidades cadastradas — o Sudeste.
   *
   * O desvio entra na conta junto com a posição: entre duas cidades no mesmo
   * trecho, ganha a que está sobre a estrada. Sem esse peso, São Paulo para
   * Minas escolhia Angra dos Reis, que fica na direção do mar.
   */
  const usadas = new Set<number>();
  const escolhidas: { t: number; nome: string; desvio: number }[] = [];

  for (let i = 0; i < quantidade; i++) {
    const alvo = (i + 1) / (quantidade + 1);
    let melhor = -1;
    let menorCusto = Infinity;

    for (let j = 0; j < candidatas.length; j++) {
      if (usadas.has(j)) continue;
      const c = candidatas[j]!;
      // 200 km fora da rota pesam tanto quanto 0,2 de deslocamento no trajeto.
      const custo = Math.abs(c.t - alvo) + c.desvio / 1000;
      if (custo < menorCusto) {
        menorCusto = custo;
        melhor = j;
      }
    }

    if (melhor < 0) break;
    usadas.add(melhor);
    escolhidas.push(candidatas[melhor]!);
  }

  // De volta à ordem do trajeto: a escolha acima não sai ordenada.
  return escolhidas.sort((a, b) => a.t - b.t).map((c) => c.nome);
}
