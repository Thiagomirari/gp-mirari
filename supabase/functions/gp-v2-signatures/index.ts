// GP Mirari V02 - Document intake and signature orchestration.
// Provider credentials stay in Edge Function secrets and are never returned to the browser.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "https://gp.mirari.com.br",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, idempotency-key, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const reply = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: cors });
const encoder = new TextEncoder();
const allowedRoles = ["owner", "admin", "manager", "sales"];
const readableRoles = [...allowedRoles, "operational"];
const allowedKinds = new Set(["contract", "proposal", "addendum", "executive_project", "acceptance_term", "other"]);
const allowedSources = new Set(["manual", "crm_won", "proposal", "project_stage", "addendum", "api"]);
const allowedSignatureLevels = new Set(["advanced", "qualified_icp_brasil"]);
const allowedEntityTypes = new Set(["client", "crm_opportunity", "proposal", "project", "project_stage", "contract", "other"]);
const allowedMimeTypes = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.oasis.opendocument.text",
  "text/plain",
]);
const maxFileSize = 20 * 1024 * 1024;
const legalBases = new Set(["contract_execution", "pre_contract", "legal_obligation", "regular_exercise_rights", "legitimate_interest", "consent", "other"]);
const internalSignerRoles = new Set(["contracting_party", "contracted_party", "legal_representative", "witness", "guarantor", "avalist", "approver", "company", "client", "signer"]);

type AdminClient = ReturnType<typeof createClient>;
type Actor = { id: string; role: string };
type SignerInput = {
  name?: string;
  email?: string;
  phone?: string;
  cpf?: string;
  role?: string;
};
type InternalSignerInput = SignerInput & {
  signerType?: string;
  companyLegalName?: string;
  companyDocument?: string;
  jobTitle?: string;
  representationDeclared?: boolean;
};

function safeFileName(value: string) {
  const cleaned = String(value || "documento.pdf")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return cleaned || "documento.pdf";
}

function normalizeDigits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

async function sha256(value: ArrayBuffer | Uint8Array | string) {
  const input = typeof value === "string" ? encoder.encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

function escapeHtml(value: unknown) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
}

function requestIp(request: Request) {
  const value = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "";
  const ip = value.trim().slice(0, 64);
  return /^[0-9a-f:.]+$/i.test(ip) ? ip : "";
}

function userAgentDetails(value: string) {
  const userAgent = String(value || "").slice(0, 1000);
  const browser = /Edg\//.test(userAgent) ? "Microsoft Edge" : /Chrome\//.test(userAgent) ? "Google Chrome" : /Firefox\//.test(userAgent) ? "Mozilla Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Outro";
  const operatingSystem = /Windows NT/.test(userAgent) ? "Windows" : /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS/iPadOS" : /Mac OS X/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : "Outro";
  return { userAgent, browser, operatingSystem };
}

function safeTimezone(value: unknown) {
  const timezone = String(value || "America/Sao_Paulo").slice(0, 80);
  try { new Intl.DateTimeFormat("pt-BR", { timeZone: timezone }).format(new Date()); return timezone; } catch { return "America/Sao_Paulo"; }
}

function localDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, dateStyle: "short", timeStyle: "medium", hour12: false }).format(new Date(value));
}

async function appendEvidenceEvent(admin: AdminClient, input: {
  organizationId: string;
  envelopeId: string;
  signerId?: string | null;
  eventType: string;
  actorType: "user" | "signer" | "provider" | "system";
  occurredAt?: string;
  timezone?: string;
  ip?: string;
  userAgent?: string;
  tokenFingerprint?: string;
  result?: string;
  documentHash?: string;
  authChannel?: string;
  metadata?: Record<string, unknown>;
  providerEventId?: string;
}) {
  const occurredAt = input.occurredAt || new Date().toISOString();
  const timezone = safeTimezone(input.timezone);
  const agent = userAgentDetails(input.userAgent || "");
  const ipHash = input.ip ? await sha256(`${input.organizationId}|${input.ip}|${Deno.env.get("SIGNATURE_DATA_PEPPER") || ""}`) : "";
  const payloadHash = await sha256(JSON.stringify({ eventType: input.eventType, occurredAt, result: input.result || "success", metadata: input.metadata || {} }));
  const { error } = await admin.rpc("gp_v2_append_signature_event", {
    p_organization_id: input.organizationId,
    p_envelope_id: input.envelopeId,
    p_signer_id: input.signerId || null,
    p_provider_event_id: input.providerEventId || "",
    p_event_type: input.eventType,
    p_actor_type: input.actorType,
    p_payload_sha256: payloadHash,
    p_occurred_at: occurredAt,
    p_local_occurred_at: localDateTime(occurredAt, timezone),
    p_presented_timezone: timezone,
    p_ip_address: input.ip || null,
    p_ip_hash: ipHash,
    p_user_agent: agent.userAgent,
    p_browser: agent.browser,
    p_operating_system: agent.operatingSystem,
    p_token_fingerprint: input.tokenFingerprint || "",
    p_result: input.result || "success",
    p_document_sha256: input.documentHash || "",
    p_auth_channel: input.authChannel || "",
    p_metadata: input.metadata || {},
  });
  if (error) throw error;
}

async function sendEmail(to: string, subject: string, html: string, idempotencyKey: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY") || "";
  const from = Deno.env.get("SIGNATURE_FROM_EMAIL") || "";
  if (!apiKey || !from) throw new Error("signature_email_not_configured");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey.slice(0, 256),
      "User-Agent": "GP-Mirari-Signatures/1.0",
    },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.id) throw new Error(String(body?.name || body?.message || `email_http_${response.status}`).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 100));
  return String(body.id);
}

async function requireActor(admin: AdminClient, userId: string, organizationId: string, roles: string[]): Promise<Actor | null> {
  if (!isUuid(organizationId)) return null;
  const { data } = await admin
    .from("gp_v2_memberships")
    .select("role,status")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (data?.status !== "active" || !roles.includes(String(data.role))) return null;
  return { id: userId, role: String(data.role) };
}

async function audit(admin: AdminClient, organizationId: string, actorId: string, entityType: string, entityId: string, action: string, requestId: string, afterData: Record<string, unknown>) {
  const { error } = await admin.from("gp_v2_audit_events").insert({
    organization_id: organizationId,
    entity_type: entityType,
    entity_id: entityId,
    action,
    actor_id: actorId,
    request_id: requestId,
    after_data: afterData,
  });
  if (error && !String(error.message).toLowerCase().includes("duplicate")) throw error;
}

