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

  const reportUser = (id) => (state.users || []).find((user) => user.id === id) || {};

  function matchesGlobalFilters(lead) {
    const global = window.reportGlobalFilters || {};
    if (global.team && global.team !== "all" && String(reportUser(lead.ownerId).role || "Sem equipe") !== global.team) return false;
    if (global.owner && global.owner !== "all" && lead.ownerId !== global.owner) return false;
    if (global.stage && global.stage !== "all" && lead.stageId !== global.stage) return false;
    if (global.source && global.source !== "all" && String(lead.source || "Nao informado") !== global.source) return false;
    return true;
  }

  function dataFor(filters) {
    const all = (state.crm?.leads || []).filter(matchesGlobalFilters);
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

  function taskMetrics(data, filters) {
    const leadIds = new Set(data.scoped.map((lead) => lead.id));
    const tasks = (state.crm?.tasks || []).filter((task) => {
      if (!leadIds.has(task.leadId) || task.status === "Cancelada") return false;
      return inRange(task.dueDate || task.createdAt, filters) || inRange(task.completedAt, filters);
    });
    const completed = tasks.filter((task) => task.status === "Concluida" || task.completedAt);
    const pending = tasks.filter((task) => task.status !== "Concluida" && !task.completedAt);
    const today = iso(new Date());
    const overdue = pending.filter((task) => dateOnly(task.dueDate) && dateOnly(task.dueDate) < today);
    const onTime = completed.filter((task) => !task.dueDate || dateOnly(task.completedAt) <= dateOnly(task.dueDate));
    const openLeads = data.scoped.filter((lead) => !isWon(lead) && !isLost(lead));
    const withNextTask = new Set(pending.map((task) => task.leadId));
    const withoutTask = openLeads.filter((lead) => !withNextTask.has(lead.id));
    return { tasks, completed, pending, overdue, openLeads, withoutTask, sla: completed.length ? Math.round(onTime.length / completed.length * 100) : null };
  }

  function timelineRows(data, filters) {
    const start = new Date(`${filters.start}T12:00:00`);
    const end = new Date(`${filters.end}T12:00:00`);
    const totalDays = Math.max(1, Math.round((end - start) / 86400000) + 1);
    const step = Math.max(1, Math.ceil(totalDays / 8));
    const rows = [];
    for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + step)) {
      const bucketStart = iso(cursor);
      const bucketEndDate = new Date(cursor); bucketEndDate.setDate(bucketEndDate.getDate() + step - 1);
      const bucketEnd = iso(bucketEndDate > end ? end : bucketEndDate);
      rows.push({ label: dateBR(bucketStart).slice(0, 5), leads: data.scoped.filter((lead) => { const date = firstContact(lead); return date >= bucketStart && date <= bucketEnd; }).length, sold: data.sold.filter((lead) => { const date = dateOnly(lead.crmDates?.closed || lead.updatedAt); return date >= bucketStart && date <= bucketEnd; }).length });
    }
    return rows.slice(0, 9);
  }

  function lineChart(rows) {
    if (!rows.length || !rows.some((row) => row.leads || row.sold)) return emptyChart("Sem movimentacao suficiente para o periodo.");
    const width = 620; const height = 190; const inset = 24;
    const max = Math.max(1, ...rows.flatMap((row) => [row.leads, row.sold]));
    const point = (value, index) => ({ x: inset + index * ((width - inset * 2) / Math.max(1, rows.length - 1)), y: height - inset - value / max * (height - inset * 2) });
    const leads = rows.map((row, index) => point(row.leads, index));
    const sold = rows.map((row, index) => point(row.sold, index));
    return `<div class="report-line-legend"><span><i></i>Leads</span><span><i></i>Vendas</span></div><svg class="report-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Evolucao de leads e vendas"><line x1="${inset}" y1="${height - inset}" x2="${width - inset}" y2="${height - inset}" class="axis"/><polyline points="${leads.map((item) => `${item.x},${item.y}`).join(" ")}" class="leads"/><polyline points="${sold.map((item) => `${item.x},${item.y}`).join(" ")}" class="sold"/>${leads.map((item, index) => `<circle cx="${item.x}" cy="${item.y}" r="4" class="lead-point"><title>${esc(rows[index].label)}: ${rows[index].leads} lead(s)</title></circle>`).join("")}${sold.map((item, index) => `<circle cx="${item.x}" cy="${item.y}" r="4" class="sold-point"><title>${esc(rows[index].label)}: ${rows[index].sold} venda(s)</title></circle>`).join("")}${rows.map((row, index) => `<text x="${point(0, index).x}" y="184" text-anchor="middle">${esc(row.label)}</text>`).join("")}</svg>`;
  }

  function globalSelect(id, label, options, selected, allLabel) {
    return `<label class="report-global-select"><span>${esc(label)}</span><select id="${id}"><option value="all">${esc(allLabel)}</option>${options.map((option) => `<option value="${esc(option.value)}" ${option.value === selected ? "selected" : ""}>${esc(option.label)}</option>`).join("")}</select></label>`;
  }

  function operationalMetric(id, tone, label, value, detail, mark) {
    return `<article class="report-metric report-metric-${tone} is-interactive" tabindex="0" role="button" data-report-detail="${id}" aria-label="Detalhar ${esc(label)}"><span class="report-metric-mark">${esc(mark)}</span><div><p>${esc(label)}</p><strong>${esc(value)}</strong><small>${esc(detail)}</small></div></article>`;
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
    const local = {};
    const data = dataFor(filters);
    const global = window.reportGlobalFilters || {};
    const operations = taskMetrics(data, filters);
    const timeline = timelineRows(data, filters);
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
    const allUsers = (state.users || []).filter((user) => user.active !== false);
    const teamOptions = [...new Set(allUsers.map((user) => String(user.role || "Sem equipe")))].sort().map((role) => ({ value: role, label: role }));
    const ownerOptions = allUsers.map((user) => ({ value: user.id, label: user.name }));
    const sourceOptions = [...new Set((state.crm?.leads || []).map((lead) => String(lead.source || "Nao informado")))].sort().map((source) => ({ value: source, label: source }));
    const stageOptions = activeStages().map((stage) => ({ value: stage.id, label: stage.name }));

    target.innerHTML = `<main class="reporting-workspace"><header class="reporting-header"><div><p>INTELIGENCIA COMERCIAL</p><h2>Relatorios e KPIs</h2><span>Uma visao executiva do CRM, propostas e parcerias.</span></div><div class="reporting-actions"><button class="saas-button" id="report-pdf" type="button">Gerar PDF</button><button class="saas-button primary" id="reports-refresh" type="button">Atualizar</button></div></header><section class="reporting-filterbar"><div class="reporting-date"><span>Periodo analisado</span><strong>${dateBR(filters.start)} - ${dateBR(filters.end)}</strong></div><div class="reporting-presets">${presets.map(([id, label]) => `<button class="${filters.preset === id ? "is-active" : ""}" data-report-preset="${id}" type="button">${label}</button>`).join("")}</div>${custom ? `<div class="reporting-custom-dates"><label>Inicio<input id="report-start" type="date" value="${esc(filters.start)}"></label><label>Fim<input id="report-end" type="date" value="${esc(filters.end)}"></label><button class="saas-button primary" id="reports-apply-period" type="button">Aplicar</button></div>` : ""}</section><section class="reporting-kpis">${metric("leads", "Total de leads", data.summary.leads, data.summary.mom === null ? "Sem comparativo anterior" : `${data.summary.mom >= 0 ? "+" : ""}${data.summary.mom.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. mes anterior`, "#")}${metric("pipeline", "Valor no funil", money(openPipeline), `${commercialLeads.length} oportunidade(s) no periodo`, "R$")}${metric("ticket", "Ticket medio do funil", money(commercialFunnelTicket), "Media dos cartoes no funil", "TM")}${metric("proposal", "Ticket medio de orcamentos", money(commercialProposalTicket), `${commercialProposals.length} proposta(s)`, "OR")}${metric("sold", "Valor vendido", money(commercialSoldValue), `${commercialSold.length} venda(s) fechada(s)`, "R$")}${metric("conversion", "Conversao comercial", `${commercialConversion}%`, `${data.lost.length} negocio(s) perdido(s)`, "%")}</section><section class="reporting-section"><header class="reporting-section-head"><div><span>01</span><div><p>MARKETING</p><h3>Atracao e topo de funil</h3></div></div>${marketingFilter}</header><div class="reporting-grid marketing"><article class="report-panel">${panelHead("ORIGEM", "Leads por canal", "Distribuicao das oportunidades no periodo.")}${donutChart(marketingRows)}</article><article class="report-panel">${panelHead("VOLUME", "Canais de aquisicao", "Comparativo visual de entrada de leads.")}${channelBars(marketingRows)}</article><article class="report-side-kpi"><span>Qualificacao</span><strong>${data.summary.qualification}%</strong><p>Leads que avancaram para briefing, medicao ou etapa posterior.</p><i><b style="width:${data.summary.qualification}%"></b></i></article></div></section><section class="reporting-section"><header class="reporting-section-head"><div><span>02</span><div><p>COMERCIAL</p><h3>Desempenho e funil de vendas</h3></div></div>${commercialFilter}</header><div class="reporting-grid commercial"><article class="report-panel report-panel-wide">${panelHead("PIPELINE", "Funil de vendas", "Quantidade de oportunidades e valor por etapa.")}${funnel(commercialStages)}</article><article class="report-panel report-closing-panel">${panelHead("FECHAMENTO", "Indicadores de venda", "Leitura rapida do periodo filtrado.")}<div class="report-closing-list"><div><span>Ticket medio vendido</span><strong>${money(commercialTicket)}</strong></div><div><span>Tempo medio de fechamento</span><strong>${data.summary.closeDays} dias</strong></div><div><span>Negocios perdidos</span><strong>${data.lost.length}</strong></div></div></article></div><article class="report-panel report-table-panel">${panelHead("CANAIS", "Performance por canal", "Leads, vendas, conversao e ticket medio.")}<div class="report-table-scroll"><table class="report-table"><thead><tr><th>Canal</th><th>Leads</th><th>Vendas</th><th>Conversao</th><th>Ticket medio</th></tr></thead><tbody>${channelRows(commercialLeads).map((row) => `<tr><td><span class="report-table-dot"></span><strong>${esc(row.name)}</strong></td><td>${row.leads}</td><td>${row.won}</td><td><span class="report-percent">${row.leads ? Math.round(row.won / row.leads * 100) : 0}%</span></td><td>${row.won ? money(row.value / row.won) : "-"}</td></tr>`).join("") || '<tr><td colspan="5" class="report-table-empty">Nenhum canal para o filtro selecionado.</td></tr>'}</tbody></table></div></article></section><section class="reporting-section"><header class="reporting-section-head"><div><span>03</span><div><p>EQUIPE E PARCERIAS</p><h3>Produtividade comercial</h3></div></div><div class="reporting-section-filters">${teamFilter}${partnerFilter}</div></header><div class="reporting-grid productivity"><article class="report-panel report-team-panel">${panelHead("EQUIPE", "Performance por projetista ou consultor", "Revisoes serao alimentadas pelos projetos relacionais futuramente.")}<div class="report-table-scroll"><table class="report-table"><thead><tr><th>Responsavel</th><th>Apresentados</th><th>Vendidos</th><th>Conversao</th><th>Ticket medio</th><th>Revisoes</th></tr></thead><tbody>${teamRows.map((row) => `<tr><td><strong>${esc(row.name)}</strong></td><td>${row.presented}</td><td>${row.sold}</td><td><span class="report-percent">${row.conversion}%</span></td><td>${money(row.ticket)}</td><td>${row.revisions}</td></tr>`).join("") || '<tr><td colspan="6" class="report-table-empty">Nenhum responsavel com atividade no periodo.</td></tr>'}</tbody></table></div></article><article class="report-panel report-partner-panel">${panelHead("TOP 5", "Arquitetos e especificadores", "Vendido e RT estimada no periodo.")}${rankedBars(partnerRows)}</article></div><div class="reporting-partner-kpis">${metric("partner", "Vendas por parcerias", money(partnerRows.reduce((sum, row) => sum + row.sales, 0)), "Especificadores vinculados", "R$")}${metric("rt", "RT / comissao estimada", money(partnerRows.reduce((sum, row) => sum + row.rt, 0)), "Analises de preco salvas", "RT")}</div></section><section class="reporting-section reporting-future"><header class="reporting-section-head"><div><span>04</span><div><p>PREPARACAO FUTURA</p><h3>Operacao, qualidade e pos-venda</h3></div></div><span class="report-future-badge">Aguardando dados operacionais</span></header><div class="reporting-future-grid"><div><span>Assistencia tecnica / avarias</span><strong>-</strong><small>Chamados por projeto vendido</small></div><div><span>Lead time de entrega e montagem</span><strong>-</strong><small>Fechamento ate montagem concluida</small></div><div><span>NPS / satisfacao</span><strong>-</strong><small>Pesquisa apos a montagem</small></div></div></section><footer class="reporting-source">Fonte: CRM, propostas, usuarios e especificadores. Atualizado conforme os filtros selecionados.</footer></main>`;

    const filterbar = target.querySelector(".reporting-filterbar");
    filterbar?.insertAdjacentHTML("beforeend", `<div class="report-global-filters"><div class="report-global-filter-grid">${globalSelect("report-global-team", "Equipe", teamOptions, global.team, "Todas as equipes")}${globalSelect("report-global-owner", "Atendente", ownerOptions, global.owner, "Todos os atendentes")}${globalSelect("report-global-stage", "Status", stageOptions, global.stage, "Todos os status")}${globalSelect("report-global-source", "Origem", sourceOptions, global.source, "Todas as origens")}</div><div class="report-global-filter-actions"><button class="saas-button" id="report-clear-filters" type="button">Limpar</button><button class="saas-button primary" id="report-apply-filters" type="button">Aplicar filtros</button></div></div>`);
    target.querySelectorAll(".reporting-section-head > .report-select, .reporting-section-filters").forEach((element) => element.remove());

    const executiveKpis = target.querySelector(".reporting-kpis");
    if (executiveKpis) executiveKpis.innerHTML = `${operationalMetric("leads", "leads", "Total de leads", data.summary.leads, data.summary.mom === null ? "Sem comparativo anterior" : `${data.summary.mom >= 0 ? "+" : ""}${data.summary.mom.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. periodo anterior`, "#")}${operationalMetric("pending", "proposal", "Tarefas pendentes", operations.pending.length, `${operations.overdue.length} atrasada(s)`, "TP")}${operationalMetric("progress", "ticket", "Em andamento", operations.openLeads.length, "Oportunidades abertas", "EA")}${operationalMetric("completed", "sold", "Tarefas concluidas", operations.completed.length, "No periodo selecionado", "OK")}${operationalMetric("sla", "pipeline", "SLA de tarefas", operations.sla === null ? "-" : `${operations.sla}%`, operations.sla === null ? "Sem tarefas concluidas com prazo" : "Concluidas dentro do prazo", "SL")}${operationalMetric("conversion", "conversion", "Conversao comercial", `${commercialConversion}%`, `${commercialSold.length} venda(s) fechada(s)`, "%")}`;

    if (operations.overdue.length || operations.withoutTask.length || (data.summary.mom !== null && data.summary.mom < 0)) {
      filterbar?.insertAdjacentHTML("afterend", `<section class="report-alert-strip" aria-label="Pontos de atencao">${operations.overdue.length ? `<div class="danger"><span>Prazo</span><strong>${operations.overdue.length} tarefa(s) atrasada(s)</strong><small>Requer acompanhamento comercial.</small></div>` : ""}${operations.withoutTask.length ? `<div class="warning"><span>Agenda</span><strong>${operations.withoutTask.length} oportunidade(s) sem tarefa</strong><small>Sem proximo compromisso pendente.</small></div>` : ""}${data.summary.mom !== null && data.summary.mom < 0 ? `<div class="info"><span>Tendencia</span><strong>${Math.abs(data.summary.mom).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% menos leads</strong><small>Comparacao com o periodo anterior.</small></div>` : ""}</section>`);
    }

    executiveKpis?.insertAdjacentHTML("afterend", `<section class="report-detail-drawer" id="report-detail-drawer" hidden></section>`);
    const sections = target.querySelectorAll(".reporting-section");
    const marketingSection = sections.length ? sections[0] : null;
    marketingSection?.insertAdjacentHTML("afterend", `<section class="reporting-section report-evolution-section"><header class="reporting-section-head"><div><span>+</span><div><p>EVOLUCAO</p><h3>Movimentacao no periodo</h3></div></div></header><article class="report-panel">${panelHead("TENDENCIA", "Leads e vendas ao longo do tempo", "Passe o mouse sobre os pontos para visualizar os valores.")}${lineChart(timeline)}</article></section>`);
    const commercialSection = sections.length > 1 ? sections[1] : null;
    commercialSection?.querySelector(".reporting-grid.commercial")?.insertAdjacentHTML("beforebegin", `<div class="report-finance-strip">${metric("ticket", "Ticket medio do funil", money(commercialFunnelTicket), `${commercialLeads.length} oportunidade(s)`, "TM")}${metric("proposal", "Ticket medio de orcamentos", money(commercialProposalTicket), `${commercialProposals.length} proposta(s)`, "OR")}${metric("sold", "Ticket medio vendido", money(commercialTicket), `${commercialSold.length} venda(s)`, "TV")}${metric("pipeline", "Valor vendido", money(commercialSoldValue), "Fechamentos do periodo", "R$")}</div>`);

    const teamTable = target.querySelector(".report-team-panel .report-table-scroll");
    if (teamTable) teamTable.innerHTML = `<table class="report-table report-attendant-table"><thead><tr><th>Atendente</th><th>Apresentados</th><th>Vendidos</th><th>Conversao</th><th>Ticket medio</th><th>Meta visual</th></tr></thead><tbody>${teamRows.map((row) => { const initials = String(row.name || "?").split(/\s+/).slice(0, 2).map((part) => part.charAt(0)).join("").toUpperCase(); return `<tr><td><div class="report-attendant"><span>${esc(initials)}</span><strong>${esc(row.name)}</strong></div></td><td>${row.presented}</td><td>${row.sold}</td><td><span class="report-percent">${row.conversion}%</span></td><td>${money(row.ticket)}</td><td><div class="report-goal"><i><b style="width:${Math.min(100, row.conversion)}%"></b></i><small>${row.conversion}%</small></div></td></tr>`; }).join("") || '<tr><td colspan="6" class="report-table-empty">Nenhum atendente com atividade no periodo.</td></tr>'}</tbody></table>`;

    const detailMessages = {
      leads: ["Total de leads", `${data.summary.leads} oportunidade(s) entraram no periodo selecionado.`],
      pending: ["Tarefas pendentes", `${operations.pending.length} pendente(s), sendo ${operations.overdue.length} atrasada(s).`],
      progress: ["Em andamento", `${operations.openLeads.length} oportunidade(s) permanecem abertas no funil.`],
      completed: ["Tarefas concluidas", `${operations.completed.length} tarefa(s) foram concluidas dentro do filtro.`],
      sla: ["SLA de tarefas", operations.sla === null ? "Ainda nao existe base concluida suficiente para calcular o SLA." : `${operations.sla}% das tarefas concluidas respeitaram o prazo cadastrado.`],
      conversion: ["Conversao comercial", `${commercialSold.length} de ${commercialLeads.length} oportunidade(s) resultaram em venda.`]
    };
    target.querySelectorAll("[data-report-detail]").forEach((item) => {
      const open = () => { const detail = detailMessages[item.dataset.reportDetail]; const drawer = $("report-detail-drawer"); if (!drawer || !detail) return; drawer.hidden = false; drawer.innerHTML = `<div><span>DETALHAMENTO</span><strong>${esc(detail[0])}</strong><p>${esc(detail[1])}</p></div><button class="saas-button" id="report-close-detail" type="button">Fechar</button>`; $("report-close-detail").onclick = () => { drawer.hidden = true; }; };
      item.onclick = open;
      item.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(); } };
    });

    $("report-apply-filters")?.addEventListener("click", () => { window.reportGlobalFilters = { team: $("report-global-team").value, owner: $("report-global-owner").value, stage: $("report-global-stage").value, source: $("report-global-source").value }; refreshApp(); });
    $("report-clear-filters")?.addEventListener("click", () => { window.reportGlobalFilters = {}; refreshApp(); });
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
