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
  CheckCircle2,
  ClipboardList,
  Copy,
  Database,
  FileClock,
  Globe,
  Key,
  LoaderCircle,
  LogOut,
  MessageCircle,
  Package,
  Play,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Tag,
  Terminal,
  Truck,
  UserCheck,
  Users,
  XCircle,
} from "lucide-react";
import { adminClientes, adminRevelarCpf } from "@/lib/perfil.functions";
import { formatarTelefone } from "@/lib/cpf";

import { supabase } from "@/integrations/supabase/client";
import {
  adminAccount,
  adminAccounts,
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
  adminSuspenderConexao,
  adminSyncAccount,
  adminSyncRuns,
  adminTracking,
  adminTrackingLive,
  adminWebhookEvents,
} from "@/lib/centralml.functions";

export const Route = createFileRoute("/centralml/")({
  component: CentralML,
  head: () => ({ meta: [{ title: "CentralML — Unific+" }] }),
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

function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white/95 shadow-sm backdrop-blur">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-700">{title}</h2>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Stat({ label, value, tone = "default" }: { label: string; value: React.ReactNode; tone?: "default" | "alert" | "ok" }) {
  const toneClass =
    tone === "alert" ? "text-red-700" : tone === "ok" ? "text-emerald-700" : "text-zinc-900";
  return (
    <div className="rounded-xl border border-zinc-200 bg-white/95 p-4 shadow-sm backdrop-blur">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</p>
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
  return <p className="py-8 text-center text-sm font-medium text-zinc-500">{children}</p>;
}

function Loading() {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-zinc-500">
      <LoaderCircle className="h-5 w-5 animate-spin" />
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

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead>
          <tr className="border-b border-zinc-200 text-[11px] uppercase tracking-wide text-zinc-500">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-2 py-2 font-semibold">
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

function LoginScreen({ onSignedIn, notice }: { onSignedIn: () => void; notice?: string | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (authError) {
      setError(authError.message);
      return;
    }
    onSignedIn();
  };

  return (
    <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white/95 p-6 shadow-xl backdrop-blur">
        <div className="mb-5 flex items-center gap-2">
          <ShieldCheck className="h-6 w-6 text-[#3483FA]" />
          <div>
            <h1 className="text-lg font-black text-zinc-900">CentralML</h1>
            <p className="text-xs text-zinc-500">Acesso restrito ao administrador.</p>
          </div>
        </div>

        {notice && <div className="mb-4 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">{notice}</div>}

        <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">E-mail</label>
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mb-3 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#3483FA]"
        />

        <label className="mb-1 block text-xs font-bold uppercase text-zinc-500">Senha</label>
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mb-4 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-[#3483FA]"
        />

        {error && <p className="mb-3 text-xs font-semibold text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#3483FA] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#2968C8] disabled:opacity-60"
        >
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}
          Entrar
        </button>

        <p className="mt-4 text-center text-[11px] text-zinc-500">
          A permissão é validada no servidor. Um login válido sem cadastro em admin_users continua bloqueado.
        </p>
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
  | "clientes"
  | "pedidos"
  | "rastreamentos"
  | "sincronizacoes"
  | "logs"
  | "erros"
  | "contaml"
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
  { id: "clientes", label: "Clientes", icon: UserCheck, grupo: "Visão geral" },

  { id: "contaml", label: "Conta ML", icon: Globe, grupo: "Mercado Livre" },
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

  const check = useCallback(async () => {
    setChecking(true);
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setSession(null);
        setNotice(null);
        return;
      }
      // O servidor é quem decide: sessão válida ≠ acesso administrativo.
      const me = await adminSession();
      setSession(me);
      setNotice(null);
    } catch (e) {
      setSession(null);
      setNotice(errorMessage(e));
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setNotice(null);
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircle className="h-10 w-10 animate-spin text-[#00ff41]" />
      </div>
    );
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

  return (
    <div className="min-h-screen text-zinc-900">
      <div className="relative z-10">
        <header className="sticky top-0 z-40 bg-[#FFE600]/95 px-4 py-3 shadow-md backdrop-blur">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <LogoML className="h-10 w-10 drop-shadow-sm" />
              <div className="leading-none">
                <span className="block text-xl font-black tracking-tight text-[#2d3277]">CENTRAL ML NOD</span>
                <span className="mt-0.5 block text-[10px] font-bold uppercase tracking-wider text-black/55">
                  Únific+ · painel do Mercado Livre
                </span>
              </div>
              <Badge className="ml-1 border-[#2d3277]/25 bg-[#2d3277]/10 text-[#2d3277]">
                {session.isAdmin ? "Administrador" : "Meu painel"}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <a href="/" className="flex items-center gap-1 text-xs font-bold text-black/70 hover:text-black">
                <ArrowLeft className="h-3.5 w-3.5" /> Voltar ao Unific+
              </a>
              <span className="text-xs font-semibold text-black/70">{session.email}</span>
              <button
                onClick={signOut}
                className="flex items-center gap-1 rounded-lg bg-black/10 px-3 py-1.5 text-xs font-bold text-black hover:bg-black/20"
              >
                <LogOut className="h-3.5 w-3.5" /> Sair
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-[1400px] px-4 py-5">
          <AccountSelector accountId={accountId} onChange={setAccountId} />

          {/* Navegação agrupada: em vez de 15 botões em fila, quatro blocos
              com rótulo. Fica claro onde cada função mora. */}
          <nav className="mt-4 space-y-2 rounded-xl bg-white/90 p-3 backdrop-blur">
            {GRUPOS.map((grupo) => (
              <div key={grupo} className="flex flex-wrap items-center gap-2">
                <span className="w-[110px] shrink-0 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  {grupo}
                </span>
                {TABS.filter((t) => t.grupo === grupo).map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition ${
                      tab === id
                        ? "border-[#3483FA] bg-[#3483FA] text-white shadow-sm"
                        : "border-zinc-200 bg-white text-zinc-700 hover:border-[#3483FA]/50 hover:text-[#3483FA]"
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="mt-4 space-y-4 pb-12">
            {tab === "dashboard" && <DashboardTab onOpenAccount={(id) => { setAccountId(id); setTab("contas"); }} />}
            {tab === "contas" && <ContasTab accountId={accountId} onSelect={setAccountId} />}
            {tab === "clientes" && <ClientesTab />}
            {tab === "pedidos" && <PedidosTab accountId={accountId} />}
            {tab === "rastreamentos" && <RastreamentosTab accountId={accountId} />}
            {tab === "sincronizacoes" && <SincronizacoesTab accountId={accountId} />}
            {tab === "logs" && <LogsTab accountId={accountId} />}
            {tab === "erros" && <ErrosTab />}
            {tab === "contaml" && <ContaMlTab accountId={accountId} />}
            {tab === "mensagens" && <MensagensTab accountId={accountId} />}
            {tab === "perguntas" && <PerguntasTab accountId={accountId} />}
            {tab === "reclamacoes" && <ReclamacoesPainel accountId={accountId} />}
            {tab === "anuncios" && <AnunciosTab accountId={accountId} />}
            {tab === "console" && <ConsoleTab accountId={accountId} />}
            {tab === "configuracoes" && <ConfiguracoesTab isAdmin={session.isAdmin} />}
            {tab === "auditoria" && <AuditoriaTab />}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Seletor de conta (isolamento por cliente)                                  */
/* ========================================================================== */

function AccountSelector({ accountId, onChange }: { accountId: string | null; onChange: (id: string | null) => void }) {
  const { data, loading, error, reload } = useAsync(["contas"], () => adminAccounts());
  const accounts = data ?? [];
  const current = accounts.find((a: any) => a.id === accountId) ?? null;

  return (
    <div className="rounded-xl border border-zinc-200 bg-white/95 p-4 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Users className="h-4 w-4 text-[#3483FA]" />
          <span className="text-sm font-bold text-zinc-700">Conta em foco:</span>
          {current ? (
            <>
              <span className="text-sm font-bold text-[#3483FA]">{current.nickname || current.ml_user_id}</span>
              <Badge className={accountStatus(current.status).className}>{accountStatus(current.status).label}</Badge>
              <Badge className={`border-transparent ${TOKEN_STATE[current.tokenStatus?.state ?? ""]?.className ?? "bg-zinc-100 text-zinc-700"}`}>
                {TOKEN_STATE[current.tokenStatus?.state ?? ""]?.label ?? "—"}
              </Badge>
            </>
          ) : (
            <span className="text-sm text-zinc-500">Todas as contas</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <select
            value={accountId ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800"
          >
            <option value="">Todas as contas</option>
            {accounts.map((a: any) => (
              <option key={a.id} value={a.id}>
                {a.nickname || a.ml_user_id} — {accountStatus(a.status).label}
              </option>
            ))}
          </select>
          <button onClick={reload} className="rounded-lg bg-zinc-100 p-2 text-zinc-600 hover:bg-zinc-200" title="Recarregar contas">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>
      {error && <p className="mt-3 text-xs font-semibold text-red-600">{error}</p>}
      {!loading && !error && accounts.length === 0 && (
        <p className="mt-3 text-xs text-zinc-500">
          Nenhuma conta autorizou o aplicativo ainda. Assim que um cliente concluir o OAuth no Unific+, ela aparece aqui.
        </p>
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
            <Table head={["Conta", "ML user", "Status", "Token", "Última sync"]}>
              {data.accounts.map((a: any) => (
                <tr key={a.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => onOpenAccount(a.id)}>
                  <td className="px-2 py-2 font-semibold text-[#3483FA]">{a.nickname || "—"}</td>
                  <td className="px-2 py-2 font-mono text-xs">{a.ml_user_id}</td>
                  <td className="px-2 py-2">
                    <Badge className={accountStatus(a.status).className}>{accountStatus(a.status).label}</Badge>
                  </td>
                  <td className="px-2 py-2 text-xs">{TOKEN_STATE[a.tokenStatus?.state ?? ""]?.label ?? "—"}</td>
                  <td className="px-2 py-2 text-xs">{fmtDateTime(a.last_sync_at)}</td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>

        <Panel title="Últimas sincronizações">
          {data.lastRuns.length === 0 ? (
            <Empty />
          ) : (
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
          )}
        </Panel>

        <Panel title="Rastreamentos recentes">
          {data.lastTracking.length === 0 ? (
            <Empty>Nenhuma consulta registrada até agora.</Empty>
          ) : (
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
          )}
        </Panel>

        <Panel title="Últimos eventos do sistema">
          {data.lastLogs.length === 0 ? (
            <Empty />
          ) : (
            <ul className="space-y-2">
              {data.lastLogs.map((l: any) => (
                <li key={l.id} className="flex items-start gap-2 text-xs">
                  <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${l.level === "error" ? "bg-red-500" : l.level === "warn" ? "bg-amber-500" : "bg-emerald-500"}`} />
                  <span className="w-36 shrink-0 text-zinc-500">{fmtDateTime(l.created_at)}</span>
                  <span className="w-28 shrink-0 font-semibold text-zinc-700">{l.category}</span>
                  <span className="flex-1 text-zinc-600">{l.error || l.message || l.action}</span>
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
                <button onClick={() => onSelect(a.id)} className="font-mono text-[11px] text-[#3483FA] underline">
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
                    className="rounded-md bg-[#3483FA] px-2 py-1 text-[11px] font-bold text-white hover:bg-[#2968C8] disabled:opacity-50"
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

        <p className="mt-4 rounded-lg bg-zinc-50 p-3 text-[11px] text-zinc-500">
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
        className="w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-[#3483FA]"
        placeholder="Escreva uma mensagem para o vendedor…"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          onClick={enviar}
          disabled={enviando || !texto.trim()}
          className="flex items-center gap-2 rounded-lg bg-[#3483FA] px-4 py-2 text-sm font-bold text-white hover:bg-[#2968C8] disabled:opacity-50"
        >
          {enviando ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Enviar mensagem
        </button>
        {aviso && (
          <span className={`text-xs font-semibold ${aviso.ok ? "text-emerald-700" : "text-red-600"}`}>{aviso.msg}</span>
        )}
      </div>
      <p className="mt-2 text-[11px] text-zinc-500">
        A mensagem sai pela conta do cliente, como se ele mesmo tivesse escrito. Fica registrada na auditoria.
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-zinc-800">{value}</dd>
    </div>
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
            <Search className="h-3.5 w-3.5 text-zinc-500" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setTerm(q)}
              placeholder="pedido, título, comprador, envio"
              className="w-56 bg-transparent py-1.5 text-xs text-zinc-900 outline-none placeholder:text-zinc-400"
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
          <button onClick={() => setTerm(q)} className="rounded-lg bg-[#3483FA] px-3 py-1.5 text-xs font-bold text-white">
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
                <td className="px-2 py-2 font-mono text-xs text-[#3483FA]">{o.ml_order_id}</td>
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
                    <span className="text-[11px] text-zinc-500">recebido</span>
                  ) : (
                    <span className="text-[11px] text-zinc-500">abrir</span>
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
              <p className="mt-0.5 text-xs text-zinc-500">
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
                className="mt-3 w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-[#3483FA]"
                placeholder="Comentário para o vendedor (opcional, até 160 caracteres)"
              />
              <p className="mt-1 text-right text-[10px] text-zinc-400">{comentario.length}/160</p>

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
            <p className="rounded-lg bg-zinc-50 p-3 text-xs text-zinc-500">
              {o.buyer_feedback_at
                ? "Feedback já registrado no Mercado Livre — a operação não pode ser repetida."
                : "Operação não disponível pela API oficial para o status atual deste pedido."}
            </p>
          )}
        </div>
      </Panel>

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
                  <p className="mt-1 text-[10px] text-zinc-500">
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

      {data.faturamento && (
        <Panel title="Dados de faturamento">
          <pre className="max-h-56 overflow-auto rounded-lg bg-zinc-950 p-3 text-[11px] text-emerald-300">
            {JSON.stringify(data.faturamento, null, 2)}
          </pre>
        </Panel>
      )}

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
            className={`rounded-lg px-3 py-1.5 text-xs font-bold backdrop-blur ${modo === id ? "bg-[#3483FA] text-white" : "bg-white/90 text-zinc-700"}`}
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
                  <td className="px-2 py-2 max-w-[220px] truncate text-[11px] text-zinc-500">{r.user_agent || "—"}</td>
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
            className="rounded-lg bg-[#3483FA] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#2968C8] disabled:opacity-60"
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
          <Table head={["Nome", "E-mail", "Telefone", "CPF", "PIN", "Contas ML", "Cadastro", "Último acesso"]}>
            {data.clientes.map((c: any) => (
              <tr key={c.userId} className="border-t border-zinc-100">
                <td className="px-2 py-2 text-xs font-semibold">{c.nome}</td>
                <td className="px-2 py-2 text-xs">{c.email || "—"}</td>
                <td className="px-2 py-2 text-xs">{formatarTelefone(c.telefone)}</td>
                <td className="px-2 py-2 font-mono text-xs">
                  {cpfsAbertos[c.userId] ? (
                    <span className="text-zinc-900">{cpfsAbertos[c.userId]}</span>
                  ) : (
                    <button
                      onClick={() => revelar(c.userId)}
                      className="text-zinc-500 underline decoration-dotted hover:text-zinc-900"
                      title="Revelar o CPF completo. A consulta fica registrada na auditoria."
                    >
                      {c.cpfMascarado}
                    </button>
                  )}
                </td>
                <td className="px-2 py-2 text-xs">{c.temPin ? "✓" : "—"}</td>
                <td className="px-2 py-2 text-xs">
                  {c.contasMl.length ? c.contasMl.join(", ") : <span className="text-zinc-400">nenhuma</span>}
                </td>
                <td className="px-2 py-2 text-xs">{fmtDateTime(c.criadoEm)}</td>
                <td className="px-2 py-2 text-xs">{c.ultimoAcessoEm ? fmtDateTime(c.ultimoAcessoEm) : "—"}</td>
              </tr>
            ))}
          </Table>
          <p className="mt-2 px-2 text-[11px] text-zinc-500">
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
              <Search className="h-3.5 w-3.5 text-zinc-500" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setTerm(q)}
                placeholder="ação, endpoint, mensagem"
                className="w-48 bg-transparent py-1.5 text-xs text-zinc-900 outline-none placeholder:text-zinc-400"
              />
            </div>
            <button onClick={() => setTerm(q)} className="rounded-lg bg-[#3483FA] px-3 py-1.5 text-xs font-bold text-white">
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
          <p className="mt-2 text-[11px] text-zinc-500">
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
        <p className="mt-2 text-xs text-zinc-500">
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
          className="mt-4 flex items-center gap-2 rounded-lg bg-[#3483FA] px-4 py-2 text-sm font-bold text-white hover:bg-[#2968C8] disabled:opacity-60"
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
                      className="rounded-md bg-[#3483FA] px-2 py-1 text-[11px] font-bold text-white disabled:opacity-50"
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
            <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-zinc-500">
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
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
              <span>
                <strong>{x.recurso}</strong> — <span className="text-zinc-600">{x.motivo}</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-zinc-500">
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
        <p className="mb-3 text-xs text-zinc-500">
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
                <td className="px-2 py-2 font-mono text-xs text-[#3483FA]">{o.ml_order_id}</td>
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
                <p className="mt-0.5 text-[11px] text-zinc-500">
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
                      className="w-full rounded-lg border border-zinc-300 bg-white p-2 text-xs text-zinc-900 outline-none focus:border-[#3483FA]"
                      placeholder="Escreva a resposta…"
                    />
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => responder(String(q.id))}
                        disabled={!texto.trim()}
                        className="rounded-md bg-[#3483FA] px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50"
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
                <p className="mt-0.5 text-[11px] text-zinc-500">
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
                  <p className="mt-0.5 text-xs text-zinc-500">
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
                      className="mt-1.5 inline-block text-xs font-bold text-[#3483FA] underline"
                    >
                      abrir no Mercado Livre
                    </a>
                  )}
                </div>

                <div className="grid shrink-0 grid-cols-3 gap-3 text-center">
                  <div>
                    <p className="text-[10px] font-bold uppercase text-zinc-500">Estoque</p>
                    <p className="text-lg font-black tabular-nums">{a.estoque ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-zinc-500">Vendidos</p>
                    <p className="text-lg font-black tabular-nums">{a.vendidos ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase text-zinc-500">Visitas 30d</p>
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
        <td className="px-2 py-2 font-mono text-xs text-[#3483FA] underline">{r.id}</td>
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

          <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-zinc-500">Em andamento</h3>
          {data.emAndamento.itens.length === 0 ? (
            <Empty>Nenhuma reclamação aberta nesta conta.</Empty>
          ) : (
            <Table head={cabecalho}>{linhas(data.emAndamento.itens)}</Table>
          )}

          <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-zinc-500">Em disputa / encerradas</h3>
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
    const precisaTexto = /message|mensagem|reply|responder/i.test(acao);
    if (
      !confirm(
        `Executar “${acao}” nesta reclamação?\n\nA ação vale no Mercado Livre e pode ser definitiva.`,
      )
    )
      return;
    setExecutando(acao);
    setAviso(null);
    try {
      await adminReclamacaoAcao({
        data: { accountId, claimId, acao, texto: precisaTexto ? texto : "" },
      });
      setAviso({ ok: true, msg: `Ação “${acao}” enviada ao Mercado Livre.` });
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
                    <p className="mt-1 text-[10px] text-zinc-500">
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
                <p className="text-xs text-zinc-500">
                  Estas são as ações que o próprio Mercado Livre informou para esta reclamação. Nada aqui é inventado:
                  se não estiver na lista, o sistema recusa antes de chamar a API.
                </p>

                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  rows={3}
                  className="mt-3 w-full rounded-lg border border-zinc-300 bg-white p-2 text-sm text-zinc-900 outline-none focus:border-[#3483FA]"
                  placeholder="Mensagem (usada nas ações que pedem texto)"
                />

                <div className="mt-3 flex flex-wrap gap-2">
                  {data.acoesDisponiveis.map((acao: string) => (
                    <button
                      key={acao}
                      onClick={() => executar(acao)}
                      disabled={executando !== null}
                      className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold text-white disabled:opacity-50 ${
                        /close|resolve|fechar/i.test(acao)
                          ? "bg-emerald-600 hover:bg-emerald-700"
                          : /refund|reembols/i.test(acao)
                            ? "bg-amber-600 hover:bg-amber-700"
                            : "bg-[#3483FA] hover:bg-[#2968C8]"
                      }`}
                    >
                      {executando === acao ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                      {acao}
                    </button>
                  ))}
                </div>
              </>
            )}
          </Panel>

          <Panel title="Resoluções esperadas (caminho para encerrar)">
            <p className="text-xs text-zinc-500">
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
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500">Ações rápidas</p>
          <div className="flex flex-wrap gap-2">
            {atalhos.map((a) => (
              <button
                key={a.label}
                onClick={() => aplicar(a)}
                title={a.nota ?? a.endpoint}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-bold text-zinc-700 hover:border-[#3483FA] hover:text-[#3483FA]"
              >
                {a.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            Clique para preencher o formulário abaixo, troque o que estiver em MAIÚSCULAS pelo ID real e execute.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as any)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-bold text-zinc-900"
          >
            <option>GET</option>
            <option>POST</option>
            <option>PUT</option>
          </select>
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="/orders/search?buyer=123456"
            className="min-w-[280px] flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-[#3483FA]"
          />
          <button
            onClick={executar}
            disabled={running || !accountId}
            className="flex items-center gap-2 rounded-lg bg-[#3483FA] px-4 py-2 text-sm font-bold text-white hover:bg-[#2968C8] disabled:opacity-50"
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
            className="mt-3 w-full rounded-lg border border-zinc-300 bg-white p-3 font-mono text-xs text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-[#3483FA]"
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
              <span className="text-zinc-500">{fmtDuration(result.durationMs)}</span>
              <span className="font-mono text-zinc-500">
                {result.method} {result.endpoint}
              </span>
              <span className="text-zinc-500">
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
        <p className="mt-4 rounded-lg bg-zinc-50 p-3 text-[11px] text-zinc-500">
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
            className="min-w-[280px] flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-[#3483FA]"
          />
          <button
            onClick={adicionar}
            disabled={busy || !email.trim()}
            className="rounded-lg bg-[#3483FA] px-4 py-2 text-sm font-bold text-white hover:bg-[#2968C8] disabled:opacity-50"
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
                    <span className="text-[11px] text-zinc-500">você</span>
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
              <p className="mt-2 break-all font-mono text-[11px] text-zinc-500">
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

          <h3 className="mt-5 text-xs font-bold uppercase tracking-wide text-zinc-500">Últimos eventos de OAuth</h3>
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
                <td className="px-2 py-2 max-w-[280px] truncate text-[11px] text-zinc-500">
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
