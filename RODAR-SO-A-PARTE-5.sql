-- ============================================================================
-- PARTES 5 e 6 — MONITORAMENTO AO VIVO + BLOQUEIO POR IP
--
-- As partes 1 a 4 ja rodaram. Estas criam SO tabelas novas:
--   presenca_online    (quem esta no site agora)
--   tentativas_painel  (quem tentou entrar no painel)
--   ips_bloqueados     (enderecos barrados)
--
-- Sem gatilhos e sem tocar em tabela existente: nao disputa lock com o
-- aplicativo em uso, entao nao repete o deadlock de antes.
-- ============================================================================

SET lock_timeout = '5s';
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


-- ============================================================================
-- PARTE 6 - BLOQUEIO POR IP
-- ============================================================================

-- ============================================================================
-- BLOQUEIO POR IP — barra um endereço antes de qualquer coisa.
-- Execute no SQL Editor do Supabase.
-- ============================================================================
--
-- 100% ADITIVA. Uma tabela nova. Sem gatilhos, sem tocar em tabela existente —
-- não disputa lock com o aplicativo em uso.
--
-- QUANDO ISTO SERVE
-- Bloquear a CONTA resolve quem tem cadastro. Não resolve quem está tentando
-- adivinhar senha do painel sem conta nenhuma, nem quem volta criando conta
-- nova. Para esses casos o que identifica é o endereço.
--
-- O QUE ESPERAR — e o que NÃO esperar
-- IP residencial muda: quem for bloqueado pode voltar em minutos com outro
-- endereço. E um IP pode ser compartilhado por um prédio inteiro ou por uma
-- operadora de celular — bloquear um pode barrar gente inocente junto.
--
-- Ou seja: é bom contra insistência e tentativa de invasão em curso. Não é
-- barreira definitiva contra ninguém determinado.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.ips_bloqueados (
  ip text PRIMARY KEY,
  motivo text,
  bloqueado_em timestamptz NOT NULL DEFAULT now(),
  bloqueado_por text,
  -- Quantas vezes esse IP bateu na porta depois de bloqueado. Ajuda a
  -- distinguir quem desistiu de quem continua tentando.
  tentativas_apos integer NOT NULL DEFAULT 0,
  ultima_tentativa_em timestamptz
);

CREATE INDEX IF NOT EXISTS ips_bloqueados_em_idx ON public.ips_bloqueados (bloqueado_em DESC);

ALTER TABLE public.ips_bloqueados ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ips_bloqueados TO service_role;
GRANT SELECT ON public.ips_bloqueados TO authenticated;
REVOKE ALL ON public.ips_bloqueados FROM anon;

DROP POLICY IF EXISTS "ips_bloqueados leitura admin" ON public.ips_bloqueados;
CREATE POLICY "ips_bloqueados leitura admin" ON public.ips_bloqueados
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "ips_bloqueados sem acesso anon" ON public.ips_bloqueados;
CREATE POLICY "ips_bloqueados sem acesso anon" ON public.ips_bloqueados
  FOR ALL TO anon USING (false) WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
