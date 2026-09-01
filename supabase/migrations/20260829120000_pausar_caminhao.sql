-- ============================================================================
-- PAUSAR O CAMINHAO DE UM RASTREIO
--
-- Com o progresso manual, a porcentagem ja fica parada onde foi colocada. O
-- que continuava acontecendo era o caminhao BALANCAR no mapa e o painel dizer
-- "Carga em movimento agora" — dando a impressao de que andava.
--
-- Esta coluna congela isso. Para quem acompanha o rastreio nada e' anunciado:
-- nao ha aviso de "pausado" em lugar nenhum, o caminhao apenas nao se mexe.
--
-- 100% ADITIVA: uma coluna nova com valor padrao, sem gatilho, sem tocar em
-- nada existente. Todos os pedidos atuais nascem com false, ou seja, seguem
-- exatamente como estao hoje. Pode rodar com o site no ar.
-- ============================================================================

ALTER TABLE public.pedidos
  ADD COLUMN IF NOT EXISTS pausado boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.pedidos.pausado IS
  'Caminhao congelado no mapa. Nada e mostrado ao cliente sobre a pausa.';
