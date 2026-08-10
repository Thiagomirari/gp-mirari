// GP Mirari V02 - Public signing portal for the internal electronic-signature provider.
// Authentication is performed with opaque, hashed access/session tokens and email OTP.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { zipSync } from "npm:fflate@0.8.2";

const encoder = new TextEncoder();
const bucketName = "gp-v2-signature-files";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
const reply = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, ...extra } });
type AdminClient = ReturnType<typeof createClient>;
type AccessContext = {
  link: Record<string, any>;
  signer: Record<string, any>;
  envelope: Record<string, any>;
  document: Record<string, any>;
  version: Record<string, any>;
};

function config() {
  return {
    tokenPepper: Deno.env.get("SIGNATURE_TOKEN_PEPPER") || "",
    otpPepper: Deno.env.get("SIGNATURE_OTP_PEPPER") || "",
    dataPepper: Deno.env.get("SIGNATURE_DATA_PEPPER") || "",
    resendKey: Deno.env.get("RESEND_API_KEY") || "",
    fromEmail: Deno.env.get("SIGNATURE_FROM_EMAIL") || "",
    verificationUrl: String(Deno.env.get("SIGNATURE_VERIFICATION_URL") || "https://gp.mirari.com.br/verificar-assinatura.html").replace(/\/+$/, ""),
  };
}

function requestIp(request: Request) {
  const raw = request.headers.get("cf-connecting-ip") || request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "";
  const value = raw.trim().slice(0, 64);
  return /^[0-9a-f:.]+$/i.test(value) ? value : "";
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

function normalizeDigits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomOtp() {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return String(100000 + (bytes[0] % 900000));
}

async function sha256(value: ArrayBuffer | Uint8Array | string) {
  const input = typeof value === "string" ? encoder.encode(value) : value instanceof Uint8Array ? value : new Uint8Array(value);
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmacSha256(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameHash(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function escapeHtml(value: unknown) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] || character));
}

function maskedEmail(value: string) {
  const [local, domain] = String(value || "").split("@");
  if (!local || !domain) return "e-mail cadastrado";
  return `${local.slice(0, 2)}${"*".repeat(Math.max(2, Math.min(8, local.length - 2)))}@${domain}`;
}

function maskedCpf(last4: string) {
  return `***.***.*${String(last4 || "").slice(0, 1)}-${String(last4 || "").slice(-2)}`;
}

async function sendEmail(to: string, subject: string, html: string, idempotencyKey: string) {
  const cfg = config();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.resendKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey.slice(0, 256), "User-Agent": "GP-Mirari-Signatures/1.0" },
    body: JSON.stringify({ from: cfg.fromEmail, to: [to], subject, html }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body?.id) throw new Error(`email_http_${response.status}`);
  return String(body.id);
}

async function appendEvent(admin: AdminClient, request: Request, input: {
  organizationId: string; envelopeId: string; signerId?: string | null; eventType: string;
  result?: string; documentHash?: string; authChannel?: string; timezone?: string;
  tokenFingerprint?: string; metadata?: Record<string, unknown>; occurredAt?: string;
  actorType?: "user" | "signer" | "provider" | "system";
}) {
  const occurredAt = input.occurredAt || new Date().toISOString();
  const timezone = safeTimezone(input.timezone);
  const ip = requestIp(request);
  const agent = userAgentDetails(request.headers.get("user-agent") || "");
  const cfg = config();
  const ipHash = ip ? await hmacSha256(cfg.dataPepper, `ip|${ip}`) : "";
  const metadata = input.metadata || {};
  const payloadHash = await sha256(JSON.stringify({ eventType: input.eventType, occurredAt, result: input.result || "success", metadata }));
  const { error } = await admin.rpc("gp_v2_append_signature_event", {
    p_organization_id: input.organizationId, p_envelope_id: input.envelopeId, p_signer_id: input.signerId || null,
    p_provider_event_id: "", p_event_type: input.eventType, p_actor_type: input.actorType || "signer", p_payload_sha256: payloadHash,
    p_occurred_at: occurredAt, p_local_occurred_at: localDateTime(occurredAt, timezone), p_presented_timezone: timezone,
    p_ip_address: ip || null, p_ip_hash: ipHash, p_user_agent: agent.userAgent, p_browser: agent.browser,
    p_operating_system: agent.operatingSystem, p_token_fingerprint: input.tokenFingerprint || "",
    p_result: input.result || "success", p_document_sha256: input.documentHash || "", p_auth_channel: input.authChannel || "",
    p_metadata: metadata,
  });
  if (error) throw new Error("evidence_event_failed");
}

async function consumeRate(admin: AdminClient, key: string, action: string, windowSeconds: number, maxRequests: number, blockSeconds: number) {
  const keyHash = await hmacSha256(config().dataPepper, `rate|${action}|${key}`);
  const { data, error } = await admin.rpc("gp_v2_consume_signature_rate_limit", {
    p_key_hash: keyHash, p_action: action, p_window_seconds: windowSeconds, p_max_requests: maxRequests, p_block_seconds: blockSeconds,
  });
  if (error) {
    console.error("signature_rate_limit_unavailable", JSON.stringify({ code: String(error.code || ""), message: String(error.message || "").slice(0, 180), hint: String(error.hint || "").slice(0, 120), action }));
    return { status: "unavailable" as const, retryAfter: 0 };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row.allowed !== "boolean") {
    console.error("signature_rate_limit_unavailable", JSON.stringify({ code: "invalid_rpc_response", action }));
    return { status: "unavailable" as const, retryAfter: 0 };
  }
  return row.allowed ? { status: "allowed" as const, retryAfter: 0 } : { status: "limited" as const, retryAfter: Math.max(1, Number(row.retry_after_seconds || 1)) };
}

async function rateIdentity(request: Request, fallback: string) {
  const ip = requestIp(request);
  if (ip) return `ip:${ip}`;
  const agentFingerprint = (await sha256(request.headers.get("user-agent") || "")).slice(0, 32);
  return `${fallback}:ua:${agentFingerprint}`;
}

function rateReply(rate: { status: "allowed" | "limited" | "unavailable" }) {
  if (rate.status === "limited") return reply(429, { error: "temporarily_unavailable" }, { "Retry-After": String((rate as any).retryAfter || 1) });
  if (rate.status === "unavailable") return reply(503, { error: "rate_limit_service_unavailable" });
  return null;
}

async function recordInvalidAccess(admin: AdminClient, request: Request, incidentType: string) {
  const ip = requestIp(request);
  const ipHash = ip ? await hmacSha256(config().dataPepper, `ip|${ip}`) : "";
  await admin.from("gp_v2_signature_security_incidents").insert({
    organization_id: null, incident_type: incidentType, severity: "low", source_ip_hash: ipHash,
    details: { userAgentHash: await sha256(request.headers.get("user-agent") || ""), recordedAt: new Date().toISOString() },
  });
}

