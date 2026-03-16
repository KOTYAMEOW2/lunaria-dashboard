var view = document.getElementById("view");
var SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
var SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";
var REDIRECT_TO = window.location.origin + "/";

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
    .replace(/>/g, "&gt;");
}

function errorText(err) {
  if (!err) return "Unknown error";
  if (err.message) return err.message;
  return String(err);
}

if (!view) {
  throw new Error("Element #view not found");
}

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  show('<div class="card"><h2>Ошибка</h2><p>Supabase library is not loaded.</p></div>');
  throw new Error("Supabase library is not loaded");
}

var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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

function getUserName(user) {
  if (!user) return "User";
  if (user.user_metadata && user.user_metadata.full_name) return user.user_metadata.full_name;
  if (user.user_metadata && user.user_metadata.name) return user.user_metadata.name;
  if (user.email) return user.email;
  return "User";
}

function getGuildIcon(guildId, icon) {
  if (!guildId || !icon) return "";
  return "https://cdn.discordapp.com/icons/" + encodeURIComponent(guildId) + "/" + encodeURIComponent(icon) + ".png?size=128";
}

function bind(id, fn) {
  var el = document.getElementById(id);
  if (el) el.addEventListener("click", fn);
}

async function login() {
  var res = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: {
      scopes: "identify guilds",
      redirectTo: REDIRECT_TO
    }
  });

  if (res.error) {
    throw res.error;
  }
}

async function logout() {
  var res = await supabase.auth.signOut();

  if (res.error) {
    throw res.error;
  }

  window.location.href = "./";
}

function renderLoggedOut() {
  var html = "";
  html += '<div class="card">';
  html += "<h2>Добро пожаловать</h2>";
  html += "<p>Войди через Discord, чтобы открыть список доступных серверов.</p>";
  html += '<div class="actions">';
  html += '<button id="loginBtn" type="button">Login with Discord</button>';
  html += "</div>";
  html += "</div>";

  show(html);

  bind("loginBtn", async function () {
    try {
      await login();
    } catch (err) {
      show('<div class="card"><h2>Ошибка входа</h2><p>' + esc(errorText(err)) + "</p></div>");
    }
  });
}

function renderNoAccess(user, discordId) {
  var html = "";
  html += '<div class="card">';
  html += "<h2>Серверов нет</h2>";
  html += "<p>" + esc(getUserName(user)) + "</p>";
  html += "<p>Discord ID: " + esc(discordId || "не найден") + "</p>";
  html += "<p>Для этого Discord ID нет записей в guild_admins.</p>";
  html += '<div class="actions">';
  html += '<button id="logoutBtn" type="button">Logout</button>';
  html += "</div>";
  html += "</div>";

  show(html);

  bind("logoutBtn", async function () {
    try {
      await logout();
    } catch (err) {
      show('<div class="card"><h2>Ошибка выхода</h2><p>' + esc(errorText(err)) + "</p></div>");
    }
  });
}

function renderGuilds(user, discordId, guilds) {
  var html = "";
  html += '<div class="card">';
  html += "<h2>Ваши серверы</h2>";
  html += "<p>" + esc(getUserName(user)) + "</p>";
  html += "<p>Discord ID: " + esc(discordId || "не найден") + "</p>";
  html += '<div class="actions">';
  html += '<button id="logoutBtn" type="button">Logout</button>';
  html += "</div>";
  html += '<div class="servers">';

  for (var i = 0; i < guilds.length; i += 1) {
    var guild = guilds[i];
    var guildName = esc(guild.name || "Server");
    var guildId = esc(guild.guild_id || "");
    var guildRole = esc(guild.role || "admin");
    var manageUrl = "./manage.html?guild=" + encodeURIComponent(guild.guild_id || "");
    var icon = getGuildIcon(guild.guild_id, guild.icon);

    html += '<div class="server-card">';

    if (icon) {
      html += '<img class="server-icon" src="' + icon + '" alt="' + guildName + ' icon">';
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
  html += "</div>";

  show(html);

  bind("logoutBtn", async function () {
    try {
      await logout();
    } catch (err) {
      show('<div class="card"><h2>Ошибка выхода</h2><p>' + esc(errorText(err)) + "</p></div>");
    }
  });
}

async function loadGuilds(discordId) {
  var adminRes = await supabase
    .from("guild_admins")
    .select("guild_id, role")
    .eq("user_id", discordId);

  if (adminRes.error) {
    throw new Error("guild_admins: " + adminRes.error.message);
  }

  var adminRows = adminRes.data || [];
  var guildIds = [];
  var roleMap = {};
  var seen = {};

  for (var i = 0; i < adminRows.length; i += 1) {
    var row = adminRows[i];
    if (!row || !row.guild_id) continue;
    if (seen[row.guild_id]) continue;

    seen[row.guild_id] = true;
    guildIds.push(row.guild_id);
    roleMap[row.guild_id] = row.role || "admin";
  }

  if (guildIds.length === 0) {
    return [];
  }

  var guildRes = await supabase
    .from("bot_guilds")
    .select("guild_id, name, icon, updated_at")
    .in("guild_id", guildIds)
    .order("updated_at", { ascending: false });

  if (guildRes.error) {
    throw new Error("bot_guilds: " + guildRes.error.message);
  }

  var rows = guildRes.data || [];
  var out = [];

  for (var j = 0; j < rows.length; j += 1) {
    var guild = rows[j];
    out.push({
      guild_id: guild.guild_id,
      name: guild.name,
      icon: guild.icon,
      updated_at: guild.updated_at,
      role: roleMap[guild.guild_id] || "admin"
    });
  }

  return out;
}

async function init() {
  show('<div class="card"><p>Проверка авторизации...</p></div>');

  var sessionRes = await supabase.auth.getSession();

  if (sessionRes.error) {
    throw new Error("auth: " + sessionRes.error.message);
  }

  var session = sessionRes.data && sessionRes.data.session ? sessionRes.data.session : null;

  if (!session) {
    renderLoggedOut();
    return;
  }

  var user = session.user;
  var discordId = getDiscordId(user);

  if (!discordId) {
    show('<div class="card"><h2>Ошибка</h2><p>Discord ID не найден в сессии.</p></div>');
    return;
  }

  show('<div class="card"><p>Загрузка серверов...</p></div>');

  var guilds = await loadGuilds(discordId);

  if (!guilds.length) {
    renderNoAccess(user, discordId);
    return;
  }

  renderGuilds(user, discordId, guilds);
}

init().catch(function (err) {
  console.error("app.js init error:", err);
  show('<div class="card"><h2>Ошибка</h2><p>' + esc(errorText(err)) + "</p></div>");
});
