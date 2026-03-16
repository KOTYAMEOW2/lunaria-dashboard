const manageView = document.getElementById("manageView");

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";
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
    .replace(/'/g, "&#39;");
}

if (!manageView) {
  throw new Error('Element #manageView not found');
}

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  manageView.innerHTML = `
    <section class="card">
      <h2>Ошибка</h2>
      <p>Supabase library is not loaded.</p>
    </section>
  `;
  throw new Error("Supabase library is not loaded");
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

function getGuildIdFromUrl() {
  const url = new URL(window.location.href);
  return url.searchParams.get("guild");
}

function getGuildIconUrl(guildId, icon) {
  if (!guildId || !icon) return "";
  return `https://cdn.discordapp.com/icons/${encodeURIComponent(guildId)}/${encodeURIComponent(icon)}.png?size=128`;
}

function getInviteUrl() {
  return `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(DISCORD_BOT_CLIENT_ID)}&scope=bot%20applications.commands&permissions=8`;
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

function renderError(message, showBackLink = true) {
  manageView.innerHTML = `
    <section class="card">
      <h2>Ошибка</h2>
      <p>${escapeHtml(message)}</p>
      ${showBackLink ? '<p><a href="./">Назад</a></p>' : ""}
    </section>
  `;
}

function renderNoAccess() {
  manageView.innerHTML = `
    <section class="card">
      <h2>Доступ запрещён</h2>
      <p>У тебя нет доступа к этому серверу.</p>
      <p><a href="./">Назад</a></p>
    </section>
  `;
}

function renderGuildNotFound() {
  manageView.innerHTML = `
    <section class="card">
      <h2>Сервер не найден</h2>
      <p>Сервер отсутствует в bot_guilds.</p>
      <p><a href="./">Назад</a></p>
    </section>
  `;
}

function renderManagePage(guild, adminRole) {
  const guildName = escapeHtml(guild?.name || "Server");
  const guildId = escapeHtml(guild?.guild_id || "");
  const role = escapeHtml(adminRole || "admin");
  const iconUrl = getGuildIconUrl(guild?.guild_id, guild?.icon);

  const iconHtml = iconUrl
    ? `<img class="server-icon large" src="${iconUrl}" alt="${guildName} icon">`
    : `<div class="server-icon fallback large">LF</div>`;

  const encodedGuildId = encodeURIComponent(guild?.guild_id || "");

  manageView.innerHTML = `
    <section class="card">
      <div class="actions">
        <a href="./">← Назад к серверам</a>
        <button id="logoutBtn" type="button">Logout</button>
      </div>

      <div class="manage-header">
        ${iconHtml}
        <div>
          <h1>${guildName}</h1>
          <p>Guild ID: ${guildId}</p>
          <p>Role: ${role}</p>
        </div>
      </div>

      <nav class="manage-links">
        <a href="./rules.html?guild=${encodedGuildId}">Rules</a>
        <a href="./punishments.html?guild=${encodedGuildId}">Punishments</a>
        <a href="./logs.html?guild=${encodedGuildId}">Logs</a>
        <a href="./settings.html?guild=${encodedGuildId}">Settings</a>
        <a href="${getInviteUrl()}" target="_blank" rel="noopener noreferrer">Invite</a>
      </nav>
    </section>
  `;

  bindAction("logoutBtn", async () => {
    try {
      await logout();
    } catch (error) {
      renderError(`Ошибка выхода: ${error.message || String(error)}`, false);
    }
  });
}

async function initManage() {
  try {
    const guildId = getGuildIdFromUrl();

    if (!guildId) {
      renderError("Guild ID не передан.");
      return;
    }

    const { data, error } = await supabase.auth.getSession();
    if (error) {
      throw new Error(`auth: ${error.message}`);
    }

    const session = data?.session;
    if (!session) {
      window.location.href = "./";
      return;
    }

    const discordId = getDiscordId(session.user);
    if (!discordId) {
      renderError("Discord ID не найден в сессии.", false);
      return;
    }

    const { data: adminRow, error: adminError } = await supabase
      .from("guild_admins")
      .select("guild_id, role")
      .eq("guild_id", guildId)
      .eq("user_id", discordId)
      .maybeSingle();

    if (adminError) {
      throw new Error(`guild_admins: ${adminError.message}`);
    }

    if (!adminRow) {
      renderNoAccess();
      return;
    }

    const { data: guild, error: guildError } = await supabase
      .from("bot_guilds")
      .select("guild_id, name, icon, updated_at")
      .eq("guild_id", guildId)
      .maybeSingle();

    if (guildError) {
      throw new Error(`bot_guilds: ${guildError.message}`);
    }

    if (!guild) {
      renderGuildNotFound();
      return;
    }

    renderManagePage(guild, adminRow.role);
  } catch (error) {
    console.error("Manage init error:", error);
    renderError(`Ошибка загрузки: ${error.message || String(error)}`);
  }
}

window.logout = logout;
initManage();