async function accessContext(admin: AdminClient, rawToken: unknown, request?: Request, timezone?: unknown): Promise<AccessContext | null> {
  const token = String(rawToken || "");
  if (token.length < 40 || token.length > 200) return null;
  const tokenHash = await hmacSha256(config().tokenPepper, token);
  const { data: link } = await admin.from("gp_v2_signature_access_links").select("*").eq("token_hash", tokenHash).maybeSingle();
  if (!link || link.status !== "active") return null;
  const [{ data: signer }, { data: envelope }] = await Promise.all([
    admin.from("gp_v2_signature_signers").select("*").eq("id", link.signer_id).eq("organization_id", link.organization_id).maybeSingle(),
    admin.from("gp_v2_signature_envelopes").select("*").eq("id", link.envelope_id).eq("organization_id", link.organization_id).maybeSingle(),
  ]);
  if (!signer || !envelope || envelope.provider !== "internal") return null;
  const [{ data: document }, { data: version }] = await Promise.all([
    admin.from("gp_v2_documents").select("*").eq("id", envelope.document_id).eq("organization_id", link.organization_id).maybeSingle(),
    admin.from("gp_v2_document_versions").select("*").eq("id", envelope.document_version_id).eq("organization_id", link.organization_id).maybeSingle(),
  ]);
  if (!document || !version) return null;
  if (new Date(link.expires_at).getTime() <= Date.now()) {
    const now = new Date().toISOString();
    await admin.from("gp_v2_signature_access_links").update({ status: "expired" }).eq("id", link.id).eq("status", "active");
    if (!["signed", "declined", "cancelled", "superseded", "expired"].includes(envelope.status)) {
      await admin.from("gp_v2_signature_envelopes").update({ status: "expired", completed_at: now, updated_at: now }).eq("id", envelope.id).eq("organization_id", link.organization_id);
      await admin.from("gp_v2_documents").update({ status: "expired", completed_at: now, updated_at: now }).eq("id", document.id).eq("organization_id", link.organization_id);
      if (request) await appendEvent(admin, request, { organizationId: link.organization_id, envelopeId: envelope.id, signerId: signer.id, eventType: "document.expired", actorType: "system", result: "expired", documentHash: version.sha256, authChannel: "individual_link", tokenFingerprint: link.token_fingerprint, timezone: timezone as string, occurredAt: now });
    }
    return null;
  }
  if (Number(link.access_count) >= Number(link.max_accesses)) {
    await admin.from("gp_v2_signature_access_links").update({ status: "consumed" }).eq("id", link.id).eq("status", "active");
    return null;
  }
  return { link, signer, envelope, document, version };
}

async function sessionContext(admin: AdminClient, rawSession: unknown, request: Request) {
  const sessionToken = String(rawSession || "");
  if (sessionToken.length < 40 || sessionToken.length > 200) return null;
  const sessionHash = await hmacSha256(config().tokenPepper, `session|${sessionToken}`);
  const { data: session } = await admin.from("gp_v2_signature_sessions").select("*").eq("session_hash", sessionHash).maybeSingle();
  if (!session || !["active", "completed"].includes(session.status) || new Date(session.expires_at).getTime() <= Date.now()) return null;
  const agentHash = await sha256(request.headers.get("user-agent") || "");
  if (!sameHash(session.user_agent_hash, agentHash)) return null;
  const [{ data: signer }, { data: envelope }] = await Promise.all([
    admin.from("gp_v2_signature_signers").select("*").eq("id", session.signer_id).eq("organization_id", session.organization_id).maybeSingle(),
    admin.from("gp_v2_signature_envelopes").select("*").eq("id", session.envelope_id).eq("organization_id", session.organization_id).maybeSingle(),
  ]);
  if (!signer || !envelope) return null;
  const [{ data: document }, { data: version }] = await Promise.all([
    admin.from("gp_v2_documents").select("*").eq("id", envelope.document_id).eq("organization_id", session.organization_id).maybeSingle(),
    admin.from("gp_v2_document_versions").select("*").eq("id", envelope.document_version_id).eq("organization_id", session.organization_id).maybeSingle(),
  ]);
  if (!document || !version) return null;
  await admin.from("gp_v2_signature_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", session.id);
  return { session, signer, envelope, document, version };
}

async function inspectLink(request: Request, payload: Record<string, unknown>, admin: AdminClient) {
  const rate = await consumeRate(admin, await rateIdentity(request, "inspect"), "inspect_link", 600, 30, 900);
  const rateError = rateReply(rate); if (rateError) return rateError;
  const context = await accessContext(admin, payload.accessToken, request, payload.timezone);
  if (!context) {
    await recordInvalidAccess(admin, request, "invalid_signature_link");
    return reply(404, { error: "signature_access_unavailable" });
  }
  const { link, signer, envelope, document, version } = context;
  const now = new Date().toISOString();
  await admin.from("gp_v2_signature_access_links").update({ access_count: Number(link.access_count) + 1, first_accessed_at: link.first_accessed_at || now, last_accessed_at: now }).eq("id", link.id);
  if (!signer.viewed_at && !["signed", "declined"].includes(signer.status)) await admin.from("gp_v2_signature_signers").update({ status: "viewed", viewed_at: now, updated_at: now }).eq("id", signer.id);
  await appendEvent(admin, request, { organizationId: link.organization_id, envelopeId: envelope.id, signerId: signer.id, eventType: "link.accessed", documentHash: version.sha256, authChannel: "individual_link", tokenFingerprint: link.token_fingerprint, timezone: payload.timezone as string });
  const completed = envelope.status === "signed";
  return reply(200, {
    ok: true, title: document.title, documentCode: document.verification_code, signerName: signer.name,
    signerType: signer.signer_type, signerRole: signer.signer_role, companyLegalName: signer.company_legal_name || "",
    maskedEmail: maskedEmail(signer.email), status: completed ? "completed" : signer.status, envelopeStatus: envelope.status,
    expiresAt: envelope.expires_at, completed, legalNotice: "A validade e a força probatória dependem do documento, da identificação utilizada e das evidências coletadas. Certificado ICP-Brasil não é obrigatório neste fluxo.",
  });
}

async function confirmIdentity(request: Request, payload: Record<string, unknown>, admin: AdminClient) {
  const context = await accessContext(admin, payload.accessToken, request, payload.timezone);
  if (!context) return reply(400, { error: "identity_could_not_be_confirmed" });
  const { signer, envelope, link, version } = context;
  const rate = await consumeRate(admin, `${link.id}|${await rateIdentity(request, "identity")}`, "confirm_identity", 900, 8, 1800);
  const rateError = rateReply(rate); if (rateError) return rateError;
  const cpf = normalizeDigits(payload.cpf);
  const expectedCpf = await hmacSha256(config().dataPepper, `${link.organization_id}|cpf|${cpf}`);
  let valid = cpf.length === 11 && sameHash(expectedCpf, signer.document_hash);
  if (signer.signer_type === "company_representative") {
    const cnpj = normalizeDigits(payload.cnpj);
    const expectedCnpj = await hmacSha256(config().dataPepper, `${link.organization_id}|cnpj|${cnpj}`);
    valid = valid && cnpj.length === 14 && sameHash(expectedCnpj, signer.company_document_hash) && payload.representationDeclared === true;
  }
  const now = new Date().toISOString();
  if (!valid) {
    await appendEvent(admin, request, { organizationId: link.organization_id, envelopeId: envelope.id, signerId: signer.id, eventType: "identity.rejected", result: "rejected", documentHash: version.sha256, authChannel: "individual_link", tokenFingerprint: link.token_fingerprint, timezone: payload.timezone as string });
    return reply(400, { error: "identity_could_not_be_confirmed" });
  }
  await admin.from("gp_v2_signature_signers").update({
    identity_confirmed_at: signer.identity_confirmed_at || now,
    representation_declared: signer.signer_type === "company_representative" ? true : signer.representation_declared,
    representation_declared_at: signer.signer_type === "company_representative" ? now : signer.representation_declared_at,
    status: ["signed", "declined"].includes(signer.status) ? signer.status : "identity_confirmed", updated_at: now,
  }).eq("id", signer.id).eq("organization_id", link.organization_id);
  await appendEvent(admin, request, { organizationId: link.organization_id, envelopeId: envelope.id, signerId: signer.id, eventType: "identity.confirmed", documentHash: version.sha256, authChannel: "individual_link", tokenFingerprint: link.token_fingerprint, timezone: payload.timezone as string, metadata: { signerType: signer.signer_type, representationDeclared: signer.signer_type === "company_representative" } });
  return reply(200, { ok: true, maskedEmail: maskedEmail(signer.email) });
}

