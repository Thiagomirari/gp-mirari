import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../assets/saas-core.js", import.meta.url), "utf8");
const context = { console, localStorage: { getItem: () => null } };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context);

const core = context.GPMirariCommercial;

const shared = {
  clients: [],
  proposals: [],
  projects: [],
  crm: { leads: [] },
  commercialSettings: { markupDefaultPercent: 150, pricing: {} }
};
const repository = new core.CommercialRepository(shared);
const base = {
  clientId: "client-1",
  validUntil: "2026-12-31",
  discountPercent: 0,
  globalRtEnabled: false,
  paymentOptions: [],
  items: [
    { id: "environment-1", name: "Cozinha", baseUnitCents: 100000, quantity: 1, markupPercent: 130 },
    { id: "environment-2", name: "Dormitorio", baseUnitCents: 50000, quantity: 1, markupPercent: 155 }
  ]
};

const version1 = repository.saveProposal(base, "Administrador");
const version2 = repository.clone(version1.id, "Administrador");
repository.saveProposal({ ...base, items: base.items.map((item) => ({ ...item, markupPercent: 150 })) }, "Administrador", version2.id);
repository.saveProposal({ ...base, items: [{ ...base.items[0], markupPercent: 135 }, base.items[1]] }, "Administrador", version1.id);

assert.equal(repository.proposal(version1.id).version, 1, "saving v1 must keep the selected version");
assert.equal(repository.proposal(version1.id).items[0].markupPercent, 135, "v1 markup must persist");
assert.equal(repository.proposal(version2.id).version, 2, "v2 must remain a separate record");
assert.equal(repository.proposal(version2.id).items[0].markupPercent, 150, "saving v1 must not overwrite v2 markup");

const simulation = core.applySalesSimulation(repository.proposal(version1.id), ["environment-1"], 10, 0);
assert.equal(simulation.items.length, 2, "sales simulation must preserve every proposal item");
assert.equal(simulation.items[0].included, true);
assert.equal(simulation.items[0].markupPercent, 135, "selected item markup must be preserved");
assert.equal(simulation.items[1].included, false);
assert.equal(simulation.items[1].markupPercent, 155, "unselected item markup must be preserved");
assert.equal(simulation.baseCents, 100000, "totals must include only selected items");
assert.equal(simulation.totalCents, 211500, "discount must be applied to the selected sale total");

console.log("proposal state regression tests passed");
