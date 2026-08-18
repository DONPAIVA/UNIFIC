-- ============================================================================
-- MULTI-TENANCY — cada conexão do Mercado Livre pertence a UM cliente.
-- Execute no SQL Editor do Supabase APÓS 20260814170000_reconciliacao_centralml.sql.
-- ============================================================================
--
-- 100% ADITIVA e IDEMPOTENTE. Nenhuma tabela removida, nenhuma coluna
-- apagada ou renomeada, nenhum dado destruído.
--
-- O isolamento real é aplicado no backend (src/lib/server/auth.server.ts):
-- todas as consultas filtram por owner_user_id / account_id do usuário
-- autenticado. As policies abaixo são a SEGUNDA barreira, para o caso de
-- alguém consultar o Supabase diretamente com a chave publicável.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Índices de posse
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ml_connections_owner_idx
  ON public.ml_connections (owner_user_id);

CREATE INDEX IF NOT EXISTS ml_oauth_states_owner_idx
  ON public.ml_oauth_states (owner_user_id);

-- Um mesmo cliente não pode ter a mesma conta ML duplicada.
-- (o índice provider+ml_user_id já garante uma conexão por conta ML no sistema)
CREATE INDEX IF NOT EXISTS ml_connections_owner_provider_idx
  ON public.ml_connections (owner_user_id, provider);

-- Consultas por conta nas tabelas de dados
CREATE INDEX IF NOT EXISTS ml_orders_account_idx           ON public.ml_orders (account_id);
CREATE INDEX IF NOT EXISTS ml_shipments_account_only_idx   ON public.ml_shipments (account_id);
CREATE INDEX IF NOT EXISTS ml_shipment_events_account_idx  ON public.ml_shipment_events (account_id);
CREATE INDEX IF NOT EXISTS ml_webhook_events_mluser_idx    ON public.ml_webhook_events (ml_user_id);

-- ----------------------------------------------------------------------------
-- 2) Quem é o dono de uma conexão? (helper para as policies)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owns_account(conta uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ml_connections c
     WHERE c.id = conta
       AND c.owner_user_id = auth.uid()
  );
$$;
REVOKE ALL ON FUNCTION public.owns_account(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.owns_account(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3) RLS: o cliente lê os PRÓPRIOS dados; o admin lê tudo; anon não lê nada.
--    Substitui as policies "leitura admin" criadas na migration anterior,
--    que davam acesso apenas a administradores.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ml_orders', 'ml_shipments', 'ml_shipment_events', 'ml_sync_runs',
    'admin_audit_log', 'system_logs', 'rastreio_consultas'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);

    EXECUTE format('DROP POLICY IF EXISTS "%s leitura admin" ON public.%I', t, t);
    EXECUTE format('DROP POLICY IF EXISTS "%s leitura dono ou admin" ON public.%I', t, t);
    EXECUTE format($f$
      CREATE POLICY "%1$s leitura dono ou admin" ON public.%1$I
      FOR SELECT TO authenticated
      USING (
        public.is_admin(auth.uid())
        OR (account_id IS NOT NULL AND public.owns_account(account_id))
      )
    $f$, t);

    EXECUTE format('DROP POLICY IF EXISTS "%s sem acesso anon" ON public.%I', t, t);
    EXECUTE format(
      'CREATE POLICY "%s sem acesso anon" ON public.%I FOR ALL TO anon USING (false) WITH CHECK (false)', t, t);
  END LOOP;
END $$;

-- ml_webhook_events não tem account_id: o vínculo é por ml_user_id.
ALTER TABLE public.ml_webhook_events ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.ml_webhook_events TO service_role;
GRANT SELECT ON public.ml_webhook_events TO authenticated;
REVOKE ALL ON public.ml_webhook_events FROM anon;

DROP POLICY IF EXISTS "ml_webhook_events leitura admin" ON public.ml_webhook_events;
DROP POLICY IF EXISTS "ml_webhook_events leitura dono ou admin" ON public.ml_webhook_events;
CREATE POLICY "ml_webhook_events leitura dono ou admin" ON public.ml_webhook_events
  FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.ml_connections c
       WHERE c.ml_user_id = public.ml_webhook_events.ml_user_id
         AND c.owner_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "ml_webhook_events sem acesso anon" ON public.ml_webhook_events;
CREATE POLICY "ml_webhook_events sem acesso anon" ON public.ml_webhook_events
  FOR ALL TO anon USING (false) WITH CHECK (false);

-- ----------------------------------------------------------------------------
-- 4) ml_connections e ml_oauth_states continuam SEM acesso via anon/authenticated.
--    Elas guardam access_token/refresh_token/code_verifier: só o backend
--    (service_role) toca nelas. O cliente recebe os dados já filtrados pelas
--    server functions, sem token algum.
-- ----------------------------------------------------------------------------
ALTER TABLE public.ml_connections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ml_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ml_connections  FROM anon, authenticated;
REVOKE ALL ON public.ml_oauth_states FROM anon, authenticated;

DROP POLICY IF EXISTS "ml_connections sem acesso publico" ON public.ml_connections;
CREATE POLICY "ml_connections sem acesso publico" ON public.ml_connections
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "ml_oauth_states sem acesso publico" ON public.ml_oauth_states;
CREATE POLICY "ml_oauth_states sem acesso publico" ON public.ml_oauth_states
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- ----------------------------------------------------------------------------
-- 5) Conexões órfãs criadas antes do login obrigatório
--    Elas não pertencem a ninguém e ficariam invisíveis para todos os clientes.
--    Marcamos para reconexão em vez de apagar (nenhum dado é destruído).
-- ----------------------------------------------------------------------------
UPDATE public.ml_connections
   SET status = 'reauth_required',
       last_error = 'Conexão criada antes do login obrigatório: reconecte para vincular ao seu cadastro.',
       reauth_required_at = COALESCE(reauth_required_at, now())
 WHERE owner_user_id IS NULL
   AND status <> 'disconnected';

NOTIFY pgrst, 'reload schema';
