import { createFileRoute } from "@tanstack/react-router";

/**
 * Callback OAuth do Mercado Livre.
 * A rota é fixa (/api/public/ml/callback) mas o DOMÍNIO vem de ML_REDIRECT_URI/APP_URL —
 * trocar de domínio exige apenas alterar a variável de ambiente e cadastrar a mesma
 * Redirect URI no aplicativo do Mercado Livre.
 */
export const Route = createFileRoute("/api/public/ml/callback")({
  server: {
    handlers: {
      GET: async (ctx) => {
        /*
         * Blindagem do retorno do Mercado Livre.
         *
         * Esta rota é o caminho de VOLTA do cliente. Qualquer erro solto aqui
         * derruba o visitante na tela de falha do aplicativo ("Try again / Go
         * home", sobre o fundo azul) — no meio de uma autorização, sem
         * explicação e sem saber se a conta conectou.
         *
         * Então nada escapa: falha inesperada vira um redirect para a home com
         * a mensagem, e o motivo real fica no log do servidor para diagnóstico.
         */
        try {
          return await tratarCallback(ctx.request);
        } catch (e) {
          const motivo = e instanceof Error ? e.message : String(e);
          console.error("[ml/callback] erro nao tratado", motivo);
          try {
            const { logEvent } = await import("@/lib/server/logs.server");
            await logEvent({
              category: "oauth",
              action: "oauth.callback.erro_inesperado",
              endpoint: "/api/public/ml/callback",
              method: "GET",
              success: false,
              error: motivo,
            });
          } catch {
            /* nem o log pode impedir o cliente de voltar para o site */
          }
          return new Response(null, {
            status: 302,
            headers: {
              Location: `/?ml=erro&msg=${encodeURIComponent(
                "Não foi possível concluir a autorização. Tente novamente.",
              )}`,
            },
          });
        }
      },
    },
  },
});

