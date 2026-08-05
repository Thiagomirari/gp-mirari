import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const reports = readFileSync(new URL("../assets/reports-v4.js", import.meta.url), "utf8");

for (const marker of ["salesGoals", "Meta anual de faturamento", "Meta de faturamento", "salesGoalForRange", "sales-goal-form"]) {
  assert.match(html, new RegExp(marker), `Fundacao de metas ausente: ${marker}`);
}

for (const marker of ["salesGoalSummary", "Faturamento e atingimento", "Semestre", "Trimestre", "Meta do periodo"]) {
  assert.match(reports, new RegExp(marker), `Painel de metas ausente em Relatorios: ${marker}`);
}

assert.match(html, /annualRevenue: Math\.max\(0, Number\(goal\.annualRevenue\) \|\| 0\)/, "A meta anual precisa ser normalizada como valor nao negativo.");
assert.match(reports, /Number\(goal\.annualRevenue \|\| 0\) \* overlapDays \/ yearDays/, "A meta do periodo precisa ser proporcional aos dias selecionados.");
assert.match(html, /id="refresh-app-button"/, "O cabecalho precisa oferecer atualizacao forcada da aplicacao.");
assert.match(html, /app_refresh/, "A atualizacao forcada precisa usar um parametro de cache-busting.");

console.log("sales-goals.test.mjs: ok");
