-- GP Mirari V02 SaaS - Relatorios e KPIs: fundacao relacional e analitica.
--
-- PRE-REQUISITOS: fundacao V2 e migrations 002 a 005 aplicadas em homologacao.
-- Esta migration e aditiva, idempotente e NAO migra gp_app_settings/app_state.
-- Nao executar em producao antes da homologacao com duas organizacoes.

begin;

do $$
begin
  if to_regclass('public.gp_v2_organizations') is null
    or to_regclass('public.gp_v2_memberships') is null
    or to_regclass('public.gp_v2_crm_opportunities') is null
    or to_regclass('public.gp_v2_crm_stages') is null
    or to_regclass('public.gp_v2_proposals') is null
    or to_regclass('public.gp_v2_proposal_versions') is null then
    raise exception 'gp_v2 reports foundation requires V2 migrations 001 to 004';
  end if;
end;
$$;

alter table public.gp_v2_organizations
  add column if not exists timezone text not null default 'America/Sao_Paulo',
  add column if not exists currency_code char(3) not null default 'BRL';

create table if not exists public.gp_v2_feature_flags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  flag_key text not null,
  enabled boolean not null default false,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, flag_key),
  unique (id, organization_id),
  check (flag_key ~ '^[a-z][a-z0-9_]{2,80}$')
);

create table if not exists public.gp_v2_branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  code text not null,
  name text not null,
  timezone text not null default 'America/Sao_Paulo',
  active boolean not null default true,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, code),
  check (length(trim(code)) > 0),
  check (length(trim(name)) > 0)
);

create table if not exists public.gp_v2_acquisition_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  code text not null,
  name text not null,
  channel_group text not null default 'other' check (channel_group in ('organic', 'paid', 'referral', 'partner', 'offline', 'other')),
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, code),
  check (length(trim(code)) > 0),
  check (length(trim(name)) > 0),
  check (code = lower(code))
);

create table if not exists public.gp_v2_partners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  legacy_ref text not null default '',
  partner_type text not null check (partner_type in ('architect', 'interior_designer', 'specifier', 'referrer', 'other')),
  name text not null,
  email text not null default '',
  phone text not null default '',
  birth_date date,
  default_rt_percent numeric(5,2) not null default 0 check (default_rt_percent between 0 and 100),
  status text not null default 'active' check (status in ('active', 'inactive', 'archived')),
  notes text not null default '',
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, legacy_ref),
  check (length(trim(name)) > 0)
);

create table if not exists public.gp_v2_clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  legacy_ref text not null default '',
  name text not null,
  document_number text not null default '',
  email text not null default '',
  phone text not null default '',
  city text not null default '',
  state_code char(2) not null default '',
  default_specifier_id uuid,
  status text not null default 'lead' check (status in ('lead', 'active', 'inactive', 'archived')),
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, legacy_ref),
  foreign key (default_specifier_id, organization_id)
    references public.gp_v2_partners(id, organization_id) on delete restrict,
  check (length(trim(name)) > 0)
);

create table if not exists public.gp_v2_loss_reasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  code text not null,
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, code),
  check (code in ('price', 'deadline', 'financial', 'competition', 'project', 'timing', 'no_response', 'other')),
  check (length(trim(name)) > 0)
);

alter table public.gp_v2_crm_stages
  add column if not exists stage_type text not null default 'open' check (stage_type in ('open', 'won', 'lost')),
  add column if not exists counts_as_contacted boolean not null default false,
  add column if not exists counts_as_scheduled boolean not null default false,
  add column if not exists counts_as_qualified boolean not null default false,
  add column if not exists counts_as_proposal boolean not null default false;

update public.gp_v2_crm_stages
set stage_type = case when is_won then 'won' when is_lost then 'lost' else 'open' end
where (is_won and stage_type <> 'won') or (is_lost and stage_type <> 'lost');

alter table public.gp_v2_crm_opportunities
  add column if not exists client_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists acquisition_channel_id uuid,
  add column if not exists specifier_id uuid,
  add column if not exists designer_id uuid,
  add column if not exists first_contact_at timestamptz,
  add column if not exists qualified_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists last_activity_at timestamptz,
  add column if not exists lost_reason_id uuid,
  add column if not exists lost_comment text not null default '',
  add column if not exists estimated_value numeric(14,2),
  add column if not exists stage_entered_at timestamptz;

