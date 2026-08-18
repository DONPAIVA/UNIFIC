// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
//
// IMPORTANTE: este defineConfig precisa receber um OBJETO com as chaves
// { vite, tanstackStart, ... }. Se receber uma FUNÇÃO, o wrapper a trata como
// config crua do Vite e descarta silenciosamente `vite` e `tanstackStart`.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

/**
 * Hosts públicos aceitos pelo dev server.
 *
 * O OAuth do Mercado Livre volta por um endereço PÚBLICO (túnel ou domínio
 * próprio), nunca por localhost. Sem liberar esse host aqui, o Vite responde
 * "403 Blocked request. This host is not allowed" — o callback não executa e o
 * `authorization code` se perde sem deixar rastro na aplicação.
 *
 * A lista sai do próprio .env: ao migrar de domínio basta trocar
 * APP_URL / ML_REDIRECT_URI, sem editar este arquivo.
 */
function resolveAllowedHosts(): string[] {
  const cwd = process.cwd();
  // prefixo "" => carrega TODAS as variáveis do .env, não apenas as VITE_*
  const env: Record<string, string | undefined> = {
    ...loadEnv("production", cwd, ""),
    ...loadEnv("development", cwd, ""),
    ...process.env,
  };

  const hosts = new Set<string>(["localhost", "127.0.0.1"]);

  for (const key of ["APP_URL", "ML_REDIRECT_URI", "PUBLIC_HOST"]) {
    const raw = (env[key] ?? "").trim().replace(/^"|"$/g, "");
    if (!raw) continue;
    try {
      hosts.add(new URL(raw).hostname);
    } catch {
      // valor sem protocolo: trata como hostname puro
      if (/^[a-z0-9.-]+$/i.test(raw)) hosts.add(raw);
    }
  }

  // Sufixos de túnel de desenvolvimento. O ponto inicial faz o Vite aceitar
  // qualquer subdomínio, então trocar de túnel não exige editar nada.
  for (const suffix of [
    ".ngrok-free.dev",
    ".ngrok-free.app",
    ".ngrok.app",
    ".ngrok.io",
    ".trycloudflare.com",
    ".loca.lt",
    ".lovableproject.com",
    ".lovable.app",
  ]) {
    hosts.add(suffix);
  }

  return [...hosts];
}

const allowedHosts = resolveAllowedHosts();

export default defineConfig({
  vite: {
    server: {
      // Porta fixa: strictPort impede o Vite de pular para 8081/8082.
      port: 8080,
      strictPort: true,
      allowedHosts,
    },
    preview: {
      port: 8080,
      strictPort: true,
      allowedHosts,
    },
  },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
