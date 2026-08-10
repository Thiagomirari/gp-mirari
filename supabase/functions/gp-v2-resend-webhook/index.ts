// GP Mirari V02 - Resend delivery webhook. It stores only sanitized delivery evidence.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { Webhook } from "npm:svix@1.41.0";

const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers });
const encoder = new TextEncoder();
async function sha256(value: string) { const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value)); return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2, "0")).join(""); }
function deliveryStatus(value: string) { return ({ "email.delivered": "delivered", "email.delivery_delayed": "delayed", "email.bounced": "bounced", "email.complained": "complained", "email.failed": "failed" } as Record<string, string>)[value] || ""; }

Deno.serve(async (request) => {
  if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const url = Deno.env.get("SUPABASE_URL") || "", service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", secret = Deno.env.get("RESEND_WEBHOOK_SECRET") || "";
  if (!url || !service || !secret) return reply(503, { error: "webhook_not_configured" });
  const raw = await request.text(), id = request.headers.get("svix-id") || "", timestamp = request.headers.get("svix-timestamp") || "", signature = request.headers.get("svix-signature") || "";
  if (!id || !timestamp || !signature || raw.length > 1048576) return reply(401, { error: "webhook_signature_invalid" });
  let event: Record<string, any>;
  try { event = new Webhook(secret).verify(raw, { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature }) as Record<string, any>; } catch { return reply(401, { error: "webhook_signature_invalid" }); }
  const status = deliveryStatus(String(event.type || "")), messageId = String(event.data?.email_id || "");
  if (!status || !messageId) return reply(200, { ok: true, ignored: true });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const [payloadHash, messageHash] = await Promise.all([sha256(raw), sha256(messageId)]);
  const { data: prior } = await admin.from("gp_v2_signature_webhook_receipts").select("id").eq("provider", "resend").eq("provider_event_id", id).maybeSingle();
  if (prior) return reply(200, { ok: true, duplicate: true });
  const { data: delivery } = await admin.from("gp_v2_signature_email_deliveries").select("id,organization_id,envelope_id").eq("provider", "resend").eq("provider_message_id_hash", messageHash).maybeSingle();
  const { error: receiptError } = await admin.from("gp_v2_signature_webhook_receipts").insert({ organization_id: delivery?.organization_id || null, envelope_id: delivery?.envelope_id || null, provider: "resend", provider_event_id: id, payload_sha256: payloadHash, signature_valid: true, status: delivery ? "processed" : "ignored", processed_at: new Date().toISOString() });
  if (receiptError && !String(receiptError.code || "").includes("23505")) return reply(500, { error: "webhook_persist_failed" });
  if (!delivery) return reply(200, { ok: true, ignored: true });
  const eventAt = typeof event.created_at === "string" && !Number.isNaN(Date.parse(event.created_at)) ? event.created_at : new Date().toISOString();
  const reason = String(event.data?.bounce?.type || event.data?.failed_reason || event.data?.reason || "").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 100);
  const { error } = await admin.from("gp_v2_signature_email_deliveries").update({ delivery_status: status, failure_reason_code: reason, provider_event_at: eventAt, updated_at: new Date().toISOString() }).eq("id", delivery.id).eq("organization_id", delivery.organization_id);
  if (error) return reply(500, { error: "delivery_update_failed" });
  return reply(200, { ok: true });
});
