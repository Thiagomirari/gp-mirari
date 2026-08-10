-- GP Mirari V02 - Provedor interno de assinatura eletrônica com OTP e trilha de evidências.
-- Nenhum token ou codigo OTP e armazenado em texto aberto.

begin;

alter table public.gp_v2_documents
  add column if not exists verification_code text,
  add column if not exists purpose text not null default '',
  add column if not exists legal_basis text,
  add column if not exists privacy_notice_version text not null default '',
  add column if not exists retention_policy_version text not null default '',
  add column if not exists retention_until date,
  add column if not exists completed_at timestamptz,
  add column if not exists superseded_by_document_id uuid;

alter table public.gp_v2_documents drop constraint if exists gp_v2_documents_status_check;
alter table public.gp_v2_documents add constraint gp_v2_documents_status_check
  check (status in ('draft', 'awaiting_send', 'ready', 'preparing', 'awaiting_signature', 'partially_signed', 'finalizing', 'signed', 'declined', 'expired', 'cancelled', 'failed', 'superseded'));
alter table public.gp_v2_documents drop constraint if exists gp_v2_documents_legal_basis_check;
alter table public.gp_v2_documents add constraint gp_v2_documents_legal_basis_check
  check (legal_basis is null or legal_basis in ('contract_execution', 'pre_contract', 'legal_obligation', 'regular_exercise_rights', 'legitimate_interest', 'consent', 'other'));
alter table public.gp_v2_documents drop constraint if exists gp_v2_documents_superseded_org_fkey;
alter table public.gp_v2_documents add constraint gp_v2_documents_superseded_org_fkey
  foreign key (superseded_by_document_id, organization_id)
  references public.gp_v2_documents(id, organization_id) on delete restrict;

create unique index if not exists gp_v2_documents_verification_code_uidx
  on public.gp_v2_documents(verification_code)
  where verification_code is not null and verification_code <> '';
create index if not exists gp_v2_documents_superseded_org_fk_idx
  on public.gp_v2_documents(superseded_by_document_id, organization_id)
  where superseded_by_document_id is not null;
create index if not exists gp_v2_documents_retention_idx
  on public.gp_v2_documents(organization_id, retention_until)
  where retention_until is not null and archived_at is null;

alter table public.gp_v2_signature_envelopes drop constraint if exists gp_v2_signature_envelopes_provider_check;
alter table public.gp_v2_signature_envelopes add constraint gp_v2_signature_envelopes_provider_check
  check (provider in ('internal', 'autentique', 'clicksign', 'docusign', 'gov_br', 'icp_brasil', 'other'));
alter table public.gp_v2_signature_envelopes drop constraint if exists gp_v2_signature_envelopes_status_check;
alter table public.gp_v2_signature_envelopes add constraint gp_v2_signature_envelopes_status_check
  check (status in ('preparing', 'awaiting_send', 'awaiting_signature', 'partially_signed', 'finalizing', 'signed', 'declined', 'expired', 'cancelled', 'failed', 'superseded'));

alter table public.gp_v2_signature_jobs drop constraint if exists gp_v2_signature_jobs_job_type_check;
alter table public.gp_v2_signature_jobs add constraint gp_v2_signature_jobs_job_type_check
  check (job_type in ('create_from_rule', 'send_envelope', 'sync_envelope', 'download_artifacts', 'finalize_internal'));

alter table public.gp_v2_signature_signers
  add column if not exists signer_type text not null default 'person',
  add column if not exists company_legal_name text not null default '',
  add column if not exists company_document_last4 text not null default '',
  add column if not exists company_document_hash text not null default '',
  add column if not exists job_title text not null default '',
  add column if not exists representation_declared boolean not null default false,
  add column if not exists representation_declared_at timestamptz,
  add column if not exists identity_confirmed_at timestamptz,
  add column if not exists otp_verified_at timestamptz,
  add column if not exists consented_at timestamptz;

