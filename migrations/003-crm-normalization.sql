-- GP Mirari V02 SaaS - Etapa 4: CRM normalizado, sem migrar o JSON existente.
-- Referencias aos dados legados permanecem textuais ate a migracao assistida.

begin;

create table if not exists public.gp_v2_crm_funnels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  name text not null, code text not null, active boolean not null default true,
  archived_at timestamptz, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, code), unique (id, organization_id), check (length(trim(name)) > 0)
);
create table if not exists public.gp_v2_crm_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  funnel_id uuid not null, name text not null, position integer not null default 0 check (position >= 0),
  probability_percent numeric(5,2) not null default 0 check (probability_percent between 0 and 100), color text not null default '#8B8585',
  is_won boolean not null default false, is_lost boolean not null default false, archived_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, funnel_id, position), unique (id, organization_id),
  foreign key (funnel_id, organization_id) references public.gp_v2_crm_funnels(id, organization_id) on delete restrict,
  check (not (is_won and is_lost))
);
create table if not exists public.gp_v2_crm_opportunities (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  legacy_ref text not null default '', funnel_id uuid, stage_id uuid, owner_id uuid,
  client_name text not null, contact_name text not null default '', contact_email text not null default '', contact_phone text not null default '',
  interest text not null default '', source text not null default '', value_amount numeric(14,2) not null default 0 check (value_amount >= 0),
  status text not null default 'open' check (status in ('open', 'paused', 'won', 'lost', 'archived')), entered_at timestamptz not null default now(),
  next_action_at date, won_at timestamptz, lost_at timestamptz, lost_reason text not null default '', notes text not null default '', archived_at timestamptz,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, legacy_ref), unique (id, organization_id),
  foreign key (funnel_id, organization_id) references public.gp_v2_crm_funnels(id, organization_id) on delete restrict,
  foreign key (stage_id, organization_id) references public.gp_v2_crm_stages(id, organization_id) on delete restrict,
  check ((status <> 'lost') or length(trim(lost_reason)) > 0)
);
create table if not exists public.gp_v2_crm_labels (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  name text not null, color text not null default '#8B8585', archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organization_id, name), unique (id, organization_id)
);
create table if not exists public.gp_v2_crm_opportunity_labels (
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict, opportunity_id uuid not null, label_id uuid not null,
  created_at timestamptz not null default now(), primary key (organization_id, opportunity_id, label_id),
  foreign key (opportunity_id, organization_id) references public.gp_v2_crm_opportunities(id, organization_id) on delete cascade,
  foreign key (label_id, organization_id) references public.gp_v2_crm_labels(id, organization_id) on delete restrict
);
create table if not exists public.gp_v2_crm_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  opportunity_id uuid not null, event_type text not null check (event_type in ('created', 'stage_changed', 'note_added', 'proposal_created', 'won', 'lost', 'project_created', 'imported')),
  actor_id uuid, note text not null default '', metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  foreign key (opportunity_id, organization_id) references public.gp_v2_crm_opportunities(id, organization_id) on delete restrict
);
create index if not exists gp_v2_crm_opportunities_org_status_idx on public.gp_v2_crm_opportunities(organization_id, status, entered_at desc);
create index if not exists gp_v2_crm_opportunities_org_stage_idx on public.gp_v2_crm_opportunities(organization_id, stage_id, next_action_at);
create index if not exists gp_v2_crm_events_opportunity_date_idx on public.gp_v2_crm_events(organization_id, opportunity_id, created_at desc);

do $$ declare table_name text; tables text[] := array['gp_v2_crm_funnels','gp_v2_crm_stages','gp_v2_crm_opportunities','gp_v2_crm_labels','gp_v2_crm_opportunity_labels','gp_v2_crm_events']; begin
  foreach table_name in array tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('drop policy if exists gp_v2_%I_member_read on public.%I', table_name, table_name);
    execute format('create policy gp_v2_%I_member_read on public.%I for select to authenticated using (public.gp_v2_is_active_member(organization_id))', table_name, table_name);
    execute format('drop policy if exists gp_v2_%I_sales_write on public.%I', table_name, table_name);
    execute format('create policy gp_v2_%I_sales_write on public.%I for all to authenticated using (public.gp_v2_has_role(organization_id, array[''owner'', ''admin'', ''manager'', ''sales''])) with check (public.gp_v2_has_role(organization_id, array[''owner'', ''admin'', ''manager'', ''sales'']))', table_name, table_name);
  end loop;
end $$;
commit;
