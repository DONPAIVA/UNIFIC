import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  LoaderCircle,
  LogIn,
  Package,
  RefreshCw,
  Search,
  Truck,
} from "lucide-react";

import { Layout } from "@/components/site/Layout";
import { useSessao } from "@/lib/useSessao";
import {
  marcarCompraRecebida,
  minhaCompra,
  minhaConexao,
  minhasCompras,
  sincronizarMinhaConta,
  type CompraResumo,
} from "@/lib/minha-conta.functions";

export const Route = createFileRoute("/meus-pedidos")({
  head: () => ({
    meta: [
      { title: "Minhas Compras | Únific+" },
      { name: "description", content: "Acompanhe suas compras reais do Mercado Livre: pedido, envio, rastreio e entrega." },
    ],
  }),
  component: MinhasCompras,
});

function dinheiro(valor?: number | null, moeda?: string | null) {
  if (valor == null) return "—";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: moeda || "BRL" }).format(valor);
  } catch {
    return String(valor);
  }
}

function dataHora(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

/* ========================================================================== */

function MinhasCompras() {
  const { autenticado, carregando } = useSessao();
  const [aberta, setAberta] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const qc = useQueryClient();

  const conexao = useQuery({
    queryKey: ["minha-conexao"],
    queryFn: () => minhaConexao(),
    enabled: autenticado,
  });

  const compras = useQuery({
    queryKey: ["minhas-compras", termo],
    queryFn: () => minhasCompras({ data: { q: termo, limit: 50, offset: 0 } }),
    enabled: autenticado && Boolean(conexao.data?.conectado),
  });

  const sincronizar = useMutation({
    mutationFn: () => sincronizarMinhaConta({ data: { completa: false } }),
    onSuccess: (r) => {
      const total = r.resultados.reduce((acc, x) => acc + (x.pedidos ?? 0), 0);
      const erro = r.resultados.find((x) => x.erro);
      if (erro?.erro) toast.error(`Sincronização com problema: ${erro.erro}`);
      else toast.success(`Sincronizado: ${total} compra(s).`);
      void qc.invalidateQueries({ queryKey: ["minhas-compras"] });
      void qc.invalidateQueries({ queryKey: ["minha-conexao"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (carregando) {
    return (
      <Layout>
        <div className="mx-auto mt-10 flex max-w-md justify-center">
          <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
        </div>
      </Layout>
    );
  }

  if (!autenticado) {
    return (
      <Layout>
        <section className="card-panel mx-auto mt-6 max-w-md p-6 text-center">
          <ClipboardList className="mx-auto h-10 w-10 text-primary" />
          <h1 className="mt-3 font-display text-xl font-bold">Minhas Compras</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Entre na sua conta para ver as compras reais do seu Mercado Livre.
          </p>
          <Link
            to="/entrar"
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2 text-sm font-bold text-primary-foreground"
          >
            <LogIn className="h-4 w-4" /> Entrar
          </Link>
        </section>
      </Layout>
    );
  }

  if (conexao.data && !conexao.data.conectado) {
    return (
      <Layout>
        <section className="card-panel mx-auto mt-6 max-w-md p-6 text-center">
          <Package className="mx-auto h-10 w-10 text-primary" />
          <h1 className="mt-3 font-display text-xl font-bold">Conecte seu Mercado Livre</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {conexao.data.precisaReconectar
              ? "Sua autorização expirou. Reconecte para voltar a ver suas compras."
              : "Depois de conectar, suas compras aparecem aqui automaticamente."}
          </p>
          <Link to="/" className="mt-4 inline-block rounded-md bg-primary px-5 py-2 text-sm font-bold text-primary-foreground">
            Ir para a conexão
          </Link>
        </section>
      </Layout>
    );
  }

  if (aberta) return <DetalheCompra id={aberta} onVoltar={() => setAberta(null)} />;

  return (
    <Layout>
      <section className="card-panel mx-auto mt-6 max-w-4xl p-5 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 font-display text-xl font-bold">
              <ClipboardList className="h-5 w-5 text-primary" /> Minhas Compras
            </h1>
            <p className="text-sm text-muted-foreground">
              Compras reais da sua conta do Mercado Livre
              {conexao.data?.nickname ? ` (${conexao.data.nickname})` : ""}.
            </p>
          </div>
          <button
            onClick={() => sincronizar.mutate()}
            disabled={sincronizar.isPending}
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-bold disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${sincronizar.isPending ? "animate-spin" : ""}`} />
            {sincronizar.isPending ? "Atualizando…" : "Atualizar"}
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-md border border-input bg-white px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setTermo(busca)}
              placeholder="Produto, número do pedido ou envio"
              className="w-full bg-transparent py-2 text-sm text-card-foreground outline-none"
            />
          </div>
          <button
            onClick={() => setTermo(busca)}
            className="rounded-md bg-primary px-5 py-2 text-sm font-bold text-primary-foreground"
          >
            Buscar
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {compras.isLoading && (
            <div className="flex justify-center py-8">
              <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {compras.error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              {(compras.error as Error).message}
            </p>
          )}

          {compras.data?.compras.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nenhuma compra encontrada nesta conta do Mercado Livre.
            </p>
          )}

          {compras.data?.compras.map((c: CompraResumo) => (
            <button
              key={c.id}
              onClick={() => setAberta(c.id)}
              className="flex w-full flex-wrap items-center gap-4 rounded-lg border border-border p-4 text-left transition hover:border-primary/60"
            >
              <div className="min-w-[220px] flex-1">
                <p className="font-display text-base font-bold">{c.titulo ?? `Pedido ${c.pedidoML}`}</p>
                <p className="text-sm">
                  {dinheiro(c.valor, c.moeda)} · {c.quantidade ?? 1} un. · Pedido {c.pedidoML}
                </p>
                <p className="text-xs text-muted-foreground">
                  {dataHora(c.data)}
                  {c.envio?.rastreio ? ` · Rastreio ${c.envio.rastreio}` : ""}
                  {c.envio?.destino ? ` · ${c.envio.destino}` : ""}
                </p>
              </div>

              <div className="flex flex-col items-end gap-1">
                <span className="rounded-full bg-primary px-3 py-1 text-xs font-bold text-primary-foreground">
                  {c.envio?.statusTexto ?? c.statusTexto}
                </span>
                {c.recebimentoConfirmado && (
                  <span className="flex items-center gap-1 text-[11px] font-bold text-success">
                    <CheckCircle2 className="h-3 w-3" /> Recebimento confirmado
                  </span>
                )}
                {c.podeMarcarRecebido && !c.recebimentoConfirmado && (
                  <span className="text-[11px] font-bold text-primary">Confirmar recebimento</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </section>
    </Layout>
  );
}

/* ========================================================================== */

function DetalheCompra({ id, onVoltar }: { id: string; onVoltar: () => void }) {
  const qc = useQueryClient();
  const detalhe = useQuery({ queryKey: ["minha-compra", id], queryFn: () => minhaCompra({ data: { id } }) });

  const confirmar = useMutation({
    mutationFn: () => marcarCompraRecebida({ data: { id, avaliacao: "positive" } }),
    onSuccess: () => {
      toast.success("Recebimento confirmado no Mercado Livre.");
      void qc.invalidateQueries({ queryKey: ["minha-compra", id] });
      void qc.invalidateQueries({ queryKey: ["minhas-compras"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Layout>
      <section className="card-panel mx-auto mt-6 max-w-4xl p-5 sm:p-7">
        <button onClick={onVoltar} className="flex items-center gap-1 text-sm font-bold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Voltar às compras
        </button>

        {detalhe.isLoading && (
          <div className="flex justify-center py-10">
            <LoaderCircle className="h-7 w-7 animate-spin text-primary" />
          </div>
        )}

        {detalhe.error && (
          <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            {(detalhe.error as Error).message}
          </p>
        )}

        {detalhe.data && (
          <>
            {detalhe.data.avisoAoVivo && (
              <p className="mt-4 rounded-md bg-primary/10 p-3 text-xs">{detalhe.data.avisoAoVivo}</p>
            )}

            <h1 className="mt-4 font-display text-xl font-bold">Pedido {detalhe.data.compra.pedidoML}</h1>
            <p className="text-sm text-muted-foreground">
              {detalhe.data.compra.statusTexto} · {dataHora(detalhe.data.compra.data)}
              {detalhe.data.compra.vendedor ? ` · Vendedor: ${detalhe.data.compra.vendedor}` : ""}
            </p>

            {/* Itens */}
            <h2 className="mt-6 font-display text-base font-bold">Itens</h2>
            <div className="mt-2 space-y-2">
              {detalhe.data.itens.length === 0 && <p className="text-sm text-muted-foreground">Sem itens informados.</p>}
              {detalhe.data.itens.map((i, idx) => (
                <div key={`${i.id ?? idx}`} className="rounded-lg border border-border p-3 text-sm">
                  <p className="font-bold">{i.titulo ?? "Item"}</p>
                  <p className="text-muted-foreground">
                    {i.quantidade ?? 1} × {dinheiro(i.precoUnitario, i.moeda)}
                    {i.variacao ? ` · ${i.variacao}` : ""}
                  </p>
                </div>
              ))}
              <p className="text-right text-sm font-bold">
                Total: {dinheiro(detalhe.data.compra.valor, detalhe.data.compra.moeda)}
              </p>
            </div>

            {/* Pagamentos */}
            {detalhe.data.pagamentos.length > 0 && (
              <>
                <h2 className="mt-6 font-display text-base font-bold">Pagamento</h2>
                <div className="mt-2 space-y-2">
                  {detalhe.data.pagamentos.map((p) => (
                    <div key={p.id} className="rounded-lg border border-border p-3 text-sm">
                      <p>
                        {p.metodo ?? "—"} · {p.statusTexto} · {dinheiro(p.valor, detalhe.data!.compra.moeda)}
                        {p.parcelas && p.parcelas > 1 ? ` em ${p.parcelas}x` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">{dataHora(p.data)}</p>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Envio */}
            <h2 className="mt-6 flex items-center gap-2 font-display text-base font-bold">
              <Truck className="h-4 w-4 text-primary" /> Envio
            </h2>
            {!detalhe.data.envio ? (
              <p className="mt-2 text-sm text-muted-foreground">Esta compra não tem envio associado.</p>
            ) : (
              <div className="mt-2 rounded-lg border border-border p-3 text-sm">
                <p className="font-bold">{detalhe.data.envio.statusTexto}</p>
                <p className="text-muted-foreground">
                  {detalhe.data.envio.rastreio ? `Rastreio: ${detalhe.data.envio.rastreio}` : "Sem código de rastreio"}
                  {detalhe.data.envio.transportadora ? ` · ${detalhe.data.envio.transportadora}` : ""}
                </p>
                <p className="text-muted-foreground">
                  {[detalhe.data.envio.endereco, detalhe.data.envio.cidade, detalhe.data.envio.estado]
                    .filter(Boolean)
                    .join(" · ") || "Endereço não informado"}
                  {detalhe.data.envio.cep ? ` · CEP ${detalhe.data.envio.cep}` : ""}
                </p>
                {detalhe.data.envio.previsao && (
                  <p className="text-muted-foreground">Previsão: {dataHora(detalhe.data.envio.previsao)}</p>
                )}
              </div>
            )}

            {/* Linha do tempo */}
            {detalhe.data.eventos.length > 0 && (
              <>
                <h2 className="mt-6 font-display text-base font-bold">Rastreamento</h2>
                <ol className="mt-2 space-y-2 border-l-2 border-border pl-4">
                  {detalhe.data.eventos.map((e, idx) => (
                    <li key={idx} className="relative text-sm">
                      <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                      <p className="font-bold">{e.status}</p>
                      {e.descricao && <p className="text-muted-foreground">{e.descricao}</p>}
                      <p className="text-xs text-muted-foreground">{dataHora(e.data)}</p>
                    </li>
                  ))}
                </ol>
              </>
            )}

            {/* Ação real na API do Mercado Livre */}
            <div className="mt-6 border-t border-border pt-5">
              {detalhe.data.compra.recebimentoConfirmado ? (
                <p className="flex items-center gap-2 text-sm font-bold text-success">
                  <CheckCircle2 className="h-4 w-4" /> Você já confirmou o recebimento desta compra.
                </p>
              ) : detalhe.data.podeMarcarRecebido ? (
                <>
                  <button
                    onClick={() => {
                      if (!confirm("Confirmar o recebimento desta compra no Mercado Livre? Esta ação é única e não pode ser desfeita.")) return;
                      confirmar.mutate();
                    }}
                    disabled={confirmar.isPending}
                    className="inline-flex items-center gap-2 rounded-md bg-success px-5 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                  >
                    {confirmar.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Marcar como recebido
                  </button>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Envia o feedback de compra ao Mercado Livre. A ação é única e irreversível.
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  O Mercado Livre não permite confirmar o recebimento no status atual desta compra.
                </p>
              )}
            </div>
          </>
        )}
      </section>
    </Layout>
  );
}