alter table public.gp_v2_signature_signers drop constraint if exists gp_v2_signature_signers_signer_role_check;
alter table public.gp_v2_signature_signers add constraint gp_v2_signature_signers_signer_role_check
  check (signer_role in ('contracting_party', 'contracted_party', 'legal_representative', 'witness', 'guarantor', 'avalist', 'approver', 'company', 'client', 'signer'));
alter table public.gp_v2_signature_signers drop constraint if exists gp_v2_signature_signers_status_check;
alter table public.gp_v2_signature_signers add constraint gp_v2_signature_signers_status_check
  check (status in ('pending', 'invited', 'viewed', 'identity_confirmed', 'otp_verified', 'consented', 'signed', 'declined', 'delivery_failed'));
alter table public.gp_v2_signature_signers drop constraint if exists gp_v2_signature_signers_signer_type_check;
alter table public.gp_v2_signature_signers add constraint gp_v2_signature_signers_signer_type_check
  check (signer_type in ('person', 'company_representative'));
alter table public.gp_v2_signature_signers drop constraint if exists gp_v2_signature_signers_company_hash_check;
alter table public.gp_v2_signature_signers add constraint gp_v2_signature_signers_company_hash_check
  check (company_document_hash = '' or company_document_hash ~ '^[0-9a-f]{64}$');

alter table public.gp_v2_signature_events
  add column if not exists sequence_number bigint not null default 0,
  add column if not exists local_occurred_at text not null default '',
  add column if not exists presented_timezone text not null default 'America/Sao_Paulo',
  add column if not exists ip_address inet,
  add column if not exists ip_hash text not null default '',
  add column if not exists user_agent text not null default '',
  add column if not exists browser text not null default '',
  add column if not exists operating_system text not null default '',
  add column if not exists token_fingerprint text not null default '',
  add column if not exists result text not null default 'success',
  add column if not exists document_sha256 text not null default '',
  add column if not exists auth_channel text not null default '',
  add column if not exists previous_event_hash text not null default '',
  add column if not exists event_hash text not null default '';

alter table public.gp_v2_signature_events drop constraint if exists gp_v2_signature_events_sequence_check;
alter table public.gp_v2_signature_events add constraint gp_v2_signature_events_sequence_check check (sequence_number >= 0);
alter table public.gp_v2_signature_events drop constraint if exists gp_v2_signature_events_ip_hash_check;
alter table public.gp_v2_signature_events add constraint gp_v2_signature_events_ip_hash_check check (ip_hash = '' or ip_hash ~ '^[0-9a-f]{64}$');
alter table public.gp_v2_signature_events drop constraint if exists gp_v2_signature_events_document_hash_check;
alter table public.gp_v2_signature_events add constraint gp_v2_signature_events_document_hash_check check (document_sha256 = '' or document_sha256 ~ '^[0-9a-f]{64}$');
alter table public.gp_v2_signature_events drop constraint if exists gp_v2_signature_events_previous_hash_check;
alter table public.gp_v2_signature_events add constraint gp_v2_signature_events_previous_hash_check check (previous_event_hash = '' or previous_event_hash ~ '^[0-9a-f]{64}$');
alter table public.gp_v2_signature_events drop constraint if exists gp_v2_signature_events_event_hash_check;
alter table public.gp_v2_signature_events add constraint gp_v2_signature_events_event_hash_check check (event_hash = '' or event_hash ~ '^[0-9a-f]{64}$');
create unique index if not exists gp_v2_signature_events_envelope_sequence_uidx
  on public.gp_v2_signature_events(organization_id, envelope_id, sequence_number)
  where sequence_number > 0;

create table if not exists public.gp_v2_signature_consent_texts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  version text not null,
  content text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  active boolean not null default true,
  published_at timestamptz not null default now(),
  retired_at timestamptz,
  created_by uuid,
  unique (organization_id, version),
  unique (id, organization_id),
  check (length(trim(content)) > 0)
);

