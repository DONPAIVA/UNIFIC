import { useState } from "react";
import { ChevronDown } from "lucide-react";

const FAQ = [
  {
    q: "Consigo fazer o rastreamento da minha entrega?",
    a: "Sim. Basta informar o código de rastreio fornecido pelo vendedor e selecionar o marketplace onde a compra foi feita. O mapa mostra a posição atual da carga em tempo real.",
  },
  {
    q: "Qual é o prazo de entrega dos pedidos?",
    a: "Todos os pedidos Únific+ são entregues em até 15 dias corridos contados da data de postagem. A barra de progresso indica exatamente quanto falta.",
  },
  {
    q: "Por que não consigo fazer o rastreamento?",
    a: "Normalmente o código ainda não foi liberado pelo vendedor ou foi digitado incorretamente. Confira o código e tente novamente em algumas horas.",
  },
  {
    q: "Como emito a segunda via da nota fiscal?",
    a: "Após rastrear o pedido, clique em 'Baixar Nota Fiscal'. Para garantia ou reemissão com dados atualizados, use a aba 2ª Via NF/Garantia.",
  },
  {
    q: "A entrega pode ser redirecionada?",
    a: "Sim, até o objeto sair para entrega. Abra um chamado no SAC informando o novo endereço completo e o código de rastreio.",
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const items = showAll ? FAQ : FAQ.slice(0, 3);

  return (
    <section className="card-panel mx-auto mt-4 max-w-5xl p-5 sm:p-7">
      <h2 className="font-display text-lg font-bold">Tem dúvidas? Confira aqui algumas perguntas frequentes</h2>
      <p className="text-sm text-muted-foreground">Encontre respostas rápidas para as dúvidas mais comuns</p>
      <div className="mt-4 divide-y divide-border">
        {items.map((f, i) => (
          <div key={f.q} className="py-3">
            <button onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center justify-between gap-3 text-left">
              <span className="text-sm font-semibold">{f.q}</span>
              <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open === i ? "rotate-180" : ""}`} />
            </button>
            {open === i && <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>}
          </div>
        ))}
      </div>
      {!showAll && (
        <div className="mt-4 text-center">
          <button onClick={() => setShowAll(true)} className="rounded-md bg-secondary px-5 py-2 text-xs font-bold uppercase tracking-wide text-secondary-foreground">
            Ver mais perguntas frequentes
          </button>
        </div>
      )}
    </section>
  );
}

export function ComoFunciona() {
  return (
    <section className="card-panel mx-auto mt-4 max-w-5xl p-5 sm:p-7">
      <h2 className="font-display text-lg font-bold">Como funciona</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Insira o código e veja a rota do caminhão até o destinatário, atualizada em tempo real com o percentual de
        conclusão. Caso precise abrir uma reclamação, preencha o formulário após fazer o rastreio.
      </p>
    </section>
  );
}

export function HelpBand() {
  return (
    <section className="mt-4 bg-navy py-8 text-center">
      <h2 className="font-display text-lg font-bold text-navy-foreground">Precisa de ajuda?</h2>
      <p className="mt-1 text-sm text-navy-foreground/80">
        Fale com nosso suporte especializado nas redes sociais ou abra um chamado.
      </p>
      <a href="#rastreio" className="mt-2 inline-block text-sm font-bold text-primary">
        Abrir Chamado (SAC)
      </a>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="bg-card text-card-foreground">
      <div className="mx-auto grid max-w-5xl gap-6 px-5 py-8 sm:grid-cols-3">
        <div>
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-navy font-display font-bold text-navy-foreground">U</div>
          <p className="mt-2 font-display text-sm font-bold">Únific+</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Líder em logística e rastreamento profissional, garantindo que sua encomenda chegue com segurança e
            transparência.
          </p>
        </div>
        <div>
          <p className="text-sm font-bold">Privacidade</p>
          <p className="mt-1 text-xs text-muted-foreground">Nossa política de privacidade garante a segurança dos seus dados.</p>
        </div>
        <div>
          <p className="text-sm font-bold">Diretrizes</p>
          <p className="mt-1 text-xs text-muted-foreground">Siga nossas diretrizes para uma experiência segura.</p>
        </div>
      </div>
      <p className="border-t border-border py-4 text-center text-[11px] text-muted-foreground">
        © Únific+ Logística e parcerias transportadoras Ltda 2026 Brasil — Todos os direitos reservados
      </p>
    </footer>
  );
}
