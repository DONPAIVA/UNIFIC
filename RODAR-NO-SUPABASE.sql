-- ============================================================================
-- UNIFIC+ — migrations pendentes. Cole TUDO no SQL Editor do Supabase e Run.
-- Seguro rodar mais de uma vez (tudo e IF NOT EXISTS / DROP-CREATE).
-- Nenhuma tabela existente e alterada de forma destrutiva.
-- ============================================================================
-- PARTE 1 de 2 — NOTIFICACOES DO MERCADO LIVRE

-- ============================================================================
-- NOTIFICAÃ‡Ã•ES COMPLETAS â€” todos os tÃ³picos do Mercado Livre passam a ter
-- destino no banco. Execute no SQL Editor do Supabase APÃ“S
-- 20260815160000_refresh_automatico.sql.
-- ============================================================================
--
-- 100% ADITIVA e IDEMPOTENTE. Nenhuma tabela existente Ã© alterada de forma
-- destrutiva, nenhuma coluna Ã© removida ou renomeada, nenhum dado Ã© apagado.
--
-- POR QUE ESTAS TABELAS EXISTEM
-- AtÃ© aqui sÃ³ pedidos e envios eram gravados. Os demais tÃ³picos (pagamentos,
-- mensagens, anÃºncios, perguntas, reclamaÃ§Ãµes, preÃ§os, promoÃ§Ãµes, leads...)
-- chegavam no webhook e viravam apenas uma linha de log â€” o conteÃºdo se perdia.
--
-- O DESENHO
--   - TÃ³picos de alto valor ganham tabela prÃ³pria, com colunas consultÃ¡veis:
--     ml_payments, ml_messages, ml_items, ml_questions, ml_claims,
--     ml_claim_actions, ml_order_feedback.
--   - A "cauda longa" (preÃ§os, catÃ¡logo, promoÃ§Ãµes, leads, estoque, notas
--     fiscais...) cai em ml_topic_events: uma linha por recurso notificado,
--     com o corpo lido da API em jsonb. Nada se perde e, quando um desses
--     tÃ³picos merecer tabela prÃ³pria, os dados jÃ¡ estarÃ£o ali para migrar.
--
-- O histÃ³rico bruto de TODA notificaÃ§Ã£o continua em ml_webhook_events â€” estas
-- tabelas guardam o CONTEÃšDO, nÃ£o substituem o registro de recebimento.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Pagamentos  (tÃ³picos: payments, orders_v2 -> o.payments[])
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
-- 2) Mensagens pÃ³s-venda  (tÃ³picos: messages, messages_created, messages_read)
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
  -- 'recebida' quando quem escreveu nÃ£o Ã© a conta conectada; 'enviada' quando Ã©.
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
-- 3) AnÃºncios  (tÃ³picos: items, items_prices, user_products_families)
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
-- 4) Perguntas  (tÃ³pico: questions)
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
-- 5) ReclamaÃ§Ãµes  (tÃ³picos: post_purchase, claims, created_claims)
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

-- AÃ§Ãµes disponÃ­veis/executadas dentro de uma reclamaÃ§Ã£o (tÃ³pico claims_actions).
-- fingerprint garante idempotÃªncia sem depender de um id que o ML nem sempre manda.
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
-- 6) Feedback do pedido  (tÃ³pico: orders_feedback)
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
-- 7) Cauda longa dos tÃ³picos  (preÃ§os, catÃ¡logo, promoÃ§Ãµes, leads, estoque,
--    notas fiscais, cotaÃ§Ãµes, flex, seguros, crÃ©ditos de leads...)
--
--    Uma linha por RECURSO notificado, sempre com o Ãºltimo corpo lido da API.
--    O histÃ³rico de cada chegada continua em ml_webhook_events.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ml_topic_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.ml_connections(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'mercado_livre',
  topic text NOT NULL,            -- tÃ³pico exatamente como o ML enviou
  topic_key text NOT NULL,        -- chave canÃ´nica do catÃ¡logo (ml-topics.server.ts)
  topic_group text NOT NULL,      -- prices | items | catalog | promotions | vis_leads | shipments | others
  label text,                     -- rÃ³tulo em portuguÃªs, para a tela
  resource text NOT NULL,
  resource_id text,
  ml_user_id text,
  fetched boolean NOT NULL DEFAULT false,   -- o corpo do recurso foi lido?
  http_status integer,
  fetch_error text,
  payload jsonb,                  -- corpo do recurso lido na API
  summary text,                   -- resumo legÃ­vel montado pelo backend
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
-- 8) updated_at automÃ¡tico (public.touch_updated_at jÃ¡ existe)
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
-- 9) RLS â€” mesmo modelo das tabelas existentes:
--    service_role faz tudo; o dono da conta e o admin leem; anon nÃ£o vÃª nada.
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


