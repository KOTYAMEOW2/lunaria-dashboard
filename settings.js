var root = document.getElementById("settingsView") || document.body;

var CONFIG = window.LUNARIA_CONFIG || {};

var SUPABASE_URL = CONFIG.SUPABASE_URL;
var SUPABASE_KEY = CONFIG.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error("Config is missing SUPABASE_URL or SUPABASE_KEY");
}

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  throw new Error("Supabase library is not loaded");
}

var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

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

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map(function (item) {
      return item.trim();
    })
    .filter(function (item) {
      return item.length > 0;
    });
}

function listToInput(value) {
  if (!Array.isArray(value) || !value.length) return "";
  return value.join(", ");
}

function defaultGuildConfig(guildId) {
  return {
    guild_id: guildId,
    prefix: ".",
    enabled_modules: {
      moderation: true,
      lunarialog: true,
      tickets: false,
      voicemaster: false,
      serverpanel: true
    },
    mod_roles: [],
    admin_roles: [],
    disabled_commands: []
  };
}

function normalizeGuildConfig(row, guildId) {
  var base = defaultGuildConfig(guildId);
  var source = row || {};

  var enabledModules = source.enabled_modules || source.enabledModules || {};
  var modRoles = source.mod_roles || source.modRoles || [];
  var adminRoles = source.admin_roles || source.adminRoles || [];
  var disabledCommands = source.disabled_commands || source.disabledCommands || [];

  return {
    guild_id: guildId,
    prefix: typeof source.prefix === "string" && source.prefix.trim()
      ? source.prefix.trim().slice(0, 5)
      : base.prefix,
    enabled_modules: {
      moderation: enabledModules.moderation !== false,
      lunarialog: enabledModules.lunarialog !== false,
      tickets: !!enabledModules.tickets,
      voicemaster: !!enabledModules.voicemaster,
      serverpanel: enabledModules.serverpanel !== false
    },
    mod_roles: Array.isArray(modRoles) ? modRoles : [],
    admin_roles: Array.isArray(adminRoles) ? adminRoles : [],
    disabled_commands: Array.isArray(disabledCommands) ? disabledCommands : []
  };
}

function buildCheckbox(labelText, checked) {
  var wrap = document.createElement("div");
  wrap.className = "setting-row";

  var label = document.createElement("label");
  var input = document.createElement("input");

  input.type = "checkbox";
  input.checked = !!checked;

  label.appendChild(input);
  label.appendChild(document.createTextNode(" " + labelText));

  wrap.appendChild(label);

  return {
    wrap: wrap,
    input: input
  };
}

function buildTextField(labelText, value, placeholder) {
  var wrap = document.createElement("div");
  wrap.className = "setting-row";

  var label = document.createElement("label");
  label.textContent = labelText;

  var input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.placeholder = placeholder || "";

  wrap.appendChild(label);
  wrap.appendChild(document.createElement("br"));
  wrap.appendChild(input);

  return {
    wrap: wrap,
    input: input
  };
}

function buildTextareaField(labelText, value, placeholder) {
  var wrap = document.createElement("div");
  wrap.className = "setting-row";

  var label = document.createElement("label");
  label.textContent = labelText;

  var textarea = document.createElement("textarea");
  textarea.value = value || "";
  textarea.placeholder = placeholder || "";
  textarea.rows = 4;
  textarea.style.width = "100%";

  wrap.appendChild(label);
  wrap.appendChild(document.createElement("br"));
  wrap.appendChild(textarea);

  return {
    wrap: wrap,
    input: textarea
  };
}

async function getSessionOrRedirect() {
  var sessionRes = await supabase.auth.getSession();

  if (sessionRes.error) {
    throw new Error("session: " + sessionRes.error.message);
  }

  var session = sessionRes.data && sessionRes.data.session ? sessionRes.data.session : null;

  if (!session) {
    window.location.href = "./";
    return null;
  }

  return session;
}

async function ensureGuildAccess(guildId, discordId) {
  var adminRes = await supabase
    .from("guild_admins")
    .select("guild_id, user_id, role")
    .eq("guild_id", guildId)
    .eq("user_id", discordId)
    .maybeSingle();

  if (adminRes.error) {
    throw new Error("guild_admins: " + adminRes.error.message);
  }

  if (!adminRes.data) {
    throw new Error("Нет доступа к этому серверу.");
  }

  var guildRes = await supabase
    .from("bot_guilds")
    .select("guild_id, name, icon")
    .eq("guild_id", guildId)
    .maybeSingle();

  if (guildRes.error) {
    throw new Error("bot_guilds: " + guildRes.error.message);
  }

  if (!guildRes.data) {
    throw new Error("Запись сервера не найдена в bot_guilds.");
  }

  return {
    admin: adminRes.data,
    guild: guildRes.data
  };
}

