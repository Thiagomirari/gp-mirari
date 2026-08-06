import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = await readFile(join(root, "supabase", "functions", "gp-admin-users", "index.ts"), "utf8");

for (const token of ["GP_APP_ORGANIZATION_ID", "GP_ALLOWED_ORIGIN", "gp_v2_memberships", "owner", "admin", "syncMembership", "assertOwnerMutation"]) {
  assert.ok(source.includes(token), `missing server-side authorization control: ${token}`);
}
assert.ok(!source.includes("const caller = users.find"), "administrator authorization must not be derived from app_state users");
assert.match(source, /callerMembership\?\.status !== "active"/, "active membership must be mandatory");
assert.match(source, /A organizacao precisa manter pelo menos um owner ativo/, "the final active owner must be protected");
assert.ok(!source.includes('"Access-Control-Allow-Origin": "*"'), "administrative CORS must not be wildcarded");
assert.match(source, /if \(password \|\| googleEnabled\)/, "Google-only users must also be provisioned in Supabase Auth");
assert.match(source, /authUserId\?: string/, "legacy user IDs must be separated from auth IDs during migration");

console.log("admin-users-security: ok");
