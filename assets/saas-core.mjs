/* Funcoes puras do MVP Clientes e Propostas, usadas nas validacoes locais. */

export const cents = (value) => {
  if (typeof value === "number" && Number.isInteger(value)) return Math.max(0, value);
  const normalized = String(value ?? "0").replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
};

export const clampPercent = (value) => Math.max(0, Math.min(100, Number(String(value ?? 0).replace(",", ".")) || 0));
export const clampMarkup = (value) => Math.max(0, Math.min(1000, Number(String(value ?? 0).replace(",", ".")) || 0));
const addPercentFromNet = (netCents, percent, taxPercent = 0) => {
  const rate = clampPercent(percent);
  const netRate = rate / 100 * (1 - clampPercent(taxPercent) / 100);
  return Math.max(0, Math.round(netCents / Math.max(0.0001, 1 - netRate)) - netCents);
};
export const defaultCardRates = { debit: 2.58, 1: 4.91, 2: 6.47, 3: 7.20, 4: 7.92, 5: 8.63, 6: 9.33, 7: 10.03, 8: 10.72, 9: 11.41, 10: 12.08, 11: 12.75, 12: 13.41 };
export const defaultStoreRates = Object.fromEntries(Array.from({ length: 24 }, (_, index) => { const installments = index + 1; return [installments, Number((((1.025 ** installments) - 1) * 100).toFixed(2))]; }));
export const paymentTypeText = { cash: "A vista", cash_entry: "A vista com entrada", pix: "Pix a vista", debit: "Debito", credit: "Credito a vista", card: "Cartao de credito", card_entry: "Cartao com entrada", store_financed: "Parcelado loja", store: "Parcelado loja", store_entry: "Parcelado loja" };

export function calculateProposal(lines, discountPercent = 0, globalRtPercent, options = {}) {
  const usesGlobalRt = globalRtPercent !== undefined;
  const netRtTaxPercent = clampPercent(options.netRtTaxPercent);
  const items = (lines || []).filter((line) => line?.included !== false).map((line) => {
    const quantity = Math.max(0.001, Number(line.quantity) || 0);
    const baseUnitCents = cents(line.baseUnitCents);
    const markupPercent = clampMarkup(line.markupPercent);
    const calculatedSubItems = (line.subItems || []).map((subItem) => {
      const subQuantity = Math.max(0.001, Number(subItem.quantity) || 0);
      const unitCostCents = cents(subItem.unitCostCents);
      const subMarkupPercent = clampMarkup(subItem.markupPercent ?? markupPercent);
      const baseCents = Math.round(unitCostCents * subQuantity);
      const markupCents = Math.round(baseCents * subMarkupPercent / 100);
      return { ...subItem, quantity: subQuantity, unitCostCents, markupPercent: subMarkupPercent, baseCents, markupCents, totalCents: baseCents + markupCents };
    });
    // A composed environment is priced exclusively from its subitems.
    const hasComposition = calculatedSubItems.length > 0;
    const environmentBaseCents = hasComposition ? 0 : Math.round(baseUnitCents * quantity);
    const environmentMarkupCents = Math.round(environmentBaseCents * markupPercent / 100);
    const subItemsBaseCents = calculatedSubItems.reduce((sum, subItem) => sum + subItem.baseCents, 0);
    const subItemsMarkupCents = calculatedSubItems.reduce((sum, subItem) => sum + subItem.markupCents, 0);
    const subItemsSaleCents = calculatedSubItems.reduce((sum, subItem) => sum + subItem.totalCents, 0);
    const baseCents = environmentBaseCents + subItemsBaseCents;
    const markupCents = environmentMarkupCents + subItemsMarkupCents;
    const afterMarkupCents = baseCents + markupCents;
    const rtPercent = usesGlobalRt ? 0 : (line.hasRt ? clampPercent(line.rtPercent) : 0);
    const rtCents = addPercentFromNet(afterMarkupCents, rtPercent, netRtTaxPercent);
    const totalCents = afterMarkupCents + rtCents;
    return { ...line, quantity, baseUnitCents, markupPercent, hasComposition, calculatedSubItems, environmentBaseCents, environmentMarkupCents, subItemsBaseCents, subItemsMarkupCents, subItemsSaleCents, baseCents, markupCents, afterMarkupCents, rtPercent, rtCents, totalCents };
  });
  const baseCents = items.reduce((sum, item) => sum + item.baseCents, 0);
  const markupCents = items.reduce((sum, item) => sum + item.markupCents, 0);
  const beforeGlobalRtCents = baseCents + markupCents;
  const appliedGlobalRtPercent = usesGlobalRt ? clampPercent(globalRtPercent) : 0;
  const globalRtCents = addPercentFromNet(beforeGlobalRtCents, appliedGlobalRtPercent, netRtTaxPercent);
  if (usesGlobalRt && globalRtCents) {
    let allocatedRtCents = 0;
    items.forEach((item, index) => { const rtCents = index === items.length - 1 ? globalRtCents - allocatedRtCents : Math.round(globalRtCents * (beforeGlobalRtCents ? item.afterMarkupCents / beforeGlobalRtCents : 0)); allocatedRtCents += rtCents; item.rtPercent = appliedGlobalRtPercent; item.rtCents = rtCents; item.totalCents = item.afterMarkupCents + rtCents; });
  }
  const rtCents = usesGlobalRt ? globalRtCents : items.reduce((sum, item) => sum + item.rtCents, 0);
  const beforeDiscountCents = beforeGlobalRtCents + rtCents;
  const discountCents = Math.round(beforeDiscountCents * clampPercent(discountPercent) / 100);
  if (discountCents) {
    let allocatedDiscountCents = 0;
    items.forEach((item, index) => {
      const itemDiscountCents = index === items.length - 1
        ? discountCents - allocatedDiscountCents
        : Math.round(discountCents * (beforeDiscountCents ? item.totalCents / beforeDiscountCents : 0));
      allocatedDiscountCents += itemDiscountCents;
      item.discountCents = itemDiscountCents;
      item.totalCents = Math.max(0, item.totalCents - itemDiscountCents);
    });
  } else {
    items.forEach((item) => { item.discountCents = 0; });
  }
  return { items, baseCents, markupCents, rtCents, globalRtPercent: appliedGlobalRtPercent, discountCents, totalCents: Math.max(0, beforeDiscountCents - discountCents) };
}

