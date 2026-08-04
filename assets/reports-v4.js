/* Premium reports presentation. Keeps the existing CRM report calculations intact. */
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

  function daysBetween(start, end) {
    return start && end ? Math.max(0, Math.round((new Date(`${dateOnly(end)}T12:00:00`) - new Date(`${dateOnly(start)}T12:00:00`)) / 86400000)) : 0;
  }

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

  const palette = ["#D8AA7F", "#5E7484", "#6F8A7B", "#B99058", "#A87878", "#8B8585"];
  const emptyChart = (text) => `<div class="report-empty-chart"><span>Sem dados</span><small>${esc(text)}</small></div>`;
  const metric = (tone, label, value, detail, mark) => `<article class="report-metric report-metric-${tone}"><span class="report-metric-mark">${esc(mark)}</span><div><p>${esc(label)}</p><strong>${esc(value)}</strong><small>${esc(detail)}</small></div></article>`;
  const panelHead = (eyebrow, title, detail, control = "") => `<header class="report-panel-head"><div><span>${esc(eyebrow)}</span><h3>${esc(title)}</h3><p>${esc(detail)}</p></div>${control}</header>`;
  const select = (id, label, options, selected, allLabel) => `<label class="report-select"><span>${esc(label)}</span><select id="${id}"><option value="all">${esc(allLabel)}</option>${options.map((option) => `<option value="${esc(option.value)}" ${option.value === selected ? "selected" : ""}>${esc(option.label)}</option>`).join("")}</select></label>`;

  function donutChart(rows) {
    if (!rows.length) return emptyChart("Nenhum canal encontrado no periodo.");
    const total = rows.reduce((sum, row) => sum + row.leads, 0) || 1;
    let offset = 0;
    const stops = rows.map((row, index) => { const start = offset; offset += row.leads / total * 100; return `${palette[index % palette.length]} ${start}% ${offset}%`; }).join(", ");
    return `<div class="report-donut-layout"><div class="report-donut" style="--donut-stops:${stops}"><div><strong>${total}</strong><small>leads</small></div></div><div class="report-legend">${rows.map((row, index) => `<div><i style="background:${palette[index % palette.length]}"></i><span>${esc(row.name)}</span><strong>${row.leads}</strong></div>`).join("")}</div></div>`;
  }

  function channelBars(rows) {
    if (!rows.length) return emptyChart("Nenhum canal encontrado no periodo.");
    const max = Math.max(1, ...rows.map((row) => row.leads));
    return `<div class="report-channel-bars">${rows.map((row, index) => `<div class="report-channel-bar"><div class="report-channel-value">${row.leads}</div><div class="report-channel-track"><i style="height:${Math.max(6, Math.round(row.leads / max * 100))}%;background:${palette[index % palette.length]}"></i></div><small title="${esc(row.name)}">${esc(row.name)}</small></div>`).join("")}</div>`;
  }

  function funnel(rows) {
    if (!rows.length) return emptyChart("Nenhuma etapa encontrada no periodo.");
    const max = Math.max(1, ...rows.map((row) => row.count));
    return `<div class="report-funnel">${rows.map((row, index) => `<div class="report-funnel-row"><div><span class="report-funnel-index">${String(index + 1).padStart(2, "0")}</span><strong>${esc(row.name)}</strong></div><div class="report-funnel-track"><i style="width:${Math.max(row.count ? 7 : 0, Math.round(row.count / max * 100))}%"></i></div><div class="report-funnel-meta"><strong>${row.count}</strong><small>${money(row.value)}</small></div></div>`).join("")}</div>`;
  }

  function rankedBars(rows) {
    if (!rows.length) return emptyChart("Nenhuma parceria com venda no periodo.");
    const max = Math.max(1, rows[0].sales);
    return `<div class="report-ranked-bars">${rows.slice(0, 5).map((row, index) => `<div><span>${index + 1}</span><section><header><strong>${esc(row.name)}</strong><small>${money(row.sales)}</small></header><i><b style="width:${Math.max(4, Math.round(row.sales / max * 100))}%"></b></i></section><em>RT ${money(row.rt)}</em></div>`).join("")}</div>`;
  }

  function printReport(data, filters) {
    const popup = window.open("", "_blank", "width=980,height=760");
    if (!popup) return;
    const funnelValue = data.scoped.reduce((sum, lead) => sum + leadValue(lead), 0);
    const funnelTicket = data.scoped.length ? funnelValue / data.scoped.length : 0;
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatorio comercial GP Mirari</title><style>@page{size:A4;margin:14mm}*{box-sizing:border-box}body{font:12px Arial,sans-serif;color:#2f2f2f}header{display:flex;justify-content:space-between;gap:18px;border-bottom:2px solid #d8aa7f;padding-bottom:15px}h1{margin:0;font-size:24px}h2{font-size:15px;margin:28px 0 10px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:18px}.card{border:1px solid #eae6e1;border-radius:8px;padding:12px}.card small{display:block;color:#6d6a67}.card strong{display:block;font-size:17px;margin-top:5px}table{width:100%;border-collapse:collapse}th,td{padding:9px 6px;border-bottom:1px solid #eae6e1;text-align:left}th:not(:first-child),td:not(:first-child){text-align:right}.muted{color:#6d6a67}</style></head><body><header><div><h1>Relatorio comercial</h1><p class="muted">GP Mirari | ${dateBR(filters.start)} a ${dateBR(filters.end)}</p></div><strong>Gerado em ${dateBR(new Date().toISOString())}</strong></header><div class="grid"><div class="card"><small>Leads</small><strong>${data.summary.leads}</strong></div><div class="card"><small>Valor vendido</small><strong>${money(data.summary.soldValue)}</strong></div><div class="card"><small>Conversao</small><strong>${data.summary.conversion}%</strong></div><div class="card"><small>Ticket medio do funil</small><strong>${money(funnelTicket)}</strong></div><div class="card"><small>Ticket medio de orcamentos</small><strong>${money(data.summary.proposalTicket)}</strong></div><div class="card"><small>Ticket medio vendido</small><strong>${money(data.summary.salesTicket)}</strong></div></div><h2>Funil comercial</h2><table><thead><tr><th>Etapa</th><th>Oportunidades</th><th>Valor</th></tr></thead><tbody>${data.stages.map((row) => `<tr><td>${esc(row.name)}</td><td>${row.count}</td><td>${money(row.value)}</td></tr>`).join("")}</tbody></table><h2>Performance por canal</h2><table><thead><tr><th>Canal</th><th>Leads</th><th>Vendas</th><th>Conversao</th></tr></thead><tbody>${data.channels.map((row) => `<tr><td>${esc(row.name)}</td><td>${row.leads}</td><td>${row.won}</td><td>${row.leads ? Math.round(row.won / row.leads * 100) : 0}%</td></tr>`).join("") || '<tr><td colspan="4">Nenhum canal no periodo.</td></tr>'}</tbody></table><h2>Especificadores</h2><table><thead><tr><th>Parceiro</th><th>Vendido</th><th>RT</th></tr></thead><tbody>${data.partners.map((row) => `<tr><td>${esc(row.name)}</td><td>${money(row.sales)}</td><td>${money(row.rt)}</td></tr>`).join("") || '<tr><td colspan="3">Nenhuma venda vinculada.</td></tr>'}</tbody></table></body></html>`);
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
    const commercialProposals = local.stage && local.stage !== "all" ? data.proposals.filter((proposal) => commercialLeads.some((lead) => lead.id === (proposal.crmOpportunityRef || proposal.leadId || proposal.opportunityId))) : data.proposals;
    const marketingRows = local.channel && local.channel !== "all" ? data.channels.filter((row) => row.name === local.channel) : data.channels;
    const teamRows = local.owner && local.owner !== "all" ? data.team.filter((row) => row.id === local.owner) : data.team;
    const partnerRows = local.partner && local.partner !== "all" ? data.partners.filter((row) => row.id === local.partner) : data.partners;
    const commercialStages = local.stage && local.stage !== "all" ? data.stages.filter((stage) => stage.id === local.stage) : data.stages;
    const commercialSoldValue = commercialSold.reduce((sum, lead) => sum + leadValue(lead), 0);
    const commercialFunnelValue = commercialLeads.reduce((sum, lead) => sum + leadValue(lead), 0);
    const commercialTicket = commercialSold.length ? commercialSoldValue / commercialSold.length : 0;
    const commercialFunnelTicket = commercialLeads.length ? commercialFunnelValue / commercialLeads.length : 0;
    const commercialProposalTicket = commercialProposals.length ? commercialProposals.reduce((sum, proposal) => sum + Number(proposal.totalCents || 0) / 100, 0) / commercialProposals.length : 0;
    const commercialConversion = commercialLeads.length ? Math.round(commercialSold.length / commercialLeads.length * 100) : 0;
    const openPipeline = commercialLeads.filter((lead) => !isWon(lead) && !isLost(lead)).reduce((sum, lead) => sum + leadValue(lead), 0);
    const presets = [["month", "Este mes"], ["last_30", "Ultimos 30 dias"], ["quarter", "Trimestre"], ["year", "Este ano"], ["last_12", "Ultimos 12 meses"], ["custom", "Selecionar periodo"]];
    const custom = filters.preset === "custom";
    const marketingFilter = select("report-marketing-channel", "Canal", data.channels.map((row) => ({ value: row.name, label: row.name })), local.channel, "Todos os canais");
    const commercialFilter = select("report-commercial-stage", "Etapa", data.stages.map((row) => ({ value: row.id, label: row.name })), local.stage, "Todas as etapas");
    const teamFilter = select("report-team-owner", "Responsavel", data.team.map((row) => ({ value: row.id, label: row.name })), local.owner, "Toda a equipe");
    const partnerFilter = select("report-partner", "Especificador", data.partners.map((row) => ({ value: row.id, label: row.name })), local.partner, "Todos os especificadores");

    target.innerHTML = `<main class="reporting-workspace"><header class="reporting-header"><div><p>INTELIGENCIA COMERCIAL</p><h2>Relatorios e KPIs</h2><span>Uma visao executiva do CRM, propostas e parcerias.</span></div><div class="reporting-actions"><button class="saas-button" id="report-pdf" type="button">Gerar PDF</button><button class="saas-button primary" id="reports-refresh" type="button">Atualizar</button></div></header><section class="reporting-filterbar"><div class="reporting-date"><span>Periodo analisado</span><strong>${dateBR(filters.start)} - ${dateBR(filters.end)}</strong></div><div class="reporting-presets">${presets.map(([id, label]) => `<button class="${filters.preset === id ? "is-active" : ""}" data-report-preset="${id}" type="button">${label}</button>`).join("")}</div>${custom ? `<div class="reporting-custom-dates"><label>Inicio<input id="report-start" type="date" value="${esc(filters.start)}"></label><label>Fim<input id="report-end" type="date" value="${esc(filters.end)}"></label><button class="saas-button primary" id="reports-apply-period" type="button">Aplicar</button></div>` : ""}</section><section class="reporting-kpis">${metric("leads", "Total de leads", data.summary.leads, data.summary.mom === null ? "Sem comparativo anterior" : `${data.summary.mom >= 0 ? "+" : ""}${data.summary.mom.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. mes anterior`, "#")}${metric("pipeline", "Valor no funil", money(openPipeline), `${commercialLeads.length} oportunidade(s) no periodo`, "R$")}${metric("ticket", "Ticket medio do funil", money(commercialFunnelTicket), "Media dos cartoes no funil", "TM")}${metric("proposal", "Ticket medio de orcamentos", money(commercialProposalTicket), `${commercialProposals.length} proposta(s)`, "OR")}${metric("sold", "Valor vendido", money(commercialSoldValue), `${commercialSold.length} venda(s) fechada(s)`, "R$")}${metric("conversion", "Conversao comercial", `${commercialConversion}%`, `${data.lost.length} negocio(s) perdido(s)`, "%")}</section><section class="reporting-section"><header class="reporting-section-head"><div><span>01</span><div><p>MARKETING</p><h3>Atracao e topo de funil</h3></div></div>${marketingFilter}</header><div class="reporting-grid marketing"><article class="report-panel">${panelHead("ORIGEM", "Leads por canal", "Distribuicao das oportunidades no periodo.")}${donutChart(marketingRows)}</article><article class="report-panel">${panelHead("VOLUME", "Canais de aquisicao", "Comparativo visual de entrada de leads.")}${channelBars(marketingRows)}</article><article class="report-side-kpi"><span>Qualificacao</span><strong>${data.summary.qualification}%</strong><p>Leads que avancaram para briefing, medicao ou etapa posterior.</p><i><b style="width:${data.summary.qualification}%"></b></i></article></div></section><section class="reporting-section"><header class="reporting-section-head"><div><span>02</span><div><p>COMERCIAL</p><h3>Desempenho e funil de vendas</h3></div></div>${commercialFilter}</header><div class="reporting-grid commercial"><article class="report-panel report-panel-wide">${panelHead("PIPELINE", "Funil de vendas", "Quantidade de oportunidades e valor por etapa.")}${funnel(commercialStages)}</article><article class="report-panel report-closing-panel">${panelHead("FECHAMENTO", "Indicadores de venda", "Leitura rapida do periodo filtrado.")}<div class="report-closing-list"><div><span>Ticket medio vendido</span><strong>${money(commercialTicket)}</strong></div><div><span>Tempo medio de fechamento</span><strong>${data.summary.closeDays} dias</strong></div><div><span>Negocios perdidos</span><strong>${data.lost.length}</strong></div></div></article></div><article class="report-panel report-table-panel">${panelHead("CANAIS", "Performance por canal", "Leads, vendas, conversao e ticket medio.")}<div class="report-table-scroll"><table class="report-table"><thead><tr><th>Canal</th><th>Leads</th><th>Vendas</th><th>Conversao</th><th>Ticket medio</th></tr></thead><tbody>${channelRows(commercialLeads).map((row) => `<tr><td><span class="report-table-dot"></span><strong>${esc(row.name)}</strong></td><td>${row.leads}</td><td>${row.won}</td><td><span class="report-percent">${row.leads ? Math.round(row.won / row.leads * 100) : 0}%</span></td><td>${row.won ? money(row.value / row.won) : "-"}</td></tr>`).join("") || '<tr><td colspan="5" class="report-table-empty">Nenhum canal para o filtro selecionado.</td></tr>'}</tbody></table></div></article></section><section class="reporting-section"><header class="reporting-section-head"><div><span>03</span><div><p>EQUIPE E PARCERIAS</p><h3>Produtividade comercial</h3></div></div><div class="reporting-section-filters">${teamFilter}${partnerFilter}</div></header><div class="reporting-grid productivity"><article class="report-panel report-team-panel">${panelHead("EQUIPE", "Performance por projetista ou consultor", "Revisoes serao alimentadas pelos projetos relacionais futuramente.")}<div class="report-table-scroll"><table class="report-table"><thead><tr><th>Responsavel</th><th>Apresentados</th><th>Vendidos</th><th>Conversao</th><th>Ticket medio</th><th>Revisoes</th></tr></thead><tbody>${teamRows.map((row) => `<tr><td><strong>${esc(row.name)}</strong></td><td>${row.presented}</td><td>${row.sold}</td><td><span class="report-percent">${row.conversion}%</span></td><td>${money(row.ticket)}</td><td>${row.revisions}</td></tr>`).join("") || '<tr><td colspan="6" class="report-table-empty">Nenhum responsavel com atividade no periodo.</td></tr>'}</tbody></table></div></article><article class="report-panel report-partner-panel">${panelHead("TOP 5", "Arquitetos e especificadores", "Vendido e RT estimada no periodo.")}${rankedBars(partnerRows)}</article></div><div class="reporting-partner-kpis">${metric("partner", "Vendas por parcerias", money(partnerRows.reduce((sum, row) => sum + row.sales, 0)), "Especificadores vinculados", "R$")}${metric("rt", "RT / comissao estimada", money(partnerRows.reduce((sum, row) => sum + row.rt, 0)), "Analises de preco salvas", "RT")}</div></section><section class="reporting-section reporting-future"><header class="reporting-section-head"><div><span>04</span><div><p>PREPARACAO FUTURA</p><h3>Operacao, qualidade e pos-venda</h3></div></div><span class="report-future-badge">Aguardando dados operacionais</span></header><div class="reporting-future-grid"><div><span>Assistencia tecnica / avarias</span><strong>-</strong><small>Chamados por projeto vendido</small></div><div><span>Lead time de entrega e montagem</span><strong>-</strong><small>Fechamento ate montagem concluida</small></div><div><span>NPS / satisfacao</span><strong>-</strong><small>Pesquisa apos a montagem</small></div></div></section><footer class="reporting-source">Fonte: CRM, propostas, usuarios e especificadores. Atualizado conforme os filtros selecionados.</footer></main>`;

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
  setTimeout(() => { if (typeof window.render === "function") window.render(); }, 0);
})();
