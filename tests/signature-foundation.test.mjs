import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = await readFile(join(root, "migrations", "007-document-signatures-foundation.sql"), "utf8");
const signatureApi = await readFile(join(root, "supabase", "functions", "gp-v2-signatures", "index.ts"), "utf8");
const webhook = await readFile(join(root, "supabase", "functions", "gp-v2-signatures-webhook", "index.ts"), "utf8");
const indexes = await readFile(join(root, "migrations", "008-signature-indexes.sql"), "utf8");
const internalMigration = await readFile(join(root, "migrations", "009-internal-signature-provider.sql"), "utf8");
const complianceMigration = await readFile(join(root, "migrations", "010-signature-compliance-hardening.sql"), "utf8");
const publicSignatureApi = await readFile(join(root, "supabase", "functions", "gp-v2-sign-public", "index.ts"), "utf8");
const signatureUi = await readFile(join(root, "assets", "signatures-ui.js"), "utf8");
const signingPage = await readFile(join(root, "assinar.html"), "utf8");
const verificationPage = await readFile(join(root, "verificar-assinatura.html"), "utf8");
const retryMigration = await readFile(join(root, "migrations", "012-signature-artifact-retry.sql"), "utf8");
const rateLimitHotfix = await readFile(join(root, "migrations", "014-signature-rate-limit-hotfix.sql"), "utf8");
const envelopeDocumentsMigration = await readFile(join(root, "migrations", "015-signature-envelope-documents.sql"), "utf8");