async function requestOtp(request: Request, payload: Record<string, unknown>, admin: AdminClient) {
  const context = await accessContext(admin, payload.accessToken, request, payload.timezone);
  if (!context || !context.signer.identity_confirmed_at) return reply(200, { ok: true, message: "Se os dados forem válidos, o código será enviado." });
  const { signer, envelope, link, document, version } = context;
  const [signerRate, ipRate] = await Promise.all([
    consumeRate(admin, signer.id, "request_otp_signer", 3600, 5, 1800),
    consumeRate(admin, await rateIdentity(request, `otp:${signer.id}`), "request_otp_ip", 600, 15, 1800),
  ]);
  const signerRateError = rateReply(signerRate); if (signerRateError) return signerRateError;
  const ipRateError = rateReply(ipRate); if (ipRateError) return ipRateError;
  const challengeId = crypto.randomUUID();
  const code = randomOtp();
  const codeHash = await hmacSha256(config().otpPepper, `${challengeId}|${code}`);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const ipHash = await hmacSha256(config().dataPepper, `ip|${requestIp(request) || "unknown"}`);
  const userAgentHash = await sha256(request.headers.get("user-agent") || "");
  await admin.from("gp_v2_signature_otp_challenges").update({ status: "invalidated", invalidated_at: now }).eq("organization_id", link.organization_id).eq("signer_id", signer.id).eq("status", "pending");
  const { error: insertError } = await admin.from("gp_v2_signature_otp_challenges").insert({
    id: challengeId, organization_id: link.organization_id, envelope_id: envelope.id, signer_id: signer.id, access_link_id: link.id,
    code_hash: codeHash, expires_at: expiresAt, request_ip_hash: ipHash, request_user_agent_hash: userAgentHash,
  });
  if (insertError) return reply(503, { error: "otp_temporarily_unavailable" });
  await appendEvent(admin, request, { organizationId: link.organization_id, envelopeId: envelope.id, signerId: signer.id, eventType: "otp.requested", documentHash: version.sha256, authChannel: "email_otp", tokenFingerprint: link.token_fingerprint, timezone: payload.timezone as string, metadata: { expiresInSeconds: 600 } });
  try {
    const messageId = await sendEmail(signer.email, `Código de assinatura: ${document.title}`, `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#252525"><h2>Confirmação de assinatura</h2><p>Olá, ${escapeHtml(signer.name)}.</p><p>Seu código temporário é:</p><p style="font-size:30px;letter-spacing:8px;font-weight:bold">${code}</p><p>Ele expira em 10 minutos. Não compartilhe este código.</p></div>`, `signature-otp/${challengeId}`);
    await admin.from("gp_v2_signature_otp_challenges").update({ sent_at: new Date().toISOString(), provider_message_id_hash: await sha256(messageId) }).eq("id", challengeId);
    await admin.from("gp_v2_signature_email_deliveries").upsert({ organization_id: link.organization_id, envelope_id: envelope.id, signer_id: signer.id, message_type: "otp", provider: "resend", provider_message_id_hash: await sha256(messageId), delivery_status: "sent" }, { onConflict: "organization_id,provider,provider_message_id_hash" });
    await appendEvent(admin, request, { organizationId: link.organization_id, envelopeId: envelope.id, signerId: signer.id, eventType: "otp.sent", documentHash: version.sha256, authChannel: "email_otp", tokenFingerprint: link.token_fingerprint, timezone: payload.timezone as string, metadata: { expiresInSeconds: 600 } });
    return reply(200, { ok: true, challengeId, expiresIn: 600, maskedEmail: maskedEmail(signer.email) });
  } catch {
    await admin.from("gp_v2_signature_otp_challenges").update({ status: "delivery_failed" }).eq("id", challengeId);
    await appendEvent(admin, request, { organizationId: link.organization_id, envelopeId: envelope.id, signerId: signer.id, eventType: "otp.delivery_failed", result: "failed", documentHash: version.sha256, authChannel: "email_otp", tokenFingerprint: link.token_fingerprint, timezone: payload.timezone as string });
    return reply(503, { error: "otp_temporarily_unavailable" });
  }
}

async function verifyOtp(request: Request, payload: Record<string, unknown>, admin: AdminClient) {
  const context = await accessContext(admin, payload.accessToken, request, payload.timezone);
  const challengeId = String(payload.challengeId || "");
  const code = normalizeDigits(payload.code);
  if (!context || !/^[0-9a-f-]{36}$/i.test(challengeId) || code.length !== 6) return reply(400, { error: "otp_invalid_or_expired" });
  const { signer, envelope, link, version } = context;
  const rate = await consumeRate(admin, `${signer.id}|${await rateIdentity(request, "verify_otp")}`, "verify_otp", 900, 12, 1800);
  const rateError = rateReply(rate); if (rateError) return rateError;
  const { data: challenge } = await admin.from("gp_v2_signature_otp_challenges").select("id").eq("id", challengeId).eq("organization_id", link.organization_id).eq("signer_id", signer.id).eq("access_link_id", link.id).maybeSingle();
  if (!challenge) return reply(400, { error: "otp_invalid_or_expired" });
  const codeHash = await hmacSha256(config().otpPepper, `${challengeId}|${code}`);
  const lockedUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const { data, error } = await admin.rpc("gp_v2_verify_signature_otp", { p_challenge_id: challengeId, p_code_hash: codeHash, p_locked_until: lockedUntil });
  const result = Array.isArray(data) ? data[0] : data;
  if (error || result?.verification_result !== "verified") {
    await appendEvent(admin, request, { organizationId: link.organization_id, envelopeId: envelope.id, signerId: signer.id, eventType: "otp.rejected", result: String(result?.verification_result || "rejected"), documentHash: version.sha256, authChannel: "email_otp", tokenFingerprint: link.token_fingerprint, timezone: payload.timezone as string });
    return reply(400, { error: "otp_invalid_or_expired" });
  }
  const sessionToken = randomToken(32);
  const sessionHash = await hmacSha256(config().tokenPepper, `session|${sessionToken}`);
  const sessionFingerprint = (await sha256(sessionToken)).slice(0, 16);
  const ipHash = await hmacSha256(config().dataPepper, `ip|${requestIp(request) || "unknown"}`);
  const userAgentHash = await sha256(request.headers.get("user-agent") || "");
  const now = new Date().toISOString();
  await admin.from("gp_v2_signature_sessions").insert({
    organization_id: link.organization_id, envelope_id: envelope.id, signer_id: signer.id, session_hash: sessionHash,
    session_fingerprint: sessionFingerprint, expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), ip_hash: ipHash, user_agent_hash: userAgentHash,
  });
  await admin.from("gp_v2_signature_signers").update({ otp_verified_at: now, status: ["signed", "declined"].includes(signer.status) ? signer.status : "otp_verified", updated_at: now }).eq("id", signer.id);
  await appendEvent(admin, request, { organizationId: link.organization_id, envelopeId: envelope.id, signerId: signer.id, eventType: "otp.validated", documentHash: version.sha256, authChannel: "email_otp", tokenFingerprint: link.token_fingerprint, timezone: payload.timezone as string, metadata: { sessionFingerprint } });
  return reply(200, { ok: true, sessionToken, expiresIn: 7200, completed: envelope.status === "signed" });
}

