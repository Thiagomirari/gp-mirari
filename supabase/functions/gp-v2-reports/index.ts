import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const headers = {
  "Access-Control-Allow-Origin": "https://gp.mirari.com.br",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const allowedPaths = new Set(["summary", "funnel", "acquisition", "losses", "designers", "partners", "operations", "filter-options"]);

type Filters = Record<string, unknown>;
type Opportunity = Record<string, unknown>;

const text = (value: unknown) => String(value ?? "").trim();
const number = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

function dateRange(filters: Filters) {
  const start = text(filters.start);
  const end = text(filters.end);
  return { start: start || null, end: end || null };
}

function isWithinRange(value: unknown, range: ReturnType<typeof dateRange>) {
  const date = text(value).slice(0, 10);
  return !!date && (!range.start || date >= range.start) && (!range.end || date <= range.end);
}

function isWon(row: Opportunity) {
  return text(row.stage_type) === "won" || ["won", "Ganha", "Fechada", "Ganho"].includes(text(row.status));
}

function isLost(row: Opportunity) {
  return text(row.stage_type) === "lost" || ["lost", "Perdida", "Perdido"].includes(text(row.status));
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (!url || !anon || !token) return json({ error: "unauthenticated" }, 401);

  const db = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: auth, error: authError } = await db.auth.getUser();
  if (authError || !auth.user) return json({ error: "unauthenticated" }, 401);

  const body = await request.json().catch(() => ({}));
  const path = text(body.path || "summary");
  if (!allowedPaths.has(path)) return json({ error: "unsupported_path" }, 400);

  const filters: Filters = body.filters && typeof body.filters === "object" ? body.filters as Filters : {};
  let organizationId = text(body.organizationId || filters.organizationId);
  const organizationSlug = text(body.organizationSlug || filters.organizationSlug).toLowerCase();
  if (!organizationId && organizationSlug) {
    const { data: organization, error } = await db.from("gp_v2_organizations").select("id").eq("slug", organizationSlug).maybeSingle();
    if (error) return json({ error: error.message }, 400);
    organizationId = text(organization?.id);
  }
  if (!organizationId) return json({ error: "organization_required" }, 400);

  const { data: membership, error: membershipError } = await db
    .from("gp_v2_memberships")
    .select("role,status")
    .eq("organization_id", organizationId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (membershipError || membership?.status !== "active") return json({ error: "active_membership_required" }, 403);

  const [factsResult, stagesResult, channelsResult, activitiesResult, partnersResult] = await Promise.all([
    db.from("gp_v2_report_opportunity_facts_v").select("*").eq("organization_id", organizationId),
    db.from("gp_v2_crm_stages").select("id,name,probability_percent,stage_type").eq("organization_id", organizationId),
    db.from("gp_v2_acquisition_channels").select("id,name").eq("organization_id", organizationId),
    db.from("gp_v2_crm_activities").select("opportunity_id,scheduled_at,status,completed_at").eq("organization_id", organizationId),
    db.from("gp_v2_partners").select("id,name").eq("organization_id", organizationId),
  ]);
  const firstError = [factsResult, stagesResult, channelsResult, activitiesResult, partnersResult].find((result) => result.error)?.error;
  if (firstError) return json({ error: firstError.message }, 400);

  const stageById = new Map((stagesResult.data || []).map((row) => [text(row.id), row]));
  const channelById = new Map((channelsResult.data || []).map((row) => [text(row.id), row]));
  const partnerById = new Map((partnersResult.data || []).map((row) => [text(row.id), row]));
  const pendingActivityByOpportunity = new Map<string, { scheduledAt: string }>();
  for (const activity of activitiesResult.data || []) {
    if (["completed", "cancelled"].includes(text(activity.status).toLowerCase()) || activity.completed_at) continue;
    const opportunityId = text(activity.opportunity_id);
    const scheduledAt = text(activity.scheduled_at);
    const previous = pendingActivityByOpportunity.get(opportunityId);
    if (!previous || scheduledAt < previous.scheduledAt) pendingActivityByOpportunity.set(opportunityId, { scheduledAt });
  }

  const range = dateRange(filters);
  const rows = (factsResult.data || []).map((fact) => {
    const stage = stageById.get(text(fact.stage_id));
    const channel = channelById.get(text(fact.acquisition_channel_id));
    const next = pendingActivityByOpportunity.get(text(fact.opportunity_id));
    return {
      ...fact,
      stage_name: text(stage?.name) || "Sem etapa",
      probability_percent: number(fact.probability_percent ?? stage?.probability_percent),
      stage_type: text(fact.stage_type ?? stage?.stage_type),
      acquisition_channel_name: text(channel?.name) || "Nao informado",
      next_activity_at: next?.scheduledAt || "",
    };
  }).filter((row) => {
    if (!isWithinRange(row.first_contact_at, range)) return false;
    if (text(filters.stageId) && text(filters.stageId) !== text(row.stage_id)) return false;
    if (text(filters.channelId) && text(filters.channelId) !== text(row.acquisition_channel_id)) return false;
    if (text(filters.designerId) && text(filters.designerId) !== text(row.designer_id)) return false;
    return true;
  });

  const value = (row: Opportunity) => number(row.estimated_value);
  const total = rows.reduce((sum, row) => sum + value(row), 0);
  const weighted = rows.reduce((sum, row) => sum + value(row) * number(row.probability_percent) / 100, 0);
  const won = rows.filter(isWon);
  const lost = rows.filter(isLost);
  const open = rows.filter((row) => !isWon(row) && !isLost(row));
  const now = Date.now();
  const noNextAction = open.filter((row) => !text(row.next_activity_at)).length;
  const overdue = open.filter((row) => {
    const due = new Date(text(row.next_activity_at)).getTime();
    return Number.isFinite(due) && due < now;
  }).length;

  const stageMap = new Map<string, { stage: string; count: number; value: number; probability: number }>();
  const channelMap = new Map<string, { channel: string; leads: number; value: number; won: number }>();
  const designerMap = new Map<string, { id: string; name: string; opportunities: number; won: number; value: number }>();
  const partnerMap = new Map<string, { id: string; name: string; sales: number; opportunities: number }>();
  for (const row of rows) {
    const stageName = text(row.stage_name) || "Sem etapa";
    const stage = stageMap.get(stageName) || { stage: stageName, count: 0, value: 0, probability: number(row.probability_percent) };
    stage.count += 1;
    stage.value += value(row);
    stageMap.set(stageName, stage);

    const channelName = text(row.acquisition_channel_name) || "Nao informado";
    const channel = channelMap.get(channelName) || { channel: channelName, leads: 0, value: 0, won: 0 };
    channel.leads += 1;
    channel.value += value(row);
    if (isWon(row)) channel.won += 1;
    channelMap.set(channelName, channel);

    const designerId = text(row.designer_id);
    if (designerId) {
      const designer = designerMap.get(designerId) || { id: designerId, name: `Usuario ${designerId.slice(0, 8)}`, opportunities: 0, won: 0, value: 0 };
      designer.opportunities += 1;
      designer.value += value(row);
      if (isWon(row)) designer.won += 1;
      designerMap.set(designerId, designer);
    }

    const partnerId = text(row.specifier_id);
    if (partnerId && isWon(row)) {
      const partner = partnerMap.get(partnerId) || { id: partnerId, name: text(partnerById.get(partnerId)?.name) || "Parceiro", sales: 0, opportunities: 0 };
      partner.sales += value(row);
      partner.opportunities += 1;
      partnerMap.set(partnerId, partner);
    }
  }

  return json({
    summary: {
      totalLeads: rows.length,
      pipelineValue: total,
      weightedPipeline: weighted,
      conversion: rows.length ? Math.round(won.length / rows.length * 100) : 0,
      noNextAction,
      overdue,
    },
    funnel: [...stageMap.values()],
    channels: [...channelMap.values()].map((row) => ({ channel: row.channel, leads: row.leads, value: row.value, conversion: row.leads ? Math.round(row.won / row.leads * 100) : 0 })),
    designers: [...designerMap.values()].map((row) => ({ ...row, conversion: row.opportunities ? Math.round(row.won / row.opportunities * 100) : 0 })),
    partners: [...partnerMap.values()].sort((a, b) => b.sales - a.sales),
    lost: lost.map((row) => ({ opportunityId: row.opportunity_id, reasonId: row.lost_reason_id })),
    operations: { serviceCases: 0, averageDeliveryDays: 0, nps: null },
    meta: { path, organizationId, generatedAt: new Date().toISOString(), source: "gp_v2_report_opportunity_facts_v", period: range },
  });
});
