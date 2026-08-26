import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ShieldOff } from "lucide-react";

import { Header } from "./Header";
import { Footer, HelpBand } from "./Sections";
import { Mascot } from "./Mascot";
import { meuAcesso } from "@/lib/perfil.functions";
import { supabase } from "@/integrations/supabase/client";

/**
 * Tela única de quem teve o acesso suspenso.
 *
 * Substitui o site INTEIRO — sem cabeçalho, sem rastreio, sem rodapé. Se
 * sobrasse qualquer parte navegável, o bloqueio viraria só um aviso.
 *
 * O botão de sair existe de propósito: sem ele a pessoa fica presa nesta tela
 * mesmo querendo entrar com outra conta.
 */
function ContaBloqueada({ motivo }: { motivo: string | null }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-navy px-6 text-center">
      <ShieldOff className="h-12 w-12 text-white/70" />
      <h1 className="mt-5 font-display text-2xl font-bold text-white">Acesso suspenso</h1>
      <p className="mt-2 max-w-md text-sm text-white/70">
        Esta conta não está mais autorizada a usar o Únific+.
      </p>
      {motivo && <p className="mt-3 max-w-md text-sm text-white/85">Motivo: {motivo}</p>}
      <p className="mt-4 max-w-md text-xs text-white/50">
        Se você acredita que houve um engano, entre em contato com o suporte.
      </p>
      <button
        onClick={() => {
          void supabase.auth.signOut().then(() => window.location.assign("/"));
        }}
        className="mt-6 rounded-lg border border-white/25 px-4 py-2 text-sm font-bold text-white"
      >
        Sair desta conta
      </button>
    </div>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  /*
   * O bloqueio é decidido no SERVIDOR e apenas relatado aqui.
   *
   * Esta consulta serve só para trocar a tela. Mesmo que alguém a contorne no
   * navegador, cada server function verifica de novo pelo middleware — não dá
   * para "desbloquear" mexendo no front.
   *
   * `staleTime` curto: quando o administrador libera o acesso, a pessoa volta a
   * navegar sem precisar recarregar tudo.
   */
  const acesso = useQuery({
    queryKey: ["meu-acesso"],
    queryFn: () => meuAcesso(),
    staleTime: 30_000,
    retry: false,
  });

  if (acesso.data?.bloqueado) {
    return <ContaBloqueada motivo={acesso.data.motivo ?? null} />;
  }

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
