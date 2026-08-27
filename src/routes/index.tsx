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

  /*
   * Leva o visitante até o campo de rastreio ao abrir o site.
   *
   * A descida é lenta de propósito: saltar direto esconderia o topo e a pessoa
   * não entenderia para onde foi. Descendo devagar, ela vê a marca passar e
   * chega no campo já sabendo o que fazer.
   *
   * A animação é feita à mão, quadro a quadro, em vez de `behavior: "smooth"`.
   * Dois motivos: o nativo não deixa escolher a duração — e "lentamente" é o
   * pedido — e ele simplesmente não faz nada em parte dos navegadores, falhando
   * em silêncio (foi o que aconteceu ao testar esta tela).
   *
   * O atraso inicial espera o carrossel e os cartões assumirem a altura final;
   * sem ele, a rolagem mira numa posição que muda logo depois.
   *
   * Não rola quando: a URL já pede outro destino (#ancora), o visitante mexeu
   * na página, ou o sistema dele pede menos animação.
   */
  useEffect(() => {
    if (window.location.hash) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let cancelado = false;
    let quadro = 0;

    const desistir = () => {
      cancelado = true;
      if (quadro) cancelAnimationFrame(quadro);
    };

    // A partir do momento em que o visitante rola, a página é dele.
    window.addEventListener("wheel", desistir, { passive: true, once: true });
    window.addEventListener("touchstart", desistir, { passive: true, once: true });
    window.addEventListener("keydown", desistir, { once: true });

    const inicio = setTimeout(() => {
      if (cancelado) return;

      const alvo = document.getElementById("rastreio");
      if (!alvo) return;

      const partida = window.scrollY;
      const chegada = alvo.getBoundingClientRect().top + partida;
      const distancia = chegada - partida;
      if (Math.abs(distancia) < 8) return;

      const duracao = 1600; // devagar o bastante para acompanhar com os olhos
      let t0 = 0;

      const passo = (agora: number) => {
        if (cancelado) return;
        if (!t0) t0 = agora;

        const avanco = Math.min((agora - t0) / duracao, 1);
        // Começa e termina devagar; no meio anda mais rápido.
        const suave = avanco < 0.5 ? 2 * avanco * avanco : 1 - (-2 * avanco + 2) ** 2 / 2;

        window.scrollTo(0, partida + distancia * suave);
        if (avanco < 1) quadro = requestAnimationFrame(passo);
      };

      quadro = requestAnimationFrame(passo);
    }, 900);

    return () => {
      clearTimeout(inicio);
      if (quadro) cancelAnimationFrame(quadro);
      window.removeEventListener("wheel", desistir);
      window.removeEventListener("touchstart", desistir);
      window.removeEventListener("keydown", desistir);
    };
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
