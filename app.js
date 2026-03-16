const view = document.getElementById("view");

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";
const DASHBOARD_URL = "https://lunaria-dashboard.pages.dev";
const DISCORD_BOT_CLIENT_ID = "1473237338460127382";

function safeString(value) {
  return String(value ?? "");
}

function escapeHtml(value) {
  return safeString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderMessage(html) {
  if (!view) return;
  view.innerHTML = html;
}

function renderFatalError(message) {
  renderMessage(`
    <div class="card error">
      ${escapeHtml(message)}
    </div>
  `);
}

window.addEventListener("error", (event) => {
  console.error("Window error:", event.error || event.message || event);
  renderFatalError(`JS error: ${event.message || "Unknown error"}`);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled promise rejection:", event.reason);
  const reason = event.reason;
  const message = reason?.message || safeString(reason) || "Unknown promise error";
  renderFatalError(`Promise error: ${message}`);
});

if (!view) {
  throw new Error('Element with id="view" was not found');
}

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  renderFatalError("Supabase library is not loaded.");
  throw new Error("Supabase library is not loaded.");
}

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function getDiscordId(user) {
  const discordIdentity = user?.identities?.find(
    (identity) => identity?.provider === "discord"
  );

  return (
    discordIdentity?.id ||
    user?.user_metadata?.provider_id ||
    user?.user_metadata?.sub ||
    user?.app_metadata?.provider_id ||
    null
  );
}

function getDisplayName(user) {
  return (
    user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    user?.email ||
    "User"
  );
}

function getGuildIconUrl(guildId, icon) {
  if (!guildId || !icon) return "";
  return `https://cdn.discordapp.com/icons/${encodeURIComponent(guildId)}/${encodeURIComponent(icon)}.png?size=128`;
}

