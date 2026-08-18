-- ============================================================================
-- CENTRAL ML — CONFIGURAÇÃO ADMIN_USERS
-- ============================================================================
-- Execute este arquivo no SQL Editor do seu projeto Supabase.
--
-- Objetivo:
-- 1. Criar admin_users caso não exista.
-- 2. Habilitar RLS.
-- 3. Permitir leitura/escrita somente para usuários autenticados.
--
-- IMPORTANTE:
-- Se você quer que qualquer pessoa com a chave pública/anon consiga criar
-- administradores, NÃO faça isso. Isso seria uma falha de segurança.
--
-- O usuário que estiver logado precisa estar autenticado no Supabase Auth.
-- Para um primeiro administrador, use o INSERT de bootstrap abaixo com
-- segurança administrativa no SQL Editor.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

-- Helper: verifica se o usuário autenticado já está na tabela.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and status = 'active'
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Remove policies antigas com estes nomes para evitar conflito.
drop policy if exists "admin_users_select_self_or_admin"
  on public.admin_users;

drop policy if exists "admin_users_insert_admin"
  on public.admin_users;

drop policy if exists "admin_users_update_admin"
  on public.admin_users;

drop policy if exists "admin_users_delete_admin"
  on public.admin_users;

-- O usuário pode consultar a própria linha.
-- Administradores ativos podem consultar todos.
create policy "admin_users_select_self_or_admin"
on public.admin_users
for select
to authenticated
using (
  lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  or public.is_admin()
);

-- Apenas administrador já existente pode inserir novos administradores.
create policy "admin_users_insert_admin"
on public.admin_users
for insert
to authenticated
with check (
  public.is_admin()
);

-- Apenas administrador já existente pode atualizar.
create policy "admin_users_update_admin"
on public.admin_users
for update
to authenticated
using (
  public.is_admin()
)
with check (
  public.is_admin()
);

-- Apenas administrador já existente pode excluir.
create policy "admin_users_delete_admin"
on public.admin_users
for delete
to authenticated
using (
  public.is_admin()
);

-- Garante privilégios básicos para o papel autenticado.
grant select, insert, update, delete
on public.admin_users
to authenticated;

-- ============================================================================
-- BOOTSTRAP DO PRIMEIRO ADMIN
-- ============================================================================
-- NÃO coloque um e-mail inventado.
--
-- Substitua pelo e-mail EXATO da conta que você usa no Supabase Auth.
--
-- Execute manualmente UMA VEZ no SQL Editor:
--
-- insert into public.admin_users (email, status)
-- values ('SEU_EMAIL_DO_SUPABASE_AUTH@DOMINIO.COM', 'active')
-- on conflict (email)
-- do update set status = 'active', updated_at = now();
--
-- Depois faça login com essa conta.
-- A partir daí o botão "Cadastrar" do painel poderá inserir os próximos
-- administradores porque is_admin() será verdadeiro.
-- ============================================================================

-- ============================================================================
-- AUDITORIA
-- ============================================================================
create table if not exists public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_email text,
  action text not null,
  target_id text,
  error text,
  created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

drop policy if exists "audit_select_admin"
  on public.admin_audit_log;

drop policy if exists "audit_insert_admin"
  on public.admin_audit_log;

create policy "audit_select_admin"
on public.admin_audit_log
for select
to authenticated
using (public.is_admin());

create policy "audit_insert_admin"
on public.admin_audit_log
for insert
to authenticated
with check (public.is_admin());

grant select, insert
on public.admin_audit_log
to authenticated;

-- ============================================================================
-- WEBHOOKS
-- ============================================================================
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  event text,
  topic text,
  type text,
  ml_user_id text,
  payload jsonb,
  status text not null default 'received',
  created_at timestamptz not null default now()
);

create index if not exists webhook_events_created_at_idx
on public.webhook_events (created_at desc);

create index if not exists webhook_events_ml_user_id_idx
on public.webhook_events (ml_user_id);

alter table public.webhook_events enable row level security;

drop policy if exists "webhooks_select_admin"
  on public.webhook_events;

create policy "webhooks_select_admin"
on public.webhook_events
for select
to authenticated
using (public.is_admin());

grant select
on public.webhook_events
to authenticated;

-- O endpoint backend do webhook deve usar uma credencial de servidor para
-- inserir eventos. NÃO dê INSERT público para anon/authenticated apenas para
-- fazer o frontend funcionar.

-- ============================================================================
-- LOGS
-- ============================================================================
create table if not exists public.system_logs (
  id uuid primary key default gen_random_uuid(),
  level text not null default 'info',
  action text,
  message text,
  user_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists system_logs_created_at_idx
on public.system_logs (created_at desc);

alter table public.system_logs enable row level security;

drop policy if exists "system_logs_select_admin"
  on public.system_logs;

create policy "system_logs_select_admin"
on public.system_logs
for select
to authenticated
using (public.is_admin());

grant select
on public.system_logs
to authenticated;

-- ============================================================================
-- IP / DISPOSITIVOS
-- ============================================================================
create table if not exists public.ip_access_logs (
  id uuid primary key default gen_random_uuid(),
  ip_address inet,
  ml_user_id text,
  user_id text,
  device text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists ip_access_logs_created_at_idx
on public.ip_access_logs (created_at desc);

alter table public.ip_access_logs enable row level security;

drop policy if exists "ip_access_select_admin"
on public.ip_access_logs;

create policy "ip_access_select_admin"
on public.ip_access_logs
for select
to authenticated
using (public.is_admin());

grant select
on public.ip_access_logs
to authenticated;

-- ============================================================================
-- FIM
-- ============================================================================
