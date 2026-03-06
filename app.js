const view = document.getElementById("view");

function setHtml(html) {
  if (view) view.innerHTML = html;
}

function addLine(text) {
  if (!view) return;
  view.innerHTML += `<div style="margin:8px 0;padding:10px;border:1px solid #333;border-radius:10px;white-space:pre-wrap;word-break:break-word;">${escapeHtml(text)}</div>`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getDiscordId(user) {
  return (
    user?.user_metadata?.provider_id ||
    user?.user_metadata?.sub ||
    user?.identities?.[0]?.id ||
    user?.app_metadata?.provider_id ||
    null
  );
}

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";

setHtml("<p>Старт app.js...</p>");

if (!window.supabase) {
  addLine("ОШИБКА: window.supabase не найден");
  throw new Error("Supabase CDN not loaded");
}

addLine("Supabase CDN найден");

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
addLine("Supabase client создан");

async function login() {
  addLine("Запуск Discord OAuth...");
  await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: {
      scopes: "identify guilds",
      redirectTo: "https://lunaria-dashboard.pages.dev/auth/callback/"
    }
  });
}

async function logout() {
  await supabase.auth.signOut();
  location.href = "/";
}

window.login = login;
window.logout = logout;

async function loadManageableGuilds(discordId) {
  addLine("Читаю guild_admins для user_id = " + discordId);

  const { data: adminRows, error: adminError } = await supabase
    .from("guild_admins")
    .select("guild_id, role")
    .eq("user_id", discordId);

  if (adminError) {
    throw new Error("guild_admins error: " + adminError.message);
  }

  addLine("guild_admins rows: " + JSON.stringify(adminRows || []));

  const guildIds = [...new Set((adminRows || []).map(row => row.guild_id))];

  if (!guildIds.length) {
    return [];
  }

  addLine("Читаю bot_guilds для guild_ids: " + JSON.stringify(guildIds));

  const { data: guilds, error: guildError } = await supabase
    .from("bot_guilds")
    .select("guild_id, name, icon, updated_at")
    .in("guild_id", guildIds);

  if (guildError) {
    throw new Error("bot_guilds error: " + guildError.message);
  }

  addLine("bot_guilds rows: " + JSON.stringify(guilds || []));

  const roleMap = new Map((adminRows || []).map(row => [row.guild_id, row.role || "admin"]));

  return (guilds || []).map(guild => ({
    ...guild,
    role: roleMap.get(guild.guild_id) || "admin"
  }));
}

function renderLoggedOut() {
  setHtml(`
    <h2>Добро пожаловать</h2>
    <p>Сессии нет. Нужно войти через Discord.</p>
    <button onclick="login()">Login with Discord</button>
  `);
}

function renderNoAccess(user, discordId) {
  setHtml(`
    <h2>Ты вошла через Discord</h2>
    <p><b>${escapeHtml(user?.user_metadata?.full_name || "User")}</b></p>
    <p>Discord ID: ${escapeHtml(discordId || "не найден")}</p>
    <button onclick="logout()">Выйти</button>
    <hr>
    <p>В guild_admins нет серверов для этого Discord ID.</p>
  `);
}

function renderGuilds(user, discordId, guilds) {
  setHtml(`
    <h2>Ты вошла через Discord</h2>
    <p><b>${escapeHtml(user?.user_metadata?.full_name || "User")}</b></p>
    <p>Discord ID: ${escapeHtml(discordId || "не найден")}</p>
    <button onclick="logout()">Выйти</button>
    <hr>
    <h3>Серверы</h3>
    <div id="guilds"></div>
  `);

  const guildsBox = document.getElementById("guilds");
  guildsBox.innerHTML = guilds.map(g => `
    <div style="margin:12px 0;padding:12px;border:1px solid #333;border-radius:12px;">
      <div><b>${escapeHtml(g.name || "Server")}</b></div>
      <div>Guild ID: ${escapeHtml(g.guild_id)}</div>
      <div>Role: ${escapeHtml(g.role || "admin")}</div>
      <div style="margin-top:8px;">
        <a href="./manage.html?guild=${encodeURIComponent(g.guild_id)}">Manage</a>
      </div>
    </div>
  `).join("");
}

async function init() {
  try {
    addLine("init() стартовал");

    const { data, error } = await supabase.auth.getSession();

    if (error) {
      addLine("Ошибка getSession: " + error.message);
      return;
    }

    addLine("getSession() выполнен");

    const session = data?.session;

    if (!session) {
      addLine("Сессии нет");
      renderLoggedOut();
      return;
    }

    addLine("Сессия найдена");

    const user = session.user;
    addLine("user: " + JSON.stringify(user, null, 2));

    const discordId = getDiscordId(user);
    addLine("discordId: " + String(discordId));

    if (!discordId) {
      setHtml(`
        <h2>Сессия есть, но Discord ID не найден</h2>
        <button onclick="logout()">Выйти</button>
        <pre style="white-space:pre-wrap;word-break:break-word;">${escapeHtml(JSON.stringify(user, null, 2))}</pre>
      `);
      return;
    }

    const guilds = await loadManageableGuilds(discordId);

    if (!guilds.length) {
      renderNoAccess(user, discordId);
      return;
    }

    renderGuilds(user, discordId, guilds);
  } catch (e) {
    addLine("FATAL ERROR: " + (e?.message || String(e)));
    console.error(e);
  }
}

init();
