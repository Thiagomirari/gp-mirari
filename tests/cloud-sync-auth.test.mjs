import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const proposals = readFileSync(new URL("../assets/saas-extension.js", import.meta.url), "utf8");

assert.match(html, /async function ensureAuthenticatedCloudSession\(\)/, "cloud writes must validate the Supabase session");
assert.match(html, /client\.auth\.getSession\(\)/, "cloud writes must recover the persisted browser session");
assert.match(html, /client\.auth\.refreshSession\(\)/, "cloud writes must refresh a session that is close to expiring");
assert.match(html, /await ensureAuthenticatedCloudSession\(\);[\s\S]*const snapshot = sharedStateSnapshot\(\);/, "authentication must be checked before building and sending the shared snapshot");
assert.match(html, /else if \(expectsCloudAuth\(\) && state\.sessionUserId\)[\s\S]*state\.sessionUserId = "";/, "a local session marker must not bypass cloud authentication");
assert.match(proposals, /isCloudSessionRequired\(error\)/, "proposal saving must distinguish an expired session from other sync failures");
assert.match(proposals, /Sua sessao expirou; saia e entre novamente para sincronizar/, "the saved local draft must have an actionable recovery message");

console.log("cloud sync auth tests passed");
