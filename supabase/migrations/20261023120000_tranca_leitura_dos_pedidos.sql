-- ============================================================================
-- TRANCA A LEITURA PUBLICA DA TABELA `pedidos`
--
-- Ate aqui a chave publica do site (a que vai em toda pagina) conseguia LER a
-- tabela `pedidos` inteira: tracking_code, nome do destinatario, endereco,
-- CEP, CPF, produto, valor e nota fiscal de TODO MUNDO. Bastava chamar
-- GET /rest/v1/pedidos?select=* com a chave que qualquer visitante ve no
-- codigo da pagina. Era vazamento de dado pessoal (inclusive CPF).
--
-- O rastreio do site NAO precisa disso: ele busca UM pedido por codigo ou por
-- CPF, e agora faz isso pelo SERVIDOR (src/lib/rastreio.functions.ts), que
-- devolve so o registro procurado e sem o CPF. O cadastro (criar/editar/apagar)
-- ja passava pelo servidor, atras de administrador + 2FA.
--
-- Depois daqui:
--   anon / authenticated -> NENHUM acesso a `pedidos`
--   service_role (o servidor) -> acesso total, como sempre
--
-- 100% reversivel e sem perder dado: so mexe em permissao e policy.
-- ============================================================================

-- 1) Tira o privilegio de leitura/escrita da chave publica.
REVOKE ALL ON public.pedidos FROM anon, authenticated;

-- 2) Remove a policy antiga, que liberava tudo (USING true), e fecha o acesso.
DROP POLICY IF EXISTS "pedidos publicos" ON public.pedidos;

DROP POLICY IF EXISTS "pedidos sem acesso publico" ON public.pedidos;
CREATE POLICY "pedidos sem acesso publico" ON public.pedidos
  FOR ALL TO anon, authenticated USING (false) WITH CHECK (false);

-- 3) O servidor continua com acesso total.
GRANT ALL ON public.pedidos TO service_role;

-- O PostgREST so aplica a mudanca depois de recarregar o esquema.
NOTIFY pgrst, 'reload schema';
