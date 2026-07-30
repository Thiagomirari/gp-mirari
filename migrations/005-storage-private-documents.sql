-- GP Mirari V02 SaaS - Etapa 8: buckets privados e paths por organizacao.
-- Esta migracao nao cria URLs publicas. Todas as leituras usam URL assinada.

begin;
insert into storage.buckets (id, name, public) values
  ('gp-v2-product-media', 'gp-v2-product-media', false),
  ('gp-v2-proposal-files', 'gp-v2-proposal-files', false)
on conflict (id) do update set public = false;

drop policy if exists gp_v2_product_media_member_read on storage.objects;
create policy gp_v2_product_media_member_read on storage.objects for select to authenticated using (
  bucket_id = 'gp-v2-product-media' and public.gp_v2_is_active_member(case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (storage.foldername(name))[1]::uuid else null end)
);
drop policy if exists gp_v2_product_media_admin_write on storage.objects;
create policy gp_v2_product_media_admin_write on storage.objects for all to authenticated using (
  bucket_id = 'gp-v2-product-media' and public.gp_v2_has_role(case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (storage.foldername(name))[1]::uuid else null end, array['owner', 'admin'])
) with check (
  bucket_id = 'gp-v2-product-media' and public.gp_v2_has_role(case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (storage.foldername(name))[1]::uuid else null end, array['owner', 'admin'])
);
drop policy if exists gp_v2_proposal_files_member_read on storage.objects;
create policy gp_v2_proposal_files_member_read on storage.objects for select to authenticated using (
  bucket_id = 'gp-v2-proposal-files' and public.gp_v2_is_active_member(case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (storage.foldername(name))[1]::uuid else null end)
);
drop policy if exists gp_v2_proposal_files_sales_write on storage.objects;
create policy gp_v2_proposal_files_sales_write on storage.objects for all to authenticated using (
  bucket_id = 'gp-v2-proposal-files' and public.gp_v2_has_role(case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (storage.foldername(name))[1]::uuid else null end, array['owner', 'admin', 'manager', 'sales'])
) with check (
  bucket_id = 'gp-v2-proposal-files' and public.gp_v2_has_role(case when (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (storage.foldername(name))[1]::uuid else null end, array['owner', 'admin', 'manager', 'sales'])
);
commit;
