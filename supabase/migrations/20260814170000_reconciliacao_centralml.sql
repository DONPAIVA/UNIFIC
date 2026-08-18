-- ============================================================================
-- RECONCILIAÇÃO CENTRALML  —  execute UMA vez no SQL Editor do Supabase.
-- ============================================================================
--
-- POR QUE ESTA MIGRATION EXISTE
-- O banco em produção está no formato ANTIGO (o do arquivo
-- CENTRALML_CORRIGIDO/central_ml_admin.sql): ml_connections/ml_orders com
-- outra estrutura, e sem ml_oauth_states, ml_shipments, ml_shipment_events,
-- ml_sync_runs nem ml_webhook_events. As migrations anteriores do repositório
-- nunca foram aplicadas. Sem esta reconciliação o OAuth falha em
-- "Não foi possível iniciar a conexão".
--
-- GARANTIAS
--   * 100% ADITIVA e IDEMPOTENTE: só CREATE ... IF NOT EXISTS e
--     ADD COLUMN IF NOT EXISTS. Pode rodar mais de uma vez.
--   * NENHUMA tabela é apagada. NENHUMA coluna é removida ou renomeada.
--   * NENHUM dado é apagado. As colunas antigas continuam existindo e são
--     usadas para preencher as novas (backfill).
--   * As tabelas do Unific+ (pedidos, reclamacoes, solicitacoes_nf,
--     cotacoes_frete, acessos) não são tocadas.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Função de updated_at (pode já existir).
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

-- ============================================================================
-- 1) ADMINISTRADORES
--    Estrutura antiga: (id, email, status, created_at, updated_at)
--    O código usa user_id + role. Adicionamos as duas colunas e preenchemos
--    user_id a partir do auth.users pelo e-mail. O admin já cadastrado
--    continua funcionando durante e depois da migration.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'admin',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Amarra cada admin ao usuário do Supabase Auth com o mesmo e-mail.
UPDATE public.admin_users a
   SET user_id = u.id
  FROM auth.users u
 WHERE a.user_id IS NULL
   AND lower(u.email) = lower(a.email);

CREATE UNIQUE INDEX IF NOT EXISTS admin_users_user_id_uidx
  ON public.admin_users (user_id) WHERE user_id IS NOT NULL;

-- Helper usado nas policies. SECURITY DEFINER evita recursão de RLS.
-- Aceita as duas formas: vínculo por user_id OU por e-mail autenticado.
CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.admin_users a
     WHERE coalesce(a.status, 'active') = 'active'
       AND (
         a.user_id = uid
         OR lower(a.email) = lower(coalesce((SELECT u.email FROM auth.users u WHERE u.id = uid), ''))
       )
  );
$$;
REVOKE ALL ON FUNCTION public.is_admin(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin(uuid) TO authenticated;

GRANT ALL ON public.admin_users TO service_role;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 2) CONEXÕES DE MARKETPLACE (uma por cliente que autorizou o aplicativo)
--    Estrutura antiga: id, ml_user_id, nickname, email, access_token,
--                      refresh_token, token_expires_at, status,
--                      last_sync_at, created_at, updated_at
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ml_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ml_user_id text NOT NULL,
  nickname text,
  access_token text NOT NULL DEFAULT '',
  refresh_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ml_connections
  ADD COLUMN IF NOT EXISTS provider           text NOT NULL DEFAULT 'mercado_livre',
  ADD COLUMN IF NOT EXISTS owner_user_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status             text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS site_id            text,
  ADD COLUMN IF NOT EXISTS email              text,
  ADD COLUMN IF NOT EXISTS first_name         text,
  ADD COLUMN IF NOT EXISTS scope              text,
  ADD COLUMN IF NOT EXISTS expires_at         timestamptz,
  ADD COLUMN IF NOT EXISTS connected_at       timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_sync_at       timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_status   text,
  ADD COLUMN IF NOT EXISTS last_error         text,
  ADD COLUMN IF NOT EXISTS reauth_required_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_activity_at   timestamptz;

-- Backfill: a estrutura antiga guardava a expiração em token_expires_at.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'ml_connections'
       AND column_name = 'token_expires_at'
  ) THEN
    EXECUTE 'UPDATE public.ml_connections
                SET expires_at = token_expires_at
              WHERE expires_at IS NULL AND token_expires_at IS NOT NULL';
  END IF;
END $$;

