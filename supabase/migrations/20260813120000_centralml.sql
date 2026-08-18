-- ============================================================
-- CentralML — área administrativa (/centralml)
-- INCREMENTAL: não altera nem remove as tabelas do UnificRastreios
-- (pedidos, reclamacoes, solicitacoes_nf, cotacoes_frete, acessos).
-- ============================================================

-- ------------------------------------------------------------
-- 1) Administradores
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  role text NOT NULL DEFAULT 'admin',           -- admin | viewer (estrutura p/ permissões futuras)
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.admin_users TO service_role;
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admin_users sem acesso publico" ON public.admin_users;
CREATE POLICY "admin_users sem acesso publico" ON public.admin_users
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- Helper usado nas policies (SECURITY DEFINER evita recursão de RLS)
CREATE OR REPLACE FUNCTION public.is_admin(uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = uid);
$$;

-- ------------------------------------------------------------
-- 2) Contas de marketplace (reaproveita ml_connections existente)
--    provider deixa a arquitetura extensível (shopee/amazon/olx/...)
-- ------------------------------------------------------------
ALTER TABLE public.ml_connections
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'mercado_livre',
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',   -- active | error | disconnected
  ADD COLUMN IF NOT EXISTS site_id text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS connected_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_sync_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sync_status text,
  ADD COLUMN IF NOT EXISTS last_error text;

CREATE UNIQUE INDEX IF NOT EXISTS ml_connections_provider_user_uidx
  ON public.ml_connections (provider, ml_user_id);

-- OAuth state: PKCE + expiração + vínculo com o usuário que iniciou
ALTER TABLE public.ml_oauth_states
  ADD COLUMN IF NOT EXISTS code_verifier text,
  ADD COLUMN IF NOT EXISTS owner_user_id uuid,
  ADD COLUMN IF NOT EXISTS redirect_uri text,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes');

-- ------------------------------------------------------------
-- 3) Pedidos do marketplace (isolados por conta)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ml_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'mercado_livre',
  ml_order_id text NOT NULL,
  status text,
  status_detail text,
  date_created timestamptz,
  date_closed timestamptz,
  last_updated timestamptz,
  total_amount numeric,
  currency_id text,
  buyer_id text,
  buyer_nickname text,
  buyer_name text,
  title text,
  quantity integer,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  shipping_id text,
  pack_id text,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, ml_order_id)
);
CREATE INDEX IF NOT EXISTS ml_orders_account_date_idx ON public.ml_orders (account_id, date_created DESC);
CREATE INDEX IF NOT EXISTS ml_orders_shipping_idx ON public.ml_orders (shipping_id);

-- ------------------------------------------------------------
-- 4) Shipments
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ml_shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.ml_orders(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'mercado_livre',
  ml_shipment_id text NOT NULL,
  ml_order_id text,
  mode text,                 -- me1 | me2 | custom | ...
  logistic_type text,        -- self_service (flex) | fulfillment | drop_off | ...
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
CREATE INDEX IF NOT EXISTS ml_shipments_account_idx ON public.ml_shipments (account_id, last_updated DESC);
CREATE INDEX IF NOT EXISTS ml_shipments_tracking_idx ON public.ml_shipments (tracking_number);

-- ------------------------------------------------------------
-- 5) Eventos de rastreamento (idempotentes via fingerprint)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 6) Execuções de sincronização
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ml_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  kind text NOT NULL,                        -- initial | incremental | manual | webhook
  status text NOT NULL DEFAULT 'running',    -- running | success | error
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

-- ------------------------------------------------------------
-- 7) Notificações/webhooks recebidos (idempotência)
-- ------------------------------------------------------------
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

-- ------------------------------------------------------------
-- 8) Auditoria administrativa
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid,
  admin_email text,
  action text NOT NULL,
  entity text,
  entity_id text,
  account_id uuid REFERENCES public.ml_connections(id) ON DELETE SET NULL,
  success boolean NOT NULL DEFAULT true,
  detail jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON public.admin_audit_log (created_at DESC);

-- ------------------------------------------------------------
-- 9) updated_at automático (função já existe: public.touch_updated_at)
-- ------------------------------------------------------------
DROP TRIGGER IF EXISTS ml_orders_touch ON public.ml_orders;
CREATE TRIGGER ml_orders_touch BEFORE UPDATE ON public.ml_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS ml_shipments_touch ON public.ml_shipments;
CREATE TRIGGER ml_shipments_touch BEFORE UPDATE ON public.ml_shipments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- 10) RLS / permissões
--     - service_role: acesso total (backend)
--     - authenticated: leitura SOMENTE se for admin
--     - anon: nenhum acesso
--     - ml_connections/ml_oauth_states continuam service_role-only (tokens)
-- ------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ml_orders','ml_shipments','ml_shipment_events','ml_sync_runs','ml_webhook_events','admin_audit_log'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS "%s leitura admin" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "%s leitura admin" ON public.%I FOR SELECT TO authenticated USING (public.is_admin(auth.uid()))',
      t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s sem escrita publica" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "%s sem escrita publica" ON public.%I FOR ALL TO anon USING (false) WITH CHECK (false)',
      t, t);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 11) BOOTSTRAP DO PRIMEIRO ADMINISTRADOR
--     Opção A (recomendada): crie o usuário em Authentication > Users
--     e rode:
--       INSERT INTO public.admin_users (user_id, email)
--       SELECT id, email FROM auth.users WHERE email = 'seu@email.com'
--       ON CONFLICT DO NOTHING;
--     Opção B: defina ADMIN_BOOTSTRAP_EMAIL no .env — o primeiro login
--     com esse e-mail vira admin automaticamente ENQUANTO a tabela
--     admin_users estiver vazia.
-- ------------------------------------------------------------
