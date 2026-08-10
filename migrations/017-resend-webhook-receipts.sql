begin;
alter table public.gp_v2_signature_webhook_receipts drop constraint if exists gp_v2_signature_webhook_receipts_provider_check;
alter table public.gp_v2_signature_webhook_receipts add constraint gp_v2_signature_webhook_receipts_provider_check check (provider in ('autentique', 'clicksign', 'resend', 'other'));
commit;
