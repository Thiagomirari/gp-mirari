import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const foundation = await readFile(join(root, "migrations", "001-v2-foundation.sql"), "utf8");
const identity = await readFile(join(root, "migrations", "002-identity-memberships-rls.sql"), "utf8");

assert.match(foundation, /^begin;/mi, "foundation migration must be transactional");
assert.match(foundation, /commit;\s*$/mi, "foundation migration must commit");
for (const table of [
  "gp_v2_organizations", "gp_v2_memberships", "gp_v2_product_categories",
  "gp_v2_products", "gp_v2_product_versions", "gp_v2_price_books",
  "gp_v2_product_prices", "gp_v2_product_costs", "gp_v2_product_images",
  "gp_v2_proposals", "gp_v2_proposal_versions", "gp_v2_proposal_items",
  "gp_v2_proposal_item_costs", "gp_v2_proposal_installments",
  "gp_v2_proposal_approvals", "gp_v2_proposal_events", "gp_v2_proposal_files",
]) {
  assert.match(foundation, new RegExp(`create table if not exists public\\.${table}`), `missing foundation table: ${table}`);
}
assert.match(foundation, /unique \(id, organization_id\)/, "composite keys are required for tenant-safe references");
assert.match(identity, /001-v2-foundation\.sql/, "identity migration must point to the actual foundation migration");
assert.ok(!identity.includes("supabase-v2-foundation.sql"), "stale migration reference must not remain");

console.log("foundation-migration: ok");
