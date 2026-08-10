begin;
alter table public.gp_v2_signature_envelope_documents
  add column if not exists final_storage_path text not null default '',
  add column if not exists final_sha256 text not null default '',
  add column if not exists finalized_at timestamptz;
alter table public.gp_v2_signature_envelope_documents
  drop constraint if exists gp_v2_signature_envelope_documents_final_sha256_check;
alter table public.gp_v2_signature_envelope_documents
  add constraint gp_v2_signature_envelope_documents_final_sha256_check check (final_sha256 = '' or final_sha256 ~ '^[0-9a-f]{64}$');
commit;
