# Renovação automática do token do Mercado Livre

Depois que o cliente autoriza uma vez, o sistema mantém o `access_token` válido
sozinho. O cliente **não** precisa clicar em "Sincronizar", abrir o site, nem
reautorizar a cada 6 horas.

O botão "Sincronizar" continua existindo, mas serve só para trazer pedidos.

---

## Por que o agendador roda dentro do Supabase

O projeto ainda **não tem deploy**: o app roda na máquina do desenvolvedor com
`bun run dev` + túnel. Um agendador externo (Vercel Cron, Cloudflare Cron,
GitHub Actions) precisaria chamar uma URL que morre quando essa máquina desliga.

O objetivo é justamente manter o token vivo com todo mundo offline. O Supabase é
a única infraestrutura sempre ligada do projeto — por isso o agendador vive lá,
usando `pg_cron` (agenda) + `pg_net` (HTTP), chamando o Mercado Livre direto.

Quando existir deploy de verdade, dá para migrar para o cron da plataforma
apontando para `/api/public/ml/cron` (que já está pronto e protegido).

---

## Passo 1 — cadastrar os segredos no Vault

> Os valores são os mesmos `ML_CLIENT_ID` e `ML_CLIENT_SECRET` do seu `.env`.
> **Não** cole esses valores em nenhum arquivo do repositório.

### Caminho recomendado: painel do Supabase

1. Abra o projeto no [supabase.com](https://supabase.com)
2. Vá em **Project Settings → Vault** (ou **Integrations → Vault**)
3. Clique em **Add new secret** e cadastre os dois:

   | Name | Secret |
   |---|---|
   | `ml_client_id` | valor de `ML_CLIENT_ID` do `.env` |
   | `ml_client_secret` | valor de `ML_CLIENT_SECRET` do `.env` |

O valor é digitado direto no navegador, fica criptografado em repouso e nunca
passa por um arquivo versionado.

### Alternativa: SQL Editor

Se preferir o SQL Editor, rode o comando abaixo **substituindo os valores na
hora de executar** — e não salve esse SQL em lugar nenhum:

```sql
select vault.create_secret('SEU_ML_CLIENT_ID',     'ml_client_id',     'Client ID do app do Mercado Livre');
select vault.create_secret('SEU_ML_CLIENT_SECRET', 'ml_client_secret', 'Client Secret do app do Mercado Livre');
```

Para conferir que entraram (sem revelar o valor):

```sql
select name, created_at from vault.secrets where name in ('ml_client_id','ml_client_secret');
```

---

## Passo 2 — rodar a migration

No SQL Editor, execute:

```
supabase/migrations/20260815160000_refresh_automatico.sql
```

Ela não contém segredo nenhum. Se os segredos do passo 1 não existirem, ela para
com uma mensagem clara em vez de agendar algo quebrado.

O que ela cria:

- colunas de controle em `ml_connections`
  (`last_refresh_at`, `last_refresh_status`, `last_refresh_error`,
  `refresh_attempts`, `refresh_lock_at`)
- `ml_disparar_refresh()` — acha as contas perto de vencer e chama o ML
- `ml_coletar_refresh()` — lê as respostas e grava os tokens novos
- dois agendamentos no `pg_cron`

---

## Passo 3 — conferir que está ativo

```sql
-- Os dois agendamentos devem aparecer com active = true
select jobname, schedule, active from cron.job order by jobname;
```

Esperado:

| jobname | schedule |
|---|---|
| `ml_refresh_coleta` | `* * * * *` |
| `ml_refresh_disparo` | `*/5 * * * *` |

```sql
-- Execuções recentes
select j.jobname, r.status, r.return_message, r.start_time
  from cron.job_run_details r
  join cron.job j using (jobid)
 order by r.start_time desc
 limit 20;
```

---

## Passo 4 — verificar as renovações (sem exibir token)

```sql
select ml_user_id,
       nickname,
       status,
       expires_at,
       last_refresh_at,
       last_refresh_status,
       last_refresh_error,
       refresh_attempts
  from public.ml_connections
 order by expires_at;
```

Sinais de que está funcionando:

- `expires_at` sempre no futuro, avançando sozinho
- `last_refresh_at` atualizando sem ninguém mexer no site
- `last_refresh_status = 'ok'`
- `refresh_attempts = 0`
- `status = 'active'`

Histórico das renovações:

```sql
select created_at, action, http_status, success, message, error
  from public.system_logs
 where category = 'refresh_token'
 order by created_at desc
 limit 30;
```

---

## Como o sistema decide

| Situação | O que acontece |
|---|---|
| Falta mais de 10 min para vencer | não faz nada |
| Falta menos de 10 min | renova com o `refresh_token` |
| ML devolve `refresh_token` novo | substitui o antigo (**rotação confirmada na prática**) |
| HTTP 429 / 5xx / timeout | erro temporário, tenta de novo com espera crescente (1, 4, 9, 16… min) |
| HTTP 400/401 com `invalid_grant` | `reauth_required` — só aqui o cliente precisa autorizar de novo |
| 8 falhas seguidas | para de insistir e aguarda intervenção |
| Duas execuções ao mesmo tempo | a trava `refresh_lock_at` deixa só uma renovar |

**Access token expirado nunca é tratado como conta revogada.** Enquanto o
`refresh_token` funcionar, a conta segue conectada.

---

## Segurança

- `ml_client_id` / `ml_client_secret`: Supabase Vault, criptografados
- `ML_CRON_TOKEN`: apenas no `.env` (que está no `.gitignore`)
- As funções são `SECURITY DEFINER` com `REVOKE` para `anon` e `authenticated`
- `ml_refresh_jobs` tem RLS negando acesso público
- Nenhum log, resposta HTTP ou tabela guarda `access_token` / `refresh_token`
- O endpoint `/api/public/ml/cron` exige `x-cron-token` e responde 401 sem ele
