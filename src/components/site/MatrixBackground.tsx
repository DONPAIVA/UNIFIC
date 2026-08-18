import { useEffect, useRef } from "react";

/**
 * Fundo "Matrix" do site inteiro.
 *
 * Fica atrás de todo o conteúdo (fixed + z-index negativo) e é puramente
 * decorativo: `aria-hidden` e `pointer-events: none`, então não atrapalha
 * leitura de tela nem cliques.
 *
 * Cuidados de desempenho — o fundo roda em TODAS as páginas:
 *   - requestAnimationFrame com limite de ~24 fps (não 60): o efeito é o
 *     mesmo e o custo de CPU cai bastante;
 *   - devicePixelRatio travado em 1, senão em telas retina o canvas
 *     desenharia 4x mais pixels sem ganho visual perceptível;
 *   - congela quando a aba está em segundo plano;
 *   - desliga por completo com `prefers-reduced-motion`.
 */
export function MatrixBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const semMovimento = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const TAMANHO = 15;
    const GLIFOS = "01アイウエオカキクケコサシスセソタチツテトナニヌネノ<>/{}[]|\\;:+=*-_$#@%&";

    let colunas = 0;
    let gotas: number[] = [];
    let velocidades: number[] = [];

    const redimensionar = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      ctx.font = `bold ${TAMANHO}px "Roboto Mono", ui-monospace, monospace`;
      ctx.textBaseline = "top";

      colunas = Math.ceil(canvas.width / TAMANHO);
      gotas = new Array(colunas);
      velocidades = new Array(colunas);
      for (let i = 0; i < colunas; i++) {
        gotas[i] = Math.random() * -60;
        // Velocidades diferentes por coluna dão profundidade à chuva.
        velocidades[i] = 0.45 + Math.random() * 0.95;
      }
    };
    redimensionar();
    window.addEventListener("resize", redimensionar);

    const glifo = () => GLIFOS[(Math.random() * GLIFOS.length) | 0] ?? "0";

    const desenhar = () => {
      // Rastro: quanto menor o alfa, mais longa a cauda verde.
      ctx.fillStyle = "rgba(2, 6, 4, 0.075)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < colunas; i++) {
        const x = i * TAMANHO;
        const y = (gotas[i] ?? 0) * TAMANHO;

        // Cabeça da coluna: quase branca, com brilho — é o que dá o visual clássico.
        ctx.shadowColor = "#00ff6a";
        ctx.shadowBlur = 10;
        ctx.fillStyle = "#d8ffe6";
        ctx.fillText(glifo(), x, y);

        // Corpo logo acima da cabeça, em verde forte.
        ctx.shadowBlur = 5;
        ctx.fillStyle = "#00ff6a";
        ctx.fillText(glifo(), x, y - TAMANHO);

        // Cauda mais apagada.
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(0, 200, 80, 0.55)";
        ctx.fillText(glifo(), x, y - TAMANHO * 2);

        gotas[i] = (gotas[i] ?? 0) + (velocidades[i] ?? 1);
        if (y > canvas.height && Math.random() > 0.965) gotas[i] = Math.random() * -20;
      }
      ctx.shadowBlur = 0;
    };

    if (semMovimento) {
      // Sem animação: um quadro estático, só para manter a identidade visual.
      ctx.fillStyle = "rgba(2, 6, 4, 1)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      desenhar();
      return () => window.removeEventListener("resize", redimensionar);
    }

    // Primeiro quadro imediato: se a aba abrir em segundo plano, o laço só
    // começa a desenhar quando ela ganhar foco — sem isto o fundo ficaria
    // preto liso até lá.
    for (let i = 0; i < 12; i++) desenhar();

    const INTERVALO = 1000 / 24;
    let ultimo = 0;
    let raf = 0;

    const laco = (agora: number) => {
      raf = requestAnimationFrame(laco);
      if (document.hidden) return;
      if (agora - ultimo < INTERVALO) return;
      ultimo = agora;
      desenhar();
    };
    raf = requestAnimationFrame(laco);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", redimensionar);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[#020604]" aria-hidden="true">
      <canvas ref={canvasRef} className="h-full w-full opacity-[0.55]" />
      {/* Linhas de varredura: reforçam o ar de terminal antigo. */}
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: "repeating-linear-gradient(0deg, rgba(0,0,0,0.5) 0px, rgba(0,0,0,0.5) 1px, transparent 1px, transparent 3px)",
        }}
      />
      {/* Vinheta: escurece as bordas e ajuda o conteúdo a se destacar. */}
      <div
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse at center, transparent 35%, rgba(0,0,0,0.75) 100%)" }}
      />
    </div>
  );
}
