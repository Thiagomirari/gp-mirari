-- GP Mirari V02 - Published compliance versions are content-immutable.
begin;

create or replace function public.gp_v2_guard_versioned_signature_configuration()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'gp_v2_signature_privacy_notices' then
    if (to_jsonb(new) - array['active','retired_at']::text[]) is distinct from (to_jsonb(old) - array['active','retired_at']::text[]) then
      raise exception 'published privacy notice content is immutable; create a new version';
    end if;
  elsif tg_table_name = 'gp_v2_signature_retention_policies' then
    if (to_jsonb(new) - 'active') is distinct from (to_jsonb(old) - 'active') then
      raise exception 'published retention policy content is immutable; create a new version';
    end if;
  elsif tg_table_name = 'gp_v2_signature_consent_texts' then
    if (to_jsonb(new) - array['active','retired_at']::text[]) is distinct from (to_jsonb(old) - array['active','retired_at']::text[]) then
      raise exception 'published consent text content is immutable; create a new version';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.gp_v2_guard_versioned_signature_configuration() from public, anon, authenticated;

drop trigger if exists gp_v2_signature_privacy_notices_version_guard on public.gp_v2_signature_privacy_notices;
create trigger gp_v2_signature_privacy_notices_version_guard before update on public.gp_v2_signature_privacy_notices
for each row execute function public.gp_v2_guard_versioned_signature_configuration();

drop trigger if exists gp_v2_signature_retention_policies_version_guard on public.gp_v2_signature_retention_policies;
create trigger gp_v2_signature_retention_policies_version_guard before update on public.gp_v2_signature_retention_policies
for each row execute function public.gp_v2_guard_versioned_signature_configuration();

drop trigger if exists gp_v2_signature_consent_texts_version_guard on public.gp_v2_signature_consent_texts;
create trigger gp_v2_signature_consent_texts_version_guard before update on public.gp_v2_signature_consent_texts
for each row execute function public.gp_v2_guard_versioned_signature_configuration();

drop policy if exists gp_v2_signature_retention_policies_manager_read on public.gp_v2_signature_retention_policies;
create policy gp_v2_signature_retention_policies_team_read on public.gp_v2_signature_retention_policies
for select to authenticated
using (public.gp_v2_has_role(organization_id, array['owner', 'admin', 'manager', 'sales', 'operational']));

commit;