async function getDocument(request: Request, payload: Record<string, unknown>, admin: AdminClient) {
  const context = await sessionContext(admin, payload.sessionToken, request);
  if (!context) return reply(401, { error: "session_invalid_or_expired" });
  const { session, signer, envelope, document, version } = context;
  const now = new Date().toISOString();
  const [{ data: envelopeDocuments }, { data: privacy }, { data: consent }, { data: finalArtifact }] = await Promise.all([
    admin.from("gp_v2_signature_envelope_documents").select("id,display_order,required,document_id,document_version_id,gp_v2_documents(title,verification_code),gp_v2_document_versions(file_name,storage_path,sha256)").eq("organization_id", session.organization_id).eq("envelope_id", envelope.id).order("display_order"),
    admin.from("gp_v2_signature_privacy_notices").select("version,title,content").eq("organization_id", session.organization_id).eq("version", document.privacy_notice_version).maybeSingle(),
    admin.from("gp_v2_signature_consent_texts").select("id,version,content,content_sha256").eq("organization_id", session.organization_id).eq("version", envelope.consent_text_version).maybeSingle(),
    admin.from("gp_v2_signature_artifacts").select("id").eq("organization_id", session.organization_id).eq("envelope_id", envelope.id).eq("artifact_kind", "signed_pdf").maybeSingle(),
  ]);
  const publicDocuments = await Promise.all((envelopeDocuments || []).map(async (item: any) => {
    const doc = Array.isArray(item.gp_v2_documents) ? item.gp_v2_documents[0] : item.gp_v2_documents;
    const itemVersion = Array.isArray(item.gp_v2_document_versions) ? item.gp_v2_document_versions[0] : item.gp_v2_document_versions;
    const { data } = await admin.storage.from(bucketName).createSignedUrl(itemVersion?.storage_path || "", 300);
    return { id: item.id, documentId: item.document_id, documentVersionId: item.document_version_id, title: doc?.title || "Documento", code: doc?.verification_code || "", fileName: itemVersion?.file_name || "", sha256: itemVersion?.sha256 || "", required: item.required !== false, signedUrl: data?.signedUrl || "" };
  }));
  if (!publicDocuments.length || publicDocuments.some((item) => !item.signedUrl) || !privacy || !consent) return reply(503, { error: "document_temporarily_unavailable" });
  if (!session.document_viewed_at) await appendEvent(admin, request, { organizationId: session.organization_id, envelopeId: envelope.id, signerId: signer.id, eventType: "document.presented", documentHash: version.sha256, authChannel: "authenticated_session", tokenFingerprint: session.session_fingerprint, timezone: payload.timezone as string, metadata: { documentCount: publicDocuments.length } });
  return reply(200, {
    ok: true, title: document.title, documentCode: document.verification_code, documentUrl: publicDocuments[0].signedUrl, documents: publicDocuments, urlExpiresIn: 300,
    originalSha256: version.sha256, privacyNotice: privacy, consentText: consent, status: envelope.status,
    canSign: !["signed", "declined", "expired", "cancelled", "superseded"].includes(envelope.status) && signer.status !== "signed",
    finalAvailable: !!finalArtifact,
  });
}

async function acceptConsent(request: Request, payload: Record<string, unknown>, admin: AdminClient) {
  const context = await sessionContext(admin, payload.sessionToken, request);
  if (!context || payload.accepted !== true) return reply(400, { error: "express_consent_required" });
  const { session, signer, envelope, version } = context;
  const viewedVersionIds = Array.isArray(payload.viewedDocumentVersionIds) ? payload.viewedDocumentVersionIds.map(String) : [];
  const { data: requiredDocuments } = await admin.from("gp_v2_signature_envelope_documents").select("document_version_id").eq("organization_id", session.organization_id).eq("envelope_id", envelope.id).eq("required", true);
  if (!signer.otp_verified_at || !requiredDocuments?.length || requiredDocuments.some((item: any) => !viewedVersionIds.includes(String(item.document_version_id)))) return reply(409, { error: "document_reading_and_otp_required" });
  const { data: consentText } = await admin.from("gp_v2_signature_consent_texts").select("id,version,content_sha256").eq("organization_id", session.organization_id).eq("version", envelope.consent_text_version).maybeSingle();
  if (!consentText || String(payload.consentVersion || "") !== consentText.version) return reply(409, { error: "consent_version_changed" });
  const existing = await admin.from("gp_v2_signature_consents").select("id").eq("organization_id", session.organization_id).eq("envelope_id", envelope.id).eq("signer_id", signer.id).maybeSingle();
  if (existing.data) return reply(200, { ok: true, consentId: existing.data.id, idempotent: true });
  const now = new Date().toISOString();
  const timezone = safeTimezone(payload.timezone);
  const ip = requestIp(request);
  const ipHash = await hmacSha256(config().dataPepper, `ip|${ip || "unknown"}`);
  const { data: inserted, error } = await admin.from("gp_v2_signature_consents").insert({
    organization_id: session.organization_id, envelope_id: envelope.id, signer_id: signer.id, document_version_id: version.id,
    consent_text_id: consentText.id, consent_text_version: consentText.version, consent_text_sha256: consentText.content_sha256, document_manifest_sha256: envelope.document_manifest_sha256 || "",
    accepted_at: now, ip_address: ip || null, ip_hash: ipHash, user_agent: String(request.headers.get("user-agent") || "").slice(0, 1000),
    presented_timezone: timezone, local_accepted_at: localDateTime(now, timezone),
  }).select("id").single();
  if (error || !inserted) return reply(409, { error: "consent_could_not_be_recorded" });
  await admin.from("gp_v2_signature_sessions").update({ document_viewed_at: now }).eq("id", session.id);
  await admin.from("gp_v2_signature_signers").update({ consented_at: now, status: "consented", updated_at: now }).eq("id", signer.id);
  await appendEvent(admin, request, { organizationId: session.organization_id, envelopeId: envelope.id, signerId: signer.id, eventType: "consent.accepted", documentHash: version.sha256, authChannel: "authenticated_session", tokenFingerprint: session.session_fingerprint, timezone, metadata: { consentVersion: consentText.version, consentSha256: consentText.content_sha256, documentCount: requiredDocuments.length } });
  return reply(200, { ok: true, consentId: inserted.id });
}

function wrapText(text: string, maxCharacters = 92) {
  const words = String(text || "").replace(/[\r\n]+/g, " ").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (`${line} ${word}`.trim().length > maxCharacters && line) { lines.push(line); line = word; } else line = `${line} ${word}`.trim();
  }
  if (line) lines.push(line);
  return lines;
}

