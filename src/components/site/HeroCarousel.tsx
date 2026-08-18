import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import hero1 from "@/assets/hero-1.jpg";
import hero2 from "@/assets/hero-2.jpg";
import hero3 from "@/assets/hero-3.jpg";
import hero4 from "@/assets/hero-4.jpg";

const SLIDES = [
  {
    img: hero1,
    title: "Segurança em Cada Detalhe",
    text: "Rastreamento em tempo real e proteção total. Sua encomenda é prioridade, do início ao fim.",
  },
  {
    img: hero2,
    title: "Frota Própria em Todo o Brasil",
    text: "Mais de 3.400 rotas ativas conectando centros de distribuição a cada bairro do país.",
  },
  {
    img: hero3,
    title: "Centros de Distribuição Inteligentes",
    text: "Triagem automatizada 24h que reduz o tempo de processamento do seu pedido.",
  },
  {
    img: hero4,
    title: "Entrega na Porta, no Prazo",
    text: "Mercado Livre, Shopee, Amazon, OLX e Magalu em um só painel de rastreio.",
  },
];

export function HeroCarousel() {
  const [i, setI] = useState(0);
  /*
   * Só monta a <img> dos slides que já foram exibidos.
   *
   * `loading="lazy"` não adiantava aqui: os quatro slides ficam empilhados
   * dentro do viewport (apenas com opacity 0), então o navegador baixava
   * todos de uma vez no carregamento inicial — cerca de 500 KB. Assim, entra
   * só o primeiro, e os demais são buscados conforme o carrossel avança.
   */
  const [carregados, setCarregados] = useState<number[]>([0]);

  useEffect(() => {
    const t = setInterval(() => {
      setI((v) => {
        const proximo = (v + 1) % SLIDES.length;
        setCarregados((c) => (c.includes(proximo) ? c : [...c, proximo]));
        return proximo;
      });
    }, 4000);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="relative mx-auto mt-4 max-w-5xl overflow-hidden rounded-xl">
      <div className="relative h-52 w-full sm:h-72">
        {SLIDES.map((s, idx) =>
          carregados.includes(idx) ? (
            <img
              key={idx}
              src={s.img}
              alt={s.title}
              width={1600}
              height={700}
              loading={idx === 0 ? "eager" : "lazy"}
              fetchPriority={idx === 0 ? "high" : "low"}
              decoding="async"
              className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${idx === i ? "opacity-100" : "opacity-0"}`}
            />
          ) : null,
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-navy/85 via-navy/50 to-primary/40" />
        <div className="absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
          {SLIDES.map((s, idx) => (
            <div key={idx} className={idx === i ? "animate-fade-in" : "hidden"}>
              <h2 className="font-display text-xl font-bold text-navy-foreground drop-shadow sm:text-3xl">{s.title}</h2>
              <p className="mt-2 max-w-xl text-xs text-navy-foreground/90 sm:text-sm">{s.text}</p>
            </div>
          ))}
          <a
            href="#rastreio"
            className="mt-4 rounded-md bg-primary px-5 py-2 text-sm font-bold text-primary-foreground shadow transition-transform hover:scale-105"
          >
            Saiba Mais
          </a>
        </div>
      </div>
      <button
        aria-label="Anterior"
        onClick={() => setI((v) => (v - 1 + SLIDES.length) % SLIDES.length)}
        className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-card/90 p-2 text-card-foreground shadow"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        aria-label="Próximo"
        onClick={() => setI((v) => (v + 1) % SLIDES.length)}
        className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-card/90 p-2 text-card-foreground shadow"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
        {SLIDES.map((_, idx) => (
          <button
            key={idx}
            aria-label={`Slide ${idx + 1}`}
            onClick={() => setI(idx)}
            className={`h-2 w-2 rounded-full transition-colors ${idx === i ? "bg-primary" : "bg-white/50"}`}
          />
        ))}
      </div>
    </section>
  );
}
