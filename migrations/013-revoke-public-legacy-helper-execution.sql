-- GP Mirari V02 - PostgreSQL grants EXECUTE to PUBLIC by default. Remove this
-- inherited path from legacy session helpers while preserving their use in RLS.
begin;

revoke execute on function public.gp_is_active_user() from public;
revoke execute on function public.gp_is_admin() from public;
revoke execute on function public.gp_v2_is_active_member(uuid) from public;
revoke execute on function public.gp_v2_has_role(uuid, text[]) from public;

grant execute on function public.gp_is_active_user() to authenticated;
grant execute on function public.gp_is_admin() to authenticated;
grant execute on function public.gp_v2_is_active_member(uuid) to authenticated;
grant execute on function public.gp_v2_has_role(uuid, text[]) to authenticated;

commit;
