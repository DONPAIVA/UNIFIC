-- ============================================================================
-- DE QUAL PAINEL VEIO CADA TENTATIVA DE ENTRADA
--
-- A Olho de Deus ML e o painel de rastreios gravam as tentativas de login na
-- mesma tabela, e nao havia como saber qual dos dois estava sendo acessado.
--
-- Valores aceitos:
--   'olho_de_deus'  -> a central do Mercado Livre (/centralml)
--   'rastreios'     -> o painel de cadastro de rastreios (o do mascote)
--
-- Registros antigos ficam NULL: foram gravados antes da separacao e nao ha
-- como descobrir de qual painel vieram.
--
-- 100% ADITIVA: uma coluna nova. Pode rodar com o site no ar.
-- ============================================================================

ALTER TABLE public.tentativas_painel
  ADD COLUMN IF NOT EXISTS painel text;

ALTER TABLE public.tentativas_painel DROP CONSTRAINT IF EXISTS tentativas_painel_painel_valido;
ALTER TABLE public.tentativas_painel ADD CONSTRAINT tentativas_painel_painel_valido
  CHECK (painel IS NULL OR painel IN ('olho_de_deus', 'rastreios'));
