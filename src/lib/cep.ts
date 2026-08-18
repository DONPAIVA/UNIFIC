export type CepInfo = {
  cep: string;
  street: string;
  district: string;
  city: string;
  state: string;
};

const cache = new Map<string, CepInfo>();

export function onlyDigits(v: string) {
  return (v ?? "").replace(/\D/g, "").slice(0, 8);
}

export function maskCep(v: string) {
  const d = onlyDigits(v);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/** Busca endereço pelo CEP (ViaCEP → fallback BrasilAPI) */
export async function lookupCep(raw: string): Promise<CepInfo> {
  const cep = onlyDigits(raw);
  if (cep.length !== 8) throw new Error("CEP incompleto");
  const hit = cache.get(cep);
  if (hit) return hit;

  try {
    const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    const j = await r.json();
    if (!j?.erro) {
      const info: CepInfo = {
        cep: maskCep(cep),
        street: j.logradouro ?? "",
        district: j.bairro ?? "",
        city: j.localidade ?? "",
        state: j.uf ?? "",
      };
      cache.set(cep, info);
      return info;
    }
  } catch {
    /* tenta fallback */
  }

  const r2 = await fetch(`https://brasilapi.com.br/api/cep/v1/${cep}`);
  if (!r2.ok) throw new Error("CEP não encontrado");
  const j2 = await r2.json();
  const info: CepInfo = {
    cep: maskCep(cep),
    street: j2.street ?? "",
    district: j2.neighborhood ?? "",
    city: j2.city ?? "",
    state: j2.state ?? "",
  };
  cache.set(cep, info);
  return info;
}
