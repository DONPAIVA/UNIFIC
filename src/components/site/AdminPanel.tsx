import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, MapPin, Plus, Save, Trash2, X } from "lucide-react";
import { deletePedido, listPedidos, listTable, savePedido } from "@/lib/api";
import { lookupCep, maskCep, onlyDigits, type CepInfo } from "@/lib/cep";
import { MARKETPLACES } from "@/lib/marketplaces";
import { fmtDate, money, progressOf, statusFor, type Pedido } from "@/lib/tracking";

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

const ADMIN_PASS = "unific2026";
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
};

type Form = typeof empty & { id?: string };

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [authed, setAuthed] = useState(() =>
    typeof window !== "undefined" ? sessionStorage.getItem("unific_admin") === "1" : false,
  );
  const [pass, setPass] = useState("");
  const [tab, setTab] = useState<"pedidos" | "nf" | "reclamacoes" | "cotacoes">("pedidos");

  if (!authed) {
    return (
      <Shell onClose={onClose} title="Painel Oculto — Acesso Restrito">
        <div className="mx-auto max-w-sm space-y-3 py-6">
          <p className="text-sm text-muted-foreground">Digite a senha do painel administrativo.</p>
          <input
            type="password"
            autoFocus
            value={pass}
            onChange={(e) => setPass(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              if (pass === ADMIN_PASS) {
                sessionStorage.setItem("unific_admin", "1");
                setAuthed(true);
              } else toast.error("Senha incorreta");
            }}
            placeholder="Senha"
            className="w-full rounded-md border border-input bg-white px-3 py-2 text-sm text-card-foreground"
          />
          <button
            onClick={() => {
              if (pass === ADMIN_PASS) {
                sessionStorage.setItem("unific_admin", "1");
                setAuthed(true);
              } else toast.error("Senha incorreta");
            }}
            className="w-full rounded-md bg-primary py-2 text-sm font-bold text-primary-foreground"
          >
            Entrar
          </button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell onClose={onClose} title="Painel Únific+ — Administração">
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
  const { data: pedidos, isLoading } = useQuery({ queryKey: ["pedidos"], queryFn: listPedidos });
  const [form, setForm] = useState<Form | null>(null);

  const save = useMutation({
    mutationFn: async (f: Form) => {
      if (!f.tracking_code.trim() || !f.recipient.trim() || !f.dest_city.trim()) {
        throw new Error("Código, destinatário e cidade de destino são obrigatórios.");
      }
      const payload: Record<string, unknown> = {
        ...f,
        delivery_date: f.delivery_date || null,
        // Campo vazio devolve o pedido ao calculo automatico.
        progresso_manual:
          f.progresso_manual === null || String(f.progresso_manual) === "" ? null : Number(f.progresso_manual),
        // Nulo, e nao string vazia: o banco so aceita HH:MM ou nada.
        hora_coleta: f.hora_coleta ? String(f.hora_coleta).slice(0, 5) : null,
      };
      await savePedido(payload as Partial<Pedido> & { tracking_code: string });
    },
    onSuccess: () => {
      toast.success("Pedido salvo e sincronizado com o site!");
      setForm(null);
      void qc.invalidateQueries({ queryKey: ["pedidos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: deletePedido,
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
            {field("tracking_code", "Código de rastreio *")}
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
                        dest_address: [info.street, info.district].filter(Boolean).join(" - ") || f.dest_address,
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
          </div>

          <ControleDeProgresso
            valor={form.progresso_manual}
            onChange={(v) => setForm({ ...form, progresso_manual: v })}
            pausado={Boolean(form.pausado)}
            onPausar={(v) => setForm({ ...form, pausado: v })}
            pedido={form}
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
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-muted">
              <tr>
                <th className="p-2">Código</th>
                <th className="p-2">Marketplace</th>
                <th className="p-2">Destinatário</th>
                <th className="p-2">Destino</th>
                <th className="p-2">Envio</th>
                <th className="p-2">Status</th>
                <th className="p-2">Progresso</th>
                <th className="p-2">Valor</th>
                <th className="p-2" />
              </tr>
            </thead>
            <tbody>
              {(pedidos ?? []).map((p) => (
                <tr key={p.id} className="border-b border-border">
                  <td className="p-2 font-bold">{p.tracking_code}</td>
                  <td className="p-2">{MARKETPLACES.find((m) => m.id === p.marketplace)?.name ?? p.marketplace}</td>
                  <td className="p-2">{p.recipient}</td>
                  <td className="p-2">{p.dest_city}/{p.dest_state}</td>
                  <td className="p-2">{fmtDate(p.ship_date)}</td>
                  <td className="p-2">{statusFor(p)}</td>
                  <td className="p-2">{progressOf(p).toFixed(0)}%</td>
                  <td className="p-2">{money(p.product_value)}</td>
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
                            delivery_date: p.delivery_date ?? "",
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
                  <td colSpan={9} className="p-4 text-center text-muted-foreground">Nenhum pedido cadastrado ainda.</td>
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
  const { data, isLoading } = useQuery({ queryKey: [table], queryFn: () => listTable(table) });
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
          {rows.map((r, i) => (
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
