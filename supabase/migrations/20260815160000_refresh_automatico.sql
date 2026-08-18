-- ============================================================================
-- RENOVAÇÃO AUTOMÁTICA DO TOKEN DO MERCADO LIVRE
-- Colunas de controle + agendador pg_cron rodando dentro do Supabase.
-- Execute no SQL Editor.
-- ============================================================================
--
-- ESTE ARQUIVO NÃO CONTÉM NENHUM SEGREDO — e nunca deve conter.
-- Ele apenas LÊ, em tempo de execução, dois segredos guardados no
-- Supabase Vault (criptografados em repouso):
--
--     ml_client_id
--     ml_client_secret
--
-- Como cadastrá-los SEM colar valor em arquivo: veja
-- docs/CRON-RENOVACAO.md (passo 1). O caminho recomendado é a tela do
-- Vault no painel do Supabase, onde o valor é digitado direto no navegador
-- e nunca passa por um arquivo versionado.
--
-- POR QUE O AGENDADOR VIVE NO BANCO
-- O projeto ainda não tem deploy: o app roda na máquina do desenvolvedor com
-- túnel. Um cron externo apontando para esse túnel pararia junto com a
-- máquina, e o objetivo é manter o token válido mesmo com todos offline.
-- O Supabase é a única infraestrutura sempre ligada aqui, então pg_cron
-- (agenda) + pg_net (HTTP) chamam o Mercado Livre diretamente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Colunas de controle da renovação
-- ----------------------------------------------------------------------------
ALTER TABLE public.ml_connections
  ADD COLUMN IF NOT EXISTS last_refresh_at     timestamptz,
  ADD COLUMN IF NOT EXISTS last_refresh_status text,      -- ok | erro_temporario | reauth_required
  ADD COLUMN IF NOT EXISTS last_refresh_error  text,
  ADD COLUMN IF NOT EXISTS refresh_attempts    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refresh_lock_at     timestamptz;

COMMENT ON COLUMN public.ml_connections.refresh_lock_at IS
  'Trava de concorrência: preenchida enquanto uma execução renova esta conta. Expira sozinha em 2 min.';

CREATE INDEX IF NOT EXISTS ml_connections_expira_idx
  ON public.ml_connections (status, expires_at);

-- ----------------------------------------------------------------------------
-- 2) Extensões
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net  WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- ----------------------------------------------------------------------------
-- 3) Conferência: os segredos precisam existir ANTES de agendar.
--    Falha cedo e com mensagem clara, em vez de agendar algo que não funciona.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'ml_client_id')
     OR NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'ml_client_secret') THEN
    RAISE EXCEPTION
      'Cadastre os segredos ml_client_id e ml_client_secret no Vault antes de rodar esta migration. Passo a passo em docs/CRON-RENOVACAO.md';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4) Fila das renovações em andamento
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ml_refresh_jobs (
  request_id  bigint PRIMARY KEY,
  account_id  uuid NOT NULL REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  ml_user_id  text,
  enviado_em  timestamptz NOT NULL DEFAULT now(),
  processado  boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS ml_refresh_jobs_pendentes_idx
  ON public.ml_refresh_jobs (processado, enviado_em);

ALTER TABLE public.ml_refresh_jobs ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ml_refresh_jobs TO service_role;
REVOKE ALL ON public.ml_refresh_jobs FROM anon, authenticated;
DROP POLICY IF EXISTS "ml_refresh_jobs sem acesso publico" ON public.ml_refresh_jobs;
CREATE POLICY "ml_refresh_jobs sem acesso publico" ON public.ml_refresh_jobs
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ----------------------------------------------------------------------------
-- 5) FASE 1 — disparar as renovações necessárias
--
--    Os segredos são lidos do Vault DENTRO da função, em memória.
--    Nunca são gravados em tabela, log ou retorno.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ml_disparar_refresh()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, vault
AS $$
DECLARE
  conta     record;
  v_id      text;
  v_secret  text;
  v_request bigint;
  v_total   integer := 0;
