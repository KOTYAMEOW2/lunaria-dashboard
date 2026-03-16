const view = document.getElementById("view");

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";
const DISCORD_BOT_CLIENT_ID = "1473237338460127382";
const REDIRECT_TO = `${window.location.origin}/auth/callback/`;

function safeString(value) {
  return String(value ?? "");
}

function escapeHtml(value) {
  return safeString(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function render(html) {
  if (!view) {
    throw new Error('Element with id="view" was not found');
  }
  view.innerHTML = html;
}

function renderError(message) {
  render(`
    <div class="card">
      <h2>Ошибка</h2>
      <p>${escapeHtml(message)}</p>
    </div>
  `);
}

function renderLoading(message) {
  render(`
    <div class="card">
      <p>${escapeHtml(message)}</p>
    </div>
  `);
}

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  renderError("Supabase library is not loaded.");
  throw new Error("Supabase library is not loaded.");
}

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function getDiscordId(user) {
  const identities = Array.isArray(user?.identities) ? user.identities : [];
  const discordIdentity = identities.find((identity) => identity?.provider === "discord");

  return (
    discordIdentity?.id ||
    user?.user_metadata?.provider_id ||
    user?.user_metadata?.sub ||
    user?.app_metadata?.provider_id ||
    null
  );
}

function getDisplayName(user) {
  return user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || "User";
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
      redirectTo: REDIRECT_TO,
    },
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

  window.location.href = "./";
}

function bindAction(id, handler) {
  const element = document.getElementById(id);
  if (!element) return;
  element.addEventListener("click", handler);
}

function renderLoggedOut() {
  render(`
    <div class="card">
      <h2>Добро пожаловать</h2>
      <p>Войди через Discord, чтобы открыть список доступных серверов.</p>
      <button id="loginBtn" type="button">Login with Discord</button>
    </div>
  `);

  bindAction("loginBtn", async () => {
    try {
      await login();
    } catch (error) {
      renderError(`Ошибка входа: ${error.message || String(error)}`);
    }
  });
}

function renderNoAccess(user, discordId) {
  render(`
    <div class="card">
      <h2>Серверов нет</h2>
      <p>${escapeHtml(getDisplayName(user))}</p>
      <p>Discord ID: ${escapeHtml(discordId || "не найден")}</p>
      <div class="actions">
        <button id="logoutBtn" type="button">Logout</button>
        <a href="${getInviteUrl()}" target="_blank" rel="noopener noreferrer">Invite Bot</a>
      </div>
      <p>Для этого Discord ID пока нет записей в guild_admins.</p>
    </div>
  `);

  bindAction("logoutBtn", async () => {
    try {
      await logout();
    } catch (error) {
      renderError(`Ошибка выхода: ${error.message || String(error)}`);
    }
  });
}

function renderPartialAccess(user, discordId, missingGuildIds) {
  render(`
    <div class="card">
      <h2>Серверы пока не готовы</h2>
      <p>${escapeHtml(getDisplayName(user))}</p>
      <p>Discord ID: ${escapeHtml(discordId || "не найден")}</p>
      <div class="actions">
        <button id="logoutBtn" type="button">Logout</button>
        <a href="${getInviteUrl()}" target="_blank" rel="noopener noreferrer">Invite Bot</a>
      </div>
      <p>Для вашего Discord ID найдены записи в guild_admins, но данные серверов еще не появились в bot_guilds.</p>
      <ul>${missingGuildIds.map((id) => `<li>${escapeHtml(id)}</li>`).join("")}</ul>
    </div>
  `);

  bindAction("logoutBtn", async () => {
    try {
      await logout();
    } catch (error) {
      renderError(`Ошибка выхода: ${error.message || String(error)}`);
    }
  });
}

function renderGuilds(user, discordId, guilds, missingGuildIds) {
  render(`
    <div class="card">
      <h2>Ваши серверы</h2>
      <p>${escapeHtml(getDisplayName(user))}</p>
      <p>Discord ID: ${escapeHtml(discordId || "не найден")}</p>
      <div class="actions">
        <button id="logoutBtn" type="button">Logout</button>
        <a href="${getInviteUrl()}" target="_blank" rel="noopener noreferrer">Invite Bot</a>
      </div>
      ${missingGuildIds.length ? `<p>Не найдены в bot_guilds: ${missingGuildIds.map((id) => escapeHtml(id)).join(", ")}</p>` : ""}
      <div id="servers" class="servers"></div>
    </div>
  `);

  bindAction("logoutBtn", async () => {
    try {
      await logout();
    } catch (error) {
      renderError(`Ошибка выхода: ${error.message || String(error)}`);
    }
  });

  const serversBox = document.getElementById("servers");
  if (!serversBox) {
    throw new Error('Element with id="servers" was not created');
  }

  serversBox.innerHTML = guilds
    .map((guild) => {
      const guildName = escapeHtml(guild.name || "Server");
      const guildId = escapeHtml(guild.guild_id);
      const guildRole = escapeHtml(guild.role || "admin");
      const manageUrl = `./manage.html?guild=${encodeURIComponent(guild.guild_id)}`;
      const iconUrl = getGuildIconUrl(guild.guild_id, guild.icon);
      const iconHtml = iconUrl
        ? `<img class="server-icon" src="${iconUrl}" alt="${guildName} icon">`
        : `<div class="server-icon fallback">LF</div>`;

      return `
        <div class="server-card">
          ${iconHtml}
          <div class="server-info">
            <h3>${guildName}</h3>
            <p>Guild ID: ${guildId}</p>
            <p>Role: ${guildRole}</p>
          </div>
          <a class="manage-link" href="${manageUrl}">Manage</a>
        </div>
      `;
    })
    .join("");
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

  if (!guildIds.length) {
    return { guilds: [], missingGuildIds: [] };
  }

  const { data: guildRows, error: guildError } = await supabase
    .from("bot_guilds")
    .select("guild_id, name, icon, updated_at")
    .in("guild_id", guildIds)
    .order("updated_at", { ascending: false });

  if (guildError) {
    throw new Error(`bot_guilds: ${guildError.message}`);
  }

  const roleMap = new Map(uniqueAdminRows.map((row) => [row.guild_id, row.role || "admin"]));
  const foundGuildIds = new Set((guildRows || []).map((guild) => guild.guild_id));
  const missingGuildIds = guildIds.filter((guildId) => !foundGuildIds.has(guildId));
  const guilds = (guildRows || []).map((guild) => ({
    ...guild,
    role: roleMap.get(guild.guild_id) || "admin",
  }));

  return { guilds, missingGuildIds };
}

async function init() {
  renderLoading("Проверка авторизации...");

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
    renderError("Discord ID не найден в сессии.");
    return;
  }

  renderLoading("Загрузка серверов...");
  const { guilds, missingGuildIds } = await loadManageableGuilds(discordId);

  if (!guilds.length && missingGuildIds.length) {
    renderPartialAccess(user, discordId, missingGuildIds);
    return;
  }

  if (!guilds.length) {
    renderNoAccess(user, discordId);
    return;
  }

  renderGuilds(user, discordId, guilds, missingGuildIds);
}

init().catch((error) => {
  console.error("Init error:", error);
  renderError(`Ошибка загрузки панели: ${error.message || String(error)}`);
});
