-- GP Mirari V02 SaaS - Etapas 6, 7 e 9: workflow, auditoria e vinculo textual com o projeto legado.

begin;
create table if not exists public.gp_v2_audit_events (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.gp_v2_organizations(id) on delete restrict,
  entity_type text not null, entity_id uuid, action text not null, actor_id uuid, request_id text not null default '', before_data jsonb, after_data jsonb,
  created_at timestamptz not null default now(), check (length(trim(entity_type)) > 0), check (length(trim(action)) > 0)
);
create unique index if not exists gp_v2_audit_org_request_action_idx on public.gp_v2_audit_events(organization_id, request_id, action) where request_id <> '';
create index if not exists gp_v2_audit_org_entity_date_idx on public.gp_v2_audit_events(organization_id, entity_type, entity_id, created_at desc);
alter table public.gp_v2_audit_events enable row level security;
grant select, insert on public.gp_v2_audit_events to authenticated;
drop policy if exists gp_v2_audit_admin_read on public.gp_v2_audit_events;
create policy gp_v2_audit_admin_read on public.gp_v2_audit_events for select to authenticated using (public.gp_v2_has_role(organization_id, array['owner', 'admin']));
drop policy if exists gp_v2_audit_member_insert on public.gp_v2_audit_events;
create policy gp_v2_audit_member_insert on public.gp_v2_audit_events for insert to authenticated with check (public.gp_v2_is_active_member(organization_id) and actor_id = auth.uid());

create or replace function public.gp_v2_lock_sent_proposal_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('sent', 'accepted', 'rejected', 'expired', 'cancelled', 'superseded') then new.is_locked := true; end if;
  if tg_op = 'UPDATE' and old.is_locked and row(new.*) is distinct from row(old.*) then raise exception 'proposal version is immutable after lock'; end if;
  return new;
end; $$;
drop trigger if exists gp_v2_proposal_versions_lock_sent on public.gp_v2_proposal_versions;
create trigger gp_v2_proposal_versions_lock_sent before update on public.gp_v2_proposal_versions for each row execute function public.gp_v2_lock_sent_proposal_version();

-- Project references intentionally remain textual until the project JSON migration is approved.
create index if not exists gp_v2_proposals_org_opportunity_ref_idx on public.gp_v2_proposals(organization_id, opportunity_ref);
create index if not exists gp_v2_proposals_org_project_ref_idx on public.gp_v2_proposals(organization_id, project_ref);
commit;