async function loadGuildConfig(guildId) {
  var cfgRes = await supabase
    .from("guild_configs")
    .select("*")
    .eq("guild_id", guildId)
    .maybeSingle();

  if (cfgRes.error) {
    throw new Error("guild_configs: " + cfgRes.error.message);
  }

  return normalizeGuildConfig(cfgRes.data, guildId);
}

async function saveGuildConfig(config) {
  var payload = {
    guild_id: config.guild_id,
    prefix: config.prefix,
    enabled_modules: config.enabled_modules,
    mod_roles: config.mod_roles,
    admin_roles: config.admin_roles,
    disabled_commands: config.disabled_commands,
    updated_at: new Date().toISOString()
  };

  var saveRes = await supabase
    .from("guild_configs")
    .upsert(payload, { onConflict: "guild_id" });

  if (saveRes.error) {
    throw new Error("guild_configs save: " + saveRes.error.message);
  }
}

function renderSettingsPage(ctx) {
  var guild = ctx.guild;
  var role = ctx.role;
  var state = normalizeGuildConfig(ctx.config, guild.guild_id);

  root.innerHTML = "";

  var card = document.createElement("div");
  card.className = "card";

  var title = document.createElement("h2");
  title.textContent = (guild.name || "Server") + " Settings";

  var info = document.createElement("p");
  info.textContent = "Guild ID: " + guild.guild_id + " | Role: " + (role || "admin");

  var nav = document.createElement("div");
  nav.className = "actions";

  var back = document.createElement("a");
  back.href = "./manage.html?guild=" + encodeURIComponent(guild.guild_id);
  back.textContent = "← Back";
  back.className = "manage-link";

  nav.appendChild(back);

  var sectionGeneral = document.createElement("h3");
  sectionGeneral.textContent = "General";

  var prefixField = buildTextField("Prefix", state.prefix, "Например . или !");
  prefixField.input.maxLength = 5;

  var sectionModules = document.createElement("h3");
  sectionModules.textContent = "Enabled modules";

  var moderation = buildCheckbox("Moderation", state.enabled_modules.moderation);
  var lunarialog = buildCheckbox("LunariaLog", state.enabled_modules.lunarialog);
  var tickets = buildCheckbox("Tickets", state.enabled_modules.tickets);
  var voicemaster = buildCheckbox("VoiceMaster", state.enabled_modules.voicemaster);
  var serverpanel = buildCheckbox("Server Panel", state.enabled_modules.serverpanel);

  var sectionRoles = document.createElement("h3");
  sectionRoles.textContent = "Roles";

  var modRolesField = buildTextareaField(
    "Mod roles (через запятую)",
    listToInput(state.mod_roles),
    "1234567890, 9876543210"
  );

  var adminRolesField = buildTextareaField(
    "Admin roles (через запятую)",
    listToInput(state.admin_roles),
    "1234567890, 9876543210"
  );

  var sectionCommands = document.createElement("h3");
  sectionCommands.textContent = "Commands";

  var disabledCommandsField = buildTextareaField(
    "Disabled commands (через запятую)",
    listToInput(state.disabled_commands),
    "ban, mute, warn"
  );

  var actions = document.createElement("div");
  actions.className = "actions";

  var saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.textContent = "Save";

  var reloadBtn = document.createElement("button");
  reloadBtn.type = "button";
  reloadBtn.textContent = "Reload";

  var resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.textContent = "Reset to defaults";

  actions.appendChild(saveBtn);
  actions.appendChild(reloadBtn);
  actions.appendChild(resetBtn);

  var status = document.createElement("p");
  status.textContent = "";

  function collectFormState() {
    return normalizeGuildConfig({
      guild_id: guild.guild_id,
      prefix: (prefixField.input.value || ".").trim().slice(0, 5) || ".",
      enabled_modules: {
        moderation: moderation.input.checked,
        lunarialog: lunarialog.input.checked,
        tickets: tickets.input.checked,
        voicemaster: voicemaster.input.checked,
        serverpanel: serverpanel.input.checked
      },
      mod_roles: parseList(modRolesField.input.value),
      admin_roles: parseList(adminRolesField.input.value),
      disabled_commands: parseList(disabledCommandsField.input.value)
    }, guild.guild_id);
  }

  function applyState(nextState) {
    var normalized = normalizeGuildConfig(nextState, guild.guild_id);

    prefixField.input.value = normalized.prefix;
    moderation.input.checked = normalized.enabled_modules.moderation;
    lunarialog.input.checked = normalized.enabled_modules.lunarialog;
    tickets.input.checked = normalized.enabled_modules.tickets;
    voicemaster.input.checked = normalized.enabled_modules.voicemaster;
    serverpanel.input.checked = normalized.enabled_modules.serverpanel;
    modRolesField.input.value = listToInput(normalized.mod_roles);
    adminRolesField.input.value = listToInput(normalized.admin_roles);
    disabledCommandsField.input.value = listToInput(normalized.disabled_commands);
  }

  saveBtn.addEventListener("click", async function () {
    try {
      saveBtn.disabled = true;
      reloadBtn.disabled = true;
      resetBtn.disabled = true;
      status.textContent = "Saving...";

      var nextConfig = collectFormState();
      await saveGuildConfig(nextConfig);

      status.textContent = "Saved";
    } catch (err) {
      status.textContent = "ERROR: " + (err && err.message ? err.message : err);
    } finally {
      saveBtn.disabled = false;
      reloadBtn.disabled = false;
      resetBtn.disabled = false;
    }
  });

  reloadBtn.addEventListener("click", async function () {
    try {
      saveBtn.disabled = true;
      reloadBtn.disabled = true;
      resetBtn.disabled = true;
      status.textContent = "Reloading...";

      var fresh = await loadGuildConfig(guild.guild_id);
      applyState(fresh);

      status.textContent = "Reloaded";
    } catch (err) {
      status.textContent = "ERROR: " + (err && err.message ? err.message : err);
    } finally {
      saveBtn.disabled = false;
      reloadBtn.disabled = false;
      resetBtn.disabled = false;
    }
  });

  resetBtn.addEventListener("click", function () {
    var defaults = defaultGuildConfig(guild.guild_id);
    applyState(defaults);
    status.textContent = "Reset locally. Нажми Save, чтобы записать в базу.";
  });

  card.appendChild(title);
  card.appendChild(info);
  card.appendChild(document.createElement("hr"));
  card.appendChild(nav);
  card.appendChild(document.createElement("br"));
  card.appendChild(sectionGeneral);
  card.appendChild(prefixField.wrap);
  card.appendChild(document.createElement("br"));
  card.appendChild(sectionModules);
  card.appendChild(moderation.wrap);
  card.appendChild(lunarialog.wrap);
  card.appendChild(tickets.wrap);
  card.appendChild(voicemaster.wrap);
  card.appendChild(serverpanel.wrap);
  card.appendChild(document.createElement("br"));
  card.appendChild(sectionRoles);
  card.appendChild(modRolesField.wrap);
  card.appendChild(document.createElement("br"));
  card.appendChild(adminRolesField.wrap);
  card.appendChild(document.createElement("br"));
  card.appendChild(sectionCommands);
  card.appendChild(disabledCommandsField.wrap);
  card.appendChild(document.createElement("br"));
  card.appendChild(actions);
  card.appendChild(status);

  root.appendChild(card);
}

async function start() {
  try {
    show('<div class="card"><h2>Loading</h2><p>Загрузка настроек...</p></div>');

    var url = new URL(window.location.href);
    var guildId = url.searchParams.get("guild");

    if (!guildId) {
      show('<div class="card"><h2>Ошибка</h2><p>Не передан guild id.</p></div>');
      return;
    }

    var session = await getSessionOrRedirect();
    if (!session) return;

    var discordId = getDiscordId(session.user);
    if (!discordId) {
      show('<div class="card"><h2>Ошибка</h2><p>Discord ID не найден в сессии.</p></div>');
      return;
    }

    var access = await ensureGuildAccess(guildId, discordId);
    var config = await loadGuildConfig(guildId);

    renderSettingsPage({
      guild: access.guild,
      role: access.admin.role || "admin",
      config: config
    });
  } catch (err) {
    show(
      '<div class="card"><h2>Ошибка</h2><p>' +
        esc(err && err.message ? err.message : err) +
        "</p></div>"
    );
  }
}

start();
