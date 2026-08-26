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
