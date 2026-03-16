var view = document.getElementById("view");

var SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
var SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";

function show(text) {
  if (!view) return;
  view.innerHTML =
    '<div class="card"><pre style="white-space:pre-wrap;margin:0;">' +
    text +
    "</pre></div>";
}

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  show("Supabase library missing");
  throw new Error("Supabase missing");
}

var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function init() {
  try {
    show("Checking session...");

    // Supabase автоматически обработает #access_token
    var res = await supabase.auth.getSession();

    if (res.error) {
      throw res.error;
    }

    var session = res.data ? res.data.session : null;

    if (!session) {
      show("No session\n\nLogin required");
      renderLogin();
      return;
    }

    // очищаем URL
    if (window.location.hash) {
      history.replaceState({}, document.title, window.location.pathname);
    }

    var user = session.user;

    show("Logged in as:\n" + user.email);

    loadServers(user);

  } catch (err) {
    show("Error:\n" + (err.message || String(err)));
  }
}

function renderLogin() {
  view.innerHTML =
    '<div class="card">' +
    "<h2>Login</h2>" +
    '<button id="loginBtn">Login with Discord</button>' +
    "</div>";

  document.getElementById("loginBtn").onclick = login;
}

async function login() {
  await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: {
      scopes: "identify guilds",
      redirectTo: window.location.origin
    }
  });
}

async function loadServers(user) {
  try {
    show("Loading servers...");

    var discordId =
      user.user_metadata.provider_id ||
      user.user_metadata.sub;

    var admins = await supabase
      .from("guild_admins")
      .select("guild_id, role")
      .eq("user_id", discordId);

    if (admins.error) {
      throw admins.error;
    }

    if (!admins.data.length) {
      show("No servers found");
      return;
    }

    var guildIds = admins.data.map(function (g) {
      return g.guild_id;
    });

    var guilds = await supabase
      .from("bot_guilds")
      .select("guild_id,name,icon")
      .in("guild_id", guildIds);

    if (guilds.error) {
      throw guilds.error;
    }

    renderServers(guilds.data);

  } catch (err) {
    show("Server load error:\n" + err.message);
  }
}

function renderServers(guilds) {
  var html = '<div class="card"><h2>Your servers</h2>';

  for (var i = 0; i < guilds.length; i++) {
    var g = guilds[i];

    html +=
      '<div class="server-card">' +
      "<h3>" +
      g.name +
      "</h3>" +
      '<a href="manage.html?guild=' +
      encodeURIComponent(g.guild_id) +
      '">Manage</a>' +
      "</div>";
  }

  html += "</div>";

  view.innerHTML = html;
}

init();