BEGIN
  SELECT decrypted_secret INTO v_id     FROM vault.decrypted_secrets WHERE name = 'ml_client_id';
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'ml_client_secret';

  IF v_id IS NULL OR v_secret IS NULL THEN
    RAISE WARNING 'Segredos do Mercado Livre ausentes no Vault — nenhuma renovação disparada.';
    RETURN 0;
  END IF;

  FOR conta IN
    SELECT c.id, c.ml_user_id, c.refresh_token
      FROM public.ml_connections c
     WHERE c.provider = 'mercado_livre'
       -- Conexão sem dono não é usada por ninguém: renovar seria desperdício
       -- e apagaria o marcador de "precisa reconectar".
       AND c.owner_user_id IS NOT NULL
       AND c.status IN ('active', 'syncing', 'error')
       AND c.refresh_token IS NOT NULL
       AND c.refresh_token <> ''
       -- margem de segurança: renova 10 min antes de vencer
       AND (c.expires_at IS NULL OR c.expires_at < now() + interval '10 minutes')
       -- trava livre ou já expirada
       AND (c.refresh_lock_at IS NULL OR c.refresh_lock_at < now() - interval '2 minutes')
       -- backoff crescente após falhas seguidas: 1, 4, 9, 16… min (teto 60)
       AND (
         c.refresh_attempts = 0
         OR c.last_refresh_at IS NULL
         OR c.last_refresh_at < now() - (least(power(c.refresh_attempts, 2), 60) * interval '1 minute')
       )
       AND c.refresh_attempts < 8
     ORDER BY c.expires_at NULLS FIRST
     LIMIT 50
  LOOP
    -- Trava ANTES de disparar. Duas execuções nunca renovam a mesma conta:
    -- o Mercado Livre invalida o refresh_token antigo ao rotacionar, então
    -- uma corrida aqui destruiria a conexão.
    UPDATE public.ml_connections
       SET refresh_lock_at = now()
     WHERE id = conta.id
       AND (refresh_lock_at IS NULL OR refresh_lock_at < now() - interval '2 minutes');

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Corpo em JSON (confirmado contra a API real): o Postgres não tem
    -- url_encode nativo e montar form-urlencoded à mão quebraria com
    -- caractere especial no secret.
    SELECT net.http_post(
      url     := 'https://api.mercadolibre.com/oauth/token',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Accept', 'application/json'),
      body    := jsonb_build_object(
                   'grant_type',    'refresh_token',
                   'client_id',     v_id,
                   'client_secret', v_secret,
                   'refresh_token', conta.refresh_token
                 ),
      timeout_milliseconds := 20000
    ) INTO v_request;

    INSERT INTO public.ml_refresh_jobs (request_id, account_id, ml_user_id)
    VALUES (v_request, conta.id, conta.ml_user_id)
    ON CONFLICT (request_id) DO NOTHING;

    v_total := v_total + 1;
  END LOOP;

  RETURN v_total;
END $$;

REVOKE ALL ON FUNCTION public.ml_disparar_refresh() FROM public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 6) FASE 2 — ler as respostas e gravar os tokens novos (com rotação)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ml_coletar_refresh()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, net
AS $$
DECLARE
  job      record;
  resposta record;
  corpo    jsonb;
  v_total  integer := 0;
