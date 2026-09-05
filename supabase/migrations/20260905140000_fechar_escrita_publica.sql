-- ============================================================================
-- FECHAR A ESCRITA PUBLICA DAS TABELAS DO PAINEL
--
-- Ate agora a chave publica do site — a que vai em toda pagina, visivel a
-- qualquer visitante — podia CRIAR, EDITAR e APAGAR pedidos. A senha do painel
-- oculto nao protegia nada: bastava falar direto com o banco.
--
-- Testado antes desta migracao, com a chave publica:
--   LER pedidos ...... SIM
--   CRIAR pedido ..... SIM
--   APAGAR pedido .... SIM
--
-- E as tabelas de formulario (reclamacoes, notas, cotacoes) podiam ser LIDAS
-- por qualquer um. Elas guardam nome, e-mail e telefone de cliente.
--
-- Depois daqui:
--   pedidos          -> leitura publica (o rastreio do site precisa dela)
--                       escrita SO pelo servidor
--   formularios      -> qualquer um ENVIA (e o objetivo deles)
--                       leitura SO pelo servidor
--
-- O rastreio do site continua funcionando para qualquer pessoa, sem login.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Pedidos: qualquer um consulta, so o servidor altera
-- ----------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.pedidos FROM anon, authenticated;
GRANT  SELECT                  ON public.pedidos TO   anon, authenticated;

-- ----------------------------------------------------------------------------
-- Formularios do site: qualquer um envia, so o servidor le
--
-- O envio precisa continuar aberto — sao formularios publicos, preenchidos por
-- quem nao tem conta. O que nao pode e' qualquer pessoa LER o que os outros
-- escreveram, porque ali tem nome, e-mail e telefone.
-- ----------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['reclamacoes', 'solicitacoes_nf', 'cotacoes_frete'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('REVOKE SELECT, UPDATE, DELETE ON public.%I FROM anon, authenticated', t);
      EXECUTE format('GRANT  INSERT                ON public.%I TO   anon, authenticated', t);
      EXECUTE format('GRANT  ALL                   ON public.%I TO   service_role', t);
    END IF;
  END LOOP;
END $$;

-- O servidor (service_role) passa por cima de tudo isso, como sempre passou.
GRANT ALL ON public.pedidos TO service_role;
