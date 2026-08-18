import type { ReactNode } from "react";
import { Header } from "./Header";
import { Footer, HelpBand } from "./Sections";
import { Mascot } from "./Mascot";

export function Layout({ children }: { children: ReactNode }) {
  return (
    // Fundo translúcido para o Matrix global (montado em __root) aparecer
    // através do layout, sem prejudicar a leitura do conteúdo.
    <div className="flex min-h-screen flex-col bg-navy/70">
      <Header />
      <main className="flex-1 pb-8">{children}</main>
      <HelpBand />
      <Footer />
      <Mascot />
    </div>
  );
}
