import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, FileText, LogIn, MessageSquareWarning, PackageSearch, Truck } from "lucide-react";
import { MARKETPLACES, getMarketplace } from "@/lib/marketplaces";
import { findPedido, findPedidosByCpf, insertTable } from "@/lib/api";
import { digitos, formatarCpf } from "@/lib/cpf";
import { rastrearMinhaCompraCompleta } from "@/lib/minha-conta.functions";
import { registrarConsultaRastreio } from "@/lib/rastreio.functions";
import { useSessao } from "@/lib/useSessao";
import { useCityCoords } from "@/lib/geo";
import {
  buildMovimentos,
  etaText,
  expectedDate,
  fmtDate,
  fmtDateTime,
  isMoving,
  progressOf,
  statusFor,
  type Movimento,
  type Pedido,
} from "@/lib/tracking";

import { ProgressRing } from "./ProgressRing";
import { NotaFiscal } from "./NotaFiscal";

const RouteMap = lazy(() => import("./RouteMap"));

function useHydrated() {
  const [h, setH] = useState(false);
  useEffect(() => setH(true), []);
  return h;
}

export function TrackingPanel() {
  const { autenticado } = useSessao();
  // `codeState` é o que está no campo; a busca usa uma cópia local (`code`)
  // para poder receber um código por argumento na retomada automática.
  const [codeState, setCode] = useState("");
  const code = codeState;
  const [mp, setMp] = useState<string>("unific");
  const [pedido, setPedido] = useState<Pedido | null>(null);
  // Eventos reais vindos da integração com o Mercado Livre (quando houver conta conectada)
  const [eventosReais, setEventosReais] = useState<Movimento[] | null>(null);
  const [tick, setTick] = useState(Date.now());
  const [view, setView] = useState<"map" | "nf" | "reclamacao">("map");
  // Quando o CPF tem mais de um pedido, o cliente escolhe qual acompanhar.
  const [escolhas, setEscolhas] = useState<Pedido[] | null>(null);
  const hydrated = useHydrated();

  useEffect(() => {
    document.documentElement.setAttribute("data-mp", mp);
  }, [mp]);

  /*
   * Retoma o rastreio depois de conectar o Mercado Livre.
   *
   * Quem clicou em "RASTREAR AGORA" sem conta foi para a tela de entrada com o
   * código guardado. Ao voltar já autenticado, o código volta preenchido e a
   * busca dispara sozinha — o cliente não precisa digitar de novo.
   */
  useEffect(() => {
    if (!autenticado) return;
    let pendente: string | null = null;
    try {
      pendente = sessionStorage.getItem("unific:rastreio-pendente");
      if (pendente) sessionStorage.removeItem("unific:rastreio-pendente");
    } catch {
      pendente = null;
    }
    if (pendente) {
      const so = digitos(pendente);
      // Retoma do mesmo jeito que teria acontecido se a pessoa já estivesse
      // logada: 11 dígitos voltam como CPF, o resto como código de rastreio.
      if (so.length === 11) {
        setCode(formatarCpf(so));
        buscaPorCpf.mutate(so);
      } else {
        setCode(pendente);
        setMp("mercado_livre");
        search.mutate(pendente);
      }
    }
    // Só na virada para autenticado; não depende de mais nada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autenticado]);

  // O relógio só roda quando há um pedido na tela, e a cada 20s em vez de 1s:
  // os textos de ETA/progresso mudam por minuto, então 1s só causava re-render
  // do painel e do mapa inteiro a cada segundo (travava os cliques).
  useEffect(() => {
    if (!pedido) return;
    const t = setInterval(() => setTick(Date.now()), 20000);
    return () => clearInterval(t);
  }, [pedido]);

  const search = useMutation({
    // O código pode vir por argumento (retomada depois de conectar) em vez do
    // estado: assim a busca não depende do React já ter re-renderizado.
    mutationFn: async (codigoRetomado?: string) => {
      const code = (codigoRetomado ?? codeState).trim();
      if (!code) throw new Error("Digite o código de rastreio");

      // O registro da consulta alimenta o "Rastreamento ao vivo" da CentralML.
      // Nunca pode quebrar a busca do cliente — por isso o catch silencioso.
      const registrar = (
        args: Parameters<typeof registrarConsultaRastreio>[0]["data"],
      ) => registrarConsultaRastreio({ data: args }).catch(() => undefined);

      // 1) Códigos cadastrados no painel do Únific+ (tabela `pedidos`).
      //    Continua público: quem tem o código rastreia, sem precisar de conta.
      const local = await findPedido(code, undefined);
      if (local) {
        void registrar({
          code: code.trim(),
          marketplace: local.marketplace,
          found: true,
          source: "local",
          status: local.status,
        });
        return { pedido: local, compraId: null as string | null, eventos: null as Movimento[] | null };
      }

      // 2) Compras do Mercado Livre — SOMENTE da conta do cliente autenticado.
      //    Nunca busca em contas de outros clientes.
      if (autenticado) {
        const ml = await rastrearMinhaCompraCompleta({ data: { codigo: code.trim() } });
        if (ml) {
          void registrar({
            code: code.trim(),
            marketplace: "mercado_livre",
            found: true,
            source: "mercado_livre",
            status: ml.pedido.status,
          });
          return {
            pedido: ml.pedido as unknown as Pedido,
            compraId: ml.compraId,
            eventos: ml.eventos.map((e: { at: string; title: string; place: string }) => ({
              at: new Date(e.at),
              title: e.title,
              place: e.place,
              done: true,
            })) as Movimento[],
          };
        }
      }

      void registrar({ code: code.trim(), found: false, source: "nao_encontrado" });
      throw new Error(
        autenticado
          ? "Código não encontrado nos rastreios cadastrados nem nas suas compras do Mercado Livre."
          : "Código não encontrado. Se for uma compra sua do Mercado Livre, entre na sua conta para rastrear.",
      );
    },
    onSuccess: ({ pedido: p, eventos }) => {
      setEventosReais(eventos);
      setPedido(p);
      setMp(p.marketplace);
      setView("map");
      toast.success(`Pedido ${p.tracking_code} localizado!`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /**
   * Busca os pedidos cadastrados no CPF informado.
   *
   * Um resultado abre direto; vários viram uma lista para o cliente escolher.
   * Vale só para os rastreios cadastrados no painel (tabela `pedidos`) — as
   * compras do Mercado Livre não têm CPF, elas vêm pela conta conectada.
   */
  const buscaPorCpf = useMutation({
    mutationFn: async (cpf: string) => {
      const encontrados = await findPedidosByCpf(cpf);
      if (!encontrados.length) {
        throw new Error("Nenhum rastreio cadastrado para este CPF.");
      }
      return encontrados;
    },
    onSuccess: (encontrados) => {
      const primeiro = encontrados[0];
      if (encontrados.length === 1 && primeiro) {
        abrirPedido(primeiro);
        toast.success(`Pedido ${primeiro.tracking_code} localizado!`);
        return;
      }
      setEscolhas(encontrados);
      toast.success(`${encontrados.length} pedidos encontrados neste CPF.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /** Coloca um pedido na tela, venha ele da busca por código ou por CPF. */
  const abrirPedido = (p: Pedido) => {
    setEscolhas(null);
    setEventosReais(null);
    setPedido(p);
    setMp(p.marketplace);
    setView("map");
  };

  /*
   * Rastrear sem conta vai DIRETO autorizar no Mercado Livre.
   *
   * Compra do Mercado Livre só aparece na conta de quem comprou. Então, para
   * quem ainda não entrou, o clique em "RASTREAR AGORA" não faz uma busca que
   * sempre daria "não encontrado", nem manda preencher cadastro: leva para a
   * mesma tela de autorização do botão "Conectar Mercado Livre".
   *
   * O acesso do Únific+ é criado no callback, a partir da conta que autorizou.
   * O código digitado fica guardado para a busca ser refeita sozinha na volta.
   */
  const [indoParaMl, setIndoParaMl] = useState(false);

  /**
   * Leva o visitante à autorização do Mercado Livre, guardando o que ele
   * digitou (código ou CPF) para a busca ser refeita sozinha na volta.
   */
  const irParaAutorizacaoMl = async (pendente: string) => {
    setIndoParaMl(true);
    try {
      sessionStorage.setItem("unific:rastreio-pendente", pendente);
    } catch {
      /* aba anônima: segue sem a retomada automática. */
    }

    try {
      const { startMlConnectPublico } = await import("@/lib/ml.functions");
      const { authorizationUrl } = await startMlConnectPublico();
      window.location.href = authorizationUrl;
    } catch (e) {
      setIndoParaMl(false);
      toast.error(
        e instanceof Error ? e.message : "Não foi possível abrir a autorização do Mercado Livre.",
      );
    }
  };

  const rastrear = async () => {
    const digitado = code.trim();

    if (!digitado) {
      toast.error("Digite o código de rastreio ou o CPF");
      return;
    }

    /*
     * O mesmo campo aceita código de rastreio OU CPF (11 dígitos).
     *
     * O CPF inteiro é exigido de propósito: aceitar parte dele transformaria o
     * campo numa varredura, dando para tentar sequências até cair no pedido de
     * alguém. Não exigimos os dígitos verificadores porque há CPF já cadastrado
     * no painel que não passa nessa conta — a validação recusaria pedido real.
     */
    const soDigitos = digitos(digitado);
    const ehCpf = soDigitos.length === 11;

    /*
     * Deslogado, os DOIS caminhos passam antes pela autorização do Mercado
     * Livre — código e CPF sem distinção. O que a pessoa digitou fica guardado
     * e a busca é refeita sozinha na volta, já com a conta conectada.
     */
    if (!autenticado) {
      await irParaAutorizacaoMl(ehCpf ? soDigitos : digitado);
      return;
    }

    if (ehCpf) {
      buscaPorCpf.mutate(soDigitos);
      return;
    }

    search.mutate(undefined);
  };

  const progress = pedido ? progressOf(pedido, tick) : 0;
  const movimentos = useMemo(
    () => (eventosReais?.length ? eventosReais : pedido ? buildMovimentos(pedido, tick) : []),
    [pedido, tick, eventosReais],
  );

  /*
   * Coordenadas reais de origem e destino.
   *
   * Antes vinham de `coordsFor`, que só conhecia uma lista curta de cidades e,
   * para as demais, deslocava a capital do estado ao acaso — o pino de
   * Matozinhos/MG caía ao sul de BH, e a cidade fica ao norte.
   *
   * `useCityCoords` mostra a capital de imediato (sem esperar rede) e, assim
   * que a consulta responde, corrige para a posição verdadeira da cidade.
   *
   * Os hooks ficam aqui em cima, fora do `if (pedido)`: React exige que a
   * ordem de chamada seja sempre a mesma, e dentro do if eles seriam
   * condicionais.
   */
  const from = useCityCoords(pedido?.origin_city ?? "", pedido?.origin_state ?? "");
  const to = useCityCoords(pedido?.dest_city ?? "", pedido?.dest_state ?? "");

  if (pedido) {
    const mk = getMarketplace(pedido.marketplace);

    return (
      <section id="rastreio" className="card-panel mx-auto mt-5 max-w-5xl p-5 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <div>
            <h2 className="font-display text-2xl font-bold">Rastreando: {pedido.tracking_code}</h2>
            <p className="text-sm text-muted-foreground">
              {mk.name} · {mk.carrier}
            </p>
          </div>
          <span className="rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground">
            {statusFor(pedido, tick)}
          </span>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 text-sm">
            <p><strong>Remetente:</strong> {pedido.sender}</p>
            <p><strong>Destinatário:</strong> {pedido.recipient}</p>
            <p>
              <strong>Endereço destino:</strong> {pedido.dest_city}, {pedido.dest_state}
              {pedido.dest_cep ? ` CEP ${pedido.dest_cep}` : ""}
              {pedido.dest_address ? `, ${pedido.dest_address}` : ""}
            </p>
            <p><strong>Produto:</strong> {pedido.product ?? "—"}</p>
            <p><strong>Data de envio:</strong> {fmtDate(pedido.ship_date)}</p>
            <p><strong>Data de entrega prevista:</strong> {fmtDate(expectedDate(pedido))}</p>
          </div>
          <div className="flex items-center gap-4 rounded-lg bg-muted p-4">
            <ProgressRing value={progress} />
            <div className="text-sm">
              <p className="font-display text-base font-bold">Progresso da entrega: {progress.toFixed(1)}%</p>
              <p className="text-muted-foreground">
                Última atualização: {movimentos[0] ? fmtDateTime(movimentos[0].at) : "Ainda não atualizada"}
              </p>
              <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                <Truck className="h-3.5 w-3.5" />
                {isMoving(pedido, tick) ? "Carga em movimento agora" : "Parada operacional (23h–6h)"} · {etaText(pedido, tick)}
              </p>

            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => setView("reclamacao")}
            className="inline-flex items-center gap-2 rounded-md bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground"
          >
            <MessageSquareWarning className="h-4 w-4" /> Abrir Reclamação
          </button>
          <button
            onClick={() => setView("nf")}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
          >
            <FileText className="h-4 w-4" /> Baixar Nota Fiscal
          </button>
          <button
            onClick={() => {
              setPedido(null);
              setEventosReais(null);
              setCode("");
              setMp("unific");
            }}
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-semibold"
          >
            <ArrowLeft className="h-4 w-4" /> Nova busca
          </button>
        </div>

        <div className="mt-5">
          {view === "map" && (
            <div className="overflow-hidden rounded-lg border border-border">
              {hydrated ? (
                <Suspense fallback={<div className="h-72 animate-pulse bg-muted" />}>
                  <RouteMap
                    from={from}
                    to={to}
                    progress={progress}
                    moving={isMoving(pedido, tick)}
                    eta={etaText(pedido, tick)}
                    fromLabel={`${pedido.origin_city} / ${pedido.origin_state}`}
                    toLabel={`${pedido.dest_city} / ${pedido.dest_state}`}
                  />

                </Suspense>
              ) : (
                <div className="h-72 bg-muted" />
              )}
            </div>
          )}
          {view === "nf" && <NotaFiscal pedido={pedido} />}
          {view === "reclamacao" && <ReclamacaoForm pedido={pedido} onDone={() => setView("map")} />}
        </div>

        <div className="mt-6">
          <h3 className="font-display text-lg font-bold">Histórico de movimentação</h3>
          <ol className="mt-3 space-y-3 border-l-2 border-primary/40 pl-4">
            {movimentos.map((m, i) => (
              <li key={i} className="relative">
                <span
                  className={`absolute -left-[22px] top-1.5 h-3 w-3 rounded-full border-2 border-card ${i === 0 ? "bg-primary" : "bg-muted-foreground/50"}`}
                />
                <p className="text-sm font-semibold">{m.title}</p>
                <p className="text-xs text-muted-foreground">
                  {m.place} — {fmtDateTime(m.at)}
                </p>
              </li>
            ))}
            {movimentos.length === 0 && (
              <li className="text-sm text-muted-foreground">Objeto ainda não possui movimentação registrada.</li>
            )}
          </ol>
        </div>
      </section>
    );
  }

  return (
    <section id="rastreio" className="card-panel mx-auto mt-5 max-w-5xl p-6 sm:p-8">
      <div className="flex flex-col items-center text-center">
        
        <h2 className="mt-3 font-display text-2xl font-bold">Rastreamento De Compras!</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Acompanhe sua entrega em tempo real. Digite o código de rastreio abaixo.
        </p>
      </div>

      {/* Explica o que vai acontecer ao clicar em rastrear sem estar logado:
          o visitante é levado ao Mercado Livre para autorizar. Sem cadastro,
          sem formulário — quem prefere entrar por e-mail e senha ainda tem o
          link ao lado. */}
      {!autenticado && (
        <div className="mx-auto mt-5 max-w-2xl rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground">
            Ao rastrear, você autoriza o Únific+ na sua conta do Mercado Livre — sem criar cadastro.{" "}
            <Link to="/entrar" className="inline-flex items-center gap-1 font-bold text-primary underline">
              <LogIn className="h-3 w-3" /> Já tenho conta
            </Link>
          </p>
        </div>
      )}

      <div className="mx-auto mt-6 max-w-2xl space-y-5">
        <div>
          <label htmlFor="code" className="text-sm font-bold">
            1. Digite seu código de rastreio ou seu CPF:
          </label>
          <input
            id="code"
            value={code}
            maxLength={40}
            /* Só formata quando o que foi digitado é claramente um CPF: um
               código de rastreio pode ter números, e pontuar ele atrapalharia. */
            onChange={(e) => {
              const bruto = e.target.value;
              const so = digitos(bruto);
              const pareceCpf = so.length >= 4 && so.length <= 11 && /^[\d.\-\s]*$/.test(bruto);
              setCode(pareceCpf ? formatarCpf(so) : bruto);
            }}
            onKeyDown={(e) => e.key === "Enter" && void rastrear()}
            placeholder="Ex: 954321 ou 123.456.789-09"
            className="mt-2 w-full rounded-md border border-input bg-white px-3 py-2.5 text-sm text-card-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
        </div>

        <div>
          <p className="text-center text-sm font-bold">2. Selecione onde você comprou:</p>
          <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-6">
            {MARKETPLACES.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setMp(m.id)}
                className={`flex h-20 flex-col items-center justify-center gap-1 rounded-lg border-2 bg-white px-1 transition-all ${
                  mp === m.id ? "border-primary shadow-md ring-2 ring-primary/25" : "border-border hover:border-primary/50"
                }`}
              >
                {m.logo}
                <span className="text-[10px] font-semibold text-card-foreground">{m.name}</span>
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => void rastrear()}
          disabled={search.isPending || buscaPorCpf.isPending || indoParaMl}
          className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary py-3 font-display text-base font-bold tracking-wide text-primary-foreground transition-transform hover:scale-[1.01] disabled:opacity-60"
        >
          <PackageSearch className="h-5 w-5" />
          {indoParaMl
            ? "ABRINDO O MERCADO LIVRE..."
            : search.isPending || buscaPorCpf.isPending
              ? "BUSCANDO..."
              : "RASTREAR AGORA"}
        </button>

        {/* Vários pedidos no mesmo CPF: o cliente escolhe qual acompanhar. */}
        {escolhas && escolhas.length > 0 && (
          <div className="rounded-lg border border-border p-3">
            <p className="text-sm font-bold">
              {escolhas.length} pedidos neste CPF — escolha qual acompanhar:
            </p>
            <ul className="mt-2 space-y-2">
              {escolhas.map((p) => (
                <li key={p.id ?? p.tracking_code}>
                  <button
                    onClick={() => abrirPedido(p)}
                    className="w-full rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:border-primary hover:bg-primary/5"
                  >
                    <span className="font-bold">{p.tracking_code}</span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {getMarketplace(p.marketplace).name}
                      {p.product ? ` · ${p.product}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-center text-xs font-bold text-destructive">
          * Caso não tenha o código, pedir ao seu vendedor!
        </p>
      </div>
    </section>
  );
}

function ReclamacaoForm({ pedido, onDone }: { pedido: Pedido; onDone: () => void }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const send = useMutation({
    mutationFn: async () => {
      if (!form.name.trim() || form.message.trim().length < 10) throw new Error("Preencha nome e uma descrição com pelo menos 10 caracteres.");
      await insertTable("reclamacoes", { ...form, tracking_code: pedido.tracking_code });
    },
    onSuccess: () => {
      toast.success("Reclamação registrada! Nosso SAC responde em até 48h.");
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="rounded-lg border border-border p-4">
      <h3 className="font-display text-lg font-bold">Abrir reclamação — pedido {pedido.tracking_code}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <input maxLength={100} placeholder="Seu nome completo" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-md border border-input bg-white px-3 py-2 text-sm text-card-foreground" />
        <input maxLength={255} placeholder="seu@email.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-md border border-input bg-white px-3 py-2 text-sm text-card-foreground" />
        <input maxLength={20} placeholder="(00) 00000-0000" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-md border border-input bg-white px-3 py-2 text-sm text-card-foreground" />
      </div>
      <textarea
        maxLength={1000}
        rows={4}
        placeholder="Descreva o ocorrido"
        value={form.message}
        onChange={(e) => setForm({ ...form, message: e.target.value })}
        className="mt-3 w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-card-foreground"
      />
      <button onClick={() => send.mutate()} disabled={send.isPending} className="mt-3 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
        Enviar reclamação
      </button>
    </div>
  );
}
