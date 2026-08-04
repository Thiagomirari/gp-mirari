/* Dashboard comercial unificado: CRM, propostas e especificadores. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const dateOnly = (value) => String(value || "").slice(0, 10);
  const iso = (date) => new Date(date).toISOString().slice(0, 10);
  const dateBR = (value) => { const date = dateOnly(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return String(value || "-"); const [year, month, day] = date.split("-"); return `${day}/${month}/${year}`; };

  function amount(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    let text = String(value ?? "").trim().replace(/R\$|\s/g, "");
    if (!text) return 0;
    if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
    else if ((text.match(/\./g) || []).length > 1) text = text.replace(/\./g, "");
    const parsed = Number(text.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const money = (value) => amount(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const activeStages = () => (state.crm?.stages || []).filter((stage) => stage.active !== false);
  const stageFor = (lead) => activeStages().find((stage) => stage.id === lead.stageId) || {};
  const clientFor = (lead) => (state.clients || []).find((client) => client.id === lead.clientId);
  const specifierFor = (id) => (state.specifiers || []).find((item) => item.id === id);
  const firstContact = (lead) => dateOnly(lead.crmDates?.firstContact || lead.firstContactDate || lead.createdAt || lead.enteredAt);
  const inRange = (value, filters) => { const date = dateOnly(value); return !!date && date >= filters.start && date <= filters.end; };
  const stageName = (lead) => String(stageFor(lead).name || "").toLowerCase();
  const isWon = (lead) => { const stage = stageFor(lead); return ["Ganha", "Ganho", "Fechada"].includes(String(lead.status || "")) || stage.closedType === "won" || Number(stage.probability || 0) === 100 || /fechad|ganh|vendid/.test(stageName(lead)); };
  const isLost = (lead) => { const stage = stageFor(lead); return ["Perdida", "Perdido"].includes(String(lead.status || "")) || stage.closedType === "lost" || /perdid/.test(stageName(lead)); };
  const isQualified = (lead) => !!(lead.crmDates?.briefing || lead.crmDates?.projectReceived || /medic|briefing|projeto|apresent|proposta|fechad|ganh|vendid/.test(stageName(lead)));
  const specifierId = (lead) => lead.specifierId || clientFor(lead)?.specifierId || "";

  function leadValue(lead) {
    const direct = amount(lead.closedValue || lead.value || lead.estimatedValue);
    if (direct) return direct;
    return (state.proposals || []).filter((proposal) => !proposal.archivedAt && proposal.crmOpportunityRef === lead.id).reduce((max, proposal) => Math.max(max, Number(proposal.totalCents || 0) / 100), 0);
  }

  function periodFor(preset) {
    const now = new Date(); const year = now.getFullYear(); const month = now.getMonth();
    if (preset === "last_30") return { preset, start: iso(new Date(year, month, now.getDate() - 29)), end: iso(now) };
    if (preset === "last_12") return { preset, start: iso(new Date(year - 1, month, now.getDate() + 1)), end: iso(now) };
    if (preset === "year") return { preset, start: `${year}-01-01`, end: `${year}-12-31` };
    if (preset === "quarter") { const first = Math.floor(month / 3) * 3; return { preset, start: iso(new Date(year, first, 1)), end: iso(new Date(year, first + 3, 0)) }; }
    return { preset: "month", start: iso(new Date(year, month, 1)), end: iso(new Date(year, month + 1, 0)) };
  }

  function channelRows(leads) {
    const rows = new Map();
    leads.forEach((lead) => { const name = lead.source || "Nao informado"; const row = rows.get(name) || { name, leads: 0, won: 0, value: 0 }; row.leads += 1; row.value += leadValue(lead); if (isWon(lead)) row.won += 1; rows.set(name, row); });
    return [...rows.values()].sort((a, b) => b.leads - a.leads);
  }

  function daysBetween(start, end) { return start && end ? Math.max(0, Math.round((new Date(`${dateOnly(end)}T12:00:00`) - new Date(`${dateOnly(start)}T12:00:00`)) / 86400000)) : 0; }

  function dataFor(filters) {
    const all = state.crm?.leads || [];
    const scoped = all.filter((lead) => inRange(firstContact(lead), filters));
    const sold = all.filter((lead) => isWon(lead) && inRange(lead.crmDates?.closed || lead.updatedAt || firstContact(lead), filters));
    const lost = all.filter((lead) => isLost(lead) && inRange(lead.crmDates?.lost || lead.updatedAt || firstContact(lead), filters));
    const scopedLeadIds = new Set(scoped.map((lead) => lead.id));
    const proposals = (state.proposals || []).filter((proposal) => {
      if (proposal.archivedAt) return false;
      const opportunityId = proposal.crmOpportunityRef || proposal.leadId || proposal.opportunityId || "";
      return inRange(proposal.createdAt || proposal.updatedAt, filters) || (opportunityId && scopedLeadIds.has(opportunityId));
    });
    const stages = activeStages().map((stage) => { const leads = scoped.filter((lead) => lead.stageId === stage.id); return { id: stage.id, name: stage.name || "Etapa", count: leads.length, value: leads.reduce((sum, lead) => sum + leadValue(lead), 0), probability: Number(stage.probability || 0) }; });
    const partners = new Map();
    sold.forEach((lead) => { const id = specifierId(lead); if (!id) return; const proposal = (state.proposals || []).filter((item) => item.crmOpportunityRef === lead.id).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0]; const row = partners.get(id) || { id, name: specifierFor(id)?.name || "Especificador", sales: 0, rt: 0 }; row.sales += leadValue(lead); row.rt += Number(proposal?.priceFormationHistory?.[0]?.analysis?.rtCents || proposal?.priceFormation?.rtCents || 0) / 100; partners.set(id, row); });
    const team = (state.users || []).filter((user) => user.active !== false).map((user) => { const owned = scoped.filter((lead) => lead.ownerId === user.id); const sales = sold.filter((lead) => lead.ownerId === user.id); return { id: user.id, name: user.name, presented: owned.filter(isQualified).length, sold: sales.length, conversion: owned.length ? Math.round(sales.length / owned.length * 100) : 0, ticket: sales.length ? sales.reduce((sum, lead) => sum + leadValue(lead), 0) / sales.length : 0, revisions: 0 }; }).filter((row) => row.presented || row.sold);
    const previousStart = new Date(`${filters.start}T12:00:00`); previousStart.setMonth(previousStart.getMonth() - 1);
    const previousEnd = new Date(`${filters.start}T12:00:00`); previousEnd.setDate(0);
    const previous = all.filter((lead) => { const date = firstContact(lead); return date >= iso(previousStart) && date <= iso(previousEnd); });
    const partnerRows = [...partners.values()].sort((a, b) => b.sales - a.sales);
    return { all, scoped, sold, lost, proposals, stages, channels: channelRows(scoped), team, partners: partnerRows, summary: { leads: scoped.length, mom: previous.length ? (scoped.length - previous.length) / previous.length * 100 : null, qualification: scoped.length ? Math.round(scoped.filter(isQualified).length / scoped.length * 100) : 0, proposalTicket: proposals.length ? proposals.reduce((sum, proposal) => sum + Number(proposal.totalCents || 0) / 100, 0) / proposals.length : 0, soldValue: sold.reduce((sum, lead) => sum + leadValue(lead), 0), salesTicket: sold.length ? sold.reduce((sum, lead) => sum + leadValue(lead), 0) / sold.length : 0, conversion: scoped.length ? Math.round(sold.length / scoped.length * 100) : 0, closeDays: sold.length ? Math.round(sold.reduce((sum, lead) => sum + daysBetween(firstContact(lead), lead.crmDates?.closed || lead.updatedAt), 0) / sold.length) : 0, partnerSales: partnerRows.reduce((sum, row) => sum + row.sales, 0), partnerRt: partnerRows.reduce((sum, row) => sum + row.rt, 0) } };
  }

  function card(label, value, detail, tone = "") { return `<article class="saas-report-kpi ${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></article>`; }
  function horizontalBars(rows, total, description, field = "leads") { if (!rows.length) return '<p class="saas-empty">Nenhum registro para este periodo.</p>'; return rows.map((row) => { const value = Number(row[field] ?? row.count ?? 0); const width = total ? Math.max(4, Math.round(value / total * 100)) : 0; return `<div class="kpi-bar-row"><div><strong>${esc(row.name)}</strong><small>${esc(description(row))}</small></div><div class="kpi-bar-track"><i style="width:${width}%"></i></div><b>${value}</b></div>`; }).join(""); }
  function columnChart(rows, field, description) { const max = Math.max(1, ...rows.map((row) => Number(row[field] || 0))); return `<div class="kpi-column-chart">${rows.map((row) => `<div class="kpi-column"><i style="height:${Math.max(5, Math.round(Number(row[field] || 0) / max * 100))}%" title="${esc(description(row))}"></i><strong>${Number(row[field] || 0)}</strong><small>${esc(row.name)}</small></div>`).join("")}</div>`; }
  function sectionHead(number, eyebrow, title, filterHtml = "") { return `<header class="saas-report-block-head"><div><span>${number}</span><div><p class="saas-eyebrow">${eyebrow}</p><h3>${title}</h3></div></div>${filterHtml}</header>`; }
  function select(id, label, options, selected, allLabel) { return `<label class="saas-field kpi-local-filter">${label}<select class="saas-select" id="${id}"><option value="all">${allLabel}</option>${options.map((option) => `<option value="${esc(option.value)}" ${option.value === selected ? "selected" : ""}>${esc(option.label)}</option>`).join("")}</select></label>`; }

  function printReport(data, filters) {
    const popup = window.open("", "_blank", "width=980,height=760");
    if (!popup) return;
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatorio comercial GP Mirari</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#2f2f2f}header{display:flex;justify-content:space-between;border-bottom:2px solid #d8aa7f;padding-bottom:15px}h1{margin:0;font-size:24px}h2{font-size:15px;margin:28px 0 10px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:18px}.card{border:1px solid #eae6e1;border-radius:8px;padding:12px}.card small{display:block;color:#6d6a67}.card strong{display:block;font-size:18px;margin-top:5px}table{width:100%;border-collapse:collapse}th,td{padding:9px 6px;border-bottom:1px solid #eae6e1;text-align:left}th:not(:first-child),td:not(:first-child){text-align:right}.muted{color:#6d6a67}</style></head><body><header><div><h1>Relatorio comercial</h1><p class="muted">GP Mirari | ${dateBR(filters.start)} a ${dateBR(filters.end)}</p></div><strong>Gerado em ${dateBR(new Date().toISOString())}</strong></header><div class="grid"><div class="card"><small>Leads</small><strong>${data.summary.leads}</strong></div><div class="card"><small>Valor vendido</small><strong>${money(data.summary.soldValue)}</strong></div><div class="card"><small>Conversao</small><strong>${data.summary.conversion}%</strong></div><div class="card"><small>Ticket medio vendido</small><strong>${money(data.summary.salesTicket)}</strong></div></div><h2>Funil comercial</h2><table><thead><tr><th>Etapa</th><th>Oportunidades</th><th>Valor</th></tr></thead><tbody>${data.stages.map((row) => `<tr><td>${esc(row.name)}</td><td>${row.count}</td><td>${money(row.value)}</td></tr>`).join("")}</tbody></table><h2>Performance por canal</h2><table><thead><tr><th>Canal</th><th>Leads</th><th>Vendas</th><th>Conversao</th></tr></thead><tbody>${data.channels.map((row) => `<tr><td>${esc(row.name)}</td><td>${row.leads}</td><td>${row.won}</td><td>${row.leads ? Math.round(row.won / row.leads * 100) : 0}%</td></tr>`).join("")}</tbody></table><h2>Especificadores</h2><table><thead><tr><th>Parceiro</th><th>Vendido</th><th>RT</th></tr></thead><tbody>${data.partners.map((row) => `<tr><td>${esc(row.name)}</td><td>${money(row.sales)}</td><td>${money(row.rt)}</td></tr>`).join("") || '<tr><td colspan="3">Nenhuma venda vinculada.</td></tr>'}</tbody></table></body></html>`);
    popup.document.close();
  }

  function dashboardMetrics() {
    const filters = window.reportFilters?.start ? window.reportFilters : periodFor("month");
    const data = dataFor(filters);
    const openPipeline = data.scoped.filter((lead) => !isWon(lead) && !isLost(lead)).reduce((sum, lead) => sum + leadValue(lead), 0);
    return { leads: data.summary.leads, pipeline: openPipeline, sold: data.summary.soldValue, conversion: data.summary.conversion, lost: data.lost.length, filters };
  }

  function render() {
    const target = $("tab-reports");
    if (!target || state.activeTab !== "reports") return;
    let filters = window.reportFilters;
    if (!filters?.start || !filters?.end) { filters = periodFor("month"); window.reportFilters = filters; }
    const local = window.reportBlockFilters || {};
    const data = dataFor(filters);
    const commercialLeads = local.stage && local.stage !== "all" ? data.scoped.filter((lead) => stageFor(lead).id === local.stage) : data.scoped;
    const commercialSold = local.stage && local.stage !== "all" ? data.sold.filter((lead) => stageFor(lead).id === local.stage) : data.sold;
    const commercialProposals = local.stage && local.stage !== "all" ? data.proposals.filter((proposal) => commercialLeads.some((lead) => lead.id === proposal.crmOpportunityRef)) : data.proposals;
    const commercialChannels = channelRows(commercialLeads);
    const commercialStages = local.stage && local.stage !== "all" ? data.stages.filter((stage) => stage.id === local.stage) : data.stages;
    const marketing = local.channel && local.channel !== "all" ? data.channels.filter((row) => row.name === local.channel) : data.channels;
    const team = local.owner && local.owner !== "all" ? data.team.filter((row) => row.id === local.owner) : data.team;
    const partners = local.partner && local.partner !== "all" ? data.partners.filter((row) => row.id === local.partner) : data.partners;
    const commercialSoldValue = commercialSold.reduce((sum, lead) => sum + leadValue(lead), 0);
    const commercialTicket = commercialSold.length ? commercialSoldValue / commercialSold.length : 0;
    const commercialProposalTicket = commercialProposals.length ? commercialProposals.reduce((sum, proposal) => sum + Number(proposal.totalCents || 0) / 100, 0) / commercialProposals.length : 0;
    const commercialConversion = commercialLeads.length ? Math.round(commercialSold.length / commercialLeads.length * 100) : 0;
    const presets = [["month", "Este mes"], ["last_30", "Ultimos 30 dias"], ["quarter", "Trimestre"], ["year", "Este ano"], ["last_12", "Ultimos 12 meses"], ["custom", "Selecionar periodo"]];
    const marketingFilter = select("report-marketing-channel", "Canal", data.channels.map((row) => ({ value: row.name, label: row.name })), local.channel, "Todos os canais");
    const commercialFilter = select("report-commercial-stage", "Etapa", data.stages.map((row) => ({ value: row.id, label: row.name })), local.stage, "Todas as etapas");
    const teamFilter = select("report-team-owner", "Responsavel", data.team.map((row) => ({ value: row.id, label: row.name })), local.owner, "Toda a equipe");
    const partnerFilter = select("report-partner", "Especificador", data.partners.map((row) => ({ value: row.id, label: row.name })), local.partner, "Todos os especificadores");
    const custom = filters.preset === "custom";
    target.innerHTML = `<main class="saas-module reports-module"><div class="saas-module-head"><div><p class="saas-eyebrow">Inteligencia comercial</p><h2>Relatorios e KPIs</h2><p>Indicadores do CRM, propostas e parcerias no periodo selecionado.</p></div><div class="saas-actions"><button class="saas-button" id="report-pdf" type="button">Gerar PDF</button><button class="saas-button" id="reports-refresh" type="button">Atualizar</button></div></div><section class="saas-report-period"><div><p class="saas-eyebrow">Periodo do relatorio</p><strong>${esc(filters.start)} a ${esc(filters.end)}</strong></div><div class="saas-period-presets">${presets.map(([id, label]) => `<button class="saas-button ${filters.preset === id ? "primary" : ""}" data-report-preset="${id}" type="button">${label}</button>`).join("")}</div>${custom ? `<div class="saas-report-custom"><label>Inicio<input class="saas-input" id="report-start" type="date" value="${esc(filters.start)}"></label><label>Fim<input class="saas-input" id="report-end" type="date" value="${esc(filters.end)}"></label><button class="saas-button primary" id="reports-apply-period" type="button">Aplicar periodo</button></div>` : ""}</section><section class="saas-report-block">${sectionHead("01", "Atracao e topo de funil", "Marketing", marketingFilter)}<div class="saas-report-grid compact">${card("Total de leads", data.summary.leads, data.summary.mom === null ? "Sem base no mes anterior" : `${data.summary.mom >= 0 ? "+" : ""}${data.summary.mom.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. mes anterior`, data.summary.mom >= 0 ? "positive" : "")}${card("Taxa de qualificacao", `${data.summary.qualification}%`, "Briefing, medicao ou etapa posterior")}</div><section class="saas-report-panel"><div class="saas-section-heading"><div><span>Grafico</span><h4>Leads por canal</h4></div><p>Distribuicao no periodo.</p></div>${columnChart(marketing, "leads", (row) => `${row.name}: ${row.leads} leads`)}</section></section><section class="saas-report-block">${sectionHead("02", "Desempenho comercial", "Funil de vendas", commercialFilter)}<div class="saas-report-grid five">${card("Ticket medio de orcamentos", money(commercialProposalTicket), `${commercialProposals.length} proposta(s)`) }${card("Ticket medio vendido", money(commercialTicket), `${commercialSold.length} venda(s)`) }${card("Valor vendido", money(commercialSoldValue), "Vendas fechadas no periodo", "positive")}${card("Conversao", `${commercialConversion}%`, "Leads que viraram venda")}${card("Negocios perdidos", data.lost.length, "Perdidos no periodo")}</div><div class="saas-report-columns"><section class="saas-report-panel"><div class="saas-section-heading"><div><span>Grafico</span><h4>Funil por etapa</h4></div><p>Volume e valor de oportunidade.</p></div>${horizontalBars(commercialStages, Math.max(1, commercialStages.reduce((sum, row) => sum + row.count, 0)), (row) => `${row.probability}% | ${money(row.value)}`, "count")}</section><section class="saas-report-panel"><div class="saas-section-heading"><div><span>Resumo</span><h4>Fechamento</h4></div><p>Venda, ticket e prazo medio.</p></div>${card("Tempo medio de fechamento", `${data.summary.closeDays} dias`, "Do primeiro contato ao fechamento")}${card("Valor no funil", money(commercialLeads.filter((lead) => !isWon(lead) && !isLost(lead)).reduce((sum, lead) => sum + leadValue(lead), 0)), "Oportunidades abertas")}</section></div><section class="saas-table-wrap"><div class="saas-section-heading"><div><span>Canal</span><h4>Performance por canal</h4></div><p>Aplicada ao filtro desta camada.</p></div><table class="saas-table"><thead><tr><th>Canal</th><th>Leads</th><th>Vendas</th><th>Conversao</th><th>Ticket medio</th></tr></thead><tbody>${commercialChannels.map((row) => `<tr><td><strong>${esc(row.name)}</strong></td><td>${row.leads}</td><td>${row.won}</td><td>${row.leads ? Math.round(row.won / row.leads * 100) : 0}%</td><td>${row.won ? money(row.value / row.won) : "-"}</td></tr>`).join("") || '<tr><td colspan="5">Nenhum canal para o filtro selecionado.</td></tr>'}</tbody></table></section></section><section class="saas-report-block">${sectionHead("03", "Produtividade e parcerias", "Equipe e especificadores", `<div class="saas-local-filter-group">${teamFilter}${partnerFilter}</div>`)}<section class="saas-table-wrap"><div class="saas-section-heading"><div><span>Equipe</span><h4>Performance por projetista ou consultor</h4></div><p>Revisoes serao alimentadas pelos projetos relacionais futuramente.</p></div><table class="saas-table"><thead><tr><th>Responsavel</th><th>Apresentados</th><th>Vendidos</th><th>Conversao</th><th>Ticket medio</th><th>Revisoes</th></tr></thead><tbody>${team.map((row) => `<tr><td><strong>${esc(row.name)}</strong></td><td>${row.presented}</td><td>${row.sold}</td><td>${row.conversion}%</td><td>${money(row.ticket)}</td><td>${row.revisions}</td></tr>`).join("") || '<tr><td colspan="6">Nenhum responsavel com atividade no periodo.</td></tr>'}</tbody></table></section><div class="saas-report-grid compact">${card("Vendas por parcerias", money(partners.reduce((sum, row) => sum + row.sales, 0)), "Especificadores vinculados aos clientes ou oportunidades")}${card("RT / comissao estimada", money(partners.reduce((sum, row) => sum + row.rt, 0)), "Analises de preco salvas")}</div><section class="saas-report-panel"><div class="saas-section-heading"><div><span>Grafico</span><h4>Top 5 arquitetos e parceiros</h4></div><p>Vendido e RT no periodo.</p></div>${horizontalBars(partners.slice(0, 5).map((row) => ({ ...row, count: Math.round(row.sales) })), Math.max(1, partners[0]?.sales || 0), (row) => `${money(row.sales)} | RT ${money(row.rt)}`, "count")}</section></section><section class="saas-report-block future">${sectionHead("04", "Preparacao futura", "Operacao, qualidade e pos-venda", '<span class="saas-badge muted">Aguardando dados operacionais</span>')}<div class="saas-report-grid compact">${card("Assistencia tecnica / avarias", "-", "Chamados pos-venda por projeto vendido")}${card("Lead time entrega e montagem", "-", "Fechamento ate montagem concluida")}${card("NPS / satisfacao", "-", "Pesquisa apos a montagem")}</div><p class="saas-report-note">Esta estrutura esta pronta para receber os marcos operacionais da aba de Projetos em uma proxima etapa.</p></section><p class="saas-report-source">Fonte atual: CRM, propostas, usuarios e especificadores. A migracao relacional do Supabase continua preservada para a proxima etapa.</p></main>`;
    const periodLabel = target.querySelector(".saas-report-period strong");
    if (periodLabel) periodLabel.textContent = `${dateBR(filters.start)} a ${dateBR(filters.end)}`;
    document.querySelectorAll("[data-report-preset]").forEach((button) => button.onclick = () => { window.reportFilters = button.dataset.reportPreset === "custom" ? { ...filters, preset: "custom" } : periodFor(button.dataset.reportPreset); refreshApp(); });
    $("reports-apply-period")?.addEventListener("click", () => { window.reportFilters = { preset: "custom", start: $("report-start").value || filters.start, end: $("report-end").value || filters.end }; refreshApp(); });
    $("reports-refresh").onclick = refreshApp;
    $("report-pdf").onclick = () => printReport(dataFor(window.reportFilters), window.reportFilters);
    $("report-marketing-channel")?.addEventListener("change", (event) => { window.reportBlockFilters = { ...local, channel: event.target.value }; render(); });
    $("report-commercial-stage")?.addEventListener("change", (event) => { window.reportBlockFilters = { ...local, stage: event.target.value }; render(); });
    $("report-team-owner")?.addEventListener("change", (event) => { window.reportBlockFilters = { ...local, owner: event.target.value }; render(); });
    $("report-partner")?.addEventListener("change", (event) => { window.reportBlockFilters = { ...local, partner: event.target.value }; render(); });
  }

  function refreshApp() { if (typeof window.render === "function") window.render(); else render(); }
  window.GPMirariReports = { render, dashboardMetrics };
  // The base application renders before this optional module is loaded.
  setTimeout(() => { if (typeof window.render === "function") window.render(); }, 0);
})();
