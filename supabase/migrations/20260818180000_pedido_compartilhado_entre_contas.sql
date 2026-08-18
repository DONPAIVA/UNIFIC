-- ============================================================================
-- O MESMO PEDIDO PODE EXISTIR EM DUAS CONTAS (comprador e vendedor).
-- Execute no SQL Editor do Supabase.
-- ============================================================================
--
-- O SINTOMA
--   Pedido 2000017986518784: valor de chave duplicado viola a restrição
--   exclusiva "ml_orders_order_id_key"
-- A sincronização inteira aborta e a conta fica com status ERRO.
--
-- A CAUSA
-- `ml_orders` veio de um schema antigo em que o identificador era a coluna
-- `order_id`, com UNIQUE GLOBAL. A migration 20260815100000 criou um gatilho
-- que espelha ml_order_id -> order_id para manter esse legado coerente.
--
-- Efeito colateral: aquele UNIQUE passou a valer para a tabela toda, e não por
-- conta. Como um pedido do Mercado Livre tem SEMPRE duas pontas — o comprador
-- e o vendedor — assim que as duas conectam o app, a segunda a sincronizar
-- esbarra na linha da primeira.
--
-- Não é caso raro: é o funcionamento normal de um marketplace.
--
-- A CORREÇÃO
-- Remover o UNIQUE global da coluna legada. A unicidade correta,
-- UNIQUE (account_id, ml_order_id), já existe desde 20260813120000 e continua
-- valendo — cada conta segue com no máximo uma linha por pedido.
--
-- Nenhuma coluna é removida, nenhum dado é apagado, o gatilho continua
-- espelhando o valor para quem ainda consulta a coluna antiga.
-- ============================================================================

DO $$
DECLARE
  nome text;
BEGIN
  -- Constraints UNIQUE que cobrem SOMENTE a coluna order_id.
  FOR nome IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class      rel ON rel.oid = con.conrelid
      JOIN pg_namespace  ns  ON ns.oid  = rel.relnamespace
     WHERE ns.nspname   = 'public'
       AND rel.relname  = 'ml_orders'
       AND con.contype  = 'u'
       AND (
         SELECT array_agg(att.attname::text)
           FROM unnest(con.conkey) AS k(attnum)
           JOIN pg_attribute att
             ON att.attrelid = con.conrelid AND att.attnum = k.attnum
       ) = ARRAY['order_id']
  LOOP
    EXECUTE format('ALTER TABLE public.ml_orders DROP CONSTRAINT %I', nome);
    RAISE NOTICE 'Removida a restricao global %', nome;
  END LOOP;

  -- Índices únicos soltos sobre order_id (sem constraint por trás).
  FOR nome IN
    SELECT i.relname
      FROM pg_index     idx
      JOIN pg_class     i   ON i.oid   = idx.indexrelid
      JOIN pg_class     t   ON t.oid   = idx.indrelid
      JOIN pg_namespace ns  ON ns.oid  = t.relnamespace
     WHERE ns.nspname  = 'public'
       AND t.relname   = 'ml_orders'
       AND idx.indisunique
       AND NOT idx.indisprimary
       AND (
         SELECT array_agg(att.attname::text)
           FROM unnest(idx.indkey) AS k(attnum)
           JOIN pg_attribute att
             ON att.attrelid = idx.indrelid AND att.attnum = k.attnum
       ) = ARRAY['order_id']
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', nome);
    RAISE NOTICE 'Removido o indice unico global %', nome;
  END LOOP;
END $$;

-- Garante a unicidade correta: uma linha por pedido POR CONTA.
CREATE UNIQUE INDEX IF NOT EXISTS ml_orders_conta_pedido_uidx
  ON public.ml_orders (account_id, ml_order_id);

-- Consulta pela coluna legada continua rápida, agora sem exigir unicidade.
CREATE INDEX IF NOT EXISTS ml_orders_order_id_idx ON public.ml_orders (order_id);

NOTIFY pgrst, 'reload schema';
