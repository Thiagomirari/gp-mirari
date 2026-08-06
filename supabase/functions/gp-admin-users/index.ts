import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("GP_ALLOWED_ORIGIN") || "https://gp.mirari.com.br",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AppUser = {
  id: string;
  authUserId?: string;
  name: string;
  username: string;
  password?: string;
  role: string;
  permission: "ADM" | "Operacional";
  active: boolean;
  googleEnabled?: boolean;
  authMethods?: string[];
  sessionVersion?: number;
};

function passwordError(password: string) {
  if (password.length < 12) return "A senha deve ter pelo menos 12 caracteres.";
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password)) return "A senha deve conter letras maiusculas e minusculas.";
  if (!/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) return "A senha deve conter numero e simbolo.";
  if (/^(?:password|senha|admin|mirari|gp.?mirari|123456|qwerty)/i.test(password)) return "Escolha uma senha menos previsivel.";
  return "";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function readSecretKey() {
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  const secrets = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!secrets) return "";
  const parsed = JSON.parse(secrets);
  return parsed.default || Object.values(parsed)[0] || "";
}

function loginEmail(username: string) {
  const value = String(username || "").trim().toLowerCase();
  return value.includes("@") ? value : `${value}@gp-mirari.local`;
}

function storedUsername(usernameOrEmail: string) {
  const value = String(usernameOrEmail || "").trim().toLowerCase();
  return value.includes("@") ? value : value;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function cleanUser(user: AppUser) {
  return {
    ...user,
    password: "",
    mustChangePassword: false,
    sessionVersion: Number(user.sessionVersion || 1),
    googleEnabled: !!user.googleEnabled,
    authMethods: Array.isArray(user.authMethods) && user.authMethods.length
      ? user.authMethods
      : [user.googleEnabled ? "google" : "password"],
  };
}

async function resolveAuthUserId(adminClient: ReturnType<typeof createClient>, appUser: AppUser) {
  const email = loginEmail(appUser.username);
  if (appUser.authUserId && isUuid(appUser.authUserId)) {
    const { data } = await adminClient.auth.admin.getUserById(appUser.authUserId);
    if (data?.user) return appUser.authUserId;
  }
  if (appUser.id && isUuid(appUser.id)) {
    const { data } = await adminClient.auth.admin.getUserById(appUser.id);
    if (data?.user) return appUser.id;
  }
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (data.users.length < 100) break;
  }
  return "";
}

async function syncProfile(adminClient: ReturnType<typeof createClient>, user: AppUser) {
  const authUserId = user.authUserId || user.id;
  if (!isUuid(authUserId)) return;
  const { error } = await adminClient.from("gp_profiles").upsert({
    id: authUserId,
    name: user.name,
    role: user.role || "Operacional",
    permission: user.permission === "ADM" ? "ADM" : "Operacional",
    active: user.active !== false,
  }, { onConflict: "id" });
  if (error) console.warn("gp_profiles sync skipped:", error.message);
}

async function syncMembership(adminClient: ReturnType<typeof createClient>, organizationId: string, user: AppUser) {
  const authUserId = user.authUserId || user.id;
  if (!isUuid(authUserId)) return;
  const { data: existing, error: existingError } = await adminClient
    .from("gp_v2_memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", authUserId)
    .maybeSingle();
  if (existingError) throw existingError;
  const { error } = await adminClient.from("gp_v2_memberships").upsert({
    organization_id: organizationId,
    user_id: authUserId,
    // The legacy UI has no owner option. Preserve owner assignments created
    // through the relational bootstrap instead of accidentally downgrading it.
    role: existing?.role === "owner" ? "owner" : (user.permission === "ADM" ? "admin" : "operational"),
    status: user.active !== false ? "active" : "suspended",
    joined_at: user.active !== false ? new Date().toISOString() : null,
  }, { onConflict: "organization_id,user_id" });
  if (error) throw error;
}

