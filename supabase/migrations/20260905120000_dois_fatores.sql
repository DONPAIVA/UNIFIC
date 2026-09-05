-- ============================================================================
-- VERIFICACAO EM DUAS ETAPAS PARA O PAINEL (OLHO DE DEUS ML)
--
-- Hoje o painel abre so com e-mail e senha. Quem descobrir a senha entra e ve
-- tudo: contas, tokens, pedidos, dados de cliente. O segundo fator torna a
-- senha sozinha insuficiente.
--
-- Usa aplicativo autenticador (Google Authenticator, Authy, 1Password...), que
-- gera um numero de 6 digitos a cada 30 segundos. Foi escolhido por NAO
-- depender de envio de e-mail nem de SMS, que este projeto nao tem.
--
-- Duas tabelas:
--   admin_2fa          -> o segredo de cada administrador
--   admin_2fa_sessoes  -> quais sessoes ja passaram pela verificacao
--
-- A segunda existe para a trava valer NO SERVIDOR. Sem ela, a verificacao
-- seria so uma tela: quem chamasse as funcoes por fora passaria por cima.
--
-- 100% ADITIVA: duas tabelas novas. Nada existente e' tocado. Enquanto nenhum
-- administrador ativar, o painel continua abrindo exatamente como abre hoje.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.admin_2fa (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Segredo em base32, como os aplicativos autenticadores esperam.
  segredo       text NOT NULL,
  -- So vale depois que o administrador digitou um codigo certo. Sem isso, um
  -- segredo gerado e nunca guardado no celular trancaria a propria conta.
  confirmado    boolean NOT NULL DEFAULT false,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  confirmado_em timestamptz
);

-- Sessoes que ja passaram pela verificacao.
-- Guardamos o HASH do token de acesso, nunca o token: quem lesse a tabela nao
-- conseguiria se passar por ninguem.
CREATE TABLE IF NOT EXISTS public.admin_2fa_sessoes (
  token_hash text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  criado_em  timestamptz NOT NULL DEFAULT now(),
  expira_em  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_2fa_sessoes_expira_idx
  ON public.admin_2fa_sessoes (expira_em);

-- Nenhuma das duas e' exposta ao navegador: so o servidor (service_role) le e
-- escreve. RLS ligada e SEM politica = ninguem mais alcanca.
ALTER TABLE public.admin_2fa          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_2fa_sessoes  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_2fa         FROM anon, authenticated;
REVOKE ALL ON public.admin_2fa_sessoes FROM anon, authenticated;
GRANT ALL ON public.admin_2fa          TO service_role;
GRANT ALL ON public.admin_2fa_sessoes  TO service_role;

COMMENT ON TABLE public.admin_2fa IS
  'Segredo do segundo fator de cada administrador do painel.';
COMMENT ON TABLE public.admin_2fa_sessoes IS
  'Sessoes que ja passaram pelo segundo fator. Guarda o hash do token, nunca o token.';