for (const table of [
  "gp_v2_document_templates",
  "gp_v2_documents",
  "gp_v2_document_versions",
  "gp_v2_document_links",
  "gp_v2_signature_envelopes",
  "gp_v2_signature_signers",
  "gp_v2_signature_events",
  "gp_v2_signature_artifacts",
  "gp_v2_signature_automation_rules",
  "gp_v2_signature_jobs",
  "gp_v2_signature_webhook_receipts",
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`), `missing signature table: ${table}`);
  assert.match(migration, new RegExp(`alter table public\\.%I enable row level security|alter table public\\.${table} enable row level security`), `RLS coverage missing for: ${table}`);
}

assert.match(migration, /gp-v2-signature-files[\s\S]*false/, "signature bucket must remain private");
assert.match(migration, /signature evidence is immutable/, "signature evidence must be append-only");
assert.match(migration, /qualified_icp_brasil/, "ICP-Brasil signature level must be modeled explicitly");
assert.match(migration, /auto_send boolean not null default false/, "automatic sending must be opt-in");
assert.match(migration, /revoke all on table public\.%I from authenticated/, "authenticated clients must not bypass Edge authorization");
assert.ok(!migration.includes("create policy gp_v2_signature_files"), "signature storage must not expose direct browser policies");

for (const token of [
  "maxFileSize",
  "allowedMimeTypes",
  "idempotency-key",
  "AUTENTIQUE_API_TOKEN",
  "SIGNATURE_MODE",
  "qualified: level === \"qualified_icp_brasil\"",
  "document_hash",
  "createSignedUrl(artifact.storage_path, 300)",
]) assert.ok(signatureApi.includes(token), `missing signature API control: ${token}`);

assert.ok(!signatureApi.includes("serviceRoleKey"), "service credentials must only come from Edge environment variables");
assert.ok(!signatureApi.includes("AUTENTIQUE_API_TOKEN:"), "provider token must never be serialized in a response");

for (const token of [
  "x-autentique-signature",
  "crypto.subtle.verify(\"HMAC\"",
  "gp_v2_signature_webhook_receipts",
  "provider_event_id",
  "EdgeRuntime.waitUntil",
  "allowedProviderFileUrl",
  "payload_sha256",
]) assert.ok(webhook.includes(token), `missing webhook safety control: ${token}`);

assert.match(webhook, /return reply\(401, \{ error: "webhook_signature_invalid" \}\)/, "invalid HMAC must be rejected");
assert.ok(!webhook.includes("payload: payload"), "raw webhook payload with personal data must not be persisted");
assert.match(indexes, /gp_v2_signature_events_envelope_org_fk_idx/, "signature event foreign key needs a covering index");
assert.match(indexes, /gp_v2_signature_signers_envelope_org_fk_idx/, "signature signer foreign key needs a covering index");
assert.match(indexes, /^begin;/mi, "signature indexes migration must be transactional");
assert.match(indexes, /commit;\s*$/mi, "signature indexes migration must commit");

for (const table of [
  "gp_v2_signature_consent_texts",
  "gp_v2_signature_privacy_notices",
  "gp_v2_signature_access_links",
  "gp_v2_signature_otp_challenges",
  "gp_v2_signature_sessions",
  "gp_v2_signature_consents",
  "gp_v2_signature_actions",
  "gp_v2_signature_rate_limits",
  "gp_v2_signature_retention_policies",
  "gp_v2_signature_security_incidents",
]) assert.match(internalMigration, new RegExp(`create table if not exists public\\.${table}`), `missing internal-provider table: ${table}`);

for (const token of [
  "gp_v2_append_signature_event",
  "gp_v2_consume_signature_rate_limit",
  "gp_v2_verify_signature_otp",
  "gp_v2_mark_internal_signature",
  "previous_event_hash",
  "event_hash",
  "No anon",
]) assert.ok(internalMigration.includes(token), `missing internal-provider database control: ${token}`);

assert.doesNotMatch(internalMigration, /^\s+code\s+text\b/mi, "OTP plaintext column must not exist");
assert.match(internalMigration, /code_hash text not null/, "OTP must be stored by secure hash");
assert.match(internalMigration, /token_hash text not null/, "access tokens must be stored by secure hash");
assert.match(complianceMigration, /published privacy notice content is immutable/, "published privacy text must be version-immutable");
assert.match(complianceMigration, /published retention policy content is immutable/, "published retention policy must be version-immutable");

for (const token of [
  "SIGNATURE_TOKEN_PEPPER",
  "SIGNATURE_OTP_PEPPER",
  "SIGNATURE_DATA_PEPPER",
  "request_otp",
  "verify_otp",
  "accept_consent",
  "gp_v2_signature_actions",
  "process.completed",
  "createSignedUrl",
  "SHA-256 final",
  "verify_document",
]) assert.ok(publicSignatureApi.includes(token), `missing public signature control: ${token}`);

assert.doesNotMatch(publicSignatureApi, /gp_v2_signature_otp_challenges[\s\S]{0,500}\bcode\s*:/, "OTP must not be persisted in plaintext");
assert.match(signingPage, /express-consent/, "express consent must be an unchecked browser control");
assert.doesNotMatch(signingPage, /express-consent[^>]+checked/, "express consent must never be preselected");
assert.match(signingPage, /Content-Security-Policy/, "public signing page needs a CSP");
assert.match(verificationPage, /verify-form/, "verification page must expose the public verifier form");
assert.match(signatureUi, /legalReviewConfirmed/, "compliance publishing must require explicit legal review confirmation");
assert.match(signatureUi, /data-signer-role/, "administrative UI must collect signer roles");
assert.match(signatureUi, /witness/, "administrative UI must allow optional witnesses");
assert.match(publicSignatureApi, /retryFinalization/, "failed finalization must be safely resumable");
assert.match(publicSignatureApi, /uploadImmutable/, "final artifacts must be idempotent and immutable");
assert.match(retryMigration, /drop constraint if exists gp_v2_signature_artifacts_organization_id_storage_path_key/, "retry envelopes must be able to reference the same immutable original");
assert.match(rateLimitHotfix, /v_now timestamptz := clock_timestamp\(\)/, "rate-limit hotfix must avoid the CURRENT_TIME variable collision");
assert.doesNotMatch(rateLimitHotfix, /current_time timestamptz/i, "rate-limit hotfix must not redeclare CURRENT_TIME");
assert.match(envelopeDocumentsMigration, /create table if not exists public\.gp_v2_signature_envelope_documents/, "multi-document envelope table is required");
assert.match(envelopeDocumentsMigration, /document_manifest_sha256/, "envelopes must bind signatures to a deterministic document manifest");
assert.match(envelopeDocumentsMigration, /envelope documents are immutable after sending/, "sent envelopes must reject document mutations");
assert.match(envelopeDocumentsMigration, /enable row level security/, "multi-document envelope table needs RLS");

console.log("signature-foundation: ok");
