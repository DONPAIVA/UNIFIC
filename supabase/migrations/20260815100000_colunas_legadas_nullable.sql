-- ============================================================================
-- Colunas LEGADAS de ml_orders deixam de ser obrigatórias.
-- Execute no SQL Editor do Supabase.
-- ============================================================================
--
-- POR QUE
-- A tabela ml_orders veio do schema antigo, onde o identificador do pedido era
-- `order_id` (NOT NULL). O código atual grava `ml_order_id` (padrão novo,
-- com UNIQUE por account_id) e nunca preenche `order_id`. Resultado: a
-- PRIMEIRA sincronização real falha com
--   23502 null value in column "order_id" violates not-null constraint
-- e nenhum pedido entra no banco.
--
-- Este arquivo apenas RELAXA a obrigatoriedade das colunas legadas.
-- NENHUMA coluna é removida e NENHUM dado é apagado — as colunas continuam
-- existindo com os valores antigos.
-- ============================================================================

DO $$
DECLARE
  col text;
BEGIN
  -- Colunas do schema antigo que o código atual não escreve mais.
  FOREACH col IN ARRAY ARRAY['order_id', 'ml_user_id', 'shipment_id', 'tracking_code', 'buyer_email'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name  = 'ml_orders'
         AND column_name = col
         AND is_nullable = 'NO'
    ) THEN
      EXECUTE format('ALTER TABLE public.ml_orders ALTER COLUMN %I DROP NOT NULL', col);
      RAISE NOTICE 'ml_orders.% agora aceita NULL', col;
    END IF;
  END LOOP;

  -- Mesma situação em ml_connections: token_expires_at foi substituído por
  -- expires_at; access_token pode ficar vazio numa conta desconectada.
  FOREACH col IN ARRAY ARRAY['token_expires_at', 'access_token'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name  = 'ml_connections'
         AND column_name = col
         AND is_nullable = 'NO'
    ) THEN
      EXECUTE format('ALTER TABLE public.ml_connections ALTER COLUMN %I DROP NOT NULL', col);
      RAISE NOTICE 'ml_connections.% agora aceita NULL', col;
    END IF;
  END LOOP;
END $$;

-- Mantém as colunas legadas coerentes para quem ainda as consulta:
-- espelha ml_order_id -> order_id nas gravações novas.
CREATE OR REPLACE FUNCTION public.ml_orders_espelha_legado()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF to_jsonb(NEW) ? 'order_id' AND NEW.order_id IS NULL THEN
    NEW.order_id := NEW.ml_order_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ml_orders_legado ON public.ml_orders;
CREATE TRIGGER ml_orders_legado
  BEFORE INSERT OR UPDATE ON public.ml_orders
  FOR EACH ROW EXECUTE FUNCTION public.ml_orders_espelha_legado();

NOTIFY pgrst, 'reload schema';