insert into public.gp_v2_signature_consent_texts (organization_id, version, content, content_sha256)
select organization.id,
       'gp-sign-consent-v1',
       'Declaro que li o documento apresentado, concordo com seu conteúdo e reconheço como válida a utilização desta assinatura eletrônica para formalizar minha manifestação de vontade.',
       encode(extensions.digest(convert_to('Declaro que li o documento apresentado, concordo com seu conteúdo e reconheço como válida a utilização desta assinatura eletrônica para formalizar minha manifestação de vontade.', 'UTF8'), 'sha256'), 'hex')
from public.gp_v2_organizations organization
on conflict (organization_id, version) do nothing;

create table if not exists public.gp_v2_signature_privacy_notices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  version text not null,
  title text not null,
  content text not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  active boolean not null default false,
  published_at timestamptz,
  retired_at timestamptz,
  created_by uuid,
  unique (organization_id, version),
  unique (id, organization_id),
  check (length(trim(title)) > 0),
  check (length(trim(content)) > 0)
);

create table if not exists public.gp_v2_signature_access_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  envelope_id uuid not null,
  signer_id uuid not null,
  token_hash text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  token_fingerprint text not null check (token_fingerprint ~ '^[0-9a-f]{16}$'),
  status text not null default 'active' check (status in ('active', 'revoked', 'expired', 'consumed')),
  expires_at timestamptz not null,
  max_accesses integer not null default 100 check (max_accesses between 1 and 1000),
  access_count integer not null default 0 check (access_count >= 0),
  first_accessed_at timestamptz,
  last_accessed_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (token_hash),
  unique (id, organization_id),
  foreign key (envelope_id, organization_id) references public.gp_v2_signature_envelopes(id, organization_id) on delete restrict,
  foreign key (signer_id, organization_id) references public.gp_v2_signature_signers(id, organization_id) on delete restrict
);
create index if not exists gp_v2_signature_links_envelope_org_fk_idx on public.gp_v2_signature_access_links(envelope_id, organization_id);
create index if not exists gp_v2_signature_links_signer_org_fk_idx on public.gp_v2_signature_access_links(signer_id, organization_id);
create index if not exists gp_v2_signature_links_active_idx on public.gp_v2_signature_access_links(token_hash, expires_at) where status = 'active';

