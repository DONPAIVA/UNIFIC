-- ============================================================================
-- AJUSTE DA DATA/HORA DE CADA EVENTO DO HISTORICO
--
-- O historico de movimentacao e' montado a partir de duas ancoras: a coleta e
-- a entrega prevista. Os eventos do meio caem em proporcoes fixas entre elas,
-- e nao havia como acertar um deles em especifico.
--
-- Esta coluna guarda so os eventos que foram AJUSTADOS A MAO, no formato
--   { "0": "2026-09-03T17:50", "4": "2026-09-05T09:15" }
-- onde a chave e' a posicao do evento na lista. Os que nao aparecem seguem
-- sendo calculados como sempre foram.
--
-- Guardar so as excecoes (e nao a lista inteira) mantem o historico vivo: se
-- a data de envio ou a entrega prevista mudar, os eventos nao ajustados
-- acompanham sozinhos.
--
-- 100% ADITIVA: uma coluna nova, sem gatilho, sem tocar em nada existente.
-- Todos os pedidos atuais nascem com NULL. Pode rodar com o site no ar.
-- ============================================================================

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS eventos_ajustes jsonb;

COMMENT ON COLUMN public.pedidos.eventos_ajustes IS
  'Data/hora ajustada a mao por evento: {"indice": "AAAA-MM-DDTHH:MM"}. NULL = tudo calculado.';
