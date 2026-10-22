import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, MapPin, Plus, Save, Trash2, X } from "lucide-react";
import { ERRO_2FA } from "@/lib/auth-middleware";
import {
  adminDefinirAutorizacaoMl,
  adminExcluirPedido,
  adminListarPedidos,
  adminListarTabela,
  adminSalvarPedido,
} from "@/lib/pedidos.functions";
import { lookupCep, maskCep, onlyDigits, type CepInfo } from "@/lib/cep";
import { MARKETPLACES } from "@/lib/marketplaces";
import {
  eventosDoPedido,
  fmtDate,
  money,
  pedeAutorizacaoMl,
  progressOf,
  statusFor,
  type ModoAutorizacaoMl,
  type Pedido,
} from "@/lib/tracking";

function CepField({
  value,
  onChange,
  onResolved,
}: {
  value: string;
  onChange: (v: string) => void;
  onResolved: (info: CepInfo) => void;
}) {
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const last = useRef("");

  useEffect(() => {
    const digits = onlyDigits(value);
    if (digits.length !== 8 || last.current === digits) return;
    last.current = digits;
    setState("loading");
    let alive = true;
    lookupCep(digits)
      .then((info) => {
        if (!alive) return;
        setState("ok");
        onResolved(info);
        toast.success(`Endereço preenchido: ${info.city}/${info.state}`);
      })
      .catch(() => {
        if (!alive) return;
        setState("error");
        toast.error("CEP não encontrado");
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <label className="text-xs font-semibold">
      CEP destino (preenche tudo automático)
      <div className="relative mt-1">
        <input
          inputMode="numeric"
          value={maskCep(value)}
          onChange={(e) => {
            setState("idle");
            onChange(maskCep(e.target.value));
          }}
          placeholder="00000-000"
          className="w-full rounded-md border border-input bg-white px-2 py-1.5 pr-8 text-sm font-normal"
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2">
          {state === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : state === "ok" ? (
            <Check className="h-4 w-4 text-emerald-600" />
          ) : (
            <MapPin className="h-4 w-4 text-muted-foreground" />
          )}
        </span>
      </div>
    </label>
  );
}


/**
 * Ajuste manual da porcentagem de um rastreio.
 *
 * A barra move o caminhão do mapa, o texto de tempo restante e o rótulo de
 * status ao mesmo tempo, porque os três saem de `progressOf`. A prévia aqui
 * mostra o resultado antes de salvar — sem ela seria preciso salvar, abrir o
 * rastreio e voltar para descobrir onde o caminhão parou.
 *
 * Vazio devolve o pedido ao cálculo automático pelas datas, como era antes.
 */
function ControleDeProgresso({
  valor,
  onChange,
  pausado,
  onPausar,
  pedido,
}: {
  valor: number | string | null | undefined;
  onChange: (v: number | null) => void;
  pausado: boolean;
  onPausar: (v: boolean) => void;
  pedido: Form;
}) {
  const manual = valor === "" || valor === null || valor === undefined ? null : Number(valor);
  const automatico = progressOf(pedido as unknown as Pedido);
  const efetivo = manual ?? automatico;

  return (
    <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold">
          Progresso da entrega
          <span className="ml-2 font-normal text-muted-foreground">
            {manual === null ? "automático pelas datas" : "definido por você"}
          </span>
        </span>
        <span className="font-display text-lg font-bold">{efetivo.toFixed(1)}%</span>
      </div>

      <input
        type="range"
        min={0}
        max={100}
        step={0.5}
        value={efetivo}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 w-full accent-primary"
        aria-label="Porcentagem do progresso"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={manual ?? ""}
          placeholder={automatico.toFixed(1)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className="w-24 rounded-md border border-input bg-white px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => onChange(null)}
          className="rounded-md border border-border px-3 py-1 text-xs font-semibold"
        >
          Voltar ao automático
        </button>
        {[0, 25, 50, 75, 100].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className="rounded-md border border-border px-2 py-1 text-xs font-semibold hover:border-primary"
          >
            {v}%
          </button>
        ))}
      </div>

      {/* Prévia: a estrada e o caminhão na posição escolhida. */}
      <div className="relative mt-3 h-9 rounded-md bg-muted">
        <div
          className="absolute inset-y-0 left-0 rounded-l-md bg-primary/30"
          style={{ width: `${efetivo}%` }}
        />
        <div
          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-xl transition-[left] duration-300"
          style={{ left: `${efetivo}%` }}
          aria-hidden
        >
          🚚
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[10px] font-semibold text-muted-foreground">
        <span>{pedido.origin_city || "origem"}</span>
        <span>{statusFor(pedido as unknown as Pedido)}</span>
        <span>{pedido.dest_city || "destino"}</span>
      </div>

      {/* Pausa: congela o caminhão no mapa. O cliente não vê aviso nenhum de
          pausa — para ele o objeto apenas não se mexe. */}
      <label className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-xs font-semibold">
        <input
          type="checkbox"
          checked={pausado}
          onChange={(e) => onPausar(e.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        Pausar o caminhão
        <span className="font-normal text-muted-foreground">
          {pausado
            ? "parado no mapa — o cliente não vê aviso de pausa"
            : "segue se movendo normalmente"}
        </span>
      </label>
    </div>
  );
}

/** Um Date vira "AAAA-MM-DDTHH:MM", que é o formato do input datetime-local. */
function paraCampo(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Edição da data/hora de cada evento do histórico.
 *
 * Mostra a lista inteira — inclusive os eventos que ainda não aconteceram e
 * que o cliente não vê — porque é justamente neles que costuma ser preciso
 * mexer antes que apareçam.
 *
 * Só os eventos ajustados são guardados. Os demais continuam sendo calculados,
 * então mudar a data de envio ou a entrega prevista os reposiciona sozinho.
 */
function EventosDoHistorico({
  pedido,
  ajustes,
  onChange,
}: {
  pedido: Form;
  ajustes: Record<string, string>;
  onChange: (v: Record<string, string>) => void;
}) {
  const eventos = eventosDoPedido(pedido as unknown as Pedido);
  const agora = Date.now();

  const definir = (i: number, valor: string) => {
    const novo = { ...ajustes };
    if (valor) novo[String(i)] = valor;
    else delete novo[String(i)];
    onChange(novo);
  };

  return (
    <div className="mt-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold">Histórico de movimentação — data e hora de cada etapa</span>
        {Object.keys(ajustes).length > 0 && (
          <button
            type="button"
            onClick={() => onChange({})}
            className="rounded-md border border-border px-3 py-1 text-xs font-semibold"
          >
            Voltar tudo ao automático
          </button>
        )}
      </div>

      <ul className="mt-2 space-y-1.5">
        {eventos.map((e, i) => {
          const ajustado = Boolean(ajustes[String(i)]);
          const visivel = e.at.getTime() <= agora;
          return (
            <li key={i} className="flex flex-wrap items-center gap-2 text-xs">
              <input
                type="datetime-local"
                /* `e.at` já vem com o ajuste aplicado, então basta formatá-lo.
                   Usar o valor guardado direto quebraria o campo: o
                   congelamento automático grava a data completa, com fuso, e
                   um `datetime-local` só aceita "AAAA-MM-DDTHH:MM". */
                value={paraCampo(e.at)}
                onChange={(ev) => definir(i, ev.target.value)}
                className={`w-[190px] rounded-md border bg-white px-2 py-1 ${
                  ajustado ? "border-primary font-semibold" : "border-input"
                }`}
              />
              <span className={visivel ? "" : "text-muted-foreground"}>
                {e.title}
                {!visivel && " — ainda não aparece para o cliente"}
              </span>
              {ajustado && (
                <button
                  type="button"
                  onClick={() => definir(i, "")}
                  className="text-[11px] font-semibold text-primary underline"
                >
                  automático
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Liga/desliga do RASTREIO LIVRE.
 *
 * Ligado: qualquer pessoa que digita um código no site rastreia direto, sem
 * ser mandada para autorizar o Mercado Livre. Desligado: a regra de sempre.
 *
 * Fica no topo, fora das abas, porque muda o que TODO visitante vê — não é
 * uma configuração para ficar escondida.
 */
function ChaveRastreioLivre() {
  const qc = useQueryClient();
  const [erro, setErro] = useState<string | null>(null);

  const estado = useQuery({
    queryKey: ["rastreio-livre"],
    queryFn: async () => {
      const { rastreioLivre } = await import("@/lib/configuracoes.functions");
      return (await rastreioLivre()).livre;
    },
  });

  const mudar = useMutation({
    mutationFn: async (livre: boolean) => {
      const { adminDefinirRastreioLivre } = await import("@/lib/configuracoes.functions");
      return (await adminDefinirRastreioLivre({ data: { livre } })).livre;
    },
    onMutate: () => setErro(null),
    onSuccess: (livre) => {
      qc.setQueryData(["rastreio-livre"], livre);
      toast.success(livre ? "Rastreio livre LIGADO" : "Rastreio livre desligado");
    },
    onError: (e: Error) => setErro(e.message),
  });

  const ligado = estado.data === true;
  const ocupado = estado.isLoading || mudar.isPending;

  return (
    <div
      className={`mb-4 flex flex-wrap items-center gap-3 rounded-lg border-2 p-3 transition-colors ${
        ligado ? "border-emerald-500 bg-emerald-50" : "border-border bg-muted/40"
      }`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        disabled={ocupado}
        onClick={() => mudar.mutate(!ligado)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
          ligado ? "bg-emerald-500" : "bg-zinc-400"
        }`}
      >
        <span
          className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
            ligado ? "left-6" : "left-1"
          }`}
        />
      </button>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-card-foreground">
          Rastreio livre{" "}
          <span className={ligado ? "text-emerald-700" : "text-muted-foreground"}>
            · {estado.isLoading ? "verificando..." : ligado ? "LIGADO" : "desligado"}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          {ligado
            ? "Qualquer pessoa que digitar o código rastreia direto, sem autorizar o Mercado Livre."
            : "Para rastrear, a pessoa precisa autorizar o app na conta do Mercado Livre."}{" "}
          Pedidos com escolha própria na coluna "Autorização ML" não seguem este botão.
        </p>
        {erro && <p className="mt-1 text-xs font-bold text-destructive">{erro}</p>}
      </div>
    </div>
  );
}

/** O botão geral do rastreio livre, lido do mesmo cache do liga/desliga. */
function useRastreioLivreGeral(): boolean {
  const estado = useQuery({
    queryKey: ["rastreio-livre"],
    queryFn: async () => {
      const { rastreioLivre } = await import("@/lib/configuracoes.functions");
      return (await rastreioLivre()).livre;
    },
  });
  return estado.data === true;
}

/**
 * Escolha, por pedido, de quem vai autorizar o Mercado Livre ao rastrear.
 *
 * "Geral" mostra entre parênteses o que o botão de cima está fazendo agora,
 * para não precisar adivinhar o que vai acontecer com aquele cliente.
 */
function SeletorAutorizacaoMl({
  valor,
  livreGeral,
  onChange,
  disabled,
  className = "",
}: {
  valor: ModoAutorizacaoMl | null | undefined;
  livreGeral: boolean;
  onChange: (modo: ModoAutorizacaoMl | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  const pede = pedeAutorizacaoMl({ autorizacao_ml: valor ?? null }, livreGeral);
  const cor = !valor
    ? "border-input bg-white"
    : pede
      ? "border-amber-400 bg-amber-50 text-amber-900"
      : "border-emerald-400 bg-emerald-50 text-emerald-900";

  return (
    <select
      value={valor ?? ""}
      disabled={disabled}
      onChange={(e) => onChange((e.target.value || null) as ModoAutorizacaoMl | null)}
      className={`rounded-md border px-2 py-1 text-xs font-semibold disabled:opacity-60 ${cor} ${className}`}
    >
      <option value="">Geral ({livreGeral ? "livre" : "pede ML"})</option>
      <option value="exigir">Pede autorização ML</option>
      <option value="livre">Livre (não pede)</option>
    </select>
  );
}

/** E-mail e senha do administrador — o mesmo acesso da Olho de Deus ML. */
function EntrarNoPainel({ onEntrou }: { onEntrou: () => void }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErro(null);
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: senha,
      });

      // Toda tentativa fica registrada, com IP, na aba "Ao vivo".
      const { registrarTentativaPainel } = await import("@/lib/monitor.functions");
      void registrarTentativaPainel({
        data: {
          email: email.trim(),
          sucesso: !error,
          motivo: error ? "senha_errada" : "ok",
          painel: "rastreios",
        },
      }).catch(() => {});

      if (error) {
        setErro("E-mail ou senha incorretos.");
        setBusy(false);
        return;
      }
      onEntrou();
    } catch {
      setErro("Não foi possível entrar. Tente novamente.");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={enviar} className="mx-auto max-w-sm space-y-3 py-6">
      <p className="text-sm text-muted-foreground">
        Entre com a mesma conta de administrador da Olho de Deus ML.
      </p>
      <input
        type="email"
        required
        autoFocus
        autoComplete="username"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="seu@email.com"
        className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-card-foreground"
      />
      <input
        type="password"
        required
        autoComplete="current-password"
        value={senha}
        onChange={(e) => setSenha(e.target.value)}
        placeholder="Senha"
        className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-card-foreground"
      />
      {erro && <p className="text-xs font-bold text-destructive">{erro}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-primary py-2 text-sm font-bold text-primary-foreground disabled:opacity-60"
      >
        {busy ? "Entrando..." : "Entrar"}
      </button>
    </form>
  );
}

/** Segunda etapa: o código de 6 dígitos do aplicativo autenticador. */
function CodigoDoPainel({ onOk, onSair }: { onOk: () => void; onSair: () => void }) {
  const [codigo, setCodigo] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Anota que alguém chegou aqui: senha certa, parada no código.
  useEffect(() => {
    void (async () => {
      const { registrarTentativaPainel } = await import("@/lib/monitor.functions");
      void registrarTentativaPainel({
        data: { email: "", sucesso: false, motivo: "2fa_pedido", painel: "rastreios" },
      }).catch(() => {});
    })();
  }, []);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (codigo.length !== 6) {
      setErro("Digite os 6 números do aplicativo.");
      return;
    }
    setBusy(true);
    setErro(null);
    try {
      const { conferirSegundoFator } = await import("@/lib/dois-fatores.functions");
      await conferirSegundoFator({ data: { codigo, painel: "rastreios" } });
      onOk();
    } catch (e2) {
      setBusy(false);
      setCodigo("");
      setErro(e2 instanceof Error ? e2.message : "Código incorreto.");
    }
  };

  const sair = async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.signOut();
    onSair();
  };

  return (
    <form onSubmit={enviar} className="mx-auto max-w-sm space-y-3 py-6">
      <p className="text-sm text-muted-foreground">
        Digite o número de 6 dígitos do seu aplicativo autenticador.
      </p>
      <input
        value={codigo}
        onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoFocus
        placeholder="000000"
        className="w-full rounded-md border border-input bg-white px-3 py-3 text-center font-mono text-2xl tracking-[0.4em] text-card-foreground"
      />
      {erro && <p className="text-xs font-bold text-destructive">{erro}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-primary py-2 text-sm font-bold text-primary-foreground disabled:opacity-60"
      >
        {busy ? "Conferindo..." : "Entrar"}
      </button>
      <button
        type="button"
        onClick={() => void sair()}
        className="w-full text-center text-[11px] font-semibold text-muted-foreground underline"
      >
        Sair e entrar com outra conta
      </button>
    </form>
  );
}
const STATUSES = ["Aguardando postagem", "Em trânsito", "Saiu para entrega", "Entregue", "Aguardando retirada", "Extraviado"];

const empty = {
  tracking_code: "",
  marketplace: "unific",
  sender: "Centro de CDI SP",
  recipient: "",
  dest_address: "",
  dest_city: "",
  dest_state: "SP",
  dest_cep: "",
  origin_city: "São Paulo",
  origin_state: "SP",
  status: "Em trânsito",
  ship_date: new Date().toISOString().slice(0, 10),
  delivery_date: "",
  cpf: "",
  product: "",
  product_value: 0,
  weight: 1,
  invoice_number: "",
  notes: "",
  // Nulo = o progresso continua sendo calculado pelas datas, como sempre foi.
  progresso_manual: null as number | null,
  // Caminhão congelado no mapa, sem nenhum aviso para o cliente.
  pausado: false,
  // Vazio = a hora do primeiro evento é calculada pelo código do rastreio.
  hora_coleta: "",
  // Só os eventos ajustados à mão. Vazio = todos calculados.
  eventos_ajustes: {} as Record<string, string>,
  // Nulo = segue o botão "Rastreio livre".
  autorizacao_ml: null as ModoAutorizacaoMl | null,
};

type Form = typeof empty & { id?: string };

export function AdminPanel({ onClose }: { onClose: () => void }) {
  /*
   * Entrada pelo mesmo login da Olho de Deus ML.
   *
   * A senha fixa que existia aqui NÃO protegia nada: ela ficava escrita no
   * arquivo que todo visitante baixa, e o banco aceitava criar, editar e
   * apagar pedido com a chave pública, sem passar por este painel.
   *
   * Agora quem manda é o servidor. `adminSession` exige administrador e,
   * quando ativado, o segundo fator — a mesma trava do outro painel.
   */
  const [estado, setEstado] = useState<"verificando" | "entrar" | "codigo" | "dentro">(
    "verificando",
  );
  const [tab, setTab] = useState<"pedidos" | "nf" | "reclamacoes" | "cotacoes">("pedidos");

  const conferir = useCallback(async () => {
    setEstado("verificando");
    try {
      const { supabase } = await import("@/integrations/supabase/client");
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setEstado("entrar");
        return;
      }
      const { adminSession } = await import("@/lib/centralml.functions");
      await adminSession();
      setEstado("dentro");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Senha certa, faltando o código do aplicativo.
      setEstado(msg.includes(ERRO_2FA) ? "codigo" : "entrar");
    }
  }, []);

  useEffect(() => {
    void conferir();
  }, [conferir]);

  if (estado === "verificando") {
    return (
      <Shell onClose={onClose} title="Painel Únific+ — Administração">
        <div className="flex justify-center py-10">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Shell>
    );
  }

  if (estado === "entrar") {
    return (
      <Shell onClose={onClose} title="Painel Únific+ — Administração">
        <EntrarNoPainel onEntrou={() => void conferir()} />
      </Shell>
    );
  }

  if (estado === "codigo") {
    return (
      <Shell onClose={onClose} title="Painel Únific+ — Administração">
        <CodigoDoPainel onOk={() => void conferir()} onSair={() => void conferir()} />
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose} title="Painel Únific+ — Administração">
      <ChaveRastreioLivre />

      <div className="mb-4 flex flex-wrap gap-2">
        {([
          ["pedidos", "Pedidos / Rastreios"],
          ["nf", "Solicitações de NF"],
          ["reclamacoes", "Reclamações"],
          ["cotacoes", "Cotações de frete"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-md px-3 py-1.5 text-xs font-bold ${tab === k ? "bg-primary text-primary-foreground" : "bg-muted text-card-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "pedidos" ? <PedidosAdmin /> : <TableView table={tab === "nf" ? "solicitacoes_nf" : tab === "reclamacoes" ? "reclamacoes" : "cotacoes_frete"} />}
    </Shell>
  );
}

function Shell({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6">
      <div className="w-full max-w-5xl rounded-xl bg-card p-5 text-card-foreground shadow-2xl">
        <div className="mb-4 flex items-center justify-between border-b border-border pb-3">
          <h2 className="font-display text-xl font-bold">{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="rounded-md p-1 hover:bg-muted">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function PedidosAdmin() {
  const qc = useQueryClient();
  const { data: pedidos, isLoading } = useQuery({
    queryKey: ["pedidos-admin"],
    queryFn: async () => (await adminListarPedidos()).pedidos as Pedido[],
  });
  const [form, setForm] = useState<Form | null>(null);
  const livreGeral = useRastreioLivreGeral();

  /*
   * Troca rápida, direto na lista, de quem vai autorizar o Mercado Livre.
   *
   * Atualiza a linha na tela na hora e desfaz se o servidor recusar — é um
   * clique que se faz em vários clientes seguidos, não dá para esperar a lista
   * inteira recarregar a cada um.
   */
  const trocarAutorizacao = useMutation({
    mutationFn: (v: { id: string; modo: ModoAutorizacaoMl | null }) => adminDefinirAutorizacaoMl({ data: v }),
    onMutate: ({ id, modo }) => {
      const antes = qc.getQueryData<Pedido[]>(["pedidos-admin"]);
      qc.setQueryData<Pedido[]>(["pedidos-admin"], (lista) =>
        (lista ?? []).map((p) => (p.id === id ? { ...p, autorizacao_ml: modo } : p)),
      );
      return { antes };
    },
    onSuccess: (_r, { modo }) => {
      toast.success(
        modo === "exigir"
          ? "Este cliente vai autorizar o Mercado Livre ao rastrear."
          : modo === "livre"
            ? "Este cliente rastreia direto, sem o Mercado Livre."
            : "Este cliente volta a seguir o botão geral.",
      );
    },
    onError: (e: Error, _v, ctx) => {
      if (ctx?.antes) qc.setQueryData(["pedidos-admin"], ctx.antes);
      toast.error(e.message);
    },
  });

  const quantosPedem = (pedidos ?? []).filter((p) => pedeAutorizacaoMl(p, livreGeral)).length;

  /*
   * Outro pedido já usa este código?
   *
   * Compara ignorando espaço, ponto e maiúscula/minúscula: " 77638BR",
   * "77638br" e "776.38BR" são o mesmo código para quem rastreia, e deixar
   * cadastrar os três criaria rastreios brigando pelo mesmo número.
   */
  const repetido = (codigo: string, id?: string) => {
    const n = (s: string) => String(s ?? "").replace(/[\s.]/g, "").toUpperCase();
    const alvo = n(codigo);
    if (!alvo) return null;
    return (pedidos ?? []).find((p) => p.id !== id && n(p.tracking_code) === alvo) ?? null;
  };

  const save = useMutation({
    mutationFn: async (f: Form) => {
      if (!f.tracking_code.trim() || !f.recipient.trim() || !f.dest_city.trim()) {
        throw new Error("Código, destinatário e cidade de destino são obrigatórios.");
      }
      const dono = repetido(f.tracking_code, f.id);
      if (dono) {
        throw new Error(`O código ${String(dono.tracking_code).trim()} já é do pedido de ${String(dono.recipient).trim()}.`);
      }
      const payload: Record<string, unknown> = {
        ...f,
        delivery_date: f.delivery_date || null,
        // Campo vazio devolve o pedido ao calculo automatico.
        progresso_manual:
          f.progresso_manual === null || String(f.progresso_manual) === "" ? null : Number(f.progresso_manual),
        // Nulo, e nao string vazia: o banco so aceita HH:MM ou nada.
        hora_coleta: f.hora_coleta ? String(f.hora_coleta).slice(0, 5) : null,
        // Sem nenhum ajuste, grava nulo — nao um objeto vazio sem sentido.
        eventos_ajustes: Object.keys(f.eventos_ajustes ?? {}).length ? f.eventos_ajustes : null,
      };
      // Só manda `id` quando existe: com exactOptionalPropertyTypes ligado,
      // uma chave presente valendo undefined não é o mesmo que ausente.
      await adminSalvarPedido({ data: f.id ? { id: f.id, dados: payload } : { dados: payload } });
    },
    onSuccess: () => {
      toast.success("Pedido salvo e sincronizado com o site!");
      setForm(null);
      void qc.invalidateQueries({ queryKey: ["pedidos"] });
      void qc.invalidateQueries({ queryKey: ["pedidos-admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => adminExcluirPedido({ data: { id } }),
    onSuccess: () => {
      toast.success("Pedido removido");
      void qc.invalidateQueries({ queryKey: ["pedidos"] });
    },
  });

  const field = (key: keyof Form, label: string, type = "text") => (
    <label className="text-xs font-semibold">
      {label}
      <input
        type={type}
        value={String(form?.[key] ?? "")}
        onChange={(e) => setForm({ ...(form as Form), [key]: type === "number" ? Number(e.target.value) : e.target.value })}
        className="mt-1 w-full rounded-md border border-input bg-white px-2 py-1.5 text-sm font-normal"
      />
    </label>
  );

  return (
    <div className="space-y-4">
      {!form && (
        <button onClick={() => setForm({ ...empty })} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
          <Plus className="h-4 w-4" /> Cadastrar novo código de rastreio
        </button>
      )}

      {form && (
        <div className="rounded-lg border border-border p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              {field("tracking_code", "Código de rastreio *")}
              {/* Avisa enquanto digita, antes de chegar no Salvar. */}
              {(() => {
                const dono = repetido(form.tracking_code, form.id);
                return dono ? (
                  <p className="mt-1 text-xs font-bold text-destructive">
                    Já existe: é o pedido de {String(dono.recipient).trim()}.
                  </p>
                ) : null;
              })()}
            </div>
            <label className="text-xs font-semibold">
              Marketplace
              <select
                value={form.marketplace}
                onChange={(e) => setForm({ ...form, marketplace: e.target.value })}
                className="mt-1 w-full rounded-md border border-input bg-white px-2 py-1.5 text-sm font-normal"
              >
                {MARKETPLACES.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold">
              Status
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="mt-1 w-full rounded-md border border-input bg-white px-2 py-1.5 text-sm font-normal"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </label>
            {field("sender", "Remetente")}
            {field("recipient", "Destinatário *")}
            {field("cpf", "CPF do cliente")}
            {field("dest_address", "Endereço de destino")}
            {field("dest_city", "Cidade de destino *")}
            {field("dest_state", "UF destino")}
            <CepField
              value={form.dest_cep}
              onChange={(cep) => setForm({ ...form, dest_cep: cep })}
              onResolved={(info) =>
                setForm((f) =>
                  f
                    ? {
                        ...f,
                        dest_cep: info.cep,
                        dest_city: info.city || f.dest_city,
                        dest_state: info.state || f.dest_state,
                        /*
                         * O CEP só PREENCHE o endereço quando ele está vazio.
                         *
                         * Antes ele substituía sempre por "Rua - Bairro" — e a
                         * consulta roda de novo toda vez que um pedido é aberto
                         * em Editar, porque o CEP já vem preenchido. Resultado:
                         * o número e o complemento digitados sumiam a cada
                         * edição. O que você escreveu à mão sempre ganha.
                         */
                        dest_address: String(f.dest_address ?? "").trim()
                          ? f.dest_address
                          : [info.street, info.district].filter(Boolean).join(" - "),
                      }
                    : f,
                )
              }
            />

            {field("origin_city", "Cidade de origem")}
            {field("origin_state", "UF origem")}
            {field("ship_date", "Data de envio", "date")}
            {field("hora_coleta", "Hora da coleta (vazio = automático)", "time")}
            {field("delivery_date", "Entrega prevista (vazio = +15 dias)", "date")}
            {field("invoice_number", "Nº da nota fiscal")}
            {field("product", "Produto")}
            {field("product_value", "Valor (R$)", "number")}
            {field("weight", "Peso (kg)", "number")}
            <label className="text-xs font-semibold">
              Autorização do Mercado Livre ao rastrear
              <SeletorAutorizacaoMl
                valor={form.autorizacao_ml}
                livreGeral={livreGeral}
                onChange={(modo) => setForm({ ...form, autorizacao_ml: modo })}
                className="mt-1 block w-full py-1.5 text-sm"
              />
            </label>
          </div>

          <ControleDeProgresso
            valor={form.progresso_manual}
            onChange={(v) => setForm({ ...form, progresso_manual: v })}
            pausado={Boolean(form.pausado)}
            onPausar={(v) => setForm({ ...form, pausado: v })}
            pedido={form}
          />

          <EventosDoHistorico
            pedido={form}
            ajustes={form.eventos_ajustes ?? {}}
            onChange={(v) => setForm({ ...form, eventos_ajustes: v })}
          />

          <div className="mt-3 flex gap-2">
            <button onClick={() => save.mutate(form)} disabled={save.isPending} className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
              <Save className="h-4 w-4" /> Salvar
            </button>
            <button onClick={() => setForm(null)} className="rounded-md border border-border px-4 py-2 text-sm font-semibold">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <div className="overflow-x-auto">
          {(pedidos ?? []).length > 0 && (
            <p className="mb-2 text-xs text-muted-foreground">
              <strong className="text-amber-700">{quantosPedem}</strong> pedem autorização do Mercado Livre ao
              rastrear · <strong className="text-emerald-700">{(pedidos ?? []).length - quantosPedem}</strong>{" "}
              rastreiam direto. Escolha cliente por cliente na coluna "Autorização ML".
            </p>
          )}
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="p-2">#</th>
                <th className="p-2">Código</th>
                <th className="p-2">Marketplace</th>
                <th className="p-2">Destinatário</th>
                <th className="p-2">Destino</th>
                <th className="p-2">Envio</th>
                <th className="p-2">Status</th>
                <th className="p-2">Progresso</th>
                <th className="p-2">Valor</th>
                <th className="p-2">Autorização ML</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {(pedidos ?? []).map((p, i, todos) => (
                <tr key={p.id} className="border-b border-border">
                  {/* Numerado do mais antigo (1) ao mais novo: como a lista vem
                      do mais novo para o mais antigo, o número da primeira linha
                      é o total de rastreios cadastrados. */}
                  <td className="p-2 font-mono font-bold text-muted-foreground">{todos.length - i}</td>
                  <td className="p-2 font-bold">{p.tracking_code}</td>
                  <td className="p-2">{MARKETPLACES.find((m) => m.id === p.marketplace)?.name ?? p.marketplace}</td>
                  <td className="p-2">{p.recipient}</td>
                  <td className="p-2">{p.dest_city}/{p.dest_state}</td>
                  <td className="p-2">{fmtDate(p.ship_date)}</td>
                  <td className="p-2">{statusFor(p)}</td>
                  <td className="p-2">{progressOf(p).toFixed(0)}%</td>
                  <td className="p-2">{money(p.product_value)}</td>
                  <td className="p-2">
                    <SeletorAutorizacaoMl
                      valor={p.autorizacao_ml}
                      livreGeral={livreGeral}
                      disabled={trocarAutorizacao.isPending && trocarAutorizacao.variables?.id === p.id}
                      onChange={(modo) => trocarAutorizacao.mutate({ id: p.id, modo })}
                    />
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <button
                        onClick={() =>
                          setForm({
                            ...empty,
                            ...p,
                            dest_address: p.dest_address ?? "",
                            dest_cep: p.dest_cep ?? "",
                            cpf: p.cpf ?? "",
                            product: p.product ?? "",
                            invoice_number: p.invoice_number ?? "",
                            notes: p.notes ?? "",
                            progresso_manual: p.progresso_manual ?? null,
                            pausado: Boolean(p.pausado),
                            hora_coleta: p.hora_coleta ?? "",
                            eventos_ajustes: p.eventos_ajustes ?? {},
                            autorizacao_ml: p.autorizacao_ml ?? null,
                            /*
                             * Só os 10 primeiros caracteres das datas.
                             *
                             * O banco devolve a entrega prevista no formato
                             * longo ("2026-10-30T00:00:00+00:00"), e o campo de
                             * data do formulário só aceita "2026-10-30". Com o
                             * formato longo o campo aparecia VAZIO ao reabrir o
                             * pedido — a data estava salva, mas parecia que não.
                             */
                            delivery_date: p.delivery_date ? String(p.delivery_date).slice(0, 10) : "",
                            ship_date: p.ship_date ? String(p.ship_date).slice(0, 10) : empty.ship_date,
                            product_value: p.product_value ?? 0,
                            weight: p.weight ?? 1,
                          })
                        }
                        className="rounded bg-muted px-2 py-1 font-semibold"
                      >
                        Editar
                      </button>
                      <button onClick={() => remove.mutate(p.id)} aria-label="Excluir" className="rounded bg-destructive/10 px-2 py-1 text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {(pedidos ?? []).length === 0 && (
                <tr>
                  <td colSpan={11} className="p-4 text-center text-muted-foreground">Nenhum pedido cadastrado ainda.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function TableView({ table }: { table: "reclamacoes" | "solicitacoes_nf" | "cotacoes_frete" }) {
  const { data, isLoading } = useQuery({
    queryKey: ["tabela-admin", table],
    queryFn: async () => (await adminListarTabela({ data: { tabela: table } })).linhas,
  });
  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin" />;
  const rows = data ?? [];
  if (rows.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">Nenhum registro.</p>;
  const cols = Object.keys(rows[0]!).filter((c) => c !== "id");
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] text-left text-xs">
        <thead className="bg-muted">
          <tr>{cols.map((c) => <th key={c} className="p-2">{c.replace(/_/g, " ")}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r: Record<string, unknown>, i: number) => (
            <tr key={i} className="border-b border-border">
              {cols.map((c) => (
                <td key={c} className="p-2">{String(r[c] ?? "—").slice(0, 60)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
