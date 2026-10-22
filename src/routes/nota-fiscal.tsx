import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Info, ShieldCheck } from "lucide-react";
import { Layout } from "@/components/site/Layout";
import { insertTable } from "@/lib/api";
import { rastrearPorCodigo } from "@/lib/rastreio.functions";
import { NotaFiscal } from "@/components/site/NotaFiscal";
import type { Pedido } from "@/lib/tracking";

export const Route = createFileRoute("/nota-fiscal")({
  head: () => ({
    meta: [
      { title: "2ª Via de Nota Fiscal e Garantia | Únific+" },
      { name: "description", content: "Solicite a segunda via da nota fiscal ou acione a garantia do seu produto enviado pela Únific+." },
      { property: "og:title", content: "2ª Via de Nota Fiscal e Garantia | Únific+" },
      { property: "og:description", content: "Emita a segunda via da sua nota fiscal em poucos minutos." },
    ],
  }),
  component: NfPage,
});

const DOCS = ["Selecione...", "2ª Via de Nota Fiscal", "Acionamento de Garantia", "Nota Fiscal + Garantia"];

function NfPage() {
  const [f, setF] = useState({ order_code: "", doc_type: "", full_name: "", cpf: "", phone: "", email: "" });
  const [pedido, setPedido] = useState<Pedido | null>(null);

  const send = useMutation({
    mutationFn: async () => {
      if (!f.order_code.trim() || !f.doc_type || !f.full_name.trim() || f.cpf.replace(/\D/g, "").length !== 11) {
        throw new Error("Preencha código, tipo de documento, nome completo e um CPF válido.");
      }
      await insertTable("solicitacoes_nf", f);
      return (await rastrearPorCodigo({ data: { code: f.order_code } })).pedido as Pedido | null;
    },
    onSuccess: (p) => {
      setPedido(p);
      toast.success(p ? "Solicitação registrada! Sua nota fiscal já está disponível abaixo." : "Solicitação registrada! Análise em até 48h úteis.");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const input = (key: keyof typeof f, label: string, placeholder: string) => (
    <label className="block text-xs font-bold">
      {label} *
      <input
        value={f[key]}
        maxLength={120}
        placeholder={placeholder}
        onChange={(e) => setF({ ...f, [key]: e.target.value })}
        className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm font-normal text-card-foreground"
      />
    </label>
  );

  return (
    <Layout>
      <section className="card-panel mx-auto mt-6 max-w-3xl p-5 sm:p-7">
        <h1 className="flex items-center gap-2 font-display text-xl font-bold">
          <FileText className="h-5 w-5 text-primary" /> Solicitar 2ª Via de Nota Fiscal ou Garantia
        </h1>
        <p className="text-sm text-muted-foreground">Preencha todos os campos e envie os documentos necessários para análise</p>

        <div className="mt-4 space-y-3">
          {input("order_code", "Código do Pedido", "Ex: ML954321")}
          <label className="block text-xs font-bold">
            Tipo de Documento *
            <select
              value={f.doc_type}
              onChange={(e) => setF({ ...f, doc_type: e.target.value })}
              className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm font-normal text-card-foreground"
            >
              {DOCS.map((d) => (
                <option key={d} value={d === "Selecione..." ? "" : d}>{d}</option>
              ))}
            </select>
          </label>
          {input("full_name", "Nome Completo", "Seu nome completo")}
          {input("cpf", "CPF", "000.000.000-00")}
          {input("phone", "Telefone", "(00) 00000-0000")}
          {input("email", "E-mail para Envio", "seu@email.com")}

          <div className="rounded-lg border border-dashed border-border p-3">
            <p className="flex items-center gap-2 text-sm font-bold"><ShieldCheck className="h-4 w-4 text-primary" /> Documentos Necessários</p>
            {["Documento de Identidade (Frente)", "Documento de Identidade (Verso)", "Selfie Segurando o Documento"].map((d) => (
              <div key={d} className="mt-2">
                <p className="text-xs font-semibold">{d} *</p>
                <input type="file" accept="image/*,.pdf" className="mt-1 w-full text-xs" />
                <p className="text-[10px] text-muted-foreground">Formatos aceitos: JPG, PNG, PDF (máx. 5MB)</p>
              </div>
            ))}
          </div>

          <button onClick={() => send.mutate()} disabled={send.isPending} className="w-full rounded-md bg-primary py-2.5 text-sm font-bold text-primary-foreground">
            Enviar Solicitação
          </button>
        </div>
      </section>

      {pedido && (
        <section className="card-panel mx-auto mt-4 max-w-3xl p-5 sm:p-7">
          <h2 className="font-display text-lg font-bold">Nota fiscal do pedido {pedido.tracking_code}</h2>
          <div className="mt-3">
            <NotaFiscal pedido={pedido} />
          </div>
        </section>
      )}

      <section className="card-panel mx-auto mt-4 max-w-3xl p-5 sm:p-7">
        <h2 className="flex items-center gap-2 font-display text-lg font-bold">
          <Info className="h-5 w-5 text-primary" /> Informações Importantes
        </h2>
        <div className="mt-2 space-y-2 text-sm">
          <p><strong>Prazo de Análise:</strong> Sua solicitação será analisada em até 48 horas úteis.</p>
          <p><strong>Documentos Aceitos:</strong> RG, CNH ou outro documento oficial com foto.</p>
          <p><strong>Verificação:</strong> Certifique-se de que o código do pedido está correto e que os documentos estão legíveis.</p>
          <p><strong>Suporte:</strong> Em caso de dúvidas, entre em contato com nosso atendimento.</p>
        </div>
      </section>
    </Layout>
  );
}