async function createDocument(request: Request, admin: AdminClient, userId: string) {
  const form = await request.formData().catch(() => null);
  if (!form) return reply(400, { error: "multipart_form_required" });
  let metadata: Record<string, unknown>;
  try {
    metadata = JSON.parse(String(form.get("metadata") || "{}"));
  } catch {
    return reply(400, { error: "document_metadata_invalid" });
  }
  const file = form.get("file");
  const organizationId = String(metadata.organizationId || "");
  const actor = await requireActor(admin, userId, organizationId, allowedRoles);
  if (!actor) return reply(403, { error: "signature_manager_role_required" });
  if (!(file instanceof File)) return reply(400, { error: "document_file_required" });
  if (!file.size || file.size > maxFileSize) return reply(400, { error: "document_file_size_invalid", maxBytes: maxFileSize });
  if (!allowedMimeTypes.has(file.type)) return reply(400, { error: "document_file_type_not_allowed" });

  const title = String(metadata.title || file.name || "").trim().slice(0, 180);
  const documentKind = String(metadata.documentKind || "other");
  const sourceType = String(metadata.sourceType || "manual");
  const signatureLevel = String(metadata.signatureLevel || "advanced");
  let purpose = "";
  let legalBasis = "";
  let privacyNoticeVersion = "";
  let retentionPolicyVersion = "";
  let retentionUntil = "";
  if (!title || !allowedKinds.has(documentKind) || !allowedSources.has(sourceType) || !allowedSignatureLevels.has(signatureLevel)
  ) {
    return reply(400, { error: "document_metadata_invalid" });
  }

  // Compliance is selected by the active, administrator-approved policy. Client input
  // is deliberately ignored so a user cannot bind a document to an arbitrary version.
  const [{ data: privacyNotice }, { data: retentionPolicy }] = await Promise.all([
    admin.from("gp_v2_signature_privacy_notices").select("version").eq("organization_id", organizationId).eq("active", true).not("published_at", "is", null).order("published_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("gp_v2_signature_retention_policies").select("version,legal_basis,purpose,retention_months").eq("organization_id", organizationId).eq("document_kind", documentKind).eq("active", true).not("approved_at", "is", null).order("approved_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!privacyNotice || !retentionPolicy || !legalBases.has(String(retentionPolicy.legal_basis)) || String(retentionPolicy.purpose || "").trim().length < 20) {
    return reply(409, { error: "active_compliance_configuration_required", documentKind });
  }
  privacyNoticeVersion = String(privacyNotice.version);
  retentionPolicyVersion = String(retentionPolicy.version);
  legalBasis = String(retentionPolicy.legal_basis);
  purpose = String(retentionPolicy.purpose).trim().slice(0, 500);
  const retentionDate = new Date();
  retentionDate.setUTCMonth(retentionDate.getUTCMonth() + Number(retentionPolicy.retention_months));
  retentionUntil = retentionDate.toISOString().slice(0, 10);

  const links = Array.isArray(metadata.links) ? metadata.links.slice(0, 20) : [];
  if (links.some((link: Record<string, unknown>) => !allowedEntityTypes.has(String(link?.entityType || "")) || !String(link?.entityRef || "").trim())) {
    return reply(400, { error: "document_link_invalid" });
  }

  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const verificationCode = `GP-${crypto.randomUUID().replace(/-/g, "").slice(0, 24).toUpperCase()}`;
  const fileName = safeFileName(file.name);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fileHash = await sha256(bytes);
  const storagePath = `${organizationId}/documents/${documentId}/v1/original/${crypto.randomUUID()}-${fileName}`;
  const requestId = String(request.headers.get("idempotency-key") || crypto.randomUUID()).slice(0, 160);
  const { data: existing } = await admin.from("gp_v2_documents")
    .select("id,current_version_id,status")
    .eq("organization_id", organizationId)
    .eq("request_id", requestId)
    .maybeSingle();
  if (existing) return reply(200, { ok: true, idempotent: true, documentId: existing.id, versionId: existing.current_version_id, status: existing.status });

  const { error: documentError } = await admin.from("gp_v2_documents").insert({
    id: documentId,
    organization_id: organizationId,
    title,
    document_kind: documentKind,
    source_type: sourceType,
    request_id: requestId,
    verification_code: verificationCode,
    purpose,
    legal_basis: legalBasis,
    privacy_notice_version: privacyNoticeVersion,
    retention_policy_version: retentionPolicyVersion,
    retention_until: retentionUntil,
    signature_level: signatureLevel,
    status: "preparing",
    metadata: typeof metadata.context === "object" && metadata.context ? metadata.context : {},
    created_by: userId,
    updated_by: userId,
  });
  if (documentError) return reply(400, { error: "document_create_failed" });

  const bucket = admin.storage.from("gp-v2-signature-files");
  const { error: uploadError } = await bucket.upload(storagePath, bytes, { contentType: file.type, upsert: false });
  if (uploadError) {
    await admin.from("gp_v2_documents").delete().eq("id", documentId).eq("organization_id", organizationId);
    return reply(400, { error: "document_upload_failed" });
  }

  const now = new Date().toISOString();
  const { error: versionError } = await admin.from("gp_v2_document_versions").insert({
    id: versionId,
    organization_id: organizationId,
    document_id: documentId,
    version_number: 1,
    file_name: fileName,
    content_type: file.type,
    size_bytes: file.size,
    storage_path: storagePath,
    sha256: fileHash,
    state: "final",
    created_by: userId,
    finalized_at: now,
  });
  if (versionError) {
    await bucket.remove([storagePath]);
    await admin.from("gp_v2_documents").delete().eq("id", documentId).eq("organization_id", organizationId);
    return reply(400, { error: "document_version_create_failed" });
  }

  if (links.length) {
    const { error: linksError } = await admin.from("gp_v2_document_links").insert(links.map((link: Record<string, unknown>) => ({
      organization_id: organizationId,
      document_id: documentId,
      entity_type: String(link.entityType),
      entity_ref: String(link.entityRef).trim().slice(0, 200),
      link_role: ["source", "primary", "related", "supersedes"].includes(String(link.linkRole)) ? String(link.linkRole) : "related",
      created_by: userId,
    })));
    if (linksError) {
      await admin.from("gp_v2_document_versions").delete().eq("id", versionId).eq("organization_id", organizationId);
      await bucket.remove([storagePath]);
      await admin.from("gp_v2_documents").delete().eq("id", documentId).eq("organization_id", organizationId);
      return reply(400, { error: "document_links_create_failed" });
    }
  }

  const { error: readyError } = await admin.from("gp_v2_documents").update({
    current_version_id: versionId,
    status: "ready",
    updated_at: now,
  }).eq("id", documentId).eq("organization_id", organizationId);
  if (readyError) return reply(500, { error: "document_finalize_failed" });

  await audit(admin, organizationId, userId, "signature_document", documentId, "document_created", requestId, {
    documentKind,
    sourceType,
    signatureLevel,
    version: 1,
    sha256: fileHash,
  });
  return reply(201, { ok: true, documentId, versionId, verificationCode, sha256: fileHash, status: "ready" });
}

async function autentiqueCreateDocument(token: string, mode: string, title: string, level: string, fileName: string, contentType: string, bytes: Uint8Array, signers: SignerInput[]) {
  const query = `mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
    createDocument(document: $document, signers: $signers, file: $file${mode === "sandbox" ? ", sandbox: true" : ""}) {
      id name qualified sandbox created_at
      signatures { public_id name email created_at action { name } link { short_link } }
      files { original signed pades }
    }
  }`;
  const providerSigners = signers.map((signer) => {
    const cpf = normalizeDigits(signer.cpf);
    return {
      name: String(signer.name || "").trim(),
      email: String(signer.email || "").trim().toLowerCase(),
      action: "SIGN",
      ...(cpf ? { cpf } : {}),
    };
  });
  const operations = {
    query,
    variables: {
      document: {
        name: title,
        refusable: true,
        sortable: signers.length > 1,
        qualified: level === "qualified_icp_brasil",
      },
      signers: providerSigners,
      file: null,
    },
  };
  const form = new FormData();
  form.set("operations", JSON.stringify(operations));
  form.set("map", JSON.stringify({ file: ["variables.file"] }));
  form.set("file", new File([bytes], fileName, { type: contentType }));
  const response = await fetch("https://api.autentique.com.br/v2/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.errors?.length || !body?.data?.createDocument?.id) {
    const code = String(body?.errors?.[0]?.extensions?.code || body?.errors?.[0]?.message || `http_${response.status}`)
      .toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 120);
    throw new Error(code || "provider_create_failed");
  }
  return body.data.createDocument;
}

function internalProviderConfig() {
  const appUrl = String(Deno.env.get("SIGNATURE_APP_URL") || "").replace(/\/+$/, "");
  let appUrlValid = false;
  try { appUrlValid = new URL(appUrl).protocol === "https:"; } catch { appUrlValid = false; }
  return {
    enabled: Deno.env.get("SIGNATURE_INTERNAL_ENABLED") === "true",
    appUrl,
    appUrlValid,
    tokenPepper: Deno.env.get("SIGNATURE_TOKEN_PEPPER") || "",
    dataPepper: Deno.env.get("SIGNATURE_DATA_PEPPER") || "",
    emailConfigured: !!Deno.env.get("RESEND_API_KEY") && !!Deno.env.get("SIGNATURE_FROM_EMAIL"),
  };
}

async function sendInternalDocument(request: Request, payload: Record<string, unknown>, admin: AdminClient, userId: string) {
  const organizationId = String(payload.organizationId || "");
  const documentId = String(payload.documentId || "");
  const actor = await requireActor(admin, userId, organizationId, allowedRoles);
  if (!actor) return reply(403, { error: "signature_manager_role_required" });
  if (!isUuid(documentId)) return reply(400, { error: "document_id_invalid" });
  const config = internalProviderConfig();
  if (!config.enabled || !config.appUrlValid || !config.tokenPepper || !config.dataPepper || !config.emailConfigured) {
    return reply(503, { error: "internal_signature_provider_not_configured" });
  }

  const signers = Array.isArray(payload.signers) ? payload.signers.slice(0, 20) as InternalSignerInput[] : [];
  if (!signers.length) return reply(400, { error: "signers_required" });
  for (const signer of signers) {
    const signerType = String(signer.signerType || "person");
    const name = String(signer.name || "").trim();
    const email = String(signer.email || "").trim().toLowerCase();
    const cpf = normalizeDigits(signer.cpf);
    const role = String(signer.role || "signer");
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || cpf.length !== 11 || !internalSignerRoles.has(role) || !["person", "company_representative"].includes(signerType)) {
      return reply(400, { error: "signers_invalid" });
    }
    if (signerType === "company_representative") {
      const cnpj = normalizeDigits(signer.companyDocument);
      if (cnpj.length !== 14 || !String(signer.companyLegalName || "").trim() || !String(signer.jobTitle || "").trim()) {
        return reply(400, { error: "company_representative_invalid" });
      }
    }
  }

  const { data: document } = await admin.from("gp_v2_documents")
    .select("id,title,status,signature_level,current_version_id,verification_code,document_kind,privacy_notice_version,retention_policy_version,retention_until,legal_basis,purpose,created_at")
    .eq("id", documentId).eq("organization_id", organizationId).maybeSingle();
  if (!document) return reply(404, { error: "document_not_found" });
  if (!document.current_version_id || !["ready", "failed"].includes(String(document.status))) return reply(409, { error: "document_not_ready" });
  if (document.signature_level !== "advanced") return reply(409, { error: "internal_provider_requires_advanced_signature" });
  if (!document.privacy_notice_version || !document.retention_policy_version || !document.retention_until || !document.legal_basis || !document.purpose) {
    return reply(409, { error: "document_lgpd_configuration_required" });
  }

  const [{ data: privacyNotice }, { data: retentionPolicy }, { data: consentText }, { data: version }] = await Promise.all([
    admin.from("gp_v2_signature_privacy_notices").select("id,version,published_at").eq("organization_id", organizationId).eq("version", document.privacy_notice_version).not("published_at", "is", null).maybeSingle(),
    admin.from("gp_v2_signature_retention_policies").select("id,version,legal_basis,approved_at").eq("organization_id", organizationId).eq("version", document.retention_policy_version).eq("document_kind", document.document_kind).not("approved_at", "is", null).maybeSingle(),
    admin.from("gp_v2_signature_consent_texts").select("id,version,content,content_sha256").eq("organization_id", organizationId).eq("version", "gp-sign-consent-v1").eq("active", true).maybeSingle(),
    admin.from("gp_v2_document_versions").select("id,file_name,content_type,size_bytes,storage_path,sha256").eq("id", document.current_version_id).eq("organization_id", organizationId).maybeSingle(),
  ]);
  if (!privacyNotice) return reply(409, { error: "privacy_notice_not_published" });
  if (!retentionPolicy || retentionPolicy.legal_basis !== document.legal_basis) return reply(409, { error: "retention_policy_not_approved" });
  if (!consentText) return reply(409, { error: "signature_consent_text_missing" });
  if (!version) return reply(404, { error: "document_version_not_found" });
  if (version.content_type !== "application/pdf") return reply(409, { error: "internal_provider_requires_pdf" });

  const expiresInHours = Math.min(720, Math.max(1, Number(payload.expiresInHours) || 168));
  const expiresAt = new Date(Date.now() + expiresInHours * 3600000).toISOString();
  const requestId = String(request.headers.get("idempotency-key") || payload.requestId || crypto.randomUUID()).slice(0, 160);
  const { data: existing } = await admin.from("gp_v2_signature_envelopes").select("id,status").eq("organization_id", organizationId).eq("request_id", requestId).maybeSingle();
  if (existing) return reply(200, { ok: true, idempotent: true, envelopeId: existing.id, status: existing.status });

  const envelopeId = crypto.randomUUID();
  const now = new Date().toISOString();
  const signerRows = [];
  const linkRows = [];
  const invitationTokens: Array<{ signerId: string; name: string; email: string; token: string; role: string }> = [];
  for (let index = 0; index < signers.length; index += 1) {
    const signer = signers[index];
    const signerId = crypto.randomUUID();
    const signerType = String(signer.signerType || "person");
    const cpf = normalizeDigits(signer.cpf);
    const cnpj = normalizeDigits(signer.companyDocument);
    const phone = normalizeDigits(signer.phone);
    const token = randomToken(32);
    const tokenHash = await hmacSha256(config.tokenPepper, token);
    const tokenFingerprint = (await sha256(token)).slice(0, 16);
    signerRows.push({
      id: signerId,
      organization_id: organizationId,
      envelope_id: envelopeId,
      signer_role: String(signer.role || "signer"),
      signer_type: signerType,
      signing_order: index + 1,
      name: String(signer.name || "").trim(),
      email: String(signer.email || "").trim().toLowerCase(),
      phone_last4: phone.slice(-4),
      document_last4: cpf.slice(-4),
      document_hash: await hmacSha256(config.dataPepper, `${organizationId}|cpf|${cpf}`),
      company_legal_name: signerType === "company_representative" ? String(signer.companyLegalName || "").trim() : "",
      company_document_last4: cnpj.slice(-4),
      company_document_hash: cnpj ? await hmacSha256(config.dataPepper, `${organizationId}|cnpj|${cnpj}`) : "",
      job_title: signerType === "company_representative" ? String(signer.jobTitle || "").trim() : "",
      // The representative, not the administrative sender, must make this declaration.
      representation_declared: false,
      representation_declared_at: null,
      authentication_methods: ["individual_link", "email_otp", "express_consent"],
      status: "pending",
    });
    linkRows.push({
      organization_id: organizationId,
      envelope_id: envelopeId,
      signer_id: signerId,
      token_hash: tokenHash,
      token_fingerprint: tokenFingerprint,
      expires_at: expiresAt,
      created_by: userId,
    });
    invitationTokens.push({ signerId, name: String(signer.name || "").trim(), email: String(signer.email || "").trim().toLowerCase(), token, role: String(signer.role || "signer") });
  }

  const { error: envelopeError } = await admin.from("gp_v2_signature_envelopes").insert({
    id: envelopeId,
    organization_id: organizationId,
    document_id: documentId,
    document_version_id: version.id,
    provider: "internal",
    request_id: requestId,
    signature_level: "advanced",
    status: "preparing",
    consent_text_version: consentText.version,
    expires_at: expiresAt,
    provider_metadata: { capabilityVersion: "internal-v1", authentication: "email_otp" },
    created_by: userId,
  });
  if (envelopeError) return reply(409, { error: "signature_request_conflict" });

  const { error: signersError } = await admin.from("gp_v2_signature_signers").insert(signerRows);
  if (signersError) {
    await admin.from("gp_v2_signature_envelopes").update({ status: "failed", last_error_code: "signers_persist_failed", updated_at: now }).eq("id", envelopeId);
    return reply(500, { error: "signers_persist_failed" });
  }
  const { error: linksError } = await admin.from("gp_v2_signature_access_links").insert(linkRows);
  if (linksError) {
    await admin.from("gp_v2_signature_envelopes").update({ status: "failed", last_error_code: "access_links_persist_failed", updated_at: now }).eq("id", envelopeId);
    return reply(500, { error: "access_links_persist_failed" });
  }
  const { error: artifactError } = await admin.from("gp_v2_signature_artifacts").insert({
    organization_id: organizationId,
    envelope_id: envelopeId,
    artifact_kind: "original",
    storage_path: version.storage_path,
    content_type: version.content_type,
    size_bytes: version.size_bytes,
    sha256: version.sha256,
  });
  if (artifactError) return reply(500, { error: "original_artifact_persist_failed" });

  await admin.from("gp_v2_signature_envelopes").update({ status: "awaiting_signature", sent_at: now, updated_at: now }).eq("id", envelopeId).eq("organization_id", organizationId);
  await admin.from("gp_v2_documents").update({ status: "awaiting_signature", updated_by: userId, updated_at: now }).eq("id", documentId).eq("organization_id", organizationId);
  const contextIp = requestIp(request);
  const contextUserAgent = request.headers.get("user-agent") || "";
  const timezone = safeTimezone(payload.timezone);
  await appendEvidenceEvent(admin, { organizationId, envelopeId, eventType: "document.created", actorType: "user", occurredAt: document.created_at || now, timezone, ip: contextIp, userAgent: contextUserAgent, result: "success", documentHash: version.sha256, authChannel: "supabase_auth", metadata: { version: 1, verificationCode: document.verification_code } });
  await appendEvidenceEvent(admin, { organizationId, envelopeId, eventType: "document.sent", actorType: "user", occurredAt: now, timezone, ip: contextIp, userAgent: contextUserAgent, result: "success", documentHash: version.sha256, authChannel: "supabase_auth", metadata: { signerCount: signers.length, provider: "internal" } });

  let delivered = 0;
  for (let index = 0; index < invitationTokens.length; index += 1) {
    const invitation = invitationTokens[index];
    const accessLink = `${config.appUrl}#t=${encodeURIComponent(invitation.token)}`;
    try {
      const messageId = await sendEmail(
        invitation.email,
        `Assinatura solicitada: ${document.title}`,
        `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#252525"><h2>Assinatura eletrônica solicitada</h2><p>Olá, ${escapeHtml(invitation.name)}.</p><p>Você recebeu um documento para leitura e assinatura. O processo solicitará a confirmação dos seus dados, um código enviado por e-mail e uma manifestação expressa de concordância.</p><p><a href="${escapeHtml(accessLink)}" style="display:inline-block;background:#285f52;color:#fff;padding:12px 18px;border-radius:7px;text-decoration:none">Acessar documento</a></p><p>Este link é individual e expira em ${expiresInHours} hora(s). Não o encaminhe a terceiros.</p><p style="font-size:12px;color:#666">A força probatória da assinatura depende do documento, do método de identificação e das evidências coletadas. ICP-Brasil não é exigido neste fluxo.</p></div>`,
        `signature-invite/${envelopeId}/${invitation.signerId}/1`,
      );
      delivered += 1;
      await admin.from("gp_v2_signature_email_deliveries").upsert({
        organization_id: organizationId, envelope_id: envelopeId, signer_id: invitation.signerId,
        message_type: "invitation", provider: "resend", provider_message_id_hash: await sha256(messageId), delivery_status: "sent",
      }, { onConflict: "organization_id,provider,provider_message_id_hash" });
      await admin.from("gp_v2_signature_signers").update({ status: "invited", updated_at: new Date().toISOString() }).eq("id", invitation.signerId).eq("organization_id", organizationId);
      await appendEvidenceEvent(admin, { organizationId, envelopeId, signerId: invitation.signerId, eventType: "invitation.sent", actorType: "system", timezone, ip: contextIp, userAgent: contextUserAgent, result: "success", documentHash: version.sha256, authChannel: "email", metadata: { providerMessageIdHash: await sha256(messageId), signerOrder: index + 1 } });
    } catch (error) {
      const code = String(error instanceof Error ? error.message : "email_delivery_failed").slice(0, 100);
      await admin.from("gp_v2_signature_signers").update({ status: "delivery_failed", updated_at: new Date().toISOString() }).eq("id", invitation.signerId).eq("organization_id", organizationId);
      await appendEvidenceEvent(admin, { organizationId, envelopeId, signerId: invitation.signerId, eventType: "invitation.delivery_failed", actorType: "system", timezone, ip: contextIp, userAgent: contextUserAgent, result: "failed", documentHash: version.sha256, authChannel: "email", metadata: { errorCode: code, signerOrder: index + 1 } });
    }
  }

  if (!delivered) await admin.from("gp_v2_signature_envelopes").update({ last_error_code: "all_invitations_failed", updated_at: new Date().toISOString() }).eq("id", envelopeId);
  await audit(admin, organizationId, userId, "signature_envelope", envelopeId, "internal_envelope_sent", requestId, { signerCount: signers.length, delivered, expiresAt, signatureLevel: "advanced" });
  return reply(201, { ok: true, envelopeId, status: "awaiting_signature", provider: "internal", signerCount: signers.length, invitationsDelivered: delivered, expiresAt });
}

