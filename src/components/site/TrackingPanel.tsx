import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, FileText, LogIn, MessageSquareWarning, PackageSearch, Truck } from "lucide-react";
import { MARKETPLACES, getMarketplace } from "@/lib/marketplaces";
import { findPedido, findPedidosByCpf, insertTable } from "@/lib/api";
import { digitos, formatarCpf } from "@/lib/cpf";
import { minhaConexao, rastrearMinhaCompraCompleta } from "@/lib/minha-conta.functions";
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
  // Mercado Livre já vem marcado: é o primeiro cartão e a origem da maioria
  // dos rastreios, então abrir com ele selecionado poupa um clique.
  const [mp, setMp] = useState<string>("mercado_livre");
  const [pedido, setPedido] = useState<Pedido | null>(null);
  // Eventos reais vindos da integração com o Mercado Livre (quando houver conta conectada)
  const [eventosReais, setEventosReais] = useState<Movimento[] | null>(null);
  const [tick, setTick] = useState(Date.now());
  const [view, setView] = useState<"map" | "nf" | "reclamacao">("map");
  // Quando o CPF tem mais de um pedido, o cliente escolhe qual acompanhar.
  const [escolhas, setEscolhas] = useState<Pedido[] | null>(null);
  const hydrated = useHydrated();

  /*
   * O PONTO FINAL É A AUTORIZAÇÃO DO APP NO MERCADO LIVRE.
   *
   * Ter conta criada não basta: sem a conexão feita, o rastreio não abre. Quem
   * clicar em rastrear sem ela vai direto para a tela de autorização — o mesmo
   * destino do botão "Conectar Mercado Livre".
   *
   * A trava é a conexão EXISTIR, não a sincronização ter terminado. Se fosse
   * a sincronização, uma carga inicial interrompida (o servidor reinicia e ela
   * roda solta, sem ninguém esperando) trancaria aquele cliente para sempre,
   * em círculo: rastreia, vai autorizar, volta e continua travado.
   */
  const conexao = useQuery({
    queryKey: ["minha-conexao"],
    queryFn: () => minhaConexao(),
    staleTime: 30_000,
    enabled: autenticado,
  });

  /*
   * RASTREIO LIVRE — o botão do painel que solta a trava acima.
   *
   * Ligado lá, qualquer pessoa rastreia direto, sem passar pelo Mercado Livre.
   * A pergunta vai ao servidor, que responde só sim/não; qualquer falha vira
   * "não", mantendo a regra de sempre.
   */
  const livre = useQuery({
    queryKey: ["rastreio-livre"],
    queryFn: async () => {
      const { rastreioLivre } = await import("@/lib/configuracoes.functions");
      return (await rastreioLivre()).livre;
    },
    staleTime: 30_000,
  });

  const conectado = Boolean(conexao.data?.conectado);
  const liberado = livre.data === true || conectado;
  // Enquanto as consultas não respondem não se sabe se o rastreio está livre
  // nem se há conexão — mandar para o Mercado Livre nessa dúvida tiraria da
  // tela quem não precisava ir.
  const verificandoConexao = livre.isLoading || (autenticado && conexao.isLoading);

  useEffect(() => {
    document.documentElement.setAttribute("data-mp", mp);
  }, [mp]);

  /*
   * Retoma o rastreio depois de autorizar no Mercado Livre.
   *
   * Quem clicou em "RASTREAR AGORA" sem a conexão foi para o Mercado Livre com
   * o que digitou guardado. Ao voltar conectado, o campo volta preenchido e a
   * busca dispara sozinha — sem digitar de novo.
   */
  useEffect(() => {
    // Espera a conexão aparecer: retomar antes cairia na mesma trava e
    // devolveria a pessoa ao Mercado Livre, em círculo.
    if (!liberado) return;
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
    // Dispara na virada para conectado, não no login: a conexão é consultada
    // por rede e fica pronta depois dele.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liberado]);

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

      /*
       * A busca olha SÓ os rastreios cadastrados no painel (tabela `pedidos`).
       *
       * É o rastreio da transportadora, e ele é separado das compras que o
       * cliente tem no Mercado Livre. Antes, quando o código não estava
       * cadastrado, a busca ainda ia procurar nas compras dele — misturando
       * duas coisas que não têm relação e trazendo um pedido que não é deste
       * rastreio.
       *
       * Como consequência, a sincronização do Mercado Livre deixou de
       * interferir aqui: se ela estiver incompleta, o rastreio segue igual.
       */
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

      void registrar({ code: code.trim(), found: false, source: "nao_encontrado" });
      throw new Error("Código não encontrado. Confira os números e tente de novo.");
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

  const [indoParaMl, setIndoParaMl] = useState(false);

  /**
   * Leva a pessoa à autorização do app no Mercado Livre.
   *
   * Guarda o que ela digitou (código ou CPF) para a busca ser refeita sozinha
   * na volta, sem precisar digitar de novo.
   *
   * Dois fluxos, escolhidos pelo estado dela:
   *  - já entrou  → `startMlConnect`, que amarra a conexão ao cadastro dela;
   *  - sem conta  → `startMlConnectPublico`, que cria o acesso a partir da
   *                 própria conta que autorizar, sem formulário no caminho.
   */
  const irParaAutorizacaoMl = async (pendente: string) => {
    setIndoParaMl(true);
    try {
      sessionStorage.setItem("unific:rastreio-pendente", pendente);
    } catch {
      /* aba anônima: segue sem a retomada automática. */
    }

    try {
      const ml = await import("@/lib/ml.functions");
      const { authorizationUrl } = autenticado
        ? await ml.startMlConnect()
        : await ml.startMlConnectPublico();
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
     * Sem a conexão do Mercado Livre, nada é rastreado — por código ou por
     * CPF, sem distinção. Vale tanto para quem não tem conta quanto para quem
     * criou conta e nunca autorizou o app: os dois vão para a autorização.
     */
    if (verificandoConexao) {
      toast.info("Um instante, preparando o rastreio...");
      return;
    }

    if (!liberado) {
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
              setEscolhas(null);
              // Mesmo estado inicial da tela, para "Nova busca" devolver
              // exatamente o que o cliente veria ao abrir o site.
              setMp("mercado_livre");
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

      {/* Um aviso só, para os dois casos que ainda não podem rastrear: quem não
          tem conta e quem tem conta mas nunca autorizou o app. Os dois vão para
          a mesma tela ao clicar em rastrear, então a mensagem é a mesma. */}
      {!liberado && !verificandoConexao && (
        <div className="mx-auto mt-5 max-w-2xl rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground">
            Ao rastrear, você autoriza o Únific+ na sua conta do Mercado Livre.
            {!autenticado && (
              <>
                {" "}
                <Link
                  to="/entrar"
                  className="inline-flex items-center gap-1 font-bold text-primary underline"
                >
                  <LogIn className="h-3 w-3" /> Já tenho conta
                </Link>
              </>
            )}
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
            /* O campo NÃO pontua nada sozinho.
               A máscara antiga tratava qualquer sequência de 4 a 11 números
               como CPF, então um código de rastreio numérico — o 3219483214,
               por exemplo — virava "321.948.321-4" enquanto se digitava, e o
               ponto atrapalhava. Quem digita CPF pode pôr os pontos ou não: a
               busca desconta a pontuação de qualquer jeito. */
            onChange={(e) => setCode(e.target.value)}
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
