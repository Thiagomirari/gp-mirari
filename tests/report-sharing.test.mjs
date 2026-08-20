import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFile(join(root, path), "utf8");
const [migration, hardening, edge, reports, page, publicScript, publicConfig, cpanel] = await Promise.all([
  read("migrations/021-secure-report-sharing.sql"),
  read("migrations/022-report-sharing-service-role-hardening.sql"),
  read("supabase/functions/gp-v2-report-share/index.ts"),
  read("assets/reports-v4.js"),
  read("relatorio.html"),
  read("assets/report-public.js"),
  read("assets/report-public-config.js"),
  read(".cpanel.yml"),
]);

for (const token of ["gp_v2_report_shares", "enable row level security", "revoke all on table public.gp_v2_report_shares from anon, authenticated", "token_hash", "expires_at", "revoked_at", "access_count"]) {
  assert.ok(migration.toLowerCase().includes(token.toLowerCase()), `migration missing secure share token: ${token}`);
}
assert.doesNotMatch(migration, /grant\s+(select|insert|update|delete|all)[^;]+to\s+(anon|authenticated)/i, "share snapshots must not be exposed to the Data API");
assert.match(migration, /gp_v2_report_shares_created_by_idx/, "the created_by foreign key must be indexed");
assert.doesNotMatch(migration, /grant\s+all[^;]+to\s+service_role/i, "the Edge Function role must receive only the operations it needs");
assert.match(migration, /revoke all on table public\.gp_v2_report_shares from service_role/i, "new installs must remove Supabase's broad service_role defaults");
assert.match(hardening, /revoke all[\s\S]+grant select, insert, update[\s\S]+service_role/i, "existing installs need the same least-privilege hardening");
assert.doesNotMatch(migration, /access_token|raw_token|plain.*token/i, "migration must never persist a raw access token");

for (const token of ["REPORT_SHARE_TOKEN_PEPPER", "hmacSha256", "randomToken", "auth.getUser", "gp_v2_memberships", "shareRoles", "report_share_permission_required", "action === \"view\"", "action === \"revoke\"", "Cache-Control", "X-Robots-Tag"]) {
  assert.ok(edge.includes(token), `Edge Function missing security control: ${token}`);
}
assert.ok(edge.includes("snapshot_too_large"), "shared snapshots need a strict size limit");
assert.ok(edge.includes("allowedSections"), "shared report sections need a server-side allowlist");
assert.ok(edge.includes("sectionKeys"), "the server must strip data for unselected sections");
assert.match(edge, /Access-Control-Allow-Headers[^\n]+x-client-info/, "Supabase browser calls must pass their CORS preflight");
assert.doesNotMatch(edge, /token_hash:\s*accessToken/i, "raw access tokens must never be persisted");

for (const token of ["Gerar link", "openReportShareOptions", "sharedReportSnapshot", "expiresInDays", "reportShareApi(\"revoke\"", "channel-detail", "conteudo confidencial"]) {
  assert.ok(reports.includes(token), `reports UI missing share behavior: ${token}`);
}
assert.ok(reports.includes("#t=${encodeURIComponent(accessToken)}") || edge.includes("#t=${encodeURIComponent(accessToken)}"), "the access token must travel in the URL fragment");
assert.ok(reports.includes("sharedReportSnapshot(sections)"), "the UI must only build the selected report snapshot");

assert.match(page, /Content-Security-Policy/);
assert.match(page, /frame-ancestors 'none'/);
assert.match(page, /noindex,nofollow,noarchive,nosnippet/);
assert.doesNotMatch(page, /index\.html|saas-core|reports-v4/, "the public page must not load the authenticated application bundle");
assert.match(publicScript, /history\.replaceState/, "the token fragment must be cleared after it is read");
assert.match(publicScript, /sessionStorage/, "the cleared token must remain available only for the current tab session");
assert.match(publicScript, /textContent/, "public rendering must use safe text insertion");
assert.doesNotMatch(publicScript, /innerHTML|outerHTML|document\.write/, "untrusted report data must never be rendered as HTML");
assert.match(publicConfig, /gp-v2-report-share/);
assert.doesNotMatch(publicConfig, /anonKey|service_role|secret/i, "the public page configuration must contain only the endpoint URL");
assert.match(cpanel, /cp relatorio\.html/, "the isolated public page must be included in the cPanel deployment");

console.log("report-sharing.test.mjs: ok");
