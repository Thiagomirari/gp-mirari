(function () {
  "use strict";
  const storageKey = "gp_mirari_report_share_v1";
  const byId = (id) => document.getElementById(id);
  const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const number = (value) => Number(value || 0).toLocaleString("pt-BR");
  const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, Number(value || 0)));
  const dateTime = (value) => value ? new Date(value).toLocaleString("pt-BR") : "-";
  const node = (tag, className, text) => { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = String(text); return item; };

  function readToken() {
    const hash = new URLSearchParams(location.hash.slice(1));
    const token = hash.get("t") || sessionStorage.getItem(storageKey) || "";
    if (token) sessionStorage.setItem(storageKey, token);
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    return token;
  }

  async function loadReport(token) {
    const endpoint = String(window.GP_MIRARI_REPORT_ENDPOINT || "");
    if (!endpoint || token.length < 40) throw new Error("not_found");
    const response = await fetch(endpoint, { method: "POST", cache: "no-store", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "view", accessToken: token }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "not_found");
    return data;
  }

  function section(index, eyebrow, title, detail) {
    const wrapper = node("section", "public-section");
    const head = node("header", "section-head"); const left = node("div"); const titles = node("div");
    left.append(node("span", "", String(index).padStart(2, "0"))); titles.append(node("p", "", eyebrow), node("h2", "", title)); left.append(titles); head.append(left);
    if (detail) head.append(node("span", "", detail)); wrapper.append(head); return wrapper;
  }

  function kpi(label, value, detail) { const item = node("article", "public-kpi"); item.append(node("span", "", label), node("strong", "", value), node("small", "", detail)); return item; }
  function panel(title, detail) { const item = node("article", "public-panel"); item.append(node("h3", "", title), node("p", "", detail)); return item; }
  function bars(rows, label, value, meta) {
    const box = node("div", "public-bars"); const max = Math.max(1, ...rows.map(value));
    if (!rows.length) return node("p", "public-empty", "Nenhum dado para este período.");
    rows.forEach((row) => { const line = node("div", "public-bar"); const track = node("i"); const fill = node("b"); fill.style.width = `${clamp(value(row) / max * 100)}%`; track.append(fill); line.append(node("span", "", label(row)), track, node("small", "", meta(row))); box.append(line); }); return box;
  }
  function table(headers, rows) {
    const wrap = node("div", "public-table-wrap"); const table = node("table", "public-table"); const thead = node("thead"); const headerRow = node("tr");
    headers.forEach((header) => headerRow.append(node("th", "", header))); thead.append(headerRow); const tbody = node("tbody");
    rows.forEach((cells) => { const row = node("tr"); cells.forEach((cell) => { const td = node("td"); if (cell && typeof cell === "object") { td.append(node("strong", "", cell.primary)); if (cell.secondary) td.append(node("small", "", cell.secondary)); } else td.textContent = String(cell ?? "-"); row.append(td); }); tbody.append(row); });
    if (!rows.length) { const row = node("tr"); const td = node("td", "public-empty", "Nenhum dado para este período."); td.colSpan = headers.length; row.append(td); tbody.append(row); }
    table.append(thead, tbody); wrap.append(table); return wrap;
  }

  function renderSummary(report, root, index) {
    if (!report.summary) return index; const data = report.summary; const block = section(index++, "VISÃO EXECUTIVA", "Indicadores principais", report.period); const grid = node("div", "public-kpis");
    grid.append(kpi("Total de leads", number(data.leads), `${number(data.opportunities)} oportunidade(s)`), kpi("Valor no funil", money(data.pipeline), "Oportunidades abertas"), kpi("Ticket médio do funil", money(data.funnelTicket), "Média das oportunidades"), kpi("Valor vendido", money(data.soldValue), "Fechamentos no período"), kpi("Ticket médio vendido", money(data.salesTicket), "Média das vendas"), kpi("Conversão comercial", `${number(data.conversion)}%`, `${number(data.lostCount)} negócio(s) perdido(s)`)); block.append(grid); root.append(block); return index;
  }
  function renderGoals(report, root, index) {
    if (!report.goals) return index; const data = report.goals; const block = section(index++, "METAS COMERCIAIS", "Faturamento e atingimento", report.period); const grid = node("div", "public-grid-2"); const highlight = node("article", "public-highlight");
    highlight.append(node("span", "", "Meta do período"), node("strong", "", data.configured ? money(data.target) : "Meta não cadastrada"), node("small", "", data.configured ? `${number(data.attainment)}% atingido · vendido ${money(data.actual)}` : "Sem meta configurada")); const track = node("i"); const fill = node("b"); fill.style.width = `${clamp(data.attainment)}%`; track.append(fill); highlight.append(track);
    const refs = node("div", "public-kpis"); refs.append(kpi("Meta anual", money(data.annual), "Referência"), kpi("Semestre", money(data.semester), "Referência"), kpi("Trimestre", money(data.quarter), "Referência"), kpi("Mês", money(data.month), "Referência")); grid.append(highlight, refs); block.append(grid); root.append(block); return index;
  }
  function renderMarketing(report, root, index) {
    if (!report.marketing) return index; const data = report.marketing; const block = section(index++, "MARKETING", "Atração e topo de funil", `${number(data.qualification)}% de qualificação`); const chart = panel("Leads por canal", "Distribuição das oportunidades no período."); chart.append(bars(data.channels || [], (row) => row.name, (row) => Number(row.leads), (row) => `${number(row.leads)} lead(s)`)); block.append(chart); root.append(block); return index;
  }
  function renderChannelDetails(report, root, index) {
    if (!Array.isArray(report.channelDetails)) return index; const block = section(index++, "DETALHAMENTO", "Oportunidades por canal", "Conteúdo confidencial");
    report.channelDetails.forEach((channel) => { const item = panel(channel.name, `${(channel.opportunities || []).length} oportunidade(s)`); item.append(table(["Oportunidade", "Etapa", "Responsável", "Valor"], (channel.opportunities || []).map((row) => [{ primary: row.name, secondary: `${row.interest} · ${row.date || "-"}` }, row.stage, row.owner, money(row.value)]))); block.append(item); }); root.append(block); return index;
  }
  function renderEvolution(report, root, index) {
    if (!Array.isArray(report.evolution)) return index; const block = section(index++, "EVOLUÇÃO", "Leads e vendas ao longo do tempo", "Leads em areia · vendas em azul"); const chart = node("div", "public-timeline"); const max = Math.max(1, ...report.evolution.flatMap((row) => [Number(row.leads), Number(row.sold)]));
    report.evolution.forEach((row) => { const group = node("div"); const columns = node("i"); const leads = node("b"); const sold = node("b"); leads.style.height = `${clamp(Number(row.leads) / max * 100, 3)}%`; sold.style.height = `${clamp(Number(row.sold) / max * 100, 3)}%`; leads.title = `${number(row.leads)} leads`; sold.title = `${number(row.sold)} vendas`; columns.append(leads, sold); group.append(columns, node("small", "", row.label)); chart.append(group); }); block.append(chart); root.append(block); return index;
  }
  function renderCommercial(report, root, index) {
    if (!report.commercial) return index; const data = report.commercial; const block = section(index++, "COMERCIAL", "Desempenho e funil de vendas", `${number(data.conversion)}% de conversão`); const grid = node("div", "public-grid-2"); const funnel = panel("Funil de vendas", "Quantidade e valor por etapa."); funnel.append(bars(data.stages || [], (row) => row.name, (row) => Number(row.count), (row) => `${number(row.count)} · ${money(row.value)}`)); const closing = panel("Indicadores de venda", "Leitura rápida do período."); const kpis = node("div", "public-kpis"); kpis.append(kpi("Valor vendido", money(data.soldValue), "Fechamentos"), kpi("Ticket vendido", money(data.salesTicket), "Média"), kpi("Fechamento", `${number(data.closeDays)} dias`, "Tempo médio")); closing.append(kpis); grid.append(funnel, closing); block.append(grid, table(["Canal", "Leads", "Vendas", "Conversão", "Ticket médio"], (data.channels || []).map((row) => [row.name, number(row.leads), number(row.won), `${row.leads ? Math.round(row.won / row.leads * 100) : 0}%`, row.won ? money(row.value / row.won) : "-"]))); root.append(block); return index;
  }
  function renderProductivity(report, root, index) {
    if (!report.productivity) return index; const data = report.productivity; const block = section(index++, "EQUIPE E PARCERIAS", "Produtividade comercial", "Resultados consolidados"); block.append(table(["Atendente", "Apresentados", "Vendidos", "Conversão", "Ticket médio"], (data.team || []).map((row) => [row.name, number(row.presented), number(row.sold), `${number(row.conversion)}%`, money(row.ticket)]))); const grid = node("div", "public-grid-2"); const partners = panel("Arquitetos e especificadores", "Vendido e RT estimada."); partners.append(bars(data.partners || [], (row) => row.name, (row) => Number(row.sales), (row) => `${money(row.sales)} · RT ${money(row.rt)}`)); const totals = node("div", "public-kpis"); totals.append(kpi("Vendas por parceria", money(data.partnerSales), "Especificadores vinculados"), kpi("RT / comissão", money(data.partnerRt), "Estimativa")); grid.append(partners, totals); block.append(grid); root.append(block); return index;
  }
  function renderFuture(report, root, index) {
    if (!report.future) return index; const block = section(index++, "PREPARAÇÃO FUTURA", "Operação, qualidade e pós-venda", "Aguardando dados operacionais"); const grid = node("div", "public-kpis"); grid.append(kpi("Assistência técnica / avarias", "-", "Chamados por projeto vendido"), kpi("Entrega e montagem", "-", "Lead time operacional"), kpi("NPS / satisfação", "-", "Pesquisa após montagem")); block.append(grid); root.append(block); return index;
  }

  function render(data) {
    const report = data.report || {}; document.title = `${data.title || "Relatório executivo"} | GP Mirari`; byId("report-title").textContent = data.title || report.title || "Relatório executivo"; byId("report-period").textContent = report.period || "Período compartilhado"; byId("report-expiry").textContent = dateTime(data.expiresAt); byId("report-generated").textContent = `Gerado em ${dateTime(report.generatedAt || data.createdAt)}`;
    const filterBox = byId("report-filters"); const filters = Array.isArray(report.filters) ? report.filters : []; filterBox.hidden = !filters.length; filterBox.replaceChildren(...filters.map((item) => node("span", "", item)));
    const root = byId("report-sections"); root.replaceChildren(); let index = 1; index = renderSummary(report, root, index); index = renderGoals(report, root, index); index = renderMarketing(report, root, index); index = renderChannelDetails(report, root, index); index = renderEvolution(report, root, index); index = renderCommercial(report, root, index); index = renderProductivity(report, root, index); renderFuture(report, root, index);
    byId("loading-state").hidden = true; byId("error-state").hidden = true; byId("report-content").hidden = false;
  }

  function fail(error) { sessionStorage.removeItem(storageKey); byId("loading-state").hidden = true; byId("report-content").hidden = true; byId("error-state").hidden = false; if (String(error?.message) === "report_share_expired") byId("error-message").textContent = "A validade deste link terminou. Solicite um novo compartilhamento à Mirari."; }
  byId("print-report").addEventListener("click", () => window.print());
  loadReport(readToken()).then(render).catch(fail);
})();
