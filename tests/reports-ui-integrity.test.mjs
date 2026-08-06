import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = await readFile(join(root, "assets", "reports-v4.js"), "utf8");

assert.ok(source.includes("const wonCohort = scoped.filter(isWon)"), "conversion must use the lead cohort");
assert.ok(source.includes("const commercialWonCohort = commercialLeads.filter(isWon)"), "commercial conversion must use the same cohort");
assert.ok(source.includes("const local = window.reportBlockFilters || {}"), "block filters must persist across renders");
assert.ok(!source.includes("Math.round(sold.length / scoped.length * 100)"), "closing-period sales cannot be divided by acquisition-period leads");

console.log("reports-ui-integrity: ok");
