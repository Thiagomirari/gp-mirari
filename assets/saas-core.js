/* GP Mirari MVP local: clientes e propostas comerciais. */
(function () {
  const LEGACY_KEY = "gpMirariV2LocalMvp.v1";
  const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const cents = (value) => {
    if (typeof value === "number" && Number.isInteger(value)) return Math.max(0, value);
    const normalized = String(value ?? "0").replace(/[^0-9,.-]/g, "").replace(/\./g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
  };
  const money = (value) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format((Number(value) || 0) / 100);
  const clampPercent = (value) => Math.max(0, Math.min(100, Number(String(value ?? 0).replace(",", ".")) || 0));
  const clampMarkup = (value) => Math.max(0, Math.min(1000, Number(String(value ?? 0).replace(",", ".")) || 0));
  const addPercentFromNet = (netCents, percent, taxPercent = 0) => {
    const rate = clampPercent(percent);
    const netRate = rate / 100 * (1 - clampPercent(taxPercent) / 100);
    return Math.max(0, Math.round(netCents / Math.max(0.0001, 1 - netRate)) - netCents);
  };
  const statusText = { draft: "Rascunho", negotiation: "Em negociacao", internal_review: "Em aprovacao", approved: "Aprovada", sent: "Enviada", accepted: "Aceita", rejected: "Recusada", cancelled: "Cancelada" };
  const defaultCardRates = { debit: 2.58, 1: 4.91, 2: 6.47, 3: 7.20, 4: 7.92, 5: 8.63, 6: 9.33, 7: 10.03, 8: 10.72, 9: 11.41, 10: 12.08, 11: 12.75, 12: 13.41 };
  const defaultStoreRates = Object.fromEntries(Array.from({ length: 24 }, (_, index) => { const installments = index + 1; return [installments, Number((((1.025 ** installments) - 1) * 100).toFixed(2))]; }));
  const paymentTypeText = { cash: "A vista", cash_entry: "A vista com entrada", pix: "Pix a vista", debit: "Debito", credit: "Credito a vista", card: "Cartao de credito", card_entry: "Cartao com entrada", store_financed: "Parcelado loja", store: "Parcelado loja", store_entry: "Parcelado loja" };
  const normalizeName = (value) => String(value || "").trim().toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");

  function calculateProposal(lines, discountPercent = 0, globalRtPercent, options = {}) {
    const usesGlobalRt = globalRtPercent !== undefined;
    const netRtTaxPercent = clampPercent(options.netRtTaxPercent);
    const items = (lines || []).filter((line) => line?.included !== false).map((line) => {
      const quantity = Math.max(.001, Number(line.quantity) || 0);
      const baseUnitCents = cents(line.baseUnitCents);
      const markupPercent = clampMarkup(line.markupPercent);
      const calculatedSubItems = (line.subItems || []).map((subItem) => {
        const subQuantity = Math.max(.001, Number(subItem.quantity) || 0);
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
      return { ...line, quantity, baseUnitCents, markupPercent, hasComposition, calculatedSubItems, environmentBaseCents, environmentMarkupCents, subItemsBaseCents, subItemsMarkupCents, subItemsSaleCents, baseCents, markupCents, afterMarkupCents, rtPercent, rtCents, finalUnitCents: Math.round(totalCents / quantity), totalCents };
    });
    const baseCents = items.reduce((sum, item) => sum + item.baseCents, 0);
    const markupCents = items.reduce((sum, item) => sum + item.markupCents, 0);
    const beforeGlobalRtCents = baseCents + markupCents;
    const appliedGlobalRtPercent = usesGlobalRt ? clampPercent(globalRtPercent) : 0;
    const globalRtCents = addPercentFromNet(beforeGlobalRtCents, appliedGlobalRtPercent, netRtTaxPercent);
    if (usesGlobalRt && globalRtCents) {
      let allocatedRtCents = 0;
      items.forEach((item, index) => { const rtCents = index === items.length - 1 ? globalRtCents - allocatedRtCents : Math.round(globalRtCents * (beforeGlobalRtCents ? item.afterMarkupCents / beforeGlobalRtCents : 0)); allocatedRtCents += rtCents; item.rtPercent = appliedGlobalRtPercent; item.rtCents = rtCents; item.totalCents = item.afterMarkupCents + rtCents; item.finalUnitCents = Math.round(item.totalCents / item.quantity); });
    }
    const rtCents = usesGlobalRt ? globalRtCents : items.reduce((sum, item) => sum + item.rtCents, 0);
    const beforeDiscountCents = beforeGlobalRtCents + rtCents;
    const discountCents = Math.round(beforeDiscountCents * clampPercent(discountPercent) / 100);
    if (discountCents) {
      let allocatedDiscountCents = 0;
      items.forEach((item, index) => {
        const itemDiscountCents = index === items.length - 1 ? discountCents - allocatedDiscountCents : Math.round(discountCents * (beforeDiscountCents ? item.totalCents / beforeDiscountCents : 0));
        allocatedDiscountCents += itemDiscountCents;
        item.discountCents = itemDiscountCents;
        item.totalCents = Math.max(0, item.totalCents - itemDiscountCents);
      });
    } else {
      items.forEach((item) => { item.discountCents = 0; });
    }
    return { items, baseCents, markupCents, rtCents, globalRtPercent: appliedGlobalRtPercent, discountCents, totalCents: Math.max(0, beforeDiscountCents - discountCents) };
  }

  function calculatePriceFormation(proposal = {}, formation = {}, contributors = [], paymentModels = []) {
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

  function buildInstallments(totalCents, count = 1, entryPercent = 0) {
    const total = Math.max(0, Number(totalCents) || 0); const quantity = Math.max(1, Math.min(24, Math.round(Number(count) || 1)));
    const entry = quantity > 1 ? Math.round(total * clampPercent(entryPercent) / 100) : total;
    const remaining = total - entry; const remainingCount = quantity - (entry ? 1 : 0); const base = remainingCount ? Math.floor(remaining / remainingCount) : 0;
    const rows = entry ? [{ position: 1, label: "Entrada", amountCents: entry }] : [];
    for (let index = 0; index < remainingCount; index += 1) rows.push({ position: rows.length + 1, label: `Parcela ${rows.length + 1}`, amountCents: base + (index === remainingCount - 1 ? remaining - base * remainingCount : 0) });
    return rows;
  }

  function cardReferenceCents(totalCents, rates = defaultCardRates) {
    const total = Math.max(0, Math.round(Number(totalCents) || 0));
    const fixedRate = Math.max(0, Number(rates?.fixed ?? rates?.[12] ?? defaultCardRates[12]));
    return Math.round(total / Math.max(0.0001, 1 - fixedRate / 100));
  }

  function calculatePaymentOption(totalCents, option = {}, rates = defaultCardRates, storeRates = defaultStoreRates) {
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

  function calculatePaymentOptions(totalCents, options = [], rates = defaultCardRates, storeRates = defaultStoreRates) {
    return (options || []).filter((option) => option.enabled).map((option) => calculatePaymentOption(totalCents, option, rates, storeRates));
  }

  class CommercialRepository {
    constructor(sharedState) { this.shared = sharedState; this.migrate(); }
    migrate() {
      this.shared.clients = this.shared.clients || [];
      this.shared.specifiers = this.shared.specifiers || [];
      this.shared.proposals = this.shared.proposals || [];
      const currentSettings = this.shared.commercialSettings || {};
      const pricing = currentSettings.pricing || {};
      this.shared.commercialSettings = { rtDefaultPercent: 0, markupDefaultPercent: 100, lockMarkup: true, operationalDiscountLimit: 10, ...currentSettings, cardFixedRate: Number(currentSettings.cardFixedRate ?? currentSettings.cardRates?.[12] ?? defaultCardRates[12]), cardRates: { ...defaultCardRates, ...(currentSettings.cardRates || {}) }, storeRates: { ...defaultStoreRates, ...(currentSettings.storeRates || {}) }, pricing: { taxPercent: 0, technicalReservePercent: 0, financialFeePercent: 0, freightMode: "production_percent", freightPercent: 12, assemblyBasis: "net_sale", assemblyMode: "percent", assemblyPercent: 10, contributors: [], ...pricing, contributors: Array.isArray(pricing.contributors) ? pricing.contributors : [] } };
      this.shared.proposals.forEach((proposal) => { proposal.groupId = proposal.groupId || proposal.id || uid("proposal_group"); proposal.version = Number(proposal.version) || 1; proposal.name = proposal.name || ""; proposal.items = (proposal.items || []).map((item) => ({ ...item, included: item.included !== false, subItems: Array.isArray(item.subItems) ? item.subItems : [] })); proposal.priceFormation = proposal.priceFormation || {}; });
      (this.shared.crm?.leads || []).forEach((lead) => { if (!lead.clientId) lead.clientId = this.findOrCreateClient(lead.client, { contact: lead.contact, source: "CRM" }).id; });
      (this.shared.projects || []).forEach((project) => { if (!project.clientId && project.client) project.clientId = this.findOrCreateClient(project.client, { source: "Projetos" }).id; });
      try {
        const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY));
        if (legacy?.proposals?.length && !this.shared.commercialLegacyMigrated) this.shared.proposals.push(...legacy.proposals.map((proposal) => ({ ...proposal, clientId: proposal.clientId || this.findOrCreateClient(proposal.clientName || "Cliente", {}).id })));
      } catch (_) {}
      this.shared.commercialLegacyMigrated = true;
    }
    findOrCreateClient(name, patch = {}) {
      const normalized = normalizeName(name); let client = this.shared.clients.find((item) => normalizeName(item.name) === normalized && (item.contact || "") === (patch.contact || ""));
      if (client) { Object.assign(client, patch, { updatedAt: new Date().toISOString() }); return client; }
      client = { id: uid("client"), name: String(name || "Cliente").trim(), personType: "PF", legalName: "", document: "", contact: "", email: "", zip: "", address: "", number: "", complement: "", district: "", city: "", state: "", notes: "", status: "prospect", history: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...patch };
      this.shared.clients.push(client); return client;
    }
    updateClient(id, patch, actor) { const client = this.shared.clients.find((item) => item.id === id); if (!client) return null; Object.assign(client, patch, { updatedAt: new Date().toISOString() }); client.history.unshift({ at: new Date().toISOString(), actor, text: "Cadastro atualizado." }); return client; }
    nextNumber() { const highest = this.shared.proposals.reduce((max, item) => Math.max(max, Number(String(item.number || "").replace(/\D/g, "")) || 0), 0); return `PM-${String(highest + 1).padStart(4, "0")}`; }
    proposal(id) { return this.shared.proposals.find((item) => item.id === id); }
    recordLeadHistory(opportunityRef, actor, text, at = new Date().toISOString()) {
      const lead = (this.shared.crm?.leads || []).find((item) => item.id === opportunityRef);
      if (!lead) return;
      const userId = (this.shared.users || []).find((user) => user.name === actor)?.id || "";
      lead.history = lead.history || [];
      lead.history.push({ at, userId, text });
      lead.updatedAt = at;
    }
    saveProposal(data, actor, id) {
      const current = id ? this.proposal(id) : null; if (current && !["draft", "negotiation"].includes(current.status)) return null;
      const now = new Date().toISOString();
      const inputItems = (data.items || []).map((item) => ({ ...item, id: item.id || uid("item"), included: item.included !== false }));
      const totals = calculateProposal(inputItems, data.discountPercent, data.globalRtEnabled ? data.globalRtPercent : 0, { netRtTaxPercent: this.shared.commercialSettings?.pricing?.taxPercent });
      const calculatedById = new Map(totals.items.map((item) => [item.id, item]));
      const record = { ...(current || { id: uid("proposal"), groupId: uid("proposal_group"), number: this.nextNumber(), version: 1, status: "draft", events: [], projectId: null, createdAt: now }), ...data, ...totals, items: inputItems.map((item) => ({ ...(calculatedById.get(item.id) || item), id: item.id, included: item.included !== false })), installments: buildInstallments(totals.totalCents, data.installmentCount, data.entryPercent), updatedAt: now };
      record.events.unshift({ at: now, actor, type: current ? "updated" : "created", summary: current ? "Proposta atualizada." : "Proposta criada." });
      if (current) Object.assign(current, record); else this.shared.proposals.unshift(record);
      this.recordLeadHistory(record.crmOpportunityRef, actor, current ? `Proposta ${record.number} atualizada.` : `Proposta ${record.number} criada e vinculada a oportunidade.` , now);
      return record;
    }
    transition(id, status, actor, note = "") { const proposal = this.proposal(id); const allowed = { draft:["negotiation","internal_review","cancelled"], negotiation:["internal_review","cancelled"], internal_review:["approved","negotiation"], approved:["sent","negotiation"], sent:["accepted","rejected","negotiation"], accepted:["negotiation"], rejected:[], cancelled:[] }; if (!proposal || !(allowed[proposal.status] || []).includes(status)) return null; proposal.status = status; proposal.updatedAt = new Date().toISOString(); const summary = note || statusText[status]; proposal.events.unshift({ at: proposal.updatedAt, actor, type: status, summary }); this.recordLeadHistory(proposal.crmOpportunityRef, actor, `Proposta ${proposal.number}: ${summary}.`, proposal.updatedAt); return proposal; }
    clone(id, actor) { const source = this.proposal(id); if (!source) return null; const clone = JSON.parse(JSON.stringify(source)); const groupId = source.groupId || source.id; const maxVersion = this.shared.proposals.filter((item) => (item.groupId || item.id) === groupId || item.number === source.number).reduce((max, item) => Math.max(max, Number(item.version) || 1), 0); clone.id = uid("proposal"); clone.groupId = groupId; clone.version = maxVersion + 1; clone.status = "draft"; clone.projectId = null; clone.createdAt = new Date().toISOString(); clone.updatedAt = clone.createdAt; clone.events = [{ at: clone.createdAt, actor, type:"version", summary:`Nova versao ${clone.version} criada a partir da versao ${source.version || 1}.` }]; this.shared.proposals.unshift(clone); this.recordLeadHistory(clone.crmOpportunityRef, actor, `Proposta ${clone.number}: versao ${clone.version} criada.`, clone.createdAt); return clone; }
  }
  globalThis.GPMirariCommercial = { uid, cents, money, clampPercent, clampMarkup, calculateProposal, calculatePriceFormation, buildInstallments, cardReferenceCents, calculatePaymentOption, calculatePaymentOptions, defaultCardRates, defaultStoreRates, paymentTypeText, statusText, CommercialRepository };
})();
