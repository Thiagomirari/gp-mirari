/* Relatorios comerciais: leitura local do CRM enquanto a migracao relacional e gradual. */
(function () {
  "use strict";
  const byId = (id) => document.getElementById(id);
  const escape = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const today = () => new Date().toISOString().slice(0, 10);
  const dateOnly = (value) => String(value || "").slice(0, 10);
  const money = (value) => number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  function number(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    let text = String(value ?? "").trim().replace(/R\$|\s/g, "");
    if (!text) return 0;
    if (text.includes(",")) text = text.replace(/\./g, "").replace(",", ".");
    else if ((text.match(/\./g) || []).length > 1) text = text.replace(/\./g, "");
    const parsed = Number(text.replace(/[^0-9.-]/g, ""));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function iso(date) { return new Date(date).toISOString().slice(0, 10); }

  function rangeFor(preset) {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    if (preset === "last_30") return { preset, start: iso(new Date(year, month, now.getDate() - 29)), end: iso(now) };
    if (preset === "last_12") return { preset, start: iso(new Date(year - 1, month, now.getDate() + 1)), end: iso(now) };
    if (preset === "year") return { preset, start: `${year}-01-01`, end: `${year}-12-31` };
    if (preset === "quarter") {
      const firstMonth = Math.floor(month / 3) * 3;
      return { preset, start: iso(new Date(year, firstMonth, 1)), end: iso(new Date(year, firstMonth + 3, 0)) };
    }
    return { preset: "month", start: iso(new Date(year, month, 1)), end: iso(new Date(year, month + 1, 0)) };
  }

  function inRange(value, filters) {
    const date = dateOnly(value);
    return !!date && (!filters.start || date >= filters.start) && (!filters.end || date <= filters.end);
  }

  function clientFor(lead) { return (state.clients || []).find((item) => item.id === lead.clientId); }
  function specifierFor(id) { return (state.specifiers || []).find((item) => item.id === id); }
  function stageFor(lead) { return (state.crm?.stages || []).find((stage) => stage.id === lead.stageId) || {}; }
  function firstContact(lead) { return dateOnly(lead.crmDates?.firstContact || lead.firstContactDate || lead.createdAt || lead.enteredAt); }
  function isWon(lead) { return ["Ganha", "Ganho", "Fechada"].includes(String(lead.status || "")); }
  function isLost(lead) { return ["Perdida", "Perdido"].includes(String(lead.status || "")); }
  function leadValue(lead) {
    const direct = number(lead.closedValue || lead.value || lead.estimatedValue);
    if (direct) return direct;
    return (state.proposals || [])
      .filter((proposal) => !proposal.archivedAt && proposal.crmOpportunityRef === lead.id)
      .reduce((highest, proposal) => Math.max(highest, Number(proposal.totalCents || 0) / 100), 0);
  }
  function leadSpecifier(lead) { return lead.specifierId || clientFor(lead)?.specifierId || ""; }
  function isQualified(lead) {
    const stageName = String(stageFor(lead).name || "").toLowerCase();
    return !!(lead.crmDates?.briefing || lead.crmDates?.projectReceived || /medic|briefing|projeto|apresent|proposta|fechad|ganh/.test(stageName));
  }
  function daysBetween(start, end) {
    if (!start || !end) return 0;
    return Math.max(0, Math.round((new Date(`${dateOnly(end)}T12:00:00`) - new Date(`${dateOnly(start)}T12:00:00`)) / 86400000));
  }

  function buildData(filters) {
    const all = state.crm?.leads || [];
    const scoped = all.filter((lead) => inRange(firstContact(lead), filters));
    const closed = all.filter((lead) => isWon(lead) && inRange(lead.crmDates?.closed || lead.updatedAt, filters));
    const lost = all.filter((lead) => isLost(lead) && inRange(lead.crmDates?.lost || lead.updatedAt, filters));
    const proposals = (state.proposals || []).filter((proposal) => !proposal.archivedAt && inRange(proposal.createdAt || proposal.updatedAt, filters));
    const channelMap = new Map();
    scoped.forEach((lead) => {
      const name = lead.source || "Nao informado";
      const row = channelMap.get(name) || { name, leads: 0, wins: 0, value: 0 };
      row.leads += 1;
      row.value += leadValue(lead);
      if (isWon(lead)) row.wins += 1;
      channelMap.set(name, row);
    });
    const stages = (state.crm?.stages || []).filter((stage) => stage.active !== false).map((stage) => {
      const rows = scoped.filter((lead) => lead.stageId === stage.id);
      return { name: stage.name || "Etapa", count: rows.length, value: rows.reduce((sum, lead) => sum + leadValue(lead), 0), probability: Number(stage.probability || 0) };
    });
    const losses = new Map();
    lost.forEach((lead) => {
      const name = lead.lostReasonCategory || lead.lostReason || "Outro";
      losses.set(name, (losses.get(name) || 0) + 1);
    });
    const team = (state.users || []).filter((user) => user.active !== false).map((user) => {
      const userLeads = scoped.filter((lead) => lead.ownerId === user.id);
      const sales = closed.filter((lead) => lead.ownerId === user.id);
      const presented = userLeads.filter((lead) => isQualified(lead));
      return { name: user.name, presented: presented.length, sold: sales.length, conversion: userLeads.length ? Math.round(sales.length / userLeads.length * 100) : 0, ticket: sales.length ? sales.reduce((sum, lead) => sum + leadValue(lead), 0) / sales.length : 0, revisions: 0 };
    }).filter((row) => row.presented || row.sold);
    const partners = new Map();
    closed.forEach((lead) => {
      const id = leadSpecifier(lead);
      if (!id) return;
      const proposal = (state.proposals || []).filter((item) => item.crmOpportunityRef === lead.id).sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")))[0];
      const row = partners.get(id) || { name: specifierFor(id)?.name || "Especificador", sales: 0, rt: 0 };
      row.sales += leadValue(lead);
      row.rt += Number(proposal?.priceFormationHistory?.[0]?.analysis?.rtCents || proposal?.priceFormation?.rtCents || 0) / 100;
      partners.set(id, row);
    });
    const previousStart = new Date(`${filters.start}T12:00:00`);
    previousStart.setMonth(previousStart.getMonth() - 1);
    const previousEnd = new Date(`${filters.start}T12:00:00`);
    previousEnd.setDate(0);
    const previous = all.filter((lead) => {
      const date = firstContact(lead);
      return date >= iso(previousStart) && date <= iso(previousEnd);
    });
    const partnerRows = [...partners.values()].sort((a, b) => b.sales - a.sales);
    return {
      scoped, closed, lost, proposals,
      channels: [...channelMap.values()].sort((a, b) => b.leads - a.leads),
      stages,
      losses: [...losses.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      team,
      partners: partnerRows,
      summary: {
        leads: scoped.length,
        mom: previous.length ? ((scoped.length - previous.length) / previous.length) * 100 : null,
        qualification: scoped.length ? Math.round(scoped.filter(isQualified).length / scoped.length * 100) : 0,
        proposalTicket: proposals.length ? proposals.reduce((sum, proposal) => sum + Number(proposal.totalCents || 0) / 100, 0) / proposals.length : 0,
        salesTicket: closed.length ? closed.reduce((sum, lead) => sum + leadValue(lead), 0) / closed.length : 0,
        conversion: scoped.length ? Math.round(closed.length / scoped.length * 100) : 0,
        closeDays: closed.length ? Math.round(closed.reduce((sum, lead) => sum + daysBetween(firstContact(lead), lead.crmDates?.closed || lead.updatedAt), 0) / closed.length) : 0,
        partnerSales: partnerRows.reduce((sum, row) => sum + row.sales, 0),
        partnerRt: partnerRows.reduce((sum, row) => sum + row.rt, 0)
      }
    };
  }

  function card(label, value, detail, tone = "") {
    return `<article class="saas-report-kpi ${tone}"><span>${escape(label)}</span><strong>${escape(value)}</strong><small>${escape(detail || "")}</small></article>`;
  }

  function bars(rows, total, detail) {
    if (!rows.length) return '<p class="saas-empty">Nenhum registro para este periodo.</p>';
    return rows.map((row) => {
      const value = Number(row.count ?? row.leads ?? 0);
      const width = total ? Math.max(4, Math.round(value / total * 100)) : 0;
      return `<div class="kpi-bar-row"><div><strong>${escape(row.name)}</strong><small>${escape(detail(row))}</small></div><div class="kpi-bar-track"><i style="width:${width}%"></i></div><b>${value}</b></div>`;
    }).join("");
  }

  function render() {
    const target = byId("tab-reports");
    if (!target || state.activeTab !== "reports") return;
    let filters = window.reportFilters;
    if (!filters?.start || !filters?.end) {
      filters = rangeFor("month");
      window.reportFilters = filters;
    }
    const local = window.reportBlockFilters || {};
    const data = buildData(filters);
    const marketing = data.channels.filter((row) => !local.marketingChannel || local.marketingChannel === "all" || row.name === local.marketingChannel);
    const funnel = data.stages.filter((row) => !local.commercialStage || local.commercialStage === "all" || row.name === local.commercialStage);
    const team = data.team.filter((row) => !local.teamOwner || local.teamOwner === "all" || row.name === local.teamOwner);
    const partners = data.partners.filter((row) => !local.partner || local.partner === "all" || row.name === local.partner);
    const periodCustom = filters.preset === "custom";
    const presets = [["month", "Este mes"], ["last_30", "Ultimos 30 dias"], ["quarter", "Trimestre"], ["year", "Este ano"], ["last_12", "Ultimos 12 meses"], ["custom", "Selecionar periodo"]];
    target.innerHTML = `<main class="saas-module reports-module">
      <div class="saas-module-head"><div><p class="saas-eyebrow">Inteligencia comercial</p><h2>Relatorios e KPIs</h2><p>Indicadores calculados a partir do CRM, propostas e parceiros.</p></div><div class="saas-actions"><button class="saas-button" id="reports-refresh" type="button">Atualizar</button></div></div>
      <section class="saas-report-period"><div><p class="saas-eyebrow">Periodo do relatorio</p><strong>${escape(filters.start)} a ${escape(filters.end)}</strong></div><div class="saas-period-presets">${presets.map(([id, label]) => `<button class="saas-button ${filters.preset === id ? "primary" : ""}" data-report-preset="${id}" type="button">${label}</button>`).join("")}</div>${periodCustom ? `<div class="saas-report-custom"><label>Inicio<input class="saas-input" id="report-start" type="date" value="${escape(filters.start)}"></label><label>Fim<input class="saas-input" id="report-end" type="date" value="${escape(filters.end)}"></label><button class="saas-button primary" id="reports-apply-period" type="button">Aplicar periodo</button></div>` : ""}</section>
      <section class="saas-report-block"><header class="saas-report-block-head"><div><span>01</span><div><p class="saas-eyebrow">Atracao e topo de funil</p><h3>Marketing</h3></div></div><label class="saas-field kpi-local-filter">Canal<select class="saas-select" id="report-marketing-channel"><option value="all">Todos os canais</option>${data.channels.map((row) => `<option value="${escape(row.name)}" ${local.marketingChannel === row.name ? "selected" : ""}>${escape(row.name)}</option>`).join("")}</select></label></header><div class="saas-report-grid compact">${card("Total de leads", data.summary.leads, data.summary.mom === null ? "Sem base no mes anterior" : `${data.summary.mom >= 0 ? "+" : ""}${data.summary.mom.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% vs. mes anterior`, data.summary.mom >= 0 ? "positive" : "")}${card("Taxa de qualificacao", `${data.summary.qualification}%`, "Avancaram para briefing, medicao ou alem")}</div><div class="saas-report-panel"><div class="saas-section-heading"><div><span>Canal</span><h4>Distribuicao de leads</h4></div><p>Origem dos contatos no periodo.</p></div>${bars(marketing, Math.max(1, marketing.reduce((sum, row) => sum + row.leads, 0)), (row) => `${money(row.value)} em oportunidades`)}</div></section>
      <section class="saas-report-block"><header class="saas-report-block-head"><div><span>02</span><div><p class="saas-eyebrow">Desempenho comercial</p><h3>Funil de vendas</h3></div></div><label class="saas-field kpi-local-filter">Etapa<select class="saas-select" id="report-commercial-stage"><option value="all">Todas as etapas</option>${data.stages.map((row) => `<option value="${escape(row.name)}" ${local.commercialStage === row.name ? "selected" : ""}>${escape(row.name)}</option>`).join("")}</select></label></header><div class="saas-report-grid four">${card("Ticket medio de orcamentos", money(data.summary.proposalTicket), `${data.proposals.length} proposta(s) no periodo`) }${card("Ticket medio de vendas", money(data.summary.salesTicket), `${data.closed.length} venda(s) fechada(s)`) }${card("Taxa de conversao", `${data.summary.conversion}%`, "Leads que se tornaram venda") }${card("Tempo medio de fechamento", `${data.summary.closeDays} dias`, "Do primeiro contato ao fechamento")}</div><div class="saas-report-columns"><section class="saas-report-panel"><div class="saas-section-heading"><div><span>Funil</span><h4>Resumo por etapa</h4></div><p>Volume e valor de oportunidade.</p></div>${bars(funnel, Math.max(1, funnel.reduce((sum, row) => sum + row.count, 0)), (row) => `${row.probability}% | ${money(row.value)}`)}</section><section class="saas-report-panel"><div class="saas-section-heading"><div><span>Perdas</span><h4>Motivos de perda</h4></div><p>Negociacoes perdidas no periodo.</p></div>${bars(data.losses, Math.max(1, data.lost.length), (row) => `${Math.round(row.count / Math.max(1, data.lost.length) * 100)}% das perdas`)}</section></div><section class="saas-table-wrap"><div class="saas-section-heading"><div><span>Canal</span><h4>Performance por canal</h4></div><p>Leads, vendas e conversao.</p></div><table class="saas-table"><thead><tr><th>Canal</th><th>Leads</th><th>Vendas</th><th>Conversao</th><th>Ticket medio</th></tr></thead><tbody>${data.channels.map((row) => `<tr><td><strong>${escape(row.name)}</strong></td><td>${row.leads}</td><td>${row.wins}</td><td>${row.leads ? Math.round(row.wins / row.leads * 100) : 0}%</td><td>${row.wins ? money(row.value / row.wins) : "-"}</td></tr>`).join("") || '<tr><td colspan="5">Nenhum canal registrado.</td></tr>'}</tbody></table></section></section>
      <section class="saas-report-block"><header class="saas-report-block-head"><div><span>03</span><div><p class="saas-eyebrow">Produtividade e parcerias</p><h3>Equipe e especificadores</h3></div></div><div class="saas-local-filter-group"><label class="saas-field kpi-local-filter">Responsavel<select class="saas-select" id="report-team-owner"><option value="all">Toda a equipe</option>${data.team.map((row) => `<option value="${escape(row.name)}" ${local.teamOwner === row.name ? "selected" : ""}>${escape(row.name)}</option>`).join("")}</select></label><label class="saas-field kpi-local-filter">Especificador<select class="saas-select" id="report-partner"><option value="all">Todos</option>${data.partners.map((row) => `<option value="${escape(row.name)}" ${local.partner === row.name ? "selected" : ""}>${escape(row.name)}</option>`).join("")}</select></label></div></header><section class="saas-table-wrap"><div class="saas-section-heading"><div><span>Equipe</span><h4>Performance por projetista ou consultor</h4></div><p>Revisoes serao preenchidas quando os projetos relacionais entrarem em operacao.</p></div><table class="saas-table"><thead><tr><th>Responsavel</th><th>Apresentados</th><th>Vendidos</th><th>Conversao</th><th>Ticket medio</th><th>Revisoes</th></tr></thead><tbody>${team.map((row) => `<tr><td><strong>${escape(row.name)}</strong></td><td>${row.presented}</td><td>${row.sold}</td><td>${row.conversion}%</td><td>${money(row.ticket)}</td><td>${row.revisions}</td></tr>`).join("") || '<tr><td colspan="6">Nenhum responsavel com atividade no periodo.</td></tr>'}</tbody></table></section><div class="saas-report-grid compact">${card("Vendas por parcerias", money(data.summary.partnerSales), "Vendas fechadas com especificador vinculado")}${card("RT / comissao estimada", money(data.summary.partnerRt), "Analises de preco salvas")}</div><section class="saas-report-panel"><div class="saas-section-heading"><div><span>Top 5</span><h4>Arquitetos e parceiros</h4></div><p>Ranking de vendas do periodo.</p></div>${bars(partners.slice(0, 5).map((row) => ({ ...row, count: Math.round(row.sales) })), Math.max(1, partners[0]?.sales || 0), (row) => `${money(row.sales)} | RT ${money(row.rt)}`)}</section></section>
      <section class="saas-report-block future"><header class="saas-report-block-head"><div><span>04</span><div><p class="saas-eyebrow">Preparacao futura</p><h3>Operacao, qualidade e pos-venda</h3></div></div><span class="saas-badge muted">Aguardando dados de projetos</span></header><div class="saas-report-grid compact">${card("Assistencia tecnica / avarias", "-", "Chamados pos-venda por projeto vendido")}${card("Lead time entrega e montagem", "-", "Fechamento ate montagem concluida")}${card("NPS / satisfacao", "-", "Pesquisa apos a montagem")}</div><p class="saas-report-note">A estrutura ja esta preparada. Estes indicadores serao alimentados pelos marcos operacionais, chamados e pesquisas de satisfacao em uma proxima etapa.</p></section>
      <p class="saas-report-source">Fonte atual: CRM, propostas, usuarios e especificadores do GP Mirari. A consulta relacional no Supabase permanece preparada para a migracao gradual.</p>
    </main>`;
    document.querySelectorAll("[data-report-preset]").forEach((button) => button.onclick = () => { window.reportFilters = button.dataset.reportPreset === "custom" ? { ...filters, preset: "custom" } : rangeFor(button.dataset.reportPreset); render(); });
    byId("reports-apply-period")?.addEventListener("click", () => { window.reportFilters = { preset: "custom", start: byId("report-start").value || filters.start, end: byId("report-end").value || filters.end }; render(); });
    byId("reports-refresh").onclick = render;
    byId("report-marketing-channel")?.addEventListener("change", (event) => { window.reportBlockFilters = { ...local, marketingChannel: event.target.value }; render(); });
    byId("report-commercial-stage")?.addEventListener("change", (event) => { window.reportBlockFilters = { ...local, commercialStage: event.target.value }; render(); });
    byId("report-team-owner")?.addEventListener("change", (event) => { window.reportBlockFilters = { ...local, teamOwner: event.target.value }; render(); });
    byId("report-partner")?.addEventListener("change", (event) => { window.reportBlockFilters = { ...local, partner: event.target.value }; render(); });
  }

  window.GPMirariReports = { render };
})();
