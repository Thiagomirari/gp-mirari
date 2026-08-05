import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../assets/saas-extension.js", import.meta.url), "utf8");

for (const marker of ["Solucao sob medida", "Investimento total", "Ambientes e valores", "Condicoes de pagamento", "Documento comercial confidencial"]) {
  assert.match(source, new RegExp(marker), `Secao visual ausente no PDF: ${marker}`);
}

assert.match(source, /lowestPaymentCents/, "O PDF deve destacar o menor valor entre as condicoes selecionadas.");
assert.match(source, /Menor valor entre as condicoes selecionadas/, "O destaque do investimento deve identificar a menor condicao selecionada.");
assert.match(source, /paymentDiscount\(option,highestPaymentCents\)/, "O PDF deve preservar os descontos das condicoes de pagamento.");
assert.match(source, /Markup e RT/, "A tela deve manter a orientacao de que markup e RT nao aparecem no PDF.");

console.log("proposal-pdf-layout.test.mjs: ok");
