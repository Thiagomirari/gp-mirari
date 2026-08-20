-- GP Mirari V02 - Least-privilege hotfix for report sharing.
-- Supabase default privileges may grant service_role more operations on new
-- public tables than this Edge Function requires.

begin;

revoke all on table public.gp_v2_report_shares from service_role;
grant select, insert, update on table public.gp_v2_report_shares to service_role;

commit;
