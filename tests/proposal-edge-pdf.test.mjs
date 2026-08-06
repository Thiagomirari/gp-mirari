import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const source = await readFile(join(root, "supabase", "functions", "gp-v2-proposal-pdf", "index.ts"), "utf8");

for (const token of ["supabase_environment_missing", "createSignedUrl(path, 900)", "bucket.remove([path])", "eventError", "payment_terms_snapshot", "delivery_terms_snapshot"]) {
  assert.ok(source.includes(token), `missing PDF safety control: ${token}`);
}
assert.ok(!source.includes("Â·"), "the generated PDF must not contain mojibake separators");
assert.ok(!source.includes("slice(0, 105)"), "long PDF lines must wrap instead of being truncated");
assert.match(source, /candidate\.length > 92/, "long PDF text must be wrapped deterministically");

console.log("proposal-edge-pdf: ok");
