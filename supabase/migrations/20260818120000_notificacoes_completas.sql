-- ============================================================================
-- NOTIFICAÇÕES COMPLETAS — todos os tópicos do Mercado Livre passam a ter
-- destino no banco. Execute no SQL Editor do Supabase APÓS
-- 20260815160000_refresh_automatico.sql.
-- ============================================================================
--
-- 100% ADITIVA e IDEMPOTENTE. Nenhuma tabela existente é alterada de forma
-- destrutiva, nenhuma coluna é removida ou renomeada, nenhum dado é apagado.
--
-- POR QUE ESTAS TABELAS EXISTEM
-- Até aqui só pedidos e envios eram gravados. Os demais tópicos (pagamentos,
-- mensagens, anúncios, perguntas, reclamações, preços, promoções, leads...)
-- chegavam no webhook e viravam apenas uma linha de log — o conteúdo se perdia.
--
-- O DESENHO
--   - Tópicos de alto valor ganham tabela própria, com colunas consultáveis:
--     ml_payments, ml_messages, ml_items, ml_questions, ml_claims,
--     ml_claim_actions, ml_order_feedback.
--   - A "cauda longa" (preços, catálogo, promoções, leads, estoque, notas
--     fiscais...) cai em ml_topic_events: uma linha por recurso notificado,
--     com o corpo lido da API em jsonb. Nada se perde e, quando um desses
--     tópicos merecer tabela própria, os dados já estarão ali para migrar.
--
-- O histórico bruto de TODA notificação continua em ml_webhook_events — estas
-- tabelas guardam o CONTEÚDO, não substituem o registro de recebimento.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Pagamentos  (tópicos: payments, orders_v2 -> o.payments[])
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ml_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.ml_orders(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'mercado_livre',
  ml_payment_id text NOT NULL,
  ml_order_id text,
  status text,
  status_detail text,
  operation_type text,
  payment_type text,
  payment_method_id text,
  transaction_amount numeric,
  total_paid_amount numeric,
  shipping_cost numeric,
  taxes_amount numeric,
  currency_id text,
  installments integer,
  date_created timestamptz,
  date_approved timestamptz,
  date_last_updated timestamptz,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, ml_payment_id)
);
CREATE INDEX IF NOT EXISTS ml_payments_account_idx  ON public.ml_payments (account_id, date_created DESC);
CREATE INDEX IF NOT EXISTS ml_payments_order_idx    ON public.ml_payments (ml_order_id);
CREATE INDEX IF NOT EXISTS ml_payments_status_idx   ON public.ml_payments (account_id, status);

-- ----------------------------------------------------------------------------
-- 2) Mensagens pós-venda  (tópicos: messages, messages_created, messages_read)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ml_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.ml_orders(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'mercado_livre',
  ml_message_id text NOT NULL,
  pack_id text,
  ml_order_id text,
  from_user_id text,
  to_user_id text,
  -- 'recebida' quando quem escreveu não é a conta conectada; 'enviada' quando é.
  direcao text,
  subject text,
  body text,
  status text,
  moderation_status text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  date_created timestamptz,
  date_read timestamptz,
  date_available timestamptz,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, ml_message_id)
);
CREATE INDEX IF NOT EXISTS ml_messages_account_idx ON public.ml_messages (account_id, date_created DESC);
CREATE INDEX IF NOT EXISTS ml_messages_pack_idx    ON public.ml_messages (account_id, pack_id);
CREATE INDEX IF NOT EXISTS ml_messages_naolidas_idx ON public.ml_messages (account_id, date_read) WHERE date_read IS NULL;

-- ----------------------------------------------------------------------------
-- 3) Anúncios  (tópicos: items, items_prices, user_products_families)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ml_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'mercado_livre',
  ml_item_id text NOT NULL,
  title text,
  status text,
  sub_status jsonb NOT NULL DEFAULT '[]'::jsonb,
  price numeric,
  base_price numeric,
  original_price numeric,
  currency_id text,
  available_quantity integer,
  sold_quantity integer,
  condition text,
  listing_type_id text,
  category_id text,
  catalog_product_id text,
  catalog_listing boolean,
  permalink text,
  thumbnail text,
  health numeric,
  logistic_type text,
  free_shipping boolean,
  date_created timestamptz,
  last_updated timestamptz,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, ml_item_id)
);
CREATE INDEX IF NOT EXISTS ml_items_account_idx ON public.ml_items (account_id, last_updated DESC);
CREATE INDEX IF NOT EXISTS ml_items_status_idx  ON public.ml_items (account_id, status);

-- ----------------------------------------------------------------------------
-- 4) Perguntas  (tópico: questions)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ml_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'mercado_livre',
  ml_question_id text NOT NULL,
  ml_item_id text,
  status text,
  body text,
  answer_text text,
  answer_status text,
  answer_date timestamptz,
  from_user_id text,
  seller_id text,
  date_created timestamptz,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, ml_question_id)
);
CREATE INDEX IF NOT EXISTS ml_questions_account_idx ON public.ml_questions (account_id, date_created DESC);
CREATE INDEX IF NOT EXISTS ml_questions_item_idx    ON public.ml_questions (account_id, ml_item_id);
-- Perguntas ainda sem resposta: a consulta mais usada da tela.
CREATE INDEX IF NOT EXISTS ml_questions_pendentes_idx
  ON public.ml_questions (account_id, date_created DESC) WHERE answer_text IS NULL;