async function createEvidencePdf(title: string, sections: Array<{ heading: string; lines: string[] }>) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page = pdf.addPage([595.28, 841.89]);
  let y = 800;
  const addLine = (text: string, size = 9, isBold = false, color = rgb(0.12, 0.12, 0.12)) => {
    if (y < 55) { page = pdf.addPage([595.28, 841.89]); y = 800; }
    page.drawText(text.replace(/[^\x20-\xFF]/g, "?"), { x: 45, y, size, font: isBold ? bold : regular, color });
    y -= size + 5;
  };
  addLine(title, 16, true, rgb(0.10, 0.31, 0.27));
  y -= 8;
  for (const section of sections) {
    addLine(section.heading, 11, true);
    for (const item of section.lines) for (const line of wrapText(item)) addLine(line, 8.5);
    y -= 6;
  }
  return new Uint8Array(await pdf.save());
}

async function uploadImmutable(bucket: any, path: string, bytes: Uint8Array, expectedHash: string) {
  const upload = await bucket.upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (!upload.error) return;
  const existing = await bucket.download(path);
  if (existing.error || !existing.data || await sha256(await existing.data.arrayBuffer()) !== expectedHash) throw new Error("immutable_artifact_conflict");
}

async function persistImmutableArtifact(admin: AdminClient, row: Record<string, unknown>) {
  const { error } = await admin.from("gp_v2_signature_artifacts").insert(row);
  if (!error) return;
  const { data: existing } = await admin.from("gp_v2_signature_artifacts").select("sha256,storage_path").eq("organization_id", row.organization_id).eq("envelope_id", row.envelope_id).eq("artifact_kind", row.artifact_kind).maybeSingle();
  if (!existing || existing.sha256 !== row.sha256 || existing.storage_path !== row.storage_path) throw new Error("immutable_artifact_metadata_conflict");
}

