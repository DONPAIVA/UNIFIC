-- ============================================================================
-- BLOQUEIO DE CLIENTES — o administrador tira o acesso de alguém ao Únific+.
-- Execute no SQL Editor do Supabase.
-- ============================================================================
--
-- 100% ADITIVA. Uma tabela nova, nada existente é tocado.
--
-- POR QUE UMA TABELA SEPARADA, E NÃO UMA COLUNA EM clientes_perfil
-- `clientes_perfil` só tem linha para quem se cadastrou pelo formulário novo
-- (nome, telefone, CPF, PIN). Clientes antigos não têm perfil nenhum — e são
-- justamente os que mais podem precisar ser bloqueados.
--
-- Aqui a chave é o usuário do Auth. Funciona para TODO mundo que consegue
-- entrar, com perfil ou sem.
--
-- O bloqueio é reversível: desbloquear é apagar a linha.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.clientes_bloqueados (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  motivo text,
  bloqueado_em timestamptz NOT NULL DEFAULT now(),
  -- E-mail do administrador que bloqueou. Fica aqui além da auditoria para a
  -- tela conseguir mostrar quem foi sem uma segunda consulta.
  bloqueado_por text
);

CREATE INDEX IF NOT EXISTS clientes_bloqueados_em_idx ON public.clientes_bloqueados (bloqueado_em DESC);
CREATE INDEX IF NOT EXISTS clientes_bloqueados_email_idx ON public.clientes_bloqueados (lower(email));

-- ----------------------------------------------------------------------------
-- RLS — só o backend escreve; só o admin lê.
--
-- O cliente bloqueado NÃO precisa (nem deve) ler esta tabela: quem informa o
-- bloqueio a ele é o servidor, na resposta. Deixar a lista legível entregaria
-- de graça quem mais está bloqueado.
-- ----------------------------------------------------------------------------
ALTER TABLE public.clientes_bloqueados ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.clientes_bloqueados TO service_role;
GRANT SELECT ON public.clientes_bloqueados TO authenticated;
REVOKE ALL ON public.clientes_bloqueados FROM anon;

DROP POLICY IF EXISTS "clientes_bloqueados leitura admin" ON public.clientes_bloqueados;
CREATE POLICY "clientes_bloqueados leitura admin" ON public.clientes_bloqueados
  FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "clientes_bloqueados sem acesso anon" ON public.clientes_bloqueados;
CREATE POLICY "clientes_bloqueados sem acesso anon" ON public.clientes_bloqueados
  FOR ALL TO anon USING (false) WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
