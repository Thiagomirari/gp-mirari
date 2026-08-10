-- GP Mirari V02 - signature placement fields and provider email-delivery evidence.
begin;

create table if not exists public.gp_v2_signature_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  envelope_id uuid not null,
  envelope_document_id uuid not null,
  document_version_id uuid not null,
  signer_id uuid not null,
  field_type text not null check (field_type in ('signature', 'initial', 'signer_name', 'signed_at')),
  page_number integer not null check (page_number > 0),
  x_ratio numeric(10,8) not null check (x_ratio >= 0 and x_ratio <= 1),
  y_ratio numeric(10,8) not null check (y_ratio >= 0 and y_ratio <= 1),
  width_ratio numeric(10,8) not null check (width_ratio > 0 and width_ratio <= 1),
  height_ratio numeric(10,8) not null check (height_ratio > 0 and height_ratio <= 1),
  page_rotation integer not null default 0 check (page_rotation in (0, 90, 180, 270)),
  required boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (envelope_id, organization_id) references public.gp_v2_signature_envelopes(id, organization_id) on delete restrict,
  foreign key (envelope_document_id, organization_id) references public.gp_v2_signature_envelope_documents(id, organization_id) on delete restrict,
  foreign key (document_version_id, organization_id) references public.gp_v2_document_versions(id, organization_id) on delete restrict,
  foreign key (signer_id, organization_id) references public.gp_v2_signature_signers(id, organization_id) on delete restrict,
  check (x_ratio + width_ratio <= 1),
  check (y_ratio + height_ratio <= 1)
);
create index if not exists gp_v2_signature_fields_envelope_document_idx on public.gp_v2_signature_fields(organization_id, envelope_id, envelope_document_id, page_number);
create index if not exists gp_v2_signature_fields_signer_idx on public.gp_v2_signature_fields(organization_id, signer_id);

create table if not exists public.gp_v2_signature_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  envelope_id uuid not null,
  signer_id uuid,
  message_type text not null check (message_type in ('invitation', 'otp', 'completed')),
  provider text not null default 'resend' check (provider in ('resend', 'other')),
  provider_message_id_hash text not null check (provider_message_id_hash ~ '^[0-9a-f]{64}$'),
  delivery_status text not null default 'queued' check (delivery_status in ('queued', 'sent', 'delivered', 'delayed', 'bounced', 'failed', 'complained')),
  failure_reason_code text not null default '',
  provider_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, provider_message_id_hash),
  unique (id, organization_id),
  foreign key (envelope_id, organization_id) references public.gp_v2_signature_envelopes(id, organization_id) on delete restrict,
  foreign key (signer_id, organization_id) references public.gp_v2_signature_signers(id, organization_id) on delete restrict
);
create index if not exists gp_v2_signature_email_deliveries_envelope_idx on public.gp_v2_signature_email_deliveries(organization_id, envelope_id, delivery_status, updated_at desc);
create index if not exists gp_v2_signature_email_deliveries_signer_idx on public.gp_v2_signature_email_deliveries(organization_id, signer_id, updated_at desc) where signer_id is not null;

create or replace function public.gp_v2_guard_signature_field_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_organization_id uuid := coalesce(new.organization_id, old.organization_id); v_envelope_id uuid := coalesce(new.envelope_id, old.envelope_id); v_status text;
begin
  select status into v_status from public.gp_v2_signature_envelopes where id = v_envelope_id and organization_id = v_organization_id for update;
  if not found then raise exception 'signature envelope not found'; end if;
  if v_status not in ('preparing', 'awaiting_send', 'failed') then raise exception 'signature fields are immutable after sending'; end if;
  if exists (select 1 from public.gp_v2_signature_actions a where a.organization_id = v_organization_id and a.envelope_id = v_envelope_id) then raise exception 'signature fields are immutable after the first signature'; end if;
  if tg_op = 'DELETE' then return old; end if; return new;
end;
$$;
revoke all on function public.gp_v2_guard_signature_field_mutation() from public, anon, authenticated;
drop trigger if exists gp_v2_signature_fields_guard on public.gp_v2_signature_fields;
create trigger gp_v2_signature_fields_guard before insert or update or delete on public.gp_v2_signature_fields for each row execute function public.gp_v2_guard_signature_field_mutation();

alter table public.gp_v2_signature_fields enable row level security;
alter table public.gp_v2_signature_email_deliveries enable row level security;
revoke all on table public.gp_v2_signature_fields, public.gp_v2_signature_email_deliveries from anon, authenticated;
grant select on table public.gp_v2_signature_fields to authenticated;
create policy gp_v2_signature_fields_team_read on public.gp_v2_signature_fields for select to authenticated using (public.gp_v2_has_role(organization_id, array['owner', 'admin', 'manager', 'sales', 'operational']));

commit;
