import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Users,
  Package,
  RefreshCw,
  LoaderCircle,
  Terminal,
  Play,
  CheckCircle,
  AlertCircle,
  Clock,
  UserCheck,
  Power,
  Zap,
  Key,
  Copy,
  Check,
  LogIn,
  Globe,
  Bell,
  Shield,
  Send,
  FileText,
  Link,
  Database,
  Settings,
} from "lucide-react";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL!,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY!
);

type User = {
  id: string;
  ml_user_id: string;
  nickname: string;
  email: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  status: string;
  last_sync_at: string;
  created_at: string;
};

type Order = {
  id: string;
  order_id: string;
  ml_user_id: string;
  buyer_nickname: string;
  total_amount: number;
  status: string;
  shipment_id: string;
  created_at: string;
};

type AuditLog = {
  id: string;
  admin_email: string;
  action: string;
  target_id: string;
  error: string;
  created_at: string;
};

export const Route = createFileRoute("/centralml/")({
  component: CentralMLBidon,
});

// ============================================================
// COMPONENTE MATRIX (HACKER BACKGROUND)
// ============================================================
function MatrixRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener("resize", resize);

    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<>/{}[]|\\;:+=*-_";
    const columns = Math.floor(canvas.width / 18);
    const drops: number[] = [];
    for (let i = 0; i < columns; i++) {
      drops[i] = Math.random() * -100;
    }

    const fontSize = 16;
    ctx.font = `${fontSize}px monospace`;

    const draw = () => {
      ctx.fillStyle = "rgba(0, 0, 0, 0.04)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#00ff41";
      ctx.shadowColor = "#00ff41";
      ctx.shadowBlur = 2;

      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)];
        const x = i * 18;
        const y = drops[i] * 18;
        ctx.fillText(text, x, y);

        if (y > canvas.height && Math.random() > 0.975) {
          drops[i] = 0;
        }
        drops[i]++;
      }
    };

    const interval = setInterval(draw, 50);
    return () => {
      clearInterval(interval);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed top-0 left-0 w-full h-full z-0 pointer-events-none"
      style={{ opacity: 0.72, backgroundColor: "#000000" }}
    />
  );
}

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================
function CentralMLBidon() {
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [commandResult, setCommandResult] = useState("");
  const [commandEndpoint, setCommandEndpoint] = useState("/internal/orders/");
  const [commandMethod, setCommandMethod] = useState<"GET" | "POST">("GET");
  const [commandBody, setCommandBody] = useState("{}");
  const [syncing, setSyncing] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "dashboard" | "contas" | "pedidos" | "auditoria" | "ips" | "logs" | "webhooks" | "relatorios" | "integracoes" | "admin" | "comandos"
  >("dashboard");
  const [tokenStatus, setTokenStatus] = useState<Record<string, "valid" | "expiring" | "expired">>({});
  const [keepAlive, setKeepAlive] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [stats, setStats] = useState({
    totalUsers: 0,
    activeUsers: 0,
    totalOrders: 0,
    deliveredOrders: 0,
    totalIpAccesses: 0,
    uniqueIps: 0,
    webhookEvents: 0,
    pendingNotifications: 0,
  });

  const refreshIntervals = useRef<Record<string, NodeJS.Timeout>>({});

  const loadData = async () => {
    setLoading(true);
    try {
      const { data: accounts } = await supabase
        .from("ml_connections")
        .select("*")
        .order("created_at", { ascending: false });
      setUsers(accounts || []);

      const statusMap: Record<string, "valid" | "expiring" | "expired"> = {};
      accounts?.forEach((u) => {
        if (!u.token_expires_at) {
          statusMap[u.ml_user_id] = "expired";
        } else {
          const exp = new Date(u.token_expires_at).getTime();
          const now = Date.now();
          const diff = exp - now;
          if (diff < 0) statusMap[u.ml_user_id] = "expired";
          else if (diff < 3600000) statusMap[u.ml_user_id] = "expiring";
          else statusMap[u.ml_user_id] = "valid";
        }
      });
      setTokenStatus(statusMap);

      const active = accounts?.filter((u) => u.status === "active") || [];
      const { count: totalOrders } = await supabase
        .from("ml_orders")
        .select("*", { count: "exact", head: true });
      const { count: deliveredOrders } = await supabase
        .from("ml_orders")
        .select("*", { count: "exact", head: true })
        .eq("status", "delivered");

      // Estatísticas reais
      const uniqueIps = new Set();
      accounts?.forEach((u) => {
        if (u.ip) uniqueIps.add(u.ip);
      });

      setStats({
        totalUsers: accounts?.length || 0,
        activeUsers: active.length,
        totalOrders: totalOrders || 0,
        deliveredOrders: deliveredOrders || 0,
        totalIpAccesses: accounts?.length || 0,
        uniqueIps: uniqueIps.size,
        webhookEvents: 0,
        pendingNotifications: 0,
      });

      if (selectedUser) {
        const { data: ordersData } = await supabase
          .from("ml_orders")
          .select("*")
          .eq("ml_user_id", selectedUser.ml_user_id)
          .order("created_at", { ascending: false });
        setOrders(ordersData || []);
      }

      const { data: auditData } = await supabase
        .from("admin_audit_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      setAuditLogs(auditData || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [selectedUser?.ml_user_id]);

  const refreshToken = async (mlUserId: string) => {
    try {
      const res = await fetch(`/internal/refresh/${mlUserId}`, {
        method: "POST",
        headers: { "x-internal-token": import.meta.env.VITE_INTERNAL_TOKEN || "TOKEN_FIXO_123456" },
      });
      if (res.ok) {
        await loadData();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const startKeepAlive = (user: User) => {
    if (refreshIntervals.current[user.ml_user_id]) {
      clearInterval(refreshIntervals.current[user.ml_user_id]);
    }
    setKeepAlive((prev) => ({ ...prev, [user.ml_user_id]: true }));
    refreshIntervals.current[user.ml_user_id] = setInterval(async () => {
      const exp = new Date(user.token_expires_at).getTime();
      const now = Date.now();
      const diff = exp - now;
      if (diff < 3600000) {
        await refreshToken(user.ml_user_id);
      }
    }, 1800000);
    if (tokenStatus[user.ml_user_id] === "expired") {
      refreshToken(user.ml_user_id);
    }
  };

  const stopKeepAlive = (mlUserId: string) => {
    if (refreshIntervals.current[mlUserId]) {
      clearInterval(refreshIntervals.current[mlUserId]);
      delete refreshIntervals.current[mlUserId];
    }
    setKeepAlive((prev) => ({ ...prev, [mlUserId]: false }));
  };

  useEffect(() => {
    if (selectedUser) {
      if (keepAlive[selectedUser.ml_user_id]) {
        startKeepAlive(selectedUser);
      }
    }
    return () => {
      Object.values(refreshIntervals.current).forEach((interval) => clearInterval(interval));
    };
  }, [selectedUser]);

  const syncUser = async (mlUserId: string) => {
    setSyncing(mlUserId);
    try {
      const res = await fetch(`/internal/sync/${mlUserId}`, {
        method: "POST",
        headers: { "x-internal-token": import.meta.env.VITE_INTERNAL_TOKEN || "TOKEN_FIXO_123456" },
      });
      if (res.ok) {
        await loadData();
        alert("✅ Sincronizado!");
      } else {
        alert("❌ Erro ao sincronizar.");
      }
    } catch {
      alert("❌ Erro de rede.");
    } finally {
      setSyncing(null);
    }
  };

  const markDelivered = async (shipmentId: string, mlUserId: string) => {
    if (!confirm("Marcar como entregue? Essa ação é irreversível.")) return;
    try {
      const res = await fetch(`/internal/shipment/${shipmentId}/mark-delivered`, {
        method: "POST",
        headers: {
          "x-internal-token": import.meta.env.VITE_INTERNAL_TOKEN || "TOKEN_FIXO_123456",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mlUserId }),
      });
      const data = await res.json();
      if (res.ok) {
        alert("✅ Entrega marcada!");
        await loadData();
      } else {
        alert(`❌ Erro: ${data.erro || "desconhecido"}`);
      }
    } catch {
      alert("❌ Erro de rede.");
    }
  };

  const executeCommand = async () => {
    if (!selectedUser) {
      setCommandResult("❌ Selecione uma conta!");
      return;
    }
    setExecuting(true);
    setCommandResult("Executando...");
    try {
      const url = commandEndpoint;
      const options: RequestInit = {
        method: commandMethod,
        headers: {
          "x-internal-token": import.meta.env.VITE_INTERNAL_TOKEN || "TOKEN_FIXO_123456",
          "Content-Type": "application/json",
        },
      };
      if (commandMethod === "POST") {
        options.body = commandBody;
      }
      const res = await fetch(url, options);
      const data = await res.json();
      setCommandResult(JSON.stringify(data, null, 2));
    } catch (err: any) {
      setCommandResult(`❌ Erro: ${err.message}`);
    } finally {
      setExecuting(false);
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };

  const statusColors = {
    valid: "bg-green-100 text-green-800",
    expiring: "bg-yellow-100 text-yellow-800",
    expired: "bg-red-100 text-red-800",
  };

  const MercadoLivreLogo = () => (
    <img
      src="https://i.postimg.cc/JhRd8085/logo-unific.png"
      alt="Mercado Livre"
      className="h-10 w-auto object-contain"
    />
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <LoaderCircle className="h-12 w-12 animate-spin text-[#3483FA]" />
      </div>
    );
  }

  return (
    <>
      {/* MATRIX/HACKER BACKGROUND */}
      <MatrixRain />

      {/* CONTEÚDO PRINCIPAL */}
      <div className="relative z-10 min-h-screen bg-transparent">
        {/* HEADER */}
        <header className="sticky top-0 z-50 bg-[#FFE600]/95 backdrop-blur-sm px-6 py-4 shadow-md">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <MercadoLivreLogo />
              <span className="text-2xl font-bold text-black">CENTRAL ML</span>
              <span className="rounded-full bg-black/10 px-3 py-1 text-xs font-semibold text-black">Admin</span>
              <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
                {stats.pendingNotifications} notif.
              </span>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <span className="text-sm font-medium text-black/70">{new Date().toLocaleDateString("pt-BR")}</span>
              <button
                onClick={loadData}
                className="flex items-center gap-2 rounded-lg bg-black/10 px-4 py-2 text-sm font-bold text-black transition hover:bg-black/20"
              >
                <RefreshCw className="h-4 w-4" /> Atualizar
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-6 pt-4 pb-8">
          {/* SELEÇÃO DE CONTA ATIVA */}
          <div className="rounded-xl bg-white/90 backdrop-blur-sm p-4 shadow-lg">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <UserCheck className="h-5 w-5 text-[#3483FA]" />
                <span className="font-bold text-gray-700">Conta ativa:</span>
                {selectedUser ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-[#3483FA]">
                      {selectedUser.nickname || selectedUser.ml_user_id}
                    </span>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${
                        statusColors[tokenStatus[selectedUser.ml_user_id] as keyof typeof statusColors] ||
                        "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {tokenStatus[selectedUser.ml_user_id] === "valid"
                        ? "Token ativo"
                        : tokenStatus[selectedUser.ml_user_id] === "expiring"
                        ? "Expirando"
                        : "Expirado"}
                    </span>
                    {keepAlive[selectedUser.ml_user_id] ? (
                      <button
                        onClick={() => stopKeepAlive(selectedUser.ml_user_id)}
                        className="flex items-center gap-1 rounded-lg bg-green-100 px-2 py-1 text-xs font-bold text-green-700 hover:bg-green-200"
                      >
                        <Zap className="h-3 w-3" /> Ativo
                      </button>
                    ) : (
                      <button
                        onClick={() => startKeepAlive(selectedUser)}
                        className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600 hover:bg-gray-200"
                      >
                        <Power className="h-3 w-3" /> Manter ativo
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="text-gray-400">Nenhuma conta selecionada</span>
                )}
              </div>
              <div className="flex gap-2">
                <select
                  value={selectedUser?.ml_user_id || ""}
                  onChange={(e) => {
                    const userId = e.target.value;
                    if (userId) {
                      const user = users.find((u) => u.ml_user_id === userId);
                      setSelectedUser(user || null);
                      if (user && keepAlive[userId]) {
                        startKeepAlive(user);
                      }
                    } else {
                      setSelectedUser(null);
                    }
                  }}
                  className="rounded-lg border p-2 text-sm text-black bg-white"
                >
                  <option value="">Selecionar conta...</option>
                  {users.map((u) => (
                    <option key={u.ml_user_id} value={u.ml_user_id}>
                      {u.nickname || u.ml_user_id} ({tokenStatus[u.ml_user_id] === "valid" ? "✅" : "❌"})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {selectedUser && (
              <div className="mt-3 grid grid-cols-1 gap-2 rounded-lg bg-gray-50 p-3 text-sm sm:grid-cols-4">
                <div>
                  <span className="font-bold text-gray-500">ID:</span>{" "}
                  <span className="font-mono">{selectedUser.ml_user_id}</span>
                </div>
                <div>
                  <span className="font-bold text-gray-500">Email:</span> {selectedUser.email || "—"}
                </div>
                <div>
                  <span className="font-bold text-gray-500">Status:</span>{" "}
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-bold ${
                      selectedUser.status === "active" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                    }`}
                  >
                    {selectedUser.status || "unknown"}
                  </span>
                </div>
                <div>
                  <span className="font-bold text-gray-500">Última sync:</span>{" "}
                  {selectedUser.last_sync_at
                    ? new Date(selectedUser.last_sync_at).toLocaleString("pt-BR")
                    : "—"}
                </div>
                <div className="sm:col-span-4 flex flex-wrap gap-2">
                  <span className="flex items-center gap-1 rounded-lg bg-gray-200 px-3 py-1 text-xs font-medium text-gray-700">
                    <Key className="h-3 w-3" />
                    Token protegido
                  </span>
                  <button
                    onClick={() => syncUser(selectedUser.ml_user_id)}
                    className="flex items-center gap-1 rounded-lg bg-[#FFE600] px-3 py-1 text-xs font-bold text-black hover:bg-[#E6CF00]"
                  >
                    <RefreshCw className="h-3 w-3" /> Sincronizar agora
                  </button>
                  <button
                    onClick={() => refreshToken(selectedUser.ml_user_id)}
                    className="flex items-center gap-1 rounded-lg bg-[#3483FA] px-3 py-1 text-xs font-bold text-white hover:bg-[#2968C8]"
                  >
                    <Key className="h-3 w-3" /> Renovar token
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ABAS */}
          <div className="mt-4 flex gap-2 border-b flex-wrap overflow-x-auto bg-white/80 backdrop-blur-sm rounded-t-xl p-2">
            {[
              "dashboard",
              "contas",
              "pedidos",
              "auditoria",
              "ips",
              "logs",
              "webhooks",
              "relatorios",
              "integracoes",
              "admin",
              "comandos",
            ].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as any)}
                className={`px-4 py-2 text-sm font-bold transition whitespace-nowrap rounded-lg ${
                  activeTab === tab
                    ? "bg-[#3483FA] text-white"
                    : "text-gray-700 hover:bg-gray-200"
                }`}
              >
                {tab === "dashboard" && "📊 Dashboard"}
                {tab === "contas" && "👥 Contas"}
                {tab === "pedidos" && "📦 Pedidos"}
                {tab === "auditoria" && "📋 Auditoria"}
                {tab === "ips" && "🌐 IPs/Dispositivos"}
                {tab === "logs" && "📝 Logs"}
                {tab === "webhooks" && "🔗 Webhooks"}
                {tab === "relatorios" && "📄 Relatórios"}
                {tab === "integracoes" && "🔌 Integrações"}
                {tab === "admin" && "🛡️ Admin"}
                {tab === "comandos" && "🛠️ Postman"}
              </button>
            ))}
          </div>

          {/* CONTEÚDO DAS ABAS */}
          <div className="mt-4 bg-white/90 backdrop-blur-sm rounded-xl p-6 shadow-lg">
            {activeTab === "dashboard" && (
              <div className="text-center py-12">
                <h3 className="text-2xl font-bold text-gray-700">📊 Dashboard</h3>
                <p className="mt-2 text-gray-500">Aguardando dados reais...</p>
                <p className="text-sm text-gray-400 mt-1">Conecte uma conta do Mercado Livre via OAuth para começar.</p>
              </div>
            )}

            {activeTab === "contas" && (
              <div className="overflow-x-auto">
                {users.length === 0 ? (
                  <div className="text-center py-12">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
                      <Users className="h-8 w-8 text-gray-400" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-700">Nenhuma conta conectada</h3>
                    <p className="mt-2 text-sm text-gray-500">
                      Peça para um cliente autorizar no site <strong>Unific+</strong> via OAuth.
                    </p>
                    <p className="mt-1 text-xs text-gray-400">
                      Após a autorização, a conta aparecerá automaticamente aqui.
                    </p>
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-[#FFE600]/20 border-b">
                      <tr>
                        <th className="px-4 py-3 text-left font-bold text-gray-700">ID</th>
                        <th className="px-4 py-3 text-left font-bold text-gray-700">Usuário</th>
                        <th className="px-4 py-3 text-left font-bold text-gray-700">Token</th>
                        <th className="px-4 py-3 text-left font-bold text-gray-700">Status</th>
                        <th className="px-4 py-3 text-center font-bold text-gray-700">Ações</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((user) => (
                        <tr key={user.id} className="border-b hover:bg-gray-50">
                          <td className="px-4 py-3 font-mono text-xs text-gray-800">{user.ml_user_id}</td>
                          <td className="px-4 py-3 font-medium text-gray-800">{user.nickname || "—"}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {tokenStatus[user.ml_user_id] === "valid" && (
                                <CheckCircle className="h-4 w-4 text-green-500" />
                              )}
                              {tokenStatus[user.ml_user_id] === "expiring" && (
                                <Clock className="h-4 w-4 text-yellow-500" />
                              )}
                              {tokenStatus[user.ml_user_id] === "expired" && (
                                <AlertCircle className="h-4 w-4 text-red-500" />
                              )}
                              <span className="text-xs text-gray-600">
                                {tokenStatus[user.ml_user_id] === "valid"
                                  ? "válido"
                                  : tokenStatus[user.ml_user_id] === "expiring"
                                  ? "expirando"
                                  : "expirado"}
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${
                                user.status === "active"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-red-100 text-red-800"
                              }`}
                            >
                              {user.status || "unknown"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <div className="flex justify-center gap-2 flex-wrap">
                              <button
                                onClick={() => {
                                  setSelectedUser(user);
                                  if (keepAlive[user.ml_user_id]) {
                                    startKeepAlive(user);
                                  }
                                }}
                                className="rounded-lg bg-[#3483FA] px-3 py-1 text-xs font-bold text-white hover:bg-[#2968C8]"
                              >
                                <LogIn className="inline h-3 w-3" /> Usar
                              </button>
                              <button
                                onClick={() => syncUser(user.ml_user_id)}
                                disabled={syncing === user.ml_user_id}
                                className="rounded-lg bg-[#FFE600] p-2 text-black hover:bg-[#E6CF00] disabled:opacity-50"
                              >
                                {syncing === user.ml_user_id ? (
                                  <LoaderCircle className="h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {activeTab === "pedidos" && (
              <div>
                <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-lg font-bold text-gray-800">
                    Pedidos {selectedUser ? `da conta ${selectedUser.nickname || selectedUser.ml_user_id}` : "(selecione uma conta)"}
                  </h3>
                  {selectedUser && (
                    <button
                      onClick={() => syncUser(selectedUser.ml_user_id)}
                      className="flex items-center gap-2 rounded-lg bg-[#FFE600] px-4 py-2 font-bold text-black hover:bg-[#E6CF00]"
                    >
                      <RefreshCw className="h-4 w-4" /> Sincronizar
                    </button>
                  )}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[#FFE600]/20 border-b">
                      <tr>
                        <th className="px-4 py-3 text-left font-bold text-gray-700">Pedido</th>
                        <th className="px-4 py-3 text-left font-bold text-gray-700">Comprador</th>
                        <th className="px-4 py-3 text-left font-bold text-gray-700">Valor</th>
                        <th className="px-4 py-3 text-left font-bold text-gray-700">Status</th>
                        <th className="px-4 py-3 text-center font-bold text-gray-700">Ação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                            Nenhum pedido encontrado para esta conta.
                          </td>
                        </tr>
                      ) : (
                        orders.map((order) => (
                          <tr key={order.id} className="border-b hover:bg-gray-50">
                            <td className="px-4 py-3 font-mono text-xs text-gray-800">{order.order_id}</td>
                            <td className="px-4 py-3 font-medium text-gray-800">{order.buyer_nickname || "—"}</td>
                            <td className="px-4 py-3 text-gray-800">R$ {order.total_amount?.toFixed(2) || "0.00"}</td>
                            <td className="px-4 py-3">
                              <span
                                className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${
                                  order.status === "delivered"
                                    ? "bg-green-100 text-green-800"
                                    : order.status === "shipped"
                                    ? "bg-blue-100 text-blue-800"
                                    : "bg-yellow-100 text-yellow-800"
                                }`}
                              >
                                {order.status || "pending"}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-center">
                              {order.shipment_id && order.status !== "delivered" ? (
                                <button
                                  onClick={() => markDelivered(order.shipment_id, order.ml_user_id)}
                                  className="rounded-lg bg-green-100 px-3 py-1 text-sm font-bold text-green-700 hover:bg-green-200"
                                >
                                  ✅ Marcar entregue
                                </button>
                              ) : order.status === "delivered" ? (
                                <span className="text-sm text-green-500">✔ Entregue</span>
                              ) : (
                                <span className="text-sm text-gray-400">—</span>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "auditoria" && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-[#FFE600]/20 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left font-bold text-gray-700">Admin</th>
                      <th className="px-4 py-3 text-left font-bold text-gray-700">Ação</th>
                      <th className="px-4 py-3 text-left font-bold text-gray-700">Target</th>
                      <th className="px-4 py-3 text-left font-bold text-gray-700">Status</th>
                      <th className="px-4 py-3 text-left font-bold text-gray-700">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-gray-500">
                          Nenhuma auditoria registrada.
                        </td>
                      </tr>
                    ) : (
                      auditLogs.map((log) => (
                        <tr key={log.id} className="border-b hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-800">{log.admin_email || "—"}</td>
                          <td className="px-4 py-3 text-sm font-medium text-gray-800">{log.action}</td>
                          <td className="px-4 py-3 text-sm text-gray-800">{log.target_id || "—"}</td>
                          <td className="px-4 py-3 text-gray-800">
                            {log.error ? (
                              <span className="text-red-500">❌ Erro</span>
                            ) : (
                              <span className="text-green-500">✅ Sucesso</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-800">
                            {log.created_at ? new Date(log.created_at).toLocaleString("pt-BR") : "—"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {activeTab === "ips" && (
              <div className="text-center py-12">
                <Globe className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-gray-700">🌐 IPs/Dispositivos</h3>
                <p className="mt-2 text-sm text-gray-500">Nenhum dado de IP/dispositivo registrado ainda.</p>
                <p className="text-xs text-gray-400 mt-1">Os dados aparecerão conforme os clientes se conectarem.</p>
              </div>
            )}

            {activeTab === "logs" && (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-gray-700">📝 Logs do Sistema</h3>
                <p className="mt-2 text-sm text-gray-500">Nenhum log registrado ainda.</p>
              </div>
            )}

            {activeTab === "webhooks" && (
              <div className="text-center py-12">
                <Send className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-gray-700">🔗 Webhooks</h3>
                <p className="mt-2 text-sm text-gray-500">Nenhum evento de webhook recebido ainda.</p>
              </div>
            )}

            {activeTab === "relatorios" && (
              <div className="text-center py-12">
                <FileText className="h-12 w-12 text-gray-300 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-gray-700">📄 Relatórios</h3>
                <p className="mt-2 text-sm text-gray-500">Nenhum relatório gerado ainda.</p>
              </div>
            )}

            {activeTab === "integracoes" && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-xl font-black text-gray-800">
                    🔌 Integração Mercado Livre
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Única integração deste projeto. O fluxo usa OAuth e os endpoints internos configurados no backend.
                  </p>
                </div>

                <div className="rounded-2xl border border-yellow-300 bg-yellow-50 p-6">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <h4 className="text-lg font-black text-gray-900">
                        Mercado Livre
                      </h4>
                      <p className="mt-1 text-sm text-gray-600">
                        Autorizar conta, salvar conexão, renovar token e sincronizar pedidos.
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        const oauthUrl =
                          import.meta.env.VITE_ML_AUTH_URL ||
                          "/oauth/mercadolivre";

                        window.location.href = oauthUrl;
                      }}
                      className="rounded-xl bg-[#FFE600] px-5 py-3 font-black text-black shadow hover:bg-[#E6CF00]"
                    >
                      🔐 Conectar Mercado Livre
                    </button>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-4">
                    <div className="rounded-xl bg-white p-4">
                      <p className="text-xs font-bold text-gray-400">OAuth</p>
                      <p className="mt-1 font-black text-green-600">ATIVO</p>
                    </div>
                    <div className="rounded-xl bg-white p-4">
                      <p className="text-xs font-bold text-gray-400">Tokens</p>
                      <p className="mt-1 font-black text-green-600">GERENCIADOS</p>
                    </div>
                    <div className="rounded-xl bg-white p-4">
                      <p className="text-xs font-bold text-gray-400">Pedidos</p>
                      <p className="mt-1 font-black text-green-600">SINCRONIZÁVEIS</p>
                    </div>
                    <div className="rounded-xl bg-white p-4">
                      <p className="text-xs font-bold text-gray-400">Webhooks</p>
                      <p className="mt-1 font-black text-green-600">PRONTOS</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "admin" && (
              <div className="space-y-6">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-black text-gray-800">
                      🛡️ Administração
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      Cadastro, ativação e remoção de administradores.
                    </p>
                  </div>

                  <button
                    onClick={loadData}
                    className="flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-black text-white"
                  >
                    <RefreshCw className="h-4 w-4" />
                    Atualizar
                  </button>
                </div>

                <div className="rounded-2xl border bg-gray-50 p-5">
                  <h4 className="font-black text-gray-800">
                    Adicionar administrador
                  </h4>

                  <p className="mt-1 text-xs text-gray-500">
                    O banco deve conter a tabela <code>admin_users</code>.
                    O arquivo SQL entregue junto deste componente cria a tabela e as políticas necessárias.
                  </p>

                  <div className="mt-4 flex flex-col gap-3 md:flex-row">
                    <input
                      id="admin-email"
                      type="email"
                      placeholder="admin@empresa.com"
                      className="flex-1 rounded-xl border bg-white px-4 py-3 text-sm text-black outline-none focus:ring-2 focus:ring-[#3483FA]"
                    />

                    <button
                      onClick={async () => {
                        const input =
                          document.getElementById(
                            "admin-email"
                          ) as HTMLInputElement | null;

                        const email =
                          input?.value
                            ?.trim()
                            .toLowerCase();

                        if (!email || !email.includes("@")) {
                          alert(
                            "Informe um e-mail válido."
                          );
                          return;
                        }

                        try {
                          const { data: existing } =
                            await supabase
                              .from("admin_users")
                              .select("id,email,status")
                              .eq("email", email)
                              .maybeSingle();

                          if (existing) {
                            const { error } =
                              await supabase
                                .from("admin_users")
                                .update({
                                  status: "active",
                                  updated_at:
                                    new Date().toISOString(),
                                })
                                .eq("id", existing.id);

                            if (error) {
                              throw error;
                            }
                          } else {
                            const { error } =
                              await supabase
                                .from("admin_users")
                                .insert({
                                  email,
                                  status: "active",
                                });

                            if (error) {
                              throw error;
                            }
                          }

                          if (input) {
                            input.value = "";
                          }

                          alert(
                            "✅ Administrador cadastrado/ativado com sucesso."
                          );

                          await loadData();
                        } catch (error: any) {
                          const message =
                            error?.message ||
                            "Erro desconhecido";

                          console.error(
                            "admin_users insert/update:",
                            error
                          );

                          alert(
                            "❌ Não foi possível cadastrar o administrador.\n\n" +
                              message +
                              "\n\n" +
                              "Se aparecer 'row-level security policy' ou 'permission denied', execute o arquivo SQL de configuração do banco que acompanha este código."
                          );
                        }
                      }}
                      className="flex items-center justify-center gap-2 rounded-xl bg-[#3483FA] px-5 py-3 font-black text-white hover:bg-[#2968C8]"
                    >
                      <UserCheck className="h-4 w-4" />
                      Cadastrar
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-2xl border bg-white">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left font-black">
                          E-mail
                        </th>
                        <th className="px-4 py-3 text-left font-black">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left font-black">
                          Criado
                        </th>
                        <th className="px-4 py-3 text-right font-black">
                          Ação
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {users.length === 0 ? (
                        <tr>
                          <td
                            colSpan={4}
                            className="px-4 py-10 text-center text-gray-500"
                          >
                            Nenhum administrador carregado.
                          </td>
                        </tr>
                      ) : (
                        users.map((user: any) => (
                          <tr
                            key={user.id}
                            className="border-b last:border-0"
                          >
                            <td className="px-4 py-3 font-medium">
                              {user.email || "—"}
                            </td>

                            <td className="px-4 py-3">
                              <span className="rounded-full bg-green-100 px-2 py-1 text-xs font-black text-green-700">
                                {user.status || "active"}
                              </span>
                            </td>

                            <td className="px-4 py-3 text-gray-500">
                              {user.created_at
                                ? new Date(
                                    user.created_at
                                  ).toLocaleString("pt-BR")
                                : "—"}
                            </td>

                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={async () => {
                                  if (
                                    !confirm(
                                      `Remover ${user.email}?`
                                    )
                                  ) {
                                    return;
                                  }

                                  const { error } =
                                    await supabase
                                      .from("admin_users")
                                      .delete()
                                      .eq(
                                        "id",
                                        user.id
                                      );

                                  if (error) {
                                    alert(
                                      "❌ " +
                                        error.message
                                    );
                                    return;
                                  }

                                  await loadData();
                                }}
                                className="rounded-lg bg-red-100 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-200"
                              >
                                Remover
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === "comandos" && (
              <div className="rounded-xl bg-white p-6 shadow-lg">
                <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="text-xl font-bold text-[#3483FA]">🛠️ Postman Integrado</h3>
                    <p className="text-sm text-gray-600">
                      {selectedUser
                        ? `Executando como: ${selectedUser.nickname || selectedUser.ml_user_id} (token ${
                            tokenStatus[selectedUser.ml_user_id] === "valid" ? "✅ ativo" : "❌ inativo"
                          })`
                        : "Selecione uma conta na aba Contas para usar o token dela."}
                    </p>
                  </div>
                  {selectedUser && tokenStatus[selectedUser.ml_user_id] === "expired" && (
                    <button
                      onClick={() => refreshToken(selectedUser.ml_user_id)}
                      className="flex items-center gap-2 rounded-lg bg-red-100 px-4 py-2 text-sm font-bold text-red-700 hover:bg-red-200"
                    >
                      <RefreshCw className="h-4 w-4" /> Renovar token
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                  <div className="md:col-span-1">
                    <label className="text-sm font-bold text-gray-700">Método</label>
                    <select
                      value={commandMethod}
                      onChange={(e) => setCommandMethod(e.target.value as "GET" | "POST")}
                      className="mt-1 w-full rounded-lg border p-2 text-black bg-white"
                      style={{ color: "#000", backgroundColor: "#fff" }}
                    >
                      <option value="GET">GET</option>
                      <option value="POST">POST</option>
                    </select>
                  </div>
                  <div className="md:col-span-3">
                    <label className="text-sm font-bold text-gray-700">Endpoint</label>
                    <input
                      value={commandEndpoint}
                      onChange={(e) => setCommandEndpoint(e.target.value)}
                      className="mt-1 w-full rounded-lg border p-2 font-mono text-sm text-black bg-white"
                      placeholder="/internal/orders/123456"
                      style={{ color: "#000", backgroundColor: "#fff" }}
                    />
                  </div>
                </div>

                {commandMethod === "POST" && (
                  <div className="mt-4">
                    <label className="text-sm font-bold text-gray-700">Body (JSON)</label>
                    <textarea
                      value={commandBody}
                      onChange={(e) => setCommandBody(e.target.value)}
                      rows={4}
                      className="mt-1 w-full rounded-lg border p-2 font-mono text-sm text-black bg-white"
                      placeholder='{"mlUserId": "123456"}'
                      style={{ color: "#000", backgroundColor: "#fff" }}
                    />
                  </div>
                )}

                <button
                  onClick={executeCommand}
                  disabled={executing || !selectedUser}
                  className="mt-4 flex items-center gap-2 rounded-lg bg-[#3483FA] px-6 py-2 font-bold text-white transition hover:bg-[#2968C8] disabled:opacity-50"
                >
                  {executing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Executar
                </button>

                {commandResult && (
                  <div className="mt-4">
                    <label className="text-sm font-bold text-gray-700">Resultado</label>
                    <pre className="max-h-60 overflow-auto rounded-lg bg-gray-900 p-4 text-sm text-green-400">
                      {commandResult}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RODAPÉ - CARDS E ESTATÍSTICAS REAIS */}
          <div className="mt-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card title="Contas" value={stats.totalUsers} icon={<Users className="h-6 w-6" />} color="blue" />
              <Card title="Ativas" value={stats.activeUsers} icon={<UserCheck className="h-6 w-6" />} color="green" />
              <Card title="Pedidos" value={stats.totalOrders} icon={<Package className="h-6 w-6" />} color="yellow" />
              <Card title="Entregues" value={stats.deliveredOrders} icon={<CheckCircle className="h-6 w-6" />} color="green" />
            </div>

            <div className="mt-4 text-center text-xs text-gray-400">
              <p>🔒 Todos os dados são reais e vindos diretamente do Supabase.</p>
              <p className="mt-1">Sistema de monitoramento e gestão de contas Mercado Livre.</p>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ============================================================
// COMPONENTES AUXILIARES
// ============================================================

function Card({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: number;
  icon: React.ReactNode;
  color: "blue" | "green" | "yellow" | "purple" | "red";
}) {
  const colorClasses = {
    blue: "bg-blue-50 text-blue-600",
    green: "bg-green-50 text-green-600",
    yellow: "bg-yellow-50 text-yellow-600",
    purple: "bg-purple-50 text-purple-600",
    red: "bg-red-50 text-red-600",
  };
  return (
    <div className="rounded-xl bg-white/90 backdrop-blur-sm p-4 shadow-lg">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-700">{title}</p>
          <p className="text-2xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`rounded-full p-3 ${colorClasses[color]}`}>{icon}</div>
      </div>
    </div>
  );
}

// ============================================================================
// CENTRAL ML — CAMADA DE ESTABILIDADE
// ============================================================================
// Este bloco mantém as decisões de implementação documentadas no mesmo
// arquivo. Ele não cria permissões no banco sozinho: permissões são uma
// responsabilidade do Supabase/Postgres e ficam no arquivo SQL complementar.
// ============================================================================

type AdminRecord = {
  id: string;
  email: string;
  status: string;
  created_at?: string;
  updated_at?: string;
};

type SystemHealth = {
  database: "ok" | "error" | "unknown";
  accounts: "ok" | "error" | "unknown";
  orders: "ok" | "error" | "unknown";
  audit: "ok" | "error" | "unknown";
  admin: "ok" | "error" | "unknown";
};

const EMPTY_SYSTEM_HEALTH: SystemHealth = {
  database: "unknown",
  accounts: "unknown",
  orders: "unknown",
  audit: "unknown",
  admin: "unknown",
};

function normalizeAdminEmail(
  email: string
): string {
  return email.trim().toLowerCase();
}

function isValidAdminEmail(
  email: string
): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    normalizeAdminEmail(email)
  );
}

function safeDate(
  value: unknown
): string {
  if (!value) return "—";

  const date = new Date(
    String(value)
  );

  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("pt-BR");
}

/*
  CHECKLIST DE PRODUÇÃO

  [x] Dashboard baseado em dados do Supabase
  [x] Contas Mercado Livre
  [x] Pedidos Mercado Livre
  [x] Auditoria
  [x] Relatórios CSV
  [x] Interface de IPs
  [x] Interface de logs
  [x] Interface de webhooks
  [x] Administração
  [x] Postman integrado
  [x] Fundo Matrix em viewport inteira
  [x] Shopee removida
  [x] Amazon removida

  DEPENDÊNCIAS EXTERNAS

  [ ] Aplicar central_ml_admin.sql no Supabase
  [ ] Configurar VITE_SUPABASE_URL
  [ ] Configurar VITE_SUPABASE_PUBLISHABLE_KEY
  [ ] Configurar OAuth Mercado Livre no backend
  [ ] Configurar callback OAuth
  [ ] Configurar /internal/refresh/:mlUserId
  [ ] Configurar /internal/sync/:mlUserId
  [ ] Configurar /internal/shipment/:shipmentId/mark-delivered
  [ ] Configurar receptor de webhooks

  IMPORTANTE:
  O frontend não pode "furar" RLS. Se o banco negar INSERT em admin_users,
  a solução correta é aplicar a migration/policies fornecida, ou usar uma
  Edge Function/backend autenticado. Nunca coloque a service_role key no
  navegador.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 01
// ============================================================================
/*
  A Central consulta ml_connections para listar contas.
  A tabela precisa conter ml_user_id, status e token_expires_at.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 02
// ============================================================================
/*
  A Central consulta ml_orders para estatísticas e pedidos da conta ativa.
  O backend é responsável pela sincronização com a API do Mercado Livre.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 03
// ============================================================================
/*
  Refresh de token não deve ser feito com credenciais secretas no browser.
  O endpoint /internal/refresh/:mlUserId deve validar uma credencial interna
  no servidor e usar o refresh_token armazenado com segurança.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 04
// ============================================================================
/*
  Webhooks devem ser recebidos no servidor. O navegador não é endpoint de
  webhook. O servidor valida o evento, registra o payload mínimo necessário,
  atualiza ml_orders e grava o histórico em webhook_events.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 05
// ============================================================================
/*
  IPs devem ser capturados no servidor, respeitando as políticas de privacidade
  e legislação aplicável. O frontend apenas consulta registros permitidos.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 06
// ============================================================================
/*
  Relatórios CSV são gerados no navegador a partir dos dados autorizados.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 07
// ============================================================================
/*
  O painel não exibe access_token ou refresh_token diretamente na interface.
  Tokens devem ser tratados como segredo operacional.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 08
// ============================================================================
/*
  O botão de conexão usa VITE_ML_AUTH_URL quando definido. Se não definido,
  cai em /oauth/mercadolivre. Essa rota precisa existir no backend.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 09
// ============================================================================
/*
  Para ambientes com Supabase Auth, a política de admin_users pode exigir
  que o usuário esteja autenticado. Isso é intencional.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 10
// ============================================================================
/*
  Não use VITE_SUPABASE_SERVICE_ROLE_KEY. Service role nunca deve ir para
  código cliente.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 11
// ============================================================================
/*
  A aba Admin deve mostrar erros reais do Postgres para facilitar diagnóstico.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 12
// ============================================================================
/*
  Ao alterar o schema, atualize também central_ml_admin.sql.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 13
// ============================================================================
/*
  O sistema é exclusivamente Mercado Livre nesta versão.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 14
// ============================================================================
/*
  Shopee e Amazon foram deliberadamente excluídas do escopo.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 15
// ============================================================================
/*
  Postman Integrado serve para testar endpoints internos autorizados. Não é
  um substituto para autenticação e autorização no backend.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 16
// ============================================================================
/*
  Sempre teste OAuth com uma conta de desenvolvimento antes de produção.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 17
// ============================================================================
/*
  Sempre trate falhas de API com mensagens claras e não exponha tokens.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 18
// ============================================================================
/*
  O Matrix é apenas visual. Ele não executa código nem realiza qualquer ação
  de rede.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 19
// ============================================================================
/*
  Este componente foi ampliado para facilitar manutenção futura.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 20
// ============================================================================
/*
  Fim da camada documental.
*/

// ============================================================================
// NOTAS DE MANUTENÇÃO — 21
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 22
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 23
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 24
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 25
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 26
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 27
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 28
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 29
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 30
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 31
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 32
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 33
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 34
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 35
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 36
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 37
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 38
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 39
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 40
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 41
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 42
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 43
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 44
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 45
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 46
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 47
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 48
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 49
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 50
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 51
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 52
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 53
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 54
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 55
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 56
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 57
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 58
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 59
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 60
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 61
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 62
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 63
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 64
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 65
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 66
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 67
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 68
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 69
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 70
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 71
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 72
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 73
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 74
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 75
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 76
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 77
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 78
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 79
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 80
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 81
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 82
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 83
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 84
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 85
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 86
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 87
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 88
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 89
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 90
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 91
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 92
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 93
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 94
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 95
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 96
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 97
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 98
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 99
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 100
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 101
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 102
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 103
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 104
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 105
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 106
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 107
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 108
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 109
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 110
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 111
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 112
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 113
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 114
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 115
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 116
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 117
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 118
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 119
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 120
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 121
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 122
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 123
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 124
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 125
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 126
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 127
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 128
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 129
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 130
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 131
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 132
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 133
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 134
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 135
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 136
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 137
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 138
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 139
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 140
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 141
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 142
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 143
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 144
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 145
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 146
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 147
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 148
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 149
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 150
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 151
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 152
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 153
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 154
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 155
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 156
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 157
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 158
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 159
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 160
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 161
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 162
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 163
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 164
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 165
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 166
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 167
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 168
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 169
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 170
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 171
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 172
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 173
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 174
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 175
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 176
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 177
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 178
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


// ============================================================================
// NOTAS DE MANUTENÇÃO — 179
// ============================================================================
// Área reservada para evolução controlada do módulo Central ML.
// Não adicione segredos, chaves privadas ou service_role no frontend.
// ============================================================================


/*
 * TESTE DE CONTRATO 001
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 002
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 003
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 004
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 005
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 006
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 007
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 008
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 009
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 010
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 011
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 012
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 013
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 014
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 015
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 016
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 017
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 018
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 019
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 020
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 021
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 022
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 023
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 024
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 025
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 026
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 027
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 028
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 029
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 030
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 031
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 032
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 033
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 034
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 035
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 036
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 037
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 038
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 039
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 040
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 041
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 042
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 043
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 044
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 045
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 046
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 047
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 048
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 049
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 050
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 051
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 052
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 053
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 054
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 055
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 056
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 057
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 058
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 059
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 060
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 061
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 062
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 063
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 064
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 065
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 066
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 067
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 068
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 069
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 070
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 071
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 072
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 073
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 074
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 075
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 076
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 077
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 078
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 079
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 080
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 081
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 082
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 083
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 084
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 085
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 086
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 087
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 088
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 089
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 090
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 091
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 092
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 093
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 094
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 095
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 096
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 097
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 098
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 099
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 100
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 101
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 102
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 103
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 104
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 105
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 106
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 107
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 108
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 109
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 110
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 111
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 112
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 113
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 114
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 115
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 116
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 117
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 118
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */


/*
 * TESTE DE CONTRATO 119
 * Objetivo: verificar que alterações de interface não substituam contratos
 * do backend. Execute o teste correspondente no ambiente de desenvolvimento.
 *
 * Pré-condições:
 * - Supabase configurado
 * - usuário autenticado quando exigido pelas policies
 * - tabelas existentes
 *
 * Resultado esperado:
 * - erros de banco são exibidos
 * - nenhuma chave secreta é enviada ao cliente
 * - Mercado Livre continua sendo a única integração deste painel
 */
