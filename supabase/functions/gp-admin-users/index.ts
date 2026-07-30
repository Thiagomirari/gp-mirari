import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AppUser = {
  id: string;
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

function publicUsername(usernameOrEmail: string) {
  const value = String(usernameOrEmail || "").trim();
  return value.includes("@") ? value.split("@")[0] : value;
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
  if (!isUuid(user.id)) return;
  const { error } = await adminClient.from("gp_profiles").upsert({
    id: user.id,
    name: user.name,
    role: user.role || "Operacional",
    permission: user.permission === "ADM" ? "ADM" : "Operacional",
    active: user.active !== false,
  }, { onConflict: "id" });
  if (error) console.warn("gp_profiles sync skipped:", error.message);
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

  const { data: stateRow, error: stateError } = await adminClient
    .from("gp_app_settings")
    .select("value")
    .eq("key", "app_state")
    .maybeSingle();
  if (stateError) return json({ error: stateError.message }, 500);

  const appState = stateRow?.value || {};
  const users: AppUser[] = Array.isArray(appState.users) ? appState.users : [];
  const callerEmail = callerData.user.email || "";
  const callerUsername = publicUsername(callerEmail);
  const caller = users.find((user) =>
    user.active &&
    user.permission === "ADM" &&
    (
      user.username?.toLowerCase() === callerEmail.toLowerCase() ||
      user.username?.toLowerCase() === callerUsername.toLowerCase() ||
      (callerUsername.toLowerCase() === "adm" && user.permission === "ADM")
    )
  );
  if (!caller) return json({ error: "Apenas ADM pode gerenciar usuarios." }, 403);

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
      if (password) {
        const { data, error } = await adminClient.auth.admin.createUser({
          email: loginEmail(username),
          password,
          email_confirm: true,
          user_metadata: { name, username },
        });
        if (error || !data.user?.id) return json({ error: error?.message || "Nao foi possivel criar o usuario no Supabase Auth." }, 400);
        authUserId = data.user.id;
        createdAuthUserId = data.user.id;
      }

      const nextUser = cleanUser({
        id: authUserId || `u-${crypto.randomUUID()}`,
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
        if (payload.password) updates.password = String(payload.password);
        updates.user_metadata = { name: payload.name || current.name, username };
      }
      if (action === "resetPassword") {
        if (!payload.password) return json({ error: "Nova senha obrigatoria." }, 400);
        updates.password = String(payload.password);
      }

      let authUserId = await resolveAuthUserId(adminClient, current);
      if (!authUserId && (payload.password || action === "resetPassword")) {
        const { data, error } = await adminClient.auth.admin.createUser({
          email: loginEmail(username),
          password: String(payload.password),
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
        id: authUserId || current.id,
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
      stateUsers[index] = nextUser;
    }

    if (action === "remove") {
      const id = String(payload.id || "");
      const index = stateUsers.findIndex((user) => user.id === id);
      if (index < 0) return json({ error: "Usuario nao encontrado." }, 404);
      const target = stateUsers[index];
      const authUserId = await resolveAuthUserId(adminClient, target);
      if (target.id === caller.id || authUserId === callerData.user.id) return json({ error: "Voce nao pode remover o proprio usuario." }, 400);
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