-- ============================================================================
-- PARTE 2 de 2 — PERFIL DO CLIENTE (nome, telefone, CPF, PIN)
-- ============================================================================

-- ============================================================================
-- PERFIL DO CLIENTE â€” nome, telefone, CPF e PIN de atendimento.
-- Execute no SQL Editor do Supabase APÃ“S
-- 20260818120000_notificacoes_completas.sql.
-- ============================================================================
--
-- 100% ADITIVA. Nenhuma tabela existente Ã© tocada.
--
-- O QUE ESTA TABELA GUARDA
-- O Supabase Auth jÃ¡ cuida do e-mail e da senha. O que falta Ã© o cadastro
-- comercial do cliente â€” quem Ã© a pessoa por trÃ¡s do login â€” para o
-- atendimento identificar, emitir nota e localizar pedidos.
--
-- O QUE ELA NÃƒO GUARDA
-- Senha. A senha vive sÃ³ no auth.users do Supabase, em hash, e nem o
-- administrador consegue lÃª-la. O PIN tambÃ©m NÃƒO Ã© gravado em claro: sÃ³ o
-- hash scrypt, calculado no servidor (src/lib/server/perfil.server.ts).
--
-- LGPD
-- CPF Ã© dado pessoal. A CentralML mostra mascarado (123.***.**9-00) por
-- padrÃ£o, e toda revelaÃ§Ã£o do valor completo passa pela auditoria em
-- admin_audit_log. A regra abaixo garante que ninguÃ©m alÃ©m do dono e do
-- administrador consiga ler estas linhas.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.clientes_perfil (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_completo text NOT NULL,
  email text,
  telefone text NOT NULL,           -- sÃ³ dÃ­gitos, com DDD
  cpf text NOT NULL,                -- sÃ³ dÃ­gitos, 11 posiÃ§Ãµes
  pin_hash text,                    -- scrypt "salt:hash". NUNCA o PIN em claro.
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  ultimo_acesso_em timestamptz
);

-- Uma conta por CPF: evita o mesmo cliente duplicado em cadastros diferentes.
CREATE UNIQUE INDEX IF NOT EXISTS clientes_perfil_cpf_uidx ON public.clientes_perfil (cpf);
CREATE INDEX IF NOT EXISTS clientes_perfil_criado_idx     ON public.clientes_perfil (criado_em DESC);
CREATE INDEX IF NOT EXISTS clientes_perfil_email_idx      ON public.clientes_perfil (lower(email));
CREATE INDEX IF NOT EXISTS clientes_perfil_nome_idx       ON public.clientes_perfil (lower(nome_completo));

-- Integridade dos formatos: barra lixo antes de virar registro.
ALTER TABLE public.clientes_perfil DROP CONSTRAINT IF EXISTS clientes_perfil_cpf_formato;
ALTER TABLE public.clientes_perfil ADD CONSTRAINT clientes_perfil_cpf_formato CHECK (cpf ~ '^[0-9]{11}$');

ALTER TABLE public.clientes_perfil DROP CONSTRAINT IF EXISTS clientes_perfil_telefone_formato;
ALTER TABLE public.clientes_perfil ADD CONSTRAINT clientes_perfil_telefone_formato CHECK (telefone ~ '^[0-9]{10,13}$');

-- atualizado_em automÃ¡tico (public.touch_updated_at usa a coluna updated_at,
-- entÃ£o esta tabela tem gatilho prÃ³prio).
CREATE OR REPLACE FUNCTION public.touch_clientes_perfil()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS clientes_perfil_touch ON public.clientes_perfil;
CREATE TRIGGER clientes_perfil_touch BEFORE UPDATE ON public.clientes_perfil
  FOR EACH ROW EXECUTE FUNCTION public.touch_clientes_perfil();

-- ----------------------------------------------------------------------------
-- RLS â€” o cliente lÃª e edita SÃ“ o prÃ³prio perfil; o admin lÃª todos;
--       anon nÃ£o enxerga nada. Escrita sempre pelo backend (service_role).
-- ----------------------------------------------------------------------------
ALTER TABLE public.clientes_perfil ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.clientes_perfil TO service_role;
GRANT SELECT ON public.clientes_perfil TO authenticated;
REVOKE ALL ON public.clientes_perfil FROM anon;

DROP POLICY IF EXISTS "clientes_perfil leitura dono ou admin" ON public.clientes_perfil;
CREATE POLICY "clientes_perfil leitura dono ou admin" ON public.clientes_perfil
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "clientes_perfil sem acesso anon" ON public.clientes_perfil;
CREATE POLICY "clientes_perfil sem acesso anon" ON public.clientes_perfil
  FOR ALL TO anon USING (false) WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
