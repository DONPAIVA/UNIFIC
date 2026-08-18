import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { toast } from "sonner";
import mascoteBoneco from "@/assets/mascote-boneco.png";

// O painel oculto só abre com duplo clique no mascote, mas era baixado em
// TODA página (arrasta react-query, tabelas e a camada de dados junto).
// Sob demanda, sai do carregamento inicial de todo o site.
const AdminPanel = lazy(() => import("./AdminPanel").then((m) => ({ default: m.AdminPanel })));

const FALAS = [
  "Oi! Eu sou o Téo, mascote da Únific+ 👋",
  "Posso te ajudar a rastrear seu pedido agora mesmo.",
  "Digite seu código de rastreio no campo do topo da página.",
  "Escolhi o marketplace certo? Mercado Livre, Shopee, Amazon e OLX também funcionam!",
  "Dica: o prazo padrão de entrega é de até 15 dias corridos.",
  "Precisa da 2ª via da nota fiscal? Tem um atalho no menu 📄",
  "Quer saber o valor do envio? Use a Cotação de Frete 🚚",
  "Algum problema com a entrega? Abra uma reclamação que eu acompanho.",
  "Estou sempre por aqui, de pé, esperando você 😄",
];

/** Mascote boneco 3D no canto. 1 clique abre o chat automático, 2 cliques abrem o painel oculto. */
export function Mascot() {
  const [admin, setAdmin] = useState(false);
  const [chat, setChat] = useState(false);
  const [msgs, setMsgs] = useState<string[]>([]);
  const [typing, setTyping] = useState(false);
  const [pop, setPop] = useState(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idx = useRef(0);
  const scroller = useRef<HTMLDivElement | null>(null);

  // Conversa sozinho enquanto o chat está aberto
  useEffect(() => {
    if (!chat) return;
    let cancelled = false;
    let t: ReturnType<typeof setTimeout>;

    const next = () => {
      if (cancelled) return;
      setTyping(true);
      t = setTimeout(() => {
        if (cancelled) return;
        setMsgs((m) => [...m, FALAS[idx.current % FALAS.length] ?? ""]);
        idx.current += 1;
        setTyping(false);
        t = setTimeout(next, 2600);
      }, 1100);
    };
    next();

    return () => {
      cancelled = true;
      clearTimeout(t);
      setTyping(false);
    };
  }, [chat]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs, typing]);

  const handleClick = () => {
    setPop(true);
    setTimeout(() => setPop(false), 420);
    if (clickTimer.current) return; // segundo clique é tratado no onDoubleClick
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      setChat((v) => {
        if (!v) {
          setMsgs([]);
          idx.current = 0;
        }
        return !v;
      });
    }, 260);
  };

  const handleDoubleClick = () => {
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    setChat(false);
    setAdmin(true);
    toast.info("Painel oculto aberto");
  };

  return (
    <>
      <div className="fixed bottom-0 right-2 z-50 flex flex-col items-end gap-2 sm:right-4">
        {chat && (
          <div className="mb-1 w-[17rem] animate-scale-in overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl">
            <div className="flex items-center justify-between bg-primary px-3 py-2 text-primary-foreground">
              <p className="text-sm font-bold">Téo · Atendimento Únific+</p>
              <button onClick={() => setChat(false)} aria-label="Fechar chat" className="opacity-80 hover:opacity-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div ref={scroller} className="max-h-56 space-y-2 overflow-y-auto p-3">
              {msgs.map((m, i) => (
                <p
                  key={i}
                  className="animate-fade-in rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-xs text-muted-foreground"
                >
                  {m}
                </p>
              ))}
              {typing && (
                <p className="flex gap-1 rounded-2xl bg-muted px-3 py-3">
                  <span className="mascot-dot h-1.5 w-1.5 rounded-full bg-foreground/50" />
                  <span className="mascot-dot h-1.5 w-1.5 rounded-full bg-foreground/50" />
                  <span className="mascot-dot h-1.5 w-1.5 rounded-full bg-foreground/50" />
                </p>
              )}
            </div>
          </div>
        )}
        <button
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          title="Falar com o Téo (duplo clique: painel)"
          aria-label="Abrir chat do mascote Téo"
          className="mascot-stand group relative block select-none"
        >
          <span className="pointer-events-none absolute -top-1 right-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary shadow-lg transition-transform duration-300 group-hover:scale-110">
            <MessageCircle className="h-4 w-4 text-primary-foreground" />
          </span>
          <img
            src={mascoteBoneco}
            alt="Téo, mascote boneco entregador da Únific+, em pé segurando uma caixa"
            loading="lazy"
            width={768}
            height={1280}
            className={`mascot-figure h-40 w-auto drop-shadow-[0_12px_18px_rgba(0,0,0,0.3)] sm:h-56 ${pop ? "mascot-pop" : ""}`}
          />
        </button>
      </div>
      {admin && (
        <Suspense fallback={null}>
          <AdminPanel onClose={() => setAdmin(false)} />
        </Suspense>
      )}
    </>
  );
}
