import { useEffect, useState } from "react";
import { CITY_COORDS, STATE_COORDS } from "./tracking";

export type Pt = [number, number];

/* A tabela de coordenadas vive em `tracking.ts` e é reaproveitada aqui, em vez
   de mantida em dois lugares: havia uma cópia menor neste arquivo, e cidade
   presente numa e ausente na outra caía na capital do estado. */

function norm(s: string) {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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