update public.gp_v2_crm_opportunities
set first_contact_at = coalesce(first_contact_at, entered_at, created_at),
    stage_entered_at = coalesce(stage_entered_at, entered_at, created_at),
    last_activity_at = coalesce(last_activity_at, updated_at, created_at),
    closed_at = coalesce(closed_at, won_at, lost_at),
    estimated_value = coalesce(estimated_value, value_amount, 0)
where first_contact_at is null
   or stage_entered_at is null
   or last_activity_at is null
   or estimated_value is null
   or (closed_at is null and (won_at is not null or lost_at is not null));

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gp_v2_crm_opportunities_client_org_fkey') then
    alter table public.gp_v2_crm_opportunities add constraint gp_v2_crm_opportunities_client_org_fkey
      foreign key (client_id, organization_id) references public.gp_v2_clients(id, organization_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gp_v2_crm_opportunities_branch_org_fkey') then
    alter table public.gp_v2_crm_opportunities add constraint gp_v2_crm_opportunities_branch_org_fkey
      foreign key (branch_id, organization_id) references public.gp_v2_branches(id, organization_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gp_v2_crm_opportunities_channel_org_fkey') then
    alter table public.gp_v2_crm_opportunities add constraint gp_v2_crm_opportunities_channel_org_fkey
      foreign key (acquisition_channel_id, organization_id) references public.gp_v2_acquisition_channels(id, organization_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gp_v2_crm_opportunities_specifier_org_fkey') then
    alter table public.gp_v2_crm_opportunities add constraint gp_v2_crm_opportunities_specifier_org_fkey
      foreign key (specifier_id, organization_id) references public.gp_v2_partners(id, organization_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'gp_v2_crm_opportunities_estimated_value_check') then
    alter table public.gp_v2_crm_opportunities add constraint gp_v2_crm_opportunities_estimated_value_check check (estimated_value is null or estimated_value >= 0);
  end if;
end;
$$;

create unique index if not exists gp_v2_crm_events_id_org_unique_idx on public.gp_v2_crm_events(id, organization_id);

create table if not exists public.gp_v2_crm_stage_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  opportunity_id uuid not null,
  funnel_id uuid not null,
  stage_id uuid not null,
  entered_at timestamptz not null,
  exited_at timestamptz,
  duration_seconds bigint,
  entered_by uuid,
  exited_by uuid,
  transition_event_id uuid,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (opportunity_id, organization_id) references public.gp_v2_crm_opportunities(id, organization_id) on delete restrict,
  foreign key (funnel_id, organization_id) references public.gp_v2_crm_funnels(id, organization_id) on delete restrict,
  foreign key (stage_id, organization_id) references public.gp_v2_crm_stages(id, organization_id) on delete restrict,
  foreign key (transition_event_id, organization_id) references public.gp_v2_crm_events(id, organization_id) on delete set null,
  check (exited_at is null or exited_at >= entered_at),
  check (duration_seconds is null or duration_seconds >= 0),
  check ((is_current and exited_at is null) or (not is_current and exited_at is not null))
);

create table if not exists public.gp_v2_crm_activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  opportunity_id uuid not null,
  activity_type text not null check (activity_type in ('task', 'call', 'message', 'appointment', 'briefing', 'presentation', 'follow_up', 'other')),
  title text not null,
  owner_id uuid,
  scheduled_at timestamptz,
  completed_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'completed', 'cancelled')),
  automatic boolean not null default false,
  required boolean not null default false,
  source_ref text not null default '',
  notes text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (opportunity_id, organization_id) references public.gp_v2_crm_opportunities(id, organization_id) on delete restrict,
  check (length(trim(title)) > 0),
  check ((status = 'completed' and completed_at is not null) or (status <> 'completed'))
);

