/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CentralML — painel administrativo do proprietário do Unific+.
 *
 * Regras que este arquivo respeita:
 *  - NENHUM dado é inventado. Tudo vem das server functions (Supabase/API do ML).
 *    Quando não há registro, a tela mostra "Sem dados".
 *  - NENHUM token do Mercado Livre chega ao navegador. As server functions
 *    devolvem apenas o ESTADO do token (válido/expirando/expirado/reautorização).
 *  - A autorização é verificada no BACKEND (middleware requireAdmin). O login
 *    abaixo é só a porta de entrada; nenhuma tela é liberada sem o servidor
 *    confirmar que o usuário está em public.admin_users.
 *
 * A interface anterior (baseada em acesso direto ao Supabase pelo navegador e
 * em um token interno embutido no bundle) ficou preservada como referência em
 * docs/legado/CentralML_ULTRA_ATUALIZADO_2550_PLUS.legacy.tsx.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Banknote,
  Barcode,
  CheckCircle2,
  CreditCard,
  ClipboardList,
  Copy,
  Database,
  FileClock,
  Globe,
  Key,
  LoaderCircle,
  Menu,
  MessageCircle,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Tag,
  ArrowRight,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Terminal,
  Truck,
  UserCheck,
  Users,
  Wallet,
  X,
  XCircle,
} from "lucide-react";
import { ERRO_2FA } from "@/lib/auth-middleware";
import {
  aberturaDoPainel,
  definirNomeDaSaudacao,
  definirVoz,
  horaFalada,
  nomeDaSaudacao,
  vozLigada,
} from "@/lib/sfx";
import { adminBloquearCliente, adminClientes, adminRevelarCpf } from "@/lib/perfil.functions";
import { adminAoVivo, adminBloquearIp, adminIpsBloqueados, registrarTentativaPainel } from "@/lib/monitor.functions";
import mlLogo from "@/assets/ml-logo.png";
import { adminAppsMl, adminAtivarAppMl, adminRemoverAppMl, adminSalvarAppMl } from "@/lib/apps-ml.functions";
import { formatarCpf, formatarTelefone, mascararCpf } from "@/lib/cpf";

import { supabase } from "@/integrations/supabase/client";
import {
  adminAccount,
  adminAccounts,
  adminFotosDasContas,
  adminResumoComprador,
  adminAddAdmin,
  adminApiCatalog,
  adminApiConsole,
  adminAudit,
  adminConfig,
  adminDashboard,
  adminDiagnostico,
  adminDisconnectAccount,
  adminLimparStates,
  adminEnviarMensagem,
  adminErrors,
  adminLogs,
  adminMarkReceived,
  adminMlAoVivo,
  adminResponderPergunta,
  adminOrder,
  adminOrders,
  adminReclamacaoAcao,
  adminReclamacaoDetalhe,
  adminReclamacoes,
  adminRecuperarPerdidas,
  adminRefreshToken,
  adminRemoveAdmin,
  adminReprocessWebhook,
  adminSession,
  adminShipments,
  adminRevogarAutorizacao,
  adminSuspenderConexao,
  adminSyncAccount,
  adminSyncRuns,
  adminTracking,
  adminTrackingLive,
  adminWebhookEvents,
} from "@/lib/centralml.functions";

export const Route = createFileRoute("/centralml/")({
  component: CentralML,
  head: () => ({ meta: [{ title: "Olho de Deus ML — Unific+" }] }),
});

/* ========================================================================== */
/* Utilidades                                                                 */
/* ========================================================================== */

const SEM_DADOS = "Sem dados";

function fmtDateTime(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

function fmtMoney(value?: number | null, currency?: string | null) {
  if (value == null) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: currency || "BRL" }).format(value);
  } catch {
    return String(value);
  }
}

function fmtDuration(ms?: number | null) {
  if (ms == null) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function errorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return "Falha inesperada.";
}

/** Rótulos de status da conta, exatamente como pedido na especificação. */
const ACCOUNT_STATUS: Record<string, { label: string; className: string }> = {
  active: { label: "CONECTADO", className: "bg-emerald-100 text-emerald-800 border-emerald-300" },
  syncing: { label: "SINCRONIZANDO", className: "bg-sky-100 text-sky-800 border-sky-300" },
  error: { label: "ERRO", className: "bg-red-100 text-red-800 border-red-300" },
  reauth_required: { label: "REAUTORIZAÇÃO NECESSÁRIA", className: "bg-amber-100 text-amber-900 border-amber-300" },
  disconnected: { label: "DESCONECTADO", className: "bg-zinc-200 text-zinc-700 border-zinc-300" },
  suspended: { label: "SUSPENSO", className: "bg-amber-100 text-amber-900 border-amber-300" },
};

function accountStatus(status?: string | null) {
  return ACCOUNT_STATUS[status ?? ""] ?? { label: (status ?? "—").toUpperCase(), className: "bg-zinc-100 text-zinc-700 border-zinc-300" };
}

const TOKEN_STATE: Record<string, { label: string; className: string }> = {
  valido: { label: "Token válido", className: "bg-emerald-100 text-emerald-800" },
  expirando: { label: "Token expirando", className: "bg-amber-100 text-amber-900" },
  expirado: { label: "Token expirado", className: "bg-red-100 text-red-800" },
  reautorizacao: { label: "Reautorização necessária", className: "bg-amber-100 text-amber-900" },
  desconectado: { label: "Desconectado", className: "bg-zinc-200 text-zinc-700" },
};

/* ========================================================================== */
/* Blocos visuais                                                             */
/* ========================================================================== */

/*
 * O fundo Matrix agora é global (src/components/site/MatrixBackground.tsx,
 * montado em __root.tsx). O canvas local que existia aqui foi removido para
 * não rodar duas animações ao mesmo tempo na CentralML.
 */

/** Logo do Mercado Livre — asset local do projeto (src/assets/mercado-livre.svg). */
function LogoML({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label="Mercado Livre">
      <rect x="0" y="0" width="48" height="48" rx="10" fill="#ffe600" />
      <g stroke="#2d3277" strokeWidth="9" strokeLinecap="round" fill="none">
        <path d="M5 33 L18 26" />
        <path d="M43 33 L30 26" />
      </g>
      <rect x="15.5" y="19" width="17" height="12" rx="6" fill="#2d3277" />
      <g stroke="#ffe600" strokeWidth="1.4" strokeLinecap="round" opacity="0.75">
        <path d="M20 22.5 L20 27.5" />
        <path d="M24 22 L24 28" />
        <path d="M28 22.5 L28 27.5" />
      </g>
    </svg>
  );
}

/**
 * Cartão padrão do painel, no visual do Mercado Livre.
 *
 * A borda amarela fica no TOPO, não em volta. Contorno amarelo inteiro em
 * dezenas de painéis empilhados vira ruído e cansa a leitura; uma faixa no
 * topo marca a identidade e ainda separa um painel do outro na rolagem.
 *
 * O título ganha um filete amarelo à esquerda — o mesmo detalhe que o ML usa
 * para destacar seção dentro de um cartão.
 */
function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
      <div className="h-1 w-full bg-[#FFE600]" />
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
        <h2 className="flex min-w-0 items-center gap-2.5 text-sm font-black uppercase tracking-wide text-[#1F5FD4]">
          <span className="h-4 w-1 shrink-0 rounded-full bg-[#FFE600]" />
          <span className="min-w-0 break-words">{title}</span>
        </h2>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * Número em destaque. A borda amarela aqui é INTEIRA, ao contrário do Panel:
 * são poucos por tela e o contorno os separa bem do fundo escuro.
 */
function Stat({ label, value, tone = "default" }: { label: string; value: React.ReactNode; tone?: "default" | "alert" | "ok" }) {
  const toneClass =
    tone === "alert" ? "text-red-700" : tone === "ok" ? "text-emerald-700" : "text-[#1F5FD4]";
  return (
    <div className="rounded-xl border-2 border-[#FFE600] bg-white p-4 shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
      <p className="text-[11px] font-bold uppercase tracking-wide text-zinc-700">{label}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${className}`}>
      {children}
    </span>
  );
}

function Empty({ children = SEM_DADOS }: { children?: React.ReactNode }) {
  return <p className="py-8 text-center text-sm font-medium text-zinc-700">{children}</p>;
}

function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-zinc-700">
      <LoaderCircle className="h-5 w-5 animate-spin text-[#1F5FD4]" />
      <span className="text-sm">Carregando…</span>
    </div>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button onClick={onRetry} className="rounded-md bg-red-600 px-3 py-1 text-xs font-bold text-white hover:bg-red-700">
          Tentar de novo
        </button>
      )}
    </div>
  );
}

/**
 * Tabela do painel.
 *
 * O cabeçalho ganha fundo levemente amarelado e uma linha amarela embaixo —
 * assim ele se separa dos dados sem precisar de borda pesada, e continua
 * legível quando a tabela rola na horizontal no celular.
 */
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b-2 border-[#FFE600] bg-[#FFFBE0] text-[11px] uppercase tracking-wide text-[#1F5FD4]">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-2 py-2.5 font-black">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">{children}</tbody>
      </table>
    </div>
  );
}

/* ========================================================================== */
/* Hook de carregamento                                                       */
/* ========================================================================== */

type Async<T> = { data: T | null; loading: boolean; error: string | null; reload: () => void };

/**
 * Avisa o painel que a liberação do código de 6 dígitos venceu (12 h).
 * Qualquer consulta que receba ERRO_2FA dispara; o CentralML escuta e volta
 * para a tela do código, em vez de cada aba mostrar o erro cru.
 */
const EVENTO_2FA_VENCEU = "centralml:2fa-venceu";

/**
 * Carregamento com CACHE entre trocas de aba.
 *
 * Antes cada aba refazia todas as consultas ao voltar. Como cada ida ao
 * Supabase custa ~1,5 s, alternar entre abas ficava lento sem necessidade.
 * Agora o react-query (já usado no projeto) guarda o resultado por 60 s e
 * revalida em segundo plano — a tela aparece na hora e se atualiza sozinha.
 *
 * O primeiro argumento é a chave do cache: precisa identificar unicamente
 * a consulta, incluindo os filtros.
 */
function useAsync<T>(chave: unknown[], fn: () => Promise<T>, enabled = true): Async<T> {
  const q = useQuery<T>({
    queryKey: chave,
    queryFn: fn,
    enabled,
    staleTime: 60_000,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    // Mantém os dados anteriores enquanto muda o filtro: sem piscar a tela.
    placeholderData: (anterior) => anterior,
  });

  useEffect(() => {
    if (q.error && errorMessage(q.error).includes(ERRO_2FA)) {
      window.dispatchEvent(new Event(EVENTO_2FA_VENCEU));
    }
  }, [q.error]);

  return {
    data: (q.data as T | undefined) ?? null,
    loading: q.isLoading,
    error: q.error ? errorMessage(q.error) : null,
    reload: useCallback(() => {
      void q.refetch();
    }, [q]),
  };
}

/* ========================================================================== */
/* Login                                                                      */
/* ========================================================================== */

/**
 * Traduz o resultado de uma tentativa de entrada.
 *
 * O caso que mais importa é o `2fa_pedido`: ele significa que a SENHA ESTAVA
 * CERTA e o acesso parou no código. Mostrado como "falhou" genérico, passaria
 * batido — é justamente o sinal de que a senha vazou.
 */
function ResultadoDaTentativa({ sucesso, motivo }: { sucesso: boolean; motivo: string }) {
  const m = String(motivo ?? "");

  if (m === "2fa_pedido") {
    return (
      <span
        className="font-bold text-amber-700"
        title="A senha estava correta. O acesso parou na verificação em duas etapas."
      >
        ⚠ senha certa · parou no código
      </span>
    );
  }
  if (m === "2fa_codigo_errado") {
    return <span className="font-bold text-red-700">código do app errado</span>;
  }
  if (m === "2fa_ok") {
    return <span className="font-bold text-emerald-700">entrou · com código</span>;
  }
  if (m === "2fa_ativado") {
    return <span className="font-bold text-emerald-700">ativou o código</span>;
  }
  if (sucesso) return <span className="font-bold text-emerald-700">entrou</span>;
  if (m === "senha_errada") return <span className="font-bold text-red-700">senha errada</span>;
  return <span className="font-bold text-red-700">falhou · {m || "sem motivo"}</span>;
}

/**
 * Segunda etapa da entrada: o código de 6 dígitos do aplicativo.
 *
 * Aparece só quando o servidor recusa por falta do segundo fator — a senha já
 * foi aceita neste ponto. Sair daqui encerra a sessão, para não deixar meia
 * entrada aberta em máquina compartilhada.
 */
function TelaDoCodigo({ onOk, onSair }: { onOk: () => void; onSair: () => void }) {
  const [codigo, setCodigo] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /*
   * Anota que alguém chegou até aqui — senha certa, faltando o código.
   *
   * É o registro mais revelador do conjunto: significa que a senha vazou. Sem
   * ele, a aba "Ao vivo" mostraria só "entrou com sucesso" e você não saberia
   * que aquele acesso parou na segunda porta.
   */
  useEffect(() => {
    void registrarTentativaPainel({
      data: { email: "", sucesso: false, motivo: "2fa_pedido", painel: "olho_de_deus" },
    }).catch(() => {});
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
      await conferirSegundoFator({ data: { codigo, painel: "olho_de_deus" } });
      onOk();
    } catch (e2) {
      setBusy(false);
      setCodigo("");
      setErro(errorMessage(e2));
    }
  };

  // O fundo Matrix é global e já aparece atrás desta tela.
  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-zinc-900">
      <form
        onSubmit={enviar}
        className="relative z-10 w-full max-w-sm rounded-2xl border-4 border-[#FFE600] bg-white p-6 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <img src={mlLogo} alt="" className="h-10 w-10 rounded-xl" width={40} height={40} />
          <div className="leading-none">
            <span className="block text-lg font-black tracking-tight text-[#1F5FD4]">
              VERIFICAÇÃO EM DUAS ETAPAS
            </span>
            <span className="mt-1 block text-[11px] font-bold text-zinc-700">
              Olho de Deus ML
            </span>
          </div>
        </div>

        <p className="mt-4 text-xs text-zinc-700">
          Abra seu aplicativo autenticador e digite o número de 6 dígitos que aparece para o
          Olho de Deus ML.
        </p>

        <input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          placeholder="000000"
          className="mt-4 w-full rounded-xl border-2 border-zinc-300 bg-white px-3 py-3 text-center font-mono text-2xl tracking-[0.4em] text-zinc-900 outline-none focus:border-[#1F5FD4]"
        />

        {erro && <p className="mt-3 text-xs font-bold text-red-700">{erro}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-4 w-full rounded-xl bg-[#1F5FD4] py-3 text-sm font-black text-white disabled:opacity-60"
        >
          {busy ? "CONFERINDO..." : "ENTRAR"}
        </button>

        <button
          type="button"
          onClick={onSair}
          className="mt-3 w-full text-center text-[11px] font-semibold text-zinc-600 underline"
        >
          Sair e entrar com outra conta
        </button>
      </form>
    </div>
  );
}

function LoginScreen({ onSignedIn, notice }: { onSignedIn: () => void; notice?: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [verSenha, setVerSenha] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const alvo = email.trim();
    const { error: authError } = await supabase.auth.signInWithPassword({ email: alvo, password });
    setBusy(false);

    /*
     * Toda tentativa é registrada — acerto e erro.
     *
     * O login acontece aqui no navegador, contra o Supabase. Sem esta chamada
     * o servidor nunca saberia de uma sequência de senhas erradas, e a aba
     * "Ao vivo" não teria como mostrar quem está tentando entrar.
     *
     * Nunca envia a senha. E falhar em registrar não pode impedir o login de
     * quem tem a credencial certa.
     */
    void registrarTentativaPainel({
      data: {
        email: alvo,
        sucesso: !authError,
        motivo: authError ? "senha_errada" : "ok",
        painel: "olho_de_deus",
      },
    }).catch(() => {});

    if (authError) {
      setError(authError.message);
      return;
    }
    onSignedIn();
  };

  /*
   * Recuperação de senha pelo próprio Supabase Auth.
   * O link chega por e-mail e leva de volta ao painel.
   */
  const recuperarSenha = async () => {
    const alvo = email.trim();
    if (!alvo) {
      setError("Digite seu e-mail no campo acima para receber o link de recuperação.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: erro } = await supabase.auth.resetPasswordForEmail(alvo, {
      redirectTo: `${window.location.origin}/centralml`,
    });
    setBusy(false);
    setAviso(erro ? null : "Se este e-mail tiver acesso, o link de recuperação chegará em instantes.");
    if (erro) setError(erro.message);
  };

  /*
   * Campos escuros com ícone à esquerda.
   *
   * `text-base` (16px) nos inputs não é escolha estética: abaixo disso o
   * Safari do iPhone aplica zoom sozinho ao tocar no campo, e a tela "pula".
   */
  /*
   * Campo no padrão Mercado Livre: fundo branco, borda cinza fina, e a borda
   * azul da marca ao focar. `text-base` (16px) impede o zoom automático do
   * Safari no iPhone.
   */
  const campo =
    "w-full rounded-lg border-2 border-[#FFE600] bg-white py-3.5 pl-11 pr-4 text-base font-semibold text-zinc-900 " +
    "placeholder:text-zinc-700 placeholder:text-[13px] placeholder:font-bold " +
    "placeholder:uppercase placeholder:tracking-[0.12em] outline-none transition " +
    "focus:border-[#1F5FD4] focus:ring-2 focus:ring-[#1F5FD4]/20";

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-4 py-10">
      {/*
        Cartão no padrão Mercado Livre: branco, cantos suaves, sombra discreta.
        A faixa amarela no topo é a assinatura visual deles — é o que faz a tela
        ser reconhecida como "do Mercado Livre" antes mesmo de ler o texto.
      */}
      {/*
        Cartão no padrão da tela de login real do Mercado Livre: branco, cantos
        de 6px, sombra suave, logo centralizada no topo e um respiro generoso.
        Eles não usam faixa colorida aqui — a marca entra pela logo e pelo azul
        de ação. Por isso a faixa amarela saiu.
      */}
      {/*
        `relative` sem `overflow-hidden`: o sangue precisa escorrer PARA FORA do
        cartão. Com overflow escondido ele seria cortado na borda e viraria só
        uma faixa vermelha.
      */}
      <form
        onSubmit={submit}
        className="relative w-full max-w-[23rem] rounded-xl border-2 border-[#FFE600] bg-white px-7 py-9 shadow-[0_10px_40px_rgba(0,0,0,0.55)] sm:px-9"
      >
        <div className="flex flex-col items-center text-center">
          <img
            src={mlLogo}
            alt="Mercado Livre"
            className="h-16 w-16 rounded-2xl shadow-sm ring-2 ring-[#FFE600]/60"
            width={64}
            height={64}
          />
          <h1 className="mt-5 text-[21px] font-black uppercase leading-tight tracking-[0.12em] text-[#1F5FD4]">
            Olho de Deus ML
          </h1>
          <p className="mt-2 text-[12px] font-bold uppercase tracking-[0.14em] text-zinc-700">
            Painel do Mercado Livre
          </p>
        </div>

        {notice && (
          <div className="mt-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
            {notice}
          </div>
        )}

        <div className="mt-7 space-y-3">
          <div className="relative">
            <Users className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
            <input
              type="email"
              required
              autoComplete="username"
              placeholder="USUÁRIO"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={campo}
            />
          </div>

          <div className="relative">
            <Key className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-600" />
            <input
              type={verSenha ? "text" : "password"}
              required
              autoComplete="current-password"
              placeholder="SENHA"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${campo} pr-12`}
            />
            <button
              type="button"
              onClick={() => setVerSenha((v) => !v)}
              aria-label={verSenha ? "Ocultar senha" : "Mostrar senha"}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-2 text-zinc-600 transition hover:text-zinc-700"
            >
              {verSenha ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 p-2.5 text-center text-xs font-semibold text-red-700">
            {error}
          </p>
        )}
        {aviso && (
          <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-2.5 text-center text-xs font-semibold text-emerald-700">
            {aviso}
          </p>
        )}

        {/*
          Azul #1F5FD4 é a cor de AÇÃO do Mercado Livre — é o botão da tela de
          login real deles. O amarelo é a cor de identidade, usada em fundo e
          cabeçalho, não em botão primário. Trocar respeita o padrão da marca.
        */}
        <button
          type="submit"
          disabled={busy}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-md bg-[#1F5FD4] px-4 py-3.5 text-[15px] font-bold uppercase tracking-wide text-white shadow-sm transition hover:bg-[#1A4FB0] disabled:opacity-60"
        >
          {busy ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <>
              Entrar no painel
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>

        {/* Botão secundário do padrão ML: azul claro de fundo, texto azul. */}
        <button
          type="button"
          onClick={() => void recuperarSenha()}
          className="mt-3 w-full rounded-md bg-[#1F5FD4]/10 px-4 py-3 text-[15px] font-bold text-[#1F5FD4] transition hover:bg-[#1F5FD4]/15"
        >
          Recuperar acesso
        </button>

        <div className="mt-7 border-t border-zinc-200 pt-4 text-center">
          <p className="flex items-center justify-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-emerald-600">
            <ShieldCheck className="h-3 w-3" />
            Sistema protegido e monitorado
          </p>
        </div>
      </form>
    </div>
  );
}

/* ========================================================================== */
/* Componente raiz                                                            */
/* ========================================================================== */

type TabId =
  | "dashboard"
  | "contas"
  | "aovivo"
  | "clientes"
  | "pedidos"
  | "rastreamentos"
  | "sincronizacoes"
  | "logs"
  | "erros"
  | "contaml"
  | "comprador"
  | "mensagens"
  | "perguntas"
  | "reclamacoes"
  | "anuncios"
  | "console"
  | "configuracoes"
  | "auditoria";

/** Agrupamento das abas — dá hierarquia à navegação em vez de uma fila longa. */
type Grupo = "Visão geral" | "Mercado Livre" | "Operação" | "Sistema";

const TABS: Array<{
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  grupo: Grupo;
}> = [
  { id: "dashboard", label: "Dashboard", icon: Activity, grupo: "Visão geral" },
  { id: "contas", label: "Contas", icon: Users, grupo: "Visão geral" },
  { id: "aovivo", label: "Ao vivo", icon: Activity, grupo: "Visão geral" },
  { id: "clientes", label: "Clientes", icon: UserCheck, grupo: "Visão geral" },

  { id: "contaml", label: "Conta ML", icon: Globe, grupo: "Mercado Livre" },
  { id: "comprador", label: "Comprador", icon: Wallet, grupo: "Mercado Livre" },
  { id: "pedidos", label: "Pedidos", icon: Package, grupo: "Mercado Livre" },
  { id: "mensagens", label: "Mensagens", icon: Send, grupo: "Mercado Livre" },
  { id: "perguntas", label: "Perguntas", icon: MessageCircle, grupo: "Mercado Livre" },
  { id: "reclamacoes", label: "Reclamações", icon: AlertTriangle, grupo: "Mercado Livre" },
  { id: "anuncios", label: "Anúncios", icon: Tag, grupo: "Mercado Livre" },

  { id: "rastreamentos", label: "Rastreamentos", icon: Truck, grupo: "Operação" },
  { id: "sincronizacoes", label: "Sincronizações", icon: RefreshCw, grupo: "Operação" },
  { id: "console", label: "API Console", icon: Terminal, grupo: "Operação" },

  { id: "logs", label: "Logs", icon: FileClock, grupo: "Sistema" },
  { id: "erros", label: "Erros", icon: XCircle, grupo: "Sistema" },
  { id: "auditoria", label: "Auditoria", icon: ClipboardList, grupo: "Sistema" },
  { id: "configuracoes", label: "Configurações", icon: Settings, grupo: "Sistema" },
];

const GRUPOS: Grupo[] = ["Visão geral", "Mercado Livre", "Operação", "Sistema"];

