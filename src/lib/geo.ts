import { useEffect, useState } from "react";
import { STATE_COORDS } from "./tracking";

export type Pt = [number, number];

/** Coordenadas reais das principais cidades (evita chamada de rede) */
const CITY_COORDS: Record<string, Pt> = {
  "UBERLANDIA-MG": [-18.9186, -48.2772],
  "BELO HORIZONTE-MG": [-19.9167, -43.9345],
  "UBERABA-MG": [-19.7472, -47.9381],
  "CONTAGEM-MG": [-19.9317, -44.0536],
  "JUIZ DE FORA-MG": [-21.7642, -43.3496],
  "MONTES CLAROS-MG": [-16.735, -43.8617],
  "SAO PAULO-SP": [-23.5505, -46.6333],
  "CAMPINAS-SP": [-22.9056, -47.0608],
  "GUARULHOS-SP": [-23.4543, -46.5337],
  "SANTOS-SP": [-23.9608, -46.3336],
  "RIBEIRAO PRETO-SP": [-21.1775, -47.8103],
  "SAO JOSE DOS CAMPOS-SP": [-23.1896, -45.8841],
  "SOROCABA-SP": [-23.5015, -47.4526],
  "RIO DE JANEIRO-RJ": [-22.9068, -43.1729],
  "NITEROI-RJ": [-22.8832, -43.1034],
  "CAMPOS DOS GOYTACAZES-RJ": [-21.7545, -41.3244],
  "CURITIBA-PR": [-25.4284, -49.2733],
  "LONDRINA-PR": [-23.3103, -51.1628],
  "MARINGA-PR": [-23.4205, -51.9331],
  "PORTO ALEGRE-RS": [-30.0346, -51.2177],
  "CAXIAS DO SUL-RS": [-29.1685, -51.1796],
  "FLORIANOPOLIS-SC": [-27.5954, -48.548],
  "JOINVILLE-SC": [-26.3045, -48.8487],
  "BLUMENAU-SC": [-26.9194, -49.0661],
  "SALVADOR-BA": [-12.9777, -38.5016],
  "FEIRA DE SANTANA-BA": [-12.2664, -38.9663],
  "RECIFE-PE": [-8.0476, -34.877],
  "CARUARU-PE": [-8.2829, -35.976],
  "FORTALEZA-CE": [-3.7319, -38.5267],
  "BRASILIA-DF": [-15.7939, -47.8828],
  "GOIANIA-GO": [-16.6869, -49.2648],
  "ANAPOLIS-GO": [-16.3267, -48.9528],
  "CUIABA-MT": [-15.6014, -56.0979],
  "CAMPO GRANDE-MS": [-20.4697, -54.6201],
  "MANAUS-AM": [-3.119, -60.0217],
  "BELEM-PA": [-1.4558, -48.4902],
  "VITORIA-ES": [-20.3155, -40.3128],
  "VILA VELHA-ES": [-20.3297, -40.2925],
  "NATAL-RN": [-5.7945, -35.211],
  "JOAO PESSOA-PB": [-7.115, -34.8631],
  "MACEIO-AL": [-9.6498, -35.7089],
  "ARACAJU-SE": [-10.9472, -37.0731],
  "TERESINA-PI": [-5.0892, -42.8019],
  "SAO LUIS-MA": [-2.5307, -44.3068],
  "PALMAS-TO": [-10.2491, -48.3243],
  "PORTO VELHO-RO": [-8.7612, -63.9004],
  "RIO BRANCO-AC": [-9.9754, -67.8249],
  "MACAPA-AP": [0.0349, -51.0694],
  "BOA VISTA-RR": [2.8235, -60.6758],
};

function norm(s: string) {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function key(city: string, state: string) {
  return `${norm(city)}-${norm(state)}`;
}

/** Coordenada imediata: cidade conhecida, senão capital do estado */
export function baseCoords(state: string, city: string): Pt {
  return CITY_COORDS[key(city, state)] ?? STATE_COORDS[norm(state)] ?? STATE_COORDS['SP']!;
}

const cache = new Map<string, Pt>();

async function lookup(city: string, state: string): Promise<Pt | null> {
  const k = key(city, state);
  if (cache.has(k)) return cache.get(k)!;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&country=Brazil&state=${encodeURIComponent(
      state,
    )}&city=${encodeURIComponent(city)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const j = (await r.json()) as Array<{ lat: string; lon: string }>;
    const hit = j?.[0];
    if (!hit) return null;
    const pt: Pt = [parseFloat(hit.lat), parseFloat(hit.lon)];
    cache.set(k, pt);
    return pt;
  } catch {
    return null;
  }
}

/** Coordenada real da cidade (resolve via geocodificação quando necessário) */
export function useCityCoords(city: string, state: string): Pt {
  const [pt, setPt] = useState<Pt>(() => baseCoords(state, city));

  useEffect(() => {
    setPt(baseCoords(state, city));
    const k = key(city, state);
    if (CITY_COORDS[k] || !city) return;
    let alive = true;
    lookup(city, state).then((res) => {
      if (alive && res) setPt(res);
    });
    return () => {
      alive = false;
    };
  }, [city, state]);

  return pt;
}
