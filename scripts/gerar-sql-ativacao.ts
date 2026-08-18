/**
 * Gera o SQL de ativação do agendador com os segredos REAIS do .env já
 * preenchidos, para você apenas colar no SQL Editor do Supabase.
 *
 * O arquivo gerado fica em supabase/local-only/ (ignorado pelo Git) e os
 * valores NUNCA são impressos no terminal.
 *
 * Uso:  bun run scripts/gerar-sql-ativacao.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const raiz = process.cwd();

function lerEnv(nome: string): string {
  const linha = readFileSync(join(raiz, ".env"), "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${nome}=`));
  if (!linha) throw new Error(`${nome} não encontrado no .env`);
  return linha.slice(nome.length + 1).replace(/^"|"$/g, "").trim();
}

const clientId = lerEnv("ML_CLIENT_ID");
const clientSecret = lerEnv("ML_CLIENT_SECRET");
if (!clientId || !clientSecret) throw new Error("ML_CLIENT_ID/ML_CLIENT_SECRET vazios no .env");

/** Escapa aspas simples para literal SQL. */
const sql = (v: string) => v.replace(/'/g, "''");

const migration = readFileSync(
  join(raiz, "supabase", "migrations", "20260815160000_refresh_automatico.sql"),
  "utf8",
);

const conteudo = `-- ============================================================================
-- ATIVAÇÃO DO AGENDADOR DE RENOVAÇÃO — ARQUIVO LOCAL, NÃO VERSIONADO
--
-- Gerado por scripts/gerar-sql-ativacao.ts a partir do seu .env.
-- Contém os segredos reais: NÃO comite, NÃO compartilhe, NÃO cole em chat.
-- A pasta supabase/local-only/ está no .gitignore.
--
-- COMO USAR: abra este arquivo, copie TUDO e execute no SQL Editor do Supabase.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PARTE 1 — segredos no Vault (criptografados em repouso)
-- Usa os MESMOS valores que já existem no seu .env. Nenhum app novo é criado.
-- ----------------------------------------------------------------------------
create extension if not exists supabase_vault;

do $ativacao$
declare
  v_id     text := '${sql(clientId)}';
  v_secret text := '${sql(clientSecret)}';
begin
  if exists (select 1 from vault.secrets where name = 'ml_client_id') then
    perform vault.update_secret((select id from vault.secrets where name = 'ml_client_id'), v_id);
    raise notice 'ml_client_id atualizado';
  else
    perform vault.create_secret(v_id, 'ml_client_id', 'Client ID do app do Mercado Livre');
    raise notice 'ml_client_id criado';
  end if;

  if exists (select 1 from vault.secrets where name = 'ml_client_secret') then
    perform vault.update_secret((select id from vault.secrets where name = 'ml_client_secret'), v_secret);
    raise notice 'ml_client_secret atualizado';
  else
    perform vault.create_secret(v_secret, 'ml_client_secret', 'Client Secret do app do Mercado Livre');
    raise notice 'ml_client_secret criado';
  end if;
end
$ativacao$;

-- ----------------------------------------------------------------------------
-- PARTE 2 — migration 20260815160000_refresh_automatico.sql (sem segredos)
-- ----------------------------------------------------------------------------
${migration}

-- ----------------------------------------------------------------------------
-- PARTE 3 — primeira execução imediata, para não esperar o próximo ciclo
-- ----------------------------------------------------------------------------
select public.ml_disparar_refresh() as renovacoes_disparadas;
select pg_sleep(5);
select public.ml_coletar_refresh()  as respostas_processadas;

-- ----------------------------------------------------------------------------
-- PARTE 4 — comprovação (nenhum token é exibido)
-- ----------------------------------------------------------------------------
select jobname, schedule, active from cron.job order by jobname;

select j.jobname, r.status, r.return_message, r.start_time, r.end_time
  from cron.job_run_details r
  join cron.job j using (jobid)
 order by r.start_time desc
 limit 10;

select ml_user_id, nickname, status, expires_at,
       last_refresh_at, last_refresh_status, last_refresh_error, refresh_attempts
  from public.ml_connections
 order by expires_at;
`;

const destino = join(raiz, "supabase", "local-only");
if (!existsSync(destino)) mkdirSync(destino, { recursive: true });
const arquivo = join(destino, "ATIVAR-CRON.LOCAL.sql");
writeFileSync(arquivo, conteudo, "utf8");

// Confirmação sem revelar valor algum.
console.log("Arquivo gerado:");
console.log(`  ${arquivo}`);
console.log("");
console.log(`  ml_client_id     injetado (${clientId.length} caracteres)`);
console.log(`  ml_client_secret injetado (${clientSecret.length} caracteres)`);
console.log("");
console.log("Abra o arquivo, copie tudo e execute no SQL Editor do Supabase.");
console.log("Ele está em supabase/local-only/, que é ignorado pelo Git.");
