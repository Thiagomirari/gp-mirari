import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const file = await readFile(join(root, "supabase", "functions", "gp-v2-reports", "index.ts"), "utf8");
for (const token of ["Deno.serve", "auth.getUser", "gp_v2_memberships", "organization_required", "gp_v2_report_opportunity_facts_v", "pipelineValue", "weightedPipeline"]) {
  assert.ok(file.includes(token), `missing reports function token: ${token}`);
}
assert.ok(!file.includes("SERVICE_ROLE"), "reports function must not use service role");
assert.ok(file.includes("active_membership_required"), "membership gate missing");
console.log("reports-function: ok");