create table if not exists public.gp_v2_opportunity_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  opportunity_id uuid not null,
  user_id uuid not null references auth.users(id) on delete restrict,
  assignment_role text not null check (assignment_role in ('owner', 'designer', 'seller', 'manager', 'other')),
  assigned_at timestamptz not null default now(),
  unassigned_at timestamptz,
  assigned_by uuid,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (opportunity_id, organization_id) references public.gp_v2_crm_opportunities(id, organization_id) on delete restrict,
  check (unassigned_at is null or unassigned_at >= assigned_at)
);

create table if not exists public.gp_v2_sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  opportunity_id uuid not null,
  proposal_id uuid,
  proposal_version_id uuid,
  client_id uuid,
  branch_id uuid,
  specifier_id uuid,
  designer_id uuid,
  closed_at timestamptz not null,
  gross_amount numeric(14,2) not null check (gross_amount >= 0),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0),
  net_amount numeric(14,2) not null check (net_amount >= 0),
  rt_amount numeric(14,2) not null default 0 check (rt_amount >= 0),
  commission_amount numeric(14,2) not null default 0 check (commission_amount >= 0),
  financial_fee_amount numeric(14,2) not null default 0 check (financial_fee_amount >= 0),
  status text not null default 'confirmed' check (status in ('confirmed', 'cancelled')),
  legacy_project_ref text not null default '',
  cancelled_at timestamptz,
  cancellation_reason text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (opportunity_id, organization_id) references public.gp_v2_crm_opportunities(id, organization_id) on delete restrict,
  foreign key (proposal_id, organization_id) references public.gp_v2_proposals(id, organization_id) on delete restrict,
  foreign key (proposal_version_id, organization_id) references public.gp_v2_proposal_versions(id, organization_id) on delete restrict,
  foreign key (client_id, organization_id) references public.gp_v2_clients(id, organization_id) on delete restrict,
  foreign key (branch_id, organization_id) references public.gp_v2_branches(id, organization_id) on delete restrict,
  foreign key (specifier_id, organization_id) references public.gp_v2_partners(id, organization_id) on delete restrict,
  check (discount_amount <= gross_amount),
  check (net_amount <= gross_amount),
  check ((status = 'confirmed' and cancelled_at is null) or (status = 'cancelled' and cancelled_at is not null))
);

create table if not exists public.gp_v2_sale_partner_commissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  sale_id uuid not null,
  partner_id uuid not null,
  commission_type text not null check (commission_type in ('rt', 'referral', 'other')),
  base_amount numeric(14,2) not null default 0 check (base_amount >= 0),
  percentage numeric(7,4),
  amount numeric(14,2) not null check (amount >= 0),
  status text not null default 'accrued' check (status in ('accrued', 'approved', 'paid', 'cancelled')),
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (sale_id, organization_id) references public.gp_v2_sales(id, organization_id) on delete restrict,
  foreign key (partner_id, organization_id) references public.gp_v2_partners(id, organization_id) on delete restrict,
  check (percentage is null or percentage between 0 and 100),
  check ((status <> 'paid') or paid_at is not null)
);

create table if not exists public.gp_v2_projects_relational (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  legacy_ref text not null default '',
  sale_id uuid,
  client_id uuid,
  branch_id uuid,
  designer_id uuid,
  status text not null default 'open' check (status in ('open', 'paused', 'completed', 'cancelled', 'archived')),
  started_at timestamptz,
  design_started_at timestamptz,
  design_approved_at timestamptz,
  production_started_at timestamptz,
  installation_started_at timestamptz,
  installation_completed_at timestamptz,
  delivered_at timestamptz,
  revision_count integer not null default 0 check (revision_count >= 0),
  rework_count integer not null default 0 check (rework_count >= 0),
  source_updated_at timestamptz,
  synced_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, legacy_ref),
  foreign key (sale_id, organization_id) references public.gp_v2_sales(id, organization_id) on delete restrict,
  foreign key (client_id, organization_id) references public.gp_v2_clients(id, organization_id) on delete restrict,
  foreign key (branch_id, organization_id) references public.gp_v2_branches(id, organization_id) on delete restrict,
  check (installation_completed_at is null or installation_started_at is null or installation_completed_at >= installation_started_at)
);

