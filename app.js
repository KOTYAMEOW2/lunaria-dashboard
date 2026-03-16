const view = document.getElementById("view");

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";
const DASHBOARD_URL = "https://lunaria-dashboard.pages.dev";
const DISCORD_BOT_CLIENT_ID = "1473237338460127382";

if (!view) {
  throw new Error('Element #view not found');
}

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  view.innerHTML = `<div class="card error">Supabase library is not loaded.</div>`;
  throw new Error("Supabase library is not loaded");
}

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  return `https://discord.com/oauth2/authorize?client_id=${DISCORD_BOT_CLIENT_ID}&scope=bot%20applications.commands&permissions=8`;
}

async function login() {
  try {
    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        scopes: "identify guilds",
        redirectTo: `${DASHBOARD_URL}/auth/callback/`
      }
    });
  } catch (error) {
    view.innerHTML = `<div class="card error">Login error: ${escapeHtml(error.message || String(error))}</div>`;
  }
}

async function logout() {
  try {
    await supabase.auth.signOut();
    location.href = "./";
  } catch (error) {
    view.innerHTML = `<div class="card error">Logout error: ${escapeHtml(error.message || String(error))}</div>`;
  }
}

async function loadManageableGuilds(discordId) {
  const { data: adminRows, error: adminError } = await supabase
    .from("guild_admins")
    .select("guild_id, role")
    .eq("user_id", discordId);

  if (adminError) {
    throw new Error(`guild_admins: ${adminError.message}`);
  }

  const guildIds = [...new Set((adminRows || []).map((row) => row.guild_id).filter(Boolean))];

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

  const roleMap = new Map(
    (adminRows || []).map((row) => [row.guild_id, row.role || "admin"])
  );

  return (guilds || []).map((guild) => ({
    ...guild,
    role: roleMap.get(guild.guild_id) || "admin"
  }));
}

function renderLoggedOut() {
  view.innerHTML = `
    <h2>Добро пожаловать</h2>
    <p class="muted">Войди через Discord, чтобы открыть список доступных серверов.</p>
    <div class="actions">
      <button type="button" onclick="login()">Login with Discord</button>
    </div>
  `;
}

function renderNoAccess(user, discordId) {
  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email ||
    "User";

  view.innerHTML = `
    <h2>Серверов нет</h2>
    <p><b>${escapeHtml(displayName)}</b></p>
    <p class="small">Discord ID: ${escapeHtml(discordId || "не найден")}</p>

    <div class="actions">
      <button type="button" class="secondary" onclick="logout()">Logout</button>
      <a class="button" href="${getInviteUrl()}" target="_blank" rel="noopener noreferrer">Invite Bot</a>
    </div>

    <div class="card">
      Для этого Discord ID пока нет записей в <b>guild_admins</b>.
    </div>
  `;
}

function renderGuilds(user, discordId, guilds) {
  const displayName =
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email ||
    "User";

  view.innerHTML = `
    <h2>Ваши серверы</h2>
    <p><b>${escapeHtml(displayName)}</b></p>
    <p class="small">Discord ID: ${escapeHtml(discordId || "не найден")}</p>

    <div class="actions">
      <button type="button" class="secondary" onclick="logout()">Logout</button>
      <a class="button" href="${getInviteUrl()}" target="_blank" rel="noopener noreferrer">Invite Bot</a>
    </div>

    <div id="servers" class="card-list"></div>
  `;

  const serversBox = document.getElementById("servers");
  if (!serversBox) return;

  serversBox.innerHTML = guilds
    .map((guild) => {
      const iconHtml = guild.icon
        ? `<img class="server-icon" src="${getGuildIconUrl(guild.guild_id, guild.icon)}" alt="${escapeHtml(guild.name || "Server")}">`
        : `<div class="server-icon">LF</div>`;

      return `
        <div class="card">
          <div class="server-head">
            ${iconHtml}
            <div>
              <div><b>${escapeHtml(guild.name || "Server")}</b></div>
              <div class="small">Guild ID: ${escapeHtml(guild.guild_id)}</div>
              <div class="small">Role: ${escapeHtml(guild.role || "admin")}</div>
            </div>
          </div>

          <div class="actions">
            <a class="button" href="./manage.html?guild=${encodeURIComponent(guild.guild_id)}">Manage</a>
          </div>
        </div>
      `;
    })
    .join("");
}

async function init() {
  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      throw new Error(error.message);
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
          <button type="button" class="secondary" onclick="logout()">Logout</button>
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
  } catch (error) {
    view.innerHTML = `
      <div class="card error">
        Ошибка загрузки панели: ${escapeHtml(error.message || String(error))}
      </div>
    `;
  }
}

window.login = login;
window.logout = logout;

init();
