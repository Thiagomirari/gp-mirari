-- GP Mirari V02 - Remove anonymous/direct execution from legacy RLS helpers and trigger functions.
begin;

revoke execute on function public.gp_is_active_user() from anon;
revoke execute on function public.gp_is_admin() from anon;
revoke execute on function public.gp_v2_lock_sent_proposal_version() from public, anon, authenticated;

-- Authenticated execution remains available only for the two helpers that are
-- intentionally evaluated by legacy RLS policies.
grant execute on function public.gp_is_active_user() to authenticated;
grant execute on function public.gp_is_admin() to authenticated;

commit;
