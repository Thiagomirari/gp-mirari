-- GP Mirari V02 - The same immutable original may be referenced by a retried envelope.
begin;

alter table public.gp_v2_signature_artifacts
  drop constraint if exists gp_v2_signature_artifacts_organization_id_storage_path_key;

create index if not exists gp_v2_signature_artifacts_storage_path_idx
  on public.gp_v2_signature_artifacts(organization_id, storage_path);

commit;
