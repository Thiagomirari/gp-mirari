-- GP Mirari V02 - Covering indexes for signature foreign keys.
-- Generated after the Supabase performance advisor review.

begin;

create index if not exists gp_v2_document_links_document_org_fk_idx
  on public.gp_v2_document_links(document_id, organization_id);
create index if not exists gp_v2_document_versions_document_org_fk_idx
  on public.gp_v2_document_versions(document_id, organization_id);
create index if not exists gp_v2_documents_current_version_org_fk_idx
  on public.gp_v2_documents(current_version_id, organization_id)
  where current_version_id is not null;
create index if not exists gp_v2_documents_template_org_fk_idx
  on public.gp_v2_documents(template_id, organization_id)
  where template_id is not null;
create index if not exists gp_v2_signature_artifacts_envelope_org_fk_idx
  on public.gp_v2_signature_artifacts(envelope_id, organization_id);
create index if not exists gp_v2_signature_rules_template_org_fk_idx
  on public.gp_v2_signature_automation_rules(template_id, organization_id)
  where template_id is not null;
create index if not exists gp_v2_signature_rules_org_idx
  on public.gp_v2_signature_automation_rules(organization_id);
create index if not exists gp_v2_signature_envelopes_document_org_fk_idx
  on public.gp_v2_signature_envelopes(document_id, organization_id);
create index if not exists gp_v2_signature_envelopes_version_org_fk_idx
  on public.gp_v2_signature_envelopes(document_version_id, organization_id);
create index if not exists gp_v2_signature_events_envelope_org_fk_idx
  on public.gp_v2_signature_events(envelope_id, organization_id);
create index if not exists gp_v2_signature_events_signer_org_fk_idx
  on public.gp_v2_signature_events(signer_id, organization_id)
  where signer_id is not null;
create index if not exists gp_v2_signature_signers_envelope_org_fk_idx
  on public.gp_v2_signature_signers(envelope_id, organization_id);
create index if not exists gp_v2_signature_webhooks_envelope_org_fk_idx
  on public.gp_v2_signature_webhook_receipts(envelope_id, organization_id)
  where envelope_id is not null;
create index if not exists gp_v2_signature_webhooks_org_idx
  on public.gp_v2_signature_webhook_receipts(organization_id)
  where organization_id is not null;

commit;
