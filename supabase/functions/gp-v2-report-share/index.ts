// GP Mirari V02 - Isolated public report sharing.
// Deploy with --no-verify-jwt: public reads use a capability token, while create,
// list and revoke validate the Supabase user JWT inside this function.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const encoder = new TextEncoder();
const allowedSections = new Set(["summary", "goals", "marketing", "channel-detail", "evolution", "commercial", "productivity", "future"]);
const shareRoles = new Set(["owner", "admin", "manager"]);
const allowedOrigins = new Set(["https://gp.mirari.com.br", "http://localhost", "http://127.0.0.1"]);

function responseHeaders(request: Request) {
  const origin = request.headers.get("origin") || "";
  const allowedOrigin = allowedOrigins.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ? origin : "https://gp.mirari.com.br";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "application/json; charset=utf-8",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
  };
}

const reply = (request: Request, status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: responseHeaders(request) });
const text = (value: unknown, max = 500) => String(value ?? "").trim().slice(0, max);
const isUuid = (value: unknown) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));

function readSecretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const secrets = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!secrets) return "";
  try {
    const parsed = JSON.parse(secrets);
    return String(parsed.default || parsed.service_role || Object.values(parsed)[0] || "");
  } catch {
    return "";
  }
}

function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeSections(value: unknown) {
  const sections = Array.isArray(value) ? value.map((item) => text(item, 40)).filter((item) => allowedSections.has(item)) : [];
  const unique = [...new Set(sections)];
  if (unique.includes("channel-detail") && !unique.includes("marketing")) unique.push("marketing");
  return unique;
}

function normalizeSnapshot(value: unknown, sections: string[], title: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_snapshot");
  const source = value as Record<string, unknown>;
  const allowedKeys = new Set(["version", "period", "filters"]);
  const sectionKeys: Record<string, string> = { summary: "summary", goals: "goals", marketing: "marketing", "channel-detail": "channelDetails", evolution: "evolution", commercial: "commercial", productivity: "productivity", future: "future" };
  for (const section of sections) allowedKeys.add(sectionKeys[section]);
  const snapshot: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) if (allowedKeys.has(key)) snapshot[key] = item;
  snapshot.version = 1;
  snapshot.title = title;
  snapshot.sections = sections;
  snapshot.generatedAt = new Date().toISOString();
  const serialized = JSON.stringify(snapshot);
  if (encoder.encode(serialized).byteLength > 300_000) throw new Error("snapshot_too_large");
  return snapshot;
}

function environment() {
  return {
    url: Deno.env.get("SUPABASE_URL") || "",
    publishableKey: Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "",
    secretKey: readSecretKey(),
    // Prefer a dedicated secret. Existing installations may safely reuse the
    // signature pepper because every report HMAC is domain-separated by "report|".
    tokenPepper: Deno.env.get("REPORT_SHARE_TOKEN_PEPPER") || Deno.env.get("SIGNATURE_TOKEN_PEPPER") || "",
    organizationId: Deno.env.get("GP_APP_ORGANIZATION_ID") || "",
    publicUrl: String(Deno.env.get("REPORT_SHARE_PUBLIC_URL") || "https://gp.mirari.com.br/relatorio.html").replace(/\/+$/, ""),
  };
}

