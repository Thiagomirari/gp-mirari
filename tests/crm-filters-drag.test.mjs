import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

for (const label of ["Todo o periodo", "Este mes", "Ultimos 30 dias", "Trimestre", "Este ano", "Ultimos 12 meses", "Selecionar periodo"]) {
  assert.match(html, new RegExp(label), `Preset ausente: ${label}`);
}

assert.match(html, /crmAppliedPeriodLabel\(\)/, "O CRM deve exibir o periodo efetivamente aplicado no funil.");
assert.match(html, /preset === "all"[^\n]*start: "", end: ""/, "Todo o periodo deve remover os limites de data.");

assert.match(html, /state\.activeTab === "crm"[\s\S]*crmVisibleLeads\(\)/, "KPIs superiores devem priorizar os filtros do CRM.");
assert.match(html, /draggable="true"[^>]*data-crm-lead-draggable/, "Cartoes do CRM devem ser arrastaveis.");
assert.match(html, /data-crm-stage-drop/, "Etapas do CRM devem aceitar oportunidades arrastadas.");
assert.match(html, /function crmMoveLeadByDrag[\s\S]*crmMoveLeadStage\(lead, targetStageId\)/, "Arraste entre etapas deve reutilizar a validacao comercial.");
assert.match(html, /function crmMoveLeadStage[\s\S]*crmCanLeaveCurrentStage\(lead\)/, "Mudanca deve respeitar tarefas obrigatorias.");
assert.match(html, /Use a acao formal de negocio fechado ou perdido/, "Arraste nao pode contornar confirmacoes de ganho ou perda.");

console.log("crm-filters-drag.test.mjs: ok");
