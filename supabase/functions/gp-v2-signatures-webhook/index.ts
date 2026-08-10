// GP Mirari V02 - Autentique webhook receiver.
// JWT verification must be disabled for this provider callback; HMAC validation is mandatory.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const jsonHeaders = { "Content-Type": "application/json" };
const encoder = new TextEncoder();
const terminalStatuses = new Set(["signed", "declined", "expired", "cancelled"]);

type AdminClient = ReturnType<typeof createClient>;
type JsonRecord = Record<string, unknown>;

const reply = (status: number, body: JsonRecord) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });

async function sha256(value: Uint8Array | string) {
  const input = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hexBytes(value: string) {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  return bytes;
}

async function verifyHmac(rawBody: Uint8Array, providedSignature: string, secret: string) {
  const signature = hexBytes(providedSignature);
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  return crypto.subtle.verify("HMAC", key, signature, rawBody);
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function providerDocumentId(eventType: string, data: JsonRecord) {
  const object = record(data.object);
  if (eventType.startsWith("document.")) return String(data.id || object.id || "");
  return String(data.document || object.document || record(data.data).document || "");
}

function occurredAt(event: JsonRecord) {
  const value = String(event.created_at || record(event.data).created_at || "");
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : new Date(value).toISOString();
}

async function safeEnvelopeStatus(admin: AdminClient, organizationId: string, envelopeId: string, documentId: string, status: string) {
  const { data: current } = await admin.from("gp_v2_signature_envelopes").select("status").eq("id", envelopeId).eq("organization_id", organizationId).maybeSingle();
  if (!current || terminalStatuses.has(String(current.status))) return;
  const now = new Date().toISOString();
  const terminal = terminalStatuses.has(status);
  await admin.from("gp_v2_signature_envelopes").update({
    status,
    updated_at: now,
    ...(status === "signed" ? { completed_at: now } : {}),
  }).eq("id", envelopeId).eq("organization_id", organizationId);
  await admin.from("gp_v2_documents").update({ status, updated_at: now })
    .eq("id", documentId).eq("organization_id", organizationId);
  if (terminal) {
    await admin.from("gp_v2_signature_jobs").upsert({
      organization_id: organizationId,
      job_type: "download_artifacts",
      deduplication_key: `download_artifacts:${envelopeId}`,
      status: "pending",
      payload: { envelopeId },
      available_at: now,
    }, { onConflict: "organization_id,deduplication_key", ignoreDuplicates: true });
  }
}

async function fetchAutentiqueDocument(token: string, documentId: string) {
  if (!token) return null;
  const response = await fetch("https://api.autentique.com.br/v2/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: "query GetDocument($id: ID!) { document(id: $id) { id qualified created_at files { original signed pades } signatures { public_id viewed { created_at } signed { created_at } rejected { created_at } } } }",
      variables: { id: documentId },
    }),
  });
  const body = await response.json().catch(() => ({}));
  return response.ok ? body?.data?.document || null : null;
}

function allowedProviderFileUrl(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return url.hostname === "storage.googleapis.com" || url.hostname === "autentique.com.br" || url.hostname.endsWith(".autentique.com.br");
  } catch {
    return false;
  }
}

async function persistRemoteArtifact(admin: AdminClient, organizationId: string, envelopeId: string, kind: "signed_pdf" | "pades", remoteUrl: string) {
  if (!allowedProviderFileUrl(remoteUrl)) throw new Error("provider_artifact_url_rejected");
  const { data: existing } = await admin.from("gp_v2_signature_artifacts").select("id").eq("organization_id", organizationId).eq("envelope_id", envelopeId).eq("artifact_kind", kind).maybeSingle();
  if (existing) return;
  const response = await fetch(remoteUrl, { redirect: "follow" });
  if (!response.ok) throw new Error("provider_artifact_download_failed");
  const length = Number(response.headers.get("content-length") || 0);
  if (length > 50 * 1024 * 1024) throw new Error("provider_artifact_too_large");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 50 * 1024 * 1024) throw new Error("provider_artifact_size_invalid");
  const fileHash = await sha256(bytes);
  const providerUrlHash = await sha256(remoteUrl);
  const suffix = kind === "pades" ? "pades.pdf" : "assinado.pdf";
  const storagePath = `${organizationId}/envelopes/${envelopeId}/signed/${crypto.randomUUID()}-${suffix}`;
  const { error: uploadError } = await admin.storage.from("gp-v2-signature-files").upload(storagePath, bytes, { contentType: "application/pdf", upsert: false });
  if (uploadError) throw new Error("provider_artifact_store_failed");
  const { error: artifactError } = await admin.from("gp_v2_signature_artifacts").insert({
    organization_id: organizationId,
    envelope_id: envelopeId,
    artifact_kind: kind,
    storage_path: storagePath,
    content_type: "application/pdf",
    size_bytes: bytes.length,
    sha256: fileHash,
    provider_url_hash: providerUrlHash,
  });
  if (artifactError) {
    await admin.storage.from("gp-v2-signature-files").remove([storagePath]);
    if (!String(artifactError.message).toLowerCase().includes("duplicate")) throw new Error("provider_artifact_record_failed");
  }
}

