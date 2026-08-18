import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * Sessão do cliente no navegador.
 *
 * Serve APENAS para a interface saber o que mostrar (entrar/sair, nome).
 * Nenhuma decisão de autorização acontece aqui: toda função do servidor
 * revalida o token por conta própria (src/lib/server/auth.server.ts).
 */
export function useSessao() {
  const [sessao, setSessao] = useState<Session | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    let vivo = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      setSessao(data.session ?? null);
      setCarregando(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evento, s) => {
      if (!vivo) return;
      setSessao(s);
      setCarregando(false);
    });

    return () => {
      vivo = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const sair = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return {
    sessao,
    carregando,
    autenticado: Boolean(sessao),
    email: sessao?.user?.email ?? null,
    sair,
  };
}
