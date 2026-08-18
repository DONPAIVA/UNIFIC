-- ============================================================
-- Fluxo do COMPRADOR: registro do feedback do pedido.
-- Apenas colunas novas em ml_orders (ADD COLUMN IF NOT EXISTS).
-- Nenhuma tabela criada, nenhuma coluna removida ou alterada.
-- ============================================================

ALTER TABLE public.ml_orders
  ADD COLUMN IF NOT EXISTS buyer_feedback_at timestamptz,
  ADD COLUMN IF NOT EXISTS buyer_feedback_status text,   -- fulfilled | not_fulfilled
  ADD COLUMN IF NOT EXISTS buyer_feedback_rating text;   -- positive | neutral | negative

CREATE INDEX IF NOT EXISTS ml_orders_feedback_idx
  ON public.ml_orders (account_id, buyer_feedback_at);
