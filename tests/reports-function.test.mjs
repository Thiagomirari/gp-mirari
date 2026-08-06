import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const file = await readFile(join(root, "supabase", "functions", "gp-v2-reports", "index.ts"), "utf8");
for (const token of ["Deno.serve", "auth.getUser", "gp_v2_memberships", "organization_required", "gp_v2_report_opportunity_facts_v", "gp_v2_crm_activities", "estimated_value", "probability_percent", "acquisition_channel_name", "next_activity_at", "pipelineValue", "weightedPipeline"]) {
  assert.ok(file.includes(token), `missing reports function token: ${token}`);
}
assert.ok(!file.includes("SERVICE_ROLE"), "reports function must not use service role");
assert.ok(file.includes("active_membership_required"), "membership gate missing");
assert.ok(!file.includes("value_cents"), "report view exposes estimated_value, not value_cents");
assert.ok(!file.includes("stage_name || \"Sem etapa\""), "stage names must be resolved from gp_v2_crm_stages");
console.log("reports-function: ok");
