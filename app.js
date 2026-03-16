const view = document.getElementById("view");

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";
const DASHBOARD_URL = "https://lunaria-dashboard.pages.dev";
const DISCORD_BOT_CLIENT_ID = "1473237338460127382";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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

function getGuildIconUrl(guildId, icon) {
  if (!guildId || !icon) return "";
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=128`;
}

function getInviteUrl() {
  const clientId = DISCORD_BOT_CLIENT_ID;
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=8`;
}

async function login() {
  await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: {
      scopes: "identify guilds",
      redirectTo: `${DASHBOARD_URL}/auth/callback/`
    }
  });
}

async function logout() {
  await supabase.auth.signOut();
  location.reload();
}

async function loadManageableGuilds(discordId) {
  const { data: adminRows, error: adminError } = await supabase
    .from("guild_admins")
    .select("guild_id, role")
    .eq("user_id", discordId);

  if (adminError) {
    throw new Error(`guild_admins: ${adminError.message}`);
  }

  const guildIds = [...new Set((adminRows || []).map(row => row.guild_id))];

  if (!guildIds.length) {
    return [];
  }

  const { data: guilds, error: guildError } = await supabase
    .from("bot_guilds")
    .select("guild_id, name, icon, updated_at")
    .in("guild_id", guildIds)
    .order("updated_at", { ascending: false });

  if (guildError) {
    throw new Error(`bot_guilds: ${guildError.message}`);
  }

  const roleMap = new Map((adminRows || []).map(row => [row.guild_id, row.role || "admin"]));

  return (guilds || []).map(guild => ({
    ...guild,
    role: roleMap.get(guild.guild_id) || "admin"
  }));
}

function renderLoggedOut() {
  view.innerHTML = `
    <h2>Добро пожаловать</h2>
    <p class="muted">Войди через Discord, чтобы открыть список доступных серверов.</p>
    <div class="actions">
      <button onclick="login()">Login with Discord</button>
    </div>
  `;
}

function renderNoAccess(user, discordId) {
  view.innerHTML = `
    <h2>Серверов нет</h2>
    <p><b>${escapeHtml(user?.user_metadata?.full_name || user?.email || "User")}</b></p>
    <p class="small">Discord ID: ${escapeHtml(discordId || "не найден")}</p>

    <div class="actions">
      <button class="secondary" onclick="logout()">Logout</button>
      <a class="button" href="${getInviteUrl()}" target="_blank" rel="noopener noreferrer">Invite Bot</a>
    </div>

    <div class="card empty-state">
      Для этого Discord ID пока нет записей в <b>guild_admins</b>.
    </div>
  `;
}

function renderGuilds(user, discordId, guilds) {
  view.innerHTML = `
    <h2>Ваши серверы</h2>
    <p><b>${escapeHtml(user?.user_metadata?.full_name || user?.email || "User")}</b></p>
    <p class="small">Discord ID: ${escapeHtml(discordId || "не найден")}</p>

    <div class="actions">
      <button class="secondary" onclick="logout()">Logout</button>
      <a class="button" href="${getInviteUrl()}" target="_blank" rel="noopener noreferrer">Invite Bot</a>
    </div>

    <div id="servers" class="card-list"></div>
  `;

  const serversBox = document.getElementById("servers");

  serversBox.innerHTML = guilds.map(g => `
    <div class="card">
      <div class="server-head">
        ${
          g.icon
            ? `<img class="server-icon" src="${getGuildIconUrl(g.guild_id, g.icon)}" alt="${escapeHtml(g.name)}">`
            : `<div class="server-icon">LF</div>`
        }
        <div>
          <div><b>${escapeHtml(g.name || "Server")}</b></div>
          <div class="small">Guild ID: ${escapeHtml(g.guild_id)}</div>
          <div class="small">Role: ${escapeHtml(g.role || "admin")}</div>
        </div>
      </div>

      <div class="actions">
        <a class="button" href="./manage.html?guild=${encodeURIComponent(g.guild_id)}">Manage</a>
      </div>
    </div>
  `).join("");
}

async function init() {
  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      view.innerHTML = `<div class="card error">Ошибка авторизации: ${escapeHtml(error.message)}</div>`;
      return;
    }

    const session = data?.session;

    if (!session) {
      renderLoggedOut();
      return;
    }

    const user = session.user;
    const discordId = getDiscordId(user);

    if (!discordId) {
      view.innerHTML = `
        <div class="card error">Discord ID не найден в сессии.</div>
        <div class="actions">
          <button class="secondary" onclick="logout()">Logout</button>
        </div>
      `;
      return;
    }

    const guilds = await loadManageableGuilds(discordId);

    if (!guilds.length) {
      renderNoAccess(user, discordId);
      return;
    }

    renderGuilds(user, discordId, guilds);
  } catch (e) {
    view.innerHTML = `<div class="card error">Ошибка загрузки панели: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

window.login = login;
window.logout = logout;

init();
