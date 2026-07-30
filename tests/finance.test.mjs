import assert from "node:assert/strict";
import { buildInstallments, calculatePaymentOption, calculatePaymentOptions, calculatePriceFormation, calculateProposal, cents, clampMarkup, clampPercent, defaultCardRates, defaultStoreRates } from "../assets/saas-core.mjs";

assert.equal(cents("R$ 1.234,56"), 123456);
assert.equal(cents("19,90"), 1990);
assert.equal(clampPercent("120"), 100);
assert.equal(clampPercent("-4"), 0);
assert.equal(clampMarkup("150"), 150);

const calculation = calculateProposal([
  { name: "Cozinha", baseUnitCents: 100000, quantity: 2, markupPercent: 25, hasRt: true, rtPercent: 10 },
  { name: "Painel", baseUnitCents: 50000, quantity: 1, markupPercent: 0, hasRt: false, rtPercent: 10 }
], 10);

assert.equal(calculation.baseCents, 250000);
assert.equal(calculation.markupCents, 50000);
assert.equal(calculation.rtCents, 27778);
assert.equal(calculation.discountCents, 32778);
assert.equal(calculation.totalCents, 295000);
assert.equal(calculation.items.reduce((sum, item) => sum + item.totalCents, 0), calculation.totalCents);
assert.ok(calculation.items.every((item) => item.discountCents >= 0));

const markupThenRt = calculateProposal([
  { name: "Cozinha", baseUnitCents: 100000, quantity: 1, markupPercent: 150, hasRt: true, rtPercent: 10 }
]);
assert.equal(markupThenRt.markupCents, 150000);
assert.equal(markupThenRt.rtCents, 27778);
assert.equal(markupThenRt.totalCents, 277778);

const compositionWithGlobalRt = calculateProposal([
  { name: "Cozinha", baseUnitCents: 100000, quantity: 1, markupPercent: 100, subItems: [{ name: "Portas", quantity: 2, unitCostCents: 50000, markupPercent: 50 }] }
], 0, 10);
assert.equal(compositionWithGlobalRt.baseCents, 100000);
assert.equal(compositionWithGlobalRt.markupCents, 50000);
assert.equal(compositionWithGlobalRt.rtCents, 16667);
assert.equal(compositionWithGlobalRt.totalCents, 166667);
assert.equal(compositionWithGlobalRt.items[0].hasComposition, true);
assert.equal(compositionWithGlobalRt.items[0].environmentBaseCents, 0);
assert.equal(compositionWithGlobalRt.items[0].subItemsSaleCents, 150000);
assert.equal(compositionWithGlobalRt.items[0].calculatedSubItems[0].totalCents, 150000);

const proposalWithExcludedEnvironment = calculateProposal([
  { name: "Cozinha", baseUnitCents: 100000, quantity: 1, markupPercent: 100, included: true },
  { name: "Dormitorio", baseUnitCents: 50000, quantity: 1, markupPercent: 100, included: false }
], 10);
assert.equal(proposalWithExcludedEnvironment.items.length, 1);
assert.equal(proposalWithExcludedEnvironment.baseCents, 100000);
assert.equal(proposalWithExcludedEnvironment.totalCents, 180000);

const rtUsingNetSaleBasis = calculateProposal([
  { name: "Cozinha", baseUnitCents: 6300000, quantity: 1, markupPercent: 0 }
], 0, 10, { netRtTaxPercent: 4.522613065326642 });
assert.ok(Math.abs(rtUsingNetSaleBasis.rtCents - 665000) <= 5);
assert.ok(Math.abs(rtUsingNetSaleBasis.totalCents - 6965000) <= 5);

const installments = buildInstallments(292500, 3, 20);
assert.equal(installments.length, 3);
assert.equal(installments.reduce((sum, item) => sum + item.amountCents, 0), 292500);

const cardRates = { ...defaultCardRates, fixed: defaultCardRates[12] };
const card3x = calculatePaymentOption(100000, { type: "card", installments: 3 }, cardRates, defaultStoreRates);
const card12x = calculatePaymentOption(100000, { type: "card", installments: 12 }, cardRates, defaultStoreRates);
assert.equal(card3x.feePercent, 13.41);
assert.equal(card3x.totalCents, card12x.totalCents);
assert.equal(card3x.totalCents, Math.round(100000 / (1 - defaultCardRates[12] / 100)));

const cash = calculatePaymentOption(100000, { type: "cash" }, cardRates, defaultStoreRates);
assert.equal(cash.totalCents, 100000);