BEGIN
  FOR job IN
    SELECT * FROM public.ml_refresh_jobs
     WHERE processado = false
       AND enviado_em > now() - interval '1 hour'
     ORDER BY enviado_em
     LIMIT 100
  LOOP
    SELECT * INTO resposta FROM net._http_response WHERE id = job.request_id;
    IF NOT FOUND THEN
      CONTINUE;  -- resposta ainda não chegou; tenta na próxima rodada
    END IF;

    IF resposta.status_code = 200 THEN
      BEGIN
        corpo := resposta.content::jsonb;
      EXCEPTION WHEN others THEN
        corpo := NULL;
      END;

      IF corpo IS NOT NULL AND corpo ? 'access_token' THEN
        UPDATE public.ml_connections
           SET access_token        = corpo->>'access_token',
               -- ROTAÇÃO: o ML devolve refresh_token novo a cada renovação
               refresh_token       = COALESCE(NULLIF(corpo->>'refresh_token', ''), refresh_token),
               expires_at          = now() + (COALESCE((corpo->>'expires_in')::int, 21600) * interval '1 second'),
               scope               = COALESCE(corpo->>'scope', scope),
               status              = 'active',
               last_error          = NULL,
               reauth_required_at  = NULL,
               last_refresh_at     = now(),
               last_refresh_status = 'ok',
               last_refresh_error  = NULL,
               refresh_attempts    = 0,
               refresh_lock_at     = NULL,
               updated_at          = now()
         WHERE id = job.account_id;

        INSERT INTO public.system_logs (level, category, action, account_id, ml_user_id, endpoint, method,
                                        http_status, success, message, actor)
        VALUES ('info', 'refresh_token', 'refresh.ok', job.account_id, job.ml_user_id,
                '/oauth/token', 'POST', 200, true,
                'Token renovado automaticamente pelo agendador do banco.', 'pg_cron');
      ELSE
        UPDATE public.ml_connections
           SET last_refresh_status = 'erro_temporario',
               last_refresh_error  = 'Resposta 200 sem access_token.',
               refresh_attempts    = refresh_attempts + 1,
               last_refresh_at     = now(),
               refresh_lock_at     = NULL,
               updated_at          = now()
         WHERE id = job.account_id;
      END IF;

    ELSIF resposta.status_code IN (400, 401) AND COALESCE(resposta.content, '') ILIKE '%invalid_grant%' THEN
      -- Revogação REAL: só aqui a conta pede nova autorização.
      UPDATE public.ml_connections
         SET status              = 'reauth_required',
             reauth_required_at  = now(),
             last_error          = 'Refresh token rejeitado pelo Mercado Livre. Reautorização necessária.',
             last_refresh_status = 'reauth_required',
             last_refresh_error  = 'Refresh token rejeitado pelo Mercado Livre. Reautorização necessária.',
             last_refresh_at     = now(),
             refresh_lock_at     = NULL,
             updated_at          = now()
       WHERE id = job.account_id;

      INSERT INTO public.system_logs (level, category, action, account_id, ml_user_id, endpoint, method,
                                      http_status, success, error, actor)
      VALUES ('error', 'refresh_token', 'refresh.reautorizacao_necessaria', job.account_id, job.ml_user_id,
              '/oauth/token', 'POST', resposta.status_code, false,
              'Refresh token rejeitado pelo Mercado Livre. Reautorização necessária.', 'pg_cron');

    ELSE
      -- 429/5xx/timeout: NUNCA desconecta. Nova tentativa com backoff.
      UPDATE public.ml_connections
         SET last_refresh_status = 'erro_temporario',
             last_refresh_error  = left('Renovação recusada (HTTP ' || COALESCE(resposta.status_code::text, '?') || ').', 500),
             refresh_attempts    = refresh_attempts + 1,
             last_refresh_at     = now(),
             refresh_lock_at     = NULL,
             updated_at          = now()
       WHERE id = job.account_id;

      INSERT INTO public.system_logs (level, category, action, account_id, ml_user_id, endpoint, method,
                                      http_status, success, error, actor)
      VALUES ('warn', 'refresh_token', 'refresh.erro_temporario', job.account_id, job.ml_user_id,
              '/oauth/token', 'POST', resposta.status_code, false,
              'Falha temporária ao renovar; nova tentativa com backoff.', 'pg_cron');
    END IF;

    UPDATE public.ml_refresh_jobs SET processado = true WHERE request_id = job.request_id;
    v_total := v_total + 1;
  END LOOP;

  -- Higiene: solta travas órfãs e limpa a fila antiga.
  UPDATE public.ml_connections
     SET refresh_lock_at = NULL
   WHERE refresh_lock_at IS NOT NULL
     AND refresh_lock_at < now() - interval '5 minutes';

  DELETE FROM public.ml_refresh_jobs WHERE enviado_em < now() - interval '2 days';

  RETURN v_total;
END $$;

REVOKE ALL ON FUNCTION public.ml_coletar_refresh() FROM public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 7) AGENDAMENTO REAL
-- ----------------------------------------------------------------------------
SELECT cron.unschedule('ml_refresh_disparo') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ml_refresh_disparo');
SELECT cron.unschedule('ml_refresh_coleta')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ml_refresh_coleta');

SELECT cron.schedule('ml_refresh_disparo', '*/5 * * * *', $$ SELECT public.ml_disparar_refresh(); $$);
SELECT cron.schedule('ml_refresh_coleta',  '* * * * *',   $$ SELECT public.ml_coletar_refresh(); $$);

NOTIFY pgrst, 'reload schema';
