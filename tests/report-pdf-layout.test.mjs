import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../assets/reports-v4.js", import.meta.url), "utf8");

for (const marker of ["Relatorio executivo", "Visao consolidada", "Periodo analisado", "Funil comercial", "Performance por canal", "Especificadores e parceiros", "Documento gerencial confidencial"]) {
  assert.match(source, new RegExp(marker), `Secao visual ausente no PDF: ${marker}`);
}

assert.match(source, /data\.summary\.soldValue/, "O valor vendido precisa permanecer no PDF.");
assert.match(source, /data\.summary\.conversion/, "A conversao precisa permanecer no PDF.");
assert.match(source, /data\.partners/, "Os parceiros precisam permanecer no PDF.");

console.log("report-pdf-layout.test.mjs: ok");
