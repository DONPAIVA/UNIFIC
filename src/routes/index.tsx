import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Layout } from "@/components/site/Layout";
import { HeroCarousel } from "@/components/site/HeroCarousel";
import { TrackingPanel } from "@/components/site/TrackingPanel";
import { MlConnectButton } from "@/components/site/MlConnectButton";
import { ComoFunciona, Faq } from "@/components/site/Sections";
import { logAcesso } from "@/lib/acessos.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Únific+ | Rastreamento de Encomendas em Tempo Real" },
      {
        name: "description",
        content:
          "Rastreie sua encomenda do Mercado Livre, Shopee, Amazon, OLX e Magalu em tempo real, com mapa ao vivo e entrega garantida em 15 dias.",
      },
      { property: "og:title", content: "Únific+ | Rastreamento de Encomendas em Tempo Real" },
      { property: "og:description", content: "Rastreie sua encomenda do Mercado Livre, Shopee, Amazon, OLX e Magalu em tempo real, com mapa ao vivo e entrega garantida em 15 dias." },
    ],
  }),
  component: Index,
});

function Index() {
  useEffect(() => {
    void logAcesso({ data: { action: "visita", path: "/" } }).catch(() => {});
    const p = new URLSearchParams(window.location.search);
    const ml = p.get("ml");
    if (!ml) return;
    const msg = p.get("msg") ?? "";
    if (ml === "ok") toast.success(msg || "Mercado Livre conectado!");
    else toast.error(msg || "Não foi possível conectar o Mercado Livre.");
    window.history.replaceState({}, "", "/");
  }, []);

  return (
    <Layout>
      <HeroCarousel />
      <MlConnectButton />
      <TrackingPanel />
      <ComoFunciona />
      <Faq />
    </Layout>
  );
}
