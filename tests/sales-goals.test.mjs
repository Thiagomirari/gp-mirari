import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const reports = readFileSync(new URL("../assets/reports-v4.js", import.meta.url), "utf8");
const commercial = readFileSync(new URL("../assets/saas-extension.js", import.meta.url), "utf8");

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
assert.match(html, /formatCurrencyWhileTyping/, "A meta anual precisa formatar moeda durante a digitacao.");
assert.match(html, /moneyNumber\(document\.getElementById\("sales-goal-annual"\)\.value\)/, "A meta anual formatada precisa ser convertida corretamente ao salvar.");
assert.match(html, /id="crm-value" inputmode="decimal"/, "O valor da nova oportunidade precisa usar entrada monetaria.");
assert.match(html, /id="crm-detail-value" inputmode="decimal"/, "O valor da oportunidade selecionada precisa usar entrada monetaria.");
assert.match(html, /modalValue\.oninput = \(\) => formatCurrencyWhileTyping\(modalValue\)/, "A nova oportunidade precisa formatar o valor durante a digitacao.");
assert.match(html, /detailValue\.oninput = \(\) => formatCurrencyWhileTyping\(detailValue\)/, "A oportunidade selecionada precisa formatar o valor durante a digitacao.");
assert.match(html, /id="crm-value"[^>]*oninput="formatCurrencyWhileTyping\(this\)"/, "A nova oportunidade precisa ter mascara imediata no campo.");
assert.match(html, /id="crm-detail-value"[^>]*oninput="formatCurrencyWhileTyping\(this\)"/, "A oportunidade selecionada precisa ter mascara imediata no campo.");
assert.match(commercial, /applyCurrencyMask/, "As propostas precisam reutilizar a mascara monetaria do sistema.");
assert.match(commercial, /\.line-base,\.composition-cost,\.payment-entry-value,\.cash-split-value,#pricing-purchase-extra,#pricing-freight,#pricing-assembly/, "Todos os campos monetarios de propostas precisam estar cobertos pela mascara.");
assert.match(commercial, /formatPercentWhileTyping/, "Os percentuais das condicoes de pagamento precisam aceitar formatacao durante a digitacao.");
assert.match(commercial, /decimalInputNumber/, "Os percentuais das condicoes de pagamento precisam ser convertidos com virgula decimal.");
assert.match(commercial, /valueInput\.value=core\(\)\.money\(previewOption\.entryCents\)/, "O valor da entrada recalculado por percentual precisa manter a mascara monetaria.");
assert.match(commercial, /value\.value=core\(\)\.money\(payment\.amountCents\)/, "Os valores das parcelas recalculados por percentual precisam manter a mascara monetaria.");

console.log("sales-goals.test.mjs: ok");
