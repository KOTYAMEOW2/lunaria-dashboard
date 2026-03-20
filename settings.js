var root = document.getElementById("settingsView") || document.body;

var CONFIG = window.LUNARIA_CONFIG || {};

var SUPABASE_URL = CONFIG.SUPABASE_URL;
var SUPABASE_KEY = CONFIG.SUPABASE_KEY;
var STORAGE_KEY =
  (CONFIG.STORAGE_KEYS && CONFIG.STORAGE_KEYS.GUILD_CONFIG) || "guild-config.json";

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

function normalizeGuildConfig(config) {
  var current = config || {};

  return {
    prefix: typeof current.prefix === "string" ? current.prefix : ".",
    enabledModules: {
      moderation: current.enabledModules && current.enabledModules.moderation !== false,
      lunarialog: current.enabledModules && current.enabledModules.lunarialog !== false,
      tickets: !!(current.enabledModules && current.enabledModules.tickets),
      voicemaster: !!(current.enabledModules && current.enabledModules.voicemaster),
      serverpanel: current.enabledModules && current.enabledModules.serverpanel !== false
    },
    modRoles: Array.isArray(current.modRoles) ? current.modRoles : [],
    adminRoles: Array.isArray(current.adminRoles) ? current.adminRoles : [],
    disabledCommands: Array.isArray(current.disabledCommands) ? current.disabledCommands : []
  };
}

function makeCheckbox(labelText, checked) {
  var wrap = document.createElement("div");
  var label = document.createElement("label");
  var input = document.createElement("input");

  input.type = "checkbox";
  input.checked = !!checked;

  label.appendChild(input);
  label.appendChild(document.createTextNode(" " + labelText));
  wrap.appendChild(label);

  return { wrap: wrap, input: input };
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
      show('<div class="card"><h2>Ошибка</h2><p>session: ' + esc(sessionRes.error.message) + "</p></div>");
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

    var storageRes = await supabase
      .from("bot_storage")
      .select("*")
      .eq("key", STORAGE_KEY)
      .maybeSingle();

    if (storageRes.error) {
      show('<div class="card"><h2>Ошибка</h2><p>bot_storage: ' + esc(storageRes.error.message) + "</p></div>");
      return;
    }

    var storageValue =
      storageRes.data &&
      storageRes.data.value &&
      typeof storageRes.data.value === "object"
        ? storageRes.data.value
        : {};

    var guildConfig = normalizeGuildConfig(storageValue[guildId]);

    root.innerHTML = "";

    var card = document.createElement("div");
    card.className = "card";

    var title = document.createElement("h2");
    title.textContent = (guildRes.data.name || "Server") + " Settings";

    var info = document.createElement("p");
    info.textContent =
      "Guild ID: " + guildRes.data.guild_id + " | Role: " + (adminRes.data.role || "admin");

    var back = document.createElement("a");
    back.href = "./manage.html?guild=" + encodeURIComponent(guildRes.data.guild_id);
    back.textContent = "← Back to Manage";
    back.className = "manage-link";

    var prefixLabel = document.createElement("label");
    prefixLabel.textContent = "Prefix";

    var prefixInput = document.createElement("input");
    prefixInput.type = "text";
    prefixInput.maxLength = 5;
    prefixInput.value = guildConfig.prefix || ".";

    var modulesTitle = document.createElement("h3");
    modulesTitle.textContent = "Enabled modules";

    var moderation = makeCheckbox("Moderation", guildConfig.enabledModules.moderation);
    var lunarialog = makeCheckbox("LunariaLog", guildConfig.enabledModules.lunarialog);
    var tickets = makeCheckbox("Tickets", guildConfig.enabledModules.tickets);
    var voicemaster = makeCheckbox("VoiceMaster", guildConfig.enabledModules.voicemaster);
    var serverpanel = makeCheckbox("Server Panel", guildConfig.enabledModules.serverpanel);

    var saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "Save";

    var status = document.createElement("p");
    status.textContent = "";

    saveBtn.addEventListener("click", async function () {
      saveBtn.disabled = true;
      status.textContent = "Saving...";

      var currentStorage = {};
      var key;

      for (key in storageValue) {
        if (Object.prototype.hasOwnProperty.call(storageValue, key)) {
          currentStorage[key] = storageValue[key];
        }
      }

      currentStorage[guildId] = {
        prefix: (prefixInput.value || ".").trim().slice(0, 5) || ".",
        enabledModules: {
          moderation: moderation.input.checked,
          lunarialog: lunarialog.input.checked,
          tickets: tickets.input.checked,
          voicemaster: voicemaster.input.checked,
          serverpanel: serverpanel.input.checked
        },
        modRoles: guildConfig.modRoles,
        adminRoles: guildConfig.adminRoles,
        disabledCommands: guildConfig.disabledCommands
      };

      var saveRes = await supabase
        .from("bot_storage")
        .upsert(
          {
            key: STORAGE_KEY,
            value: currentStorage,
            updated_at: new Date().toISOString()
          },
          { onConflict: "key" }
        );

      saveBtn.disabled = false;

      if (saveRes.error) {
        status.textContent = "ERROR: " + saveRes.error.message;
        return;
      }

      status.textContent = "Saved";
    });

    card.appendChild(title);
    card.appendChild(info);
    card.appendChild(document.createElement("hr"));
    card.appendChild(back);
    card.appendChild(document.createElement("br"));
    card.appendChild(document.createElement("br"));
    card.appendChild(prefixLabel);
    card.appendChild(document.createElement("br"));
    card.appendChild(prefixInput);
    card.appendChild(document.createElement("br"));
    card.appendChild(document.createElement("br"));
    card.appendChild(modulesTitle);
    card.appendChild(moderation.wrap);
    card.appendChild(lunarialog.wrap);
    card.appendChild(tickets.wrap);
    card.appendChild(voicemaster.wrap);
    card.appendChild(serverpanel.wrap);
    card.appendChild(document.createElement("br"));
    card.appendChild(saveBtn);
    card.appendChild(status);

    root.appendChild(card);
  } catch (e) {
    show('<div class="card"><h2>CRASH</h2><p>' + esc(e && e.message ? e.message : e) + "</p></div>");
  }
}

start();