create table if not exists public.gp_v2_signature_otp_challenges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  envelope_id uuid not null,
  signer_id uuid not null,
  access_link_id uuid not null,
  code_hash text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check (status in ('pending', 'verified', 'expired', 'locked', 'invalidated', 'delivery_failed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 3 and 10),
  expires_at timestamptz not null,
  locked_until timestamptz,
  requested_at timestamptz not null default now(),
  sent_at timestamptz,
  verified_at timestamptz,
  invalidated_at timestamptz,
  provider_message_id_hash text not null default '',
  request_ip_hash text not null check (request_ip_hash ~ '^[0-9a-f]{64}$'),
  request_user_agent_hash text not null check (request_user_agent_hash ~ '^[0-9a-f]{64}$'),
  unique (id, organization_id),
  foreign key (envelope_id, organization_id) references public.gp_v2_signature_envelopes(id, organization_id) on delete restrict,
  foreign key (signer_id, organization_id) references public.gp_v2_signature_signers(id, organization_id) on delete restrict,
  foreign key (access_link_id, organization_id) references public.gp_v2_signature_access_links(id, organization_id) on delete restrict
);
create index if not exists gp_v2_signature_otp_signer_date_idx on public.gp_v2_signature_otp_challenges(organization_id, signer_id, requested_at desc);
create index if not exists gp_v2_signature_otp_envelope_org_fk_idx on public.gp_v2_signature_otp_challenges(envelope_id, organization_id);
create index if not exists gp_v2_signature_otp_link_org_fk_idx on public.gp_v2_signature_otp_challenges(access_link_id, organization_id);

create table if not exists public.gp_v2_signature_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  envelope_id uuid not null,
  signer_id uuid not null,
  session_hash text not null check (session_hash ~ '^[0-9a-f]{64}$'),
  session_fingerprint text not null check (session_fingerprint ~ '^[0-9a-f]{16}$'),
  status text not null default 'active' check (status in ('active', 'expired', 'revoked', 'completed')),
  expires_at timestamptz not null,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent_hash text not null check (user_agent_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  document_viewed_at timestamptz,
  revoked_at timestamptz,
  unique (session_hash),
  unique (id, organization_id),
  foreign key (envelope_id, organization_id) references public.gp_v2_signature_envelopes(id, organization_id) on delete restrict,
  foreign key (signer_id, organization_id) references public.gp_v2_signature_signers(id, organization_id) on delete restrict
);
create index if not exists gp_v2_signature_sessions_envelope_org_fk_idx on public.gp_v2_signature_sessions(envelope_id, organization_id);
create index if not exists gp_v2_signature_sessions_signer_org_fk_idx on public.gp_v2_signature_sessions(signer_id, organization_id);
create index if not exists gp_v2_signature_sessions_active_idx on public.gp_v2_signature_sessions(session_hash, expires_at) where status = 'active';

create table if not exists public.gp_v2_signature_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  envelope_id uuid not null,
  signer_id uuid not null,
  document_version_id uuid not null,
  consent_text_id uuid not null,
  consent_text_version text not null,
  consent_text_sha256 text not null check (consent_text_sha256 ~ '^[0-9a-f]{64}$'),
  accepted_at timestamptz not null,
  ip_address inet,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent text not null default '',
  presented_timezone text not null default 'America/Sao_Paulo',
  local_accepted_at text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, envelope_id, signer_id),
  unique (id, organization_id),
  foreign key (envelope_id, organization_id) references public.gp_v2_signature_envelopes(id, organization_id) on delete restrict,
  foreign key (signer_id, organization_id) references public.gp_v2_signature_signers(id, organization_id) on delete restrict,
  foreign key (document_version_id, organization_id) references public.gp_v2_document_versions(id, organization_id) on delete restrict,
  foreign key (consent_text_id, organization_id) references public.gp_v2_signature_consent_texts(id, organization_id) on delete restrict
);
create index if not exists gp_v2_signature_consents_envelope_org_fk_idx on public.gp_v2_signature_consents(envelope_id, organization_id);
create index if not exists gp_v2_signature_consents_signer_org_fk_idx on public.gp_v2_signature_consents(signer_id, organization_id);
create index if not exists gp_v2_signature_consents_version_org_fk_idx on public.gp_v2_signature_consents(document_version_id, organization_id);
create index if not exists gp_v2_signature_consents_text_org_fk_idx on public.gp_v2_signature_consents(consent_text_id, organization_id);

create table if not exists public.gp_v2_signature_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  envelope_id uuid not null,
  signer_id uuid not null,
  document_version_id uuid not null,
  consent_id uuid not null,
  signature_method text not null default 'electronic_action' check (signature_method in ('electronic_action', 'external_provider', 'gov_br', 'icp_brasil')),
  visual_representation text not null default 'typed_name' check (visual_representation in ('typed_name', 'drawn', 'none')),
  visual_representation_sha256 text not null default '' check (visual_representation_sha256 = '' or visual_representation_sha256 ~ '^[0-9a-f]{64}$'),
  signed_at timestamptz not null,
  ip_address inet,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  user_agent text not null default '',
  presented_timezone text not null default 'America/Sao_Paulo',
  local_signed_at text not null,
  document_sha256 text not null check (document_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (organization_id, envelope_id, signer_id),
  unique (id, organization_id),
  foreign key (envelope_id, organization_id) references public.gp_v2_signature_envelopes(id, organization_id) on delete restrict,
  foreign key (signer_id, organization_id) references public.gp_v2_signature_signers(id, organization_id) on delete restrict,
  foreign key (document_version_id, organization_id) references public.gp_v2_document_versions(id, organization_id) on delete restrict,
  foreign key (consent_id, organization_id) references public.gp_v2_signature_consents(id, organization_id) on delete restrict
);
create index if not exists gp_v2_signature_actions_envelope_org_fk_idx on public.gp_v2_signature_actions(envelope_id, organization_id);
create index if not exists gp_v2_signature_actions_signer_org_fk_idx on public.gp_v2_signature_actions(signer_id, organization_id);
create index if not exists gp_v2_signature_actions_version_org_fk_idx on public.gp_v2_signature_actions(document_version_id, organization_id);
create index if not exists gp_v2_signature_actions_consent_org_fk_idx on public.gp_v2_signature_actions(consent_id, organization_id);