async function resendInternalInvitation(request: Request, payload: Record<string, unknown>, admin: AdminClient, userId: string) {
  const organizationId = String(payload.organizationId || "");
  const signerId = String(payload.signerId || "");
  const actor = await requireActor(admin, userId, organizationId, allowedRoles);
  if (!actor) return reply(403, { error: "signature_manager_role_required" });
  if (!isUuid(signerId)) return reply(400, { error: "signer_id_invalid" });
  const config = internalProviderConfig();
  if (!config.enabled || !config.appUrlValid || !config.tokenPepper || !config.emailConfigured) return reply(503, { error: "internal_signature_provider_not_configured" });
  const { data: signer } = await admin.from("gp_v2_signature_signers")
    .select("id,name,email,status,envelope_id,gp_v2_signature_envelopes!inner(id,provider,status,expires_at,document_id,document_version_id)")
    .eq("id", signerId).eq("organization_id", organizationId).maybeSingle();
  const envelope = signer?.gp_v2_signature_envelopes as unknown as Record<string, unknown> | null;
  if (!signer || !envelope || envelope.provider !== "internal" || ["signed", "declined"].includes(String(signer.status)) || ["signed", "declined", "expired", "cancelled", "superseded"].includes(String(envelope.status))) {
    return reply(404, { error: "signature_invitation_unavailable" });
  }
  const { data: document } = await admin.from("gp_v2_documents").select("title").eq("id", envelope.document_id).eq("organization_id", organizationId).maybeSingle();
  const { data: version } = await admin.from("gp_v2_document_versions").select("sha256").eq("id", envelope.document_version_id).eq("organization_id", organizationId).maybeSingle();
  if (!document || !version) return reply(404, { error: "signature_invitation_unavailable" });
  const token = randomToken(32);
  const tokenHash = await hmacSha256(config.tokenPepper, token);
  const tokenFingerprint = (await sha256(token)).slice(0, 16);
  const now = new Date().toISOString();
  await admin.from("gp_v2_signature_access_links").update({ status: "revoked", revoked_at: now }).eq("organization_id", organizationId).eq("signer_id", signerId).eq("status", "active");
  const { error: linkError } = await admin.from("gp_v2_signature_access_links").insert({ organization_id: organizationId, envelope_id: envelope.id, signer_id: signerId, token_hash: tokenHash, token_fingerprint: tokenFingerprint, expires_at: envelope.expires_at, created_by: userId });
  if (linkError) return reply(500, { error: "invitation_rotation_failed" });
  const link = `${config.appUrl}#t=${encodeURIComponent(token)}`;
  try {
    const messageId = await sendEmail(String(signer.email), `Novo acesso para assinatura: ${document.title}`, `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#252525"><h2>Novo link de assinatura</h2><p>Olá, ${escapeHtml(signer.name)}.</p><p>O acesso anterior foi revogado. Utilize somente este novo link individual:</p><p><a href="${escapeHtml(link)}" style="display:inline-block;background:#285f52;color:#fff;padding:12px 18px;border-radius:7px;text-decoration:none">Acessar documento</a></p><p>Não encaminhe este link a terceiros.</p></div>`, `signature-resend/${envelope.id}/${signerId}/${Date.now()}`);
    await admin.from("gp_v2_signature_signers").update({ status: "invited", updated_at: now }).eq("id", signerId).eq("organization_id", organizationId);
    await appendEvidenceEvent(admin, { organizationId, envelopeId: String(envelope.id), signerId, eventType: "invitation.resent", actorType: "user", timezone: payload.timezone as string, ip: requestIp(request), userAgent: request.headers.get("user-agent") || "", tokenFingerprint, result: "success", documentHash: version.sha256, authChannel: "email", metadata: { providerMessageIdHash: await sha256(messageId), previousLinksRevoked: true } });
    return reply(200, { ok: true, signerId, status: "invited" });
  } catch (error) {
    await admin.from("gp_v2_signature_signers").update({ status: "delivery_failed", updated_at: now }).eq("id", signerId).eq("organization_id", organizationId);
    return reply(502, { error: "invitation_delivery_failed" });
  }
}

