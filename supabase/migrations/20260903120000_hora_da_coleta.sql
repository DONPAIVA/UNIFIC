-- ============================================================================
-- HORA DA COLETA POR PEDIDO
--
-- A tabela guarda so a DATA do envio. A hora do primeiro evento do historico
-- ("Objeto postado / coletado") era inventada a partir do codigo de rastreio,
-- sem como ajustar pedido a pedido.
--
-- Esta coluna guarda a hora escolhida a mao, no formato HH:MM. Quando esta
-- NULA, a hora continua sendo calculada como sempre foi — nenhum pedido
-- existente muda, porque todos nascem com NULL.
--
-- 100% ADITIVA: uma coluna nova, sem gatilho, sem tocar em nada existente.
-- Pode rodar com o site no ar.
-- ============================================================================

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS hora_coleta text;

-- Formato conferido pelo banco: HH:MM em 24 horas. Barra digitacao torta
-- antes que ela vire um horario invalido no historico do cliente.
ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_hora_coleta_formato;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_hora_coleta_formato
  CHECK (hora_coleta IS NULL OR hora_coleta ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

COMMENT ON COLUMN public.pedidos.hora_coleta IS
  'Hora da coleta (HH:MM). NULL = calcula sozinho, como antes.';