export function calculatePriceFormation(proposal = {}, formation = {}, contributors = [], paymentModels = []) {
  const calculated = calculateProposal(proposal.items || [], proposal.discountPercent, proposal.globalRtEnabled ? proposal.globalRtPercent : 0, { netRtTaxPercent: formation.taxPercent });
  const baseSaleCents = Math.max(0, Math.round(Number(proposal.totalCents ?? calculated.totalCents) || 0));
  const modelKey = formation.financialModelKey || "";
  const financialModel = (paymentModels || []).find((model) => model.key === modelKey) || null;
  const financialFeeCents = Math.max(0, Math.round(Number(financialModel?.amountCents) || 0));
  const saleCents = baseSaleCents + financialFeeCents;
  const itemSaleTotalCents = calculated.items.reduce((total, item) => total + item.totalCents, 0);
  let allocatedSaleCents = 0;
  const environments = calculated.items.map((item, index) => {
    const itemSaleCents = index === calculated.items.length - 1
      ? saleCents - allocatedSaleCents
      : Math.round(saleCents * (itemSaleTotalCents ? item.totalCents / itemSaleTotalCents : 0));
    allocatedSaleCents += itemSaleCents;
    return {
      id: item.id || "",
      name: item.name || "Ambiente",
      saleCents: itemSaleCents,
      purchaseCostCents: item.hasComposition ? item.subItemsBaseCents : item.environmentBaseCents
    };
  });
  const compositionCostCents = environments.reduce((total, item) => total + item.purchaseCostCents, 0);
  const purchaseExtraCents = cents(formation.purchaseExtraCents);
  const productionCostCents = compositionCostCents + purchaseExtraCents;
  const taxPercent = clampPercent(formation.taxPercent);
  const taxCents = Math.round(saleCents * taxPercent / 100);
  const netSaleBeforeRtCents = Math.max(0, saleCents - taxCents - financialFeeCents);
  const rtPercent = clampPercent(proposal.globalRtEnabled ? proposal.globalRtPercent : calculated.globalRtPercent);
  const rtCents = Math.round(netSaleBeforeRtCents * rtPercent / 100);
  const netSaleAfterRtCents = Math.max(0, netSaleBeforeRtCents - rtCents);
  const freightMode = formation.freightMode === "production_percent" ? "production_percent" : "amount";
  const freightPercent = clampPercent(formation.freightPercent);
  const freightCents = freightMode === "production_percent" ? Math.round(productionCostCents * freightPercent / 100) : cents(formation.freightCents);
  const assemblyBasis = formation.assemblyBasis === "production_cost" ? "production_cost" : "net_sale";
  const assemblyMode = formation.assemblyMode === "percent" ? "percent" : "amount";
  const assemblyBaseCents = assemblyBasis === "production_cost" ? productionCostCents : netSaleAfterRtCents;
  const assemblyPercent = clampPercent(formation.assemblyPercent);
  const assemblyCents = assemblyMode === "percent" ? Math.round(assemblyBaseCents * assemblyPercent / 100) : cents(formation.assemblyCents);
  const selectedContributorIds = Array.isArray(formation.contributorIds) ? formation.contributorIds : [];
  const commissionOverrides = formation.commissionOverrides && typeof formation.commissionOverrides === "object" ? formation.commissionOverrides : {};
  const selectedContributors = (contributors || []).filter((contributor) => contributor.active !== false && selectedContributorIds.includes(contributor.id));
  const commissions = selectedContributors.map((contributor) => {
    const percent = clampPercent(commissionOverrides[contributor.id] ?? contributor.commissionPercent);
    return { id: contributor.id, name: contributor.name, sector: contributor.sector || "Sem setor", percent, baseCents: netSaleAfterRtCents, amountCents: Math.round(netSaleAfterRtCents * percent / 100) };
  });
  const commissionCents = commissions.reduce((sum, commission) => sum + commission.amountCents, 0);
  const totalCostCents = productionCostCents + taxCents + rtCents + freightCents + financialFeeCents + assemblyCents + commissionCents;
  const contributionCents = saleCents - totalCostCents;
  const saleScore = productionCostCents ? saleCents / productionCostCents : 0;
  return { saleCents, baseSaleCents, netSaleBeforeRtCents, netSaleAfterRtCents, saleScore, environments, compositionCostCents, purchaseExtraCents, productionCostCents, purchaseCostCents: productionCostCents, taxPercent, taxCents, rtPercent, rtCents, freightMode, freightPercent, freightCents, assemblyBasis, assemblyMode, assemblyBaseCents, assemblyPercent, assemblyCents, financialModel, financialFeeCents, commissions, commissionCents, totalCostCents, contributionCents, contributionPercent: saleCents ? contributionCents * 100 / saleCents : 0 };
}

