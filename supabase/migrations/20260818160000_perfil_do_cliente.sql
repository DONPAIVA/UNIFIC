-- ============================================================================
-- PERFIL DO CLIENTE — nome, telefone, CPF e PIN de atendimento.
-- Execute no SQL Editor do Supabase APÓS
-- 20260818120000_notificacoes_completas.sql.
-- ============================================================================
--
-- 100% ADITIVA. Nenhuma tabela existente é tocada.
--
-- O QUE ESTA TABELA GUARDA
-- O Supabase Auth já cuida do e-mail e da senha. O que falta é o cadastro
-- comercial do cliente — quem é a pessoa por trás do login — para o
-- atendimento identificar, emitir nota e localizar pedidos.
--
-- O QUE ELA NÃO GUARDA
-- Senha. A senha vive só no auth.users do Supabase, em hash, e nem o
-- administrador consegue lê-la. O PIN também NÃO é gravado em claro: só o
-- hash scrypt, calculado no servidor (src/lib/server/perfil.server.ts).
--
-- LGPD
-- CPF é dado pessoal. A CentralML mostra mascarado (123.***.**9-00) por
-- padrão, e toda revelação do valor completo passa pela auditoria em
-- admin_audit_log. A regra abaixo garante que ninguém além do dono e do
-- administrador consiga ler estas linhas.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.clientes_perfil (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  nome_completo text NOT NULL,
  email text,
  telefone text NOT NULL,           -- só dígitos, com DDD
  cpf text NOT NULL,                -- só dígitos, 11 posições
  pin_hash text,                    -- scrypt "salt:hash". NUNCA o PIN em claro.
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  ultimo_acesso_em timestamptz
);

-- Uma conta por CPF: evita o mesmo cliente duplicado em cadastros diferentes.
CREATE UNIQUE INDEX IF NOT EXISTS clientes_perfil_cpf_uidx ON public.clientes_perfil (cpf);
CREATE INDEX IF NOT EXISTS clientes_perfil_criado_idx     ON public.clientes_perfil (criado_em DESC);
CREATE INDEX IF NOT EXISTS clientes_perfil_email_idx      ON public.clientes_perfil (lower(email));
CREATE INDEX IF NOT EXISTS clientes_perfil_nome_idx       ON public.clientes_perfil (lower(nome_completo));

-- Integridade dos formatos: barra lixo antes de virar registro.
ALTER TABLE public.clientes_perfil DROP CONSTRAINT IF EXISTS clientes_perfil_cpf_formato;
ALTER TABLE public.clientes_perfil ADD CONSTRAINT clientes_perfil_cpf_formato CHECK (cpf ~ '^[0-9]{11}$');

ALTER TABLE public.clientes_perfil DROP CONSTRAINT IF EXISTS clientes_perfil_telefone_formato;
ALTER TABLE public.clientes_perfil ADD CONSTRAINT clientes_perfil_telefone_formato CHECK (telefone ~ '^[0-9]{10,13}$');

-- atualizado_em automático (public.touch_updated_at usa a coluna updated_at,
-- então esta tabela tem gatilho próprio).
CREATE OR REPLACE FUNCTION public.touch_clientes_perfil()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS clientes_perfil_touch ON public.clientes_perfil;
CREATE TRIGGER clientes_perfil_touch BEFORE UPDATE ON public.clientes_perfil
  FOR EACH ROW EXECUTE FUNCTION public.touch_clientes_perfil();

-- ----------------------------------------------------------------------------
-- RLS — o cliente lê e edita SÓ o próprio perfil; o admin lê todos;
--       anon não enxerga nada. Escrita sempre pelo backend (service_role).
-- ----------------------------------------------------------------------------
ALTER TABLE public.clientes_perfil ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.clientes_perfil TO service_role;
GRANT SELECT ON public.clientes_perfil TO authenticated;
REVOKE ALL ON public.clientes_perfil FROM anon;

DROP POLICY IF EXISTS "clientes_perfil leitura dono ou admin" ON public.clientes_perfil;
CREATE POLICY "clientes_perfil leitura dono ou admin" ON public.clientes_perfil
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "clientes_perfil sem acesso anon" ON public.clientes_perfil;
CREATE POLICY "clientes_perfil sem acesso anon" ON public.clientes_perfil
  FOR ALL TO anon USING (false) WITH CHECK (false);

NOTIFY pgrst, 'reload schema';