async function saveComplianceConfiguration(payload: Record<string, unknown>, admin: AdminClient, userId: string) {
  const organizationId = String(payload.organizationId || "");
  const actor = await requireActor(admin, userId, organizationId, ["owner", "admin"]);
  if (!actor) return reply(403, { error: "signature_admin_role_required" });
  if (payload.legalReviewConfirmed !== true) return reply(400, { error: "legal_review_confirmation_required" });
  const privacy = (payload.privacy || {}) as Record<string, unknown>;
  const retention = (payload.retention || {}) as Record<string, unknown>;
  const privacyVersion = String(privacy.version || "").trim().slice(0, 100);
  const privacyTitle = String(privacy.title || "").trim().slice(0, 180);
  const privacyContent = String(privacy.content || "").trim().slice(0, 20000);
  const retentionVersion = String(retention.version || "").trim().slice(0, 100);
  const retentionName = String(retention.name || "").trim().slice(0, 180);
  const documentKind = String(retention.documentKind || "");
  const legalBasis = String(retention.legalBasis || "");
  const purpose = String(retention.purpose || "").trim().slice(0, 1000);
  const approvedBy = String(retention.approvedBy || "").trim().slice(0, 180);
  const retentionMonths = Number(retention.retentionMonths);
  const evidenceRetentionMonths = Number(retention.evidenceRetentionMonths);
  const validVersion = /^[a-zA-Z0-9._-]{3,100}$/;
  const invalidFields: string[] = [];
  if (!validVersion.test(privacyVersion)) invalidFields.push("versão do aviso");
  if (!privacyTitle) invalidFields.push("título do aviso");
  if (privacyContent.length < 100) invalidFields.push("texto do aviso (mínimo de 100 caracteres)");
  if (!validVersion.test(retentionVersion)) invalidFields.push("versão da retenção");
  if (!retentionName) invalidFields.push("nome da política");
  if (!allowedKinds.has(documentKind)) invalidFields.push("tipo de documento");
  if (!legalBases.has(legalBasis)) invalidFields.push("base legal");
  if (purpose.length < 20) invalidFields.push("finalidade do tratamento (mínimo de 20 caracteres)");
  if (approvedBy.length < 3) invalidFields.push("responsável pela aprovação");
  if (!Number.isInteger(retentionMonths) || retentionMonths < 1 || retentionMonths > 600) invalidFields.push("retenção do documento (1 a 600 meses)");
  if (!Number.isInteger(evidenceRetentionMonths) || evidenceRetentionMonths < 1 || evidenceRetentionMonths > 600) invalidFields.push("retenção das evidências (1 a 600 meses)");
  if (invalidFields.length) return reply(400, { error: "compliance_configuration_invalid", invalidFields });
  const [{ data: existingPrivacy }, { data: existingRetention }] = await Promise.all([
    admin.from("gp_v2_signature_privacy_notices").select("id").eq("organization_id", organizationId).eq("version", privacyVersion).maybeSingle(),
    admin.from("gp_v2_signature_retention_policies").select("id").eq("organization_id", organizationId).eq("version", retentionVersion).eq("document_kind", documentKind).maybeSingle(),
  ]);
  if (existingPrivacy || existingRetention) return reply(409, { error: "configuration_version_already_exists" });
  const now = new Date().toISOString();
  const [{ data: newPrivacy, error: privacyError }, { data: newRetention, error: retentionError }] = await Promise.all([
    admin.from("gp_v2_signature_privacy_notices").insert({ organization_id: organizationId, version: privacyVersion, title: privacyTitle, content: privacyContent, content_sha256: await sha256(privacyContent), active: false, published_at: now, created_by: userId }).select("id").single(),
    admin.from("gp_v2_signature_retention_policies").insert({ organization_id: organizationId, version: retentionVersion, name: retentionName, document_kind: documentKind, retention_months: retentionMonths, evidence_retention_months: evidenceRetentionMonths, legal_basis: legalBasis, purpose, active: false, approved_by: approvedBy, approved_at: now, created_by: userId }).select("id").single(),
  ]);
  if (privacyError || retentionError || !newPrivacy || !newRetention) return reply(500, { error: "compliance_configuration_save_failed" });
  await admin.from("gp_v2_signature_privacy_notices").update({ active: false, retired_at: now }).eq("organization_id", organizationId).eq("active", true).neq("id", newPrivacy.id);
  await admin.from("gp_v2_signature_retention_policies").update({ active: false }).eq("organization_id", organizationId).eq("document_kind", documentKind).eq("active", true).neq("id", newRetention.id);
  const [{ error: activatePrivacyError }, { error: activateRetentionError }] = await Promise.all([
    admin.from("gp_v2_signature_privacy_notices").update({ active: true, retired_at: null }).eq("id", newPrivacy.id).eq("organization_id", organizationId),
    admin.from("gp_v2_signature_retention_policies").update({ active: true }).eq("id", newRetention.id).eq("organization_id", organizationId),
  ]);
  if (activatePrivacyError || activateRetentionError) return reply(500, { error: "compliance_configuration_activation_failed" });
  await audit(admin, organizationId, userId, "signature_compliance", organizationId, "signature_compliance_published", crypto.randomUUID(), { privacyVersion, retentionVersion, documentKind, legalBasis, retentionMonths, evidenceRetentionMonths });
  return reply(201, { ok: true, privacyVersion, retentionVersion, documentKind });
}

