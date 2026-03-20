var root = document.getElementById("manageView") || document.body;

var CONFIG = window.LUNARIA_CONFIG || {};

var SUPABASE_URL = CONFIG.SUPABASE_URL;
var SUPABASE_KEY = CONFIG.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Config is missing SUPABASE_URL or SUPABASE_KEY");
}

function show(html) {
  root.innerHTML = String(html);
}

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getDiscordId(user) {
  if (!user) return null;

  if (Array.isArray(user.identities)) {
    for (var i = 0; i < user.identities.length; i += 1) {
      var identity = user.identities[i];
      if (identity && identity.provider === "discord" && identity.id) {
        return identity.id;
      }
    }
  }

  if (user.user_metadata && user.user_metadata.provider_id) {
    return user.user_metadata.provider_id;
  }

  if (user.user_metadata && user.user_metadata.sub) {
    return user.user_metadata.sub;
  }

  if (user.app_metadata && user.app_metadata.provider_id) {
    return user.app_metadata.provider_id;
  }

  return null;
}

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  throw new Error("Supabase library is not loaded");
}

var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function start() {
  try {
    var url = new URL(window.location.href);
    var guildId = url.searchParams.get("guild");

    if (!guildId) {
      show('<div class="card"><h2>Ошибка</h2><p>Не передан guild id.</p></div>');
      return;
    }

    var sessionRes = await supabase.auth.getSession();
    if (sessionRes.error) {
      show('<div class="card"><h2>Ошибка</h2><p>auth: ' + esc(sessionRes.error.message) + "</p></div>");
      return;
    }

    var session = sessionRes.data && sessionRes.data.session ? sessionRes.data.session : null;
    if (!session) {
      window.location.href = "./";
      return;
    }

    var discordId = getDiscordId(session.user);
    if (!discordId) {
      show('<div class="card"><h2>Ошибка</h2><p>Discord ID не найден.</p></div>');
      return;
    }

    var adminRes = await supabase
      .from("guild_admins")
      .select("*")
      .eq("guild_id", guildId)
      .eq("user_id", discordId)
      .maybeSingle();

    if (adminRes.error) {
      show('<div class="card"><h2>Ошибка</h2><p>guild_admins: ' + esc(adminRes.error.message) + "</p></div>");
      return;
    }

    if (!adminRes.data) {
      show('<div class="card"><h2>Нет доступа</h2><p>Для этого сервера у тебя нет доступа.</p></div>');
      return;
    }

    var guildRes = await supabase
      .from("bot_guilds")
      .select("*")
      .eq("guild_id", guildId)
      .maybeSingle();

    if (guildRes.error) {
      show('<div class="card"><h2>Ошибка</h2><p>bot_guilds: ' + esc(guildRes.error.message) + "</p></div>");
      return;
    }

    if (!guildRes.data) {
      show('<div class="card"><h2>Сервер не найден</h2><p>Запись в bot_guilds отсутствует.</p></div>');
      return;
    }

    var guild = guildRes.data;
    var role = adminRes.data.role || "admin";

    var html = "";
    html += '<div class="card">';
    html += "<h2>" + esc(guild.name || "Server") + "</h2>";
    html += "<p>Guild ID: " + esc(guild.guild_id) + "</p>";
    html += "<p>Role: " + esc(role) + "</p>";
    html += '<div class="actions">';
    html += '<a class="manage-link" href="./">← Back</a> ';
    html += '<a class="manage-link" href="./settings.html?guild=' + encodeURIComponent(guild.guild_id) + '">Settings</a> ';
    html += '<a class="manage-link" href="./rules.html?guild=' + encodeURIComponent(guild.guild_id) + '">Rules</a> ';
    html += '<a class="manage-link" href="./punishments.html?guild=' + encodeURIComponent(guild.guild_id) + '">Punishments</a> ';
    html += '<a class="manage-link" href="./logs.html?guild=' + encodeURIComponent(guild.guild_id) + '">Logs</a>';
    html += "</div>";
    html += "</div>";

    show(html);
  } catch (e) {
    show('<div class="card"><h2>CRASH</h2><p>' + esc(e && e.message ? e.message : e) + "</p></div>");
  }
}

start();
