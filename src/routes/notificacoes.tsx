import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { Layout } from "@/components/site/Layout";
import { notificacoesPublicas } from "@/lib/rastreio.functions";
import { fmtDateTime } from "@/lib/tracking";

export const Route = createFileRoute("/notificacoes")({
  head: () => ({
    meta: [
      { title: "Notificações de Entrega | Únific+" },
      { name: "description", content: "Últimas movimentações e avisos das entregas em andamento na Únific+ Logística." },
      { property: "og:title", content: "Notificações de Entrega | Únific+" },
      { property: "og:description", content: "Acompanhe os avisos mais recentes das suas encomendas." },
    ],
  }),
  component: Notificacoes,
});

function Notificacoes() {
  const { data } = useQuery({
    queryKey: ["notificacoes-publicas"],
    queryFn: () => notificacoesPublicas(),
  });
  const avisos = data?.avisos ?? [];

  return (
    <Layout>
      <section className="card-panel mx-auto mt-6 max-w-3xl p-5 sm:p-7">
        <h1 className="flex items-center gap-2 font-display text-xl font-bold">
          <Bell className="h-5 w-5 text-primary" /> Notificações
        </h1>
        <p className="text-sm text-muted-foreground">Movimentações mais recentes das encomendas em andamento</p>
        <div className="mt-4 space-y-2">
          {avisos.length === 0 && <p className="text-sm text-muted-foreground">Sem notificações no momento.</p>}
          {avisos.map((a) => (
            <div key={a.code} className="rounded-lg border border-border p-3 text-sm">
              <p className="font-semibold">{a.code} — {a.title}</p>
              <p className="text-xs text-muted-foreground">{a.place} · {fmtDateTime(new Date(a.at))} · {a.status}</p>
            </div>
          ))}
        </div>
      </section>
    </Layout>
  );
}