async function finalizeEnvelope(request: Request, admin: AdminClient, context: any, completionAt: string) {
  const { session, envelope, document, version } = context;
  const organizationId = session.organization_id;
  const { data: existingArtifacts } = await admin.from("gp_v2_signature_artifacts").select("artifact_kind,sha256").eq("organization_id", organizationId).eq("envelope_id", envelope.id).in("artifact_kind", ["signed_pdf", "evidence_report"]);
  const existingFinal = existingArtifacts?.find((item: any) => item.artifact_kind === "signed_pdf");
  const existingReport = existingArtifacts?.find((item: any) => item.artifact_kind === "evidence_report");
  if (existingFinal && existingReport) {
    await admin.from("gp_v2_signature_envelopes").update({ status: "signed", completed_at: completionAt, last_error_code: "", updated_at: completionAt }).eq("id", envelope.id).eq("organization_id", organizationId);
    await admin.from("gp_v2_documents").update({ status: "signed", completed_at: completionAt, updated_at: completionAt }).eq("id", document.id).eq("organization_id", organizationId);
    const { data: completedEvent } = await admin.from("gp_v2_signature_events").select("id").eq("organization_id", organizationId).eq("envelope_id", envelope.id).eq("event_type", "process.completed").limit(1).maybeSingle();
    if (!completedEvent) await appendEvent(admin, request, { organizationId, envelopeId: envelope.id, eventType: "process.completed", actorType: "system", documentHash: existingFinal.sha256, authChannel: "system", timezone: "America/Sao_Paulo", occurredAt: completionAt, metadata: { recovered: true, finalSha256: existingFinal.sha256, evidenceReportSha256: existingReport.sha256 } });
    return { finalHash: existingFinal.sha256, reportHash: existingReport.sha256 };
  }
  const [{ data: original }, { data: signers }, { data: events }, { data: actions }, { data: fields }, { data: envelopeDocuments }] = await Promise.all([
    admin.storage.from(bucketName).download(version.storage_path),
    admin.from("gp_v2_signature_signers").select("id,name,email,signer_role,signer_type,company_legal_name,job_title,document_last4,authentication_methods,signed_at").eq("organization_id", organizationId).eq("envelope_id", envelope.id).order("signing_order"),
    admin.from("gp_v2_signature_events").select("sequence_number,event_type,occurred_at,local_occurred_at,presented_timezone,ip_address,result,auth_channel,event_hash").eq("organization_id", organizationId).eq("envelope_id", envelope.id).order("sequence_number"),
    admin.from("gp_v2_signature_actions").select("signer_id,signed_at,signature_method,document_sha256").eq("organization_id", organizationId).eq("envelope_id", envelope.id),
    admin.from("gp_v2_signature_fields").select("signer_id,field_type,page_number,x_ratio,y_ratio,width_ratio,height_ratio").eq("organization_id", organizationId).eq("envelope_id", envelope.id).eq("document_version_id", version.id),
    admin.from("gp_v2_signature_envelope_documents").select("id,display_order,document_version_id,gp_v2_document_versions(storage_path)").eq("organization_id", organizationId).eq("envelope_id", envelope.id).order("display_order"),
  ]);
  if (!original || !signers || !events || !actions) throw new Error("finalization_inputs_missing");
  const originalBytes = new Uint8Array(await original.arrayBuffer());
  const pdf = await PDFDocument.load(originalBytes);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const signerById = new Map((signers || []).map((item: any) => [item.id, item]));
  for (const field of fields || []) {
    const page = pdf.getPages()[Number(field.page_number) - 1];
    const signer = signerById.get(field.signer_id) as any;
    if (!page || !signer) continue;
    const { width, height } = page.getSize();
    const x = Number(field.x_ratio) * width, boxWidth = Number(field.width_ratio) * width, boxHeight = Number(field.height_ratio) * height;
    const y = height - (Number(field.y_ratio) + Number(field.height_ratio)) * height;
    const signedAt = signer.signed_at ? localDateTime(signer.signed_at, "America/Sao_Paulo") : localDateTime(completionAt, "America/Sao_Paulo");
    const label = field.field_type === "signed_at" ? signedAt : field.field_type === "signer_name" ? signer.name : `Assinado eletronicamente\n${signer.name}\n${signedAt}\n${document.verification_code}`;
    page.drawRectangle({ x, y, width: boxWidth, height: boxHeight, borderColor: rgb(0.16, 0.37, 0.32), borderWidth: 0.8, color: rgb(0.96, 0.98, 0.97), opacity: 0.92 });
    const lines = label.split("\n");
    lines.slice(0, 4).forEach((line: string, index: number) => page.drawText(line.slice(0, 90), { x: x + 4, y: y + boxHeight - 12 - index * 10, size: Math.max(6, Math.min(9, boxHeight / 5)), font, color: rgb(0.08, 0.20, 0.17) }));
  }
  const certificateBytes = await createEvidencePdf("Certificado de assinaturas eletrônicas", [
    { heading: "Documento", lines: [`Código: ${document.verification_code}`, `Nome: ${document.title}`, `Hash SHA-256 original: ${version.sha256}`, `Conclusão: ${localDateTime(completionAt, "America/Sao_Paulo")} (UTC: ${completionAt})`, `Verificação: ${config().verificationUrl}?codigo=${document.verification_code}`] },
    { heading: "Signatários", lines: signers.map((item: any) => `${item.name} | ${item.signer_role} | CPF ${maskedCpf(item.document_last4)} | ${item.email} | autenticação: link individual + OTP por e-mail + aceite expresso | assinatura: ${item.signed_at || completionAt}`) },
    { heading: "Observação jurídica", lines: ["Esta assinatura eletrônica reúne identificação, autenticação, manifestação expressa, integridade e evidências técnicas. Sua validade e força probatória dependem do tipo de documento, do método utilizado e das circunstâncias do caso. Não se trata de assinatura qualificada ICP-Brasil."] },
    { heading: "Sistema", lines: ["GP Mirari — provedor interno de coleta de evidências de assinatura eletrônica."] },
  ]);
  const certificate = await PDFDocument.load(certificateBytes);
  const certificatePages = await pdf.copyPages(certificate, certificate.getPageIndices());
  certificatePages.forEach((page) => pdf.addPage(page));
  const finalBytes = new Uint8Array(await pdf.save());
  const finalHash = await sha256(finalBytes);
  const timeline = events.map((event: any) => `#${event.sequence_number} ${event.occurred_at} | ${event.event_type} | ${event.result} | IP ${event.ip_address || "não disponível"} | canal ${event.auth_channel || "n/a"} | hash do evento ${event.event_hash || "legado"}`);
  timeline.push(`#${events.length + 1} ${completionAt} | process.completed | success | finalização do documento`);
  const reportBytes = await createEvidencePdf("Relatório de evidências de assinatura", [
    { heading: "Identificação e integridade", lines: [`Código único: ${document.verification_code}`, `Documento: ${document.title}`, `Status: Concluído`, `Criado em: ${document.created_at}`, `Concluído em: ${completionAt}`, `SHA-256 original: ${version.sha256}`, `SHA-256 final: ${finalHash}`, `Verificação: ${config().verificationUrl}?codigo=${document.verification_code}`] },
    { heading: "Signatários", lines: signers.map((item: any) => `${item.name} | ${item.signer_role} | CPF ${maskedCpf(item.document_last4)} | ${item.signer_type === "company_representative" ? `${item.company_legal_name}, ${item.job_title}` : "Pessoa física"} | método: link individual, OTP por e-mail, aceite expresso | UTC: ${item.signed_at || completionAt}`) },
    { heading: "Resumo cronológico das evidências", lines: timeline },
    { heading: "Responsável pela coleta", lines: ["GP Mirari — provedor interno de assinatura eletrônica e coleta de evidências técnicas.", "O relatório não contém códigos OTP, tokens, segredos ou credenciais."] },
  ]);
  const reportHash = await sha256(reportBytes);
  const basePath = `${organizationId}/${document.id}/${envelope.id}/final`;
  const finalPath = `${basePath}/documento-concluido.pdf`;
  const reportPath = `${basePath}/relatorio-evidencias.pdf`;
  const bucket = admin.storage.from(bucketName);
  await uploadImmutable(bucket, finalPath, finalBytes, finalHash);
  await uploadImmutable(bucket, reportPath, reportBytes, reportHash);
  // Every PDF in a folder receives an immutable final copy. The legacy signed_pdf
  // artifact remains the primary-document compatibility download.
  for (const item of envelopeDocuments || []) {
    const itemVersion = Array.isArray((item as any).gp_v2_document_versions) ? (item as any).gp_v2_document_versions[0] : (item as any).gp_v2_document_versions;
    let itemPath = finalPath, itemHash = finalHash;
    if (String((item as any).document_version_id) !== String(version.id)) {
      const { data: itemOriginal } = await bucket.download(itemVersion?.storage_path || "");
      if (!itemOriginal) throw new Error("envelope_document_download_failed");
      const itemPdf = await PDFDocument.load(new Uint8Array(await itemOriginal.arrayBuffer()));
      const itemCertificatePages = await itemPdf.copyPages(certificate, certificate.getPageIndices());
      itemCertificatePages.forEach((page) => itemPdf.addPage(page));
      const itemBytes = new Uint8Array(await itemPdf.save());
      itemHash = await sha256(itemBytes);
      itemPath = `${basePath}/documento-${String((item as any).display_order).padStart(2, "0")}-concluido.pdf`;
      await uploadImmutable(bucket, itemPath, itemBytes, itemHash);
    }
    const { error: itemFinalError } = await admin.from("gp_v2_signature_envelope_documents").update({ final_storage_path: itemPath, final_sha256: itemHash, finalized_at: completionAt, updated_at: completionAt }).eq("id", (item as any).id).eq("organization_id", organizationId);
    if (itemFinalError) throw new Error("envelope_document_final_persist_failed");
  }
  await persistImmutableArtifact(admin, { organization_id: organizationId, envelope_id: envelope.id, artifact_kind: "signed_pdf", storage_path: finalPath, content_type: "application/pdf", size_bytes: finalBytes.byteLength, sha256: finalHash });
  await persistImmutableArtifact(admin, { organization_id: organizationId, envelope_id: envelope.id, artifact_kind: "evidence_report", storage_path: reportPath, content_type: "application/pdf", size_bytes: reportBytes.byteLength, sha256: reportHash });
  const { error: envelopeError } = await admin.from("gp_v2_signature_envelopes").update({ status: "signed", completed_at: completionAt, last_error_code: "", updated_at: completionAt }).eq("id", envelope.id).eq("organization_id", organizationId);
  const { error: documentError } = await admin.from("gp_v2_documents").update({ status: "signed", completed_at: completionAt, updated_at: completionAt }).eq("id", document.id).eq("organization_id", organizationId);
  if (envelopeError || documentError) throw new Error("final_status_persist_failed");
  await appendEvent(admin, request, { organizationId, envelopeId: envelope.id, eventType: "process.completed", actorType: "system", documentHash: finalHash, authChannel: "system", timezone: "America/Sao_Paulo", occurredAt: completionAt, metadata: { originalSha256: version.sha256, finalSha256: finalHash, evidenceReportSha256: reportHash } });
  const { data: finalUrl } = await bucket.createSignedUrl(finalPath, 86400);
  if (finalUrl?.signedUrl) {
    for (const signer of signers) {
      try {
        await sendEmail(signer.email, `Documento concluído: ${document.title}`, `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#252525"><h2>Documento concluído</h2><p>Olá, ${escapeHtml(signer.name)}.</p><p>O processo de assinatura foi concluído. Todas as partes recebem a mesma versão do arquivo.</p><p><a href="${escapeHtml(finalUrl.signedUrl)}" style="display:inline-block;background:#285f52;color:#fff;padding:12px 18px;border-radius:7px;text-decoration:none">Baixar documento concluído</a></p><p>O acesso acima expira em 24 horas. Código de verificação: <strong>${escapeHtml(document.verification_code)}</strong>.</p></div>`, `signature-completed/${envelope.id}/${signer.id}`);
      } catch { /* Delivery failure is monitored without changing the signed document. */ }
    }
  }
  return { finalHash, reportHash };
}