const cashWithEntry = calculatePaymentOption(100000, { type: "cash_entry", installments: 3, entryPercent: 65 }, cardRates, defaultStoreRates);
assert.equal(cashWithEntry.totalCents, Math.round(card12x.totalCents * .95));
assert.equal(cashWithEntry.entryCents, Math.round(cashWithEntry.totalCents * .65));
assert.equal(cashWithEntry.feeCents, 0);

const cashWithCustomSplits = calculatePaymentOption(100000, {
  type: "cash_entry",
  installments: 3,
  entryPercent: 65,
  installmentSplits: [
    { mode: "amount", amountCents: 20000 },
    { mode: "percent", percent: 10 },
    { mode: "amount", amountCents: cashWithEntry.financedBaseCents - 20000 - Math.round(cashWithEntry.conditionBaseCents * .10) }
  ]
}, cardRates, defaultStoreRates);
assert.equal(cashWithCustomSplits.installmentRemainingCents, 0);
assert.equal(cashWithCustomSplits.installmentPayments.length, 3);
assert.equal(cashWithCustomSplits.installmentPayments.reduce((sum, item) => sum + item.amountCents, 0), cashWithCustomSplits.financedBaseCents);

const unbalancedCashSplits = calculatePaymentOption(100000, {
  type: "cash_entry",
  installments: 2,
  entryPercent: 65,
  installmentSplits: [{ mode: "percent", percent: 10 }, { mode: "percent", percent: 10 }]
}, cardRates, defaultStoreRates);
assert.ok(unbalancedCashSplits.installmentRemainingCents > 0);

const priceFormation = calculatePriceFormation({
  totalCents: 100000,
  globalRtEnabled: true,
  globalRtPercent: 10,
  items: [{ name: "Cozinha", baseUnitCents: 10000, quantity: 1, markupPercent: 100, subItems: [{ name: "Portas de vidro", quantity: 2, unitCostCents: 10000, markupPercent: 100 }] }]
}, {
  purchaseExtraCents: 5000,
  taxPercent: 5,
  freightMode: "production_percent",
  freightPercent: 10,
  assemblyBasis: "net_sale",
  assemblyMode: "percent",
  assemblyPercent: 7,
  financialModelKey: "card:0",
  contributorIds: ["seller"],
  commissionOverrides: { seller: 4 }
}, [{ id: "seller", name: "Comercial", sector: "Vendas", commissionPercent: 3, active: true }], [{ key: "card:0", amountCents: 13410 }]);
assert.equal(priceFormation.compositionCostCents, 20000);
assert.equal(priceFormation.purchaseCostCents, 25000);
assert.equal(priceFormation.baseSaleCents, 100000);
assert.equal(priceFormation.saleCents, 113410);
assert.equal(priceFormation.netSaleBeforeRtCents, 94329);
assert.equal(priceFormation.netSaleAfterRtCents, 84896);
assert.equal(priceFormation.rtCents, 9433);
assert.equal(priceFormation.freightCents, 2500);
assert.equal(priceFormation.assemblyCents, 5943);
assert.equal(priceFormation.financialFeeCents, 13410);
assert.equal(priceFormation.commissionCents, 3396);
assert.equal(priceFormation.totalCostCents, 65353);
assert.equal(priceFormation.contributionCents, 48057);
assert.equal(Math.round(priceFormation.saleScore * 100), 454);
assert.equal(priceFormation.environments[0].purchaseCostCents, 20000);
assert.equal(priceFormation.environments[0].saleCents, 113410);

const storeFinanced = calculatePaymentOption(100000, { type: "store_financed", installments: 12, entryPercent: 30 }, cardRates, defaultStoreRates);
assert.equal(storeFinanced.entryCents, 30000);
assert.equal(storeFinanced.feePercent, defaultStoreRates[12]);
assert.equal(storeFinanced.totalCents, Math.round(30000 + 70000 * (1 + defaultStoreRates[12] / 100)));

const storeWithAmountEntry = calculatePaymentOption(100000, { type: "store_financed", installments: 6, entryMode: "amount", entryCents: 30000 }, cardRates, defaultStoreRates);
assert.equal(storeWithAmountEntry.entryPercent, 30);
assert.equal(storeWithAmountEntry.entryCents, 30000);
assert.equal(storeWithAmountEntry.totalCents, Math.round(30000 + 70000 * (1 + defaultStoreRates[6] / 100)));

const visiblePayments = calculatePaymentOptions(100000, [
  { type: "card", installments: 12, enabled: true },
  { type: "store_financed", installments: 12, entryPercent: 30, enabled: true }
], cardRates, defaultStoreRates);
assert.equal(visiblePayments.length, 2);
assert.equal(visiblePayments[0].totalCents, card12x.totalCents);
assert.equal(visiblePayments[1].totalCents, storeFinanced.totalCents);
console.log("finance.test.mjs: ok");
