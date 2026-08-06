-- GP Mirari V02 SaaS - Etapa 2: identidade, memberships e RLS.
-- Execute somente depois de 001-v2-foundation.sql, em homologacao.
-- A migracao e aditiva/idempotente e nao concede acesso anonimo.

begin;

create or replace function public.gp_v2_is_active_member(target_organization_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.gp_v2_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
  );
$$;

create or replace function public.gp_v2_has_role(target_organization_id uuid, allowed_roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.gp_v2_memberships membership
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and membership.role = any(allowed_roles)
  );
$$;

revoke all on function public.gp_v2_is_active_member(uuid) from public;
revoke all on function public.gp_v2_has_role(uuid, text[]) from public;
grant execute on function public.gp_v2_is_active_member(uuid) to authenticated;
grant execute on function public.gp_v2_has_role(uuid, text[]) to authenticated;

-- Never touch grants from the legacy Version 01 tables. Only V2 tables are denied
-- explicitly; RLS below remains the authorization boundary for authenticated users.
do $$
declare
  table_name text;
  tables text[] := array[
    'gp_v2_organizations', 'gp_v2_memberships', 'gp_v2_product_categories',
    'gp_v2_products', 'gp_v2_product_versions', 'gp_v2_price_books',
    'gp_v2_product_prices', 'gp_v2_product_costs', 'gp_v2_product_images',
    'gp_v2_proposals', 'gp_v2_proposal_versions', 'gp_v2_proposal_items',
    'gp_v2_proposal_item_costs', 'gp_v2_proposal_installments',
    'gp_v2_proposal_approvals', 'gp_v2_proposal_events', 'gp_v2_proposal_files'
  ];
begin
  foreach table_name in array tables loop
    execute format('revoke all on table public.%I from anon', table_name);
  end loop;
end;
$$;

do $$
declare
  table_name text;
  tables text[] := array[
    'gp_v2_product_categories', 'gp_v2_products', 'gp_v2_product_versions',
    'gp_v2_price_books', 'gp_v2_product_prices', 'gp_v2_product_images'
  ];
begin
  foreach table_name in array tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('drop policy if exists gp_v2_%I_read_member on public.%I', table_name, table_name);
    execute format('create policy gp_v2_%I_read_member on public.%I for select to authenticated using (public.gp_v2_is_active_member(organization_id))', table_name, table_name);
    execute format('drop policy if exists gp_v2_%I_write_manager on public.%I', table_name, table_name);
    execute format('create policy gp_v2_%I_write_manager on public.%I for all to authenticated using (public.gp_v2_has_role(organization_id, array[''owner'', ''admin'', ''manager''])) with check (public.gp_v2_has_role(organization_id, array[''owner'', ''admin'', ''manager'']))', table_name, table_name);
  end loop;
end;
$$;

do $$
declare
  table_name text;
  tables text[] := array['gp_v2_proposals', 'gp_v2_proposal_versions', 'gp_v2_proposal_items', 'gp_v2_proposal_installments', 'gp_v2_proposal_events', 'gp_v2_proposal_files'];
begin
  foreach table_name in array tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('drop policy if exists gp_v2_%I_read_member on public.%I', table_name, table_name);
    execute format('create policy gp_v2_%I_read_member on public.%I for select to authenticated using (public.gp_v2_is_active_member(organization_id))', table_name, table_name);
    execute format('drop policy if exists gp_v2_%I_write_sales on public.%I', table_name, table_name);
    execute format('create policy gp_v2_%I_write_sales on public.%I for all to authenticated using (public.gp_v2_has_role(organization_id, array[''owner'', ''admin'', ''manager'', ''sales''])) with check (public.gp_v2_has_role(organization_id, array[''owner'', ''admin'', ''manager'', ''sales'']))', table_name, table_name);
  end loop;
end;
$$;

alter table public.gp_v2_proposal_approvals enable row level security;
grant select, insert, update on public.gp_v2_proposal_approvals to authenticated;
drop policy if exists gp_v2_proposal_approvals_member_read on public.gp_v2_proposal_approvals;
create policy gp_v2_proposal_approvals_member_read on public.gp_v2_proposal_approvals for select to authenticated using (public.gp_v2_is_active_member(organization_id));
drop policy if exists gp_v2_proposal_approvals_sales_request on public.gp_v2_proposal_approvals;
create policy gp_v2_proposal_approvals_sales_request on public.gp_v2_proposal_approvals for insert to authenticated with check (requested_by = auth.uid() and status = 'pending' and public.gp_v2_has_role(organization_id, array['owner', 'admin', 'manager', 'sales']));
drop policy if exists gp_v2_proposal_approvals_admin_decision on public.gp_v2_proposal_approvals;
create policy gp_v2_proposal_approvals_admin_decision on public.gp_v2_proposal_approvals for update to authenticated using (public.gp_v2_has_role(organization_id, array['owner', 'admin'])) with check (public.gp_v2_has_role(organization_id, array['owner', 'admin']));

-- Internal costs never inherit sales access.
do $$
declare
  table_name text;
  tables text[] := array['gp_v2_product_costs', 'gp_v2_proposal_item_costs'];
begin
  foreach table_name in array tables loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('grant select, insert, update, delete on public.%I to authenticated', table_name);
    execute format('drop policy if exists gp_v2_%I_admin_only on public.%I', table_name, table_name);
    execute format('create policy gp_v2_%I_admin_only on public.%I for all to authenticated using (public.gp_v2_has_role(organization_id, array[''owner'', ''admin''])) with check (public.gp_v2_has_role(organization_id, array[''owner'', ''admin'']))', table_name, table_name);
  end loop;
end;
$$;

alter table public.gp_v2_organizations enable row level security;
alter table public.gp_v2_memberships enable row level security;
grant select, update on public.gp_v2_organizations to authenticated;
grant select, update on public.gp_v2_memberships to authenticated;
drop policy if exists gp_v2_organizations_member_read on public.gp_v2_organizations;
create policy gp_v2_organizations_member_read on public.gp_v2_organizations for select to authenticated using (public.gp_v2_is_active_member(id));
drop policy if exists gp_v2_organizations_owner_write on public.gp_v2_organizations;
create policy gp_v2_organizations_owner_write on public.gp_v2_organizations for update to authenticated using (public.gp_v2_has_role(id, array['owner', 'admin'])) with check (public.gp_v2_has_role(id, array['owner', 'admin']));
drop policy if exists gp_v2_memberships_self_or_admin_read on public.gp_v2_memberships;
create policy gp_v2_memberships_self_or_admin_read on public.gp_v2_memberships for select to authenticated using (user_id = auth.uid() or public.gp_v2_has_role(organization_id, array['owner', 'admin']));
drop policy if exists gp_v2_memberships_owner_admin_write on public.gp_v2_memberships;
create policy gp_v2_memberships_owner_admin_write on public.gp_v2_memberships for update to authenticated using (public.gp_v2_has_role(organization_id, array['owner', 'admin'])) with check (public.gp_v2_has_role(organization_id, array['owner', 'admin']));

commit;