create table if not exists public.gp_v2_signature_rate_limits (
  id uuid primary key default gen_random_uuid(),
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  action text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  blocked_until timestamptz,
  updated_at timestamptz not null default now(),
  unique (key_hash, action),
  check (length(trim(action)) > 0)
);

create table if not exists public.gp_v2_signature_retention_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  version text not null,
  name text not null,
  document_kind text not null check (document_kind in ('contract', 'proposal', 'addendum', 'executive_project', 'acceptance_term', 'other')),
  retention_months integer not null check (retention_months between 1 and 600),
  evidence_retention_months integer not null check (evidence_retention_months between 1 and 600),
  legal_basis text not null check (legal_basis in ('contract_execution', 'pre_contract', 'legal_obligation', 'regular_exercise_rights', 'legitimate_interest', 'consent', 'other')),
  purpose text not null,
  active boolean not null default false,
  legal_hold_supported boolean not null default true,
  approved_by text not null default '',
  approved_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (organization_id, version, document_kind),
  unique (id, organization_id),
  check (length(trim(name)) > 0),
  check (length(trim(purpose)) > 0)
);

create table if not exists public.gp_v2_signature_security_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.gp_v2_organizations(id) on delete restrict,
  envelope_id uuid,
  signer_id uuid,
  incident_type text not null,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'investigating', 'contained', 'resolved', 'false_positive')),
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  source_ip_hash text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (envelope_id, organization_id) references public.gp_v2_signature_envelopes(id, organization_id) on delete restrict,
  foreign key (signer_id, organization_id) references public.gp_v2_signature_signers(id, organization_id) on delete restrict,
  check (length(trim(incident_type)) > 0),
  check (source_ip_hash = '' or source_ip_hash ~ '^[0-9a-f]{64}$')
);
create index if not exists gp_v2_signature_incidents_org_status_idx on public.gp_v2_signature_security_incidents(organization_id, status, detected_at desc);
create index if not exists gp_v2_signature_incidents_envelope_org_fk_idx on public.gp_v2_signature_security_incidents(envelope_id, organization_id) where envelope_id is not null;
create index if not exists gp_v2_signature_incidents_signer_org_fk_idx on public.gp_v2_signature_security_incidents(signer_id, organization_id) where signer_id is not null;

