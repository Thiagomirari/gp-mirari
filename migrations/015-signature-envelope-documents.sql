-- GP Mirari V02 - multi-document signature envelopes with immutable version manifests.
begin;

alter table public.gp_v2_signature_envelopes
  add column if not exists title text not null default '',
  add column if not exists document_manifest_sha256 text not null default '',
  add column if not exists editable_revision bigint not null default 0;
alter table public.gp_v2_signature_envelopes
  drop constraint if exists gp_v2_signature_envelopes_document_manifest_sha256_check;
alter table public.gp_v2_signature_envelopes
  add constraint gp_v2_signature_envelopes_document_manifest_sha256_check
  check (document_manifest_sha256 = '' or document_manifest_sha256 ~ '^[0-9a-f]{64}$');
alter table public.gp_v2_signature_envelopes
  add constraint gp_v2_signature_envelopes_editable_revision_check check (editable_revision >= 0);

create table if not exists public.gp_v2_signature_envelope_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  envelope_id uuid not null,
  document_id uuid not null,
  document_version_id uuid not null,
  display_order integer not null check (display_order > 0),
  required boolean not null default true,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, envelope_id, display_order),
  unique (organization_id, envelope_id, document_version_id),
  foreign key (envelope_id, organization_id) references public.gp_v2_signature_envelopes(id, organization_id) on delete restrict,
  foreign key (document_id, organization_id) references public.gp_v2_documents(id, organization_id) on delete restrict,
  foreign key (document_version_id, organization_id) references public.gp_v2_document_versions(id, organization_id) on delete restrict
);
create index if not exists gp_v2_signature_envelope_documents_envelope_idx on public.gp_v2_signature_envelope_documents(organization_id, envelope_id, display_order);
create index if not exists gp_v2_signature_envelope_documents_document_idx on public.gp_v2_signature_envelope_documents(organization_id, document_id);

insert into public.gp_v2_signature_envelope_documents (organization_id, envelope_id, document_id, document_version_id, display_order, required, created_by)
select e.organization_id, e.id, e.document_id, e.document_version_id, 1, true, e.created_by
from public.gp_v2_signature_envelopes e
where not exists (
  select 1 from public.gp_v2_signature_envelope_documents ed
  where ed.organization_id = e.organization_id and ed.envelope_id = e.id
);

create or replace function public.gp_v2_refresh_signature_envelope_manifest(p_organization_id uuid, p_envelope_id uuid)
returns text language plpgsql security invoker set search_path = '' as $$
declare v_manifest text;
begin
  select encode(extensions.digest(string_agg(ed.display_order::text || ':' || ed.document_id::text || ':' || ed.document_version_id::text || ':' || dv.sha256 || ':' || ed.required::text, E'\n' order by ed.display_order), 'sha256'), 'hex')
  into v_manifest
  from public.gp_v2_signature_envelope_documents ed
  join public.gp_v2_document_versions dv on dv.id = ed.document_version_id and dv.organization_id = ed.organization_id
  where ed.organization_id = p_organization_id and ed.envelope_id = p_envelope_id;
  if v_manifest is null then raise exception 'signature envelope requires at least one document'; end if;
  update public.gp_v2_signature_envelopes
  set document_manifest_sha256 = v_manifest, editable_revision = editable_revision + 1, updated_at = clock_timestamp()
  where id = p_envelope_id and organization_id = p_organization_id;
  if not found then raise exception 'signature envelope not found'; end if;
  return v_manifest;
end;
$$;

create or replace function public.gp_v2_guard_signature_envelope_document_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_organization_id uuid := coalesce(new.organization_id, old.organization_id); v_envelope_id uuid := coalesce(new.envelope_id, old.envelope_id); v_status text;
begin
  select status into v_status from public.gp_v2_signature_envelopes where id = v_envelope_id and organization_id = v_organization_id for update;
  if not found then raise exception 'signature envelope not found'; end if;
  if v_status not in ('preparing', 'awaiting_send', 'failed') then raise exception 'envelope documents are immutable after sending'; end if;
  if exists (select 1 from public.gp_v2_signature_actions a where a.organization_id = v_organization_id and a.envelope_id = v_envelope_id) then raise exception 'envelope documents are immutable after the first signature'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.gp_v2_signature_envelope_documents_manifest_trigger()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.gp_v2_signature_envelope_documents where organization_id = old.organization_id and envelope_id = old.envelope_id) then
      perform public.gp_v2_refresh_signature_envelope_manifest(old.organization_id, old.envelope_id);
    end if;
    return old;
  end if;
  perform public.gp_v2_refresh_signature_envelope_manifest(new.organization_id, new.envelope_id);
  return new;
end;
$$;

revoke all on function public.gp_v2_refresh_signature_envelope_manifest(uuid, uuid) from public, anon, authenticated;
revoke all on function public.gp_v2_guard_signature_envelope_document_mutation() from public, anon, authenticated;
revoke all on function public.gp_v2_signature_envelope_documents_manifest_trigger() from public, anon, authenticated;
grant execute on function public.gp_v2_refresh_signature_envelope_manifest(uuid, uuid) to service_role;

drop trigger if exists gp_v2_signature_envelope_documents_guard on public.gp_v2_signature_envelope_documents;
create trigger gp_v2_signature_envelope_documents_guard before insert or update or delete on public.gp_v2_signature_envelope_documents for each row execute function public.gp_v2_guard_signature_envelope_document_mutation();
drop trigger if exists gp_v2_signature_envelope_documents_manifest on public.gp_v2_signature_envelope_documents;
create trigger gp_v2_signature_envelope_documents_manifest after insert or update or delete on public.gp_v2_signature_envelope_documents for each row execute function public.gp_v2_signature_envelope_documents_manifest_trigger();

do $$ declare r record; begin
  for r in select distinct organization_id, envelope_id from public.gp_v2_signature_envelope_documents loop
    perform public.gp_v2_refresh_signature_envelope_manifest(r.organization_id, r.envelope_id);
  end loop;
end; $$;

alter table public.gp_v2_signature_consents add column if not exists document_manifest_sha256 text not null default '';
alter table public.gp_v2_signature_consents drop constraint if exists gp_v2_signature_consents_document_manifest_sha256_check;
alter table public.gp_v2_signature_consents add constraint gp_v2_signature_consents_document_manifest_sha256_check check (document_manifest_sha256 = '' or document_manifest_sha256 ~ '^[0-9a-f]{64}$');
alter table public.gp_v2_signature_actions add column if not exists document_manifest_sha256 text not null default '';
alter table public.gp_v2_signature_actions drop constraint if exists gp_v2_signature_actions_document_manifest_sha256_check;
alter table public.gp_v2_signature_actions add constraint gp_v2_signature_actions_document_manifest_sha256_check check (document_manifest_sha256 = '' or document_manifest_sha256 ~ '^[0-9a-f]{64}$');

alter table public.gp_v2_signature_envelope_documents enable row level security;
revoke all on table public.gp_v2_signature_envelope_documents from anon, authenticated;
grant select on table public.gp_v2_signature_envelope_documents to authenticated;
drop policy if exists gp_v2_signature_envelope_documents_team_read on public.gp_v2_signature_envelope_documents;
create policy gp_v2_signature_envelope_documents_team_read on public.gp_v2_signature_envelope_documents for select to authenticated using (public.gp_v2_has_role(organization_id, array['owner', 'admin', 'manager', 'sales', 'operational']));

commit;