create table if not exists public.gp_v2_project_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  project_id uuid not null,
  designer_id uuid,
  revision_type text not null check (revision_type in ('client_change', 'technical_adjustment', 'internal_error', 'scope_change', 'other')),
  counts_as_rework boolean not null default false,
  reason text not null default '',
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  source_ref text not null default '',
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (project_id, organization_id) references public.gp_v2_projects_relational(id, organization_id) on delete restrict,
  check (completed_at is null or completed_at >= requested_at)
);

create table if not exists public.gp_v2_service_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  project_id uuid not null,
  sale_id uuid,
  client_id uuid,
  case_type text not null check (case_type in ('technical_assistance', 'damage', 'missing_item', 'installation_adjustment', 'other')),
  origin text not null default 'unknown' check (origin in ('production', 'transport', 'installation', 'supplier', 'unknown')),
  severity text not null default 'low' check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'scheduled', 'in_progress', 'resolved', 'cancelled')),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  is_recurrence boolean not null default false,
  parent_case_id uuid,
  cost_amount numeric(14,2) not null default 0 check (cost_amount >= 0),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (project_id, organization_id) references public.gp_v2_projects_relational(id, organization_id) on delete restrict,
  foreign key (sale_id, organization_id) references public.gp_v2_sales(id, organization_id) on delete restrict,
  foreign key (client_id, organization_id) references public.gp_v2_clients(id, organization_id) on delete restrict,
  foreign key (parent_case_id, organization_id) references public.gp_v2_service_cases(id, organization_id) on delete restrict,
  check (resolved_at is null or resolved_at >= opened_at)
);

create table if not exists public.gp_v2_nps_surveys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  project_id uuid,
  sale_id uuid,
  client_id uuid,
  sent_at timestamptz,
  expires_at timestamptz,
  channel text not null default 'other',
  token_hash text not null default '',
  status text not null default 'pending' check (status in ('pending', 'answered', 'expired', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (project_id, organization_id) references public.gp_v2_projects_relational(id, organization_id) on delete restrict,
  foreign key (sale_id, organization_id) references public.gp_v2_sales(id, organization_id) on delete restrict,
  foreign key (client_id, organization_id) references public.gp_v2_clients(id, organization_id) on delete restrict,
  check (expires_at is null or sent_at is null or expires_at >= sent_at)
);

create table if not exists public.gp_v2_nps_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  survey_id uuid not null,
  score smallint not null check (score between 0 and 10),
  comment text not null default '',
  answered_at timestamptz not null default now(),
  consent_version text not null default '',
  created_at timestamptz not null default now(),
  unique (organization_id, survey_id),
  unique (id, organization_id),
  foreign key (survey_id, organization_id) references public.gp_v2_nps_surveys(id, organization_id) on delete restrict
);

create table if not exists public.gp_v2_report_daily_metrics (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  metric_date date not null,
  branch_id uuid,
  channel_id uuid,
  designer_id uuid,
  leads_count integer not null default 0 check (leads_count >= 0),
  qualified_leads_count integer not null default 0 check (qualified_leads_count >= 0),
  appointments_completed_count integer not null default 0 check (appointments_completed_count >= 0),
  proposals_sent_count integer not null default 0 check (proposals_sent_count >= 0),
  proposal_value_amount numeric(14,2) not null default 0 check (proposal_value_amount >= 0),
  won_count integer not null default 0 check (won_count >= 0),
  lost_count integer not null default 0 check (lost_count >= 0),
  sales_amount numeric(14,2) not null default 0 check (sales_amount >= 0),
  weighted_open_pipeline_amount numeric(14,2) not null default 0 check (weighted_open_pipeline_amount >= 0),
  close_time_seconds_sum bigint not null default 0 check (close_time_seconds_sum >= 0),
  close_time_sample_count integer not null default 0 check (close_time_sample_count >= 0),
  service_case_count integer not null default 0 check (service_case_count >= 0),
  delivered_project_count integer not null default 0 check (delivered_project_count >= 0),
  projects_with_service_count integer not null default 0 check (projects_with_service_count >= 0),
  nps_promoter_count integer not null default 0 check (nps_promoter_count >= 0),
  nps_passive_count integer not null default 0 check (nps_passive_count >= 0),
  nps_detractor_count integer not null default 0 check (nps_detractor_count >= 0),
  nps_response_count integer not null default 0 check (nps_response_count >= 0),
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (branch_id, organization_id) references public.gp_v2_branches(id, organization_id) on delete restrict,
  foreign key (channel_id, organization_id) references public.gp_v2_acquisition_channels(id, organization_id) on delete restrict,
  unique nulls not distinct (organization_id, metric_date, branch_id, channel_id, designer_id)
);