async function retryFinalization(request: Request, payload: Record<string, unknown>, admin: AdminClient) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const url = Deno.env.get("SUPABASE_URL") || "";
  const requester = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: { user } } = await requester.auth.getUser();
  const organizationId = String(payload.organizationId || "");
  const envelopeId = String(payload.envelopeId || "");
  if (!user || !/^[0-9a-f-]{36}$/i.test(organizationId) || !/^[0-9a-f-]{36}$/i.test(envelopeId)) return reply(401, { error: "unauthenticated" });
  const { data: membership } = await admin.from("gp_v2_memberships").select("role,status").eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle();
  if (membership?.status !== "active" || !["owner", "admin", "manager"].includes(membership.role)) return reply(403, { error: "signature_manager_role_required" });
  const { data: envelope } = await admin.from("gp_v2_signature_envelopes").select("*").eq("id", envelopeId).eq("organization_id", organizationId).eq("provider", "internal").maybeSingle();
  if (!envelope || !["finalizing", "signed"].includes(envelope.status)) return reply(409, { error: "envelope_not_ready_for_finalization" });
  const [{ data: document }, { data: version }, { data: signers }] = await Promise.all([
    admin.from("gp_v2_documents").select("*").eq("id", envelope.document_id).eq("organization_id", organizationId).maybeSingle(),
    admin.from("gp_v2_document_versions").select("*").eq("id", envelope.document_version_id).eq("organization_id", organizationId).maybeSingle(),
    admin.from("gp_v2_signature_signers").select("status,signed_at").eq("envelope_id", envelopeId).eq("organization_id", organizationId),
  ]);
  if (!document || !version || !signers?.length || signers.some((item: any) => item.status !== "signed")) return reply(409, { error: "envelope_not_ready_for_finalization" });
  const completionAt = signers.map((item: any) => item.signed_at).filter(Boolean).sort().at(-1) || new Date().toISOString();
  const context = { session: { organization_id: organizationId }, envelope, document, version };
  try {
    const result = await finalizeEnvelope(request, admin, context, completionAt);
    await admin.from("gp_v2_signature_jobs").update({ status: "completed", completed_at: new Date().toISOString(), last_error_code: "" }).eq("organization_id", organizationId).eq("deduplication_key", `internal-finalize:${envelopeId}`);
    return reply(200, { ok: true, status: "completed", finalSha256: result.finalHash });
  } catch (error) {
    const code = String(error instanceof Error ? error.message : "finalization_failed").slice(0, 100);
    await admin.from("gp_v2_signature_envelopes").update({ last_error_code: code, updated_at: new Date().toISOString() }).eq("id", envelopeId).eq("organization_id", organizationId);
    return reply(500, { error: "finalization_failed", code });
  }
}

async function signDocument(request: Request, payload: Record<string, unknown>, admin: AdminClient) {
  const context = await sessionContext(admin, payload.sessionToken, request);
  if (!context) return reply(401, { error: "session_invalid_or_expired" });
  const { session, signer, envelope, version } = context;
  if (["signed", "declined", "expired", "cancelled", "superseded"].includes(envelope.status)) return reply(409, { error: "signature_process_closed" });
  const { data: consent } = await admin.from("gp_v2_signature_consents").select("id").eq("organization_id", session.organization_id).eq("envelope_id", envelope.id).eq("signer_id", signer.id).maybeSingle();
  if (!consent || !signer.consented_at || !session.document_viewed_at) return reply(409, { error: "express_consent_required" });
  const now = new Date().toISOString();
  const timezone = safeTimezone(payload.timezone);
  const ip = requestIp(request);
  const ipHash = await hmacSha256(config().dataPepper, `ip|${ip || "unknown"}`);
  const visualHash = await sha256(`${signer.name}|${version.sha256}|${consent.id}|${now}`);
  const { error: actionError } = await admin.from("gp_v2_signature_actions").insert({
    organization_id: session.organization_id, envelope_id: envelope.id, signer_id: signer.id, document_version_id: version.id,
    consent_id: consent.id, signature_method: "electronic_action", visual_representation: "typed_name", visual_representation_sha256: visualHash,
    signed_at: now, ip_address: ip || null, ip_hash: ipHash, user_agent: String(request.headers.get("user-agent") || "").slice(0, 1000),
    presented_timezone: timezone, local_signed_at: localDateTime(now, timezone), document_sha256: version.sha256, document_manifest_sha256: envelope.document_manifest_sha256 || "",
  });
  if (actionError && !String(actionError.code || "").includes("23505")) return reply(409, { error: "signature_could_not_be_recorded" });
  const { data, error } = await admin.rpc("gp_v2_mark_internal_signature", { p_organization_id: session.organization_id, p_envelope_id: envelope.id, p_signer_id: signer.id, p_signed_at: now });
  if (error) return reply(409, { error: "signature_process_closed" });
  const result = Array.isArray(data) ? data[0] : data;
  await appendEvent(admin, request, { organizationId: session.organization_id, envelopeId: envelope.id, signerId: signer.id, eventType: "signature.completed", documentHash: version.sha256, authChannel: "authenticated_session", tokenFingerprint: session.session_fingerprint, timezone, occurredAt: now, metadata: { method: "electronic_action", visualRepresentation: "typed_name" } });
  await admin.from("gp_v2_signature_sessions").update({ status: "completed" }).eq("id", session.id);
  let finalHash = "";
  if (result?.should_finalize) {
    try {
      const finalized = await finalizeEnvelope(request, admin, context, now);
      finalHash = finalized.finalHash;
    } catch (error) {
      const code = String(error instanceof Error ? error.message : "finalization_failed").slice(0, 100);
      await admin.from("gp_v2_signature_envelopes").update({ last_error_code: code, updated_at: new Date().toISOString() }).eq("id", envelope.id).eq("organization_id", session.organization_id);
      await admin.from("gp_v2_signature_jobs").upsert({ organization_id: session.organization_id, job_type: "finalize_internal", deduplication_key: `internal-finalize:${envelope.id}`, status: "pending", payload: { envelopeId: envelope.id }, last_error_code: code }, { onConflict: "organization_id,deduplication_key" });
      return reply(202, { ok: true, status: "finalizing", message: "Assinatura registrada. O documento final está sendo preparado." });
    }
  }
  return reply(200, { ok: true, status: result?.should_finalize ? "completed" : "partially_signed", finalSha256: finalHash || undefined });
}

async function declineDocument(request: Request, payload: Record<string, unknown>, admin: AdminClient) {
  const context = await sessionContext(admin, payload.sessionToken, request);
  if (!context) return reply(401, { error: "session_invalid_or_expired" });
  const { session, signer, envelope, document, version } = context;
  if (["signed", "declined", "expired", "cancelled", "superseded"].includes(envelope.status)) return reply(409, { error: "signature_process_closed" });
  const now = new Date().toISOString();
  const reason = String(payload.reason || "").trim().slice(0, 500);
  await admin.from("gp_v2_signature_signers").update({ status: "declined", declined_at: now, updated_at: now }).eq("id", signer.id).eq("organization_id", session.organization_id);
  await admin.from("gp_v2_signature_envelopes").update({ status: "declined", completed_at: now, updated_at: now }).eq("id", envelope.id).eq("organization_id", session.organization_id);
  await admin.from("gp_v2_documents").update({ status: "declined", completed_at: now, updated_at: now }).eq("id", document.id).eq("organization_id", session.organization_id);
  await admin.from("gp_v2_signature_sessions").update({ status: "revoked", revoked_at: now }).eq("organization_id", session.organization_id).eq("envelope_id", envelope.id).eq("status", "active");
  await appendEvent(admin, request, { organizationId: session.organization_id, envelopeId: envelope.id, signerId: signer.id, eventType: "document.declined", result: "declined", documentHash: version.sha256, authChannel: "authenticated_session", tokenFingerprint: session.session_fingerprint, timezone: payload.timezone as string, metadata: { reasonProvided: !!reason, reason } });
  return reply(200, { ok: true, status: "declined" });
}

