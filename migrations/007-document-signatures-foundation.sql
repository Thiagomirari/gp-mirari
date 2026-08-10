-- GP Mirari V02 SaaS - Modulo de documentos e assinaturas eletronicas.
-- Estrutura aditiva, multi-tenant e independente do provedor de assinatura.

begin;

do $$
begin
  if to_regclass('public.gp_v2_organizations') is null
    or to_regclass('public.gp_v2_memberships') is null then
    raise exception 'gp_v2 signature foundation requires migrations 001 and 002';
  end if;
end;
$$;

create table if not exists public.gp_v2_document_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  code text not null,
  name text not null,
  document_kind text not null check (document_kind in ('contract', 'proposal', 'addendum', 'executive_project', 'acceptance_term', 'other')),
  template_format text not null default 'html' check (template_format in ('html', 'docx', 'pdf')),
  template_storage_path text not null default '',
  default_signature_level text not null default 'advanced' check (default_signature_level in ('advanced', 'qualified_icp_brasil')),
  active boolean not null default true,
  variables_schema jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (organization_id, code),
  unique (id, organization_id),
  check (code ~ '^[a-z][a-z0-9_]{2,80}$'),
  check (length(trim(name)) > 0)
);

create table if not exists public.gp_v2_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  template_id uuid,
  current_version_id uuid,
  title text not null,
  document_kind text not null check (document_kind in ('contract', 'proposal', 'addendum', 'executive_project', 'acceptance_term', 'other')),
  source_type text not null default 'manual' check (source_type in ('manual', 'crm_won', 'proposal', 'project_stage', 'addendum', 'api')),
  request_id text not null default '',
  signature_level text not null default 'advanced' check (signature_level in ('advanced', 'qualified_icp_brasil')),
  status text not null default 'draft' check (status in ('draft', 'ready', 'preparing', 'awaiting_signature', 'partially_signed', 'signed', 'declined', 'expired', 'cancelled', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, organization_id),
  foreign key (template_id, organization_id) references public.gp_v2_document_templates(id, organization_id) on delete restrict,
  check (length(trim(title)) > 0)
);

create table if not exists public.gp_v2_document_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  document_id uuid not null,
  version_number integer not null check (version_number > 0),
  file_name text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  storage_path text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  state text not null default 'final' check (state in ('draft', 'final', 'superseded')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  unique (organization_id, document_id, version_number),
  unique (organization_id, storage_path),
  unique (id, organization_id),
  foreign key (document_id, organization_id) references public.gp_v2_documents(id, organization_id) on delete restrict,
  check (length(trim(file_name)) > 0),
  check (length(trim(content_type)) > 0)
);

alter table public.gp_v2_documents
  drop constraint if exists gp_v2_documents_current_version_org_fkey;
alter table public.gp_v2_documents
  add constraint gp_v2_documents_current_version_org_fkey
  foreign key (current_version_id, organization_id)
  references public.gp_v2_document_versions(id, organization_id) on delete restrict
  deferrable initially deferred;

create table if not exists public.gp_v2_document_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  document_id uuid not null,
  entity_type text not null check (entity_type in ('client', 'crm_opportunity', 'proposal', 'project', 'project_stage', 'contract', 'other')),
  entity_ref text not null,
  link_role text not null default 'related' check (link_role in ('source', 'primary', 'related', 'supersedes')),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, document_id, entity_type, entity_ref, link_role),
  unique (id, organization_id),
  foreign key (document_id, organization_id) references public.gp_v2_documents(id, organization_id) on delete restrict,
  check (length(trim(entity_ref)) > 0)
);

create table if not exists public.gp_v2_signature_envelopes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  document_id uuid not null,
  document_version_id uuid not null,
  provider text not null check (provider in ('autentique', 'clicksign', 'other')),
  provider_envelope_id text,
  request_id text not null default '',
  signature_level text not null check (signature_level in ('advanced', 'qualified_icp_brasil')),
  status text not null default 'preparing' check (status in ('preparing', 'awaiting_signature', 'partially_signed', 'signed', 'declined', 'expired', 'cancelled', 'failed')),
  consent_text_version text not null default 'gp-sign-consent-v1',
  expires_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  provider_metadata jsonb not null default '{}'::jsonb,
  last_error_code text not null default '',
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (document_id, organization_id) references public.gp_v2_documents(id, organization_id) on delete restrict,
  foreign key (document_version_id, organization_id) references public.gp_v2_document_versions(id, organization_id) on delete restrict
);

create unique index if not exists gp_v2_signature_envelopes_provider_id_uidx
  on public.gp_v2_signature_envelopes(provider, provider_envelope_id)
  where provider_envelope_id is not null and provider_envelope_id <> '';
create unique index if not exists gp_v2_signature_envelopes_org_request_uidx
  on public.gp_v2_signature_envelopes(organization_id, request_id)
  where request_id <> '';

