import { fmtDate, money, type Pedido } from "@/lib/tracking";
import { getMarketplace } from "@/lib/marketplaces";
import { Printer } from "lucide-react";

function digits(seed: string, len: number) {
  let out = "";
  for (let i = 0; i < len; i++) out += ((seed.charCodeAt(i % seed.length) * (i + 7)) % 10).toString();
  return out;
}

export function NotaFiscal({ pedido }: { pedido: Pedido }) {
  const nfe = pedido.invoice_number ?? digits(pedido.tracking_code, 9);
  const chave = digits(pedido.tracking_code + "chave", 44).replace(/(\d{4})(?=\d)/g, "$1 ");
  const valor = pedido.product_value ?? 0;
  const icms = valor * 0.12;
  const ipi = valor * 0.065;
  const mk = getMarketplace(pedido.marketplace);

  return (
    <div className="space-y-3">
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
      >
        <Printer className="h-4 w-4" /> Imprimir / Salvar PDF
      </button>

      <div id="print-area" className="rounded-md border border-border bg-white p-4 text-[11px] leading-tight text-black">
        <div className="flex items-start justify-between border-b border-black/40 pb-2">
          <div>
            <p className="font-display text-sm font-bold">ÚNIFIC+ COMÉRCIO DE MOTORES E NÁUTICA LTDA</p>
            <p>Av. Marginal Tietê, 4.520 — Vila Leopoldina — São Paulo / SP — CEP 05318-000</p>
            <p>CNPJ: 41.887.320/0001-64 — IE: 116.482.771.114 — Fone: (11) 4002-8922</p>
          </div>
          <div className="text-right">
            <p className="font-bold">DANFE</p>
            <p>Documento Auxiliar da NF-e</p>
            <p>1 - SAÍDA</p>
            <p className="font-bold">Nº {nfe} — SÉRIE {pedido.invoice_series ?? "001"}</p>
          </div>
        </div>

        <div className="border-b border-black/40 py-2">
          <p className="font-bold">CHAVE DE ACESSO</p>
          <p className="font-mono">{chave.trim()}</p>
          <p>Consulta de autenticidade no portal nacional da NF-e — www.nfe.fazenda.gov.br/portal</p>
          <p>Protocolo de autorização: 135{digits(pedido.tracking_code, 12)} — {fmtDate(pedido.ship_date)}</p>
        </div>

        <div className="grid grid-cols-2 gap-2 border-b border-black/40 py-2">
          <div>
            <p className="font-bold">DESTINATÁRIO / REMETENTE</p>
            <p>{pedido.recipient}</p>
            <p>CPF: {pedido.cpf ?? "—"}</p>
            <p>{pedido.dest_address ?? "—"}</p>
            <p>{pedido.dest_city} / {pedido.dest_state} — CEP {pedido.dest_cep ?? "—"}</p>
          </div>
          <div>
            <p className="font-bold">DADOS DO TRANSPORTE</p>
            <p>Transportadora: {mk.carrier}</p>
            <p>Modalidade do frete: 0 - Por conta do emitente (CIF)</p>
            <p>Código de rastreio: {pedido.tracking_code}</p>
            <p>Peso bruto: {pedido.weight ?? 0} kg — Volumes: 1</p>
          </div>
        </div>

        <table className="w-full border-collapse py-2 text-[10px]">
          <thead>
            <tr className="border-b border-black/40 text-left">
              <th className="py-1">CÓD.</th>
              <th>DESCRIÇÃO DO PRODUTO / SERVIÇO</th>
              <th>NCM</th>
              <th>CFOP</th>
              <th>UN</th>
              <th>QTD</th>
              <th>VL. UNIT.</th>
              <th>VL. TOTAL</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-black/20">
              <td className="py-1">{digits(pedido.tracking_code, 5)}</td>
              <td>{pedido.product ?? "Motor de Popa 15HP 2 Tempos — Náutica"}</td>
              <td>8407.21.00</td>
              <td>5102</td>
              <td>UN</td>
              <td>1</td>
              <td>{money(valor)}</td>
              <td>{money(valor)}</td>
            </tr>
          </tbody>
        </table>

        <div className="grid grid-cols-4 gap-2 border-t border-black/40 pt-2">
          <div><p className="font-bold">BASE ICMS</p><p>{money(valor)}</p></div>
          <div><p className="font-bold">VALOR ICMS (12%)</p><p>{money(icms)}</p></div>
          <div><p className="font-bold">VALOR IPI (6,5%)</p><p>{money(ipi)}</p></div>
          <div><p className="font-bold">VALOR TOTAL DA NOTA</p><p className="font-bold">{money(valor)}</p></div>
        </div>

        <div className="mt-2 border-t border-black/40 pt-2">
          <p className="font-bold">INFORMAÇÕES COMPLEMENTARES</p>
          <p>
            Produto com garantia de 12 meses contra defeitos de fabricação. Documento emitido eletronicamente conforme
            legislação vigente. Prazo de entrega contratado: 15 dias corridos a partir de {fmtDate(pedido.ship_date)}.
          </p>
        </div>
      </div>
    </div>
  );
}
