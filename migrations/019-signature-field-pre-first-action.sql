-- Allow visual field placement until the first signer action, while preserving immutable evidence thereafter.
begin;

create or replace function public.gp_v2_guard_signature_field_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_organization_id uuid := coalesce(new.organization_id, old.organization_id);
  v_envelope_id uuid := coalesce(new.envelope_id, old.envelope_id);
  v_status text;
begin
  select status into v_status
  from public.gp_v2_signature_envelopes
  where id = v_envelope_id and organization_id = v_organization_id
  for update;
  if not found then raise exception 'signature envelope not found'; end if;
  if v_status not in ('preparing', 'awaiting_send', 'awaiting_signature', 'partially_signed', 'failed') then
    raise exception 'signature fields are immutable after completion';
  end if;
  if exists (
    select 1 from public.gp_v2_signature_actions a
    where a.organization_id = v_organization_id and a.envelope_id = v_envelope_id
  ) then
    raise exception 'signature fields are immutable after the first signature action';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public.gp_v2_guard_signature_field_mutation() from public, anon, authenticated;

commit;
