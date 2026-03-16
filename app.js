const view = document.getElementById("view");

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";
const REDIRECT_TO = window.location.origin + "/auth/callback/";

function show(html) {
  if (!view) {
    alert("view not found");
    return;
  }
  view.innerHTML = html;
}

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function card(title, body) {
  var html = "";
  html += '<div class="card">';
  if (title) {
    html += "<h2>" + esc(title) + "</h2>";
  }
  html += body;
  html += "</div>";
  show(html);
}

function showError(text) {
  card("Ошибка", "<p>" + esc(text) + "</p>");
}

function bind(id, handler) {
  var el = document.getElementById(id);
  if (el) {
    el.addEventListener("click", handler);
  }
}

if (!view) {
  throw new Error('Element with id="view" not found');
}

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  showError("Supabase library is not loaded.");
  throw new Error("Supabase library is not loaded.");
}

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function getDiscordId(user) {
  if (!user) return null;

  if (user.user_metadata && user.user_metadata.provider_id) {
    return user.user_metadata.provider_id;
  }

  if (user.user_metadata && user.user_metadata.sub) {
    return user.user_metadata.sub;
  }

  if (Array.isArray(user.identities)) {
    for (var i = 0; i < user.identities.length; i += 1) {
      var identity = user.identities[i];
      if (identity && identity.provider === "discord" && identity.id) {
        return identity.id;
      }
    }
  }

  return null;
}

function getName(user) {
  if (!user) return "User";
  if (user.user_metadata && user.user_metadata.full_name) return user.user_metadata.full_name;
  if (user.user_metadata && user.user_metadata.name) return user.user_metadata.name;
  if (user.email) return user.email;
  return "User";
}

function getIconUrl(guildId, icon) {
  if (!guildId || !icon) return "";
  return "https://cdn.discordapp.com/icons/" + encodeURIComponent(guildId) + "/" + encodeURIComponent(icon) + ".png?size=128";
}

async function login() {
  var result = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: {
      scopes: "identify guilds",
      redirectTo: REDIRECT_TO
    }
  });

  if (result.error) {
    throw new Error(result.error.message);
  }
}

async function logout() {
  var result = await supabase.auth.signOut();

  if (result.error) {
    throw new Error(result.error.message);
  }

  window.location.href = "./";
}

function renderLoggedOut() {
  var html = "";
  html += "<p>Войди через Discord, чтобы открыть список доступных серверов.</p>";
  html += '<div class="actions">';
  html += '<button id="loginBtn" type="button">Login with Discord</button>';
  html += "</div>";

  card("Добро пожаловать", html);

  bind("loginBtn", async function () {
    try {
      await login();
    } catch (error) {
      showError("Ошибка входа: " + (error && error.message ? error.message : String(error)));
    }
  });
}

function renderNoAccess(user, discordId) {
  var html = "";
  html += "<p>" + esc(getName(user)) + "</p>";
  html += "<p>Discord ID: " + esc(discordId || "не найден") + "</p>";
  html += '<div class="actions">';
  html += '<button id="logoutBtn" type="button">Logout</button>';
  html += "</div>";
  html += "<p>Для этого Discord ID пока нет записей в guild_admins.</p>";

  card("Серверов нет", html);

  bind("logoutBtn", async function () {
    try {
      await logout();
    } catch (error) {
      showError("Ошибка выхода: " + (error && error.message ? error.message : String(error)));
    }
  });
}

function renderGuilds(user, discordId, guilds) {
  var html = "";
  var i = 0;

  html += "<p>" + esc(getName(user)) + "</p>";
  html += "<p>Discord ID: " + esc(discordId || "не найден") + "</p>";
  html += '<div class="actions">';
  html += '<button id="logoutBtn" type="button">Logout</button>';
  html += "</div>";
  html += '<div class="servers">';

  for (i = 0; i < guilds.length; i += 1) {
    var guild = guilds[i];
    var guildName = esc(guild.name || "Server");
    var guildId = esc(guild.guild_id || "");
    var guildRole = esc(guild.role || "admin");
    var iconUrl = getIconUrl(guild.guild_id, guild.icon);
    var manageUrl = "./manage.html?guild=" + encodeURIComponent(guild.guild_id || "");

    html += '<div class="server-card">';

    if (iconUrl) {
      html += '<img class="server-icon" src="' + iconUrl + '" alt="' + guildName + ' icon">';
    } else {
      html += '<div class="server-icon fallback">LF</div>';
    }

    html += '<div class="server-info">';
    html += "<h3>" + guildName + "</h3>";
    html += "<p>Guild ID: " + guildId + "</p>";
    html += "<p>Role: " + guildRole + "</p>";
    html += "</div>";
    html += '<a class="manage-link" href="' + manageUrl + '">Manage</a>';
    html += "</div>";
  }

  html += "</div>";

  card("Ваши серверы", html);

  bind("logoutBtn", async function () {
    try {
      await logout();
    } catch (error) {
      showError("Ошибка выхода: " + (error && error.message ? error.message : String(error)));
    }
  });
}

async function loadGuilds(discordId) {
  var adminResult = await supabase
    .from("guild_admins")
    .select("guild_id, role")
    .eq("user_id", discordId);

  if (adminResult.error) {
    throw new Error("guild_admins: " + adminResult.error.message);
  }

  var adminRows = adminResult.data || [];
  var guildIds = [];
  var roles = {};
  var i = 0;

  for (i = 0; i < adminRows.length; i += 1) {
    var row = adminRows[i];
    if (row && row.guild_id) {
      guildIds.push(row.guild_id);
      roles[row.guild_id] = row.role || "admin";
    }
  }

  if (guildIds.length === 0) {
    return [];
  }

  var guildResult = await supabase
    .from("bot_guilds")
    .select("guild_id, name, icon, updated_at")
    .in("guild_id", guildIds)
    .order("updated_at", { ascending: false });

  if (guildResult.error) {
    throw new Error("bot_guilds: " + guildResult.error.message);
  }

  var guildRows = guildResult.data || [];
  var out = [];

  for (i = 0; i < guildRows.length; i += 1) {
    var guild = guildRows[i];
    out.push({
      guild_id: guild.guild_id,
      name: guild.name,
      icon: guild.icon,
      updated_at: guild.updated_at,
      role: roles[guild.guild_id] || "admin"
    });
  }

  return out;
}

async function init() {
  card("", "<p>Проверка авторизации...</p>");

  var sessionResult = await supabase.auth.getSession();

  if (sessionResult.error) {
    throw new Error("auth: " + sessionResult.error.message);
  }

  var session = sessionResult.data ? sessionResult.data.session : null;

  if (!session) {
    renderLoggedOut();
    return;
  }

  var user = session.user;
  var discordId = getDiscordId(user);

  if (!discordId) {
    showError("Discord ID не найден в сессии.");
    return;
  }

  card("", "<p>Загрузка серверов...</p>");

  var guilds = await loadGuilds(discordId);

  if (!guilds.length) {
    renderNoAccess(user, discordId);
    return;
  }

  renderGuilds(user, discordId, guilds);
}

init().catch(function (error) {
  console.error("app.js init error:", error);
  showError(error && error.message ? error.message : String(error));
});
