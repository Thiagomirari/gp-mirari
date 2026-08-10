-- Hotfix: avoid PostgreSQL's CURRENT_TIME keyword collision in PL/pgSQL variables.
-- This migration is forward-only and preserves all existing rate-limit and OTP evidence.

create or replace function public.gp_v2_consume_signature_rate_limit(
  p_key_hash text,
  p_action text,
  p_window_seconds integer,
  p_max_requests integer,
  p_block_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  rate_row public.gp_v2_signature_rate_limits%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_key_hash !~ '^[a-f0-9]{64}$' or coalesce(length(p_action), 0) not between 1 and 120 then
    raise exception 'invalid rate limit key or action' using errcode = '22023';
  end if;
  if p_window_seconds <= 0 or p_max_requests <= 0 or p_block_seconds <= 0 then
    raise exception 'rate limit parameters must be positive' using errcode = '22023';
  end if;

  insert into public.gp_v2_signature_rate_limits (key_hash, action, request_count)
  values (p_key_hash, p_action, 0)
  on conflict (key_hash, action) do nothing;

  select * into rate_row
  from public.gp_v2_signature_rate_limits
  where key_hash = p_key_hash and action = p_action
  for update;

  if rate_row.blocked_until is not null and rate_row.blocked_until > v_now then
    return query select false, greatest(1, ceil(extract(epoch from rate_row.blocked_until - v_now))::integer);
    return;
  end if;

  if rate_row.window_started_at + make_interval(secs => p_window_seconds) <= v_now then
    update public.gp_v2_signature_rate_limits
    set window_started_at = v_now, request_count = 1, blocked_until = null, updated_at = v_now
    where id = rate_row.id;
    return query select true, 0;
    return;
  end if;

  if rate_row.request_count + 1 > p_max_requests then
    update public.gp_v2_signature_rate_limits
    set request_count = request_count + 1,
        blocked_until = v_now + make_interval(secs => p_block_seconds),
        updated_at = v_now
    where id = rate_row.id;
    return query select false, p_block_seconds;
    return;
  end if;

  update public.gp_v2_signature_rate_limits
  set request_count = request_count + 1, updated_at = v_now
  where id = rate_row.id;
  return query select true, 0;
end;
$$;

create or replace function public.gp_v2_verify_signature_otp(
  p_challenge_id uuid,
  p_code_hash text,
  p_locked_until timestamptz
)
returns table (verification_result text, signer_id uuid, envelope_id uuid, organization_id uuid)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  challenge_row public.gp_v2_signature_otp_challenges%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select * into challenge_row
  from public.gp_v2_signature_otp_challenges
  where id = p_challenge_id
  for update;

  if not found then
    return query select 'invalid'::text, null::uuid, null::uuid, null::uuid;
    return;
  end if;
  if challenge_row.status <> 'pending' then
    return query select challenge_row.status, challenge_row.signer_id, challenge_row.envelope_id, challenge_row.organization_id;
    return;
  end if;
  if challenge_row.expires_at <= v_now then
    update public.gp_v2_signature_otp_challenges set status = 'expired' where id = challenge_row.id;
    return query select 'expired'::text, challenge_row.signer_id, challenge_row.envelope_id, challenge_row.organization_id;
    return;
  end if;
  if challenge_row.code_hash = p_code_hash then
    update public.gp_v2_signature_otp_challenges
    set status = 'verified', verified_at = v_now
    where id = challenge_row.id;
    return query select 'verified'::text, challenge_row.signer_id, challenge_row.envelope_id, challenge_row.organization_id;
    return;
  end if;

  if challenge_row.attempt_count + 1 >= challenge_row.max_attempts then
    update public.gp_v2_signature_otp_challenges
    set status = 'locked', attempt_count = attempt_count + 1, locked_until = p_locked_until
    where id = challenge_row.id;
    return query select 'locked'::text, challenge_row.signer_id, challenge_row.envelope_id, challenge_row.organization_id;
  end if;

  update public.gp_v2_signature_otp_challenges
  set attempt_count = attempt_count + 1
  where id = challenge_row.id;
  return query select 'rejected'::text, challenge_row.signer_id, challenge_row.envelope_id, challenge_row.organization_id;
end;
$$;

revoke all on function public.gp_v2_consume_signature_rate_limit(text, text, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.gp_v2_verify_signature_otp(uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.gp_v2_consume_signature_rate_limit(text, text, integer, integer, integer) to service_role;
grant execute on function public.gp_v2_verify_signature_otp(uuid, text, timestamptz) to service_role;
