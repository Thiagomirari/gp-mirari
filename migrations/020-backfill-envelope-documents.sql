-- Backfill the primary version into envelopes created before multi-document insertion was added.
begin;

alter table public.gp_v2_signature_envelope_documents disable trigger gp_v2_signature_envelope_documents_guard;
alter table public.gp_v2_signature_envelope_documents disable trigger gp_v2_signature_envelope_documents_manifest;

insert into public.gp_v2_signature_envelope_documents (
  organization_id, envelope_id, document_id, document_version_id, display_order, required, created_by
)
select e.organization_id, e.id, e.document_id, e.document_version_id, 1, true, e.created_by
from public.gp_v2_signature_envelopes e
where not exists (
  select 1 from public.gp_v2_signature_envelope_documents ed
  where ed.organization_id = e.organization_id and ed.envelope_id = e.id
);

alter table public.gp_v2_signature_envelope_documents enable trigger gp_v2_signature_envelope_documents_guard;
alter table public.gp_v2_signature_envelope_documents enable trigger gp_v2_signature_envelope_documents_manifest;

do $$ declare r record; begin
  for r in select distinct organization_id, envelope_id from public.gp_v2_signature_envelope_documents loop
    perform public.gp_v2_refresh_signature_envelope_manifest(r.organization_id, r.envelope_id);
  end loop;
end; $$;

commit;
