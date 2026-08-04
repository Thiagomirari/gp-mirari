import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const headers = {
  "Access-Control-Allow-Origin": "https://gp.mirari.com.br",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const allowedPaths = new Set(["summary", "funnel", "acquisition", "losses", "designers", "partners", "operations", "filter-options"]);

function dateRange(filters: Record<string, unknown>) {
  const start = String(filters.start || "").trim();
  const end = String(filters.end || "").trim();
  return { start: start || null, end: end || null };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!token) return json({ error: "unauthenticated" }, 401);
  const db = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) return json({ error: "unauthenticated" }, 401);
  const body = await request.json().catch(() => ({}));
  const path = String(body.path || "summary");
  if (!allowedPaths.has(path)) return json({ error: "unsupported_path" }, 400);
  const filters = body.filters && typeof body.filters === "object" ? body.filters : {};
  const organizationId = String(body.organizationId || filters.organizationId || "");
  if (!organizationId) return json({ error: "organization_required" }, 400);
  const { data: membership, error: membershipError } = await db.from("gp_v2_memberships").select("role,status").eq("organization_id", organizationId).eq("user_id", auth.user.id).maybeSingle();
  if (membershipError || membership?.status !== "active") return json({ error: "active_membership_required" }, 403);
  const range = dateRange(filters);
  const applyRange = <T extends { gte: (column: string, value: string) => T; lte: (column: string, value: string) => T }>(query: T, column: string) => {
    if (range.start) query = query.gte(column, range.start);
    if (range.end) query = query.lte(column, `${range.end}T23:59:59.999Z`);
    return query;
  };
  const opportunityQuery = applyRange(db.from("gp_v2_report_opportunity_facts_v").select("*", { count: "exact" }).eq("organization_id", organizationId), "first_contact_at");
  const { data: opportunities, error: opportunityError } = await opportunityQuery;
  if (opportunityError) return json({ error: opportunityError.message }, 400);
  const rows = opportunities || [];
  const number = (value: unknown) => Number(value || 0);
  const money = (row: Record<string, unknown>) => number(row.value_cents || row.estimated_value_cents || row.closed_value_cents) / 100;
  const total = rows.reduce((sum, row) => sum + money(row), 0);
  const weighted = rows.reduce((sum, row) => sum + money(row) * number(row.probability) / 100, 0);
  const won = rows.filter((row) => ["won", "Ganha", "Fechada", "Ganho"].includes(String(row.status))).length;
  const noNextAction = rows.filter((row) => !row.next_task_at).length;
  const overdue = rows.filter((row) => row.next_task_at && new Date(String(row.next_task_at)).getTime() < Date.now()).length;
  const stageMap = new Map<string, { stage: string; count: number; value: number; probability: number }>();
  rows.forEach((row) => { const stage = String(row.stage_name || "Sem etapa"); const current = stageMap.get(stage) || { stage, count: 0, value: 0, probability: number(row.probability) }; current.count += 1; current.value += money(row); stageMap.set(stage, current); });
  const channelMap = new Map<string, { channel: string; leads: number; value: number }>();
  rows.forEach((row) => { const channel = String(row.acquisition_channel || "Nao informado"); const current = channelMap.get(channel) || { channel, leads: 0, value: 0 }; current.leads += 1; current.value += money(row); channelMap.set(channel, current); });
  const response = {
    summary: { totalLeads: rows.length, pipelineValue: total, weightedPipeline: weighted, conversion: rows.length ? Math.round(won / rows.length * 100) : 0, noNextAction, overdue },
    funnel: [...stageMap.values()],
    channels: [...channelMap.values()],
    designers: [],
    partners: [],
    operations: { serviceCases: 0, averageDeliveryDays: 0, nps: null },
    meta: { path, organizationId, generatedAt: new Date().toISOString(), source: "gp_v2_report_opportunity_facts_v" },
  };
  return json(response);
});