export function buildInstallments(totalCents, count = 1, entryPercent = 0) {
  const total = Math.max(0, Number(totalCents) || 0);
  const quantity = Math.max(1, Math.min(24, Math.round(Number(count) || 1)));
  const entry = quantity > 1 ? Math.round(total * clampPercent(entryPercent) / 100) : total;
  const remaining = total - entry;
  const remainingCount = quantity - (entry ? 1 : 0);
  const base = remainingCount ? Math.floor(remaining / remainingCount) : 0;
  const installments = entry ? [{ position: 1, label: "Entrada", amountCents: entry }] : [];
  for (let index = 0; index < remainingCount; index += 1) {
    installments.push({ position: installments.length + 1, label: `Parcela ${installments.length + 1}`, amountCents: base + (index === remainingCount - 1 ? remaining - base * remainingCount : 0) });
  }
  return installments;
}

export function cardReferenceCents(totalCents, rates = defaultCardRates) {
  const total = Math.max(0, Math.round(Number(totalCents) || 0));
  const fixedRate = Math.max(0, Number(rates?.fixed ?? rates?.[12] ?? defaultCardRates[12]));
  return Math.round(total / Math.max(0.0001, 1 - fixedRate / 100));
}

export function calculatePaymentOption(totalCents, option = {}, rates = defaultCardRates, storeRates = defaultStoreRates) {
  const total = Math.max(0, Math.round(Number(totalCents) || 0));
  const type = paymentTypeText[option.type] ? option.type : "cash";
  const hasEntry = type === "card_entry" || type === "store_entry" || type === "store_financed" || type === "cash_entry";
  const isFixedCard = type === "debit" || type === "credit" || type === "card" || type === "card_entry";
  const isStore = type === "store" || type === "store_entry" || type === "store_financed";
  let installments = Math.max(1, Math.round(Number(option.installments) || 1));
  if (type === "card") installments = Math.min(12, installments);
  else if (type === "card_entry") installments = Math.min(12, installments);
  else if (isStore) installments = Math.min(24, installments);
  else if (type === "cash_entry") installments = Math.min(5, installments);
  else installments = 1;
  const fixedCardRate = Math.max(0, Number(rates?.fixed ?? rates?.[12] ?? defaultCardRates[12]));
  const conditionBaseCents = isFixedCard
    ? cardReferenceCents(total, rates)
    : (type === "cash_entry" ? Math.round(cardReferenceCents(total, rates) * .95) : total);
  const entryMode = hasEntry && option.entryMode === "amount" ? "amount" : "percent";
  const requestedEntryCents = Math.max(0, Math.round(Number(option.entryCents) || 0));
  const entryPercent = hasEntry && entryMode === "amount"
    ? (conditionBaseCents ? Math.min(100, requestedEntryCents * 100 / conditionBaseCents) : 0)
    : (hasEntry ? clampPercent(option.entryPercent) : 0);
  const entryCents = hasEntry
    ? (entryMode === "amount" ? Math.min(conditionBaseCents, requestedEntryCents) : Math.round(conditionBaseCents * entryPercent / 100))
    : 0;
  const financedBaseCents = conditionBaseCents - entryCents;
  const feePercent = isStore ? Math.max(0, Number(storeRates?.[installments] ?? defaultStoreRates[installments] ?? 0)) : (isFixedCard ? fixedCardRate : 0);
  const financedTotalCents = isStore ? Math.round(financedBaseCents * (1 + feePercent / 100)) : financedBaseCents;
  const feeCents = financedTotalCents - financedBaseCents;
  const rawSplits = Array.isArray(option.installmentSplits) ? option.installmentSplits : [];
  const hasCustomSplits = type === "cash_entry" && rawSplits.length === installments;
  let installmentPayments;
  if (hasCustomSplits) {
    installmentPayments = rawSplits.map((split, index) => {
      const mode = split?.mode === "amount" ? "amount" : "percent";
      const amountCents = mode === "amount"
        ? Math.max(0, Math.round(Number(split?.amountCents ?? split?.cents) || 0))
        : Math.max(0, Math.round(conditionBaseCents * clampPercent(split?.percent) / 100));
      return { number: index + 1, mode, amountCents, percent: conditionBaseCents ? amountCents * 100 / conditionBaseCents : 0 };
    });
  } else {
    installmentPayments = buildInstallments(financedTotalCents, installments, 0).map((item) => ({ ...item, mode: "amount", percent: conditionBaseCents ? item.amountCents * 100 / conditionBaseCents : 0 }));
  }
  const installmentAllocatedCents = installmentPayments.reduce((sum, item) => sum + item.amountCents, 0);
  const installmentRemainingCents = type === "cash_entry" ? financedBaseCents - installmentAllocatedCents : 0;
  return { ...option, type, label: paymentTypeText[type], installments, entryMode, entryPercent, entryCents, conditionBaseCents, financedBaseCents, feePercent, feeCents, financedTotalCents, installmentPayments, installmentAllocatedCents, installmentRemainingCents, installmentCents: Math.round(financedTotalCents / installments), totalCents: entryCents + financedTotalCents };
}

export function calculatePaymentOptions(totalCents, options = [], rates = defaultCardRates, storeRates = defaultStoreRates) {
  return (options || []).filter((option) => option.enabled).map((option) => calculatePaymentOption(totalCents, option, rates, storeRates));
}