create table if not exists public.gp_v2_report_refresh_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  job_name text not null,
  period_start date not null,
  period_end date not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  rows_affected integer not null default 0 check (rows_affected >= 0),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error_message text not null default '',
  request_id text not null default '',
  created_at timestamptz not null default now(),
  check (period_end >= period_start),
  check ((status = 'running' and finished_at is null) or (status in ('succeeded', 'failed') and finished_at is not null))
);

create unique index if not exists gp_v2_feature_flags_org_key_idx on public.gp_v2_feature_flags(organization_id, flag_key);
create unique index if not exists gp_v2_crm_events_id_org_unique_idx on public.gp_v2_crm_events(id, organization_id);
create index if not exists gp_v2_branches_org_active_idx on public.gp_v2_branches(organization_id, active) where archived_at is null;
create index if not exists gp_v2_channels_org_active_idx on public.gp_v2_acquisition_channels(organization_id, active, sort_order) where archived_at is null;
create index if not exists gp_v2_partners_org_type_idx on public.gp_v2_partners(organization_id, partner_type, status) where archived_at is null;
create index if not exists gp_v2_clients_org_specifier_idx on public.gp_v2_clients(organization_id, default_specifier_id) where archived_at is null;
create index if not exists gp_v2_crm_opportunities_org_created_idx on public.gp_v2_crm_opportunities(organization_id, created_at desc);
create index if not exists gp_v2_crm_opportunities_org_branch_created_idx on public.gp_v2_crm_opportunities(organization_id, branch_id, created_at desc);
create index if not exists gp_v2_crm_opportunities_org_channel_created_idx on public.gp_v2_crm_opportunities(organization_id, acquisition_channel_id, created_at desc);
create index if not exists gp_v2_crm_opportunities_org_designer_closed_idx on public.gp_v2_crm_opportunities(organization_id, designer_id, closed_at desc) where closed_at is not null;
create index if not exists gp_v2_crm_opportunities_org_stage_status_idx on public.gp_v2_crm_opportunities(organization_id, stage_id, status);
create index if not exists gp_v2_crm_stage_history_opportunity_idx on public.gp_v2_crm_stage_history(organization_id, opportunity_id, entered_at);
create index if not exists gp_v2_crm_stage_history_stage_idx on public.gp_v2_crm_stage_history(organization_id, stage_id, entered_at desc);
create unique index if not exists gp_v2_crm_stage_history_one_current_idx on public.gp_v2_crm_stage_history(organization_id, opportunity_id) where is_current;
create index if not exists gp_v2_crm_activities_opportunity_schedule_idx on public.gp_v2_crm_activities(organization_id, opportunity_id, scheduled_at desc);
create index if not exists gp_v2_crm_activities_type_status_idx on public.gp_v2_crm_activities(organization_id, activity_type, status, completed_at desc);
create index if not exists gp_v2_assignments_opportunity_active_idx on public.gp_v2_opportunity_assignments(organization_id, opportunity_id, assignment_role) where unassigned_at is null;
create index if not exists gp_v2_proposal_versions_org_sent_idx on public.gp_v2_proposal_versions(organization_id, sent_at desc) where sent_at is not null;
create index if not exists gp_v2_sales_org_closed_idx on public.gp_v2_sales(organization_id, closed_at desc);
create index if not exists gp_v2_sales_org_branch_closed_idx on public.gp_v2_sales(organization_id, branch_id, closed_at desc);
create index if not exists gp_v2_sales_org_designer_closed_idx on public.gp_v2_sales(organization_id, designer_id, closed_at desc);
create index if not exists gp_v2_sales_org_specifier_closed_idx on public.gp_v2_sales(organization_id, specifier_id, closed_at desc);
create unique index if not exists gp_v2_sales_one_active_opportunity_idx on public.gp_v2_sales(organization_id, opportunity_id) where status = 'confirmed';
create index if not exists gp_v2_sale_commissions_partner_status_idx on public.gp_v2_sale_partner_commissions(organization_id, partner_id, status, paid_at desc);
create index if not exists gp_v2_projects_relational_delivery_idx on public.gp_v2_projects_relational(organization_id, delivered_at desc) where delivered_at is not null;
create index if not exists gp_v2_projects_relational_designer_idx on public.gp_v2_projects_relational(organization_id, designer_id, started_at desc);
create index if not exists gp_v2_project_revisions_project_idx on public.gp_v2_project_revisions(organization_id, project_id, requested_at desc);
create index if not exists gp_v2_service_cases_project_idx on public.gp_v2_service_cases(organization_id, project_id, opened_at desc);
create index if not exists gp_v2_service_cases_status_idx on public.gp_v2_service_cases(organization_id, status, opened_at desc);
create index if not exists gp_v2_nps_responses_answered_idx on public.gp_v2_nps_responses(organization_id, answered_at desc);
create index if not exists gp_v2_report_daily_org_date_idx on public.gp_v2_report_daily_metrics(organization_id, metric_date);
create index if not exists gp_v2_report_daily_branch_date_idx on public.gp_v2_report_daily_metrics(organization_id, branch_id, metric_date);
create index if not exists gp_v2_report_daily_channel_date_idx on public.gp_v2_report_daily_metrics(organization_id, channel_id, metric_date);
create index if not exists gp_v2_report_daily_designer_date_idx on public.gp_v2_report_daily_metrics(organization_id, designer_id, metric_date);
create index if not exists gp_v2_report_refresh_log_org_date_idx on public.gp_v2_report_refresh_log(organization_id, started_at desc);

