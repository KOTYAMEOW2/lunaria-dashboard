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

function show(html) {
  if (!manageView) {
    throw new Error('Element with id="manageView" not found');
  }
  manageView.innerHTML = html;
}

function card(title, bodyHtml) {
  let html = '<section class="card">';
  if (title) {
    html += "<h2>" + escapeHtml(title) + "</h2>";
  }
  html += bodyHtml;
  html += "</section>";
  show(html);
}

function errorText(error) {
  if (!error) return "Unknown error";
  if (error.message) return error.message;
  return String(error);
}

if (!manageView) {
  throw new Error('Element with id="manageView" not found');
}

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  card("Ошибка", "<p>Supabase library is not loaded.</p>");
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
  return (
    "https://cdn.discordapp.com/icons/" +
    encodeURIComponent(guildId) +
    "/" +
    encodeURIComponent(icon) +
    ".png?size=128"
  );
}

function getInviteUrl() {
  return (
    "https://discord.com/oauth2/authorize?client_id=" +
    encodeURIComponent(DISCORD_BOT_CLIENT_ID) +
    "&scope=bot%20applications.commands&permissions=8"
  );
}

function bindAction(id, handler) {
  const element = document.getElementById(id);
  if (!element) return;
  element.addEventListener("click", handler);
}

async function logout() {
  const res = await supabase.auth.signOut();
  if (res.error) {
    throw res.error;
  }
  window.location.href = "./";
}

function renderError(message, showBackLink = true) {
  card(
    "Ошибка",
    "<p>" + escapeHtml(message) + "</p>" +
      (showBackLink ? '<p><a href="./">Назад</a></p>' : "")
  );
}

function renderNoAccess() {
  card(
    "Доступ запрещён",
    "<p>У тебя нет доступа к этому серверу.</p>" +
      '<p><a href="./">Назад</a></p>'
  );
}

function renderGuildNotFound() {
  card(
    "Сервер не найден",
    "<p>Сервер отсутствует в bot_guilds.</p>" +
      '<p><a href="./">Назад</a></p>'
  );
}

function renderManagePage(guild, role) {
  const guildName = escapeHtml(guild?.name || "Server");
  const guildId = escapeHtml(guild?.guild_id || "");
  const adminRole = escapeHtml(role || "admin");
  const encodedGuildId = encodeURIComponent(guild?.guild_id || "");
  const iconUrl = getGuildIconUrl(guild?.guild_id, guild?.icon);

  let html = "";
  html += '<div class="actions">';
  html += '<a href="./">← Назад к серверам</a>';
  html += '<button id="logoutBtn" type="button">Logout</button>';
  html += "</div>";

  html += '<div class="manage-header">';
  if (iconUrl) {
    html += '<img class="server-icon" src="' + iconUrl + '" alt="' + guildName + ' icon">';
  } else {
    html += '<div class="server-icon fallback">LF</div>';
  }
  html += '<div class="server-info">';
  html += "<h1>" + guildName + "</h1>";
  html += "<p>Guild ID: " + guildId + "</p>";
  html += "<p>Role: " + adminRole + "</p>";
  html += "</div>";
  html += "</div>";

  html += '<nav class="manage-links">';
  html += '<a href="./rules.html?guild=' + encodedGuildId + '">Rules</a>';
  html += '<a href="./punishments.html?guild=' + encodedGuildId + '">Punishments</a>';
  html += '<a href="./logs.html?guild=' + encodedGuildId + '">Logs</a>';
  html += '<a href="./settings.html?guild=' + encodedGuildId + '">Settings</a>';
  html += '<a href="' + getInviteUrl() + '" target="_blank" rel="noopener noreferrer">Invite</a>';
  html += "</nav>";

  card("", html);

  bindAction("logoutBtn", async function () {
    try {
      await logout();
    } catch (error) {
      renderError("Ошибка выхода: " + errorText(error), false);
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

    const sessionRes = await supabase.auth.getSession();
    if (sessionRes.error) {
      throw new Error("auth: " + sessionRes.error.message);
    }

    const session = sessionRes.data ? sessionRes.data.session : null;
    if (!session) {
      window.location.href = "./";
      return;
    }

    const discordId = getDiscordId(session.user);
    if (!discordId) {
      renderError("Discord ID не найден в сессии.", false);
      return;
    }

    const adminRes = await supabase
      .from("guild_admins")
      .select("guild_id, role")
      .eq("guild_id", guildId)
      .eq("user_id", discordId)
      .maybeSingle();

    if (adminRes.error) {
      throw new Error("guild_admins: " + adminRes.error.message);
    }

    if (!adminRes.data) {
      renderNoAccess();
      return;
    }

    const guildRes = await supabase
      .from("bot_guilds")
      .select("guild_id, name, icon, updated_at")
      .eq("guild_id", guildId)
      .maybeSingle();

    if (guildRes.error) {
      throw new Error("bot_guilds: " + guildRes.error.message);
    }

    if (!guildRes.data) {
      renderGuildNotFound();
      return;
    }

    renderManagePage(guildRes.data, adminRes.data.role);
  } catch (error) {
    console.error("Manage init error:", error);
    renderError("Ошибка загрузки: " + errorText(error));
  }
}

window.logout = logout;
initManage();