async function cancelEnvelope(request: Request, payload: Record<string, unknown>, admin: AdminClient, userId: string) {
  const organizationId = String(payload.organizationId || "");
  const envelopeId = String(payload.envelopeId || "");
  const actor = await requireActor(admin, userId, organizationId, allowedRoles);
  if (!actor) return reply(403, { error: "signature_manager_role_required" });
  if (!isUuid(envelopeId)) return reply(400, { error: "envelope_id_invalid" });
  const { data: envelope } = await admin.from("gp_v2_signature_envelopes").select("id,document_id,document_version_id,status").eq("id", envelopeId).eq("organization_id", organizationId).maybeSingle();
  if (!envelope || ["signed", "declined", "expired", "cancelled", "superseded"].includes(envelope.status)) return reply(409, { error: "signature_process_closed" });
  const { data: version } = await admin.from("gp_v2_document_versions").select("sha256").eq("id", envelope.document_version_id).eq("organization_id", organizationId).maybeSingle();
  const now = new Date().toISOString();
  await admin.from("gp_v2_signature_access_links").update({ status: "revoked", revoked_at: now }).eq("organization_id", organizationId).eq("envelope_id", envelopeId).eq("status", "active");
  await admin.from("gp_v2_signature_sessions").update({ status: "revoked", revoked_at: now }).eq("organization_id", organizationId).eq("envelope_id", envelopeId).eq("status", "active");
  await admin.from("gp_v2_signature_envelopes").update({ status: "cancelled", completed_at: now, updated_at: now }).eq("id", envelopeId).eq("organization_id", organizationId);
  await admin.from("gp_v2_documents").update({ status: "cancelled", completed_at: now, updated_by: userId, updated_at: now }).eq("id", envelope.document_id).eq("organization_id", organizationId);
  await appendEvidenceEvent(admin, { organizationId, envelopeId, eventType: "document.cancelled", actorType: "user", occurredAt: now, timezone: payload.timezone as string, ip: requestIp(request), userAgent: request.headers.get("user-agent") || "", result: "cancelled", documentHash: version?.sha256 || "", authChannel: "supabase_auth", metadata: { reason: String(payload.reason || "").trim().slice(0, 500) } });
  return reply(200, { ok: true, status: "cancelled" });
}

