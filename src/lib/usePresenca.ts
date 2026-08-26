import { useEffect } from "react";
import { registrarPresenca } from "./monitor.functions";

/**
 * Avisa o servidor, a cada 30 s, que esta aba continua aberta.
 *
 * O identificador fica em `sessionStorage`, não em `localStorage`: cada ABA
 * precisa contar como uma presença. Com localStorage, duas abas da mesma
 * pessoa dividiriam o id e uma apagaria a outra da lista.
 *
 * Falha de rede é ignorada de propósito — monitoramento nunca pode atrapalhar
 * quem está usando o site.
 */
const CHAVE = "unific:sessao-presenca";
const INTERVALO_MS = 30_000;

function idDaAba(): string {
  try {
    const guardado = sessionStorage.getItem(CHAVE);
    if (guardado) return guardado;
    const novo = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(CHAVE, novo);
    return novo;
  } catch {
    // Navegador com armazenamento bloqueado: id só para esta carga de página.
    return `efemero-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function usePresenca() {
  useEffect(() => {
    const sessaoId = idDaAba();

    const bater = () => {
      // Aba em segundo plano não conta como alguém "no site agora".
      if (document.visibilityState === "hidden") return;
      void registrarPresenca({
        data: { sessaoId, pagina: window.location.pathname },
      }).catch(() => {});
    };

    bater();
    const timer = setInterval(bater, INTERVALO_MS);
    document.addEventListener("visibilitychange", bater);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", bater);
    };
  }, []);
}
