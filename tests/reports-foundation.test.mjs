import fs from "node:fs";
import path from "node:path";

const migrationPath = path.resolve("migrations/006-reports-kpis-foundation.sql");
const sql = fs.readFileSync(migrationPath, "utf8");

const requiredTokens = [
  "begin;",
  "commit;",
  "gp_v2_feature_flags",
  "gp_v2_branches",
  "gp_v2_acquisition_channels",
  "gp_v2_clients",
  "gp_v2_partners",
  "gp_v2_loss_reasons",
  "gp_v2_crm_stage_history",
  "gp_v2_crm_activities",
  "gp_v2_opportunity_assignments",
  "gp_v2_sales",
  "gp_v2_sale_partner_commissions",
  "gp_v2_projects_relational",
  "gp_v2_project_revisions",
  "gp_v2_service_cases",
  "gp_v2_nps_surveys",
  "gp_v2_nps_responses",
  "gp_v2_report_daily_metrics",
  "gp_v2_report_refresh_log",
  "security_invoker = true",
  "gp_v2_is_active_member",
  "gp_v2_has_role"
];

for (const token of requiredTokens) {
  if (!sql.includes(token)) throw new Error(`Migration de relatorios sem token obrigatorio: ${token}`);
}

if (/grant\s+all\s+on\s+(table\s+)?public\.[^;]+\s+to\s+anon/i.test(sql)) {
  throw new Error("Migration de relatorios nao pode conceder acesso para anon.");
}

const createTables = [...sql.matchAll(/create table if not exists public\.([a-z0-9_]+)/gi)].map((match) => match[1]);
for (const table of createTables) {
  const tableStart = sql.indexOf(`create table if not exists public.${table}`);
  const tableEnd = sql.indexOf(";", tableStart);
  const definition = sql.slice(tableStart, tableEnd);
  if (!definition.includes("organization_id uuid not null")) {
    throw new Error(`Tabela ${table} precisa possuir organization_id obrigatorio.`);
  }
}

if (!/unique nulls not distinct \(organization_id, metric_date, branch_id, channel_id, designer_id\)/i.test(sql)) {
  throw new Error("Agregado diario precisa impedir duplicidade no grao de dimensoes.");
}

console.log(`reports-foundation: ok (${createTables.length} tabelas verificadas)`);