create table if not exists public.gp_v2_signature_signers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  envelope_id uuid not null,
  provider_signer_id text,
  signer_role text not null default 'signer' check (signer_role in ('company', 'client', 'witness', 'approver', 'signer')),
  signing_order integer not null default 1 check (signing_order > 0),
  name text not null,
  email text not null default '',
  phone_last4 text not null default '',
  document_last4 text not null default '',
  document_hash text not null default '',
  authentication_methods text[] not null default array['email']::text[],
  status text not null default 'pending' check (status in ('pending', 'viewed', 'signed', 'declined', 'delivery_failed')),
  viewed_at timestamptz,
  signed_at timestamptz,
  declined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, envelope_id, signing_order),
  foreign key (envelope_id, organization_id) references public.gp_v2_signature_envelopes(id, organization_id) on delete restrict,
  check (length(trim(name)) > 0),
  check (email = '' or email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  check (document_hash = '' or document_hash ~ '^[0-9a-f]{64}$')
);

create table if not exists public.gp_v2_signature_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  envelope_id uuid not null,
  signer_id uuid,
  provider_event_id text not null default '',
  event_type text not null,
  actor_type text not null default 'provider' check (actor_type in ('user', 'signer', 'provider', 'system')),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (id, organization_id),
  foreign key (envelope_id, organization_id) references public.gp_v2_signature_envelopes(id, organization_id) on delete restrict,
  foreign key (signer_id, organization_id) references public.gp_v2_signature_signers(id, organization_id) on delete restrict,
  check (length(trim(event_type)) > 0)
);

create unique index if not exists gp_v2_signature_events_provider_event_uidx
  on public.gp_v2_signature_events(organization_id, provider_event_id)
  where provider_event_id <> '';
create index if not exists gp_v2_signature_events_envelope_date_idx
  on public.gp_v2_signature_events(organization_id, envelope_id, occurred_at desc);

create table if not exists public.gp_v2_signature_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  envelope_id uuid not null,
  artifact_kind text not null check (artifact_kind in ('original', 'signed_pdf', 'pades', 'evidence_report', 'provider_snapshot')),
  storage_path text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  provider_url_hash text not null default '',
  created_at timestamptz not null default now(),
  unique (organization_id, envelope_id, artifact_kind),
  unique (organization_id, storage_path),
  unique (id, organization_id),
  foreign key (envelope_id, organization_id) references public.gp_v2_signature_envelopes(id, organization_id) on delete restrict
);

create table if not exists public.gp_v2_signature_automation_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  name text not null,
  trigger_type text not null check (trigger_type in ('crm_won', 'proposal_accepted', 'project_stage_entered')),
  trigger_ref text not null default '',
  template_id uuid,
  document_kind text not null check (document_kind in ('contract', 'proposal', 'addendum', 'executive_project', 'acceptance_term', 'other')),
  signature_level text not null default 'advanced' check (signature_level in ('advanced', 'qualified_icp_brasil')),
  auto_create boolean not null default true,
  auto_send boolean not null default false,
  enabled boolean not null default false,
  conditions jsonb not null default '{}'::jsonb,
  signer_configuration jsonb not null default '{}'::jsonb,
  created_by uuid not null,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (template_id, organization_id) references public.gp_v2_document_templates(id, organization_id) on delete restrict,
  check (length(trim(name)) > 0),
  check (not auto_send or auto_create)
);

create table if not exists public.gp_v2_signature_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  job_type text not null check (job_type in ('create_from_rule', 'send_envelope', 'sync_envelope', 'download_artifacts')),
  deduplication_key text not null,
  status text not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
  payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error_code text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, deduplication_key),
  unique (id, organization_id),
  check (length(trim(deduplication_key)) > 0)
);

create table if not exists public.gp_v2_signature_webhook_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.gp_v2_organizations(id) on delete restrict,
  envelope_id uuid,
  provider text not null check (provider in ('autentique', 'clicksign', 'other')),
  provider_event_id text not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  signature_valid boolean not null,
  status text not null default 'received' check (status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error_code text not null default '',
  unique (provider, provider_event_id),
  foreign key (envelope_id, organization_id) references public.gp_v2_signature_envelopes(id, organization_id) on delete restrict
);

create index if not exists gp_v2_documents_org_status_date_idx
  on public.gp_v2_documents(organization_id, status, updated_at desc)
  where archived_at is null;
create unique index if not exists gp_v2_documents_org_request_uidx
  on public.gp_v2_documents(organization_id, request_id)
  where request_id <> '';
create index if not exists gp_v2_document_links_entity_idx
  on public.gp_v2_document_links(organization_id, entity_type, entity_ref);
create index if not exists gp_v2_signature_envelopes_org_status_idx
  on public.gp_v2_signature_envelopes(organization_id, status, updated_at desc);
create index if not exists gp_v2_signature_jobs_ready_idx
  on public.gp_v2_signature_jobs(status, available_at)
  where status = 'pending';