async function assertOwnerMutation(
  adminClient: ReturnType<typeof createClient>,
  organizationId: string,
  targetUserId: string,
  callerUserId: string,
  callerRole: string,
  action: string,
  targetWillBeActive: boolean,
) {
  if (!targetUserId) return;
  const { data: targetMembership, error: targetError } = await adminClient
    .from("gp_v2_memberships")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (targetMembership?.role !== "owner") return;

  if (callerRole !== "owner") {
    throw new Error("Somente um owner pode alterar outro owner.");
  }
  if (action !== "remove" && targetWillBeActive) return;

  const { count, error: countError } = await adminClient
    .from("gp_v2_memberships")
    .select("user_id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("role", "owner")
    .eq("status", "active");
  if (countError) throw countError;
  if ((count || 0) <= 1) {
    throw new Error("A organizacao precisa manter pelo menos um owner ativo.");
  }
  if (action === "remove" && targetUserId === callerUserId) {
    throw new Error("Voce nao pode remover o proprio usuario.");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Metodo nao permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = readSecretKey();
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: "Variaveis do Supabase ausentes na Edge Function." }, 500);

  const authHeader = req.headers.get("Authorization") || "";
  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: callerData, error: callerError } = await callerClient.auth.getUser();
  if (callerError || !callerData.user) return json({ error: "Sessao invalida." }, 401);

  const organizationId = String(Deno.env.get("GP_APP_ORGANIZATION_ID") || "");
  if (!isUuid(organizationId)) return json({ error: "GP_APP_ORGANIZATION_ID ausente ou invalida." }, 500);
  const { data: callerMembership, error: callerMembershipError } = await adminClient
    .from("gp_v2_memberships")
    .select("role,status")
    .eq("organization_id", organizationId)
    .eq("user_id", callerData.user.id)
    .maybeSingle();
  if (callerMembershipError) return json({ error: callerMembershipError.message }, 500);
  if (callerMembership?.status !== "active" || !["owner", "admin"].includes(callerMembership.role)) {
    return json({ error: "Apenas owner ou admin ativo pode gerenciar usuarios." }, 403);
  }

  const { data: stateRow, error: stateError } = await adminClient
    .from("gp_app_settings")
    .select("value")
    .eq("key", "app_state")
    .maybeSingle();
  if (stateError) return json({ error: stateError.message }, 500);

  const appState = stateRow?.value || {};
  const users: AppUser[] = Array.isArray(appState.users) ? appState.users : [];

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const payload = body.user || {};
  const now = new Date().toISOString();
  if (!["create", "update", "resetPassword", "remove", "toggleActive"].includes(action)) return json({ error: "Acao invalida." }, 400);

  const stateUsers = [...users];
  let createdAuthUserId = "";

  try {
    if (action === "create") {
      const username = storedUsername(payload.username);
      const password = String(payload.password || "").trim();
      if (password) {
        const issue = passwordError(password);
        if (issue) return json({ error: issue }, 400);
      }
      const googleEnabled = !!payload.googleEnabled;
      const authMethods = Array.isArray(payload.authMethods) && payload.authMethods.length
        ? payload.authMethods
        : [password ? "password" : "", googleEnabled ? "google" : ""].filter(Boolean);
      const name = String(payload.name || username).trim();
      if (!username || !name) return json({ error: "Nome e usuario sao obrigatorios." }, 400);
      if (!password && !googleEnabled) return json({ error: "Informe senha inicial ou habilite entrada com Google." }, 400);
      if (googleEnabled && !username.includes("@")) return json({ error: "Para Google, informe o e-mail completo." }, 400);
      if (stateUsers.some((user) => storedUsername(user.username) === username)) return json({ error: "Este usuario ja existe." }, 409);

      let authUserId = "";
      if (password || googleEnabled) {
        const { data, error } = await adminClient.auth.admin.createUser({
          email: loginEmail(username),
          password: password || undefined,
          email_confirm: true,
          user_metadata: { name, username },
        });
        if (error || !data.user?.id) return json({ error: error?.message || "Nao foi possivel criar o usuario no Supabase Auth." }, 400);
        authUserId = data.user.id;
        createdAuthUserId = data.user.id;
      }

      const nextUser = cleanUser({
        id: authUserId || `u-${crypto.randomUUID()}`,
        authUserId,
        name,
        username,
        role: String(payload.role || "Operacional"),
        permission: payload.permission === "ADM" ? "ADM" : "Operacional",
        active: payload.active !== false,
        googleEnabled,
        authMethods,
        sessionVersion: Number(payload.sessionVersion || 1),
      });
      await syncProfile(adminClient, nextUser);
      await syncMembership(adminClient, organizationId, nextUser);
      stateUsers.push(nextUser);
    }

    if (["update", "resetPassword", "toggleActive"].includes(action)) {
      const id = String(payload.id || "");
      const index = stateUsers.findIndex((user) => user.id === id);
      if (index < 0) return json({ error: "Usuario nao encontrado." }, 404);
      const current = stateUsers[index];
      const username = storedUsername(payload.username || current.username);
      const googleEnabled = typeof payload.googleEnabled === "boolean" ? payload.googleEnabled : !!current.googleEnabled;
      if (googleEnabled && !username.includes("@")) return json({ error: "Para Google, informe o e-mail completo." }, 400);

      const updates: Record<string, unknown> = {};
      if (action === "update") {
        if (username && username !== current.username) updates.email = loginEmail(username);
        if (payload.password) {
          updates.password = String(payload.password);
          const issue = passwordError(String(updates.password));
          if (issue) return json({ error: issue }, 400);
        }
        updates.user_metadata = { name: payload.name || current.name, username };
      }
      if (action === "resetPassword") {
        if (!payload.password) return json({ error: "Nova senha obrigatoria." }, 400);
        updates.password = String(payload.password);
        const issue = passwordError(String(updates.password));
        if (issue) return json({ error: issue }, 400);
      }

      let authUserId = await resolveAuthUserId(adminClient, current);
      const targetWillBeActive = typeof payload.active === "boolean" ? payload.active : current.active;
      await assertOwnerMutation(
        adminClient,
        organizationId,
        authUserId,
        callerData.user.id,
        callerMembership.role,
        action,
        targetWillBeActive,
      );
      if (!authUserId && (payload.password || action === "resetPassword" || googleEnabled)) {
        const { data, error } = await adminClient.auth.admin.createUser({
          email: loginEmail(username),
          password: payload.password ? String(payload.password) : undefined,
          email_confirm: true,
          user_metadata: { name: payload.name || current.name, username },
        });
        if (error || !data.user?.id) return json({ error: error?.message || "Nao foi possivel criar o acesso no Supabase Auth." }, 400);
        authUserId = data.user.id;
        createdAuthUserId = data.user.id;
      }

      if (authUserId && Object.keys(updates).length) {
        const { error } = await adminClient.auth.admin.updateUserById(authUserId, updates);
        if (error) return json({ error: error.message }, 400);
      }

      const authMethods = Array.isArray(payload.authMethods) && payload.authMethods.length
        ? payload.authMethods
        : [payload.password || current.authMethods?.includes("password") ? "password" : "", googleEnabled ? "google" : ""].filter(Boolean);
      const nextUser = cleanUser({
        ...current,
        // Keep the legacy ID stable: projects and CRM records still refer to
        // it while the application is being migrated to relational tables.
        id: current.id,
        authUserId: authUserId || current.authUserId || "",
        name: String(payload.name || current.name),
        username,
        role: String(payload.role || current.role || "Operacional"),
        permission: payload.permission === "ADM" ? "ADM" : (payload.permission === "Operacional" ? "Operacional" : current.permission),
        active: typeof payload.active === "boolean" ? payload.active : current.active,
        googleEnabled,
        authMethods,
        sessionVersion: Number(payload.sessionVersion || current.sessionVersion || 1),
      });
      await syncProfile(adminClient, nextUser);
      await syncMembership(adminClient, organizationId, nextUser);
      stateUsers[index] = nextUser;
    }

    if (action === "remove") {
      const id = String(payload.id || "");
      const index = stateUsers.findIndex((user) => user.id === id);
      if (index < 0) return json({ error: "Usuario nao encontrado." }, 404);
      const target = stateUsers[index];
      const authUserId = await resolveAuthUserId(adminClient, target);
      await assertOwnerMutation(
        adminClient,
        organizationId,
        authUserId,
        callerData.user.id,
        callerMembership.role,
        action,
        false,
      );
      if (authUserId === callerData.user.id) return json({ error: "Voce nao pode remover o proprio usuario." }, 400);
      if (authUserId) {
        const { error } = await adminClient.auth.admin.deleteUser(authUserId);
        if (error) return json({ error: error.message }, 400);
      }
      stateUsers.splice(index, 1);
    }

    const nextState = { ...appState, users: stateUsers, sessionUserId: "", updatedAt: now };
    const { error: saveError } = await adminClient
      .from("gp_app_settings")
      .upsert({ key: "app_state", value: nextState, updated_at: now });
    if (saveError) {
      if (createdAuthUserId) await adminClient.auth.admin.deleteUser(createdAuthUserId);
      return json({ error: saveError.message }, 500);
    }
    return json({ ok: true, state: nextState });
  } catch (error) {
    if (createdAuthUserId) await adminClient.auth.admin.deleteUser(createdAuthUserId);
    const message = error instanceof Error ? error.message : "Nao foi possivel sincronizar o usuario.";
    return json({ error: message }, 500);
  }
});
