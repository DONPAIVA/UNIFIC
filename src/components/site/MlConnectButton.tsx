import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Link2, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { startMlConnect } from "@/lib/ml.functions";
import { minhaConexao } from "@/lib/minha-conta.functions";
import { useSessao } from "@/lib/useSessao";
import { playClick, playSuccess } from "@/lib/sfx";

/**
 * Conexão da conta do Mercado Livre do CLIENTE LOGADO.
 *
 * Depois que a conta está conectada, NENHUM botão de conectar/reconectar
 * aparece — só um selo discreto de "conta sincronizada". Isso é proposital:
 * um clique acidental em "reconectar" refaz o OAuth e confunde o cliente.
 * O botão só volta se a autorização realmente cair (precisaReconectar).
 */
export function MlConnectButton() {
  const [loading, setLoading] = useState(false);
  const { autenticado, carregando } = useSessao();

  const conexao = useQuery({
    queryKey: ["minha-conexao"],
    queryFn: () => minhaConexao(),
    staleTime: 30_000,
    enabled: autenticado,
  });

  const conectar = async () => {
    playClick();
    setLoading(true);
    try {
      const { authorizationUrl } = await startMlConnect();
      playSuccess();
      window.location.href = authorizationUrl;
    } catch (e) {
      setLoading(false);
      toast.error(e instanceof Error ? e.message : "Não foi possível iniciar a conexão.");
    }
  };

  const conectado = conexao.data?.conectado;
  const precisaReconectar = conexao.data?.precisaReconectar;

  /* Conta conectada e saudável: selo discreto, sem nenhum botão de ação. */
  if (autenticado && conectado && !precisaReconectar) {
    return (
      <div className="mx-auto mt-5 flex max-w-5xl flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-navy/60 px-4 py-3">
        <p className="flex items-center gap-2 text-sm font-bold text-navy-foreground">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          Mercado Livre conectado
          {conexao.data?.nickname ? ` — ${conexao.data.nickname}` : ""}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto mt-5 max-w-5xl overflow-hidden rounded-2xl border border-primary/40 bg-gradient-to-r from-navy via-navy/95 to-primary/25 p-5 shadow-2xl">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 font-display text-lg font-bold text-navy-foreground">
            <ShieldCheck className="h-5 w-5 text-primary" /> Conecte sua conta do Mercado Livre
          </p>
          <p className="mt-1 max-w-xl text-xs text-navy-foreground/80">
            {!autenticado
              ? "Entre na sua conta do Únific+ para conectar o Mercado Livre. Suas compras ficam visíveis só para você."
              : precisaReconectar
                ? "Sua autorização do Mercado Livre expirou ou foi revogada. Reconecte para voltar a acompanhar suas compras."
                : "Conecte com um clique e acompanhe aqui as suas compras reais do Mercado Livre, com rastreio e entrega."}
          </p>
          {precisaReconectar && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-bold text-primary">
              <AlertTriangle className="h-4 w-4" /> Reconexão necessária
            </p>
          )}
        </div>

        {carregando ? (
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        ) : !autenticado ? (
          <Link
            to="/entrar"
            // Depois de entrar, segue direto para a autorização do Mercado
            // Livre em vez de largar o cliente na home sem ter conectado.
            search={{ next: "conectar" }}
            onClick={() => playClick()}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-display text-base font-bold tracking-wide text-primary-foreground shadow-[0_10px_30px_-10px_rgba(0,0,0,.6)] transition-transform hover:scale-[1.03]"
          >
            <LogIn className="h-5 w-5" /> ENTRAR PARA CONECTAR
          </Link>
        ) : (
          <button
            onClick={conectar}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-display text-base font-bold tracking-wide text-primary-foreground shadow-[0_10px_30px_-10px_rgba(0,0,0,.6)] transition-transform hover:scale-[1.03] disabled:opacity-70"
          >
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Link2 className="h-5 w-5" />}
            {precisaReconectar ? "RECONECTAR MERCADO LIVRE" : "CONECTAR MERCADO LIVRE"}
          </button>
        )}
      </div>
    </div>
  );
}