-- ----------------------------------------------------------------------------
-- 5) Reclamações  (tópicos: post_purchase, claims, created_claims)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ml_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.ml_orders(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'mercado_livre',
  ml_claim_id text NOT NULL,
  ml_order_id text,
  resource_type text,          -- order | shipment | payment ...
  resource_id text,
  type text,                   -- mediations | claim | return ...
  stage text,                  -- claim | dispute | recontact | none
  status text,                 -- opened | closed | ...
  status_detail text,
  reason_id text,
  parent_id text,
  players jsonb NOT NULL DEFAULT '[]'::jsonb,
  available_actions jsonb NOT NULL DEFAULT '[]'::jsonb,
  date_created timestamptz,
  last_updated timestamptz,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, ml_claim_id)
);
CREATE INDEX IF NOT EXISTS ml_claims_account_idx ON public.ml_claims (account_id, last_updated DESC);
CREATE INDEX IF NOT EXISTS ml_claims_order_idx   ON public.ml_claims (account_id, ml_order_id);
CREATE INDEX IF NOT EXISTS ml_claims_abertas_idx ON public.ml_claims (account_id, status) WHERE status <> 'closed';

-- Ações disponíveis/executadas dentro de uma reclamação (tópico claims_actions).
-- fingerprint garante idempotência sem depender de um id que o ML nem sempre manda.
CREATE TABLE IF NOT EXISTS public.ml_claim_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  claim_id uuid REFERENCES public.ml_claims(id) ON DELETE CASCADE,
  ml_claim_id text NOT NULL,
  action text,
  status text,
  mandatory boolean,
  due_date timestamptz,
  fingerprint text NOT NULL,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, ml_claim_id, fingerprint)
);
CREATE INDEX IF NOT EXISTS ml_claim_actions_claim_idx ON public.ml_claim_actions (ml_claim_id);

-- ----------------------------------------------------------------------------
-- 6) Feedback do pedido  (tópico: orders_feedback)
--    Uma linha por papel: o comprador e o vendedor avaliam separadamente.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ml_order_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.ml_orders(id) ON DELETE SET NULL,
  provider text NOT NULL DEFAULT 'mercado_livre',
  ml_order_id text NOT NULL,
  role text NOT NULL,             -- purchase (comprador) | sale (vendedor)
  ml_feedback_id text,
  rating text,                    -- positive | neutral | negative
  fulfilled boolean,
  status text,
  message text,
  reason text,
  date_created timestamptz,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, ml_order_id, role)
);
CREATE INDEX IF NOT EXISTS ml_order_feedback_account_idx ON public.ml_order_feedback (account_id, date_created DESC);

-- ----------------------------------------------------------------------------
-- 7) Cauda longa dos tópicos  (preços, catálogo, promoções, leads, estoque,
--    notas fiscais, cotações, flex, seguros, créditos de leads...)
--
--    Uma linha por RECURSO notificado, sempre com o último corpo lido da API.
--    O histórico de cada chegada continua em ml_webhook_events.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ml_topic_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'mercado_livre',
  topic text NOT NULL,            -- tópico exatamente como o ML enviou
  topic_key text NOT NULL,        -- chave canônica do catálogo (ml-topics.server.ts)
  topic_group text NOT NULL,      -- prices | items | catalog | promotions | vis_leads | shipments | others
  label text,                     -- rótulo em português, para a tela
  resource text NOT NULL,
  resource_id text,
  ml_user_id text,
  fetched boolean NOT NULL DEFAULT false,   -- o corpo do recurso foi lido?
  http_status integer,
  fetch_error text,
  payload jsonb,                  -- corpo do recurso lido na API
  summary text,                   -- resumo legível montado pelo backend
  occurred_at timestamptz,
  times_seen integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, topic, resource)
);
CREATE INDEX IF NOT EXISTS ml_topic_events_account_idx ON public.ml_topic_events (account_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS ml_topic_events_group_idx   ON public.ml_topic_events (account_id, topic_group, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS ml_topic_events_key_idx     ON public.ml_topic_events (topic_key);

-- ----------------------------------------------------------------------------
-- 8) updated_at automático (public.touch_updated_at já existe)
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ml_payments','ml_messages','ml_items','ml_questions','ml_claims',
    'ml_order_feedback','ml_topic_events'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON public.%I', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_touch BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()',
      t, t);
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 9) RLS — mesmo modelo das tabelas existentes:
--    service_role faz tudo; o dono da conta e o admin leem; anon não vê nada.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ml_payments','ml_messages','ml_items','ml_questions','ml_claims',
    'ml_claim_actions','ml_order_feedback','ml_topic_events'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);

    EXECUTE format('DROP POLICY IF EXISTS "%s leitura dono ou admin" ON public.%I', t, t);
    EXECUTE format($f$
      CREATE POLICY "%1$s leitura dono ou admin" ON public.%1$I
      FOR SELECT TO authenticated
      USING (
        public.is_admin(auth.uid())
        OR (account_id IS NOT NULL AND public.owns_account(account_id))
      )
    $f$, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s sem acesso anon" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "%s sem acesso anon" ON public.%I FOR ALL TO anon USING (false) WITH CHECK (false)', t, t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