-- Uma conexão por (provider, ml_user_id) — é o onConflict do callback OAuth.
CREATE UNIQUE INDEX IF NOT EXISTS ml_connections_provider_user_uidx
  ON public.ml_connections (provider, ml_user_id);

GRANT ALL ON public.ml_connections TO service_role;
ALTER TABLE public.ml_connections ENABLE ROW LEVEL SECURITY;
-- Tabela com tokens: NENHUM acesso via anon/authenticated. Só service_role.
DROP POLICY IF EXISTS "ml_connections sem acesso publico" ON public.ml_connections;
CREATE POLICY "ml_connections sem acesso publico" ON public.ml_connections
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ============================================================================
-- 3) STATE DO OAUTH (uso único, com expiração)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ml_oauth_states (
  state text PRIMARY KEY,
  code_verifier text,
  owner_user_id uuid,
  redirect_uri text,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ml_oauth_states
  ADD COLUMN IF NOT EXISTS code_verifier text,
  ADD COLUMN IF NOT EXISTS owner_user_id uuid,
  ADD COLUMN IF NOT EXISTS redirect_uri  text,
  ADD COLUMN IF NOT EXISTS expires_at    timestamptz NOT NULL DEFAULT (now() + interval '15 minutes');

CREATE INDEX IF NOT EXISTS ml_oauth_states_expires_idx ON public.ml_oauth_states (expires_at);

GRANT ALL ON public.ml_oauth_states TO service_role;
ALTER TABLE public.ml_oauth_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ml_oauth_states sem acesso publico" ON public.ml_oauth_states;
CREATE POLICY "ml_oauth_states sem acesso publico" ON public.ml_oauth_states
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ============================================================================
-- 4) PEDIDOS DO MARKETPLACE (isolados por conta)
--    Estrutura antiga: id, ml_user_id, order_id, buyer_nickname, buyer_email,
--                      total_amount, status, shipment_id, tracking_code, items,
--                      buyer_feedback_*, created_at, updated_at
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ml_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.ml_orders
  ADD COLUMN IF NOT EXISTS account_id            uuid REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS provider              text NOT NULL DEFAULT 'mercado_livre',
  ADD COLUMN IF NOT EXISTS ml_order_id           text,
  ADD COLUMN IF NOT EXISTS status                text,
  ADD COLUMN IF NOT EXISTS status_detail         text,
  ADD COLUMN IF NOT EXISTS date_created          timestamptz,
  ADD COLUMN IF NOT EXISTS date_closed           timestamptz,
  ADD COLUMN IF NOT EXISTS last_updated          timestamptz,
  ADD COLUMN IF NOT EXISTS total_amount          numeric,
  ADD COLUMN IF NOT EXISTS currency_id           text,
  ADD COLUMN IF NOT EXISTS buyer_id              text,
  ADD COLUMN IF NOT EXISTS buyer_nickname        text,
  ADD COLUMN IF NOT EXISTS buyer_name            text,
  ADD COLUMN IF NOT EXISTS title                 text,
  ADD COLUMN IF NOT EXISTS quantity              integer,
  ADD COLUMN IF NOT EXISTS items                 jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS shipping_id           text,
  ADD COLUMN IF NOT EXISTS pack_id               text,
  ADD COLUMN IF NOT EXISTS raw                   jsonb,
  ADD COLUMN IF NOT EXISTS synced_at             timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS buyer_feedback_at     timestamptz,
  ADD COLUMN IF NOT EXISTS buyer_feedback_status text,
  ADD COLUMN IF NOT EXISTS buyer_feedback_rating text;

-- Backfill a partir das colunas antigas, quando existirem.
DO $$
DECLARE has_col boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='ml_orders' AND column_name='order_id')
    INTO has_col;
  IF has_col THEN
    EXECUTE 'UPDATE public.ml_orders SET ml_order_id = order_id::text
              WHERE ml_order_id IS NULL AND order_id IS NOT NULL';
  END IF;

  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='ml_orders' AND column_name='shipment_id')
    INTO has_col;
  IF has_col THEN
    EXECUTE 'UPDATE public.ml_orders SET shipping_id = shipment_id::text
              WHERE shipping_id IS NULL AND shipment_id IS NOT NULL';
  END IF;

  -- Liga cada pedido antigo à conexão correspondente pelo ml_user_id.
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema='public' AND table_name='ml_orders' AND column_name='ml_user_id')
    INTO has_col;
  IF has_col THEN
    EXECUTE 'UPDATE public.ml_orders o
                SET account_id = c.id
               FROM public.ml_connections c
              WHERE o.account_id IS NULL
                AND c.ml_user_id = o.ml_user_id::text';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ml_orders_account_order_uidx
  ON public.ml_orders (account_id, ml_order_id);
