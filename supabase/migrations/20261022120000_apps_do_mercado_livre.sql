-- ============================================================================
-- APLICATIVOS DO MERCADO LIVRE CADASTRADOS PELA CENTRAL
--
-- Ate aqui o aplicativo (client_id / client_secret) vinha so do .env do
-- servidor. Trocar exigia editar o .env, reiniciar, e TODAS as contas caiam
-- em "reautorizacao necessaria" na hora: o Mercado Livre amarra cada login ao
-- aplicativo que o criou.
--
-- Com isto:
--   ml_apps                       -> apps cadastrados na Central (secret
--                                    cifrado pelo servidor; nunca em texto)
--   ml_connections.app_client_id  -> com qual app cada conta foi autorizada;
--                                    a renovacao do token usa ESSE app
--   ml_oauth_states.app_client_id -> com qual app a autorizacao comecou, para
--                                    o retorno trocar o code pelo mesmo app
--
-- 100% ADITIVA: tabela e colunas novas, nulas por padrao. Conta com
-- app_client_id NULO continua usando o app do .env, exatamente como hoje.
-- Pode rodar com o site no ar.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ml_apps (
  client_id              text PRIMARY KEY,
  nome                   text,
  client_secret_cifrado  text NOT NULL,
  ativo                  boolean NOT NULL DEFAULT false,
  criado_em              timestamptz NOT NULL DEFAULT now(),
  criado_por             text,
  atualizado_em          timestamptz NOT NULL DEFAULT now()
);

-- No maximo UM app ativo: e ele que as conexoes novas usam.
CREATE UNIQUE INDEX IF NOT EXISTS ml_apps_um_ativo
  ON public.ml_apps (ativo) WHERE ativo;

-- So o servidor (service_role) le e escreve. O navegador nunca ve esta tabela.
ALTER TABLE public.ml_apps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ml_apps FROM anon, authenticated;
GRANT  ALL ON public.ml_apps TO service_role;

ALTER TABLE public.ml_connections
  ADD COLUMN IF NOT EXISTS app_client_id text;

ALTER TABLE public.ml_oauth_states
  ADD COLUMN IF NOT EXISTS app_client_id text;

COMMENT ON COLUMN public.ml_connections.app_client_id IS
  'Client ID do app do ML que autorizou a conta. NULO = app do .env.';

-- O PostgREST so enxerga tabela e colunas novas depois de recarregar o esquema.
NOTIFY pgrst, 'reload schema';
