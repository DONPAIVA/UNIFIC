import type { ReactNode } from "react";
import { Header } from "./Header";
import { Footer, HelpBand } from "./Sections";
import { Mascot } from "./Mascot";

export function Layout({ children }: { children: ReactNode }) {
  return (
    // Azul da marca, sólido — o mesmo do cabeçalho e do rodapé. Antes era
    // translúcido para deixar o fundo Matrix aparecer; o Matrix agora é
    // exclusivo do painel (/centralml).
    <div className="flex min-h-screen flex-col bg-navy">
      <Header />
      <main className="flex-1 pb-8">{children}</main>
      <HelpBand />
      <Footer />
      <Mascot />
    </div>
  );
}