async function sendDocument(request: Request, payload: Record<string, unknown>, admin: AdminClient, userId: string) {
  const organizationId = String(payload.organizationId || "");
  const documentId = String(payload.documentId || "");
  const actor = await requireActor(admin, userId, organizationId, allowedRoles);
  if (!actor) return reply(403, { error: "signature_manager_role_required" });
  if (!isUuid(documentId)) return reply(400, { error: "document_id_invalid" });
  const selectedProvider = String(payload.provider || "internal").toLowerCase();
  if (selectedProvider === "internal") return sendInternalDocument(request, payload, admin, userId);

  const signers = Array.isArray(payload.signers) ? payload.signers.slice(0, 10) as SignerInput[] : [];
  const signerRoles = new Set(["company", "client", "witness", "approver", "signer"]);
  const signerInvalid = !signers.length || signers.some((signer) => {
    const name = String(signer?.name || "").trim();
    const email = String(signer?.email || "").trim();
    const cpf = normalizeDigits(signer?.cpf);
    return !name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || (cpf && ![11, 14].includes(cpf.length)) || (signer?.role && !signerRoles.has(String(signer.role)));
  });
  if (signerInvalid) return reply(400, { error: "signers_invalid" });

  const provider = String(Deno.env.get("SIGNATURE_PROVIDER") || "autentique").toLowerCase();
  const mode = String(Deno.env.get("SIGNATURE_MODE") || "").toLowerCase();
  const token = Deno.env.get("AUTENTIQUE_API_TOKEN") || "";
  if (provider !== "autentique") return reply(503, { error: "signature_provider_not_supported" });
  if (!token || !["sandbox", "production"].includes(mode)) return reply(503, { error: "signature_provider_not_configured" });

  const { data: document, error: documentError } = await admin
    .from("gp_v2_documents")
    .select("id,title,status,signature_level,current_version_id")
    .eq("id", documentId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (documentError || !document) return reply(404, { error: "document_not_found" });
  if (!document.current_version_id || !["ready", "failed"].includes(String(document.status))) return reply(409, { error: "document_not_ready" });

  const { data: version } = await admin
    .from("gp_v2_document_versions")
    .select("id,file_name,content_type,size_bytes,storage_path,sha256")
    .eq("id", document.current_version_id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (!version) return reply(404, { error: "document_version_not_found" });

  const requestId = String(request.headers.get("idempotency-key") || payload.requestId || crypto.randomUUID()).slice(0, 160);
  const { data: existing } = await admin.from("gp_v2_signature_envelopes")
    .select("id,status,provider_envelope_id")
    .eq("organization_id", organizationId)
    .eq("request_id", requestId)
    .maybeSingle();
  if (existing) return reply(200, { ok: true, idempotent: true, envelopeId: existing.id, status: existing.status });

  const envelopeId = crypto.randomUUID();
  const now = new Date().toISOString();
  const { error: envelopeError } = await admin.from("gp_v2_signature_envelopes").insert({
    id: envelopeId,
    organization_id: organizationId,
    document_id: documentId,
    document_version_id: version.id,
    provider,
    request_id: requestId,
    signature_level: document.signature_level,
    status: "preparing",
    created_by: userId,
  });
  if (envelopeError) return reply(409, { error: "signature_request_conflict" });

  const bucket = admin.storage.from("gp-v2-signature-files");
  const { data: storedFile, error: downloadError } = await bucket.download(version.storage_path);
  if (downloadError || !storedFile) {
    await admin.from("gp_v2_signature_envelopes").update({ status: "failed", last_error_code: "original_download_failed", updated_at: now }).eq("id", envelopeId);
    return reply(500, { error: "original_download_failed" });
  }

  try {
    const bytes = new Uint8Array(await storedFile.arrayBuffer());
    const providerDocument = await autentiqueCreateDocument(token, mode, document.title, document.signature_level, version.file_name, version.content_type, bytes, signers);
    const providerSignatures = Array.isArray(providerDocument.signatures) ? providerDocument.signatures : [];
    const { error: providerIdError } = await admin.from("gp_v2_signature_envelopes").update({
      provider_envelope_id: providerDocument.id,
      provider_metadata: { sandbox: mode === "sandbox", qualified: !!providerDocument.qualified },
      updated_at: new Date().toISOString(),
    }).eq("id", envelopeId).eq("organization_id", organizationId);
    if (providerIdError) throw new Error("provider_id_persist_failed");

    const signerRows = await Promise.all(signers.map(async (signer, index) => {
      const cpf = normalizeDigits(signer.cpf);
      const phone = normalizeDigits(signer.phone);
      const providerSigner = providerSignatures[index] || {};
      return {
        organization_id: organizationId,
        envelope_id: envelopeId,
        provider_signer_id: String(providerSigner.public_id || "") || null,
        signer_role: signerRoles.has(String(signer.role)) ? String(signer.role) : "signer",
        signing_order: index + 1,
        name: String(signer.name || "").trim(),
        email: String(signer.email || "").trim().toLowerCase(),
        phone_last4: phone.slice(-4),
        document_last4: cpf.slice(-4),
        document_hash: cpf ? await sha256(`${organizationId}|${cpf}`) : "",
        authentication_methods: [document.signature_level === "qualified_icp_brasil" ? "icp_brasil" : "email"],
      };
    }));
    const { error: signersError } = await admin.from("gp_v2_signature_signers").insert(signerRows);
    if (signersError) throw new Error("signers_persist_failed");

    const responseHash = await sha256(JSON.stringify({ id: providerDocument.id, created_at: providerDocument.created_at, qualified: providerDocument.qualified }));
    const { error: eventError } = await admin.from("gp_v2_signature_events").insert({
      organization_id: organizationId,
      envelope_id: envelopeId,
      event_type: "envelope.created",
      actor_type: "user",
      payload_sha256: responseHash,
      occurred_at: providerDocument.created_at || now,
      metadata: { providerDocumentId: providerDocument.id, sandbox: mode === "sandbox" },
    });
    if (eventError) throw new Error("event_persist_failed");

    const { error: artifactError } = await admin.from("gp_v2_signature_artifacts").insert({
      organization_id: organizationId,
      envelope_id: envelopeId,
      artifact_kind: "original",
      storage_path: version.storage_path,
      content_type: version.content_type,
      size_bytes: version.size_bytes,
      sha256: version.sha256,
    });
    if (artifactError) throw new Error("artifact_persist_failed");

    await admin.from("gp_v2_signature_envelopes").update({
      status: "awaiting_signature",
      sent_at: now,
      updated_at: now,
    }).eq("id", envelopeId).eq("organization_id", organizationId);
    await admin.from("gp_v2_documents").update({ status: "awaiting_signature", updated_by: userId, updated_at: now })
      .eq("id", documentId).eq("organization_id", organizationId);
    await audit(admin, organizationId, userId, "signature_envelope", envelopeId, "envelope_sent", requestId, {
      provider,
      signatureLevel: document.signature_level,
      signerCount: signers.length,
      sandbox: mode === "sandbox",
    });

    return reply(201, {
      ok: true,
      envelopeId,
      status: "awaiting_signature",
      signatureLevel: document.signature_level,
      sandbox: mode === "sandbox",
      signingLinks: providerSignatures.map((signature: Record<string, unknown>, index: number) => ({
        signerOrder: index + 1,
        url: String((signature.link as Record<string, unknown> | undefined)?.short_link || ""),
      })).filter((item: { url: string }) => item.url),
    });
  } catch (error) {
    const errorCode = String(error instanceof Error ? error.message : "provider_create_failed")
      .toLowerCase().replace(/[^a-z0-9_-]+/g, "_").slice(0, 120);
    await admin.from("gp_v2_signature_envelopes").update({ status: "failed", last_error_code: errorCode, updated_at: new Date().toISOString() })
      .eq("id", envelopeId).eq("organization_id", organizationId);
    await admin.from("gp_v2_documents").update({ status: "failed", updated_by: userId, updated_at: new Date().toISOString() })
      .eq("id", documentId).eq("organization_id", organizationId);
    return reply(502, { error: "signature_provider_failed", code: errorCode });
  }
}

async function downloadArtifact(payload: Record<string, unknown>, admin: AdminClient, userId: string) {
  const organizationId = String(payload.organizationId || "");
  const envelopeId = String(payload.envelopeId || "");
  const artifactKind = String(payload.artifactKind || "signed_pdf");
  const actor = await requireActor(admin, userId, organizationId, readableRoles);
  if (!actor) return reply(403, { error: "document_access_denied" });
  if (!isUuid(envelopeId)) return reply(400, { error: "envelope_id_invalid" });
  const { data: artifact } = await admin.from("gp_v2_signature_artifacts")
    .select("storage_path,sha256,content_type")
    .eq("organization_id", organizationId)
    .eq("envelope_id", envelopeId)
    .eq("artifact_kind", artifactKind)
    .maybeSingle();
  if (!artifact) return reply(404, { error: "signature_artifact_not_found" });
  const { data: signed, error } = await admin.storage.from("gp-v2-signature-files").createSignedUrl(artifact.storage_path, 300);
  if (error || !signed?.signedUrl) return reply(500, { error: "signature_artifact_url_failed" });
  return reply(200, { ok: true, signedUrl: signed.signedUrl, expiresIn: 300, sha256: artifact.sha256, contentType: artifact.content_type });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });

  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !anon || !service) return reply(500, { error: "supabase_environment_missing" });
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  const requester = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user } } = await requester.auth.getUser();
  if (!user) return reply(401, { error: "unauthenticated" });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) return createDocument(request, admin, user.id);

  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(payload.action || "");
  if (action === "send_document") return sendDocument(request, payload, admin, user.id);
  if (action === "resend_invitation") return resendInternalInvitation(request, payload, admin, user.id);
  if (action === "save_compliance_configuration") return saveComplianceConfiguration(payload, admin, user.id);
  if (action === "cancel_envelope") return cancelEnvelope(request, payload, admin, user.id);
  if (action === "download_artifact") return downloadArtifact(payload, admin, user.id);
  if (action === "provider_status") {
    const organizationId = String(payload.organizationId || "");
    const actor = await requireActor(admin, user.id, organizationId, allowedRoles);
    if (!actor) return reply(403, { error: "signature_manager_role_required" });
    const internal = internalProviderConfig();
    return reply(200, {
      ok: true,
      defaultProvider: "internal",
      providers: {
        internal: {
          configured: internal.enabled && internal.appUrlValid && !!internal.tokenPepper && !!internal.dataPepper && internal.emailConfigured && !!Deno.env.get("SIGNATURE_OTP_PEPPER"),
          mode: "production",
          signatureLevel: "advanced",
        },
        autentique: {
          configured: !!Deno.env.get("AUTENTIQUE_API_TOKEN"),
          mode: String(Deno.env.get("SIGNATURE_MODE") || "not_configured"),
          webhookConfigured: !!Deno.env.get("AUTENTIQUE_WEBHOOK_SECRET"),
        },
        clicksign: { configured: false }, docusign: { configured: false }, gov_br: { configured: false }, icp_brasil: { configured: false },
      },
    });
  }
  return reply(400, { error: "unsupported_action" });
});
