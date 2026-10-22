-- ============================================================================
-- AUTORIZACAO DO MERCADO LIVRE ESCOLHIDA POR PEDIDO
--
-- Ate aqui o rastreio livre era um botao so, para o site inteiro. Para mandar
-- UM cliente autorizar o Mercado Livre era preciso desligar o rastreio livre,
-- e ai TODOS os outros passavam a ser redirecionados ao rastrear — e achavam
-- estranho.
--
-- Esta coluna deixa escolher pedido a pedido:
--   NULL      -> segue o botao "Rastreio livre" (o comportamento de hoje)
--   'exigir'  -> sempre manda autorizar o Mercado Livre, mesmo com o
--                rastreio livre ligado
--   'livre'   -> nunca manda autorizar, mesmo com o rastreio livre desligado
--
-- 100% ADITIVA: coluna nova, nula por padrao. Todos os pedidos atuais nascem
-- com NULL, ou seja, seguem exatamente como estao hoje. Pode rodar com o site
-- no ar.
-- ============================================================================

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS autorizacao_ml text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_autorizacao_ml_check'
  ) THEN
    ALTER TABLE public.pedidos
      ADD CONSTRAINT pedidos_autorizacao_ml_check
      CHECK (autorizacao_ml IS NULL OR autorizacao_ml IN ('exigir', 'livre'));
  END IF;
END $$;

COMMENT ON COLUMN public.pedidos.autorizacao_ml IS
  'NULL = segue o rastreio livre; exigir = sempre pede o Mercado Livre; livre = nunca pede.';

-- O PostgREST so enxerga a coluna nova depois de recarregar o esquema.
NOTIFY pgrst, 'reload schema';