function getInviteUrl() {
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(DISCORD_BOT_CLIENT_ID)}&scope=bot%20applications.commands&permissions=8`;
}

async function login() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: {
      scopes: "identify guilds",
      redirectTo: `${DASHBOARD_URL}/auth/callback/`
    }
  });

  if (error) {
    throw new Error(`login: ${error.message}`);
  }
}

async function logout() {
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error(`logout: ${error.message}`);
  }

  location.href = "./";
}

async function loadManageableGuilds(discordId) {
  const { data: adminRows, error: adminError } = await supabase
    .from("guild_admins")
    .select("guild_id, role")
    .eq("user_id", discordId);

  if (adminError) {
    throw new Error(`guild_admins: ${adminError.message}`);
  }

  const uniqueAdminRows = [];
  const seenGuildIds = new Set();

  for (const row of adminRows || []) {
    const guildId = row?.guild_id;
    if (!guildId || seenGuildIds.has(guildId)) continue;
    seenGuildIds.add(guildId);
    uniqueAdminRows.push(row);
  }

  const guildIds = uniqueAdminRows.map((row) => row.guild_id);

  if (guildIds.length === 0) {
    return {
      guilds: [],
      missingGuildIds: []
    };
  }

  const { data: guildRows, error: guildError } = await supabase
    .from("bot_guilds")
    .select("guild_id, name, icon, updated_at")
    .in("guild_id", guildIds)
    .order("updated_at", { ascending: false });

  if (guildError) {
    throw new Error(`bot_guilds: ${guildError.message}`);
  }

  const roleMap = new Map(
    uniqueAdminRows.map((row) => [row.guild_id, row.role || "admin"])
  );

  const foundGuildIdSet = new Set((guildRows || []).map((guild) => guild.guild_id));
  const missingGuildIds = guildIds.filter((guildId) => !foundGuildIdSet.has(guildId));

  const guilds = (guildRows || []).map((guild) => ({
    ...guild,
    role: roleMap.get(guild.guild_id) || "admin"
  }));

  return {
    guilds,
    missingGuildIds
  };
}

function bindAction(id, handler) {
  const element = document.getElementById(id);
  if (!element) return;
  element.addEventListener("click", handler);
}

function renderLoggedOut() {
  renderMessage(`
    <h2>Добро пожаловать</h2>
    <p class="muted">Войди через Discord, чтобы открыть список доступных серверов.</p>
    <div class="actions">
      <button type="button" id="loginBtn">Login with Discord</button>
    </div>
  `);

  bindAction("loginBtn", async () => {
    try {
      await login();
    } catch (error) {
      renderFatalError(`Ошибка входа: ${error.message || String(error)}`);
    }
  });
}

function renderNoAccess(user, discordId) {
  renderMessage(`
    <h2>Серверов нет</h2>
    <p><b>${escapeHtml(getDisplayName(user))}</b></p>
    <p class="small">Discord ID: ${escapeHtml(discordId || "не найден")}</p>

    <div class="actions">
      <button type="button" class="secondary" id="logoutBtn">Logout</button>
      <a class="button" href="${escapeHtml(getInviteUrl())}" target="_blank" rel="noopener noreferrer">Invite Bot</a>
    </div>

    <div class="card">
      Для этого Discord ID пока нет записей в <b>guild_admins</b>.
    </div>
  `);

  bindAction("logoutBtn", async () => {
    try {
      await logout();
    } catch (error) {
      renderFatalError(`Ошибка выхода: ${error.message || String(error)}`);
    }
  });
}

function renderPartialAccess(user, discordId, missingGuildIds) {
  renderMessage(`
    <h2>Серверы пока не готовы</h2>
    <p><b>${escapeHtml(getDisplayName(user))}</b></p>
    <p class="small">Discord ID: ${escapeHtml(discordId || "не найден")}</p>

    <div class="actions">
      <button type="button" class="secondary" id="logoutBtn">Logout</button>
      <a class="button" href="${escapeHtml(getInviteUrl())}" target="_blank" rel="noopener noreferrer">Invite Bot</a>
    </div>

    <div class="card">
      Для вашего Discord ID найдены записи в <b>guild_admins</b>, но данные серверов ещё не появились в <b>bot_guilds</b>.
    </div>

    <div class="card">
      <div><b>Ожидают синхронизации:</b></div>
      <div class="small">${missingGuildIds.map((id) => escapeHtml(id)).join("<br>")}</div>
    </div>
  `);

  bindAction("logoutBtn", async () => {
    try {
      await logout();
    } catch (error) {
      renderFatalError(`Ошибка выхода: ${error.message || String(error)}`);
    }
  });
}

function renderGuilds(user, discordId, guilds, missingGuildIds = []) {
  renderMessage(`
    <h2>Ваши серверы</h2>
    <p><b>${escapeHtml(getDisplayName(user))}</b></p>
    <p class="small">Discord ID: ${escapeHtml(discordId || "не найден")}</p>

    <div class="actions">
      <button type="button" class="secondary" id="logoutBtn">Logout</button>
      <a class="button" href="${escapeHtml(getInviteUrl())}" target="_blank" rel="noopener noreferrer">Invite Bot</a>
    </div>

    ${
      missingGuildIds.length > 0
        ? `
          <div class="card">
            <b>Часть серверов ещё не синхронизирована.</b>
            <div class="small">
              Не найдены в bot_guilds: ${missingGuildIds.map((id) => escapeHtml(id)).join(", ")}
            </div>
          </div>
        `
        : ""
    }

    <div id="servers" class="card-list"></div>
  `);

  bindAction("logoutBtn", async () => {
    try {
      await logout();
    } catch (error) {
      renderFatalError(`Ошибка выхода: ${error.message || String(error)}`);
    }
  });

  const serversBox = document.getElementById("servers");
  if (!serversBox) {
    throw new Error('Element with id="servers" was not created');
  }

  serversBox.innerHTML = guilds.map((guild) => {
    const guildName = escapeHtml(guild.name || "Server");
    const guildId = escapeHtml(guild.guild_id);
    const guildRole = escapeHtml(guild.role || "admin");
    const manageUrl = `./manage.html?guild=${encodeURIComponent(guild.guild_id)}`;

    const iconHtml = guild.icon
      ? `<img class="server-icon" src="${escapeHtml(getGuildIconUrl(guild.guild_id, guild.icon))}" alt="${guildName}">`
      : `<div class="server-icon">LF</div>`;

    return `
      <div class="card">
        <div class="server-head">
          ${iconHtml}
          <div>
            <div><b>${guildName}</b></div>
            <div class="small">Guild ID: ${guildId}</div>
            <div class="small">Role: ${guildRole}</div>
          </div>
        </div>

        <div class="actions">
          <a class="button" href="${manageUrl}">Manage</a>
        </div>
      </div>
    `;
  }).join("");
}

async function init() {
  const { data, error } = await supabase.auth.getSession();

  if (error) {
    throw new Error(`auth: ${error.message}`);
  }

  const session = data?.session;

  if (!session) {
    renderLoggedOut();
    return;
  }

  const user = session.user;
  const discordId = getDiscordId(user);

  if (!discordId) {
    renderFatalError("Discord ID не найден в сессии.");
    console.error("Session user without Discord ID:", user);
    return;
  }

  const { guilds, missingGuildIds } = await loadManageableGuilds(discordId);

  if (guilds.length === 0 && missingGuildIds.length > 0) {
    renderPartialAccess(user, discordId, missingGuildIds);
    return;
  }

  if (guilds.length === 0) {
    renderNoAccess(user, discordId);
    return;
  }

  renderGuilds(user, discordId, guilds, missingGuildIds);
}

init().catch((error) => {
  console.error("Init error:", error);
  renderFatalError(`Ошибка загрузки панели: ${error.message || String(error)}`);
});
