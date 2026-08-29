-- ============================================================================
-- PROGRESSO MANUAL DO RASTREIO
--
-- Ate agora a porcentagem era SEMPRE calculada a partir das datas de envio e
-- de entrega prevista. Nao havia como ajustar um pedido especifico: para o
-- caminhao andar mais ou menos, era preciso mexer nas datas, o que muda
-- tambem a previsao mostrada ao cliente.
--
-- Esta coluna guarda um valor escolhido a mao. Quando ela esta preenchida,
-- manda nela; quando esta NULA, o calculo automatico continua valendo como
-- sempre valeu. Nenhum pedido existente muda de comportamento, porque todos
-- nascem com NULL.
--
-- 100% ADITIVA: uma coluna nova, sem gatilho, sem tocar em nada existente.
-- Pode rodar com o site no ar.
-- ============================================================================

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS progresso_manual numeric;

-- Faixa valida: 0 a 100. Fora disso e erro de digitacao, e o banco recusa
-- antes de virar um caminhao parado fora da rota.
ALTER TABLE public.pedidos DROP CONSTRAINT IF EXISTS pedidos_progresso_manual_faixa;
ALTER TABLE public.pedidos ADD CONSTRAINT pedidos_progresso_manual_faixa
  CHECK (progresso_manual IS NULL OR (progresso_manual >= 0 AND progresso_manual <= 100));

COMMENT ON COLUMN public.pedidos.progresso_manual IS
  'Porcentagem definida a mao (0-100). NULL = calcula pelas datas, como antes.';