create or replace function public.gp_v2_append_signature_event(
  p_organization_id uuid,
  p_envelope_id uuid,
  p_signer_id uuid,
  p_provider_event_id text,
  p_event_type text,
  p_actor_type text,
  p_payload_sha256 text,
  p_occurred_at timestamptz,
  p_local_occurred_at text,
  p_presented_timezone text,
  p_ip_address inet,
  p_ip_hash text,
  p_user_agent text,
  p_browser text,
  p_operating_system text,
  p_token_fingerprint text,
  p_result text,
  p_document_sha256 text,
  p_auth_channel text,
  p_metadata jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  next_sequence bigint;
  new_event_id uuid;
  prior_hash text;
  calculated_event_hash text;
begin
  perform 1
  from public.gp_v2_signature_envelopes envelope
  where envelope.id = p_envelope_id and envelope.organization_id = p_organization_id
  for update;
  if not found then raise exception 'signature envelope not found'; end if;

  select coalesce(max(event.sequence_number), 0) + 1,
         coalesce((array_agg(event.event_hash order by event.sequence_number desc))[1], '')
  into next_sequence, prior_hash
  from public.gp_v2_signature_events event
  where event.organization_id = p_organization_id and event.envelope_id = p_envelope_id;

  calculated_event_hash := encode(extensions.digest(convert_to(
    concat_ws('|', p_organization_id::text, p_envelope_id::text, coalesce(p_signer_id::text, ''),
      next_sequence::text, coalesce(p_event_type, ''), coalesce(p_actor_type, ''),
      coalesce(p_payload_sha256, ''), p_occurred_at::text, coalesce(p_result, 'success'),
      coalesce(p_document_sha256, ''), prior_hash), 'UTF8'), 'sha256'), 'hex');

  insert into public.gp_v2_signature_events (
    organization_id, envelope_id, signer_id, provider_event_id, event_type, actor_type,
    payload_sha256, occurred_at, sequence_number, local_occurred_at, presented_timezone,
    ip_address, ip_hash, user_agent, browser, operating_system, token_fingerprint,
    result, document_sha256, auth_channel, previous_event_hash, event_hash, metadata
  ) values (
    p_organization_id, p_envelope_id, p_signer_id, coalesce(p_provider_event_id, ''), p_event_type, p_actor_type,
    p_payload_sha256, p_occurred_at, next_sequence, coalesce(p_local_occurred_at, ''), coalesce(p_presented_timezone, 'America/Sao_Paulo'),
    p_ip_address, coalesce(p_ip_hash, ''), left(coalesce(p_user_agent, ''), 1000), left(coalesce(p_browser, ''), 120),
    left(coalesce(p_operating_system, ''), 120), left(coalesce(p_token_fingerprint, ''), 64), left(coalesce(p_result, 'success'), 80),
    coalesce(p_document_sha256, ''), left(coalesce(p_auth_channel, ''), 80), prior_hash, calculated_event_hash,
    coalesce(p_metadata, '{}'::jsonb)
  ) returning id into new_event_id;
  return new_event_id;
end;
$$;

create or replace function public.gp_v2_consume_signature_rate_limit(
  p_key_hash text,
  p_action text,
  p_window_seconds integer,
  p_max_requests integer,
  p_block_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rate_row public.gp_v2_signature_rate_limits%rowtype;
  current_time timestamptz := now();
begin
  insert into public.gp_v2_signature_rate_limits (key_hash, action, request_count)
  values (p_key_hash, p_action, 0)
  on conflict (key_hash, action) do nothing;

  select * into rate_row
  from public.gp_v2_signature_rate_limits
  where key_hash = p_key_hash and action = p_action
  for update;

  if rate_row.blocked_until is not null and rate_row.blocked_until > current_time then
    return query select false, greatest(1, ceil(extract(epoch from rate_row.blocked_until - current_time))::integer);
    return;
  end if;

  if rate_row.window_started_at + make_interval(secs => p_window_seconds) <= current_time then
    update public.gp_v2_signature_rate_limits
    set window_started_at = current_time, request_count = 1, blocked_until = null, updated_at = current_time
    where id = rate_row.id;
    return query select true, 0;
    return;
  end if;

  if rate_row.request_count + 1 > p_max_requests then
    update public.gp_v2_signature_rate_limits
    set request_count = request_count + 1,
        blocked_until = current_time + make_interval(secs => p_block_seconds),
        updated_at = current_time
    where id = rate_row.id;
    return query select false, p_block_seconds;
    return;
  end if;

  update public.gp_v2_signature_rate_limits
  set request_count = request_count + 1, updated_at = current_time
  where id = rate_row.id;
  return query select true, 0;
end;
$$;

create or replace function public.gp_v2_mark_internal_signature(
  p_organization_id uuid,
  p_envelope_id uuid,
  p_signer_id uuid,
  p_signed_at timestamptz
)
returns table (should_finalize boolean, already_signed boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  envelope_row public.gp_v2_signature_envelopes%rowtype;
  signer_status text;
  pending_count integer;
begin
  select * into envelope_row
  from public.gp_v2_signature_envelopes
  where id = p_envelope_id and organization_id = p_organization_id
  for update;
  if not found or envelope_row.provider <> 'internal' then raise exception 'internal signature envelope not found'; end if;
  if envelope_row.status in ('signed', 'declined', 'expired', 'cancelled', 'superseded') then raise exception 'signature envelope is closed'; end if;

  select status into signer_status
  from public.gp_v2_signature_signers
  where id = p_signer_id and envelope_id = p_envelope_id and organization_id = p_organization_id
  for update;
  if not found then raise exception 'signature signer not found'; end if;
  if signer_status = 'signed' then return query select false, true; return; end if;

  update public.gp_v2_signature_signers
  set status = 'signed', signed_at = p_signed_at, updated_at = p_signed_at
  where id = p_signer_id and organization_id = p_organization_id;

  select count(*) into pending_count
  from public.gp_v2_signature_signers
  where envelope_id = p_envelope_id and organization_id = p_organization_id and status <> 'signed';

  if pending_count = 0 then
    update public.gp_v2_signature_envelopes set status = 'finalizing', updated_at = p_signed_at where id = p_envelope_id and organization_id = p_organization_id;
    update public.gp_v2_documents set status = 'finalizing', updated_at = p_signed_at where id = envelope_row.document_id and organization_id = p_organization_id;
    return query select true, false;
  else
    update public.gp_v2_signature_envelopes set status = 'partially_signed', updated_at = p_signed_at where id = p_envelope_id and organization_id = p_organization_id;
    update public.gp_v2_documents set status = 'partially_signed', updated_at = p_signed_at where id = envelope_row.document_id and organization_id = p_organization_id;
    return query select false, false;
  end if;
end;
$$;

create or replace function public.gp_v2_verify_signature_otp(
  p_challenge_id uuid,
  p_code_hash text,
  p_locked_until timestamptz
)
returns table (verification_result text, signer_id uuid, envelope_id uuid, organization_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  challenge_row public.gp_v2_signature_otp_challenges%rowtype;
  current_time timestamptz := now();
begin
  select * into challenge_row
  from public.gp_v2_signature_otp_challenges
  where id = p_challenge_id
  for update;

  if not found then
    return query select 'invalid'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;
  if challenge_row.status <> 'pending' then
    return query select challenge_row.status, challenge_row.signer_id, challenge_row.envelope_id, challenge_row.organization_id;
    return;
  end if;
  if challenge_row.expires_at <= current_time then
    update public.gp_v2_signature_otp_challenges set status = 'expired' where id = challenge_row.id;
    return query select 'expired'::text, challenge_row.signer_id, challenge_row.envelope_id, challenge_row.organization_id;
    return;
  end if;
  if challenge_row.code_hash = p_code_hash then
    update public.gp_v2_signature_otp_challenges
    set status = 'verified', verified_at = current_time
    where id = challenge_row.id;
    return query select 'verified'::text, challenge_row.signer_id, challenge_row.envelope_id, challenge_row.organization_id;
    return;
  end if;

  if challenge_row.attempt_count + 1 >= challenge_row.max_attempts then
    update public.gp_v2_signature_otp_challenges
    set status = 'locked', attempt_count = attempt_count + 1, locked_until = p_locked_until
    where id = challenge_row.id;
    return query select 'locked'::text, challenge_row.signer_id, challenge_row.envelope_id, challenge_row.organization_id;
  end if;

  update public.gp_v2_signature_otp_challenges
  set attempt_count = attempt_count + 1
  where id = challenge_row.id;
  return query select 'rejected'::text, challenge_row.signer_id, challenge_row.envelope_id, challenge_row.organization_id;
end;
$$;

revoke all on function public.gp_v2_append_signature_event(uuid, uuid, uuid, text, text, text, text, timestamptz, text, text, inet, text, text, text, text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.gp_v2_consume_signature_rate_limit(text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.gp_v2_mark_internal_signature(uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.gp_v2_verify_signature_otp(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.gp_v2_append_signature_event(uuid, uuid, uuid, text, text, text, text, timestamptz, text, text, inet, text, text, text, text, text, text, text, text, jsonb) to service_role;
grant execute on function public.gp_v2_consume_signature_rate_limit(text, text, integer, integer, integer) to service_role;
grant execute on function public.gp_v2_mark_internal_signature(uuid, uuid, uuid, timestamptz) to service_role;
grant execute on function public.gp_v2_verify_signature_otp(uuid, text, timestamptz) to service_role;

drop trigger if exists gp_v2_signature_consents_immutable on public.gp_v2_signature_consents;
create trigger gp_v2_signature_consents_immutable
before update or delete on public.gp_v2_signature_consents
for each row execute function public.gp_v2_reject_immutable_signature_mutation();

drop trigger if exists gp_v2_signature_actions_immutable on public.gp_v2_signature_actions;
create trigger gp_v2_signature_actions_immutable
before update or delete on public.gp_v2_signature_actions
for each row execute function public.gp_v2_reject_immutable_signature_mutation();

create or replace function public.gp_v2_guard_terminal_signature_envelope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('signed', 'declined', 'expired', 'cancelled', 'superseded') and new.status <> old.status then
    raise exception 'terminal signature envelope cannot be reopened';
  end if;
  return new;
end;
$$;
revoke all on function public.gp_v2_guard_terminal_signature_envelope() from public, anon, authenticated;

do $$
declare
  table_name text;
  tables text[] := array[
    'gp_v2_signature_consent_texts', 'gp_v2_signature_privacy_notices',
    'gp_v2_signature_access_links', 'gp_v2_signature_otp_challenges',
    'gp_v2_signature_sessions', 'gp_v2_signature_consents', 'gp_v2_signature_actions',
    'gp_v2_signature_rate_limits', 'gp_v2_signature_retention_policies',
    'gp_v2_signature_security_incidents'
  ];
begin
  foreach table_name in array tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from anon', table_name);
    execute format('revoke all on table public.%I from authenticated', table_name);
  end loop;
end;
$$;

grant select on table public.gp_v2_signature_consent_texts to authenticated;
create policy gp_v2_signature_consent_texts_team_read on public.gp_v2_signature_consent_texts
for select to authenticated
using (public.gp_v2_has_role(organization_id, array['owner', 'admin', 'manager', 'sales', 'operational']));

grant select on table public.gp_v2_signature_privacy_notices to authenticated;
create policy gp_v2_signature_privacy_notices_team_read on public.gp_v2_signature_privacy_notices
for select to authenticated
using (public.gp_v2_has_role(organization_id, array['owner', 'admin', 'manager', 'sales', 'operational']));

grant select on table public.gp_v2_signature_retention_policies to authenticated;
create policy gp_v2_signature_retention_policies_manager_read on public.gp_v2_signature_retention_policies
for select to authenticated
using (public.gp_v2_has_role(organization_id, array['owner', 'admin', 'manager']));

grant select on table public.gp_v2_signature_security_incidents to authenticated;
create policy gp_v2_signature_incidents_admin_read on public.gp_v2_signature_security_incidents
for select to authenticated
using (organization_id is not null and public.gp_v2_has_role(organization_id, array['owner', 'admin']));

-- Public signer access is exclusively mediated by gp-v2-sign-public. No anon
-- table or Storage policy is created for tokens, OTPs, sessions, consents or files.

commit;
