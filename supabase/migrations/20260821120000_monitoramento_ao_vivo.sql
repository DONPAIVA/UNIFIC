-- ============================================================================
-- MONITORAMENTO AO VIVO — quem está no site agora e quem tenta entrar no painel
-- Execute no SQL Editor do Supabase.
-- ============================================================================
--
-- 100% ADITIVA. Duas tabelas novas, nada existente é tocado.
--
-- DUAS PERGUNTAS DIFERENTES, DUAS TABELAS
--
--   presenca_online   -> quem está COM O SITE ABERTO agora
--                        Uma linha por aba aberta, atualizada a cada 30 s.
--                        É um retrato do presente: linhas velhas não valem nada
--                        e são descartadas.
--
--   tentativas_painel -> quem TENTOU entrar no Olho de Deus ML
--                        Histórico permanente, com acerto e erro. É aqui que
--                        aparece quem está tentando adivinhar senha.
--
-- Separadas de propósito: misturar presença (volátil, muito volume) com
-- tentativa de acesso (raro, precisa durar) daria uma tabela ruim para as duas
-- coisas.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Presença — quem está online neste instante
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.presenca_online (
  -- Identificador da ABA, gerado no navegador. Não é o usuário: a mesma pessoa
  -- com duas abas abertas aparece duas vezes, que é o comportamento correto.
  sessao_id text PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  nome text,
  ip text,
  navegador text,
  pagina text,
  -- Está na área administrativa? Destaca no painel quem circula pelo /centralml.
  no_painel boolean NOT NULL DEFAULT false,
  entrou_em timestamptz NOT NULL DEFAULT now(),
  visto_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS presenca_online_visto_idx ON public.presenca_online (visto_em DESC);
CREATE INDEX IF NOT EXISTS presenca_online_user_idx  ON public.presenca_online (user_id);

-- ----------------------------------------------------------------------------
-- 2) Tentativas de acesso ao painel
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tentativas_painel (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  ip text,
  navegador text,
  sucesso boolean NOT NULL DEFAULT false,
  -- senha_errada | sem_permissao | ok | bloqueado
  motivo text,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tentativas_painel_criado_idx ON public.tentativas_painel (criado_em DESC);
CREATE INDEX IF NOT EXISTS tentativas_painel_ip_idx     ON public.tentativas_painel (ip, criado_em DESC);
-- Consulta mais importante do alerta: as falhas recentes.
CREATE INDEX IF NOT EXISTS tentativas_painel_falhas_idx
  ON public.tentativas_painel (criado_em DESC) WHERE sucesso = false;

-- ----------------------------------------------------------------------------
-- 3) RLS — só o backend escreve; só o admin lê.
--
-- IP e navegador de clientes são dados pessoais: a lista fica restrita a quem
-- administra, e o cliente não enxerga a própria linha nem a dos outros.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['presenca_online','tentativas_painel'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);

    EXECUTE format('DROP POLICY IF EXISTS "%s leitura admin" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "%s leitura admin" ON public.%I FOR SELECT TO authenticated USING (public.is_admin(auth.uid()))',
      t, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s sem acesso anon" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "%s sem acesso anon" ON public.%I FOR ALL TO anon USING (false) WITH CHECK (false)', t, t);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
