// GP Mirari V02 SaaS administrative boundary. Deploy only after migration 002.
// This function is the only planned service-role path; no browser receives this key.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Access-Control-Allow-Origin": "https://gp.mirari.com.br", "Access-Control-Allow-Headers": "authorization, content-type", "Content-Type": "application/json" };
const respond = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: cors });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return respond(405, { error: "method_not_allowed" });
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  const identity = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user }, error: authError } = await identity.auth.getUser();
  if (authError || !user) return respond(401, { error: "unauthenticated" });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await request.json().catch(() => ({}));
  const action = String(body.action || "");
  const organizationId = String(body.organizationId || "");
  if (!organizationId) return respond(400, { error: "organization_required" });

  const { data: membership } = await admin.from("gp_v2_memberships").select("role,status").eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  const canManage = membership?.status === "active" && ["owner", "admin"].includes(membership.role);
  if (action === "bootstrap_owner") {
    const { data: organization } = await admin.from("gp_v2_organizations").select("created_by").eq("id", organizationId).maybeSingle();
    if (!organization || organization.created_by !== user.id) return respond(403, { error: "organization_creator_required" });
    const { count } = await admin.from("gp_v2_memberships").select("id", { count: "exact", head: true }).eq("organization_id", organizationId);
    if (count !== 0) return respond(409, { error: "organization_already_bootstrapped" });
    const { error } = await admin.from("gp_v2_memberships").insert({ organization_id: organizationId, user_id: user.id, role: "owner", status: "active", joined_at: new Date().toISOString(), invited_by: user.id });
    return error ? respond(400, { error: error.message }) : respond(200, { ok: true });
  }
  if (!canManage) return respond(403, { error: "admin_membership_required" });
  if (action === "upsert_membership") {
    const targetUserId = String(body.userId || ""); const role = String(body.role || "operational"); const status = String(body.status || "invited");
    if (!targetUserId || !["owner", "admin", "manager", "sales", "operational", "viewer"].includes(role) || !["invited", "active", "suspended"].includes(status)) return respond(400, { error: "invalid_membership" });
    if (role === "owner" && membership?.role !== "owner") return respond(403, { error: "owner_role_requires_owner" });
    const { error } = await admin.from("gp_v2_memberships").upsert({ organization_id: organizationId, user_id: targetUserId, role, status, invited_by: user.id, joined_at: status === "active" ? new Date().toISOString() : null }, { onConflict: "organization_id,user_id" });
    return error ? respond(400, { error: error.message }) : respond(200, { ok: true });
  }
  return respond(400, { error: "unsupported_action" });
});
