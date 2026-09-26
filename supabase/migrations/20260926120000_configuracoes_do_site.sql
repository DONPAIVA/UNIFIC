-- ============================================================================
-- CONFIGURACOES DO SITE (liga/desliga pelo painel)
--
-- Primeira chave: 'rastreio_livre'.
--   true  -> qualquer pessoa rastreia direto, sem autorizar o Mercado Livre
--   false -> o rastreio exige a conta do Mercado Livre autorizada (padrao)
--
-- Uma tabela de chave/valor, e nao uma coluna por opcao: a proxima chave que
-- aparecer entra sem precisar de outro SQL.
--
-- Sem acesso publico. Quem le e escreve e' o servidor (service_role):
--   - o site pergunta por uma funcao publica que so devolve o liga/desliga;
--   - so o administrador, com o codigo de 2 etapas, consegue mudar.
-- Se a chave publica pudesse escrever aqui, qualquer visitante desligaria a
-- trava do rastreio.
--
-- 100% ADITIVA. Enquanto a tabela estiver vazia o site segue exatamente como
-- esta hoje (rastreio exige o Mercado Livre).
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.configuracoes_site (
  chave          text PRIMARY KEY,
  valor          jsonb NOT NULL,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  atualizado_por text
);

ALTER TABLE public.configuracoes_site ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.configuracoes_site FROM anon, authenticated;
GRANT  ALL ON public.configuracoes_site TO service_role;

COMMENT ON TABLE public.configuracoes_site IS
  'Liga/desliga do site controlado pelo painel. Ex.: rastreio_livre.';
