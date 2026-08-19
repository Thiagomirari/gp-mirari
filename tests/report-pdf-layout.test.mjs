import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../assets/reports-v4.js", import.meta.url), "utf8");

for (const marker of ["Relatorio executivo", "Visao consolidada", "Periodo analisado", "Funil comercial", "Performance por canal", "Especificadores e parceiros", "Documento gerencial confidencial"]) {
  assert.match(source, new RegExp(marker), `Secao visual ausente no PDF: ${marker}`);
}

assert.match(source, /source\.cloneNode\(true\)/, "O PDF deve partir da tela atual de Relatorios.");
assert.match(source, /snapshot\.outerHTML/, "O PDF deve preservar os mesmos blocos exibidos no painel.");
assert.match(source, /@page\{size:A4 landscape/, "O painel completo deve ser impresso em A4 horizontal.");
assert.match(source, /\$\("report-pdf"\)\.onclick = openReportPrintOptions/, "O botao deve permitir selecionar o conteudo antes de gerar o PDF.");
assert.match(source, /snapshot\.querySelectorAll\("\[data-report-print-section\]"\)/, "O PDF deve remover as secoes que nao foram selecionadas.");
assert.match(source, /Detalhamento por canal/, "O detalhamento por canal deve ser opcional no PDF.");
for (const selector of ["reporting-kpis", "report-evolution-section", "report-finance-strip", "report-team-panel", "report-partner-panel", "reporting-future"]) {
  assert.match(source, new RegExp(selector), `O PDF deve incluir o bloco ${selector} exibido na tela.`);
}
for (const taskMarker of ["taskMetrics", "Tarefas pendentes", "Tarefas concluidas", "SLA de tarefas", "report-alert-strip"]) {
  assert.doesNotMatch(source, new RegExp(taskMarker), `Relatorios nao deve exibir informacoes do modulo de tarefas: ${taskMarker}`);
}

assert.match(source, /data\.summary\.soldValue/, "O valor vendido precisa permanecer no PDF.");
assert.match(source, /data\.summary\.conversion/, "A conversao precisa permanecer no PDF.");
assert.match(source, /data\.partners/, "Os parceiros precisam permanecer no PDF.");
assert.match(source, /\["all", "Todo o periodo"\]/, "O preset Todo o periodo precisa estar disponivel em Relatorios.");
assert.match(source, /preset === "all"[^\n]*start: "", end: ""/, "Todo o periodo precisa remover os limites de data.");
assert.match(source, /if \(!filters\.start && !filters\.end\) return true/, "O filtro sem datas precisa incluir todo o historico.");

console.log("report-pdf-layout.test.mjs: ok");
