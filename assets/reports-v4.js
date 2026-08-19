/* Premium reports presentation. Keeps the existing CRM report calculations intact. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const dateOnly = (value) => String(value || "").slice(0, 10);
  const iso = (date) => new Date(date).toISOString().slice(0, 10);
  const dateBR = (value) => { const date = dateOnly(value); if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return String(value || "-"); const [year, month, day] = date.split("-"); return `${day}/${month}/${year}`; };
  const list = (value) => Array.isArray(value) ? value : [];

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
  const activeStages = () => list(state.crm?.stages).filter((stage) => stage.active !== false);
  const stageFor = (lead) => activeStages().find((stage) => stage.id === lead.stageId) || {};
  const clientFor = (lead) => list(state.clients).find((client) => client.id === lead.clientId);
  const specifierFor = (id) => list(state.specifiers).find((item) => item.id === id);
  const firstContact = (lead) => dateOnly(lead.crmDates?.firstContact || lead.firstContactDate || lead.createdAt || lead.enteredAt);
  const inRange = (value, filters) => { const date = dateOnly(value); if (!date) return false; if (!filters.start && !filters.end) return true; return (!filters.start || date >= filters.start) && (!filters.end || date <= filters.end); };
  const periodLabel = (filters) => !filters?.start && !filters?.end ? "Todo o periodo" : `${dateBR(filters.start)} - ${dateBR(filters.end)}`;
  const goalRecords = () => list(state.salesGoals).filter((goal) => Number(goal.annualRevenue) > 0);

  function salesGoalSummary(filters = {}) {
    const records = goalRecords();
    const startText = dateOnly(filters.start);
    const endText = dateOnly(filters.end);
    const reference = new Date(`${endText || startText || iso(new Date())}T12:00:00`);
    const referenceYear = reference.getFullYear();
    const annual = Number(records.find((goal) => Number(goal.year) === referenceYear)?.annualRevenue || 0);
    if (!startText && !endText) return { configured: records.length > 0, target: records.reduce((sum, goal) => sum + Number(goal.annualRevenue || 0), 0), annual, reference, label: "Meta do historico configurado" };
    const start = new Date(`${startText || endText}T12:00:00`);
    const end = new Date(`${endText || startText}T12:00:00`);
    const target = records.reduce((sum, goal) => {
      const year = Number(goal.year); const yearStart = new Date(`${year}-01-01T12:00:00`); const yearEnd = new Date(`${year}-12-31T12:00:00`);
      const overlapStart = start > yearStart ? start : yearStart; const overlapEnd = end < yearEnd ? end : yearEnd;
      if (overlapStart > overlapEnd) return sum;
      const overlapDays = Math.round((overlapEnd - overlapStart) / 86400000) + 1;
      const yearDays = Math.round((yearEnd - yearStart) / 86400000) + 1;
      return sum + Number(goal.annualRevenue || 0) * overlapDays / yearDays;
    }, 0);
    return { configured: target > 0, target, annual, reference, label: "Meta proporcional ao periodo" };
  }

  function goalDashboard(data, filters) {
    const goal = salesGoalSummary(filters);
    const actual = Number(data.summary.soldValue || 0);
    const attainment = goal.target ? Math.round(actual / goal.target * 100) : 0;
    const month = goal.reference.getMonth() + 1;
    const semester = month <= 6 ? 1 : 2;
    const quarter = Math.ceil(month / 3);
    const goalCard = (label, value, detail) => `<article><span>${esc(label)}</span><strong>${value ? money(value) : "-"}</strong><small>${esc(detail)}</small></article>`;
    return `<section class="reporting-goals"><header class="reporting-section-head"><div><span>+</span><div><p>METAS COMERCIAIS</p><h3>Faturamento e atingimento</h3></div></div><span class="report-goal-period">${esc(periodLabel(filters))}</span></header><div class="report-goals-grid"><article class="report-goal-highlight"><span>Meta do periodo</span><strong>${goal.configured ? money(goal.target) : "Meta nao cadastrada"}</strong><small>${goal.configured ? `${attainment}% atingido | vendido ${money(actual)}` : "Cadastre a meta anual na Administracao."}</small><i><b style="width:${Math.min(100, attainment)}%"></b></i></article><div class="report-goal-reference">${goalCard(`Anual ${goal.reference.getFullYear()}`, goal.annual, "Meta cadastrada")}${goalCard(`Semestre ${semester}`, goal.annual / 2, "Referencia automatica")}${goalCard(`Trimestre ${quarter}`, goal.annual / 4, "Referencia automatica")}${goalCard("Mes", goal.annual / 12, "Referencia automatica")}</div></div></section>`;
  }
  const stageName = (lead) => String(stageFor(lead).name || "").toLowerCase();
  const isWon = (lead) => { const stage = stageFor(lead); return ["Ganha", "Ganho", "Fechada"].includes(String(lead.status || "")) || stage.closedType === "won" || Number(stage.probability || 0) === 100 || /fechad|ganh|vendid/.test(stageName(lead)); };
  const isLost = (lead) => { const stage = stageFor(lead); return ["Perdida", "Perdido"].includes(String(lead.status || "")) || stage.closedType === "lost" || /perdid/.test(stageName(lead)); };
  const isQualified = (lead) => !!(lead.crmDates?.briefing || lead.crmDates?.projectReceived || /medic|briefing|projeto|apresent|proposta|fechad|ganh|vendid/.test(stageName(lead)));
  const specifierId = (lead) => lead.specifierId || clientFor(lead)?.specifierId || "";

  function leadValue(lead) {
    const direct = amount(lead.closedValue || lead.value || lead.estimatedValue);
    if (direct) return direct;
    return list(state.proposals).filter((proposal) => !proposal.archivedAt && proposal.crmOpportunityRef === lead.id).reduce((max, proposal) => Math.max(max, Number(proposal.totalCents || 0) / 100), 0);
  }

  function periodFor(preset) {
    const now = new Date(); const year = now.getFullYear(); const month = now.getMonth();
    if (preset === "all") return { preset, start: "", end: "" };
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
    const all = list(state.crm?.leads).filter(matchesGlobalFilters);
    const scoped = all.filter((lead) => inRange(firstContact(lead), filters));
    const sold = all.filter((lead) => isWon(lead) && inRange(lead.crmDates?.closed || lead.updatedAt || firstContact(lead), filters));
    // Closing-period sales and lead-cohort conversion are different metrics.
    // Never divide closings from older leads by leads that entered this period.
    const wonCohort = scoped.filter(isWon);
    const lost = all.filter((lead) => isLost(lead) && inRange(lead.crmDates?.lost || lead.updatedAt || firstContact(lead), filters));
    const scopedLeadIds = new Set(scoped.map((lead) => lead.id));
    const proposals = list(state.proposals).filter((proposal) => {
      if (proposal.archivedAt) return false;
      const opportunityId = proposal.crmOpportunityRef || proposal.leadId || proposal.opportunityId || "";
      return inRange(proposal.createdAt || proposal.updatedAt, filters) || (opportunityId && scopedLeadIds.has(opportunityId));
    });
    const stages = activeStages().map((stage) => { const leads = scoped.filter((lead) => lead.stageId === stage.id); return { id: stage.id, name: stage.name || "Etapa", count: leads.length, value: leads.reduce((sum, lead) => sum + leadValue(lead), 0), probability: Number(stage.probability || 0) }; });
    const partners = new Map();
    sold.forEach((lead) => { const id = specifierId(lead); if (!id) return; const proposal = list(state.proposals).filter((item) => item.crmOpportunityRef === lead.id).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0]; const row = partners.get(id) || { id, name: specifierFor(id)?.name || "Especificador", sales: 0, rt: 0 }; row.sales += leadValue(lead); row.rt += Number(proposal?.priceFormationHistory?.[0]?.analysis?.rtCents || proposal?.priceFormation?.rtCents || 0) / 100; partners.set(id, row); });
    const team = list(state.users).filter((user) => user.active !== false).map((user) => { const owned = scoped.filter((lead) => lead.ownerId === user.id); const sales = sold.filter((lead) => lead.ownerId === user.id); const cohortSales = wonCohort.filter((lead) => lead.ownerId === user.id); return { id: user.id, name: user.name, presented: owned.filter(isQualified).length, sold: sales.length, conversion: owned.length ? Math.round(cohortSales.length / owned.length * 100) : 0, ticket: sales.length ? sales.reduce((sum, lead) => sum + leadValue(lead), 0) / sales.length : 0, revisions: 0 }; }).filter((row) => row.presented || row.sold);
    const previous = filters.start ? (() => { const previousStart = new Date(`${filters.start}T12:00:00`); previousStart.setMonth(previousStart.getMonth() - 1); const previousEnd = new Date(`${filters.start}T12:00:00`); previousEnd.setDate(0); return all.filter((lead) => { const date = firstContact(lead); return date >= iso(previousStart) && date <= iso(previousEnd); }); })() : [];
    const partnerRows = [...partners.values()].sort((a, b) => b.sales - a.sales);
    return { all, scoped, sold, wonCohort, lost, proposals, stages, channels: channelRows(scoped), team, partners: partnerRows, summary: { leads: scoped.length, mom: previous.length ? (scoped.length - previous.length) / previous.length * 100 : null, qualification: scoped.length ? Math.round(scoped.filter(isQualified).length / scoped.length * 100) : 0, proposalTicket: proposals.length ? proposals.reduce((sum, proposal) => sum + Number(proposal.totalCents || 0) / 100, 0) / proposals.length : 0, soldValue: sold.reduce((sum, lead) => sum + leadValue(lead), 0), salesTicket: sold.length ? sold.reduce((sum, lead) => sum + leadValue(lead), 0) / sold.length : 0, conversion: scoped.length ? Math.round(wonCohort.length / scoped.length * 100) : 0, closeDays: sold.length ? Math.round(sold.reduce((sum, lead) => sum + daysBetween(firstContact(lead), lead.crmDates?.closed || lead.updatedAt), 0) / sold.length) : 0, partnerSales: partnerRows.reduce((sum, row) => sum + row.sales, 0), partnerRt: partnerRows.reduce((sum, row) => sum + row.rt, 0) } };
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

  function timelineRows(data, filters) {
    const dates = [...data.scoped.map(firstContact), ...data.sold.map((lead) => dateOnly(lead.crmDates?.closed || lead.updatedAt))].filter(Boolean).sort();
    if (!dates.length) return [];
    const start = new Date(`${(filters.start || dates[0])}T12:00:00`);
    const end = new Date(`${(filters.end || dates[dates.length - 1])}T12:00:00`);
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

  function printLegacyReport(data, filters) {
    const popup = window.open("", "_blank", "width=980,height=760");
    if (!popup) return;
    const funnelValue = data.scoped.reduce((sum, lead) => sum + leadValue(lead), 0);
    const funnelTicket = data.scoped.length ? funnelValue / data.scoped.length : 0;
    const logo = document.querySelector(".brand-symbol")?.src || "";
    const generatedAt = dateBR(new Date().toISOString());
    const period = periodLabel(filters).replace(" - ", " a ");
    const kpis = [
      ["Leads no periodo", data.summary.leads, "Oportunidades registradas"],
      ["Valor no funil", money(funnelValue), `${data.scoped.length} oportunidade(s)`],
      ["Valor vendido", money(data.summary.soldValue), "Vendas fechadas"],
      ["Conversao comercial", `${data.summary.conversion}%`, "Leads que viraram venda"],
      ["Ticket medio do funil", money(funnelTicket), "Media das oportunidades"],
      ["Ticket medio vendido", money(data.summary.salesTicket), "Media das vendas fechadas"]
    ];
    const kpiCards = kpis.map(([label, value, detail], index) => `<article class="kpi"><span class="kpi-mark">${String(index + 1).padStart(2, "0")}</span><div><p>${esc(label)}</p><strong>${esc(String(value))}</strong><small>${esc(detail)}</small></div></article>`).join("");
    const stageRows = data.stages.map((row, index) => `<tr><td><div class="row-label"><span class="row-index">${String(index + 1).padStart(2, "0")}</span><strong>${esc(row.name)}</strong></div></td><td>${row.count}</td><td><strong>${money(row.value)}</strong></td></tr>`).join("") || '<tr><td colspan="3" class="empty">Nenhuma etapa para o periodo selecionado.</td></tr>';
    const channelRows = data.channels.map((row, index) => `<tr><td><div class="row-label"><span class="row-index">${String(index + 1).padStart(2, "0")}</span><strong>${esc(row.name)}</strong></div></td><td>${row.leads}</td><td>${row.won}</td><td><span class="percent">${row.leads ? Math.round(row.won / row.leads * 100) : 0}%</span></td></tr>`).join("") || '<tr><td colspan="4" class="empty">Nenhum canal no periodo.</td></tr>';
    const partnerRows = data.partners.map((row, index) => `<tr><td><div class="row-label"><span class="row-index">${String(index + 1).padStart(2, "0")}</span><strong>${esc(row.name)}</strong></div></td><td>${money(row.sales)}</td><td>${money(row.rt)}</td></tr>`).join("") || '<tr><td colspan="3" class="empty">Nenhuma venda vinculada.</td></tr>';
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatorio comercial GP Mirari</title><style>@page{size:A4;margin:13mm 14mm 16mm}*{box-sizing:border-box}body{margin:0;color:#2F2F2F;font:12px Inter,Arial,sans-serif;line-height:1.45;background:#fff}.document{max-width:182mm;margin:0 auto}.header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding-bottom:19px;border-bottom:1px solid #EAE6E1}.brand{display:flex;align-items:center;gap:11px}.brand-mark{display:grid;place-items:center;width:42px;height:42px;border:1px solid #E6C8AB;border-radius:10px;background:#F2ECE6}.brand-mark img{width:32px;height:32px;object-fit:contain}.brand h1{margin:0;font-size:20px;letter-spacing:1.6px;line-height:1}.brand p{margin:5px 0 0;color:#8B8585;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.metadata{display:grid;justify-items:end;gap:3px;text-align:right}.metadata span{color:#8B8585;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.metadata strong{font-size:13px}.metadata small{color:#6D6A67;font-size:10px}.intro{display:grid;grid-template-columns:minmax(0,1fr) 220px;gap:18px;align-items:stretch;margin:22px 0}.eyebrow{margin:0 0 7px;color:#8B8585;font-size:10px;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.intro h2{margin:0;font-size:25px;line-height:1.12}.intro p:last-child{margin:8px 0 0;color:#6D6A67;font-size:12px}.period{display:grid;align-content:space-between;gap:8px;padding:15px 17px;border:1px solid #E4C6AA;border-radius:10px;background:#FFFCF9}.period span{color:#8B8585;font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.period strong{font-size:15px;line-height:1.25}.period small{color:#6D6A67;font-size:10px}.kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-bottom:24px}.kpi{display:grid;grid-template-columns:24px minmax(0,1fr);gap:9px;min-height:85px;padding:13px;border:1px solid #EAE6E1;border-radius:9px;background:#FCFCFB}.kpi-mark,.row-index{display:grid;place-items:center;flex:0 0 auto;width:23px;height:23px;border-radius:6px;background:#F2ECE6;color:#765D46;font-size:9px;font-weight:850}.kpi p{margin:0;color:#8B8585;font-size:10px;font-weight:750}.kpi strong{display:block;margin-top:4px;font-size:17px;line-height:1.1}.kpi small{display:block;margin-top:5px;color:#6D6A67;font-size:9px;line-height:1.3}.section{margin-top:24px}.section-head{display:flex;align-items:end;justify-content:space-between;gap:14px;margin-bottom:10px}.section-head>div{display:flex;align-items:center;gap:8px}.section-number{display:grid;place-items:center;width:26px;height:26px;border-radius:7px;background:#F2ECE6;color:#765D46;font-size:10px;font-weight:850}.section-head h3{margin:0;font-size:15px}.section-head p{margin:0;color:#8B8585;font-size:10px;text-align:right}table{width:100%;border:1px solid #EAE6E1;border-collapse:separate;border-spacing:0;border-radius:10px;overflow:hidden}thead{display:table-header-group}tr{break-inside:avoid}th{padding:10px 11px;background:#F7F7F5;color:#8B8585;font-size:9px;font-weight:850;letter-spacing:.07em;text-align:left;text-transform:uppercase}td{padding:11px;border-top:1px solid #EAE6E1;vertical-align:middle}td:nth-child(n+2),th:nth-child(n+2){text-align:right}.row-label{display:flex;align-items:center;gap:9px}.percent{display:inline-block;min-width:36px;padding:3px 6px;border-radius:99px;background:#F2ECE6;color:#765D46;font-size:10px;font-weight:800;text-align:center}.empty{color:#6D6A67;text-align:left!important}.footer{display:flex;justify-content:space-between;gap:14px;margin-top:30px;padding-top:12px;border-top:1px solid #EAE6E1;color:#8B8585;font-size:9px}.footer span:last-child{text-align:right}.no-print{position:fixed;right:18px;bottom:18px}.no-print button{border:0;border-radius:8px;background:#D8AA7F;color:#fff;padding:11px 16px;font:700 12px Inter,Arial,sans-serif;cursor:pointer}@media print{.no-print{display:none}}@media(max-width:640px){.header,.intro{display:grid;grid-template-columns:1fr}.metadata{justify-items:start;text-align:left}.kpis{grid-template-columns:1fr}.section-head{display:grid;align-items:start}.section-head p{text-align:left}.footer{display:grid}.footer span:last-child{text-align:left}}</style></head><body><main class="document"><header class="header"><div class="brand"><div class="brand-mark">${logo ? `<img src="${logo}" alt="Mirari">` : "M"}</div><div><h1>MIRARI</h1><p>Inteligencia comercial</p></div></div><div class="metadata"><span>Relatorio executivo</span><strong>${period}</strong><small>Gerado em ${generatedAt}</small></div></header><section class="intro"><div><p class="eyebrow">Visao consolidada</p><h2>Relatorio comercial</h2><p>Leitura executiva do CRM, oportunidades, propostas e parcerias.</p></div><aside class="period"><span>Periodo analisado</span><strong>${period}</strong><small>Dados conforme os filtros aplicados.</small></aside></section><section class="kpis">${kpiCards}</section><section class="section"><header class="section-head"><div><span class="section-number">01</span><h3>Funil comercial</h3></div><p>Volume e valor por etapa.</p></header><table><thead><tr><th>Etapa</th><th>Oportunidades</th><th>Valor</th></tr></thead><tbody>${stageRows}</tbody></table></section><section class="section"><header class="section-head"><div><span class="section-number">02</span><h3>Performance por canal</h3></div><p>Leads, vendas e conversao.</p></header><table><thead><tr><th>Canal</th><th>Leads</th><th>Vendas</th><th>Conversao</th></tr></thead><tbody>${channelRows}</tbody></table></section><section class="section"><header class="section-head"><div><span class="section-number">03</span><h3>Especificadores e parceiros</h3></div><p>Vendido e RT estimada.</p></header><table><thead><tr><th>Parceiro</th><th>Vendido</th><th>RT</th></tr></thead><tbody>${partnerRows}</tbody></table></section><footer class="footer"><span>GP Mirari | Fonte: CRM, propostas e especificadores.</span><span>Documento gerencial confidencial</span></footer></main><div class="no-print"><button onclick="window.print()">Imprimir / salvar PDF</button></div></body></html>`);
    popup.document.close();
  }

  function printReport() {
    const source = document.querySelector("#tab-reports .reporting-workspace");
    if (!source) return;
    const popup = window.open("", "_blank", "width=1280,height=860");
    if (!popup) return;

    const snapshot = source.cloneNode(true);
    const sourceFields = [...source.querySelectorAll("select, input")];
    [...snapshot.querySelectorAll("select, input")].forEach((field, index) => {
      const original = sourceFields[index];
      const value = original?.tagName === "SELECT"
        ? original.options[original.selectedIndex]?.textContent
        : original?.value;
      const printable = document.createElement("span");
      printable.className = "report-print-filter-value";
      printable.textContent = value || "Todos";
      field.replaceWith(printable);
    });
    snapshot.querySelectorAll("button, .reporting-actions, .reporting-presets, .report-global-filter-actions, .report-detail-drawer").forEach((element) => element.remove());
    snapshot.querySelectorAll("[tabindex], [role=button]").forEach((element) => {
      element.removeAttribute("tabindex");
      element.removeAttribute("role");
    });
    const generated = document.createElement("small");
    generated.className = "report-print-generated";
    generated.textContent = `Gerado em ${new Date().toLocaleString("pt-BR")}`;
    snapshot.querySelector(".reporting-header > div")?.appendChild(generated);

    const headAssets = [...document.head.querySelectorAll('style, link[rel="stylesheet"]')].map((node) => node.outerHTML).join("");
    popup.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><base href="${esc(document.baseURI)}"><title>Relatorios e KPIs - GP Mirari</title>${headAssets}<style>@page{size:A4 landscape;margin:8mm}html,body{background:#fff!important}body{margin:0!important;padding:0!important;color:#2f2f2f!important}.reporting-workspace{width:100%!important;max-width:none!important;margin:0!important;gap:14px!important;animation:none!important}.reporting-header{padding-bottom:10px!important}.reporting-header h2{font-size:24px!important}.reporting-actions,.reporting-presets,.report-global-filter-actions,.report-detail-drawer,button{display:none!important}.reporting-filterbar{padding:12px!important;break-inside:avoid}.report-global-filters{margin:0!important;padding:0!important;border:0!important}.report-global-filter-grid{gap:8px!important}.report-global-select{min-width:0!important}.report-print-filter-value{display:block;padding:7px 9px;border:1px solid #e2ddd7;border-radius:7px;background:#fff;color:#2f2f2f;font-weight:700}.report-print-generated{display:block;margin-top:6px;color:#8b8585;font-size:10px}.reporting-kpis,.report-finance-strip,.reporting-partner-kpis{gap:8px!important}.report-metric,.report-panel,.report-side-kpi,.reporting-future-grid>div,tr{break-inside:avoid}.reporting-section{margin-top:2px!important}.reporting-section-head{margin-bottom:8px!important}.report-table-scroll{overflow:visible!important}.report-table{font-size:10px!important}thead{display:table-header-group}svg{max-width:100%!important}.reporting-source{margin-top:8px!important}.report-print-toolbar{position:fixed;right:18px;bottom:18px;z-index:10}.report-print-toolbar button{display:block!important;border:0;border-radius:8px;background:#d8aa7f;color:#fff;padding:11px 16px;font:700 12px Inter,Arial,sans-serif;cursor:pointer}@media print{.report-print-toolbar{display:none!important}}</style></head><body>${snapshot.outerHTML}<div class="report-print-toolbar"><button type="button" onclick="window.print()">Imprimir / salvar PDF</button></div></body></html>`);
    popup.document.close();
    popup.focus();
  }

  function dashboardMetrics() {
    const filters = window.reportFilters || periodFor("month");
    const data = dataFor(filters);
    const openPipeline = data.scoped.filter((lead) => !isWon(lead) && !isLost(lead)).reduce((sum, lead) => sum + leadValue(lead), 0);
    return { leads: data.summary.leads, pipeline: openPipeline, sold: data.summary.soldValue, conversion: data.summary.conversion, lost: data.lost.length, filters };
  }

  function render() {
    const target = $("tab-reports");
    if (!target || state.activeTab !== "reports") return;
    let filters = window.reportFilters;
    if (!filters || !filters.preset) { filters = periodFor("month"); window.reportFilters = filters; }
    const local = window.reportBlockFilters || {};
    const data = dataFor(filters);
    const global = window.reportGlobalFilters || {};
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
    const commercialWonCohort = commercialLeads.filter(isWon);
    const commercialConversion = commercialLeads.length ? Math.round(commercialWonCohort.length / commercialLeads.length * 100) : 0;
    const openPipeline = commercialLeads.filter((lead) => !isWon(lead) && !isLost(lead)).reduce((sum, lead) => sum + leadValue(lead), 0);
    const presets = [["all", "Todo o periodo"], ["month", "Este mes"], ["last_30", "Ultimos 30 dias"], ["quarter", "Trimestre"], ["year", "Este ano"], ["last_12", "Ultimos 12 meses"], ["custom", "Selecionar periodo"]];
    const custom = filters.preset === "custom";
    const marketingFilter = select("report-marketing-channel", "Canal", data.channels.map((row) => ({ value: row.name, label: row.name })), local.channel, "Todos os canais");
    const commercialFilter = select("report-commercial-stage", "Etapa", data.stages.map((row) => ({ value: row.id, label: row.name })), local.stage, "Todas as etapas");
    const teamFilter = select("report-team-owner", "Responsavel", data.team.map((row) => ({ value: row.id, label: row.name })), local.owner, "Toda a equipe");
    const partnerFilter = select("report-partner", "Especificador", data.partners.map((row) => ({ value: row.id, label: row.name })), local.partner, "Todos os especificadores");
    const allUsers = list(state.users).filter((user) => user.active !== false);
    const teamOptions = [...new Set(allUsers.map((user) => String(user.role || "Sem equipe")))].sort().map((role) => ({ value: role, label: role }));
    const ownerOptions = allUsers.map((user) => ({ value: user.id, label: user.name }));
    const sourceOptions = [...new Set(list(state.crm?.leads).map((lead) => String(lead.source || "Nao informado")))].sort().map((source) => ({ value: source, label: source }));
    const stageOptions = activeStages().map((stage) => ({ value: stage.id, label: stage.name }));

    target.innerHTML = `<main class="reporting-workspace"><header class="reporting-header"><div><p>INTELIGENCIA COMERCIAL</p><h2>Relatorios e KPIs</h2><span>Uma visao executiva do CRM, propostas e parcerias.</span></div><div class="reporting-actions"><button class="saas-button" id="report-pdf" type="button">Gerar PDF</button><button class="saas-button primary" id="reports-refresh" type="button">Atualizar</button></div></header><section class="reporting-filterbar"><div class="reporting-date"><span>Periodo analisado</span><strong>${periodLabel(filters)}</strong></div><div class="reporting-presets">${presets.map(([id, label]) => `<button class="${filters.preset === id ? "is-active" : ""}" data-report-preset="${id}" type="button">${label}</button>`).join("")}</div>${custom ? `<div class="reporting-custom-dates"><label>Inicio<input id="report-start" type="date" value="${esc(filters.start)}"></label><label>Fim<input id="report-end" type="date" value="${esc(filters.end)}"></label><button class="saas-button primary" id="reports-apply-period" type="button">Aplicar</button></div>` : ""}</section><section class="reporting-kpis">${metric("leads", "Total de leads", data.summary.leads, data.summary.mom === null ? "Sem comparativo anterior" : `${data.summary.mom >= 0 ? "+" : ""}${data.summary.mom.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. mes anterior`, "#")}${metric("pipeline", "Valor no funil", money(openPipeline), `${commercialLeads.length} oportunidade(s) no periodo`, "R$")}${metric("ticket", "Ticket medio do funil", money(commercialFunnelTicket), "Media dos cartoes no funil", "TM")}${metric("proposal", "Ticket medio de orcamentos", money(commercialProposalTicket), `${commercialProposals.length} proposta(s)`, "OR")}${metric("sold", "Valor vendido", money(commercialSoldValue), `${commercialSold.length} venda(s) fechada(s)`, "R$")}${metric("conversion", "Conversao comercial", `${commercialConversion}%`, `${data.lost.length} negocio(s) perdido(s)`, "%")}</section><section class="reporting-section"><header class="reporting-section-head"><div><span>01</span><div><p>MARKETING</p><h3>Atracao e topo de funil</h3></div></div>${marketingFilter}</header><div class="reporting-grid marketing"><article class="report-panel">${panelHead("ORIGEM", "Leads por canal", "Distribuicao das oportunidades no periodo.")}${donutChart(marketingRows)}</article><article class="report-panel">${panelHead("VOLUME", "Canais de aquisicao", "Comparativo visual de entrada de leads.")}${channelBars(marketingRows)}</article><article class="report-side-kpi"><span>Qualificacao</span><strong>${data.summary.qualification}%</strong><p>Leads que avancaram para briefing, medicao ou etapa posterior.</p><i><b style="width:${data.summary.qualification}%"></b></i></article></div></section><section class="reporting-section"><header class="reporting-section-head"><div><span>02</span><div><p>COMERCIAL</p><h3>Desempenho e funil de vendas</h3></div></div>${commercialFilter}</header><div class="reporting-grid commercial"><article class="report-panel report-panel-wide">${panelHead("PIPELINE", "Funil de vendas", "Quantidade de oportunidades e valor por etapa.")}${funnel(commercialStages)}</article><article class="report-panel report-closing-panel">${panelHead("FECHAMENTO", "Indicadores de venda", "Leitura rapida do periodo filtrado.")}<div class="report-closing-list"><div><span>Ticket medio vendido</span><strong>${money(commercialTicket)}</strong></div><div><span>Tempo medio de fechamento</span><strong>${data.summary.closeDays} dias</strong></div><div><span>Negocios perdidos</span><strong>${data.lost.length}</strong></div></div></article></div><article class="report-panel report-table-panel">${panelHead("CANAIS", "Performance por canal", "Leads, vendas, conversao e ticket medio.")}<div class="report-table-scroll"><table class="report-table"><thead><tr><th>Canal</th><th>Leads</th><th>Vendas</th><th>Conversao</th><th>Ticket medio</th></tr></thead><tbody>${channelRows(commercialLeads).map((row) => `<tr><td><span class="report-table-dot"></span><strong>${esc(row.name)}</strong></td><td>${row.leads}</td><td>${row.won}</td><td><span class="report-percent">${row.leads ? Math.round(row.won / row.leads * 100) : 0}%</span></td><td>${row.won ? money(row.value / row.won) : "-"}</td></tr>`).join("") || '<tr><td colspan="5" class="report-table-empty">Nenhum canal para o filtro selecionado.</td></tr>'}</tbody></table></div></article></section><section class="reporting-section"><header class="reporting-section-head"><div><span>03</span><div><p>EQUIPE E PARCERIAS</p><h3>Produtividade comercial</h3></div></div><div class="reporting-section-filters">${teamFilter}${partnerFilter}</div></header><div class="reporting-grid productivity"><article class="report-panel report-team-panel">${panelHead("EQUIPE", "Performance por projetista ou consultor", "Revisoes serao alimentadas pelos projetos relacionais futuramente.")}<div class="report-table-scroll"><table class="report-table"><thead><tr><th>Responsavel</th><th>Apresentados</th><th>Vendidos</th><th>Conversao</th><th>Ticket medio</th><th>Revisoes</th></tr></thead><tbody>${teamRows.map((row) => `<tr><td><strong>${esc(row.name)}</strong></td><td>${row.presented}</td><td>${row.sold}</td><td><span class="report-percent">${row.conversion}%</span></td><td>${money(row.ticket)}</td><td>${row.revisions}</td></tr>`).join("") || '<tr><td colspan="6" class="report-table-empty">Nenhum responsavel com atividade no periodo.</td></tr>'}</tbody></table></div></article><article class="report-panel report-partner-panel">${panelHead("TOP 5", "Arquitetos e especificadores", "Vendido e RT estimada no periodo.")}${rankedBars(partnerRows)}</article></div><div class="reporting-partner-kpis">${metric("partner", "Vendas por parcerias", money(partnerRows.reduce((sum, row) => sum + row.sales, 0)), "Especificadores vinculados", "R$")}${metric("rt", "RT / comissao estimada", money(partnerRows.reduce((sum, row) => sum + row.rt, 0)), "Analises de preco salvas", "RT")}</div></section><section class="reporting-section reporting-future"><header class="reporting-section-head"><div><span>04</span><div><p>PREPARACAO FUTURA</p><h3>Operacao, qualidade e pos-venda</h3></div></div><span class="report-future-badge">Aguardando dados operacionais</span></header><div class="reporting-future-grid"><div><span>Assistencia tecnica / avarias</span><strong>-</strong><small>Chamados por projeto vendido</small></div><div><span>Lead time de entrega e montagem</span><strong>-</strong><small>Fechamento ate montagem concluida</small></div><div><span>NPS / satisfacao</span><strong>-</strong><small>Pesquisa apos a montagem</small></div></div></section><footer class="reporting-source">Fonte: CRM, propostas, usuarios e especificadores. Atualizado conforme os filtros selecionados.</footer></main>`;

    const filterbar = target.querySelector(".reporting-filterbar");
    filterbar?.insertAdjacentHTML("beforeend", `<div class="report-global-filters"><div class="report-global-filter-grid">${globalSelect("report-global-team", "Equipe", teamOptions, global.team, "Todas as equipes")}${globalSelect("report-global-owner", "Atendente", ownerOptions, global.owner, "Todos os atendentes")}${globalSelect("report-global-stage", "Status", stageOptions, global.stage, "Todos os status")}${globalSelect("report-global-source", "Origem", sourceOptions, global.source, "Todas as origens")}</div><div class="report-global-filter-actions"><button class="saas-button" id="report-clear-filters" type="button">Limpar</button><button class="saas-button primary" id="report-apply-filters" type="button">Aplicar filtros</button></div></div>`);
    target.querySelectorAll(".reporting-section-head > .report-select, .reporting-section-filters").forEach((element) => element.remove());

    const executiveKpis = target.querySelector(".reporting-kpis");
    if (executiveKpis) executiveKpis.innerHTML = `${operationalMetric("leads", "leads", "Total de leads", data.summary.leads, data.summary.mom === null ? "Sem comparativo anterior" : `${data.summary.mom >= 0 ? "+" : ""}${data.summary.mom.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. periodo anterior`, "#")}${operationalMetric("pipeline", "pipeline", "Valor no funil", money(openPipeline), `${commercialLeads.length} oportunidade(s) no periodo`, "R$")}${operationalMetric("funnel-ticket", "ticket", "Ticket medio do funil", money(commercialFunnelTicket), "Media das oportunidades", "TM")}${operationalMetric("sold", "sold", "Valor vendido", money(commercialSoldValue), `${commercialSold.length} venda(s) fechada(s)`, "R$")}${operationalMetric("sales-ticket", "proposal", "Ticket medio vendido", money(commercialTicket), "Media das vendas fechadas", "TV")}${operationalMetric("conversion", "conversion", "Conversao comercial", `${commercialConversion}%`, `${data.lost.length} negocio(s) perdido(s)`, "%")}`;

    executiveKpis?.insertAdjacentHTML("afterend", goalDashboard(data, filters));

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
      pipeline: ["Valor no funil", `${money(openPipeline)} em oportunidades abertas no periodo selecionado.`],
      "funnel-ticket": ["Ticket medio do funil", `${money(commercialFunnelTicket)} por oportunidade no filtro atual.`],
      sold: ["Valor vendido", `${money(commercialSoldValue)} em vendas fechadas no periodo.`],
      "sales-ticket": ["Ticket medio vendido", `${money(commercialTicket)} por venda fechada.`],
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
    $("report-pdf").onclick = printReport;
    $("report-marketing-channel")?.addEventListener("change", (event) => { window.reportBlockFilters = { ...local, channel: event.target.value }; render(); });
    $("report-commercial-stage")?.addEventListener("change", (event) => { window.reportBlockFilters = { ...local, stage: event.target.value }; render(); });
    $("report-team-owner")?.addEventListener("change", (event) => { window.reportBlockFilters = { ...local, owner: event.target.value }; render(); });
    $("report-partner")?.addEventListener("change", (event) => { window.reportBlockFilters = { ...local, partner: event.target.value }; render(); });
  }

  function refreshApp() { if (typeof window.render === "function") window.render(); else render(); }
  window.GPMirariReports = { render, dashboardMetrics };
  setTimeout(() => { if (typeof window.render === "function") window.render(); }, 0);
})();
