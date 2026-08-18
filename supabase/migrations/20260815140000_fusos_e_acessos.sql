-- ============================================================================
-- 1) HORÁRIOS CERTOS  2) TABELA `acessos` DE VOLTA
-- Execute no SQL Editor do Supabase.
-- ============================================================================
--
-- PROBLEMA 1 — horários 3 horas adiantados
-- Algumas colunas de data ficaram como `timestamp WITHOUT time zone`.
-- O aplicativo grava sempre em UTC (toISOString), mas o Postgres devolve o
-- valor SEM o marcador de fuso. O navegador então lê "12:49" como horário
-- LOCAL (UTC-3) e mostra "15:49" — três horas no futuro.
--
-- Comprovado no banco: gravadas no MESMO instante,
--   last_activity_at = 2026-08-15T12:49:52.345+00:00   (correto)
--   last_sync_at     = 2026-08-15T12:49:52.345         (vira 15:49 na tela)
--
-- A conversão abaixo NÃO muda o instante armazenado: apenas informa ao
-- Postgres que aquele valor sempre foi UTC. Nenhum dado é perdido.
--
-- PROBLEMA 2 — a tabela public.acessos não existe mais
-- Ela registra as visitas ao site. Sem ela, o log de acesso falha em silêncio.
-- Recriada exatamente como na migration original, com IF NOT EXISTS.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Colunas de data: passar para timestamptz interpretando o valor como UTC
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  alvo record;
BEGIN
  FOR alvo IN
    SELECT c.table_name, c.column_name
      FROM information_schema.columns c
     WHERE c.table_schema = 'public'
       AND c.data_type = 'timestamp without time zone'
       AND c.table_name IN (
         'ml_connections', 'ml_orders', 'ml_shipments', 'ml_shipment_events',
         'ml_sync_runs', 'ml_webhook_events', 'ml_oauth_states',
         'admin_audit_log', 'system_logs', 'rastreio_consultas',
         'admin_users', 'pedidos', 'reclamacoes', 'solicitacoes_nf', 'cotacoes_frete'
       )
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE ''UTC''',
      alvo.table_name, alvo.column_name, alvo.column_name
    );
    RAISE NOTICE 'convertido para timestamptz: %.%', alvo.table_name, alvo.column_name;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 2) Recria a tabela de acessos (registro de visitas)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.acessos (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ip text,
  action text NOT NULL DEFAULT 'visita',
  path text,
  user_agent text,
  detail text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS acessos_created_idx ON public.acessos (created_at DESC);
CREATE INDEX IF NOT EXISTS acessos_ip_idx      ON public.acessos (ip);

GRANT ALL ON public.acessos TO service_role;
ALTER TABLE public.acessos ENABLE ROW LEVEL SECURITY;

-- Só o backend escreve (service_role). Leitura apenas para administrador:
-- a tabela guarda IP e user-agent de todos os visitantes.
GRANT SELECT ON public.acessos TO authenticated;
REVOKE ALL ON public.acessos FROM anon;

DROP POLICY IF EXISTS "acessos leitura publica" ON public.acessos;
DROP POLICY IF EXISTS "acessos insercao publica" ON public.acessos;
DROP POLICY IF EXISTS "acessos leitura admin" ON public.acessos;
CREATE POLICY "acessos leitura admin" ON public.acessos
  FOR SELECT TO authenticated USING (public.is_admin(auth.uid()));

DROP POLICY IF EXISTS "acessos sem acesso anon" ON public.acessos;
CREATE POLICY "acessos sem acesso anon" ON public.acessos
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- ----------------------------------------------------------------------------
-- 3) Índices que faltavam para as telas mais pesadas
--    (a latência até o Supabase é alta; menos varredura = tela mais rápida)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ml_orders_conta_data_idx
  ON public.ml_orders (account_id, date_created DESC);
CREATE INDEX IF NOT EXISTS system_logs_conta_data_idx
  ON public.system_logs (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rastreio_consultas_conta_data_idx
  ON public.rastreio_consultas (account_id, created_at DESC);

NOTIFY pgrst, 'reload schema';