function CentralML() {
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<{
    email: string;
    role: string;
    userId: string;
    isAdmin: boolean;
  } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("dashboard");
  /** Conta selecionada — todas as abas filtram por ela quando definida. */
  const [accountId, setAccountId] = useState<string | null>(null);

  // Sem barras de rolagem e escala menor no computador — só enquanto o painel
  // está aberto (regras em styles.css, classe "centralml").
  useEffect(() => {
    document.documentElement.classList.add("centralml");
    return () => document.documentElement.classList.remove("centralml");
  }, []);

  /** Gaveta de navegação do celular. */
  const [menuAberto, setMenuAberto] = useState(false);

  /** Menu lateral do computador recolhido só nos ícones. Lembrado entre visitas. */
  const [menuRecolhido, setMenuRecolhido] = useState(false);
  useEffect(() => {
    try {
      setMenuRecolhido(localStorage.getItem("centralml:menu-recolhido") === "1");
    } catch {
      /* sem armazenamento local: começa expandido */
    }
  }, []);
  const alternarRecolhido = () =>
    setMenuRecolhido((atual) => {
      try {
        localStorage.setItem("centralml:menu-recolhido", atual ? "0" : "1");
      } catch {
        /* sem armazenamento local: vale só nesta visita */
      }
      return !atual;
    });

  /** Troca de aba, fecha a gaveta do celular e volta ao topo da página. */
  const irParaAba = (id: TabId) => {
    setTab(id);
    setMenuAberto(false);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Gaveta aberta: trava a rolagem do fundo e fecha com Esc.
  useEffect(() => {
    if (!menuAberto) return;
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuAberto(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = anterior;
      window.removeEventListener("keydown", onKey);
    };
  }, [menuAberto]);

  /** Senha aceita, mas falta o código de 6 dígitos do aplicativo. */
  const [pedindoCodigo, setPedindoCodigo] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setSession(null);
        setPedindoCodigo(false);
        setNotice(null);
        return;
      }
      // O servidor é quem decide: sessão válida ≠ acesso administrativo.
      const me = await adminSession();
      setSession(me);
      setPedindoCodigo(false);
      setNotice(null);
    } catch (e) {
      /*
       * O servidor recusou por falta do segundo fator, não por credencial
       * errada. Aqui isso vira a tela do código — mandar de volta para o login
       * faria a pessoa digitar a senha de novo e cair no mesmo lugar.
       */
      if (String(errorMessage(e)).includes(ERRO_2FA)) {
        setSession(null);
        setPedindoCodigo(true);
        setNotice(null);
      } else {
        setSession(null);
        setPedindoCodigo(false);
        setNotice(errorMessage(e));
      }
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  /*
   * Abertura falada, TODA vez que o painel abre.
   *
   * O navegador só deixa tocar som depois de a pessoa interagir com a página —
   * e aqui isso já aconteceu, porque ela clicou para entrar ou digitou o
   * código do segundo fator.
   */
  useEffect(() => {
    if (!session) return;
    aberturaDoPainel();
  }, [session]);

  /*
   * Sem botão de sair: a sessão do painel dura enquanto o código de 6 dígitos
   * vale. Quando vence, volta sozinho para a tela do código — seja porque uma
   * aba recebeu ERRO_2FA, seja pela conferência a cada minuto (que também
   * pega o caso de a tela ficar parada, sem nenhuma consulta rodando).
   */
  useEffect(() => {
    if (!session) return;
    const venceu = () => {
      setSession(null);
      setPedindoCodigo(true);
    };
    const conferir = async () => {
      try {
        await adminSession();
      } catch (e) {
        if (String(errorMessage(e)).includes(ERRO_2FA)) venceu();
      }
    };
    window.addEventListener(EVENTO_2FA_VENCEU, venceu);
    const timer = window.setInterval(() => void conferir(), 60_000);
    return () => {
      window.removeEventListener(EVENTO_2FA_VENCEU, venceu);
      window.clearInterval(timer);
    };
  }, [session]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setPedindoCodigo(false);
    setNotice(null);
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircle className="h-10 w-10 animate-spin text-[#FFE600]" />
      </div>
    );
  }

  if (pedindoCodigo) {
    return <TelaDoCodigo onOk={() => void check()} onSair={() => void signOut()} />;
  }

  if (!session) {
    return (
      // text-zinc-900: o body do Unific+ define uma cor quase branca
      // (--foreground). Sem fixar aqui, todo texto sem classe de cor herda
      // branco e some nos painéis claros da CentralML.
      <div className="min-h-screen text-zinc-900">
        <LoginScreen onSignedIn={check} notice={notice} />
      </div>
    );
  }

  const abaAtual = TABS.find((t) => t.id === tab) ?? TABS[0]!;

  return (
    // Sem fundo próprio: o Matrix (global, em __root.tsx) aparece por trás.
    <div className="relative z-10 min-h-screen text-zinc-900">
      {/* Amarelo do Mercado Livre com a faixa azul embaixo — o cabeçalho de
          sempre do painel. */}
      <header className="sticky top-0 z-40 border-b-4 border-[#1F5FD4] bg-[#FFE600] shadow-[0_6px_24px_rgba(0,0,0,0.45)]">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-3 px-3 sm:px-5">
          {/* Só no celular: abre a gaveta do menu. No computador o menu já fica
              à vista e recolhe pelo botão "Recolher menu" do rodapé. */}
          <button
            onClick={() => setMenuAberto(true)}
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-xl text-[#1F5FD4] hover:bg-black/10 lg:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="h-6 w-6" />
          </button>

          <img src={mlLogo} alt="Mercado Livre" className="h-10 w-10 shrink-0 rounded-xl shadow-sm" width={40} height={40} />
          <div className="min-w-0 leading-none">
            <span className="block truncate text-lg font-black tracking-tight text-[#1F5FD4] sm:text-xl">OLHO DE DEUS ML</span>
            <span className="mt-1 hidden text-[10px] font-black uppercase tracking-[0.16em] text-[#1F5FD4]/80 sm:block">
              Painel do Mercado Livre
            </span>
          </div>

        </div>
      </header>

      {/* Gaveta do celular: o mesmo menu do computador, deslizando da esquerda. */}
      {menuAberto && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
            onClick={() => setMenuAberto(false)}
            aria-label="Fechar menu"
          />
          <div className="absolute inset-y-0 left-0 flex w-[84%] max-w-[320px] flex-col bg-white shadow-2xl">
            <div className="flex h-16 shrink-0 items-center gap-3 border-b-4 border-[#1F5FD4] bg-[#FFE600] px-4">
              <img src={mlLogo} alt="" className="h-9 w-9 rounded-xl" width={36} height={36} />
              <span className="text-base font-black tracking-tight text-[#1F5FD4]">OLHO DE DEUS ML</span>
              <button
                onClick={() => setMenuAberto(false)}
                className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg text-[#1F5FD4] hover:bg-black/10"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <Navegacao tab={tab} onPick={irParaAba} />
            </div>
          </div>
        </div>
      )}

      <div className="mx-auto flex max-w-[1440px] gap-6 px-3 py-4 sm:px-5 sm:py-6">
        <aside
          className={`hidden shrink-0 transition-[width] duration-200 lg:block ${menuRecolhido ? "w-[68px]" : "w-60"}`}
        >
          {/* Branco como os cartões e da altura da tela: fica preso ao rolar
              e não deixa buraco embaixo. A altura divide 100vh pelo zoom do
              painel (--cml-zoom, em styles.css) — com zoom, 100vh encolhe
              junto e o menu não chegaria ao fim da tela. */}
          <div className="sticky top-[92px] flex h-[calc(100vh/var(--cml-zoom,1)_-_116px)] flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
            <div className="h-1 w-full shrink-0 bg-[#FFE600]" />
            <div className={`flex-1 overflow-y-auto ${menuRecolhido ? "px-2 py-3" : "p-3"}`}>
              <Navegacao tab={tab} onPick={irParaAba} compacto={menuRecolhido} />
            </div>
            <button
              onClick={alternarRecolhido}
              className={`flex shrink-0 items-center gap-2 border-t border-zinc-100 py-3 text-xs font-black uppercase tracking-wide text-[#1F5FD4] transition-colors hover:bg-[#FFFBE0] ${
                menuRecolhido ? "justify-center" : "px-4"
              }`}
              title={menuRecolhido ? "Expandir menu" : "Recolher menu"}
            >
              {menuRecolhido ? (
                <PanelLeftOpen className="h-5 w-5" />
              ) : (
                <>
                  <PanelLeftClose className="h-4 w-4" /> Recolher menu
                </>
              )}
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          {/* O menu já marca a aba atual; o título fica só para leitores de tela. */}
          <h1 className="sr-only">
            {abaAtual.grupo} — {abaAtual.label}
          </h1>

          <AccountSelector accountId={accountId} onChange={setAccountId} />

          <div className="mt-4 space-y-4 pb-12">
            {tab === "dashboard" && (
              <DashboardTab
                onOpenAccount={(id) => {
                  setAccountId(id);
                  irParaAba("contas");
                }}
              />
            )}
            {tab === "contas" && <ContasTab accountId={accountId} onSelect={setAccountId} />}
            {tab === "aovivo" && <AoVivoTab />}
            {tab === "clientes" && <ClientesTab />}
            {tab === "pedidos" && <PedidosTab accountId={accountId} />}
            {tab === "rastreamentos" && <RastreamentosTab accountId={accountId} />}
            {tab === "sincronizacoes" && <SincronizacoesTab accountId={accountId} />}
            {tab === "logs" && <LogsTab accountId={accountId} />}
            {tab === "erros" && <ErrosTab />}
            {tab === "contaml" && <ContaMlTab accountId={accountId} />}
            {tab === "comprador" && <CompradorTab accountId={accountId} />}
            {tab === "mensagens" && <MensagensTab accountId={accountId} />}
            {tab === "perguntas" && <PerguntasTab accountId={accountId} />}
            {tab === "reclamacoes" && <ReclamacoesPainel accountId={accountId} />}
            {tab === "anuncios" && <AnunciosTab accountId={accountId} />}
            {tab === "console" && <ConsoleTab accountId={accountId} />}
            {tab === "configuracoes" && <ConfiguracoesTab isAdmin={session.isAdmin} />}
            {tab === "auditoria" && <AuditoriaTab />}
          </div>
        </main>
      </div>
    </div>
  );
}

/**
 * Menu do painel, usado na lateral do computador e na gaveta do celular.
 * Os quatro grupos ficam sempre abertos: são 17 itens, cabem numa coluna e
 * você enxerga tudo sem precisar expandir nada.
 *
 * `compacto`: menu recolhido — só os ícones, com o nome no title (aparece ao
 * passar o mouse) e um traço amarelo no lugar do nome de cada grupo.
 */