CREATE INDEX IF NOT EXISTS ml_orders_account_date_idx ON public.ml_orders (account_id, date_created DESC);
CREATE INDEX IF NOT EXISTS ml_orders_shipping_idx     ON public.ml_orders (shipping_id);
CREATE INDEX IF NOT EXISTS ml_orders_feedback_idx     ON public.ml_orders (account_id, buyer_feedback_at);

DROP TRIGGER IF EXISTS ml_orders_touch ON public.ml_orders;
CREATE TRIGGER ml_orders_touch BEFORE UPDATE ON public.ml_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- 5) ENVIOS
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ml_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.ml_orders(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'mercado_livre',
  ml_shipment_id text NOT NULL,
  ml_order_id text,
  mode text,
  logistic_type text,
  status text,
  substatus text,
  tracking_number text,
  tracking_method text,
  date_created timestamptz,
  last_updated timestamptz,
  estimated_delivery timestamptz,
  receiver_name text,
  receiver_city text,
  receiver_state text,
  receiver_zip text,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, ml_shipment_id)
);
CREATE INDEX IF NOT EXISTS ml_shipments_account_idx  ON public.ml_shipments (account_id, last_updated DESC);
CREATE INDEX IF NOT EXISTS ml_shipments_tracking_idx ON public.ml_shipments (tracking_number);

DROP TRIGGER IF EXISTS ml_shipments_touch ON public.ml_shipments;
CREATE TRIGGER ml_shipments_touch BEFORE UPDATE ON public.ml_shipments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============================================================================
-- 6) EVENTOS DE RASTREAMENTO (idempotentes por fingerprint)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ml_shipment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  shipment_id uuid NOT NULL REFERENCES public.ml_shipments(id) ON DELETE CASCADE,
  ml_shipment_id text NOT NULL,
  status text,
  substatus text,
  description text,
  event_date timestamptz,
  source text NOT NULL DEFAULT 'ml_api',
  fingerprint text NOT NULL,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shipment_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS ml_shipment_events_date_idx ON public.ml_shipment_events (shipment_id, event_date DESC);

-- ============================================================================
-- 7) EXECUÇÕES DE SINCRONIZAÇÃO
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ml_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  kind text NOT NULL,                       -- initial | incremental | manual | webhook
  status text NOT NULL DEFAULT 'running',   -- running | success | error
  trigger text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  orders_processed integer NOT NULL DEFAULT 0,
  shipments_processed integer NOT NULL DEFAULT 0,
  events_processed integer NOT NULL DEFAULT 0,
  attempt integer NOT NULL DEFAULT 1,
  error text,
  detail jsonb
);
CREATE INDEX IF NOT EXISTS ml_sync_runs_started_idx ON public.ml_sync_runs (started_at DESC);
CREATE INDEX IF NOT EXISTS ml_sync_runs_account_idx ON public.ml_sync_runs (account_id, started_at DESC);

-- ============================================================================
-- 8) NOTIFICAÇÕES DO MERCADO LIVRE (idempotência)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ml_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic text NOT NULL,
  resource text NOT NULL,
  ml_user_id text,
  application_id text,
  attempts integer,
  sent_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status text NOT NULL DEFAULT 'pending',   -- pending | processed | ignored | error
  error text,
  raw jsonb,
  UNIQUE (topic, resource, sent_at)
);
CREATE INDEX IF NOT EXISTS ml_webhook_events_received_idx ON public.ml_webhook_events (received_at DESC);

-- ============================================================================
-- 9) AUDITORIA ADMINISTRATIVA
--    Estrutura antiga: (id, admin_email, action, target_id, payload,
--                       response, error, created_at)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_email text,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.admin_audit_log
  ADD COLUMN IF NOT EXISTS admin_user_id uuid,
  ADD COLUMN IF NOT EXISTS entity        text,
  ADD COLUMN IF NOT EXISTS entity_id     text,
  ADD COLUMN IF NOT EXISTS account_id    uuid REFERENCES public.ml_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS success       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS detail        jsonb,
  ADD COLUMN IF NOT EXISTS ip            text;
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON public.admin_audit_log (created_at DESC);