async function tratarCallback(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const err = url.searchParams.get("error");

        const back = (msg: string, ok = false) =>
          new Response(null, {
            status: 302,
            headers: { Location: `/?ml=${ok ? "ok" : "erro"}&msg=${encodeURIComponent(msg)}` },
          });

        const { logEvent: logCallback } = await import("@/lib/server/logs.server");

        // Estes dois casos precisam aparecer no log: são a diferença entre
        // "o cliente recusou" e "o Mercado Livre devolveu algo inesperado".
        if (err) {
          await logCallback({
            category: "oauth",
            action: "oauth.callback.recusado",
            endpoint: "/api/public/ml/callback",
            method: "GET",
            actor: "cliente",
            success: false,
            error: `Mercado Livre retornou error=${err}`,
            detail: { error_description: url.searchParams.get("error_description") },
          });
          return back("Autorização não concluída no Mercado Livre.");
        }
        if (!code || !state) {
          await logCallback({
            category: "oauth",
            action: "oauth.callback.retorno_invalido",
            endpoint: "/api/public/ml/callback",
            method: "GET",
            actor: "cliente",
            success: false,
            error: "Callback sem code e/ou state.",
            detail: { tem_code: Boolean(code), tem_state: Boolean(state) },
          });
          return back("Retorno inválido do Mercado Livre.");
        }

        await logCallback({
          category: "oauth",
          action: "oauth.callback.recebido",
          endpoint: "/api/public/ml/callback",
          method: "GET",
          actor: "cliente",
          message: "Callback do Mercado Livre chegou na aplicação.",
        });

        const { db } = await import("@/lib/server/db.server");
        const { getMlCredentials, getMlRedirectUri } = await import("@/lib/server/config.server");
        const { ML_API } = await import("@/lib/server/ml-api.server");
        const { logAudit } = await import("@/lib/server/audit.server");

        let clientId: string;
        let clientSecret: string;
        let redirectUri: string;
        try {
          ({ clientId, clientSecret } = getMlCredentials());
          redirectUri = getMlRedirectUri();
        } catch {
          return back("Integração do Mercado Livre não configurada.");
        }

        const { logEvent } = await import("@/lib/server/logs.server");

        // State de uso ÚNICO, com expiração.
        // O DELETE ... .select() é atômico no Postgres: se duas requisições
        // chegarem com o mesmo state, só uma recebe a linha de volta —
        // é isso que impede o replay do authorization code.
        const { data: consumed } = await db("ml_oauth_states")
          .delete()
          .eq("state", state)
          .select("state, code_verifier, owner_user_id, redirect_uri, expires_at");

        const st = Array.isArray(consumed) ? consumed[0] : consumed;
        if (!st) {
          await logEvent({
            category: "oauth",
            action: "oauth.state_invalido",
            success: false,
            error: "State desconhecido, já utilizado ou expirado (possível replay).",
          });
          return back("Sessão de autorização inválida. Tente novamente.");
        }
        if (st.expires_at && new Date(st.expires_at).getTime() < Date.now()) {
          await logEvent({
            category: "oauth",
            action: "oauth.state_expirado",
            success: false,
            error: "State expirado.",
          });
          return back("Sessão de autorização expirada. Tente novamente.");
        }

        const body = new URLSearchParams({
          grant_type: "authorization_code",
          client_id: clientId,
          client_secret: clientSecret,
          code,
          // precisa ser idêntica à enviada na autorização
          redirect_uri: st.redirect_uri || redirectUri,
        });
        if (st.code_verifier) body.set("code_verifier", st.code_verifier);

        const tokenRes = await fetch(`${ML_API}/oauth/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body,
        });

        if (!tokenRes.ok) {
          // Nunca devolvemos o corpo bruto ao navegador (pode conter detalhes sensíveis).
          const detail = await tokenRes.text().catch(() => "");
          console.error("[ml/callback] token exchange falhou", tokenRes.status, detail.slice(0, 300));
          await logAudit({
            action: "ml.oauth.token_exchange",
            entity: "ml_connections",
            success: false,
            detail: { status: tokenRes.status },
          });
          return back("Não foi possível concluir a autorização no Mercado Livre.");
        }

        const tok = (await tokenRes.json()) as {
          access_token: string;
          refresh_token?: string;
          expires_in?: number;
          scope?: string;
          user_id?: number | string;
        };

        // Validação da conta pelo /users/me
        let me: { id?: number | string; nickname?: string; email?: string; site_id?: string; first_name?: string } = {};
        try {
          const meRes = await fetch(`${ML_API}/users/me`, {
            headers: { Authorization: `Bearer ${tok.access_token}`, Accept: "application/json" },
          });
          if (meRes.ok) me = (await meRes.json()) as typeof me;
        } catch {
          me = {};
        }

        const mlUserId = String(me.id ?? tok.user_id ?? "");
        if (!mlUserId) return back("Não foi possível identificar a conta do Mercado Livre.");

        /*
         * Quem é o dono desta conexão?
         *
         * Fluxo logado: o dono veio no STATE, gravado com a sessão validada no
         * servidor. Sem dono ali é sessão perdida — continua recusado, porque
         * criar conexão órfã quebraria o isolamento entre clientes.
         *
         * Fluxo público (state com prefixo "pub-"): o visitante entrou pelo
         * Mercado Livre, sem cadastro. Aqui o dono é criado a partir da própria
         * conta que acabou de autorizar.
         */
        const { PREFIXO_STATE_PUBLICO } = await import("@/lib/ml-oauth");
        const fluxoPublico = String(st.state ?? state).startsWith(PREFIXO_STATE_PUBLICO);

        let ownerUserId = st.owner_user_id ? String(st.owner_user_id) : null;
        let entrarComo: string | null = null;

        if (!ownerUserId && fluxoPublico) {
          const { garantirClientePorContaMl } = await import("@/lib/server/entrar-com-ml.server");
          const r = await garantirClientePorContaMl({
            mlUserId,
            email: me.email ?? null,
            nickname: me.nickname ?? null,
            firstName: me.first_name ?? null,
          });
          if (!r.ok) {
            await logEvent({
              category: "oauth",
              action: "oauth.entrar_com_ml_falhou",
              success: false,
              error: r.erro,
              detail: { ml_user_id: mlUserId },
            });
            return back(r.erro);
          }
          ownerUserId = r.userId;
          entrarComo = r.email;
        }

        if (!ownerUserId) {
          await logEvent({
            category: "oauth",
            action: "oauth.sem_dono",
            success: false,
            error: "State sem owner_user_id.",
            detail: { ml_user_id: mlUserId },
          });
          return back("Sessão expirada. Entre na sua conta e conecte novamente.");
        }

        // Uma conta do Mercado Livre pertence a UM cliente. Se este ml_user_id
        // já está vinculado a outro usuário, não transferimos silenciosamente:
        // seria sequestro de conta (o cliente B passaria a ver os pedidos do A).
        const { data: existente } = await db("ml_connections")
          .select("id, owner_user_id")
          .eq("provider", "mercado_livre")
          .eq("ml_user_id", mlUserId)
          .maybeSingle();

        if (existente && existente.owner_user_id && String(existente.owner_user_id) !== ownerUserId) {
          await logEvent({
            category: "oauth",
            action: "oauth.conta_de_outro_cliente",
            mlUserId,
            success: false,
            error: "ml_user_id já vinculado a outro usuário do Unific+.",
          });
          return back("Esta conta do Mercado Livre já está conectada em outro cadastro do Unific+.");
        }

        const { data: saved, error: saveError } = await db("ml_connections")
          .upsert(
            {
              provider: "mercado_livre",
              ml_user_id: mlUserId,
              nickname: me.nickname ?? null,
              email: me.email ?? null,
              first_name: me.first_name ?? null,
              site_id: me.site_id ?? null,
              owner_user_id: ownerUserId,
              access_token: tok.access_token,
              refresh_token: tok.refresh_token ?? null,
              scope: tok.scope ?? null,
              status: "active",
              last_error: null,
              reauth_required_at: null,
              last_activity_at: new Date().toISOString(),
              expires_at: new Date(Date.now() + (tok.expires_in ?? 21600) * 1000).toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "provider,ml_user_id" },
          )
          .select("id")
          .maybeSingle();

        if (saveError) {
          console.error("[ml/callback] falha ao salvar conexão", saveError.message);
          return back("Conta autorizada, mas houve falha ao salvar. Tente novamente.");
        }

        await logAudit({
          action: "ml.oauth.connected",
          entity: "ml_connections",
          entityId: saved?.id ?? null,
          accountId: saved?.id ?? null,
          detail: { ml_user_id: mlUserId, nickname: me.nickname ?? null },
        });

        await logEvent({
          category: "oauth",
          action: "oauth.conta_conectada",
          accountId: saved?.id ?? null,
          mlUserId,
          endpoint: "/api/public/ml/callback",
          method: "GET",
          actor: "cliente",
          message: `Conta ${me.nickname ?? mlUserId} autorizou o aplicativo.`,
          detail: { site_id: me.site_id ?? null, scope: tok.scope ?? null },
        });

        // Sincronização inicial em background — não bloqueia o redirect do cliente.
        if (saved?.id) {
          const { syncAccount } = await import("@/lib/server/ml-sync.server");
          void syncAccount(saved.id, { kind: "initial", trigger: "oauth", full: true }).catch((e) =>
            console.error("[ml/callback] sync inicial", e instanceof Error ? e.message : e),
          );
        }

        /*
         * Fluxo público: além de conectar, precisa DEIXAR A PESSOA LOGADA.
         *
         * O link de acesso é gerado no servidor (service_role) e usado uma vez
         * só, na hora — nada é enviado por e-mail e nenhuma senha trafega. Se
         * a geração falhar, a conexão já está salva: mandamos para a tela de
         * entrada em vez de perder o trabalho.
         */
        if (fluxoPublico && entrarComo) {
          const { linkDeEntrada } = await import("@/lib/server/entrar-com-ml.server");
          const destino = await linkDeEntrada(entrarComo, url.origin);
          if (destino) {
            await logEvent({
              category: "oauth",
              action: "oauth.entrou_com_ml",
              accountId: saved?.id ?? null,
              mlUserId,
              actor: entrarComo,
              message: `Visitante entrou pelo Mercado Livre como ${me.nickname ?? mlUserId}.`,
            });
            return new Response(null, { status: 302, headers: { Location: destino } });
          }
          return new Response(null, {
            status: 302,
            headers: {
              Location: `/entrar?msg=${encodeURIComponent(
                "Sua conta do Mercado Livre foi conectada. Entre para ver seus pedidos.",
              )}`,
            },
          });
        }

        return back("Conta do Mercado Livre conectada!", true);
}
