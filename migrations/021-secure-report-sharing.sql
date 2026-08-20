-- GP Mirari V02 - Compartilhamento seguro de relatorios executivos.
--
-- O token publico nunca e persistido em texto puro. A Edge Function guarda somente
-- um HMAC do token e entrega exclusivamente o snapshot selecionado pelo usuario.

begin;

create table if not exists public.gp_v2_report_shares (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  title text not null default 'Relatorio executivo',
  token_hash text not null,
  token_fingerprint text not null,
  snapshot jsonb not null,
  sections text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'revoked', 'expired')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_accessed_at timestamptz,
  access_count bigint not null default 0 check (access_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (token_hash),
  check (length(trim(title)) between 1 and 120),
  check (token_hash ~ '^[0-9a-f]{64}$'),
  check (token_fingerprint ~ '^[0-9a-f]{12}$'),
  check (jsonb_typeof(snapshot) = 'object'),
  check (expires_at > created_at)
);

create index if not exists gp_v2_report_shares_org_created_idx
  on public.gp_v2_report_shares (organization_id, created_at desc);
create index if not exists gp_v2_report_shares_created_by_idx
  on public.gp_v2_report_shares (created_by);
create index if not exists gp_v2_report_shares_active_expiry_idx
  on public.gp_v2_report_shares (expires_at)
  where status = 'active';

alter table public.gp_v2_report_shares enable row level security;

-- A tabela nao faz parte da API do navegador. Toda leitura/escrita passa pela
-- Edge Function, que valida a sessao ou o token opaco antes de usar service_role.
revoke all on table public.gp_v2_report_shares from public;
revoke all on table public.gp_v2_report_shares from anon, authenticated;
revoke all on table public.gp_v2_report_shares from service_role;
grant select, insert, update on table public.gp_v2_report_shares to service_role;

commit;