async function downloadFinal(request: Request, payload: Record<string, unknown>, admin: AdminClient) {
  const context = await sessionContext(admin, payload.sessionToken, request);
  if (!context || context.envelope.status !== "signed") return reply(404, { error: "final_document_unavailable" });
  const { data: artifact } = await admin.from("gp_v2_signature_artifacts").select("storage_path,sha256").eq("organization_id", context.session.organization_id).eq("envelope_id", context.envelope.id).eq("artifact_kind", "signed_pdf").maybeSingle();
  if (!artifact) return reply(404, { error: "final_document_unavailable" });
  const { data: signed } = await admin.storage.from(bucketName).createSignedUrl(artifact.storage_path, 300);
  if (!signed?.signedUrl) return reply(503, { error: "final_document_unavailable" });
  await appendEvent(admin, request, { organizationId: context.session.organization_id, envelopeId: context.envelope.id, signerId: context.signer.id, eventType: "final_document.downloaded", documentHash: artifact.sha256, authChannel: "authenticated_session", tokenFingerprint: context.session.session_fingerprint, timezone: payload.timezone as string });
  return reply(200, { ok: true, signedUrl: signed.signedUrl, expiresIn: 300, sha256: artifact.sha256 });
}

async function downloadFinalBundle(request: Request, payload: Record<string, unknown>, admin: AdminClient) {
  const context = await sessionContext(admin, payload.sessionToken, request);
  if (!context || context.envelope.status !== "signed") return reply(404, { error: "final_document_unavailable" });
  const { data: documents } = await admin.from("gp_v2_signature_envelope_documents")
    .select("id,display_order,final_storage_path,final_sha256,gp_v2_documents(title)")
    .eq("organization_id", context.session.organization_id).eq("envelope_id", context.envelope.id).not("final_storage_path", "eq", "").order("display_order").limit(10);
  if (!documents?.length) return reply(404, { error: "final_document_unavailable" });
  let total = 0;
  const files: Record<string, Uint8Array> = {};
  for (const item of documents) {
    const { data: content, error } = await admin.storage.from(bucketName).download(String(item.final_storage_path));
    if (error || !content) return reply(503, { error: "final_document_unavailable" });
    const bytes = new Uint8Array(await content.arrayBuffer()); total += bytes.byteLength;
    if (total > 40 * 1024 * 1024) return reply(413, { error: "final_bundle_too_large" });
    const itemDocument = Array.isArray((item as any).gp_v2_documents) ? (item as any).gp_v2_documents[0] : (item as any).gp_v2_documents;
    const name = String(itemDocument?.title || `documento-${item.display_order}`).normalize("NFKD").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || `documento-${item.display_order}`;
    files[`${String(item.display_order).padStart(2, "0")}-${name}.pdf`] = bytes;
  }
  const { data: report } = await admin.from("gp_v2_signature_artifacts").select("storage_path").eq("organization_id", context.session.organization_id).eq("envelope_id", context.envelope.id).eq("artifact_kind", "evidence_report").maybeSingle();
  if (report?.storage_path) {
    const { data: content } = await admin.storage.from(bucketName).download(report.storage_path);
    if (content) files["relatorio-evidencias.pdf"] = new Uint8Array(await content.arrayBuffer());
  }
  const zip = zipSync(files, { level: 6 });
  await appendEvent(admin, request, { organizationId: context.session.organization_id, envelopeId: context.envelope.id, signerId: context.signer.id, eventType: "final_document.bundle_downloaded", documentHash: context.envelope.document_manifest_sha256 || "", authChannel: "authenticated_session", tokenFingerprint: context.session.session_fingerprint, timezone: payload.timezone as string, metadata: { documentCount: documents.length } });
  const fileName = `gp-mirari-documentos-${String(context.document.verification_code || "assinados").replace(/[^A-Z0-9-]/gi, "")}.zip`;
  return new Response(zip, { status: 200, headers: { ...cors, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${fileName}"` } });
}

async function verifyDocument(request: Request, payload: Record<string, unknown>, admin: AdminClient) {
  const rate = await consumeRate(admin, await rateIdentity(request, "verify_document"), "verify_document", 600, 30, 900);
  const rateError = rateReply(rate); if (rateError) return rateError;
  const code = String(payload.code || "").trim().toUpperCase();
  if (!/^GP-[A-F0-9]{24}$/.test(code)) return reply(404, { error: "document_not_found" });
  const { data: document } = await admin.from("gp_v2_documents").select("id,organization_id,title,status,created_at,completed_at,current_version_id,verification_code").eq("verification_code", code).maybeSingle();
  if (!document) return reply(404, { error: "document_not_found" });
  const [{ data: version }, { data: envelope }] = await Promise.all([
    admin.from("gp_v2_document_versions").select("sha256").eq("id", document.current_version_id).eq("organization_id", document.organization_id).maybeSingle(),
    admin.from("gp_v2_signature_envelopes").select("id,signature_level,provider,completed_at").eq("organization_id", document.organization_id).eq("document_id", document.id).eq("status", "signed").order("completed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  let finalHash = "";
  if (envelope) {
    const { data: artifact } = await admin.from("gp_v2_signature_artifacts").select("sha256").eq("organization_id", document.organization_id).eq("envelope_id", envelope.id).eq("artifact_kind", "signed_pdf").maybeSingle();
    finalHash = artifact?.sha256 || "";
  }
  return reply(200, { ok: true, documentCode: document.verification_code, title: document.title, status: document.status, createdAt: document.created_at, completedAt: document.completed_at || envelope?.completed_at || null, originalSha256: version?.sha256 || "", finalSha256: finalHash, signatureLevel: envelope?.signature_level || null, provider: envelope?.provider || null, system: "GP Mirari — coleta de evidências de assinatura eletrônica" });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply(405, { error: "method_not_allowed" });
  const cfg = config();
  const url = Deno.env.get("SUPABASE_URL") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!url || !service || !cfg.tokenPepper || !cfg.otpPepper || !cfg.dataPepper || !cfg.resendKey || !cfg.fromEmail) return reply(503, { error: "signature_service_not_configured" });
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const payload = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(payload.action || "");
  try {
    if (action === "inspect") return inspectLink(request, payload, admin);
    if (action === "confirm_identity") return confirmIdentity(request, payload, admin);
    if (action === "request_otp") return requestOtp(request, payload, admin);
    if (action === "verify_otp") return verifyOtp(request, payload, admin);
    if (action === "get_document") return getDocument(request, payload, admin);
    if (action === "accept_consent") return acceptConsent(request, payload, admin);
    if (action === "sign") return signDocument(request, payload, admin);
    if (action === "decline") return declineDocument(request, payload, admin);
    if (action === "download_final") return downloadFinal(request, payload, admin);
    if (action === "download_final_bundle") return downloadFinalBundle(request, payload, admin);
    if (action === "verify_document") return verifyDocument(request, payload, admin);
    if (action === "retry_finalization") return retryFinalization(request, payload, admin);
    return reply(400, { error: "unsupported_action" });
  } catch (error) {
    console.error("signature_public_failure", String(error instanceof Error ? error.message : error));
    return reply(500, { error: "signature_service_failure" });
  }
});
