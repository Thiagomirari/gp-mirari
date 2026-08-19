import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = await readFile(join(root, "assets", "reports-v4.js"), "utf8");
const extension = await readFile(join(root, "assets", "saas-extension.js"), "utf8");

assert.ok(source.includes("const wonCohort = scoped.filter(isWon)"), "conversion must use the lead cohort");
assert.ok(source.includes("const commercialWonCohort = commercialLeads.filter(isWon)"), "commercial conversion must use the same cohort");
assert.ok(source.includes("const local = window.reportBlockFilters || {}"), "block filters must persist across renders");
assert.ok(!source.includes("Math.round(sold.length / scoped.length * 100)"), "closing-period sales cannot be divided by acquisition-period leads");
assert.ok(source.includes("const list = (value) => Array.isArray(value) ? value : []"), "reports must tolerate missing or malformed collection fields");
assert.ok(source.includes("Oportunidades por canal"), "marketing must expose a channel drilldown");
assert.ok(source.includes("data-report-channel-detail"), "each marketing channel must be clickable for inspection");
assert.ok(source.includes("data-report-open-crm-lead"), "channel drilldown must offer a CRM correction shortcut");
assert.ok(source.includes("state.activeTab = \"crm\""), "the correction shortcut must return to CRM");
assert.ok(extension.includes("function renderReportsSafely()"), "reports must have an isolated render boundary");
assert.ok(extension.includes('typeof renderModuleFailure==="function"'), "report failures must use the recoverable module state");

console.log("reports-ui-integrity: ok");