function Navegacao({ tab, onPick, compacto = false }: { tab: TabId; onPick: (id: TabId) => void; compacto?: boolean }) {
  return (
    <nav className={compacto ? "space-y-3" : "space-y-4"}>
      {GRUPOS.map((grupo) => (
        <div key={grupo}>
          {compacto ? (
            <span className="mx-auto mb-1.5 block h-1 w-6 rounded-full bg-[#FFE600]" title={grupo} />
          ) : (
            <p className="flex items-center gap-2 px-2.5 pb-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-[#1F5FD4]">
              <span className="h-3.5 w-1 rounded-full bg-[#FFE600]" />
              {grupo}
            </p>
          )}
          <ul className="space-y-0.5">
            {TABS.filter((t) => t.grupo === grupo).map(({ id, label, icon: Icon }) => {
              const ativa = tab === id;
              return (
                <li key={id}>
                  <button
                    onClick={() => onPick(id)}
                    aria-current={ativa ? "page" : undefined}
                    aria-label={compacto ? label : undefined}
                    title={compacto ? label : undefined}
                    className={`group flex w-full items-center rounded-lg py-2 text-left text-sm transition-colors ${
                      compacto ? "justify-center px-0" : "gap-3 px-2.5"
                    } ${
                      ativa
                        ? // Amarelo com texto azul: o par de cores do Mercado Livre.
                          "bg-[#FFE600] font-black text-[#1F5FD4] shadow-[0_0_16px_rgba(255,230,0,0.25)]"
                        : "font-bold text-zinc-700 hover:bg-[#FFFBE0] hover:text-[#1F5FD4]"
                    }`}
                  >
                    <Icon
                      className={`shrink-0 ${compacto ? "h-5 w-5" : "h-4 w-4"} ${
                        ativa ? "text-[#1F5FD4]" : "text-zinc-400 group-hover:text-[#1F5FD4]"
                      }`}
                    />
                    {!compacto && <span className="truncate">{label}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/* ========================================================================== */
/* Seletor de conta (isolamento por cliente)                                  */
/* ========================================================================== */

/** Conta que pede atenção: fora do ar no ML ou com o token vencido. */
function contaPedeAtencao(a: any) {
  return a.status !== "active" || ["expirado", "reautorizacao", "desconectado"].includes(a.tokenStatus?.state ?? "");
}

/**
 * Avatar da conta: a foto do Mercado Livre quando existe, senão a inicial num
 * círculo amarelo. O pontinho âmbar marca a conta que pede atenção.
 *
 * `foto === undefined` = ainda carregando (mostra a inicial); `null` = a conta
 * não tem foto. Se a imagem falhar ao carregar, volta para a inicial.
 */
function AvatarConta({
  nome,
  foto,
  atencao = false,
  grande = false,
}: {
  nome: string;
  foto?: string | null | undefined;
  atencao?: boolean;
  grande?: boolean;
}) {
  const [erro, setErro] = useState(false);
  const tamanho = grande ? "h-11 w-11 text-base" : "h-9 w-9 text-sm";
  const mostrarFoto = foto && !erro;
  return (
    <span className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full ${tamanho}`}>
      {mostrarFoto ? (
        <img
          src={foto}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setErro(true)}
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center bg-[#FFE600] font-black uppercase text-[#1F5FD4]">
          {nome.slice(0, 1)}
        </span>
      )}
      {atencao && (
        <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-amber-500" />
      )}
    </span>
  );
}

type FiltroConta = "todas" | "ok" | "atencao";

/**
 * Seletor da conta em foco.
 *
 * Um cartão que abre um painel próprio em vez do <select> nativo: com 30+
 * contas, a lista do navegador vira uma coluna de apelidos sem contexto. Aqui
 * cada linha mostra a inicial, o ID no ML, quantos pedidos tem e o status, e
 * dá para buscar e filtrar quem precisa de atenção.
 *
 * Teclado: setas sobem e descem, Enter escolhe, Esc fecha.
 */
function AccountSelector({ accountId, onChange }: { accountId: string | null; onChange: (id: string | null) => void }) {
  const { data, loading, error, reload } = useAsync(["contas"], () => adminAccounts());
  // Fotos vêm à parte: a lista aparece na hora e os avatares preenchem quando
  // as fotos chegam. Nunca travam o seletor.
  const { data: fotos } = useAsync(["fotos-contas"], () => adminFotosDasContas());
  const fotoDe = (id: string): string | null | undefined => (fotos ? (fotos[id] ?? null) : undefined);
  const accounts = (data ?? []) as any[];
  const current = accounts.find((a) => a.id === accountId) ?? null;
  const nome = current ? String(current.nickname || current.ml_user_id) : null;

  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroConta>("todas");
  /** Linha destacada pelo teclado. -1 = "Todas as contas". */
  const [cursor, setCursor] = useState(-1);
  const caixaRef = useRef<HTMLDivElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);

  const totalAtencao = accounts.filter(contaPedeAtencao).length;
  const termo = busca.trim().toLowerCase();
  const visiveis = accounts.filter((a) => {
    if (filtro === "ok" && contaPedeAtencao(a)) return false;
    if (filtro === "atencao" && !contaPedeAtencao(a)) return false;
    if (!termo) return true;
    return `${a.nickname ?? ""} ${a.ml_user_id ?? ""}`.toLowerCase().includes(termo);
  });

  const fechar = () => {
    setAberto(false);
    setBusca("");
    setFiltro("todas");
  };
  const escolher = (id: string | null) => {
    onChange(id);
    fechar();
  };

  // Ao abrir: cursor na conta atual e foco na busca — só com mouse; no
  // celular o foco abriria o teclado por cima da lista.
  useEffect(() => {
    if (!aberto) return;
    setCursor(accountId ? accounts.findIndex((a) => a.id === accountId) : -1);
    const comMouse = window.matchMedia("(pointer: fine)").matches;
    const t = window.setTimeout(() => comMouse && buscaRef.current?.focus(), 0);
    const fora = (e: MouseEvent) => {
      if (!caixaRef.current?.contains(e.target as Node)) fechar();
    };
    document.addEventListener("mousedown", fora);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", fora);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  // Mantém a linha do cursor visível ao navegar pelo teclado.
  useEffect(() => {
    listaRef.current?.querySelector(`[data-linha="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const onTecla = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return fechar();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, visiveis.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      escolher(cursor === -1 ? null : (visiveis[cursor]?.id ?? null));
    }
  };

  const filtros: Array<{ id: FiltroConta; label: string; total: number }> = [
    { id: "todas", label: "Todas", total: accounts.length },
    { id: "ok", label: "Conectadas", total: accounts.length - totalAtencao },
    { id: "atencao", label: "Atenção", total: totalAtencao },
  ];

  return (
    <div ref={caixaRef} className="relative z-30">
      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_8px_30px_rgba(0,0,0,0.45)]">
        <div className="h-1 w-full bg-[#FFE600]" />
        <div className="flex items-center gap-2 p-3 sm:p-4">
          <button
            onClick={() => (aberto ? fechar() : setAberto(true))}
            aria-haspopup="listbox"
            aria-expanded={aberto}
            className="group flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left"
          >
            {nome ? (
              <AvatarConta nome={nome} foto={fotoDe(current.id)} atencao={contaPedeAtencao(current)} grande />
            ) : (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#FFE600] text-[#1F5FD4]">
                <Users className="h-5 w-5" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">Conta em foco</span>
              <span className="block truncate text-[15px] font-black text-[#1F5FD4]">{nome ?? "Todas as contas"}</span>
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                {current ? (
                  <>
                    <Badge className={accountStatus(current.status).className}>{accountStatus(current.status).label}</Badge>
                    <Badge
                      className={`border-transparent ${TOKEN_STATE[current.tokenStatus?.state ?? ""]?.className ?? "bg-zinc-100 text-zinc-700"}`}
                    >
                      {TOKEN_STATE[current.tokenStatus?.state ?? ""]?.label ?? "—"}
                    </Badge>
                  </>
                ) : (
                  <span className="text-xs font-semibold text-zinc-500">
                    {accounts.length} contas
                    {totalAtencao > 0 && <span className="text-amber-600"> · {totalAtencao} pedem atenção</span>}
                  </span>
                )}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#FFE600] px-3 py-2 text-xs font-black uppercase tracking-wide text-[#1F5FD4] transition group-hover:brightness-95">
              <span className="hidden sm:inline">Trocar</span>
              <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${aberto ? "rotate-180" : ""}`} />
            </span>
          </button>
          <button
            onClick={reload}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            title="Recarregar contas"
            aria-label="Recarregar contas"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        {error && <p className="px-4 pb-3 text-xs font-semibold text-red-600">{error}</p>}
        {!loading && !error && accounts.length === 0 && (
          <p className="px-4 pb-3 text-xs text-zinc-700">
            Nenhuma conta autorizou o aplicativo ainda. Assim que um cliente concluir o OAuth no Unific+, ela aparece aqui.
          </p>
        )}
      </div>

      {aberto && (
        <div
          onKeyDown={onTecla}
          className="absolute inset-x-0 top-full mt-2 overflow-hidden rounded-xl border-2 border-[#FFE600] bg-white shadow-[0_20px_50px_rgba(0,0,0,0.6)] animate-in fade-in-0 slide-in-from-top-2 duration-150 md:left-auto md:w-[460px]"
        >
          <div className="space-y-2.5 border-b border-zinc-100 bg-[#FFFBE0] p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#1F5FD4]" />
              <input
                ref={buscaRef}
                value={busca}
                onChange={(e) => {
                  setBusca(e.target.value);
                  setCursor(-1);
                }}
                placeholder="Buscar por apelido ou ID…"
                className="h-10 w-full rounded-lg border border-zinc-300 bg-white pl-9 pr-3 text-sm font-semibold text-zinc-800 outline-none focus:border-[#1F5FD4] focus:ring-2 focus:ring-[#FFE600]"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {filtros.map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setFiltro(f.id);
                    setCursor(-1);
                  }}
                  className={`rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-wide transition ${
                    filtro === f.id
                      ? "bg-[#1F5FD4] text-white"
                      : "bg-white text-[#1F5FD4] ring-1 ring-[#1F5FD4]/25 hover:ring-[#1F5FD4]"
                  }`}
                >
                  {f.label} <span className="opacity-70">{f.total}</span>
                </button>
              ))}
            </div>
          </div>

          <ul ref={listaRef} role="listbox" className="max-h-[min(60vh,440px)] overflow-y-auto p-1.5">
            {!termo && filtro === "todas" && (
              <li data-linha={-1}>
                <button
                  role="option"
                  aria-selected={!accountId}
                  onClick={() => escolher(null)}
                  onMouseEnter={() => setCursor(-1)}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${
                    cursor === -1 ? "bg-[#FFFBE0]" : ""
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1F5FD4] text-[#FFE600]">
                    <Users className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-black text-[#1F5FD4]">Todas as contas</span>
                    <span className="block text-[11px] font-semibold text-zinc-500">Visão geral das {accounts.length} contas</span>
                  </span>
                  {!accountId && <Check className="h-4 w-4 shrink-0 text-[#1F5FD4]" />}
                </button>
              </li>
            )}

            {visiveis.map((a, i) => {
              const apelido = String(a.nickname || a.ml_user_id);
              const atencao = contaPedeAtencao(a);
              const escolhida = a.id === accountId;
              const st = accountStatus(a.status);
              return (
                <li key={a.id} data-linha={i}>
                  <button
                    role="option"
                    aria-selected={escolhida}
                    onClick={() => escolher(a.id)}
                    onMouseEnter={() => setCursor(i)}
                    className={`flex w-full items-center gap-3 rounded-lg border-l-4 px-2.5 py-2 text-left transition ${
                      escolhida ? "border-[#1F5FD4]" : "border-transparent"
                    } ${cursor === i ? "bg-[#FFFBE0]" : ""}`}
                  >
                    <AvatarConta nome={apelido} foto={fotoDe(a.id)} atencao={atencao} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black text-[#1F5FD4]">{apelido}</span>
                      <span className="block truncate font-mono text-[11px] text-zinc-500">
                        {a.ml_user_id} · {a.counts?.orders ?? 0} pedidos
                      </span>
                    </span>
                    <span
                      className={`hidden shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold sm:inline-flex ${st.className}`}
                    >
                      {st.label}
                    </span>
                    {escolhida && <Check className="h-4 w-4 shrink-0 text-[#1F5FD4]" />}
                  </button>
                </li>
              );
            })}

            {visiveis.length === 0 && (
              <li className="px-3 py-8 text-center text-sm font-semibold text-zinc-500">Nenhuma conta encontrada.</li>
            )}
          </ul>

          <div className="hidden items-center justify-between border-t border-zinc-100 px-3 py-2 text-[11px] font-semibold text-zinc-500 md:flex">
            <span>
              {visiveis.length} de {accounts.length} contas
            </span>
            <span>↑ ↓ navegar · Enter escolher · Esc fechar</span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Dashboard                                                                  */
/* ========================================================================== */

function DashboardTab({ onOpenAccount }: { onOpenAccount: (id: string) => void }) {
  const { data, loading, error, reload } = useAsync(["dashboard"], () => adminDashboard());

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Empty />;

  const t = data.totals;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <Stat label="Contas conectadas" value={t.accounts} />
        <Stat label="Ativas" value={t.accountsActive} tone="ok" />
        <Stat label="Reautorização" value={t.accountsReauth} tone={t.accountsReauth ? "alert" : "default"} />
        <Stat label="Pedidos" value={t.orders} />
        <Stat label="Envios" value={t.shipments} />
        <Stat label="Entregues" value={t.delivered} tone="ok" />
        <Stat label="Eventos de rastreio" value={t.events} />
        <Stat label="Pedidos 24h" value={t.recentOrders} />
        <Stat label="Consultas de rastreio" value={t.tracking} />
        <Stat label="Consultas 24h" value={t.tracking24h} />
        <Stat label="Erros de sync" value={t.syncErrors} tone={t.syncErrors ? "alert" : "default"} />
        <Stat label="Erros de webhook" value={t.webhookErrors} tone={t.webhookErrors ? "alert" : "default"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="Contas recentes"
          right={
            <button onClick={reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          }
        >
          {data.accounts.length === 0 ? (
            <Empty />
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <Table head={["Conta", "ML user", "Status", "Token", "Última sync"]}>
                {data.accounts.map((a: any) => (
                  <tr key={a.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => onOpenAccount(a.id)}>
                    <td className="px-2 py-2 font-semibold text-[#1F5FD4]">{a.nickname || "—"}</td>
                    <td className="px-2 py-2 font-mono text-xs">{a.ml_user_id}</td>
                    <td className="px-2 py-2">
                      <Badge className={`whitespace-nowrap ${accountStatus(a.status).className}`}>{accountStatus(a.status).label}</Badge>
                    </td>
                    <td className="px-2 py-2 text-xs">{TOKEN_STATE[a.tokenStatus?.state ?? ""]?.label ?? "—"}</td>
                    <td className="px-2 py-2 text-xs">{fmtDateTime(a.last_sync_at)}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </Panel>

        <Panel title="Últimas sincronizações">
          {data.lastRuns.length === 0 ? (
            <Empty />
          ) : (
            <div className="max-h-80 overflow-y-auto">
            <Table head={["Início", "Tipo", "Status", "Pedidos", "Envios", "Eventos", "Duração"]}>
              {data.lastRuns.map((r: any) => (
                <tr key={r.id}>
                  <td className="px-2 py-2 text-xs">{fmtDateTime(r.started_at)}</td>
                  <td className="px-2 py-2 text-xs">{r.kind}</td>
                  <td className="px-2 py-2">
                    <Badge className={r.status === "error" ? "border-red-300 bg-red-100 text-red-800" : "border-emerald-300 bg-emerald-100 text-emerald-800"}>
                      {r.status}
                    </Badge>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{r.orders_processed}</td>
                  <td className="px-2 py-2 tabular-nums">{r.shipments_processed}</td>
                  <td className="px-2 py-2 tabular-nums">{r.events_processed}</td>
                  <td className="px-2 py-2 text-xs">{fmtDuration(r.duration_ms)}</td>
                </tr>
              ))}
            </Table>
            </div>
          )}
        </Panel>

        <Panel title="Rastreamentos recentes">
          {data.lastTracking.length === 0 ? (
            <Empty>Nenhuma consulta registrada até agora.</Empty>
          ) : (
            <div className="max-h-80 overflow-y-auto">
            <Table head={["Quando", "Código", "Origem", "Resultado", "IP"]}>
              {data.lastTracking.map((r: any) => (
                <tr key={r.id}>
                  <td className="px-2 py-2 text-xs">{fmtDateTime(r.created_at)}</td>
                  <td className="px-2 py-2 font-mono text-xs">{r.code}</td>
                  <td className="px-2 py-2 text-xs">{r.source}</td>
                  <td className="px-2 py-2">
                    {r.found ? (
                      <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800">encontrado</Badge>
                    ) : (
                      <Badge className="border-zinc-300 bg-zinc-100 text-zinc-600">sem resultado</Badge>
                    )}
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">{r.ip ?? "—"}</td>
                </tr>
              ))}
            </Table>
            </div>
          )}
        </Panel>

        <Panel title="Últimos eventos do sistema">
          {data.lastLogs.length === 0 ? (
            <Empty />
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto">
              {data.lastLogs.map((l: any) => (
                <li key={l.id} className="flex items-start gap-2 text-xs">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${l.level === "error" ? "bg-red-500" : l.level === "warn" ? "bg-amber-500" : "bg-emerald-500"}`} />
                  {/* No celular data e categoria sobem para uma linha própria,
                      e a mensagem quebra em vez de vazar do cartão. */}
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:gap-2">
                    <span className="shrink-0 text-zinc-500 sm:w-36">{fmtDateTime(l.created_at)}</span>
                    <span className="shrink-0 font-semibold text-zinc-700 sm:w-28">{l.category}</span>
                    <span className="min-w-0 flex-1 break-words text-zinc-600">{l.error || l.message || l.action}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

/* ========================================================================== */
/* Contas                                                                     */
/* ========================================================================== */

function ContasTab({ accountId, onSelect }: { accountId: string | null; onSelect: (id: string | null) => void }) {
  const { data, loading, error, reload } = useAsync(["contas"], () => adminAccounts());
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (label: string, id: string, fn: () => Promise<unknown>) => {
    setBusy(`${id}:${label}`);
    setFeedback(null);
    try {
      await fn();
      setFeedback({ ok: true, text: `${label}: concluído.` });
      reload();
    } catch (e) {
      setFeedback({ ok: false, text: `${label}: ${errorMessage(e)}` });
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;

  const accounts = data ?? [];
  if (accountId) return <ContaDetalhe id={accountId} onBack={() => onSelect(null)} />;

  return (
    <Panel
      title={`Contas que autorizaram o aplicativo (${accounts.length})`}
      right={
        <button onClick={reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      }
    >
      {feedback && (
        <p className={`mb-3 text-xs font-semibold ${feedback.ok ? "text-emerald-700" : "text-red-600"}`}>{feedback.text}</p>
      )}

      {accounts.length === 0 ? (
        <Empty>Nenhuma conta conectada. O cliente conecta pelo botão “Conectar Mercado Livre” no Unific+.</Empty>
      ) : (
        <Table
          head={[
            "ID interno",
            "ML user ID",
            "Nickname",
            "E-mail",
            "Status",
            "Token",
            "Conexão",
            "Última sync",
            "Última atividade",
            "Pedidos",
            "Rastreios",
            "Erros",
            "Ações",
          ]}
        >
          {accounts.map((a: any) => (
            <tr key={a.id} className="align-middle hover:bg-zinc-50">
              <td className="px-2 py-2">
                <button onClick={() => onSelect(a.id)} className="font-mono text-[11px] text-[#1F5FD4] underline">
                  {String(a.id).slice(0, 8)}…
                </button>
              </td>
              <td className="px-2 py-2 font-mono text-xs">{a.ml_user_id}</td>
              <td className="px-2 py-2 font-semibold">{a.nickname || "—"}</td>
              <td className="px-2 py-2 text-xs">{a.email || "—"}</td>
              <td className="px-2 py-2">
                <Badge className={accountStatus(a.status).className}>{accountStatus(a.status).label}</Badge>
              </td>
              <td className="px-2 py-2">
                <Badge className={`border-transparent ${TOKEN_STATE[a.tokenStatus?.state ?? ""]?.className ?? "bg-zinc-100 text-zinc-700"}`}>
                  {TOKEN_STATE[a.tokenStatus?.state ?? ""]?.label ?? "—"}
                </Badge>
              </td>
              <td className="px-2 py-2 text-xs">{fmtDateTime(a.connected_at ?? a.created_at)}</td>
              <td className="px-2 py-2 text-xs">{fmtDateTime(a.last_sync_at)}</td>
              <td className="px-2 py-2 text-xs">{fmtDateTime(a.last_activity_at)}</td>
              <td className="px-2 py-2 tabular-nums">{a.counts?.orders ?? 0}</td>
              <td className="px-2 py-2 tabular-nums">{a.counts?.events ?? 0}</td>
              <td className={`px-2 py-2 tabular-nums ${a.counts?.errors ? "font-bold text-red-600" : ""}`}>{a.counts?.errors ?? 0}</td>
              <td className="px-2 py-2">
                <div className="flex flex-wrap gap-1">
                  <button
                    disabled={busy !== null}
                    onClick={() => run("Sincronizar", a.id, () => adminSyncAccount({ data: { accountId: a.id, full: false } }))}
                    className="rounded-md bg-[#FFE600] px-2 py-1 text-[11px] font-bold text-black hover:bg-[#E6CF00] disabled:opacity-50"
                  >
                    {busy === `${a.id}:Sincronizar` ? "…" : "Sincronizar"}
                  </button>
                  <button
                    disabled={busy !== null}
                    onClick={() => run("Renovar token", a.id, () => adminRefreshToken({ data: { accountId: a.id } }))}
                    className="rounded-md bg-[#1F5FD4] px-2 py-1 text-[11px] font-bold text-white hover:bg-[#1A4FB0] disabled:opacity-50"
                  >
                    Renovar
                  </button>
                  {/* Suspender NÃO apaga token: reativar é imediato. */}
                  {a.status === "suspended" ? (
                    <button
                      disabled={busy !== null}
                      onClick={() =>
                        run("Reativar", a.id, () => adminSuspenderConexao({ data: { accountId: a.id, suspender: false } }))
                      }
                      className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      Reativar
                    </button>
                  ) : (
                    <button
                      disabled={busy !== null}
                      onClick={() => {
                        const motivo = prompt(
                          `Suspender o acesso de ${a.nickname || a.ml_user_id} no Únific+?\n\nO cliente deixa de ver esta conta aqui. Os tokens ficam guardados — reativar é imediato, sem nova autorização.\n\nMotivo (opcional):`,
                        );
                        if (motivo === null) return;
                        void run("Suspender", a.id, () =>
                          adminSuspenderConexao({ data: { accountId: a.id, suspender: true, motivo } }),
                        );
                      }}
                      className="rounded-md bg-amber-500 px-2 py-1 text-[11px] font-bold text-white hover:bg-amber-600 disabled:opacity-50"
                    >
                      Suspender
                    </button>
                  )}
                  {/*
                    Revogar é diferente de suspender: apaga a concessão DENTRO
                    do Mercado Livre. O app some de "Aplicativos conectados" na
                    conta da pessoa e não há como desfazer deste lado — por isso
                    a confirmação exige digitar o apelido.
                  */}
                  <button
                    disabled={busy !== null}
                    onClick={() => {
                      const nome = a.nickname || String(a.ml_user_id);
                      const digitado = prompt(
                        `REVOGAR a autorização de ${nome} no Mercado Livre?\n\n` +
                          `O Únific+ sai de "Aplicativos conectados" na conta dela e os tokens são apagados.\n` +
                          `NÃO dá para desfazer: só ela pode autorizar de novo.\n\n` +
                          `Para confirmar, digite o apelido da conta:`,
                      );
                      if (digitado === null) return;
                      if (digitado.trim() !== nome) {
                        alert("Apelido não confere. Nada foi feito.");
                        return;
                      }
                      void run("Revogar", a.id, () => adminRevogarAutorizacao({ data: { accountId: a.id } }));
                    }}
                    className="rounded-md bg-red-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-red-700 disabled:opacity-50"
                  >
                    Revogar no ML
                  </button>
                  <button
                    disabled={busy !== null}
                    onClick={() => {
                      if (!confirm(`Desconectar ${a.nickname || a.ml_user_id}? Os tokens serão APAGADOS e o cliente precisará autorizar novamente.`)) return;
                      void run("Desconectar", a.id, () => adminDisconnectAccount({ data: { id: a.id } }));
                    }}
                    className="rounded-md bg-zinc-200 px-2 py-1 text-[11px] font-bold text-zinc-700 hover:bg-zinc-300 disabled:opacity-50"
                  >
                    Desconectar
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Panel>
  );
}

function ContaDetalhe({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, loading, error, reload } = useAsync(["conta", id], () => adminAccount({ data: { id } }));

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Empty />;

  const a = data.account as any;

  return (
    <>
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-bold text-zinc-700 backdrop-blur hover:bg-white">
          <ArrowLeft className="h-3.5 w-3.5" /> Todas as contas
        </button>
        <button onClick={reload} className="rounded-lg bg-white/90 p-2 text-zinc-600 backdrop-blur hover:bg-white">
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>

      <Panel title={`Conta ${a.nickname || a.ml_user_id}`}>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <Field label="ID interno" value={<span className="font-mono text-xs">{a.id}</span>} />
          <Field label="Mercado Livre user ID" value={<span className="font-mono text-xs">{a.ml_user_id}</span>} />
          <Field label="Nickname" value={a.nickname || "—"} />
          <Field label="E-mail" value={a.email || "—"} />
          <Field label="Site" value={a.site_id || "—"} />
          <Field label="Status" value={<Badge className={accountStatus(a.status).className}>{accountStatus(a.status).label}</Badge>} />
          <Field label="Token" value={TOKEN_STATE[a.tokenStatus?.state ?? ""]?.label ?? "—"} />
          <Field label="Expira em" value={fmtDateTime(a.expires_at)} />
          <Field label="Conectada em" value={fmtDateTime(a.connected_at ?? a.created_at)} />
          <Field label="Última sincronização" value={fmtDateTime(a.last_sync_at)} />
          <Field label="Última atividade" value={fmtDateTime(a.last_activity_at)} />
          <Field label="Último erro" value={a.last_error || "—"} />
        </dl>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Pedidos" value={data.counts.orders} />
          <Stat label="Envios" value={data.counts.shipments} />
          <Stat label="Eventos" value={data.counts.events} />
          <Stat label="Erros de sync" value={data.counts.errors} tone={data.counts.errors ? "alert" : "default"} />
        </div>

        <p className="mt-4 rounded-lg bg-zinc-50 p-3 text-[11px] text-zinc-700">
          <Key className="mr-1 inline h-3 w-3" />
          access_token e refresh_token existem apenas no servidor. Esta tela nunca os recebe.
        </p>
      </Panel>

      <Panel title="Sincronizações desta conta">
        {data.runs.length === 0 ? (
          <Empty />
        ) : (
          <Table head={["Início", "Tipo", "Status", "Pedidos", "Envios", "Eventos", "Duração", "Erro"]}>
            {data.runs.map((r: any) => (
              <tr key={r.id}>
                <td className="px-2 py-2 text-xs">{fmtDateTime(r.started_at)}</td>
                <td className="px-2 py-2 text-xs">{r.kind}</td>
                <td className="px-2 py-2 text-xs">{r.status}</td>
                <td className="px-2 py-2 tabular-nums">{r.orders_processed}</td>
                <td className="px-2 py-2 tabular-nums">{r.shipments_processed}</td>
                <td className="px-2 py-2 tabular-nums">{r.events_processed}</td>
                <td className="px-2 py-2 text-xs">{fmtDuration(r.duration_ms)}</td>
                <td className="px-2 py-2 text-xs text-red-600">{r.error || "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Eventos recentes desta conta">
        {data.logs.length === 0 ? (
          <Empty />
        ) : (
          <Table head={["Quando", "Categoria", "Ação", "Endpoint", "HTTP", "Duração", "Detalhe"]}>
            {data.logs.map((l: any) => (
              <tr key={l.id}>
                <td className="px-2 py-2 text-xs">{fmtDateTime(l.created_at)}</td>
                <td className="px-2 py-2 text-xs font-semibold">{l.category}</td>
                <td className="px-2 py-2 text-xs">{l.action}</td>
                <td className="px-2 py-2 font-mono text-[11px]">{l.endpoint || "—"}</td>
                <td className="px-2 py-2 text-xs">{l.http_status ?? "—"}</td>
                <td className="px-2 py-2 text-xs">{fmtDuration(l.duration_ms)}</td>
                <td className={`px-2 py-2 text-xs ${l.success ? "text-zinc-600" : "text-red-600"}`}>{l.error || l.message || "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

/** Caixa de envio de mensagem na conversa do pedido. */
function EnviarMensagem({ orderId, onEnviado }: { orderId: string; onEnviado: () => void }) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; msg: string } | null>(null);

  const enviar = async () => {
    setEnviando(true);
    setAviso(null);
    try {
      await adminEnviarMensagem({ data: { orderId, texto } });
      setTexto("");
      setAviso({ ok: true, msg: "Mensagem enviada ao vendedor." });
      onEnviado();
    } catch (e) {
      setAviso({ ok: false, msg: errorMessage(e) });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="mt-4 border-t border-zinc-200 pt-4">
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={3}
        className="w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-600 focus:border-[#1F5FD4]"
        placeholder="Escreva uma mensagem para o vendedor…"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={enviar}
          disabled={enviando || !texto.trim()}
          className="flex items-center gap-2 rounded-lg bg-[#1F5FD4] px-4 py-2 text-sm font-bold text-white hover:bg-[#1A4FB0] disabled:opacity-50"
        >
          {enviando ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Enviar mensagem
        </button>
        {aviso && (
          <span className={`text-xs font-semibold ${aviso.ok ? "text-emerald-700" : "text-red-600"}`}>{aviso.msg}</span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-zinc-700">
        A mensagem sai pela conta do cliente, como se ele mesmo tivesse escrito. Fica registrada na auditoria.
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-700">{label}</dt>
      <dd className="mt-0.5 text-sm text-zinc-800">{value}</dd>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Forma de pagamento                                                         */
/* -------------------------------------------------------------------------- */

/** Marca do Pix, desenhada aqui (geometria própria), no verde-água oficial. */
function MarcaPix({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label="Pix" fill="currentColor">
      <path d="M12 2.4c.6 0 1.2.24 1.65.69l3.1 3.1-1.9 1.9a2.1 2.1 0 0 0-1.49.62L12 10.07 10.63 8.7a2.1 2.1 0 0 0-1.49-.62l-1.9-1.9 3.1-3.1c.45-.45 1.05-.69 1.56-.69Zm-6.9 4.8 1.9 1.9c.24.24.38.57.38.91v.98c0 .34.14.67.38.91L9.13 13.3c-.24.24-.38.57-.38.91v.98c0 .34-.14.67-.38.91l-1.9 1.9-3.1-3.1a2.34 2.34 0 0 1 0-3.3L5.1 7.2Zm13.8 0 2.1 2.1a2.34 2.34 0 0 1 0 3.3l-3.1 3.1-1.9-1.9a1.28 1.28 0 0 0-.38-.91v-.98c0-.34-.14-.67-.38-.91l1.27-1.27c.24-.24.38-.57.38-.91v-.98c0-.34.14-.67.38-.91l1.13-1.13Zm-6.9 6.73 1.37 1.37c.4.4.93.62 1.49.62l1.9 1.9-3.1 3.1a2.34 2.34 0 0 1-3.3 0l-3.1-3.1 1.9-1.9c.56 0 1.09-.22 1.49-.62L12 13.93Z" />
    </svg>
  );
}

/**
 * Nome, ícone e cor de uma forma de pagamento do Mercado Livre, a partir do
 * payment_type e do payment_method_id que a API devolve. Valores confirmados
 * em pedidos reais: credit_card/visa, account_money, e os demais pela doc.
 */
function descreverPagamento(tipo: string | null, metodo: string | null) {
  const t = String(tipo ?? "").toLowerCase();
  const m = String(metodo ?? "").toLowerCase();
  const bandeiras: Record<string, string> = {
    visa: "Visa",
    master: "Mastercard",
    mastercard: "Mastercard",
    amex: "Amex",
    elo: "Elo",
    hipercard: "Hipercard",
    debvisa: "Visa Débito",
    debmaster: "Mastercard Débito",
    debelo: "Elo Débito",
  };

  if (t === "bank_transfer" || m === "pix") {
    return { rotulo: "Pix", bandeira: null as string | null, Icone: MarcaPix, cor: "text-[#32BCAD]", fundo: "bg-[#E6F7F4]" };
  }
  if (t === "account_money" || m === "account_money") {
    return { rotulo: "Saldo em conta", bandeira: null, Icone: Wallet, cor: "text-[#1F5FD4]", fundo: "bg-[#EAF1FC]" };
  }
  if (t === "ticket" || m === "bolbradesco" || m.includes("boleto")) {
    return { rotulo: "Boleto", bandeira: null, Icone: Barcode, cor: "text-zinc-700", fundo: "bg-zinc-100" };
  }
  if (t === "consumer_credits" || m === "consumer_credits") {
    return { rotulo: "Mercado Crédito", bandeira: null, Icone: Banknote, cor: "text-[#1F5FD4]", fundo: "bg-[#EAF1FC]" };
  }
  if (t === "debit_card") {
    return { rotulo: "Cartão de débito", bandeira: bandeiras[m] ?? null, Icone: CreditCard, cor: "text-[#1F5FD4]", fundo: "bg-[#EAF1FC]" };
  }
  if (t === "credit_card") {
    return { rotulo: "Cartão de crédito", bandeira: bandeiras[m] ?? null, Icone: CreditCard, cor: "text-[#1F5FD4]", fundo: "bg-[#EAF1FC]" };
  }
  return { rotulo: metodo || tipo || "Forma não informada", bandeira: null, Icone: CreditCard, cor: "text-zinc-600", fundo: "bg-zinc-100" };
}

const STATUS_PAGAMENTO: Record<string, { label: string; cor: string }> = {
  approved: { label: "aprovado", cor: "border-emerald-300 bg-emerald-100 text-emerald-800" },
  pending: { label: "pendente", cor: "border-amber-300 bg-amber-100 text-amber-900" },
  in_process: { label: "em análise", cor: "border-amber-300 bg-amber-100 text-amber-900" },
  rejected: { label: "recusado", cor: "border-red-300 bg-red-100 text-red-800" },
  refunded: { label: "estornado", cor: "border-zinc-300 bg-zinc-100 text-zinc-700" },
  cancelled: { label: "cancelado", cor: "border-zinc-300 bg-zinc-100 text-zinc-700" },
  charged_back: { label: "contestado", cor: "border-red-300 bg-red-100 text-red-800" },
};

/** Como a compra foi paga: cada pagamento com ícone, bandeira, parcelas e status. */
function PagamentoDoPedido({ pagamentos, pagoTotal, moeda }: { pagamentos: any[]; pagoTotal: number | null; moeda: string | null }) {
  return (
    <Panel title="Como foi paga">
      {pagamentos.length === 0 ? (
        <Empty>O Mercado Livre não informou a forma de pagamento deste pedido.</Empty>
      ) : (
        <div className="space-y-2.5">
          {pagamentos.map((p: any, i: number) => {
            const d = descreverPagamento(p.tipo, p.metodo);
            const st = STATUS_PAGAMENTO[String(p.status ?? "").toLowerCase()] ?? {
              label: p.status ?? "—",
              cor: "border-zinc-300 bg-zinc-100 text-zinc-700",
            };
            const parcelas = Number(p.parcelas) > 1 ? `${p.parcelas}x` : "à vista";
            return (
              <div key={p.id || i} className="flex items-center gap-3 rounded-xl border border-zinc-200 p-3">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ${d.fundo} ${d.cor}`}>
                  <d.Icone className="h-6 w-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 text-sm font-black text-zinc-900">
                    {d.rotulo}
                    {d.bandeira && (
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-bold text-zinc-700">{d.bandeira}</span>
                    )}
                  </p>
                  <p className="text-xs text-zinc-600">
                    {parcelas}
                    {p.valor != null && ` · ${fmtMoney(p.valor, moeda)}`}
                    {p.data && ` · ${fmtDateTime(p.data)}`}
                  </p>
                </div>
                <Badge className={st.cor}>{st.label}</Badge>
              </div>
            );
          })}
          {pagoTotal != null && (
            <p className="pt-1 text-right text-sm font-black text-zinc-900">
              Total pago: <span className="text-[#1F5FD4]">{fmtMoney(pagoTotal, moeda)}</span>
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}

/* ========================================================================== */
/* Pedidos                                                                    */
/* ========================================================================== */

function PedidosTab({ accountId }: { accountId: string | null }) {
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const limit = 50;

  useEffect(() => setOffset(0), [accountId, term, status]);

  const { data, loading, error, reload } = useAsync(
    ["pedidos", accountId, term, status, offset],
    () => adminOrders({ data: { accountId, q: term || null, status: status || null, limit, offset } }),
  );

  if (openId) return <PedidoDetalhe id={openId} onBack={() => { setOpenId(null); reload(); }} />;

  return (
    <Panel
      title="Pedidos sincronizados"
      right={
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-zinc-300 px-2">
            <Search className="h-3.5 w-3.5 text-zinc-700" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setTerm(q)}
              placeholder="pedido, título, comprador, envio"
              className="w-56 bg-transparent py-1.5 text-xs text-zinc-900 outline-none placeholder:text-zinc-600"
            />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900">
            <option value="">Todos os status</option>
            <option value="paid">paid</option>
            <option value="confirmed">confirmed</option>
            <option value="payment_required">payment_required</option>
            <option value="payment_in_process">payment_in_process</option>
            <option value="cancelled">cancelled</option>
            <option value="invalid">invalid</option>
          </select>
          <button onClick={() => setTerm(q)} className="rounded-lg bg-[#1F5FD4] px-3 py-1.5 text-xs font-bold text-white">
            Buscar
          </button>
          <button onClick={reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      }
    >
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading ? (
        <Loading />
      ) : !data || data.rows.length === 0 ? (
        <Empty />
      ) : (
        <>
          <Table
            head={["ID", "Data", "Comprador", "Item", "Qtd", "Valor", "Status", "Envio", "Tracking", "Atualizado", "Ação"]}
          >
            {data.rows.map((o: any) => (
              <tr key={o.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => setOpenId(o.id)}>
                <td className="px-2 py-2 font-mono text-xs text-[#1F5FD4]">{o.ml_order_id}</td>
                <td className="px-2 py-2 text-xs">{fmtDateTime(o.date_created)}</td>
                <td className="px-2 py-2 text-xs">{o.buyer_nickname || "—"}</td>
                <td className="px-2 py-2 max-w-[280px] truncate text-xs">{o.title || "—"}</td>
                <td className="px-2 py-2 tabular-nums">{o.quantity ?? "—"}</td>
                <td className="px-2 py-2 whitespace-nowrap tabular-nums">{fmtMoney(o.total_amount, o.currency_id)}</td>
                <td className="px-2 py-2 text-xs">{o.status || "—"}</td>
                <td className="px-2 py-2 font-mono text-[11px]">{o.shipping_id || "—"}</td>
                <td className="px-2 py-2 font-mono text-[11px]">{o.tracking_code || "—"}</td>
                <td className="px-2 py-2 text-xs">{fmtDateTime(o.last_updated)}</td>
                <td className="px-2 py-2">
                  {/* A ação de recebimento fica no detalhe (exige confirmação:
                      o feedback do Mercado Livre é único e irreversível). */}
                  {o.canMarkReceived ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white">
                      <CheckCircle2 className="h-3 w-3" /> Marcar recebido
                    </span>
                  ) : o.buyer_feedback_at ? (
                    <span className="text-[11px] text-zinc-700">recebido</span>
                  ) : (
                    <span className="text-[11px] text-zinc-700">abrir</span>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      )}
    </Panel>
  );
}

function PedidoDetalhe({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, loading, error, reload } = useAsync(["pedido", id], () => adminOrder({ data: { id } }));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const [avaliacao, setAvaliacao] = useState<"positive" | "neutral" | "negative">("positive");
  const [comentario, setComentario] = useState("");
  const marcarRecebido = async () => {
    const rotulo = { positive: "positiva", neutral: "neutra", negative: "negativa" }[avaliacao];
    if (
      !confirm(
        `Confirmar o RECEBIMENTO deste pedido com avaliação ${rotulo}?\n\nO feedback é ÚNICO e irreversível no Mercado Livre.`,
      )
    )
      return;
    setBusy(true);
    setFeedback(null);
    try {
      await adminMarkReceived({ data: { orderId: id, rating: avaliacao, message: comentario } });
      setFeedback({ ok: true, text: "Recebimento confirmado no Mercado Livre." });
      reload();
    } catch (e) {
      setFeedback({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Empty />;

  const o = data.order as any;
  const s = data.shipment as any;

  return (
    <>
      <button onClick={onBack} className="flex items-center gap-1 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-bold text-zinc-700 backdrop-blur hover:bg-white">
        <ArrowLeft className="h-3.5 w-3.5" /> Voltar aos pedidos
      </button>

      <Panel title={`Pedido ${o.ml_order_id}`}>
        {feedback && (
          <p className={`mb-3 text-xs font-semibold ${feedback.ok ? "text-emerald-700" : "text-red-600"}`}>{feedback.text}</p>
        )}
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <Field label="Conta" value={data.account ? `${(data.account as any).nickname ?? "—"} (${(data.account as any).ml_user_id})` : "—"} />
          <Field label="Data" value={fmtDateTime(o.date_created)} />
          <Field label="Status" value={`${o.status ?? "—"}${o.status_detail ? ` · ${o.status_detail}` : ""}`} />
          <Field label="Comprador" value={o.buyer_nickname || "—"} />
          <Field label="Item" value={o.title || "—"} />
          <Field label="Valor" value={fmtMoney(o.total_amount, o.currency_id)} />
          <Field label="Envio (shipping_id)" value={<span className="font-mono text-xs">{o.shipping_id || "—"}</span>} />
          <Field label="Feedback enviado" value={fmtDateTime(o.buyer_feedback_at)} />
          <Field label="Avaliação" value={o.buyer_feedback_rating || "—"} />
        </dl>

        <div className="mt-4">
          {data.actions.canMarkReceived ? (
            <div className="rounded-lg border border-zinc-200 p-4">
              <p className="text-sm font-bold text-zinc-800">Confirmar recebimento e avaliar a compra</p>
              <p className="mt-0.5 text-xs text-zinc-700">
                Envia o feedback de compra ao Mercado Livre. É único e irreversível.
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {(
                  [
                    ["positive", "Positiva", "border-emerald-400 bg-emerald-50 text-emerald-800"],
                    ["neutral", "Neutra", "border-amber-400 bg-amber-50 text-amber-900"],
                    ["negative", "Negativa", "border-red-400 bg-red-50 text-red-800"],
                  ] as const
                ).map(([valor, rotulo, cor]) => (
                  <button
                    key={valor}
                    onClick={() => setAvaliacao(valor)}
                    className={`rounded-lg border-2 px-4 py-2 text-sm font-bold transition ${
                      avaliacao === valor ? cor : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300"
                    }`}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>

              <textarea
                value={comentario}
                onChange={(e) => setComentario(e.target.value.slice(0, 160))}
                rows={2}
                maxLength={160}
                className="mt-3 w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-600 focus:border-[#1F5FD4]"
                placeholder="Comentário para o vendedor (opcional, até 160 caracteres)"
              />
              <p className="mt-1 text-right text-[10px] text-zinc-600">{comentario.length}/160</p>

              <button
                onClick={marcarRecebido}
                disabled={busy}
                className="mt-2 flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60"
              >
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Marcar como recebido e enviar avaliação
              </button>
            </div>
          ) : (
            <p className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-700">
              {o.buyer_feedback_at
                ? "Feedback já registrado no Mercado Livre — a operação não pode ser repetida."
                : "Operação não disponível pela API oficial para o status atual deste pedido."}
            </p>
          )}
        </div>
      </Panel>

      <PagamentoDoPedido
        pagamentos={data.aoVivo?.pagamentos ?? []}
        pagoTotal={data.aoVivo?.pagoTotal ?? null}
        moeda={o.currency_id}
      />

      <Panel title="Envio">
        {!s ? (
          <Empty>Este pedido não possui envio sincronizado.</Empty>
        ) : (
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <Field label="Shipment" value={<span className="font-mono text-xs">{s.ml_shipment_id}</span>} />
            <Field label="Status" value={`${s.status ?? "—"}${s.substatus ? ` · ${s.substatus}` : ""}`} />
            <Field label="Código de rastreio" value={<span className="font-mono text-xs">{s.tracking_number || "—"}</span>} />
            <Field label="Transportadora" value={s.tracking_method || "—"} />
            <Field label="Modo / logística" value={[s.mode, s.logistic_type].filter(Boolean).join(" · ") || "—"} />
            <Field label="Previsão" value={fmtDateTime(s.estimated_delivery)} />
            <Field label="Destinatário" value={s.receiver_name || "—"} />
            <Field label="Cidade / UF" value={[s.receiver_city, s.receiver_state].filter(Boolean).join(" / ") || "—"} />
            <Field label="Atualizado em" value={fmtDateTime(s.last_updated)} />
          </dl>
        )}
      </Panel>

      <Panel
        title={`Conversa com o vendedor${data.conversa.naoLidas ? ` — ${data.conversa.naoLidas} não lida(s)` : ""}`}
      >
        {data.conversa.disponivel ? (
          <>
            <ul className="space-y-2">
              {(data.conversa.mensagens ?? []).map((m: any) => (
                <li
                  key={m.id}
                  className={`max-w-[80%] rounded-lg p-3 text-sm ${
                    m.deMim
                      ? "ml-auto border border-sky-200 bg-sky-50 text-sky-950"
                      : "border border-zinc-200 bg-white text-zinc-800"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{m.texto}</p>
                  <p className="mt-1 text-[10px] text-zinc-700">
                    {m.deMim ? "você" : "vendedor"} · {fmtDateTime(m.enviadaEm)}
                    {m.lidaEm ? " · lida" : " · não lida"}
                  </p>
                </li>
              ))}
            </ul>
            <EnviarMensagem orderId={data.order.id} onEnviado={reload} />
          </>
        ) : (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-bold">Sem conversa para este pedido</p>
            <p className="mt-1 text-xs">{data.conversa.motivo}</p>
            {data.aoVivo.tags.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-1">
                {data.aoVivo.tags.map((t: string) => (
                  <Badge key={t} className="border-amber-300 bg-white font-mono text-amber-900">
                    {t}
                  </Badge>
                ))}
              </p>
            )}
          </div>
        )}
      </Panel>

      {data.feedback && (
        <Panel title="Confirmação de recebimento (feedback no Mercado Livre)">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-4">
            <Field
              label="Recebido"
              value={
                data.feedback.recebido ? (
                  <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800">confirmado</Badge>
                ) : (
                  <Badge className="border-zinc-300 bg-zinc-100 text-zinc-700">não</Badge>
                )
              }
            />
            <Field label="Avaliação" value={data.feedback.avaliacao ?? "—"} />
            <Field label="Enviado em" value={fmtDateTime(data.feedback.enviadoEm)} />
            <Field label="Mensagem" value={data.feedback.mensagem ?? "—"} />
          </dl>
        </Panel>
      )}

      {data.descontos.length > 0 && (
        <Panel title="Descontos e cupons">
          <pre className="max-h-56 overflow-auto rounded-lg bg-zinc-950 p-3 text-[11px] text-emerald-300">
            {JSON.stringify(data.descontos, null, 2)}
          </pre>
        </Panel>
      )}

      <ReclamacoesDoPedido
        accountId={data.order.account_id}
        reclamacoes={data.reclamacoes ?? []}
        onMudou={reload}
      />

      {data.faturamento && <DadosCompradorPanel faturamento={data.faturamento} />}

      <Panel title="Histórico de rastreamento">
        {data.events.length === 0 ? (
          <Empty />
        ) : (
          <Table head={["Data", "Status", "Substatus", "Descrição", "Origem"]}>
            {data.events.map((e: any) => (
              <tr key={e.id}>
                <td className="px-2 py-2 text-xs">{fmtDateTime(e.event_date)}</td>
                <td className="px-2 py-2 text-xs">{e.status || "—"}</td>
                <td className="px-2 py-2 text-xs">{e.substatus || "—"}</td>
                <td className="px-2 py-2 text-xs">{e.description || "—"}</td>
                <td className="px-2 py-2 text-xs">{e.source}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

/* ========================================================================== */
/* Rastreamentos (ao vivo + eventos)                                          */
/* ========================================================================== */

function RastreamentosTab({ accountId }: { accountId: string | null }) {
  const [modo, setModo] = useState<"aovivo" | "eventos" | "envios">("aovivo");
  return (
    <>
      <div className="flex gap-2">
        {(
          [
            ["aovivo", "Rastreamento ao vivo"],
            ["eventos", "Eventos do Mercado Livre"],
            ["envios", "Envios"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setModo(id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-bold backdrop-blur ${modo === id ? "bg-[#1F5FD4] text-white" : "bg-white/90 text-zinc-700"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {modo === "aovivo" && <RastreioAoVivo accountId={accountId} />}
      {modo === "eventos" && <EventosML accountId={accountId} />}
      {modo === "envios" && <EnviosTab accountId={accountId} />}
    </>
  );
}

function RastreioAoVivo({ accountId }: { accountId: string | null }) {
  const [auto, setAuto] = useState(true);
  const [offset, setOffset] = useState(0);
  const limit = 50;
  const { data, loading, error, reload } = useAsync(
    ["rastreio-vivo", accountId, offset],
    () => adminTrackingLive({ data: { accountId, limit, offset } }),
  );

  // Polling seguro: só enquanto a aba está visível e sem sobreposição de chamadas.
  useEffect(() => {
    if (!auto) return;
    const tick = () => {
      if (document.visibilityState === "visible") reload();
    };
    const t = setInterval(tick, 15000);
    return () => clearInterval(t);
  }, [auto, reload]);

  return (
    <>
      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Consultas registradas" value={data.resumo.total} />
          <Stat label="Últimas 24h" value={data.resumo.last24h} />
          <Stat label="Encontradas" value={data.resumo.encontrados} tone="ok" />
          <Stat label="Sem resultado" value={data.resumo.naoEncontrados} />
        </div>
      )}

      <Panel
        title="Rastreamento ao vivo"
        right={
          <label className="flex items-center gap-2 text-xs font-semibold text-zinc-600">
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
            Atualizar a cada 15s
            <button onClick={reload} className="ml-2 rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </label>
        }
      >
        {error ? (
          <ErrorBox message={error} onRetry={reload} />
        ) : !data ? (
          <Loading />
        ) : data.rows.length === 0 ? (
          <Empty>Nenhuma consulta de rastreio registrada até agora.</Empty>
        ) : (
          <>
            <Table head={["Data/hora", "Código", "Marketplace", "Origem", "Resultado", "Status", "Conta", "IP", "Navegador"]}>
              {data.rows.map((r: any) => (
                <tr key={r.id}>
                  <td className="px-2 py-2 text-xs">{fmtDateTime(r.created_at)}</td>
                  <td className="px-2 py-2 font-mono text-xs font-bold">{r.code}</td>
                  <td className="px-2 py-2 text-xs">{r.marketplace || "—"}</td>
                  <td className="px-2 py-2 text-xs">{r.source}</td>
                  <td className="px-2 py-2">
                    {r.found ? (
                      <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800">encontrado</Badge>
                    ) : (
                      <Badge className="border-zinc-300 bg-zinc-100 text-zinc-600">sem resultado</Badge>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs">{r.status || "—"}</td>
                  <td className="px-2 py-2 font-mono text-[11px]">{r.account_id ? String(r.account_id).slice(0, 8) + "…" : "—"}</td>
                  <td className="px-2 py-2 font-mono text-[11px]">{r.ip || "—"}</td>
                  <td className="px-2 py-2 max-w-[220px] truncate text-[11px] text-zinc-700">{r.user_agent || "—"}</td>
                </tr>
              ))}
            </Table>
            <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />
          </>
        )}
      </Panel>

      {data && data.topCodes.length > 0 && (
        <Panel title="Códigos mais consultados">
          <Table head={["Código", "Consultas", "Última consulta", "Resultado"]}>
            {data.topCodes.map((c: any) => (
              <tr key={c.code}>
                <td className="px-2 py-2 font-mono text-xs font-bold">{c.code}</td>
                <td className="px-2 py-2 tabular-nums">{c.consultas}</td>
                <td className="px-2 py-2 text-xs">{fmtDateTime(c.ultima)}</td>
                <td className="px-2 py-2 text-xs">{c.found ? "encontrado" : "sem resultado"}</td>
              </tr>
            ))}
          </Table>
        </Panel>
      )}
    </>
  );
}

function EventosML({ accountId }: { accountId: string | null }) {
  const [offset, setOffset] = useState(0);
  const limit = 50;
  useEffect(() => setOffset(0), [accountId]);
  const { data, loading, error, reload } = useAsync(
    ["eventos-ml", accountId, offset],
    () => adminTracking({ data: { accountId, limit, offset } }),
  );

  return (
    <Panel
      title="Eventos de rastreamento sincronizados"
      right={
        <button onClick={reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      }
    >
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading ? (
        <Loading />
      ) : !data || data.rows.length === 0 ? (
        <Empty />
      ) : (
        <>
          <Table head={["Data", "Shipment", "Status", "Substatus", "Descrição", "Origem"]}>
            {data.rows.map((e: any) => (
              <tr key={e.id}>
                <td className="px-2 py-2 text-xs">{fmtDateTime(e.event_date)}</td>
                <td className="px-2 py-2 font-mono text-[11px]">{e.ml_shipment_id}</td>
                <td className="px-2 py-2 text-xs">{e.status || "—"}</td>
                <td className="px-2 py-2 text-xs">{e.substatus || "—"}</td>
                <td className="px-2 py-2 text-xs">{e.description || "—"}</td>
                <td className="px-2 py-2 text-xs">{e.source}</td>
              </tr>
            ))}
          </Table>
          <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      )}
    </Panel>
  );
}

function EnviosTab({ accountId }: { accountId: string | null }) {
  const [offset, setOffset] = useState(0);
  const limit = 50;
  useEffect(() => setOffset(0), [accountId]);
  const { data, loading, error, reload } = useAsync(
    ["envios", accountId, offset],
    () => adminShipments({ data: { accountId, limit, offset } }),
  );

  return (
    <Panel
      title="Envios"
      right={
        <button onClick={reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      }
    >
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading ? (
        <Loading />
      ) : !data || data.rows.length === 0 ? (
        <Empty />
      ) : (
        <>
          <Table head={["Shipment", "Pedido", "Status", "Substatus", "Rastreio", "Transportadora", "Destino", "Previsão", "Atualizado"]}>
            {data.rows.map((s: any) => (
              <tr key={s.id}>
                <td className="px-2 py-2 font-mono text-[11px]">{s.ml_shipment_id}</td>
                <td className="px-2 py-2 font-mono text-[11px]">{s.ml_order_id || "—"}</td>
                <td className="px-2 py-2 text-xs">{s.status || "—"}</td>
                <td className="px-2 py-2 text-xs">{s.substatus || "—"}</td>
                <td className="px-2 py-2 font-mono text-[11px]">{s.tracking_number || "—"}</td>
                <td className="px-2 py-2 text-xs">{s.tracking_method || "—"}</td>
                <td className="px-2 py-2 text-xs">{[s.receiver_city, s.receiver_state].filter(Boolean).join(" / ") || "—"}</td>
                <td className="px-2 py-2 text-xs">{fmtDateTime(s.estimated_delivery)}</td>
                <td className="px-2 py-2 text-xs">{fmtDateTime(s.last_updated)}</td>
              </tr>
            ))}
          </Table>
          <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      )}
    </Panel>
  );
}

/* ========================================================================== */
/* Sincronizações                                                             */
/* ========================================================================== */

function SincronizacoesTab({ accountId }: { accountId: string | null }) {
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState("");
  const limit = 50;
  useEffect(() => setOffset(0), [accountId, status]);

  const { data, loading, error, reload } = useAsync(
    ["sincronizacoes", accountId, status, offset],
    () => adminSyncRuns({ data: { accountId, status: status || null, limit, offset } }),
  );

  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const sincronizar = async (full: boolean) => {
    if (!accountId) {
      setFeedback("Selecione uma conta acima para sincronizar.");
      return;
    }
    setBusy(true);
    setFeedback(null);
    try {
      const r = await adminSyncAccount({ data: { accountId, full } });
      setFeedback(
        r.status === "success"
          ? `Concluído: ${r.orders} pedidos, ${r.shipments} envios, ${r.events} eventos.`
          : `Falhou: ${r.error ?? "erro desconhecido"}`,
      );
      reload();
    } catch (e) {
      setFeedback(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Execuções de sincronização"
      right={
        <div className="flex flex-wrap items-center gap-2">
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900">
            <option value="">Todos</option>
            <option value="running">running</option>
            <option value="success">success</option>
            <option value="error">error</option>
          </select>
          <button
            onClick={() => sincronizar(false)}
            disabled={busy}
            className="rounded-lg bg-[#FFE600] px-3 py-1.5 text-xs font-bold text-black hover:bg-[#E6CF00] disabled:opacity-60"
          >
            Sincronizar agora
          </button>
          <button
            onClick={() => sincronizar(true)}
            disabled={busy}
            className="rounded-lg bg-[#1F5FD4] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#1A4FB0] disabled:opacity-60"
          >
            Sincronização completa
          </button>
          <button onClick={reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
            <RefreshCw className={`h-3.5 w-3.5 ${loading || busy ? "animate-spin" : ""}`} />
          </button>
        </div>
      }
    >
      {feedback && <p className="mb-3 text-xs font-semibold text-zinc-700">{feedback}</p>}
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading ? (
        <Loading />
      ) : !data || data.rows.length === 0 ? (
        <Empty />
      ) : (
        <>
          <Table head={["Início", "Fim", "Tipo", "Gatilho", "Status", "Pedidos", "Envios", "Eventos", "Tentativa", "Duração", "Erro"]}>
            {data.rows.map((r: any) => (
              <tr key={r.id}>
                <td className="px-2 py-2 text-xs">{fmtDateTime(r.started_at)}</td>
                <td className="px-2 py-2 text-xs">{fmtDateTime(r.finished_at)}</td>
                <td className="px-2 py-2 text-xs">{r.kind}</td>
                <td className="px-2 py-2 max-w-[200px] truncate text-xs">{r.trigger || "—"}</td>
                <td className="px-2 py-2">
                  <Badge
                    className={
                      r.status === "error"
                        ? "border-red-300 bg-red-100 text-red-800"
                        : r.status === "running"
                          ? "border-sky-300 bg-sky-100 text-sky-800"
                          : "border-emerald-300 bg-emerald-100 text-emerald-800"
                    }
                  >
                    {r.status}
                  </Badge>
                </td>
                <td className="px-2 py-2 tabular-nums">{r.orders_processed}</td>
                <td className="px-2 py-2 tabular-nums">{r.shipments_processed}</td>
                <td className="px-2 py-2 tabular-nums">{r.events_processed}</td>
                <td className="px-2 py-2 tabular-nums">{r.attempt}</td>
                <td className="px-2 py-2 text-xs">{fmtDuration(r.duration_ms)}</td>
                <td className="px-2 py-2 max-w-[260px] text-xs text-red-600">{r.error || "—"}</td>
              </tr>
            ))}
          </Table>
          <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      )}
    </Panel>
  );
}

/* ========================================================================== */
/* Ao vivo — quem está no site e quem tenta entrar no painel                  */
/* ========================================================================== */

/**
 * Monitor em tempo real.
 *
 * Atualiza sozinho a cada 10 s. Considera "online" quem deu sinal nos últimos
 * 90 s — o navegador bate de 30 em 30, então três batidas perdidas tiram a
 * pessoa da lista, o que absorve oscilação de rede sem mostrar fantasma.
 */
function AoVivoTab() {
  const { data, loading, error, reload } = useAsync(["ao-vivo"], () => adminAoVivo());
  const ips = useAsync(["ips-bloqueados"], () => adminIpsBloqueados());

  useEffect(() => {
    const t = setInterval(reload, 10_000);
    return () => clearInterval(t);
  }, [reload]);

  const bloquearIp = async (ip: string) => {
    if (!ip || ip === "—") return;
    if (!confirm(`Bloquear o endereço ${ip}?\n\nQuem estiver nele deixa de acessar o site, mesmo sem conta.\n\nCuidado: um IP pode ser compartilhado por um prédio ou por uma operadora de celular — outras pessoas podem ser barradas junto.`)) return;
    const motivo = prompt("Motivo (opcional):") ?? "";
    try {
      await adminBloquearIp({ data: { ip, bloquear: true, motivo } });
      reload();
      ips.reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Não foi possível bloquear.");
    }
  };

  const liberarIp = async (ip: string) => {
    try {
      await adminBloquearIp({ data: { ip, bloquear: false } });
      ips.reload();
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Não foi possível liberar.");
    }
  };

  const ipsBarrados = new Set((ips.data?.ips ?? []).map((i: any) => String(i.ip)));

  const desde = (iso: string) => {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}min`;
    return `${Math.floor(s / 3600)}h`;
  };

  return (
    <>
      {/* Alerta de força bruta primeiro: se existir, é o que importa agora. */}
      {data?.alertas?.length ? (
        <Panel title="⚠️ Possível tentativa de invasão">
          <div className="space-y-2">
            {data.alertas.map((a: any) => (
              <div key={a.ip} className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
                <strong className="font-mono">{a.ip}</strong> — {a.falhas} tentativas de login falhas nos últimos 15
                minutos.
              </div>
            ))}
          </div>
        </Panel>
      ) : null}

      <Panel
        title="Ao vivo"
        right={
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-zinc-700">atualiza sozinho</span>
            <button onClick={reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      >
        {error ? (
          <ErrorBox message={error} onRetry={reload} />
        ) : !data ? (
          <Loading />
        ) : (
          <>
            <div className="mb-4 grid grid-cols-3 gap-3">
              <Stat label="Online agora" value={data.totalOnline} tone={data.totalOnline > 0 ? "ok" : "default"} />
              <Stat label="No painel" value={data.noPainel} tone={data.noPainel > 0 ? "alert" : "default"} />
              <Stat label="Sem conta" value={data.anonimos} />
            </div>

            {data.online.length === 0 ? (
              <Empty>Ninguém com o site aberto neste momento.</Empty>
            ) : (
              <Table head={["Quem", "Onde está", "IP", "Navegador", "Há quanto tempo", "Visto", "Ação"]}>
                {data.online.map((o: any) => (
                  <tr key={o.sessaoId} className={`border-t border-zinc-100 ${o.noPainel ? "bg-amber-50/70" : ""}`}>
                    <td className="px-2 py-2 text-xs font-semibold">
                      {o.quem}
                      {!o.autenticado && (
                        <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-bold text-zinc-700">
                          ANÔNIMO
                        </span>
                      )}
                      {o.noPainel && (
                        <span className="ml-2 rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                          NO PAINEL
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2 font-mono text-xs">{o.pagina}</td>
                    <td className="px-2 py-2 font-mono text-xs">{o.ip || "—"}</td>
                    <td className="px-2 py-2 text-xs">{o.navegador}</td>
                    <td className="px-2 py-2 text-xs">{desde(o.desde)}</td>
                    <td className="px-2 py-2 text-xs text-zinc-700">há {desde(o.visto)}</td>
                    <td className="px-2 py-2 text-xs">
                      {o.ip && !ipsBarrados.has(String(o.ip)) ? (
                        <button
                          onClick={() => void bloquearIp(String(o.ip))}
                          className="rounded-lg bg-red-100 px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-200"
                        >
                          Bloquear IP
                        </button>
                      ) : o.ip ? (
                        <span className="text-[11px] font-bold text-red-600">bloqueado</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </>
        )}
      </Panel>

      <Panel title="Tentativas de acesso ao painel">
        {!data ? (
          <Loading />
        ) : data.tentativas.length === 0 ? (
          <Empty>Nenhuma tentativa registrada ainda.</Empty>
        ) : (
          <Table head={["Quando", "Painel", "E-mail", "Resultado", "IP", "Navegador", "Ação"]}>
            {data.tentativas.map((t: any) => (
              <tr key={t.id} className={`border-t border-zinc-100 ${t.sucesso ? "" : "bg-red-50/60"}`}>
                <td className="px-2 py-2 text-xs">{fmtDateTime(t.quando)}</td>
                <td className="px-2 py-2 text-xs">
                  {t.painel === "olho_de_deus" ? (
                    <span className="whitespace-nowrap rounded bg-[#1F5FD4] px-1.5 py-0.5 text-[10px] font-black text-[#FFE600]">
                      OLHO DE DEUS
                    </span>
                  ) : t.painel === "rastreios" ? (
                    <span className="whitespace-nowrap rounded bg-[#FFE600] px-1.5 py-0.5 text-[10px] font-black text-[#1F5FD4]">
                      RASTREIOS
                    </span>
                  ) : (
                    // Registros de antes da separação: não dá para saber.
                    <span className="text-zinc-500" title="Registrado antes de o sistema separar os painéis.">
                      —
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-xs">{t.email || "—"}</td>
                <td className="px-2 py-2 text-xs">
                  <ResultadoDaTentativa sucesso={t.sucesso} motivo={t.motivo} />
                </td>
                <td className="px-2 py-2 font-mono text-xs">{t.ip || "—"}</td>
                <td className="px-2 py-2 text-xs">{t.navegador}</td>
                <td className="px-2 py-2 text-xs">
                  {t.ip && !ipsBarrados.has(String(t.ip)) && !t.sucesso ? (
                    <button
                      onClick={() => void bloquearIp(String(t.ip))}
                      className="rounded-lg bg-red-100 px-2 py-1 text-[11px] font-bold text-red-700 hover:bg-red-200"
                    >
                      Bloquear IP
                    </button>
                  ) : t.ip && ipsBarrados.has(String(t.ip)) ? (
                    <span className="text-[11px] font-bold text-red-600">bloqueado</span>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel
        title={`Endereços bloqueados${ips.data ? ` (${ips.data.ips.length})` : ""}`}
        right={
          <button
            onClick={() => {
              const ip = prompt("IP a bloquear (ex.: 203.0.113.45):")?.trim();
              if (ip) void bloquearIp(ip);
            }}
            className="rounded-lg bg-zinc-100 px-2 py-1 text-[11px] font-bold text-zinc-700 hover:bg-zinc-200"
          >
            + Bloquear um IP
          </button>
        }
      >
        {!ips.data || ips.data.ips.length === 0 ? (
          <Empty>Nenhum endereço bloqueado.</Empty>
        ) : (
          <Table head={["IP", "Motivo", "Bloqueado em", "Por", "Tentou depois", "Ação"]}>
            {ips.data.ips.map((i: any) => (
              <tr key={i.ip} className="border-t border-zinc-100">
                <td className="px-2 py-2 font-mono text-xs font-semibold">{i.ip}</td>
                <td className="px-2 py-2 text-xs">{i.motivo || "—"}</td>
                <td className="px-2 py-2 text-xs">{fmtDateTime(i.bloqueado_em)}</td>
                <td className="px-2 py-2 text-xs">{i.bloqueado_por || "—"}</td>
                <td className="px-2 py-2 text-xs">
                  {i.tentativas_apos > 0 ? (
                    <span className="font-bold text-amber-700">{i.tentativas_apos}x</span>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-2 py-2 text-xs">
                  <button
                    onClick={() => void liberarIp(String(i.ip))}
                    className="rounded-lg bg-emerald-100 px-2 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-200"
                  >
                    Liberar
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

/* ========================================================================== */
/* Reclamações deste pedido                                                   */
/* ========================================================================== */

/**
 * Reclamação vinculada ao pedido, com as ações que o Mercado Livre permite.
 *
 * IMPORTANTE, e o motivo de não existir botão "abrir reclamação":
 * o ML não expõe endpoint público para ABRIR reclamação. Quem abre é o
 * comprador, pelo site ou app deles.
 *
 * ENCERRAR é por resolução: reembolso total, parcial, devolução ou mediação.
 * Qual delas vale depende do estágio e de você ser comprador ou vendedor — o
 * ML diz isso por reclamação, em players[].available_actions.
 *
 * Por isso os botões aqui são gerados a partir da resposta do ML, nunca
 * fixados no código. Botão que promete o que a API não faz é pior que
 * ausência de botão.
 */

/** Nome legível de cada ação do ML; o código original fica no title do botão. */
const ROTULO_ACAO: Record<string, string> = {
  refund: "Reembolsar total (encerra)",
  allow_partial_refund: "Oferecer reembolso parcial",
  allow_return: "Autorizar devolução",
  allow_return_label: "Autorizar devolução",
  open_dispute: "Abrir mediação",
  send_message_to_complainant: "Mensagem ao comprador",
  send_message_to_respondent: "Mensagem ao vendedor",
  send_message_to_mediator: "Mensagem ao mediador",
};
const rotuloAcao = (acao: string) => ROTULO_ACAO[acao] ?? acao;

/**
 * Confirma e coleta o que a ação exige (mensagem ou percentual).
 * Devolve null se o operador desistiu.
 */
function confirmarAcao(
  acao: string,
  claimId: string,
  textoPronto = "",
): { texto: string; percentual: number | null } | null {
  if (acao.startsWith("send_message_to_")) {
    const texto = (textoPronto || prompt(`${rotuloAcao(acao)} — reclamação ${claimId}:`) || "").trim();
    return texto ? { texto, percentual: null } : null;
  }
  if (acao === "allow_partial_refund") {
    const v = prompt(`Percentual do reembolso parcial (1 a 99) — reclamação ${claimId}:`);
    if (v == null || !v.trim()) return null;
    const percentual = Number(v.replace(",", ".").replace("%", ""));
    if (!confirm(`Oferecer ${percentual}% de reembolso ao comprador?\n\nSe ele aceitar, a reclamação é encerrada.`)) return null;
    return { texto: "", percentual };
  }
  const aviso =
    acao === "refund"
      ? "Devolve o valor TOTAL ao comprador e encerra a reclamação. Não tem volta."
      : "A ação vale no Mercado Livre e pode ser definitiva.";
  return confirm(`${rotuloAcao(acao)} — reclamação ${claimId}?\n\n${aviso}`) ? { texto: "", percentual: null } : null;
}

function ReclamacoesDoPedido({
  accountId,
  reclamacoes,
  onMudou,
}: {
  accountId: string;
  reclamacoes: any[];
  onMudou: () => void;
}) {
  const [ocupado, setOcupado] = useState<string | null>(null);

  const executar = async (claimId: string, acao: string) => {
    const dados = confirmarAcao(acao, claimId);
    if (!dados) return;
    setOcupado(`${claimId}:${acao}`);
    try {
      await adminReclamacaoAcao({ data: { accountId, claimId, acao, ...dados } });
      onMudou();
    } catch (e) {
      alert(e instanceof Error ? e.message : "O Mercado Livre recusou a ação.");
    } finally {
      setOcupado(null);
    }
  };

  return (
    <Panel title={`Reclamações deste pedido${reclamacoes.length ? ` (${reclamacoes.length})` : ""}`}>
      {reclamacoes.length === 0 ? (
        <>
          <Empty>Nenhuma reclamação aberta para este pedido.</Empty>
          <p className="mt-2 px-2 text-[11px] leading-relaxed text-zinc-700">
            Abrir reclamação não é possível por aqui: o Mercado Livre não oferece esse endpoint na API — quem abre é o
            comprador, pelo site ou aplicativo deles. Quando existir uma, ela aparece nesta área com as ações que o
            próprio ML permitir, inclusive as que encerram (reembolso, devolução).
          </p>
        </>
      ) : (
        <div className="space-y-3">
          {reclamacoes.map((r: any) => (
            <div key={r.id} className="rounded-lg border border-zinc-200 p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-mono font-bold text-zinc-900">#{r.id}</span>
                {r.estagio && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-800">{r.estagio}</span>
                )}
                {r.status && (
                  <span
                    className={`rounded px-1.5 py-0.5 font-bold ${
                      r.status === "closed" ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-700"
                    }`}
                  >
                    {r.status}
                  </span>
                )}
                {r.tipo && <span className="text-zinc-700">{r.tipo}</span>}
              </div>

              <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-zinc-600 sm:grid-cols-2">
                <span>Aberta em: {r.abertaEm ? fmtDateTime(r.abertaEm) : "—"}</span>
                <span>Atualizada: {r.atualizadaEm ? fmtDateTime(r.atualizadaEm) : "—"}</span>
                {r.motivo && <span className="sm:col-span-2">Motivo: {r.motivo}</span>}
              </div>

              <div className="mt-3 border-t border-zinc-100 pt-3">
                {r.acoesDisponiveis?.length ? (
                  <>
                    <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-700">
                      Ações liberadas pelo Mercado Livre
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {r.acoesDisponiveis.map((a: string) => (
                        <button
                          key={a}
                          title={a}
                          disabled={ocupado !== null}
                          onClick={() => void executar(String(r.id), a)}
                          className={`rounded-lg px-3 py-1.5 text-[11px] font-bold text-white transition disabled:opacity-50 ${
                            /refund/i.test(a) ? "bg-amber-600 hover:bg-amber-700" : "bg-[#1F5FD4] hover:bg-[#1A4FB0]"
                          }`}
                        >
                          {ocupado === `${r.id}:${a}` ? "enviando…" : rotuloAcao(a)}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-[11px] text-zinc-700">
                    O Mercado Livre não liberou nenhuma ação nesta reclamação no momento. Isso depende do estágio dela e
                    de você ser comprador ou vendedor no pedido.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

/* ========================================================================== */
/* Dados do comprador (billing_info do pedido)                                */
/* ========================================================================== */

/**
 * Mostra CPF, nome e endereço do comprador de forma legível.
 *
 * O Mercado Livre devolve isso em `additional_info`, um array de
 * { type, value } — formato bom para máquina e péssimo para gente. Antes o
 * painel jogava o JSON cru na tela; aqui os campos viram um cartão.
 *
 * O CPF nasce oculto e é revelado por clique. Dado pessoal em tela aberta é
 * o tipo de coisa que aparece sem querer num print ou numa reunião — e a
 * conferência com o cliente raramente precisa do número inteiro à vista.
 */
function DadosCompradorPanel({ faturamento }: { faturamento: any }) {
  const [cpfVisivel, setCpfVisivel] = useState(false);
  const [cru, setCru] = useState(false);

  const info: Record<string, string> = {};
  for (const item of faturamento?.additional_info ?? []) {
    if (item?.type) info[String(item.type)] = String(item.value ?? "");
  }

  const doc = faturamento?.doc_number ?? info["DOC_NUMBER"] ?? "";
  const tipoDoc = faturamento?.doc_type ?? info["DOC_TYPE"] ?? "Documento";
  const nome = [info["FIRST_NAME"], info["LAST_NAME"]].filter(Boolean).join(" ");
  const endereco = [
    [info["STREET_NAME"], info["STREET_NUMBER"]].filter(Boolean).join(", "),
    info["COMMENT"],
    info["NEIGHBORHOOD"],
    [info["CITY_NAME"], info["STATE_NAME"]].filter(Boolean).join(" / "),
    info["ZIP_CODE"] ? `CEP ${info["ZIP_CODE"]}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Panel
      title="Dados do comprador"
      right={
        <button
          onClick={() => setCru((v) => !v)}
          className="rounded-lg bg-zinc-100 px-2 py-1 text-[11px] font-semibold text-zinc-600 hover:bg-zinc-200"
        >
          {cru ? "Ver organizado" : "Ver JSON"}
        </button>
      }
    >
      {cru ? (
        <pre className="max-h-56 overflow-auto rounded-lg bg-zinc-950 p-3 text-[11px] text-emerald-300">
          {JSON.stringify(faturamento, null, 2)}
        </pre>
      ) : (
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          <Field label="Nome" value={nome || "—"} />
          <Field
            label={tipoDoc}
            value={
              !doc ? (
                "—"
              ) : cpfVisivel ? (
                <span className="font-mono">{formatarCpf(doc)}</span>
              ) : (
                <button
                  onClick={() => setCpfVisivel(true)}
                  className="font-mono text-zinc-700 underline decoration-dotted hover:text-zinc-900"
                  title="Clique para revelar"
                >
                  {mascararCpf(doc)}
                </button>
              )
            }
          />
          <div className="sm:col-span-2">
            <Field label="Endereço de faturamento" value={endereco || "—"} />
          </div>
        </div>
      )}
    </Panel>
  );
}

/* ========================================================================== */
/* Clientes do Únific+                                                        */
/* ========================================================================== */

/**
 * Quem criou conta no Únific+.
 *
 * O CPF aparece MASCARADO. Ver o número inteiro é um clique deliberado, e cada
 * revelação vai para admin_audit_log com o e-mail de quem consultou — é o que
 * separa "olhar a lista" de "acessar dado pessoal", como a LGPD espera.
 *
 * Senha não aparece aqui e nunca vai aparecer: ela vive em hash no Supabase
 * Auth e é ilegível até para o administrador. O PIN idem — a coluna só diz
 * se existe ou não.
 */
function ClientesTab() {
  const [q, setQ] = useState("");
  const [termo, setTermo] = useState("");
  const [offset, setOffset] = useState(0);
  const [cpfsAbertos, setCpfsAbertos] = useState<Record<string, string>>({});
  const limit = 50;

  useEffect(() => setOffset(0), [termo]);

  const { data, loading, error, reload } = useAsync(["clientes", termo, offset], () =>
    adminClientes({ data: { q: termo || null, limit, offset } }),
  );

  const revelar = async (userId: string) => {
    try {
      const r = await adminRevelarCpf({ data: { userId } });
      setCpfsAbertos((atual) => ({ ...atual, [userId]: r.cpf }));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Não foi possível revelar o CPF.");
    }
  };

  /*
   * Bloquear tira o acesso da pessoa ao site inteiro, então pede confirmação.
   * Desbloquear é inofensivo e vai direto.
   */
  const alternarBloqueio = async (c: any) => {
    if (c.bloqueado) {
      try {
        await adminBloquearCliente({ data: { userId: c.userId, bloquear: false } });
        reload();
      } catch (e) {
        alert(e instanceof Error ? e.message : "Não foi possível desbloquear.");
      }
      return;
    }

    if (!confirm(`Bloquear ${c.nome}?\n\nEla perde o acesso ao Únific+ imediatamente e passa a ver apenas um aviso de conta suspensa. Você pode desfazer a qualquer momento.`)) {
      return;
    }
    const motivo = prompt("Motivo (opcional — aparece para o cliente):") ?? "";
    try {
      await adminBloquearCliente({ data: { userId: c.userId, bloquear: true, motivo } });
      reload();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Não foi possível bloquear.");
    }
  };

  return (
    <Panel
      title={`Clientes cadastrados${data ? ` (${data.total})` : ""}`}
      right={
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && setTermo(q)}
            placeholder="Nome, e-mail, CPF ou telefone"
            className="w-56 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900"
          />
          <button onClick={() => setTermo(q)} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
            <Search className="h-3.5 w-3.5" />
          </button>
          <button onClick={reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      }
    >
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading ? (
        <Loading />
      ) : !data || data.clientes.length === 0 ? (
        <Empty>Nenhum cliente cadastrado ainda.</Empty>
      ) : (
        <>
          <Table head={["Nome", "E-mail", "Telefone", "CPF", "PIN", "Contas ML", "Cadastro", "Último acesso", "Acesso"]}>
            {data.clientes.map((c: any) => (
              <tr key={c.userId} className={`border-t border-zinc-100 ${c.bloqueado ? "bg-red-50/60" : ""}`}>
                <td className="px-2 py-2 text-xs font-semibold">
                  {c.nome}
                  {/* Entrou autorizando pelo Mercado Livre, sem preencher
                      cadastro — por isso não tem CPF, telefone nem PIN. */}
                  {c.origem === "mercado_livre" && (
                    <span
                      className="ml-2 rounded bg-[#FFE600] px-1.5 py-0.5 text-[10px] font-bold text-[#1F5FD4]"
                      title="Entrou autorizando pelo Mercado Livre, sem preencher cadastro."
                    >
                      VIA ML
                    </span>
                  )}
                  {c.bloqueado && (
                    <span
                      className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700"
                      title={c.motivoBloqueio ?? "Sem motivo informado"}
                    >
                      BLOQUEADO
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-xs">{c.email || "—"}</td>
                <td className="px-2 py-2 text-xs">
                  {c.telefone ? formatarTelefone(c.telefone) : "—"}
                </td>
                <td className="px-2 py-2 font-mono text-xs">
                  {!c.cpfMascarado ? (
                    <span className="text-zinc-600">—</span>
                  ) : cpfsAbertos[c.userId] ? (
                    <span className="text-zinc-900">{cpfsAbertos[c.userId]}</span>
                  ) : (
                    <button
                      onClick={() => revelar(c.userId)}
                      className="text-zinc-700 underline decoration-dotted hover:text-zinc-900"
                      title="Revelar o CPF completo. A consulta fica registrada na auditoria."
                    >
                      {c.cpfMascarado}
                    </button>
                  )}
                </td>
                <td className="px-2 py-2 text-xs">{c.temPin ? "✓" : "—"}</td>
                <td className="px-2 py-2 text-xs">
                  {c.contasMl.length ? c.contasMl.join(", ") : <span className="text-zinc-600">nenhuma</span>}
                </td>
                <td className="px-2 py-2 text-xs">{fmtDateTime(c.criadoEm)}</td>
                <td className="px-2 py-2 text-xs">{c.ultimoAcessoEm ? fmtDateTime(c.ultimoAcessoEm) : "—"}</td>
                <td className="px-2 py-2 text-xs">
                  <button
                    onClick={() => void alternarBloqueio(c)}
                    className={`rounded-lg px-2 py-1 text-[11px] font-bold ${
                      c.bloqueado
                        ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                        : "bg-red-100 text-red-700 hover:bg-red-200"
                    }`}
                  >
                    {c.bloqueado ? "Liberar" : "Bloquear"}
                  </button>
                </td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 px-2 text-[11px] text-zinc-700">
            Clique no CPF mascarado para ver o número completo — cada consulta fica registrada na Auditoria.
            Senha e PIN não são exibíveis: ficam guardados em hash e nem a administração consegue lê-los.
          </p>
          <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      )}
    </Panel>
  );
}

/* ========================================================================== */
/* Logs                                                                       */
/* ========================================================================== */

const LOG_CATEGORIES = [
  ["", "Todas"],
  ["login", "Login"],
  ["oauth", "OAuth"],
  ["refresh_token", "Refresh token"],
  ["sync", "Sincronização"],
  ["pedidos", "Pedidos"],
  ["webhook", "Webhook"],
  ["api_request", "API request"],
  ["api_response", "API response"],
  ["rastreio", "Rastreio"],
  ["admin", "Ações administrativas"],
  ["erro", "Erros"],
] as const;

function LogsTab({ accountId }: { accountId: string | null }) {
  const [category, setCategory] = useState("");
  const [level, setLevel] = useState("");
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<any | null>(null);
  const limit = 100;

  useEffect(() => setOffset(0), [accountId, category, level, term]);

  const { data, loading, error, reload } = useAsync(
    ["logs", accountId, category, level, term, offset],
    () => adminLogs({ data: { accountId, category: category || null, level: level || null, q: term || null, limit, offset } }),
  );

  return (
    <>
      <Panel
        title="Logs do sistema"
        right={
          <div className="flex flex-wrap items-center gap-2">
            <select value={category} onChange={(e) => setCategory(e.target.value)} className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900">
              {LOG_CATEGORIES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select value={level} onChange={(e) => setLevel(e.target.value)} className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-xs text-zinc-900">
              <option value="">Todos os níveis</option>
              <option value="info">info</option>
              <option value="warn">warn</option>
              <option value="error">error</option>
            </select>
            <div className="flex items-center gap-1 rounded-lg border border-zinc-300 px-2">
              <Search className="h-3.5 w-3.5 text-zinc-700" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setTerm(q)}
                placeholder="ação, endpoint, mensagem"
                className="w-48 bg-transparent py-1.5 text-xs text-zinc-900 outline-none placeholder:text-zinc-600"
              />
            </div>
            <button onClick={() => setTerm(q)} className="rounded-lg bg-[#1F5FD4] px-3 py-1.5 text-xs font-bold text-white">
              Filtrar
            </button>
            <button onClick={reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        }
      >
        {error ? (
          <ErrorBox message={error} onRetry={reload} />
        ) : loading ? (
          <Loading />
        ) : !data || data.rows.length === 0 ? (
          <Empty />
        ) : (
          <>
            <Table head={["Data/hora", "Nível", "Categoria", "Ação", "Conta", "Endpoint", "HTTP", "Duração", "Autor", "Resultado"]}>
              {data.rows.map((l: any) => (
                <tr key={l.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => setOpen(l)}>
                  <td className="px-2 py-2 whitespace-nowrap text-xs">{fmtDateTime(l.created_at)}</td>
                  <td className="px-2 py-2">
                    <Badge
                      className={
                        l.level === "error"
                          ? "border-red-300 bg-red-100 text-red-800"
                          : l.level === "warn"
                            ? "border-amber-300 bg-amber-100 text-amber-900"
                            : "border-zinc-300 bg-zinc-100 text-zinc-700"
                      }
                    >
                      {l.level}
                    </Badge>
                  </td>
                  <td className="px-2 py-2 text-xs font-semibold">{l.category}</td>
                  <td className="px-2 py-2 text-xs">{l.action}</td>
                  <td className="px-2 py-2 font-mono text-[11px]">{l.ml_user_id || "—"}</td>
                  <td className="px-2 py-2 max-w-[220px] truncate font-mono text-[11px]">{l.endpoint || "—"}</td>
                  <td className="px-2 py-2 text-xs">{l.http_status ?? "—"}</td>
                  <td className="px-2 py-2 text-xs">{fmtDuration(l.duration_ms)}</td>
                  <td className="px-2 py-2 max-w-[160px] truncate text-xs">{l.actor || "—"}</td>
                  <td className={`px-2 py-2 max-w-[260px] truncate text-xs ${l.success ? "text-zinc-600" : "text-red-600"}`}>
                    {l.error || l.message || (l.success ? "ok" : "falha")}
                  </td>
                </tr>
              ))}
            </Table>
            <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />
          </>
        )}
      </Panel>

      {open && (
        <Panel
          title={`Detalhe do log — ${open.action}`}
          right={
            <button onClick={() => setOpen(null)} className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-700">
              Fechar
            </button>
          }
        >
          <pre className="max-h-[420px] overflow-auto rounded-lg bg-zinc-950 p-4 text-[11px] leading-relaxed text-emerald-300">
            {JSON.stringify(open, null, 2)}
          </pre>
          <p className="mt-2 text-[11px] text-zinc-700">
            Segredos (tokens, client_secret, service_role_key) são removidos antes da gravação — nunca aparecem aqui.
          </p>
        </Panel>
      )}
    </>
  );
}

/* ========================================================================== */
/* Erros                                                                      */
/* ========================================================================== */

function ErrosTab() {
  const { data, loading, error, reload } = useAsync(["erros"], () => adminErrors());
  const webhooks = useAsync(["webhooks"], () => adminWebhookEvents({ data: { limit: 50, offset: 0 } }));
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [recuperando, setRecuperando] = useState(false);
  const [recuperacao, setRecuperacao] = useState<any>(null);

  const reprocessar = async (id: string) => {
    setBusy(id);
    setFeedback(null);
    try {
      const r = await adminReprocessWebhook({ data: { id } });
      setFeedback(`Notificação reprocessada: ${r.status}.`);
      reload();
      webhooks.reload();
    } catch (e) {
      setFeedback(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Empty />;

  return (
    <>
      {feedback && <p className="text-xs font-semibold text-zinc-700">{feedback}</p>}

      <Panel title={`Contas com erro (${data.accounts.length})`}>
        {data.accounts.length === 0 ? (
          <Empty>Nenhuma conta com erro.</Empty>
        ) : (
          <Table head={["Conta", "ML user", "Status", "Último erro", "Quando"]}>
            {data.accounts.map((a: any) => (
              <tr key={a.id}>
                <td className="px-2 py-2 font-semibold">{a.nickname || "—"}</td>
                <td className="px-2 py-2 font-mono text-xs">{a.ml_user_id}</td>
                <td className="px-2 py-2">
                  <Badge className={accountStatus(a.status).className}>{accountStatus(a.status).label}</Badge>
                </td>
                <td className="px-2 py-2 text-xs text-red-600">{a.last_error}</td>
                <td className="px-2 py-2 text-xs">{fmtDateTime(a.updated_at)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title={`Sincronizações com erro (${data.syncs.length})`}>
        {data.syncs.length === 0 ? (
          <Empty>Nenhuma falha de sincronização.</Empty>
        ) : (
          <Table head={["Início", "Tipo", "Conta", "Erro"]}>
            {data.syncs.map((s: any) => (
              <tr key={s.id}>
                <td className="px-2 py-2 text-xs">{fmtDateTime(s.started_at)}</td>
                <td className="px-2 py-2 text-xs">{s.kind}</td>
                <td className="px-2 py-2 font-mono text-[11px]">{s.account_id ? String(s.account_id).slice(0, 8) + "…" : "—"}</td>
                <td className="px-2 py-2 text-xs text-red-600">{s.error}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Notificações perdidas (enquanto o sistema esteve offline)">
        <p className="text-sm text-zinc-600">
          Quando o webhook não está acessível — túnel fora do ar, servidor parado — o Mercado Livre guarda os eventos
          em <code className="rounded bg-zinc-100 px-1">/missed_feeds</code>. Esta rotina busca e processa o que ficou
          para trás, sem duplicar o que já entrou.
        </p>
        <p className="mt-2 text-xs text-zinc-700">
          Roda sozinha a cada execução do cron. O botão abaixo força agora.
        </p>

        {recuperacao && (
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Pendentes lidas" value={recuperacao.lidas} />
            <Stat label="Processadas" value={recuperacao.processadas} tone="ok" />
            <Stat label="Ignoradas" value={recuperacao.ignoradas} />
            <Stat label="Já vistas" value={recuperacao.jaVistas} />
            <Stat label="Com erro" value={recuperacao.erros} tone={recuperacao.erros ? "alert" : "default"} />
          </div>
        )}

        {recuperacao && recuperacao.detalhes.length > 0 && (
          <div className="mt-3">
            <Table head={["Recurso", "Tópico", "Conta ML", "Resultado"]}>
              {recuperacao.detalhes.map((d: any, i: number) => (
                <tr key={`${d.recurso}-${i}`}>
                  <td className="px-2 py-2 font-mono text-[11px]">{d.recurso}</td>
                  <td className="px-2 py-2 text-xs">{d.topico}</td>
                  <td className="px-2 py-2 font-mono text-[11px]">{d.mlUserId ?? "—"}</td>
                  <td className="px-2 py-2 text-xs">{d.resultado}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}

        <button
          onClick={async () => {
            setRecuperando(true);
            setFeedback(null);
            try {
              const r = await adminRecuperarPerdidas();
              setRecuperacao(r);
              setFeedback(
                r.lidas === 0
                  ? "Nenhuma notificação pendente."
                  : `${r.lidas} pendente(s): ${r.processadas} processada(s), ${r.ignoradas} ignorada(s).`,
              );
              webhooks.reload();
            } catch (e) {
              setFeedback(errorMessage(e));
            } finally {
              setRecuperando(false);
            }
          }}
          disabled={recuperando}
          className="mt-4 flex items-center gap-2 rounded-lg bg-[#1F5FD4] px-4 py-2 text-sm font-bold text-white hover:bg-[#1A4FB0] disabled:opacity-60"
        >
          {recuperando ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Recuperar notificações perdidas
        </button>
      </Panel>

      <Panel
        title="Notificações do Mercado Livre"
        right={
          <button onClick={webhooks.reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
            <RefreshCw className={`h-3.5 w-3.5 ${webhooks.loading ? "animate-spin" : ""}`} />
          </button>
        }
      >
        {webhooks.error ? (
          <ErrorBox message={webhooks.error} onRetry={webhooks.reload} />
        ) : webhooks.loading ? (
          <Loading />
        ) : !webhooks.data || webhooks.data.rows.length === 0 ? (
          <Empty>Nenhuma notificação recebida. Cadastre a URL do webhook no aplicativo do Mercado Livre.</Empty>
        ) : (
          <Table head={["Recebida", "Tópico", "Recurso", "ML user", "Tentativas", "Status", "Erro", "Ação"]}>
            {webhooks.data.rows.map((w: any) => (
              <tr key={w.id}>
                <td className="px-2 py-2 text-xs">{fmtDateTime(w.received_at)}</td>
                <td className="px-2 py-2 text-xs">{w.topic}</td>
                <td className="px-2 py-2 font-mono text-[11px]">{w.resource}</td>
                <td className="px-2 py-2 font-mono text-[11px]">{w.ml_user_id || "—"}</td>
                <td className="px-2 py-2 tabular-nums">{w.attempts ?? "—"}</td>
                <td className="px-2 py-2">
                  <Badge
                    className={
                      w.status === "error"
                        ? "border-red-300 bg-red-100 text-red-800"
                        : w.status === "processed"
                          ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                          : "border-zinc-300 bg-zinc-100 text-zinc-700"
                    }
                  >
                    {w.status}
                  </Badge>
                </td>
                <td className="px-2 py-2 max-w-[220px] truncate text-xs text-red-600">{w.error || "—"}</td>
                <td className="px-2 py-2">
                  {w.status === "error" ? (
                    <button
                      onClick={() => reprocessar(w.id)}
                      disabled={busy === w.id}
                      className="rounded-md bg-[#1F5FD4] px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
                    >
                      {busy === w.id ? "…" : "Reprocessar"}
                    </button>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

/* ========================================================================== */
/* Mercado Livre ao vivo                                                      */
/* ========================================================================== */

/* ========================================================================== */
/* Mercado Livre — cada assunto na sua aba                                    */
/* ========================================================================== */

/**
 * Dados ao vivo da conta. Todas as abas do grupo "Mercado Livre" usam a MESMA
 * chave de cache, então trocar de aba não refaz a chamada — o react-query
 * reaproveita por 60s.
 */
function useMl(accountId: string | null) {
  return useAsync(
    ["ml-ao-vivo", accountId],
    () => adminMlAoVivo({ data: { accountId: accountId! } }),
    Boolean(accountId),
  );
}

/** Aviso padrão quando nenhuma conta foi escolhida. */
function ExigeConta({ titulo }: { titulo: string }) {
  return (
    <Panel title={titulo}>
      <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
        Selecione uma conta em “Conta em foco”, no topo da página.
      </p>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* Comprador — resumo de gastos                                               */
/* -------------------------------------------------------------------------- */

/**
 * Financeiro do comprador.
 *
 * Saldo em dinheiro a API do ML não entrega (403); o que mostramos é quanto a
 * conta já gastou, a partir dos pedidos sincronizados. Um aviso no topo deixa
 * claro por que não há saldo de carteira.
 */
function CompradorTab({ accountId }: { accountId: string | null }) {
  const { data, loading, error, reload } = useAsync(
    ["resumo-comprador", accountId],
    () => adminResumoComprador({ data: { accountId: accountId! } }),
    Boolean(accountId),
  );

  if (!accountId) return <ExigeConta titulo="Comprador" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;

  const m = (v: number) => fmtMoney(v, data.moeda);
  const maxMes = Math.max(1, ...data.porMes.map((p) => p.total));
  const nomeMes = (aaaaMM: string) => {
    const [a, mes] = aaaaMM.split("-");
    const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
    return `${nomes[Number(mes) - 1] ?? mes}/${String(a).slice(2)}`;
  };

  return (
    <>
      <Panel title={`Comprador — ${data.conta.nickname ?? data.conta.mlUserId ?? ""}`}>
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{data.semSaldo}</span>
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Total gasto" value={m(data.totalGasto)} tone="ok" />
          <Stat label="Compras" value={data.totalCompras} />
          <Stat label="Ticket médio" value={m(data.ticketMedio)} />
          <Stat label="Maior compra" value={m(data.maiorCompra)} />
        </div>
        {data.canceladas > 0 && (
          <p className="mt-2 text-xs text-zinc-600">
            {data.canceladas} compra(s) cancelada(s) não entram no total.
          </p>
        )}
      </Panel>

      <Panel title="Gasto por mês">
        {data.porMes.length === 0 ? (
          <Empty>Sem compras registradas para esta conta.</Empty>
        ) : (
          <div className="space-y-3">
            {data.porMes.map((p) => (
              <div key={p.mes} className="flex items-center gap-2 sm:gap-3">
                <span className="w-12 shrink-0 text-xs font-bold uppercase text-zinc-600">{nomeMes(p.mes)}</span>
                <div className="h-5 flex-1 overflow-hidden rounded-md bg-zinc-100">
                  {/* Barra só preenche; o valor fica fora, sempre legível. */}
                  <div
                    className="h-full rounded-md bg-[#1F5FD4]"
                    style={{ width: `${Math.max(4, (p.total / maxMes) * 100)}%` }}
                  />
                </div>
                <span className="w-24 shrink-0 text-right text-xs font-bold tabular-nums text-[#1F5FD4] sm:w-28">
                  {m(p.total)}
                </span>
                <span className="hidden w-16 shrink-0 text-right text-[11px] text-zinc-500 sm:block">
                  {p.qtd} compra(s)
                </span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Últimas compras">
        {data.ultimas.length === 0 ? (
          <Empty>Sem compras registradas.</Empty>
        ) : (
          <Table head={["Pedido", "Item", "Qtd", "Valor", "Status", "Data"]}>
            {data.ultimas.map((c) => (
              <tr key={c.id}>
                <td className="px-2 py-2 font-mono text-[11px] text-[#1F5FD4]">{c.id}</td>
                <td className="px-2 py-2 text-xs">{c.titulo ?? "—"}</td>
                <td className="px-2 py-2 text-xs tabular-nums">{c.quantidade ?? "—"}</td>
                <td className="px-2 py-2 text-xs font-bold tabular-nums">{m(c.valor)}</td>
                <td className="px-2 py-2">
                  <Badge
                    className={
                      c.status === "cancelled"
                        ? "border-red-300 bg-red-100 text-red-800"
                        : "border-emerald-300 bg-emerald-100 text-emerald-800"
                    }
                  >
                    {c.status ?? "—"}
                  </Badge>
                </td>
                <td className="px-2 py-2 text-xs">{fmtDateTime(c.data)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Conta ML — perfil, autorização, configurações, faturamento                 */
/* -------------------------------------------------------------------------- */

function ContaMlTab({ accountId }: { accountId: string | null }) {
  const { data, loading, error, reload } = useMl(accountId);
  if (!accountId) return <ExigeConta titulo="Conta no Mercado Livre" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;

  const p = data.perfil;

  return (
    <>
      <Panel
        title={`Conta — ${data.conta.nickname ?? data.conta.mlUserId}`}
        right={
          <button onClick={reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        }
      >
        {!p ? (
          <Empty>Não foi possível ler o perfil agora.</Empty>
        ) : (
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <Field label="Apelido" value={p.nickname ?? "—"} />
            <Field label="Nome" value={p.nome ?? "—"} />
            <Field label="ML user ID" value={<span className="font-mono text-xs">{data.conta.mlUserId}</span>} />
            <Field label="Cadastrado em" value={fmtDateTime(p.registradoEm)} />
            <Field label="Tipo" value={p.tipo ?? "—"} />
            <Field label="País / site" value={`${p.pais ?? "—"} · ${data.conta.siteId ?? "—"}`} />
            <Field label="Status no ML" value={p.statusConta?.site_status ?? "—"} />
            <Field
              label="Reputação como comprador"
              value={p.reputacaoComprador?.tags?.length ? p.reputacaoComprador.tags.join(", ") : "sem histórico"}
            />
            <Field label="Reputação como vendedor" value={p.reputacaoVendedor?.level_id ?? "sem histórico"} />
          </dl>
        )}
      </Panel>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Compras" value={data.compras.total} />
        <Stat label="Vendas" value={data.vendas.total} />
        <Stat label="Arquivadas" value={data.comprasArquivadas.total} />
        <Stat label="Anúncios" value={data.anuncios.total} />
        <Stat label="Perguntas recebidas" value={data.perguntasRecebidas.total} />
        <Stat label="Perguntas feitas" value={data.perguntasFeitas.total} />
        <Stat label="Visitas (30d)" value={data.visitas.total} />
        <Stat label="Não lidas" value={data.mensagensNaoLidas.total} tone={data.mensagensNaoLidas.total ? "alert" : "default"} />
      </div>

      <Panel title="Autorização do aplicativo">
        {!data.autorizacao ? (
          <Empty>Não foi possível ler a autorização.</Empty>
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <Field label="Aplicativo" value={data.aplicativo?.nome ?? "—"} />
              <Field label="Autorizado em" value={fmtDateTime(data.autorizacao.autorizadoEm)} />
              <Field label="Atualizado em" value={fmtDateTime(data.autorizacao.atualizadoEm)} />
            </dl>
            <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-zinc-700">
              Permissões concedidas ({data.autorizacao.escopos.length})
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.autorizacao.escopos.map((s: string) => (
                <Badge key={s} className="border-zinc-300 bg-zinc-100 font-mono text-zinc-700">
                  {s}
                </Badge>
              ))}
            </div>
          </>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Formas de pagamento aceitas">
          {data.pagamentos.itens.length === 0 ? (
            <Empty />
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {data.pagamentos.itens.map((m: any) => (
                <Badge key={m.id} className="border-zinc-300 bg-white text-zinc-700">
                  {m.name ?? m.id}
                </Badge>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Preferências de envio">
          {!data.envioPreferencias.dados ? (
            <Empty />
          ) : (
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Retirada em mãos" value={data.envioPreferencias.dados.local_pick_up ? "sim" : "não"} />
              <Field label="Volumoso" value={data.envioPreferencias.dados.bulky ? "sim" : "não"} />
              <Field label="Usuário confiável" value={data.envioPreferencias.dados.trusted_user ? "sim" : "não"} />
              <Field
                label="Modos"
                value={Array.isArray(data.envioPreferencias.dados.modes) ? data.envioPreferencias.dados.modes.join(", ") || "—" : "—"}
              />
            </dl>
          )}
        </Panel>
      </div>

      <Panel title={`Faturamento (${data.faturas.total} período(s))`}>
        {data.faturas.itens.length === 0 ? (
          <Empty>Nenhum período de fatura.</Empty>
        ) : (
          <Table head={["Período", "Início", "Fim", "Status"]}>
            {data.faturas.itens.map((f: any, i: number) => (
              <tr key={f.key ?? i}>
                <td className="px-2 py-2 font-mono text-xs">{f.key ?? "—"}</td>
                <td className="px-2 py-2 text-xs">{fmtDateTime(f.date_from ?? f.period_from)}</td>
                <td className="px-2 py-2 text-xs">{fmtDateTime(f.date_to ?? f.period_to)}</td>
                <td className="px-2 py-2 text-xs">{f.status ?? "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Recursos que a API do Mercado Livre não libera para este aplicativo">
        <ul className="space-y-2">
          {data.indisponiveis.map((x: any) => (
            <li key={x.recurso} className="flex items-start gap-2 text-sm">
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-600" />
              <span>
                <strong>{x.recurso}</strong> — <span className="text-zinc-600">{x.motivo}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-zinc-700">
          Cada item foi testado com o token real desta conta. Nada aqui é suposição.
        </p>
      </Panel>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Mensagens — conversas pós-venda                                            */
/* -------------------------------------------------------------------------- */

function MensagensTab({ accountId }: { accountId: string | null }) {
  const { data, loading, error, reload } = useMl(accountId);
  const pedidos = useAsync(
    ["ml-pedidos-msg", accountId],
    () => adminOrders({ data: { accountId, limit: 50, offset: 0 } }),
    Boolean(accountId),
  );

  if (!accountId) return <ExigeConta titulo="Mensagens" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;

  return (
    <>
      <Panel
        title={`Mensagens não lidas (${data.mensagensNaoLidas.total})`}
        right={
          <button onClick={reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        }
      >
        {data.mensagensNaoLidas.conversas.length === 0 ? (
          <Empty>Nenhuma mensagem não lida.</Empty>
        ) : (
          <Table head={["Pedido", "Vendedor", "Não lidas"]}>
            {data.mensagensNaoLidas.conversas.map((c: any) => (
              <tr key={c.recurso}>
                <td className="px-2 py-2 font-mono text-xs">{c.pack ?? "—"}</td>
                <td className="px-2 py-2 font-mono text-xs">{c.vendedor ?? "—"}</td>
                <td className="px-2 py-2">
                  <Badge className="border-red-300 bg-red-100 text-red-800">{c.quantidade}</Badge>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Conversas por pedido">
        <p className="mb-3 text-xs text-zinc-700">
          A conversa completa, com o campo para responder, fica dentro de cada pedido. Clique para abrir.
        </p>
        {pedidos.loading ? (
          <Loading />
        ) : !pedidos.data || pedidos.data.rows.length === 0 ? (
          <Empty>Nenhum pedido nesta conta.</Empty>
        ) : (
          <Table head={["Pedido", "Data", "Item", "Status", "Abrir conversa"]}>
            {pedidos.data.rows.map((o: any) => (
              <tr key={o.id}>
                <td className="px-2 py-2 font-mono text-xs text-[#1F5FD4]">{o.ml_order_id}</td>
                <td className="px-2 py-2 text-xs">{fmtDateTime(o.date_created)}</td>
                <td className="px-2 py-2 max-w-[280px] truncate text-xs">{o.title ?? "—"}</td>
                <td className="px-2 py-2 text-xs">{o.status ?? "—"}</td>
                <td className="px-2 py-2">
                  <span className="rounded-md bg-[#FFE600] px-2 py-1 text-[11px] font-bold text-black">
                    ver em Pedidos
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Perguntas — o canal pré-venda                                              */
/* -------------------------------------------------------------------------- */

function PerguntasTab({ accountId }: { accountId: string | null }) {
  const { data, loading, error, reload } = useMl(accountId);
  const [respondendo, setRespondendo] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [aviso, setAviso] = useState<{ ok: boolean; msg: string } | null>(null);

  const responder = async (questionId: string) => {
    setAviso(null);
    try {
      await adminResponderPergunta({ data: { accountId: accountId!, questionId, texto } });
      setAviso({ ok: true, msg: "Resposta enviada ao Mercado Livre." });
      setRespondendo(null);
      setTexto("");
      reload();
    } catch (e) {
      setAviso({ ok: false, msg: errorMessage(e) });
    }
  };

  if (!accountId) return <ExigeConta titulo="Perguntas" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;

  return (
    <>
      {aviso && <p className={`text-xs font-semibold ${aviso.ok ? "text-emerald-700" : "text-red-600"}`}>{aviso.msg}</p>}

      <Panel
        title={`Perguntas recebidas nos anúncios (${data.perguntasRecebidas.total})`}
        right={
          <button onClick={reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        }
      >
        {!data.perguntasRecebidas.ok ? (
          <ErrorBox message={data.perguntasRecebidas.erro ?? "Falha ao consultar."} />
        ) : data.perguntasRecebidas.itens.length === 0 ? (
          <Empty>Nenhuma pergunta recebida.</Empty>
        ) : (
          <ul className="space-y-3">
            {data.perguntasRecebidas.itens.map((q: any) => (
              <li key={q.id} className="rounded-lg border border-zinc-200 p-3">
                <p className="text-sm font-bold text-zinc-800">{q.text}</p>
                <p className="mt-0.5 text-[11px] text-zinc-700">
                  {fmtDateTime(q.date_created)} · anúncio {q.item_id} · {q.status}
                </p>
                {q.answer ? (
                  <p className="mt-2 rounded bg-emerald-50 p-2 text-xs text-emerald-900">
                    <strong>Respondido:</strong> {q.answer.text}
                  </p>
                ) : respondendo === String(q.id) ? (
                  <div className="mt-2">
                    <textarea
                      value={texto}
                      onChange={(e) => setTexto(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-zinc-300 bg-white p-2 text-xs text-zinc-900 outline-none focus:border-[#1F5FD4]"
                      placeholder="Escreva a resposta…"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => responder(String(q.id))}
                        disabled={!texto.trim()}
                        className="rounded-md bg-[#1F5FD4] px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
                      >
                        Enviar resposta
                      </button>
                      <button
                        onClick={() => { setRespondendo(null); setTexto(""); }}
                        className="rounded-md bg-zinc-100 px-3 py-1.5 text-[11px] font-bold text-zinc-700"
                      >
                        Cancelar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => { setRespondendo(String(q.id)); setTexto(""); }}
                    className="mt-2 rounded-md bg-[#FFE600] px-3 py-1 text-[11px] font-bold text-black"
                  >
                    Responder
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={`Perguntas feitas por esta conta (${data.perguntasFeitas.total})`}>
        {data.perguntasFeitas.itens.length === 0 ? (
          <Empty>Esta conta ainda não perguntou em nenhum anúncio.</Empty>
        ) : (
          <ul className="space-y-2">
            {data.perguntasFeitas.itens.map((q: any) => (
              <li key={q.id} className="rounded-lg border border-zinc-200 p-3 text-sm">
                <p className="font-bold text-zinc-800">{q.text}</p>
                <p className="mt-0.5 text-[11px] text-zinc-700">
                  {fmtDateTime(q.date_created)} · anúncio {q.item_id}
                </p>
                {q.answer && (
                  <p className="mt-2 rounded bg-zinc-50 p-2 text-xs">
                    <strong>Vendedor respondeu:</strong> {q.answer.text}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Anúncios, promoções e métricas                                             */
/* -------------------------------------------------------------------------- */

function AnunciosTab({ accountId }: { accountId: string | null }) {
  const { data, loading, error, reload } = useMl(accountId);
  if (!accountId) return <ExigeConta titulo="Anúncios" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (loading || !data) return <Loading />;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Anúncios" value={data.anuncios.total} />
        <Stat label="Promoções" value={data.promocoes.total} />
        <Stat label="Visitas (30d)" value={data.visitas.total} />
        <Stat label="Vendas" value={data.vendas.total} />
      </div>

      <Panel
        title={`Anúncios publicados (${data.anuncios.total})`}
        right={
          <button onClick={reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        }
      >
        {data.anuncios.detalhes.length === 0 ? (
          <Empty>Esta conta não tem anúncios publicados.</Empty>
        ) : (
          <div className="space-y-3">
            {data.anuncios.detalhes.map((a: any) => (
              <div key={a.id} className="flex flex-wrap gap-4 rounded-lg border border-zinc-200 p-3">
                {a.foto && (
                  <img
                    src={a.foto}
                    alt=""
                    className="h-20 w-20 shrink-0 rounded-lg border border-zinc-200 object-cover"
                    loading="lazy"
                  />
                )}
                <div className="min-w-[260px] flex-1">
                  <p className="text-sm font-bold text-zinc-900">{a.titulo ?? a.id}</p>
                  <p className="mt-0.5 text-xs text-zinc-700">
                    <span className="font-mono">{a.id}</span>
                    {a.criadoEm ? ` · criado em ${fmtDateTime(a.criadoEm)}` : ""}
                  </p>
                  <p className="mt-1 text-lg font-black text-zinc-900">{fmtMoney(a.preco, a.moeda)}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Badge
                      className={
                        a.status === "active"
                          ? "border-emerald-300 bg-emerald-100 text-emerald-800"
                          : "border-zinc-300 bg-zinc-100 text-zinc-700"
                      }
                    >
                      {a.status ?? "—"}
                    </Badge>
                    {a.condicao && (
                      <Badge className="border-zinc-300 bg-white text-zinc-700">
                        {a.condicao === "new" ? "novo" : a.condicao}
                      </Badge>
                    )}
                    {a.tipoAnuncio && (
                      <Badge className="border-zinc-300 bg-white text-zinc-700">{a.tipoAnuncio}</Badge>
                    )}
                    {a.freteGratis && (
                      <Badge className="border-emerald-300 bg-emerald-50 text-emerald-800">frete grátis</Badge>
                    )}
                    {a.retiradaEmMaos && (
                      <Badge className="border-sky-300 bg-sky-50 text-sky-800">retirada em mãos</Badge>
                    )}
                    {(a.subStatus ?? []).map((s: string) => (
                      <Badge key={s} className="border-amber-300 bg-amber-50 text-amber-900">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  {a.garantia && <p className="mt-1.5 text-xs text-zinc-600">Garantia: {a.garantia}</p>}
                  {a.permalink && (
                    <a
                      href={a.permalink}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-block text-xs font-bold text-[#1F5FD4] underline"
                    >
                      abrir no Mercado Livre
                    </a>
                  )}
                </div>

                <div className="grid shrink-0 grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-zinc-700">Estoque</p>
                    <p className="text-lg font-black tabular-nums">{a.estoque ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-zinc-700">Vendidos</p>
                    <p className="text-lg font-black tabular-nums">{a.vendidos ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-zinc-700">Visitas 30d</p>
                    <p className="text-lg font-black tabular-nums">{a.visitas30d ?? 0}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Tipos de anúncio disponíveis">
        {data.tiposAnuncio.disponiveis.length === 0 ? (
          <Empty />
        ) : (
          <Table head={["Tipo", "Disponível", "Saldo"]}>
            {data.tiposAnuncio.disponiveis.map((t: any, i: number) => (
              <tr key={t.listing_type_id ?? t.id ?? i}>
                <td className="px-2 py-2 font-mono text-xs">
                  {t.listing_type_id ?? t.id ?? t.type ?? t.name ?? `(item ${i + 1})`}
                </td>
                <td className="px-2 py-2 text-xs">{t.available ? "sim" : "não"}</td>
                <td className="px-2 py-2 tabular-nums">{t.balance ?? "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Notificações do Mercado Livre">
        {data.notificacoes.itens.length === 0 ? (
          <Empty>Nenhuma notificação pendente.</Empty>
        ) : (
          <pre className="max-h-56 overflow-auto rounded-lg bg-zinc-950 p-3 text-[11px] text-emerald-300">
            {JSON.stringify(data.notificacoes.itens, null, 2)}
          </pre>
        )}
      </Panel>
    </>
  );
}
/**
 * Reclamações da conta.
 * Abrir não tem endpoint; ler e AGIR (fechar, responder, devolver…) tem —
 * as ações vêm do próprio Mercado Livre, por reclamação.
 */
function ReclamacoesPainel({ accountId }: { accountId: string | null }) {
  const [aberta, setAberta] = useState<string | null>(null);
  const { data, loading, error, reload } = useAsync(
    ["ml-reclamacoes", accountId],
    () => adminReclamacoes({ data: { accountId: accountId! } }),
    Boolean(accountId),
  );

  if (aberta && accountId) {
    return <ReclamacaoDetalhe accountId={accountId} claimId={aberta} onVoltar={() => { setAberta(null); reload(); }} />;
  }

  const linhas = (itens: any[]) =>
    itens.map((r) => (
      <tr key={r.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => setAberta(String(r.id))}>
        <td className="px-2 py-2 font-mono text-xs text-[#1F5FD4] underline">{r.id}</td>
        <td className="px-2 py-2 font-mono text-[11px]">{r.pedido}</td>
        <td className="px-2 py-2 text-xs">{r.tipo ?? "—"}</td>
        <td className="px-2 py-2 text-xs">{r.estagio ?? "—"}</td>
        <td className="px-2 py-2">
          <Badge
            className={
              String(r.status).toLowerCase() === "closed"
                ? "border-zinc-300 bg-zinc-100 text-zinc-700"
                : "border-amber-300 bg-amber-100 text-amber-900"
            }
          >
            {r.status ?? "—"}
          </Badge>
        </td>
        <td className="px-2 py-2 text-xs">{r.motivo ?? "—"}</td>
        <td className="px-2 py-2 text-xs">{fmtDateTime(r.abertaEm)}</td>
        <td className="px-2 py-2 text-xs">{fmtDateTime(r.atualizadaEm)}</td>
      </tr>
    ));

  const cabecalho = ["ID", "Pedido", "Tipo", "Estágio", "Status", "Motivo", "Aberta em", "Atualizada"];

  return (
    <Panel
      title="Reclamações e mediações"
      right={
        <button onClick={reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      }
    >
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading || !data ? (
        <Loading />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat
              label="Em andamento"
              value={data.emAndamento.total}
              tone={data.emAndamento.total ? "alert" : "default"}
            />
            <Stat label="Em disputa / encerradas" value={data.encerradas.total} />
          </div>

          <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-zinc-700">Em andamento</h3>
          {data.emAndamento.itens.length === 0 ? (
            <Empty>Nenhuma reclamação aberta nesta conta.</Empty>
          ) : (
            <Table head={cabecalho}>{linhas(data.emAndamento.itens)}</Table>
          )}

          <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-zinc-700">Em disputa / encerradas</h3>
          {data.encerradas.itens.length === 0 ? (
            <Empty>Nenhuma.</Empty>
          ) : (
            <Table head={cabecalho}>{linhas(data.encerradas.itens)}</Table>
          )}

          <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{data.aviso}</span>
          </p>
        </>
      )}
    </Panel>
  );
}

/** Detalhe de uma reclamação, com as ações que o ML permite nela. */
function ReclamacaoDetalhe({
  accountId,
  claimId,
  onVoltar,
}: {
  accountId: string;
  claimId: string;
  onVoltar: () => void;
}) {
  const { data, loading, error, reload } = useAsync(
    ["ml-reclamacao", accountId, claimId],
    () => adminReclamacaoDetalhe({ data: { accountId, claimId } }),
    true,
  );
  const [texto, setTexto] = useState("");
  const [executando, setExecutando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; msg: string } | null>(null);

  const executar = async (acao: string) => {
    const dados = confirmarAcao(acao, claimId, texto);
    if (!dados) return;
    setExecutando(acao);
    setAviso(null);
    try {
      await adminReclamacaoAcao({ data: { accountId, claimId, acao, ...dados } });
      setAviso({ ok: true, msg: `“${rotuloAcao(acao)}” enviada ao Mercado Livre.` });
      setTexto("");
      reload();
    } catch (e) {
      setAviso({ ok: false, msg: errorMessage(e) });
    } finally {
      setExecutando(null);
    }
  };

  return (
    <>
      <button
        onClick={onVoltar}
        className="flex items-center gap-1 rounded-lg bg-white/90 px-3 py-1.5 text-xs font-bold text-zinc-700 backdrop-blur hover:bg-white"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Voltar às reclamações
      </button>

      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading || !data ? (
        <Loading />
      ) : !data.ok || !data.reclamacao ? (
        <ErrorBox message={data.erro ?? "Não foi possível carregar a reclamação."} onRetry={reload} />
      ) : (
        <>
          <Panel title={`Reclamação ${data.reclamacao.id}`}>
            <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
              <Field label="Pedido" value={<span className="font-mono text-xs">{data.reclamacao.pedido}</span>} />
              <Field label="Tipo" value={data.reclamacao.tipo ?? "—"} />
              <Field label="Estágio" value={data.reclamacao.estagio ?? "—"} />
              <Field label="Status" value={data.reclamacao.status ?? "—"} />
              <Field label="Motivo" value={data.reclamacao.motivo ?? "—"} />
              <Field label="Aberta em" value={fmtDateTime(data.reclamacao.abertaEm)} />
              <Field label="Atualizada" value={fmtDateTime(data.reclamacao.atualizadaEm)} />
              <Field
                label="Resolução"
                value={data.reclamacao.resolucao ? JSON.stringify(data.reclamacao.resolucao) : "em aberto"}
              />
            </dl>
          </Panel>

          <Panel title={`Mensagens da reclamação (${data.mensagens.length})`}>
            {data.mensagens.length === 0 ? (
              <Empty>Nenhuma mensagem.</Empty>
            ) : (
              <ul className="space-y-2">
                {data.mensagens.map((m: any, i: number) => (
                  <li key={m.id ?? i} className="rounded-lg border border-zinc-200 p-3 text-sm">
                    <p className="whitespace-pre-wrap">{m.message ?? m.text ?? JSON.stringify(m)}</p>
                    <p className="mt-1 text-[10px] text-zinc-700">
                      {m.sender_role ?? m.from?.role ?? "—"} · {fmtDateTime(m.date_created ?? m.date)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Ações permitidas pelo Mercado Livre">
            {aviso && (
              <p className={`mb-3 text-xs font-semibold ${aviso.ok ? "text-emerald-700" : "text-red-600"}`}>
                {aviso.msg}
              </p>
            )}

            {data.acoesDisponiveis.length === 0 ? (
              <div className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600">
                <p className="font-bold text-zinc-800">
                  O Mercado Livre não listou ações para esta reclamação agora.
                </p>
                <p className="mt-1 text-xs">{data.avisoAcoes}</p>
                <p className="mt-2 text-xs">
                  Isso depende do estágio da reclamação e de você ser comprador ou vendedor. Abaixo está a resposta
                  crua do Mercado Livre — se houver ação disponível num formato que a tela não reconheceu, ela aparece
                  aqui e dá para executar pelo API Console.
                </p>
              </div>
            ) : (
              <>
                <p className="text-xs text-zinc-700">
                  Estas são as ações que o próprio Mercado Livre liberou para esta conta
                  {data.meuPapel ? ` (${data.meuPapel === "respondent" ? "vendedor" : data.meuPapel === "complainant" ? "comprador" : data.meuPapel})` : ""}{" "}
                  nesta reclamação. Para encerrar: reembolso total, reembolso parcial aceito pelo comprador, ou devolução
                  concluída. Se não estiver na lista, o sistema recusa antes de chamar a API.
                </p>

                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={3}
                  className="mt-3 w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm text-zinc-900 outline-none focus:border-[#1F5FD4]"
                  placeholder="Mensagem (usada nas ações que pedem texto)"
                />

                <div className="mt-3 flex flex-wrap gap-2">
                  {data.acoesDisponiveis.map((acao: string) => (
                    <button
                      key={acao}
                      title={acao}
                      onClick={() => executar(acao)}
                      disabled={executando !== null}
                      className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${
                        /refund/i.test(acao)
                          ? "bg-amber-600 hover:bg-amber-700"
                          : /return/i.test(acao)
                            ? "bg-emerald-600 hover:bg-emerald-700"
                            : "bg-[#1F5FD4] hover:bg-[#1A4FB0]"
                      }`}
                    >
                      {executando === acao ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                      {rotuloAcao(acao)}
                    </button>
                  ))}
                </div>
              </>
            )}
          </Panel>

          <Panel title="Resoluções esperadas (caminho para encerrar)">
            <p className="text-xs text-zinc-700">
              É por aqui que o Mercado Livre normalmente encerra uma reclamação — devolução, reembolso ou acordo.
              O conteúdo abaixo vem direto da API, sem interpretação nossa.
            </p>
            <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-zinc-950 p-4 text-[11px] leading-relaxed text-emerald-300">
              {JSON.stringify(data.resolucoes.dados ?? { status: data.resolucoes.status, erro: data.resolucoes.erro }, null, 2)}
            </pre>
          </Panel>

          <Panel title="Resposta crua do Mercado Livre (diagnóstico)">
            <pre className="max-h-72 overflow-auto rounded-lg bg-zinc-950 p-4 text-[11px] leading-relaxed text-emerald-300">
              {JSON.stringify(data.bruto, null, 2)}
            </pre>
          </Panel>
        </>
      )}
    </>
  );
}

/* ========================================================================== */
/* API Console                                                                */
/* ========================================================================== */

function ConsoleTab({ accountId }: { accountId: string | null }) {
  const catalog = useAsync(["api-catalogo"], () => adminApiCatalog());
  const contas = useAsync(["contas"], () => adminAccounts());
  const [method, setMethod] = useState<"GET" | "POST" | "PUT">("GET");
  const [endpoint, setEndpoint] = useState("/users/me");
  const [body, setBody] = useState("{}");

  const conta = (contas.data ?? []).find((a: any) => a.id === accountId) as any;
  const mlUserId = conta?.ml_user_id ?? "";

  /**
   * Atalhos para as operações do dia a dia, já com o ml_user_id da conta
   * selecionada. Cada um corresponde a um endpoint REAL da API do Mercado
   * Livre — nada aqui é simulado.
   */
  const atalhos: Array<{ label: string; method: "GET" | "POST" | "PUT"; endpoint: string; body?: string; nota?: string }> = [
    { label: "Consultar usuário", method: "GET", endpoint: "/users/me" },
    {
      label: "Listar minhas compras",
      method: "GET",
      endpoint: mlUserId ? `/orders/search?buyer=${mlUserId}&sort=date_desc&limit=20` : "/orders/search?buyer=",
      nota: "É a busca que o Unific+ usa para rastrear as compras do cliente.",
    },
    { label: "Consultar pedido", method: "GET", endpoint: "/orders/COLE_O_ID_DO_PEDIDO" },
    { label: "Consultar envio", method: "GET", endpoint: "/shipments/COLE_O_ID_DO_ENVIO" },
    {
      label: "Consultar rastreamento",
      method: "GET",
      endpoint: "/shipments/COLE_O_ID_DO_ENVIO/history",
      nota: "Histórico de eventos do envio — é daqui que sai o rastreio.",
    },
    {
      label: "Marcar pedido como recebido",
      method: "POST",
      endpoint: "/orders/COLE_O_ID_DO_PEDIDO/feedback",
      body: JSON.stringify({ fulfilled: true, rating: "positive" }, null, 2),
      nota: "Feedback de compra. É ÚNICO e irreversível no Mercado Livre.",
    },
  ];

  const aplicar = (a: (typeof atalhos)[number]) => {
    setMethod(a.method);
    setEndpoint(a.endpoint);
    setBody(a.body ?? "{}");
  };
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const executar = async () => {
    setRunning(true);
    setResult(null);
    setFailure(null);
    try {
      const r = await adminApiConsole({ data: { accountId: accountId ?? "", method, endpoint, body } });
      setResult(r);
    } catch (e) {
      setFailure(errorMessage(e));
    } finally {
      setRunning(false);
    }
  };

  const pretty = useMemo(() => (result ? JSON.stringify(result.data, null, 2) : ""), [result]);

  return (
    <>
      <Panel title="API Console — Mercado Livre">
        <div className="rounded-lg bg-amber-50 p-3 text-[11px] text-amber-900">
          O navegador envia apenas conta + método + endpoint + corpo. O cabeçalho <code>Authorization</code> é montado
          no servidor com o token da conta escolhida e nunca chega até aqui. Só passam endpoints da allowlist em{" "}
          <code>https://{catalog.data?.host ?? "api.mercadolibre.com"}</code>.
        </div>

        {!accountId && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-900">
            Selecione uma conta no seletor <strong>“Conta em foco”</strong>, no topo da página, antes de executar.
          </p>
        )}

        <div className="mt-4">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-700">Ações rápidas</p>
          <div className="flex flex-wrap gap-2">
            {atalhos.map((a) => (
              <button
                key={a.label}
                onClick={() => aplicar(a)}
                title={a.nota ?? a.endpoint}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-bold text-zinc-700 hover:border-[#1F5FD4] hover:text-[#1F5FD4]"
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-zinc-700">
            Clique para preencher o formulário abaixo, troque o que estiver em MAIÚSCULAS pelo ID real e execute.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as any)}
            translate="no"
            className="notranslate rounded-lg border-2 border-[#FFE600] bg-white px-3 py-2 text-sm font-bold text-zinc-900"
          >
            {/*
              `value` explícito + `translate="no"`: sem isso o valor do option
              vem do TEXTO visível, e o tradutor automático do Chrome trocava
              "POST" por "PUBLICAR" — o servidor recebia esse método e recusava
              com "Método não permitido: PUBLICAR".
            */}
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
          </select>
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="/orders/search?buyer=123456"
            className="min-w-[280px] flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none placeholder:text-zinc-600 focus:border-[#1F5FD4]"
          />
          <button
            onClick={executar}
            disabled={running || !accountId}
            className="flex items-center gap-2 rounded-lg bg-[#1F5FD4] px-4 py-2 text-sm font-bold text-white hover:bg-[#1A4FB0] disabled:opacity-50"
          >
            {running ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Executar
          </button>
        </div>

        {method !== "GET" && (
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            spellCheck={false}
            className="mt-3 w-full rounded-lg border border-zinc-300 bg-white p-3 font-mono text-xs text-zinc-900 outline-none placeholder:text-zinc-600 focus:border-[#1F5FD4]"
            placeholder='{"fulfilled": true, "rating": "positive"}'
          />
        )}

        {failure && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{failure}</span>
          </div>
        )}

        {result && (
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <Badge className={result.ok ? "border-emerald-300 bg-emerald-100 text-emerald-800" : "border-red-300 bg-red-100 text-red-800"}>
                HTTP {result.status}
              </Badge>
              <span className="text-zinc-700">{fmtDuration(result.durationMs)}</span>
              <span className="font-mono text-zinc-700">
                {result.method} {result.endpoint}
              </span>
              <span className="text-zinc-700">
                conta {result.account.nickname ?? result.account.mlUserId}
              </span>
              <button
                onClick={() => navigator.clipboard.writeText(pretty)}
                className="ml-auto flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-1 font-bold text-zinc-700 hover:bg-zinc-200"
              >
                <Copy className="h-3 w-3" /> Copiar
              </button>
            </div>
            {result.error && <p className="mb-2 text-xs font-semibold text-red-600">{result.error}</p>}
            <pre className="max-h-[520px] overflow-auto rounded-lg bg-zinc-950 p-4 text-[11px] leading-relaxed text-emerald-300">
              {pretty || "(resposta vazia)"}
            </pre>
          </div>
        )}
      </Panel>

      <Panel title="Endpoints permitidos">
        {catalog.error ? (
          <ErrorBox message={catalog.error} onRetry={catalog.reload} />
        ) : catalog.loading ? (
          <Loading />
        ) : (
          <Table head={["Endpoint", "Métodos", "Descrição", ""]}>
            {(catalog.data?.endpoints ?? []).map((e: any) => (
              <tr key={e.pattern}>
                <td className="px-2 py-2 font-mono text-xs">{e.pattern}</td>
                <td className="px-2 py-2 text-xs font-bold">{e.methods.join(", ")}</td>
                <td className="px-2 py-2 text-xs text-zinc-600">{e.description}</td>
                <td className="px-2 py-2">
                  <button
                    onClick={() => {
                      setEndpoint(e.pattern.replace(/:id/g, ""));
                      setMethod(e.methods[0]);
                    }}
                    className="rounded-md bg-zinc-100 px-2 py-1 text-[11px] font-bold text-zinc-700 hover:bg-zinc-200"
                  >
                    Usar
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

/* ========================================================================== */
/* Configurações                                                              */
/* ========================================================================== */

/**
 * Abertura falada do painel.
 *
 * A voz vem do próprio navegador (`speechSynthesis`) — sem arquivo de áudio,
 * sem biblioteca e sem chamada externa. Nem todo aparelho traz voz em
 * português; quando não traz, o aviso aqui explica em vez de deixar o botão
 * mudo sem motivo aparente.
 */
function VozDoPainel() {
  const [ligada, setLigada] = useState(true);
  const [nome, setNome] = useState("");
  const [temVozPt, setTemVozPt] = useState<boolean | null>(null);

  useEffect(() => {
    setLigada(vozLigada());
    setNome(nomeDaSaudacao());

    const conferir = () => {
      const vozes = window.speechSynthesis?.getVoices?.() ?? [];
      if (vozes.length) setTemVozPt(vozes.some((v) => /^pt/i.test(v.lang)));
    };
    conferir();
    // A lista de vozes chega depois no Chrome; sem isto, o aviso ficaria errado.
    window.speechSynthesis?.addEventListener?.("voiceschanged", conferir);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", conferir);
  }, []);

  return (
    <Panel title="Voz de abertura">
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          checked={ligada}
          onChange={(e) => {
            setLigada(e.target.checked);
            definirVoz(e.target.checked);
          }}
          className="h-4 w-4 accent-[#1F5FD4]"
        />
        Falar ao entrar no painel
      </label>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-zinc-700">Me chame de</span>
        <input
          value={nome}
          onChange={(e) => {
            setNome(e.target.value);
            definirNomeDaSaudacao(e.target.value);
          }}
          maxLength={40}
          placeholder="Don"
          className="w-40 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm"
        />
        <button
          onClick={() => aberturaDoPainel(nome || undefined)}
          disabled={!ligada}
          className="rounded-lg bg-[#1F5FD4] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
        >
          Ouvir agora
        </button>
      </div>

      <p className="mt-2 text-xs text-zinc-700">
        Vai dizer:{" "}
        <b>“Olá {nome || "Don"}. Bem-vindo à central Olho de Deus. {horaFalada()}.”</b>
      </p>

      {temVozPt === false && (
        <p className="mt-2 text-xs font-bold text-amber-700">
          Este aparelho não tem voz em português instalada. A frase pode sair com sotaque ou não
          sair — depende do navegador.
        </p>
      )}

      <p className="mt-2 text-[11px] text-zinc-600">
        A saudação toca uma vez por entrada, não a cada troca de aba. A escolha vale neste
        navegador.
      </p>
    </Panel>
  );
}

/**
 * Ativar e desativar a verificação em duas etapas.
 *
 * A ativação tem duas partes de propósito: primeiro o segredo é gerado e
 * guardado como NÃO confirmado, e só passa a valer depois que um código certo
 * é digitado. Sem essa confirmação, um segredo gerado e nunca salvo no celular
 * trancaria o administrador para fora do próprio painel.
 */
function SegundoFatorPainel() {
  const [estado, setEstado] = useState<{ ativo: boolean } | null>(null);
  const [segredo, setSegredo] = useState<string | null>(null);
  const [endereco, setEndereco] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [desativando, setDesativando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const { meuSegundoFator } = await import("@/lib/dois-fatores.functions");
      setEstado(await meuSegundoFator());
    } catch {
      setEstado(null);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const preparar = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { ativarSegundoFator } = await import("@/lib/dois-fatores.functions");
      const r = await ativarSegundoFator();
      setSegredo(r.segredo);
      setEndereco(r.endereco);
    } catch (e) {
      setMsg({ ok: false, texto: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const confirmar = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { conferirSegundoFator } = await import("@/lib/dois-fatores.functions");
      // A ativação acontece em Configurações, dentro da Olho de Deus.
      await conferirSegundoFator({ data: { codigo, painel: "olho_de_deus" } });
      setSegredo(null);
      setEndereco(null);
      setCodigo("");
      setMsg({ ok: true, texto: "Verificação em duas etapas ativada." });
      void carregar();
    } catch (e) {
      setMsg({ ok: false, texto: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const desativar = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { desativarSegundoFator } = await import("@/lib/dois-fatores.functions");
      await desativarSegundoFator({ data: { codigo } });
      setCodigo("");
      setDesativando(false);
      setMsg({ ok: true, texto: "Verificação em duas etapas desligada." });
      void carregar();
    } catch (e) {
      setMsg({ ok: false, texto: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Verificação em duas etapas">
      {msg && (
        <p className={`mb-3 text-xs font-bold ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>
          {msg.texto}
        </p>
      )}

      {estado?.ativo ? (
        <>
          <p className="text-sm text-zinc-700">
            <span className="font-bold text-emerald-700">Ativa.</span> Além da senha, entrar no
            painel pede o código de 6 dígitos do seu aplicativo.
          </p>
          {desativando ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
                inputMode="numeric"
                placeholder="000000"
                className="w-32 rounded-lg border border-zinc-300 px-3 py-2 text-center font-mono text-sm"
              />
              <button
                onClick={() => void desativar()}
                disabled={busy || codigo.length !== 6}
                className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
              >
                Confirmar e desligar
              </button>
              <button
                onClick={() => { setDesativando(false); setCodigo(""); }}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-bold"
              >
                Cancelar
              </button>
              {/* Desligar também exige o código: com só a senha, a proteção
                  poderia ser removida por quem ela deveria barrar. */}
              <span className="text-[11px] text-zinc-600">
                Digite um código do aplicativo para confirmar.
              </span>
            </div>
          ) : (
            <button
              onClick={() => setDesativando(true)}
              className="mt-3 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-bold"
            >
              Desligar
            </button>
          )}
        </>
      ) : segredo ? (
        <>
          <p className="text-sm text-zinc-700">
            No seu aplicativo autenticador — Google Authenticator, Authy, 1Password —, escolha
            adicionar conta <b>manualmente</b> e informe esta chave:
          </p>
          <p className="mt-2 select-all break-all rounded-lg border-2 border-[#FFE600] bg-[#FFFBE0] px-3 py-2 font-mono text-sm font-bold">
            {segredo}
          </p>
          <p className="mt-2 text-[11px] text-zinc-600">
            Guarde esta chave num lugar seguro. Perdendo o celular sem ela, você fica sem acesso
            ao painel.
          </p>
          {endereco && (
            <p className="mt-2 select-all break-all text-[10px] text-zinc-500">{endereco}</p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              value={codigo}
              onChange={(e) => setCodigo(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              placeholder="000000"
              className="w-32 rounded-lg border border-zinc-300 px-3 py-2 text-center font-mono text-sm"
            />
            <button
              onClick={() => void confirmar()}
              disabled={busy || codigo.length !== 6}
              className="rounded-lg bg-[#1F5FD4] px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
            >
              Confirmar e ativar
            </button>
            <span className="text-[11px] text-zinc-600">
              Digite o número que o aplicativo mostrar agora.
            </span>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-700">
            Hoje o painel abre só com e-mail e senha. Quem descobrir a senha vê contas, tokens,
            pedidos e dados de cliente.
          </p>
          <button
            onClick={() => void preparar()}
            disabled={busy}
            className="mt-3 rounded-lg bg-[#1F5FD4] px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
          >
            {busy ? "Preparando..." : "Ativar verificação em duas etapas"}
          </button>
        </>
      )}
    </Panel>
  );
}

function ConfiguracoesTab({ isAdmin }: { isAdmin: boolean }) {
  // adminConfig expõe o estado da integração e a lista de administradores:
  // é função de administrador. O cliente comum vê apenas o diagnóstico.
  const { data, loading, error, reload } = useAsync(["config"], () => adminConfig(), isAdmin);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const adicionar = async () => {
    setBusy(true);
    setFeedback(null);
    try {
      await adminAddAdmin({ data: { email } });
      setEmail("");
      setFeedback({ ok: true, text: "Administrador adicionado." });
      reload();
    } catch (e) {
      setFeedback({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const remover = async (userId: string) => {
    if (!confirm("Remover este administrador?")) return;
    setBusy(true);
    setFeedback(null);
    try {
      await adminRemoveAdmin({ data: { userId } });
      setFeedback({ ok: true, text: "Administrador removido." });
      reload();
    } catch (e) {
      setFeedback({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  if (!isAdmin) {
    return (
      <>
        <DiagnosticoOAuth />
        <Panel title="Configurações do sistema">
          <p className="text-sm text-zinc-600">
            As configurações da integração e a gestão de administradores são exclusivas do administrador do Únific+.
            Seu painel mostra apenas as suas contas e os seus dados.
          </p>
        </Panel>
      </>
    );
  }

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Empty />;

  const c = data as any;

  return (
    <>
      <VozDoPainel />

      <SegundoFatorPainel />

      <AplicativoMlPainel />

      <DiagnosticoOAuth />

      <Panel title="Integração Mercado Livre">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <Field label="APP_URL" value={<span className="font-mono text-xs">{c.appUrl || "(origem da requisição)"}</span>} />
          <Field label="Redirect URI" value={<span className="font-mono text-xs">{c.redirectUri || c.redirectError || "—"}</span>} />
          <Field label="Webhook URL" value={<span className="font-mono text-xs">{c.webhookUrl}</span>} />
          <Field label="Cron URL" value={<span className="font-mono text-xs">{c.cronUrl}</span>} />
          <Field label="ML_CLIENT_ID" value={<Flag on={c.hasClientId} />} />
          <Field label="ML_CLIENT_SECRET" value={<Flag on={c.hasClientSecret} />} />
          <Field label="SUPABASE_SERVICE_ROLE_KEY" value={<Flag on={c.hasServiceRoleKey} />} />
          <Field label="PKCE" value={<Flag on={c.pkce} labelOn="ligado" labelOff="desligado" />} />
          <Field label="Cron habilitado" value={<Flag on={c.cronEnabled} labelOn="sim" labelOff="não" />} />
          <Field label="Intervalo mínimo do cron" value={`${c.cronMinMinutes} min`} />
        </dl>
        <p className="mt-4 rounded-lg bg-zinc-50 p-3 text-[11px] text-zinc-700">
          Os valores dos segredos nunca são exibidos — apenas se estão configurados. Para trocar o domínio de produção,
          altere <code>APP_URL</code>/<code>ML_REDIRECT_URI</code> e cadastre a mesma Redirect URI no aplicativo do
          Mercado Livre.
        </p>
      </Panel>

      <Panel title={`Administradores (${c.admins})`}>
        {feedback && (
          <p className={`mb-3 text-xs font-semibold ${feedback.ok ? "text-emerald-700" : "text-red-600"}`}>{feedback.text}</p>
        )}
        <div className="mb-4 flex flex-wrap gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@dominio.com (usuário já existente no Supabase Auth)"
            className="min-w-[280px] flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-600 focus:border-[#1F5FD4]"
          />
          <button
            onClick={adicionar}
            disabled={busy || !email.trim()}
            className="rounded-lg bg-[#1F5FD4] px-4 py-2 text-sm font-bold text-white hover:bg-[#1A4FB0] disabled:opacity-50"
          >
            Adicionar
          </button>
        </div>

        {c.adminList.length === 0 ? (
          <Empty />
        ) : (
          <Table head={["E-mail", "Papel", "Desde", ""]}>
            {c.adminList.map((a: any) => (
              <tr key={a.user_id}>
                <td className="px-2 py-2 text-sm">{a.email}</td>
                <td className="px-2 py-2 text-xs">{a.role}</td>
                <td className="px-2 py-2 text-xs">{fmtDateTime(a.created_at)}</td>
                <td className="px-2 py-2">
                  {a.email === c.me.email ? (
                    <span className="text-[11px] text-zinc-700">você</span>
                  ) : (
                    <button
                      onClick={() => remover(a.user_id)}
                      disabled={busy}
                      className="rounded-md bg-zinc-200 px-2 py-1 text-[11px] font-bold text-zinc-700 hover:bg-zinc-300 disabled:opacity-50"
                    >
                      Remover
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}

/**
 * Aplicativo do Mercado Livre usado pelo Únific+.
 *
 * Para trocar de app: cola o Client ID e o Secret do app novo, o servidor
 * testa no próprio ML e, se aceitar, deixa como o ativo. As contas já
 * conectadas seguem renovando pelo app que as autorizou — ninguém cai.
 */
function AplicativoMlPainel() {
  const { data, loading, error, reload } = useAsync(["apps-ml"], () => adminAppsMl());
  const [form, setForm] = useState({ clientId: "", clientSecret: "", nome: "" });
  const [verSecret, setVerSecret] = useState(false);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; msg: string } | null>(null);
  const [copiado, setCopiado] = useState<string | null>(null);

  const copiar = async (rotulo: string, valor: string) => {
    try {
      await navigator.clipboard.writeText(valor);
      setCopiado(rotulo);
      window.setTimeout(() => setCopiado(null), 1500);
    } catch {
      /* sem permissão de área de transferência: o texto continua na tela */
    }
  };

  const executar = async (chave: string, acao: () => Promise<string>) => {
    setOcupado(chave);
    setAviso(null);
    try {
      setAviso({ ok: true, msg: await acao() });
      reload();
    } catch (e) {
      setAviso({ ok: false, msg: errorMessage(e) });
    } finally {
      setOcupado(null);
    }
  };

  const salvar = () => {
    if (
      !confirm(
        "Testar este app no Mercado Livre e deixar como o ativo?\n\nAs contas já conectadas continuam funcionando pelo app delas. Só as conexões novas usam este.",
      )
    )
      return;
    void executar("salvar", async () => {
      const r = await adminSalvarAppMl({ data: form });
      setForm({ clientId: "", clientSecret: "", nome: "" });
      return `${r.mensagem} App ativado: as próximas conexões já usam ele.`;
    });
  };

  const ativar = (clientId: string) => {
    if (!confirm(`Deixar o app ${clientId} como o ativo?\n\nAs conexões novas passam a usar ele.`)) return;
    void executar(`ativar:${clientId}`, async () => {
      await adminAtivarAppMl({ data: { clientId } });
      return `App ${clientId} ativado.`;
    });
  };

  const remover = (clientId: string) => {
    if (!confirm(`Remover o app ${clientId} da Central?`)) return;
    void executar(`remover:${clientId}`, async () => {
      await adminRemoverAppMl({ data: { clientId } });
      return `App ${clientId} removido.`;
    });
  };

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return null;

  // Uma lista só: o app do .env (se não estiver cadastrado) e os da Central.
  const linhas = [
    ...(data.env && !data.env.cadastradoNaCentral
      ? [{ clientId: data.env.clientId, nome: "App do servidor (.env)", origem: "env" as const, contas: data.env.contas }]
      : []),
    ...data.apps.map((a) => ({ clientId: a.clientId, nome: a.nome, origem: "painel" as const, contas: a.contas })),
  ];

  const enderecos = [
    { rotulo: "Redirect URI", valor: data.redirectUri },
    { rotulo: "URL de notificações", valor: data.webhookUrl },
  ];

  return (
    <Panel title="Aplicativo do Mercado Livre">
      {aviso && (
        <p
          className={`mb-4 rounded-lg px-3 py-2 text-sm font-semibold ${
            aviso.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
          }`}
        >
          {aviso.msg}
        </p>
      )}

      {/* App ativo em destaque */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border-2 border-[#FFE600] bg-[#FFFBE0] p-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-[#1F5FD4] text-[#FFE600]">
          <Key className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-500">App ativo</p>
          <p className="truncate font-mono text-lg font-black text-[#1F5FD4]">{data.ativo?.clientId ?? "nenhum"}</p>
          <p className="text-xs font-semibold text-zinc-600">
            {data.ativo
              ? data.ativo.origem === "painel"
                ? "Cadastrado aqui na Central. As conexões novas usam este app."
                : "Vem do .env do servidor. As conexões novas usam este app."
              : "Nenhum app configurado: ninguém consegue conectar o Mercado Livre."}
          </p>
        </div>
      </div>

      {data.semTabela && (
        <p className="mt-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Para cadastrar e trocar o app por aqui, rode uma vez no Supabase o arquivo{" "}
            <code className="font-bold">supabase/migrations/20261022120000_apps_do_mercado_livre.sql</code>. Até lá, o
            app do <code>.env</code> continua valendo normalmente.
          </span>
        </p>
      )}

      {/* Apps conhecidos */}
      {linhas.length > 0 && (
        <div className="mt-4">
          <Table head={["App", "Origem", "Contas", ""]}>
            {linhas.map((l) => {
              const ehAtivo = data.ativo?.clientId === l.clientId;
              return (
                <tr key={l.clientId}>
                  <td className="px-2 py-2">
                    <p className="font-mono text-sm font-bold text-[#1F5FD4]">{l.clientId}</p>
                    {l.nome && <p className="text-[11px] text-zinc-500">{l.nome}</p>}
                  </td>
                  <td className="px-2 py-2 text-xs font-semibold text-zinc-700">
                    {l.origem === "env" ? ".env do servidor" : "Central"}
                  </td>
                  <td className="px-2 py-2 text-sm font-bold tabular-nums text-zinc-800">{l.contas}</td>
                  <td className="px-2 py-2 text-right">
                    {ehAtivo ? (
                      <Badge className="border-[#1F5FD4] bg-[#1F5FD4] text-white">ATIVO</Badge>
                    ) : (
                      <span className="inline-flex gap-1.5">
                        <button
                          onClick={() => ativar(l.clientId)}
                          disabled={ocupado !== null || data.semTabela}
                          className="rounded-md bg-[#FFE600] px-2.5 py-1 text-[11px] font-black uppercase text-[#1F5FD4] hover:brightness-95 disabled:opacity-50"
                        >
                          Ativar
                        </button>
                        {l.origem === "painel" && (
                          <button
                            onClick={() => remover(l.clientId)}
                            disabled={ocupado !== null}
                            className="rounded-md bg-zinc-200 px-2.5 py-1 text-[11px] font-bold text-zinc-700 hover:bg-zinc-300 disabled:opacity-50"
                          >
                            Remover
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </Table>
          <p className="mt-2 text-[11px] text-zinc-600">
            “Contas” = quantas contas foram autorizadas por aquele app e renovam o login por ele.
          </p>
        </div>
      )}

      {/* Trocar de app, em três passos */}
      <div className="mt-6 space-y-4">
        <h3 className="text-xs font-black uppercase tracking-wide text-[#1F5FD4]">Trocar de app</h3>

        <div className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1F5FD4] text-xs font-black text-[#FFE600]">
            1
          </span>
          <div className="min-w-0 flex-1 text-sm text-zinc-700">
            <p>
              No{" "}
              <a
                href="https://developers.mercadolivre.com.br/devcenter"
                target="_blank"
                rel="noreferrer"
                className="font-bold text-[#1F5FD4] underline"
              >
                DevCenter do Mercado Livre
              </a>
              , crie o app novo com <strong>todas as permissões em leitura e escrita</strong> e cole estes endereços:
            </p>
            <div className="mt-2 space-y-2">
              {enderecos.map((e) => (
                <div key={e.rotulo} className="flex min-w-0 items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2">
                  <span className="w-36 shrink-0 text-[11px] font-black uppercase text-zinc-500">{e.rotulo}</span>
                  <code className="min-w-0 flex-1 truncate font-mono text-xs text-zinc-800">{e.valor || "—"}</code>
                  <button
                    onClick={() => void copiar(e.rotulo, e.valor)}
                    disabled={!e.valor}
                    className="flex shrink-0 items-center gap-1 rounded-md bg-[#1F5FD4] px-2 py-1 text-[11px] font-bold text-white hover:bg-[#1A4FB0] disabled:opacity-50"
                  >
                    {copiado === e.rotulo ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiado === e.rotulo ? "Copiado" : "Copiar"}
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-zinc-600">
              Nas notificações, marque os mesmos tópicos do app atual. Abra pelo domínio de produção para que a Redirect
              URI acima saia com ele.
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1F5FD4] text-xs font-black text-[#FFE600]">
            2
          </span>
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
            <input
              value={form.clientId}
              onChange={(e) => setForm({ ...form, clientId: e.target.value.replace(/\D/g, "") })}
              inputMode="numeric"
              placeholder="Client ID (só números)"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none focus:border-[#1F5FD4] focus:ring-2 focus:ring-[#FFE600]"
            />
            <div className="relative">
              <input
                value={form.clientSecret}
                onChange={(e) => setForm({ ...form, clientSecret: e.target.value })}
                type={verSecret ? "text" : "password"}
                autoComplete="off"
                placeholder="Client Secret"
                className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-3 pr-10 font-mono text-sm text-zinc-900 outline-none focus:border-[#1F5FD4] focus:ring-2 focus:ring-[#FFE600]"
              />
              <button
                onClick={() => setVerSecret((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:text-zinc-800"
                aria-label={verSecret ? "Esconder secret" : "Mostrar secret"}
                type="button"
              >
                {verSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <input
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Nome para lembrar (opcional)"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#1F5FD4] focus:ring-2 focus:ring-[#FFE600] sm:col-span-2"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#1F5FD4] text-xs font-black text-[#FFE600]">
            3
          </span>
          <div className="min-w-0 flex-1">
            <button
              onClick={salvar}
              disabled={ocupado !== null || data.semTabela || !form.clientId || !form.clientSecret}
              className="flex items-center gap-2 rounded-lg bg-[#FFE600] px-4 py-2.5 text-sm font-black uppercase tracking-wide text-[#1F5FD4] shadow-sm hover:brightness-95 disabled:opacity-50"
            >
              {ocupado === "salvar" ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Testar no ML e ativar
            </button>
            <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
              O painel confere o Client ID e o Secret no próprio Mercado Livre antes de salvar. O Secret fica guardado
              cifrado e nunca volta para a tela. As contas já conectadas continuam funcionando pelo app delas; para
              passar uma conta para o app novo, o cliente conecta o Mercado Livre de novo pelo Únific+.
            </p>
          </div>
        </div>
      </div>
    </Panel>
  );
}

/**
 * Diagnóstico do OAuth.
 * Existe porque o retorno do Mercado Livre acontece FORA da aplicação: quando
 * a Redirect URI pública não responde, nenhuma conta chega e não há erro em
 * lugar nenhum. Aqui o servidor bate na própria Redirect URI e mostra o que
 * de fato responde.
 */
function DiagnosticoOAuth() {
  const { data, loading, error, reload } = useAsync(["diagnostico"], () => adminDiagnostico());
  const [busy, setBusy] = useState(false);

  const limpar = async () => {
    setBusy(true);
    try {
      await adminLimparStates();
      reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Diagnóstico do OAuth"
      right={
        <button onClick={reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      }
    >
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading || !data ? (
        <Loading />
      ) : (
        <>
          <div
            className={`flex items-start gap-3 rounded-lg border p-4 ${
              data.alcance.ok ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
            }`}
          >
            {data.alcance.ok ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            )}
            <div className="min-w-0 flex-1">
              <p className={`text-sm font-bold ${data.alcance.ok ? "text-emerald-900" : "text-amber-900"}`}>
                {data.alcance.titulo}
              </p>
              <p className="mt-1 text-xs text-zinc-700">{data.alcance.detalhe}</p>
              {data.alcance.comoResolver && (
                <p className="mt-2 rounded bg-white/70 p-2 text-xs font-medium text-zinc-800">
                  <strong>Como resolver:</strong> {data.alcance.comoResolver}
                </p>
              )}
              <p className="mt-2 break-all font-mono text-[11px] text-zinc-700">
                {data.redirectUri || "(Redirect URI não configurada)"}
              </p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Contas conectadas" value={data.contas} tone={data.contas ? "ok" : "default"} />
            <Stat label="Conexões iniciadas" value={data.resumo.iniciados} />
            <Stat label="Conexões concluídas" value={data.resumo.concluidos} tone={data.resumo.concluidos ? "ok" : "default"} />
            <Stat
              label="States aguardando"
              value={data.statesPendentes}
              tone={data.statesPendentes > 2 ? "alert" : "default"}
            />
            <Stat label="States expirados" value={data.statesExpirados} />
          </div>

          {data.resumo.iniciados > 0 && data.resumo.concluidos === 0 && (
            <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
              Houve <strong>{data.resumo.iniciados}</strong> tentativa(s) de conexão e nenhuma concluída. O cliente foi
              enviado ao Mercado Livre, mas o retorno nunca chegou aqui — o problema está na Redirect URI pública, não
              na autorização.
            </p>
          )}

          {data.statesExpirados > 0 && (
            <button
              onClick={limpar}
              disabled={busy}
              className="mt-3 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-700 hover:bg-zinc-200 disabled:opacity-50"
            >
              {busy ? "Limpando…" : `Limpar ${data.statesExpirados} state(s) expirado(s)`}
            </button>
          )}

          <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-zinc-700">Últimos eventos de OAuth</h3>
          {data.eventos.length === 0 ? (
            <Empty>Nenhuma tentativa de conexão registrada.</Empty>
          ) : (
            <Table head={["Quando", "Evento", "Resultado", "Detalhe"]}>
              {data.eventos.map((e: any) => (
                <tr key={e.id}>
                  <td className="px-2 py-2 whitespace-nowrap text-xs">{fmtDateTime(e.created_at)}</td>
                  <td className="px-2 py-2 text-xs font-semibold">{e.action}</td>
                  <td className="px-2 py-2">
                    {e.success ? (
                      <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800">ok</Badge>
                    ) : (
                      <Badge className="border-red-300 bg-red-100 text-red-800">falha</Badge>
                    )}
                  </td>
                  <td className="px-2 py-2 max-w-[420px] truncate text-xs text-zinc-600">
                    {e.error || e.message || (e.detail ? JSON.stringify(e.detail) : "—")}
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </Panel>
  );
}

function Flag({ on, labelOn = "configurado", labelOff = "faltando" }: { on: boolean; labelOn?: string; labelOff?: string }) {
  return on ? (
    <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800">{labelOn}</Badge>
  ) : (
    <Badge className="border-red-300 bg-red-100 text-red-800">{labelOff}</Badge>
  );
}

/* ========================================================================== */
/* Auditoria                                                                  */
/* ========================================================================== */

function AuditoriaTab() {
  const [offset, setOffset] = useState(0);
  const limit = 100;
  const { data, loading, error, reload } = useAsync(["auditoria", offset], () => adminAudit({ data: { limit, offset } }));

  return (
    <Panel
      title="Auditoria de ações administrativas"
      right={
        <button onClick={reload} className="rounded-lg bg-zinc-100 p-1.5 text-zinc-600 hover:bg-zinc-200">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      }
    >
      {error ? (
        <ErrorBox message={error} onRetry={reload} />
      ) : loading ? (
        <Loading />
      ) : !data || data.rows.length === 0 ? (
        <Empty />
      ) : (
        <>
          <Table head={["Data/hora", "Quem", "Ação", "Entidade", "Registro", "Conta", "IP", "Resultado", "Detalhe"]}>
            {data.rows.map((r: any) => (
              <tr key={r.id}>
                <td className="px-2 py-2 whitespace-nowrap text-xs">{fmtDateTime(r.created_at)}</td>
                <td className="px-2 py-2 text-xs">{r.admin_email || "sistema"}</td>
                <td className="px-2 py-2 text-xs font-semibold">{r.action}</td>
                <td className="px-2 py-2 text-xs">{r.entity || "—"}</td>
                <td className="px-2 py-2 font-mono text-[11px]">{r.entity_id ? String(r.entity_id).slice(0, 12) + "…" : "—"}</td>
                <td className="px-2 py-2 font-mono text-[11px]">{r.account_id ? String(r.account_id).slice(0, 8) + "…" : "—"}</td>
                <td className="px-2 py-2 font-mono text-[11px]">{r.ip || "—"}</td>
                <td className="px-2 py-2">
                  {r.success ? (
                    <Badge className="border-emerald-300 bg-emerald-100 text-emerald-800">ok</Badge>
                  ) : (
                    <Badge className="border-red-300 bg-red-100 text-red-800">falha</Badge>
                  )}
                </td>
                <td className="px-2 py-2 max-w-[280px] truncate text-[11px] text-zinc-700">
                  {r.detail ? JSON.stringify(r.detail) : "—"}
                </td>
              </tr>
            ))}
          </Table>
          <Pager total={data.total} limit={limit} offset={offset} onChange={setOffset} />
        </>
      )}
    </Panel>
  );
}

/* ========================================================================== */
/* Paginação                                                                  */
/* ========================================================================== */

function Pager({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total <= limit) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-zinc-600">
      <span>
        {offset + 1}–{Math.min(offset + limit, total)} de {total}
      </span>
      <div className="flex gap-2">
        <button
          disabled={page <= 1}
          onClick={() => onChange(Math.max(0, offset - limit))}
          className="rounded-md bg-zinc-100 px-3 py-1 font-bold disabled:opacity-40"
        >
          Anterior
        </button>
        <span className="px-2 py-1 font-bold">
          {page}/{pages}
        </span>
        <button
          disabled={page >= pages}
          onClick={() => onChange(offset + limit)}
          className="rounded-md bg-zinc-100 px-3 py-1 font-bold disabled:opacity-40"
        >
          Próxima
        </button>
      </div>
    </div>
  );
}