create or replace function public.gp_v2_reject_immutable_signature_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'signature evidence is immutable';
end;
$$;

drop trigger if exists gp_v2_signature_events_immutable on public.gp_v2_signature_events;
create trigger gp_v2_signature_events_immutable
before update or delete on public.gp_v2_signature_events
for each row execute function public.gp_v2_reject_immutable_signature_mutation();

drop trigger if exists gp_v2_signature_artifacts_immutable on public.gp_v2_signature_artifacts;
create trigger gp_v2_signature_artifacts_immutable
before update or delete on public.gp_v2_signature_artifacts
for each row execute function public.gp_v2_reject_immutable_signature_mutation();

create or replace function public.gp_v2_lock_final_document_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.finalized_at is not null and row(new.*) is distinct from row(old.*) then
    raise exception 'final document version is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists gp_v2_document_versions_lock_final on public.gp_v2_document_versions;
create trigger gp_v2_document_versions_lock_final
before update on public.gp_v2_document_versions
for each row execute function public.gp_v2_lock_final_document_version();

create or replace function public.gp_v2_guard_terminal_signature_envelope()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status in ('signed', 'declined', 'expired', 'cancelled') and new.status <> old.status then
    raise exception 'terminal signature envelope cannot be reopened';
  end if;
  return new;
end;
$$;

drop trigger if exists gp_v2_signature_envelopes_guard_terminal on public.gp_v2_signature_envelopes;
create trigger gp_v2_signature_envelopes_guard_terminal
before update on public.gp_v2_signature_envelopes
for each row execute function public.gp_v2_guard_terminal_signature_envelope();

revoke all on function public.gp_v2_reject_immutable_signature_mutation() from public, anon, authenticated;
revoke all on function public.gp_v2_lock_final_document_version() from public, anon, authenticated;
revoke all on function public.gp_v2_guard_terminal_signature_envelope() from public, anon, authenticated;

do $$
declare
  table_name text;
  tables text[] := array[
    'gp_v2_document_templates', 'gp_v2_documents', 'gp_v2_document_versions',
    'gp_v2_document_links', 'gp_v2_signature_envelopes', 'gp_v2_signature_signers',
    'gp_v2_signature_events', 'gp_v2_signature_artifacts',
    'gp_v2_signature_automation_rules', 'gp_v2_signature_jobs',
    'gp_v2_signature_webhook_receipts'
  ];
begin
  foreach table_name in array tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon', table_name);
    execute format('revoke all on table public.%I from authenticated', table_name);
  end loop;
end;
$$;

-- Reading contracts and signer evidence is limited to the operational team.
do $$
declare
  table_name text;
  tables text[] := array[
    'gp_v2_document_templates', 'gp_v2_documents', 'gp_v2_document_versions',
    'gp_v2_document_links', 'gp_v2_signature_envelopes', 'gp_v2_signature_signers',
    'gp_v2_signature_events', 'gp_v2_signature_artifacts'
  ];
begin
  foreach table_name in array tables loop
    execute format('grant select on table public.%I to authenticated', table_name);
    execute format('drop policy if exists gp_v2_%I_team_read on public.%I', table_name, table_name);
    execute format(
      'create policy gp_v2_%I_team_read on public.%I for select to authenticated using (public.gp_v2_has_role(organization_id, array[''owner'', ''admin'', ''manager'', ''sales'', ''operational'']))',
      table_name,
      table_name
    );
  end loop;
end;
$$;

grant select on table public.gp_v2_signature_automation_rules to authenticated;
drop policy if exists gp_v2_signature_rules_manager_read on public.gp_v2_signature_automation_rules;
create policy gp_v2_signature_rules_manager_read on public.gp_v2_signature_automation_rules
for select to authenticated
using (public.gp_v2_has_role(organization_id, array['owner', 'admin', 'manager']));

grant select on table public.gp_v2_signature_jobs to authenticated;
drop policy if exists gp_v2_signature_jobs_admin_read on public.gp_v2_signature_jobs;
create policy gp_v2_signature_jobs_admin_read on public.gp_v2_signature_jobs
for select to authenticated
using (public.gp_v2_has_role(organization_id, array['owner', 'admin']));

grant select on table public.gp_v2_signature_webhook_receipts to authenticated;
drop policy if exists gp_v2_signature_webhook_receipts_admin_read on public.gp_v2_signature_webhook_receipts;
create policy gp_v2_signature_webhook_receipts_admin_read on public.gp_v2_signature_webhook_receipts
for select to authenticated
using (
  organization_id is not null
  and public.gp_v2_has_role(organization_id, array['owner', 'admin'])
);

insert into storage.buckets (id, name, public)
values ('gp-v2-signature-files', 'gp-v2-signature-files', false)
on conflict (id) do update set public = false;

-- There are intentionally no authenticated storage.objects policies for this
-- bucket. Uploads and short-lived downloads are mediated by authenticated Edge
-- Functions so originals and signed evidence never become public objects.

commit;
