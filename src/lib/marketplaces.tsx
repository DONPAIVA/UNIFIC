import React from "react";

export type MarketplaceId =
  | "unific"
  | "mercado_livre"
  | "shopee"
  | "amazon"
  | "olx"
  | "magalu";

export type Marketplace = {
  id: MarketplaceId;
  name: string;
  carrier: string;
  logo: React.ReactNode;
};

const UnificMark = () => (
  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-navy font-display text-lg font-bold text-navy-foreground">
    U
  </span>
);

const ShopeeMark = () => (
  <svg
    viewBox="0 0 24 24"
    className="h-8 w-8"
    aria-hidden="true"
  >
    <path
      d="M4 8h16l-1.2 12.5a1.5 1.5 0 0 1-1.5 1.4H6.7a1.5 1.5 0 0 1-1.5-1.4L4 8Z"
      fill="#ee4d2d"
    />
    <path
      d="M8.5 8V6.4a3.5 3.5 0 0 1 7 0V8"
      stroke="#ee4d2d"
      strokeWidth="1.6"
      fill="none"
    />
    <path
      d="M12 11.5c-1.6 0-2.4.7-2.4 1.7 0 2.2 4.4 1.3 4.4 3.5 0 1.1-1 1.8-2.4 1.8-1 0-1.9-.3-2.5-.8"
      stroke="#fff"
      strokeWidth="1.4"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);

const AmazonMark = () => (
  <span className="flex flex-col items-center leading-none">
    <span className="font-display text-base font-bold tracking-tight text-[#232f3e]">
      amazon
    </span>

    <svg
      viewBox="0 0 60 12"
      className="h-2 w-14"
      aria-hidden="true"
    >
      <path
        d="M2 4c14 9 42 9 56 0"
        stroke="#ff9900"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M56 2c3 1.5 3 3.5 2 5"
        stroke="#ff9900"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  </span>
);

const OlxMark = () => (
  <span className="font-display text-xl font-bold tracking-tight">
    <span className="text-[#6e0ad6]">OL</span>
    <span className="text-[#ff8000]">X</span>
  </span>
);

/* =========================================================
   MERCADO LIVRE
   Imagem fornecida:
   https://ibb.co/21hNdyzG
   ========================================================= */

const MercadoLivreMark = () => (
  <span
    className="flex h-9 w-9 shrink-0 items-center justify-center overflow-visible"
    aria-label="Mercado Livre"
  >
    <img
      src="https://i.ibb.co/21hNdyzG/images-3.png"
      alt="Mercado Livre"
      width={36}
      height={36}
      className="block h-9 w-9 shrink-0 object-contain"
      style={{
        width: "36px",
        height: "36px",
        objectFit: "contain",
        display: "block",
      }}
    />
  </span>
);

const MagaluMark = () => (
  <span className="flex h-9 items-center rounded-md bg-[#0086ff] px-2 font-display text-sm font-bold tracking-tight text-white">
    magalu
  </span>
);

// Mercado Livre primeiro: é de onde vem a maior parte dos rastreios, e a
// ordem da lista é a ordem em que os cartões aparecem na tela.
export const MARKETPLACES: Marketplace[] = [
  {
    id: "mercado_livre",
    name: "M. Livre",
    carrier: "Mercado Envios",
    logo: <MercadoLivreMark />,
  },
  {
    id: "unific",
    name: "Únific+",
    carrier: "Únific+ Log",
    logo: <UnificMark />,
  },
  {
    id: "shopee",
    name: "Shopee",
    carrier: "Shopee Xpress",
    logo: <ShopeeMark />,
  },
  {
    id: "amazon",
    name: "Amazon",
    carrier: "Amazon Logistics",
    logo: <AmazonMark />,
  },
  {
    id: "olx",
    name: "OLX",
    carrier: "OLX Entregas",
    logo: <OlxMark />,
  },
  {
    id: "magalu",
    name: "Magalu",
    carrier: "Magalu Entregas",
    logo: <MagaluMark />,
  },
];

/**
 * Marketplace pelo id, com o Únific+ como reserva.
 *
 * A reserva é buscada por id, não por posição: antes era `MARKETPLACES[0]`, e
 * assim qualquer mudança na ordem dos cartões trocava, sem querer, o rótulo
 * exibido para pedido com marketplace desconhecido ou vazio.
 */
export const getMarketplace = (id: string): Marketplace =>
  MARKETPLACES.find((m) => m.id === id) ??
  MARKETPLACES.find((m) => m.id === "unific") ??
  MARKETPLACES[0]!;