async function authenticatedContext(request: Request, admin: ReturnType<typeof createClient>, env: ReturnType<typeof environment>) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!token) return null;
  const caller = createClient(env.url, env.publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await caller.auth.getUser();
  if (error || !data.user) return null;
  const { data: membership, error: membershipError } = await admin
    .from("gp_v2_memberships")
    .select("role,status")
    .eq("organization_id", env.organizationId)
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (membershipError || membership?.status !== "active" || !shareRoles.has(String(membership.role))) return null;
  return { user: data.user, role: String(membership.role) };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders(request) });
  if (request.method !== "POST") return reply(request, 405, { error: "method_not_allowed" });

  const env = environment();
  if (!env.url || !env.publishableKey || !env.secretKey || !isUuid(env.organizationId) || env.tokenPepper.length < 32) {
    console.error("report_share_configuration_missing");
    return reply(request, 503, { error: "report_share_unavailable" });
  }
  const admin = createClient(env.url, env.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = text(body.action, 40);

  if (action === "view") {
    const accessToken = text(body.accessToken, 220);
    if (accessToken.length < 40) return reply(request, 404, { error: "report_share_not_found" });
    const tokenHash = await hmacSha256(env.tokenPepper, `report|${accessToken}`);
    const { data: share, error } = await admin
      .from("gp_v2_report_shares")
      .select("id,title,snapshot,sections,status,expires_at,access_count,created_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (error) return reply(request, 503, { error: "report_share_unavailable" });
    if (!share || share.status !== "active") return reply(request, 404, { error: "report_share_not_found" });
    if (new Date(share.expires_at).getTime() <= Date.now()) {
      await admin.from("gp_v2_report_shares").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", share.id).eq("status", "active");
      return reply(request, 410, { error: "report_share_expired" });
    }
    const now = new Date().toISOString();
    await admin.from("gp_v2_report_shares").update({ access_count: Number(share.access_count || 0) + 1, last_accessed_at: now, updated_at: now }).eq("id", share.id).eq("status", "active");
    return reply(request, 200, { report: share.snapshot, title: share.title, sections: share.sections, expiresAt: share.expires_at, createdAt: share.created_at });
  }

  const context = await authenticatedContext(request, admin, env);
  if (!context) return reply(request, 403, { error: "report_share_permission_required" });

  if (action === "create") {
    const title = text(body.title || "Relatorio executivo", 120) || "Relatorio executivo";
    const sections = normalizeSections(body.sections);
    if (!sections.length) return reply(request, 400, { error: "report_share_sections_required" });
    const expiresInDays = Number(body.expiresInDays || 7);
    if (![1, 7, 30].includes(expiresInDays)) return reply(request, 400, { error: "report_share_invalid_expiry" });
    let snapshot: Record<string, unknown>;
    try {
      snapshot = normalizeSnapshot(body.snapshot, sections, title);
    } catch (error) {
      return reply(request, 400, { error: error instanceof Error ? error.message : "invalid_snapshot" });
    }
    const accessToken = randomToken();
    const tokenHash = await hmacSha256(env.tokenPepper, `report|${accessToken}`);
    const expiresAt = new Date(Date.now() + expiresInDays * 86400000).toISOString();
    const { data: share, error } = await admin.from("gp_v2_report_shares").insert({
      organization_id: env.organizationId,
      created_by: context.user.id,
      title,
      token_hash: tokenHash,
      token_fingerprint: tokenHash.slice(0, 12),
      snapshot,
      sections,
      expires_at: expiresAt,
    }).select("id,title,expires_at,created_at").single();
    if (error || !share) return reply(request, 500, { error: "report_share_create_failed" });
    return reply(request, 201, {
      share: { id: share.id, title: share.title, expiresAt: share.expires_at, createdAt: share.created_at },
      url: `${env.publicUrl}#t=${encodeURIComponent(accessToken)}`,
    });
  }

  if (action === "list") {
    const { data, error } = await admin.from("gp_v2_report_shares")
      .select("id,title,status,sections,expires_at,created_at,last_accessed_at,access_count,created_by")
      .eq("organization_id", env.organizationId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) return reply(request, 500, { error: "report_share_list_failed" });
    const shares = (data || []).filter((share) => context.role === "owner" || context.role === "admin" || share.created_by === context.user.id).map((share) => ({
      id: share.id, title: share.title, status: share.status, sections: share.sections,
      expiresAt: share.expires_at, createdAt: share.created_at, lastAccessedAt: share.last_accessed_at, accessCount: share.access_count,
    }));
    return reply(request, 200, { shares });
  }

  if (action === "revoke") {
    const shareId = text(body.shareId, 80);
    if (!isUuid(shareId)) return reply(request, 400, { error: "report_share_invalid_id" });
    const { data: share } = await admin.from("gp_v2_report_shares").select("id,created_by,status").eq("id", shareId).eq("organization_id", env.organizationId).maybeSingle();
    if (!share) return reply(request, 404, { error: "report_share_not_found" });
    if (!(["owner", "admin"].includes(context.role) || share.created_by === context.user.id)) return reply(request, 403, { error: "report_share_permission_required" });
    const now = new Date().toISOString();
    const { error } = await admin.from("gp_v2_report_shares").update({ status: "revoked", revoked_at: now, updated_at: now }).eq("id", shareId).eq("organization_id", env.organizationId);
    if (error) return reply(request, 500, { error: "report_share_revoke_failed" });
    return reply(request, 200, { ok: true });
  }

  return reply(request, 400, { error: "unsupported_action" });
});