create or replace view public.gp_v2_report_opportunity_facts_v
with (security_invoker = true) as
select opportunity.organization_id, opportunity.id as opportunity_id, opportunity.created_at, opportunity.first_contact_at,
  opportunity.qualified_at, opportunity.closed_at, opportunity.status, opportunity.estimated_value,
  opportunity.branch_id, opportunity.acquisition_channel_id, opportunity.specifier_id, opportunity.designer_id,
  opportunity.stage_id, stage.probability_percent, stage.stage_type, opportunity.lost_reason_id
from public.gp_v2_crm_opportunities opportunity
left join public.gp_v2_crm_stages stage on stage.id = opportunity.stage_id and stage.organization_id = opportunity.organization_id;

create or replace view public.gp_v2_report_sales_facts_v
with (security_invoker = true) as
select sale.organization_id, sale.id as sale_id, sale.opportunity_id, sale.closed_at, sale.status,
  sale.gross_amount, sale.net_amount, sale.rt_amount, sale.commission_amount, sale.financial_fee_amount,
  sale.branch_id, sale.specifier_id, sale.designer_id, sale.client_id
from public.gp_v2_sales sale;

create or replace view public.gp_v2_report_stage_duration_v
with (security_invoker = true) as
select history.organization_id, history.opportunity_id, history.funnel_id, history.stage_id,
  history.entered_at, history.exited_at, coalesce(history.duration_seconds,
    extract(epoch from (now() - history.entered_at))::bigint) as duration_seconds,
  history.is_current
from public.gp_v2_crm_stage_history history;

do $$
declare
  table_name text;
  member_tables text[] := array[
    'gp_v2_feature_flags', 'gp_v2_branches', 'gp_v2_acquisition_channels', 'gp_v2_partners', 'gp_v2_clients',
    'gp_v2_loss_reasons', 'gp_v2_crm_stage_history', 'gp_v2_crm_activities', 'gp_v2_opportunity_assignments',
    'gp_v2_projects_relational', 'gp_v2_project_revisions', 'gp_v2_nps_surveys', 'gp_v2_nps_responses',
    'gp_v2_report_daily_metrics', 'gp_v2_report_refresh_log'
  ];
