import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Package, Search } from "lucide-react";
import { Layout } from "@/components/site/Layout";
import { insertTable, listTable } from "@/lib/api";
import { money } from "@/lib/tracking";

export const Route = createFileRoute("/cotacao")({
  head: () => ({
    meta: [
      { title: "Cotação de Frete | Únific+ Logística" },
      { name: "description", content: "Calcule o valor e o prazo de entrega do seu envio e consulte fretes pendentes por CPF." },
      { property: "og:title", content: "Cotação de Frete | Únific+ Logística" },
      { property: "og:description", content: "Calcule valor e prazo do seu frete com a Únific+." },
    ],
  }),
  component: CotacaoPage,
});

function CotacaoPage() {
  const [f, setF] = useState({ cep_origin: "", cep_dest: "", weight: 1, height: 10, width: 15, length: 20, declared_value: 100 });
  const [result, setResult] = useState<{ price: number; days: number } | null>(null);
  const [cpf, setCpf] = useState("");
  const [fretes, setFretes] = useState<Record<string, unknown>[] | null>(null);

  const calc = useMutation({
    mutationFn: async () => {
      if (f.cep_origin.replace(/\D/g, "").length !== 8 || f.cep_dest.replace(/\D/g, "").length !== 8) {
        throw new Error("Informe CEPs válidos de origem e destino.");
      }
      const cubic = (f.height * f.width * f.length) / 6000;
      const base = 24.9 + Math.max(f.weight, cubic) * 3.4 + f.declared_value * 0.012;
      const dist = Math.abs(Number(f.cep_origin.replace(/\D/g, "").slice(0, 3)) - Number(f.cep_dest.replace(/\D/g, "").slice(0, 3)));
      const price = Number((base + dist * 0.18).toFixed(2));
      const days = 15;
      await insertTable("cotacoes_frete", { ...f, price, days });
      return { price, days };
    },
    onSuccess: (r) => {
      setResult(r);
      toast.success("Cotação calculada e salva no sistema!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const buscar = useMutation({
    mutationFn: async () => {
      const rows = await listTable("cotacoes_frete");
      return rows.filter((r) => String(r["cpf"] ?? "") === cpf.trim());
    },
    onSuccess: (rows) => setFretes(rows),
  });

  const input = (key: keyof typeof f, label: string, placeholder: string, type = "text") => (
    <label className="text-xs font-bold">
      {label} *
      <input
        type={type}
        placeholder={placeholder}
        value={String(f[key])}
        maxLength={40}
        onChange={(e) => setF({ ...f, [key]: type === "number" ? Number(e.target.value) : e.target.value })}
        className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm font-normal text-card-foreground"
      />
    </label>
  );

  return (
    <Layout>
      <section className="card-panel mx-auto mt-6 max-w-5xl p-5 sm:p-7">
        <h1 className="flex items-center gap-2 font-display text-xl font-bold">
          <Package className="h-5 w-5 text-primary" /> Cotação de Frete
        </h1>
        <p className="text-sm text-muted-foreground">Calcule o valor e prazo de entrega para seu envio</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {input("cep_origin", "CEP de Origem", "00000-000")}
          {input("cep_dest", "CEP de Destino", "00000-000")}
          {input("weight", "Peso (kg)", "1.0", "number")}
          {input("height", "Altura (cm)", "10", "number")}
          {input("width", "Largura (cm)", "15", "number")}
          {input("length", "Comprimento (cm)", "20", "number")}
          {input("declared_value", "Valor Declarado (R$)", "100.00", "number")}
        </div>
        <button onClick={() => calc.mutate()} disabled={calc.isPending} className="mt-4 rounded-md bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground">
          Calcular Frete
        </button>
        {result && (
          <div className="mt-4 rounded-lg bg-muted p-4 text-sm">
            <p className="font-display text-lg font-bold">{money(result.price)}</p>
            <p className="text-muted-foreground">Prazo de entrega: até {result.days} dias corridos com rastreamento em tempo real.</p>
          </div>
        )}
      </section>

      <section className="card-panel mx-auto mt-4 max-w-5xl p-5 sm:p-7">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold">
          <Search className="h-5 w-5 text-primary" /> Buscar Pedidos de Frete por CPF
        </h2>
        <p className="text-sm text-muted-foreground">Consulte os fretes pendentes de pagamento vinculados ao seu documento</p>
        <label className="mt-3 block max-w-xs text-xs font-bold">
          Digite seu CPF
          <input
            value={cpf}
            maxLength={14}
            onChange={(e) => setCpf(e.target.value)}
            placeholder="000.000.000-00"
            className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm font-normal text-card-foreground"
          />
        </label>
        <button onClick={() => buscar.mutate()} className="mt-3 rounded-md bg-primary px-5 py-2 text-sm font-bold text-primary-foreground">
          Buscar Fretes
        </button>
        {fretes && (
          <div className="mt-4 space-y-2 text-sm">
            {fretes.length === 0 && <p className="text-muted-foreground">Nenhum frete encontrado para este CPF.</p>}
            {fretes.map((r, i) => (
              <div key={i} className="rounded-md border border-border p-3">
                <p className="font-semibold">{money(Number(r["price"] ?? 0))} — {String(r["cep_origin"])} → {String(r["cep_dest"])}</p>
                <p className="text-xs text-muted-foreground">Prazo: {String(r["days"])} dias · {r["paid"] ? "Pago" : "Pendente de pagamento"}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </Layout>
  );
}