-- ============================================================================
-- 10) LOG UNIFICADO DO SISTEMA
--     Estrutura antiga: (id, level, action, message, user_id, metadata, created_at)
--     NUNCA recebe access_token, refresh_token, client_secret ou
--     service_role_key — src/lib/server/logs.server.ts redige antes de gravar.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.system_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  level text NOT NULL DEFAULT 'info',
  action text NOT NULL,
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.system_logs
  ADD COLUMN IF NOT EXISTS category    text NOT NULL DEFAULT 'erro',
  ADD COLUMN IF NOT EXISTS account_id  uuid REFERENCES public.ml_connections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ml_user_id  text,
  ADD COLUMN IF NOT EXISTS endpoint    text,
  ADD COLUMN IF NOT EXISTS method      text,
  ADD COLUMN IF NOT EXISTS http_status integer,
  ADD COLUMN IF NOT EXISTS duration_ms integer,
  ADD COLUMN IF NOT EXISTS success     boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS error       text,
  ADD COLUMN IF NOT EXISTS detail      jsonb,
  ADD COLUMN IF NOT EXISTS actor       text,
  ADD COLUMN IF NOT EXISTS ip          text;
CREATE INDEX IF NOT EXISTS system_logs_created_idx  ON public.system_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS system_logs_category_idx ON public.system_logs (category, created_at DESC);
CREATE INDEX IF NOT EXISTS system_logs_account_idx  ON public.system_logs (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS system_logs_level_idx    ON public.system_logs (level, created_at DESC);

-- ============================================================================
-- 11) CONSULTAS DE RASTREIO DO UNIFIC+ (rastreamento ao vivo)
--     Cada busca no rastreador público vira uma linha. Sem consulta,
--     a CentralML mostra "Sem dados" — nada é inventado.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.rastreio_consultas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  marketplace text,
  found boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'nao_encontrado',   -- local | mercado_livre | nao_encontrado
  status text,
  account_id uuid REFERENCES public.ml_connections(id) ON DELETE SET NULL,
  ml_shipment_id text,
  ip text,
  user_agent text,
  path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rastreio_consultas_created_idx ON public.rastreio_consultas (created_at DESC);
CREATE INDEX IF NOT EXISTS rastreio_consultas_code_idx    ON public.rastreio_consultas (code);
CREATE INDEX IF NOT EXISTS rastreio_consultas_account_idx ON public.rastreio_consultas (account_id, created_at DESC);

-- ============================================================================
-- 12) RLS / PERMISSÕES
--     service_role  -> acesso total (é o backend quem lê e escreve)
--     authenticated -> SELECT somente se for admin
--     anon          -> nenhum acesso
--     ml_connections e ml_oauth_states continuam service_role-only (tokens).
-- ============================================================================
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ml_orders', 'ml_shipments', 'ml_shipment_events', 'ml_sync_runs',
    'ml_webhook_events', 'admin_audit_log', 'system_logs', 'rastreio_consultas'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('DROP POLICY IF EXISTS "%s leitura admin" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "%s leitura admin" ON public.%I FOR SELECT TO authenticated USING (public.is_admin(auth.uid()))',
      t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s sem acesso anon" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "%s sem acesso anon" ON public.%I FOR ALL TO anon USING (false) WITH CHECK (false)', t, t);
  END LOOP;
END $$;

-- ============================================================================
-- 13) REALTIME (opcional — a CentralML funciona igual sem isso, via polling)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.rastreio_consultas;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.system_logs;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ============================================================================
-- 14) PRIMEIRO ADMINISTRADOR
--     Se admin_users já tem o seu e-mail (é o caso deste projeto), nada a fazer.
--     Caso contrário, crie o usuário em Authentication > Users e rode:
--
--       INSERT INTO public.admin_users (email, user_id, role, status)
--       SELECT u.email, u.id, 'admin', 'active'
--         FROM auth.users u
--        WHERE lower(u.email) = lower('SEU_EMAIL@DOMINIO.COM')
--       ON CONFLICT (email) DO UPDATE
--          SET user_id = EXCLUDED.user_id, status = 'active';
--
--     Alternativa: defina ADMIN_BOOTSTRAP_EMAIL no .env — o primeiro login
--     com esse e-mail vira admin automaticamente ENQUANTO admin_users
--     estiver vazia.
-- ============================================================================

NOTIFY pgrst, 'reload schema';