begin
  foreach table_name in array member_tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon', table_name);
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('drop policy if exists gp_v2_%I_member_read on public.%I', table_name, table_name);
    execute format('create policy gp_v2_%I_member_read on public.%I for select to authenticated using (public.gp_v2_is_active_member(organization_id))', table_name, table_name);
  end loop;
end;
$$;

do $$
declare
  table_name text;
  manager_tables text[] := array[
    'gp_v2_branches', 'gp_v2_acquisition_channels', 'gp_v2_partners', 'gp_v2_clients',
    'gp_v2_loss_reasons', 'gp_v2_crm_stage_history', 'gp_v2_crm_activities', 'gp_v2_opportunity_assignments',
    'gp_v2_projects_relational', 'gp_v2_project_revisions', 'gp_v2_nps_surveys'
  ];
begin
  foreach table_name in array manager_tables loop
    execute format('grant insert, update, delete on table public.%I to authenticated', table_name);
    execute format('drop policy if exists gp_v2_%I_manager_write on public.%I', table_name, table_name);
    execute format('create policy gp_v2_%I_manager_write on public.%I for all to authenticated using (public.gp_v2_has_role(organization_id, array[''owner'', ''admin'', ''manager'', ''sales''])) with check (public.gp_v2_has_role(organization_id, array[''owner'', ''admin'', ''manager'', ''sales'']))', table_name, table_name);
  end loop;
end;
$$;

grant insert, update, delete on table public.gp_v2_feature_flags to authenticated;
drop policy if exists gp_v2_feature_flags_owner_admin_write on public.gp_v2_feature_flags;
create policy gp_v2_feature_flags_owner_admin_write on public.gp_v2_feature_flags for all to authenticated
  using (public.gp_v2_has_role(organization_id, array['owner', 'admin']))
  with check (public.gp_v2_has_role(organization_id, array['owner', 'admin']));

do $$
declare
  table_name text;
  restricted_tables text[] := array['gp_v2_report_daily_metrics', 'gp_v2_report_refresh_log', 'gp_v2_nps_responses'];
begin
  foreach table_name in array restricted_tables loop
    execute format('drop policy if exists gp_v2_%I_member_read on public.%I', table_name, table_name);
    execute format('drop policy if exists gp_v2_%I_manager_read on public.%I', table_name, table_name);
    execute format('create policy gp_v2_%I_manager_read on public.%I for select to authenticated using (public.gp_v2_has_role(organization_id, array[''owner'', ''admin'', ''manager'']))', table_name, table_name);
  end loop;
end;
$$;

alter table public.gp_v2_sales enable row level security;
alter table public.gp_v2_sale_partner_commissions enable row level security;
alter table public.gp_v2_service_cases enable row level security;
revoke all on table public.gp_v2_sales, public.gp_v2_sale_partner_commissions, public.gp_v2_service_cases from anon;
grant select, insert, update on table public.gp_v2_sales, public.gp_v2_sale_partner_commissions, public.gp_v2_service_cases to authenticated;
drop policy if exists gp_v2_sales_manager_read_write on public.gp_v2_sales;
create policy gp_v2_sales_manager_read_write on public.gp_v2_sales for all to authenticated
  using (public.gp_v2_has_role(organization_id, array['owner', 'admin', 'manager']))
  with check (public.gp_v2_has_role(organization_id, array['owner', 'admin', 'manager']));
drop policy if exists gp_v2_sale_partner_commissions_admin_read_write on public.gp_v2_sale_partner_commissions;
create policy gp_v2_sale_partner_commissions_admin_read_write on public.gp_v2_sale_partner_commissions for all to authenticated
  using (public.gp_v2_has_role(organization_id, array['owner', 'admin']))
  with check (public.gp_v2_has_role(organization_id, array['owner', 'admin']));
drop policy if exists gp_v2_service_cases_manager_read_write on public.gp_v2_service_cases;
create policy gp_v2_service_cases_manager_read_write on public.gp_v2_service_cases for all to authenticated
  using (public.gp_v2_has_role(organization_id, array['owner', 'admin', 'manager']))
  with check (public.gp_v2_has_role(organization_id, array['owner', 'admin', 'manager']));

commit;