async function processWebhook(admin: AdminClient, rawBody: Uint8Array, payload: JsonRecord, payloadHash: string) {
  const event = record(payload.event);
  const eventType = String(event.type || "");
  const eventId = String(event.id || "");
  const data = record(event.data);
  const documentId = providerDocumentId(eventType, data);
  if (!eventId || !eventType || !documentId) return;

  const { data: envelope } = await admin.from("gp_v2_signature_envelopes")
    .select("id,organization_id,document_id,status")
    .eq("provider", "autentique")
    .eq("provider_envelope_id", documentId)
    .maybeSingle();
  if (!envelope) return;

  const { data: receipt, error: receiptError } = await admin.from("gp_v2_signature_webhook_receipts").insert({
    organization_id: envelope.organization_id,
    envelope_id: envelope.id,
    provider: "autentique",
    provider_event_id: eventId,
    payload_sha256: payloadHash,
    signature_valid: true,
    status: "processing",
    attempt_count: 1,
  }).select("id").maybeSingle();
  if (receiptError) {
    if (String(receiptError.message).toLowerCase().includes("duplicate")) return;
    throw receiptError;
  }

  try {
    const object = record(data.object);
    const signerPublicId = String(data.public_id || object.public_id || "");
    let signerId: string | null = null;
    if (signerPublicId) {
      const { data: signer } = await admin.from("gp_v2_signature_signers")
        .select("id")
        .eq("organization_id", envelope.organization_id)
        .eq("envelope_id", envelope.id)
        .eq("provider_signer_id", signerPublicId)
        .maybeSingle();
      signerId = signer?.id || null;
    }

    const time = occurredAt(event);
    const signerUpdates: JsonRecord = { updated_at: new Date().toISOString() };
    if (eventType === "signature.viewed") Object.assign(signerUpdates, { status: "viewed", viewed_at: time });
    if (eventType === "signature.accepted") Object.assign(signerUpdates, { status: "signed", signed_at: time });
    if (eventType === "signature.rejected") Object.assign(signerUpdates, { status: "declined", declined_at: time });
    if (eventType === "signature.delivery_failed") Object.assign(signerUpdates, { status: "delivery_failed" });
    if (signerId && Object.keys(signerUpdates).length > 1) {
      await admin.from("gp_v2_signature_signers").update(signerUpdates).eq("id", signerId).eq("organization_id", envelope.organization_id);
    }

    const eventMetadata = {
      providerDocumentId: documentId,
      providerSignerId: signerPublicId || null,
      eventCategory: eventType.split(".")[0],
    };
    await admin.from("gp_v2_signature_events").insert({
      organization_id: envelope.organization_id,
      envelope_id: envelope.id,
      signer_id: signerId,
      provider_event_id: eventId,
      event_type: eventType,
      actor_type: eventType.startsWith("signature.") ? "signer" : "provider",
      payload_sha256: payloadHash,
      occurred_at: time,
      metadata: eventMetadata,
    });

    if (eventType === "signature.accepted") await safeEnvelopeStatus(admin, envelope.organization_id, envelope.id, envelope.document_id, "partially_signed");
    if (eventType === "signature.rejected") await safeEnvelopeStatus(admin, envelope.organization_id, envelope.id, envelope.document_id, "declined");
    if (eventType === "document.finished") {
      await safeEnvelopeStatus(admin, envelope.organization_id, envelope.id, envelope.document_id, "signed");
      const objectFiles = record(record(data.object).files);
      let signedUrl = String(objectFiles.signed || "");
      let padesUrl = String(objectFiles.pades || "");
      if (!signedUrl) {
        const providerDocument = await fetchAutentiqueDocument(Deno.env.get("AUTENTIQUE_API_TOKEN") || "", documentId);
        signedUrl = String(providerDocument?.files?.signed || "");
        padesUrl = String(providerDocument?.files?.pades || "");
      }
      if (signedUrl) await persistRemoteArtifact(admin, envelope.organization_id, envelope.id, "signed_pdf", signedUrl);
      if (padesUrl && padesUrl !== signedUrl) await persistRemoteArtifact(admin, envelope.organization_id, envelope.id, "pades", padesUrl);
    }

    await admin.from("gp_v2_signature_webhook_receipts").update({ status: "processed", processed_at: new Date().toISOString() }).eq("id", receipt?.id);
  } catch (error) {
    const code = String(error instanceof Error ? error.message : "webhook_processing_failed").toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 120);
    await admin.from("gp_v2_signature_webhook_receipts").update({ status: "failed", processed_at: new Date().toISOString(), last_error_code: code }).eq("id", receipt?.id);
    throw error;
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const secret = Deno.env.get("AUTENTIQUE_WEBHOOK_SECRET") || "";
  const signature = request.headers.get("x-autentique-signature") || "";
  const rawBody = new Uint8Array(await request.arrayBuffer());
  if (!secret || !await verifyHmac(rawBody, signature, secret)) return reply(401, { error: "webhook_signature_invalid" });

  let payload: JsonRecord;
  try {
    payload = JSON.parse(new TextDecoder().decode(rawBody)) as JsonRecord;
  } catch {
    return reply(400, { error: "webhook_payload_invalid" });
  }
  const payloadHash = await sha256(rawBody);
  const url = Deno.env.get("SUPABASE_URL") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !service) return reply(500, { error: "supabase_environment_missing" });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  // Autentique recommends a fast 2xx response and asynchronous, idempotent processing.
  EdgeRuntime.waitUntil(processWebhook(admin, rawBody, payload, payloadHash));
  return reply(202, { ok: true });
});
