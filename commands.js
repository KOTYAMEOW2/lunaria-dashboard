var root = document.getElementById("commandsView") || document.body;

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

function normalizePermission(row, guildId, commandName) {
  var source = row || {};

  return {
    guild_id: guildId,
    command_name: commandName,
    enabled: source.enabled !== false,
    allowed_roles: Array.isArray(source.allowed_roles) ? source.allowed_roles : [],
    denied_roles: Array.isArray(source.denied_roles) ? source.denied_roles : [],
    allowed_channels: Array.isArray(source.allowed_channels) ? source.allowed_channels : [],
    denied_channels: Array.isArray(source.denied_channels) ? source.denied_channels : [],
    cooldown: typeof source.cooldown === "number" ? source.cooldown : 0
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

async function loadCommandsRegistry() {
  var res = await supabase
    .from("commands_registry")
    .select("*")
    .order("category", { ascending: true })
    .order("command_name", { ascending: true });

  if (res.error) {
    throw new Error("commands_registry: " + res.error.message);
  }

  return res.data || [];
}

async function loadGuildCommandPermissions(guildId) {
  var res = await supabase
    .from("command_permissions")
    .select("*")
    .eq("guild_id", guildId);

  if (res.error) {
    throw new Error("command_permissions: " + res.error.message);
  }

  var rows = res.data || [];
  var map = {};

  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i];
    if (!row || !row.command_name) continue;
    map[row.command_name] = row;
  }

  return map;
}

async function saveCommandPermission(permission) {
  var payload = {
    guild_id: permission.guild_id,
    command_name: permission.command_name,
    enabled: permission.enabled,
    allowed_roles: permission.allowed_roles,
    denied_roles: permission.denied_roles,
    allowed_channels: permission.allowed_channels,
    denied_channels: permission.denied_channels,
    cooldown: permission.cooldown,
    updated_at: new Date().toISOString()
  };

  var res = await supabase
    .from("command_permissions")
    .upsert(payload, { onConflict: "guild_id,command_name" });

  if (res.error) {
    throw new Error("command_permissions save: " + res.error.message);
  }
}

function openCommandEditor(ctx) {
  var guild = ctx.guild;
  var command = ctx.command;
  var permission = normalizePermission(ctx.permission, guild.guild_id, command.command_name);

  root.innerHTML = "";

  var card = document.createElement("div");
  card.className = "card";

  var title = document.createElement("h2");
  title.textContent = (command.command_name || "Command") + " Settings";

  var sub = document.createElement("p");
  sub.textContent =
    "Guild ID: " + guild.guild_id +
    " | Category: " + (command.category || "other");

  var desc = document.createElement("p");
  desc.textContent = command.description || "Без описания.";

  var nav = document.createElement("div");
  nav.className = "actions";

  var back = document.createElement("button");
  back.type = "button";
  back.textContent = "← Back";

  nav.appendChild(back);

  var enabledWrap = document.createElement("div");
  enabledWrap.className = "setting-row";

  var enabledLabel = document.createElement("label");
  var enabledInput = document.createElement("input");
  enabledInput.type = "checkbox";
  enabledInput.checked = permission.enabled;
  enabledLabel.appendChild(enabledInput);
  enabledLabel.appendChild(document.createTextNode(" Enabled"));
  enabledWrap.appendChild(enabledLabel);

  var cooldownWrap = document.createElement("div");
  cooldownWrap.className = "setting-row";

  var cooldownLabel = document.createElement("label");
  cooldownLabel.textContent = "Cooldown (seconds)";

  var cooldownInput = document.createElement("input");
  cooldownInput.type = "number";
  cooldownInput.min = "0";
  cooldownInput.step = "1";
  cooldownInput.value = String(permission.cooldown || 0);

  cooldownWrap.appendChild(cooldownLabel);
  cooldownWrap.appendChild(document.createElement("br"));
  cooldownWrap.appendChild(cooldownInput);

  function makeTextareaBlock(labelText, value, placeholder) {
    var wrap = document.createElement("div");
    wrap.className = "setting-row";

    var label = document.createElement("label");
    label.textContent = labelText;

    var textarea = document.createElement("textarea");
    textarea.rows = 4;
    textarea.style.width = "100%";
    textarea.value = listToInput(value);
    textarea.placeholder = placeholder || "";

    wrap.appendChild(label);
    wrap.appendChild(document.createElement("br"));
    wrap.appendChild(textarea);

    return {
      wrap: wrap,
      input: textarea
    };
  }

  var allowedRolesField = makeTextareaBlock(
    "Allowed roles (через запятую)",
    permission.allowed_roles,
    "1234567890, 9876543210"
  );

  var deniedRolesField = makeTextareaBlock(
    "Denied roles (через запятую)",
    permission.denied_roles,
    "1234567890, 9876543210"
  );

  var allowedChannelsField = makeTextareaBlock(
    "Allowed channels (через запятую)",
    permission.allowed_channels,
    "1234567890, 9876543210"
  );

  var deniedChannelsField = makeTextareaBlock(
    "Denied channels (через запятую)",
    permission.denied_channels,
    "1234567890, 9876543210"
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
  resetBtn.textContent = "Reset";

  actions.appendChild(saveBtn);
  actions.appendChild(reloadBtn);
  actions.appendChild(resetBtn);

  var status = document.createElement("p");
  status.textContent = "";

  function collectPermission() {
    return normalizePermission({
      guild_id: guild.guild_id,
      command_name: command.command_name,
      enabled: enabledInput.checked,
      cooldown: Math.max(0, parseInt(cooldownInput.value || "0", 10) || 0),
      allowed_roles: parseList(allowedRolesField.input.value),
      denied_roles: parseList(deniedRolesField.input.value),
      allowed_channels: parseList(allowedChannelsField.input.value),
      denied_channels: parseList(deniedChannelsField.input.value)
    }, guild.guild_id, command.command_name);
  }

  function applyPermission(nextPermission) {
    var normalized = normalizePermission(nextPermission, guild.guild_id, command.command_name);

    enabledInput.checked = normalized.enabled;
    cooldownInput.value = String(normalized.cooldown || 0);
    allowedRolesField.input.value = listToInput(normalized.allowed_roles);
    deniedRolesField.input.value = listToInput(normalized.denied_roles);
    allowedChannelsField.input.value = listToInput(normalized.allowed_channels);
    deniedChannelsField.input.value = listToInput(normalized.denied_channels);
  }

  back.addEventListener("click", function () {
    renderCommandsPage(ctx.pageState);
  });

  saveBtn.addEventListener("click", async function () {
    try {
      saveBtn.disabled = true;
      reloadBtn.disabled = true;
      resetBtn.disabled = true;
      status.textContent = "Saving...";

      var next = collectPermission();
      await saveCommandPermission(next);

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

      var freshMap = await loadGuildCommandPermissions(guild.guild_id);
      var freshPermission = freshMap[command.command_name];
      applyPermission(freshPermission);

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
    applyPermission(null);
    status.textContent = "Reset locally. Нажми Save, чтобы записать в базу.";
  });

  card.appendChild(title);
  card.appendChild(sub);
  card.appendChild(desc);
  card.appendChild(document.createElement("hr"));
  card.appendChild(nav);
  card.appendChild(document.createElement("br"));
  card.appendChild(enabledWrap);
  card.appendChild(document.createElement("br"));
  card.appendChild(cooldownWrap);
  card.appendChild(document.createElement("br"));
  card.appendChild(allowedRolesField.wrap);
  card.appendChild(document.createElement("br"));
  card.appendChild(deniedRolesField.wrap);
  card.appendChild(document.createElement("br"));
  card.appendChild(allowedChannelsField.wrap);
  card.appendChild(document.createElement("br"));
  card.appendChild(deniedChannelsField.wrap);
  card.appendChild(document.createElement("br"));
  card.appendChild(actions);
  card.appendChild(status);

  root.appendChild(card);
}

function renderCommandsPage(state) {
  var guild = state.guild;
  var role = state.role;
  var commands = state.commands || [];
  var permissionsMap = state.permissionsMap || {};

  root.innerHTML = "";

  var card = document.createElement("div");
  card.className = "card";

  var title = document.createElement("h2");
  title.textContent = (guild.name || "Server") + " Commands";

  var info = document.createElement("p");
  info.textContent = "Guild ID: " + guild.guild_id + " | Role: " + (role || "admin");

  var nav = document.createElement("div");
  nav.className = "actions";

  var back = document.createElement("a");
  back.href = "./manage.html?guild=" + encodeURIComponent(guild.guild_id);
  back.className = "manage-link";
  back.textContent = "← Back";

  nav.appendChild(back);

  var searchWrap = document.createElement("div");
  searchWrap.className = "setting-row";

  var searchLabel = document.createElement("label");
  searchLabel.textContent = "Search";

  var searchInput = document.createElement("input");
  searchInput.type = "text";
  searchInput.placeholder = "Например ban, warn, tickets";

  searchWrap.appendChild(searchLabel);
  searchWrap.appendChild(document.createElement("br"));
  searchWrap.appendChild(searchInput);

  var listWrap = document.createElement("div");
  listWrap.className = "servers";

  function drawList(query) {
    listWrap.innerHTML = "";

    var normalizedQuery = String(query || "").trim().toLowerCase();
    var filtered = commands.filter(function (command) {
      var name = String(command.command_name || "").toLowerCase();
      var category = String(command.category || "").toLowerCase();
      var description = String(command.description || "").toLowerCase();

      if (!normalizedQuery) return true;
      return (
        name.indexOf(normalizedQuery) !== -1 ||
        category.indexOf(normalizedQuery) !== -1 ||
        description.indexOf(normalizedQuery) !== -1
      );
    });

    if (!filtered.length) {
      var empty = document.createElement("p");
      empty.textContent = "Команды не найдены.";
      listWrap.appendChild(empty);
      return;
    }

    for (var i = 0; i < filtered.length; i += 1) {
      (function () {
        var command = filtered[i];
        var permission = normalizePermission(
          permissionsMap[command.command_name],
          guild.guild_id,
          command.command_name
        );

        var item = document.createElement("div");
        item.className = "server-card";

        var infoWrap = document.createElement("div");
        infoWrap.className = "server-info";

        var h3 = document.createElement("h3");
        h3.textContent = command.command_name || "unknown";

        var cat = document.createElement("p");
        cat.textContent = "Category: " + (command.category || "other");

        var desc = document.createElement("p");
        desc.textContent = command.description || "Без описания.";

        var enabled = document.createElement("p");
        enabled.textContent = "Enabled: " + (permission.enabled ? "yes" : "no");

        infoWrap.appendChild(h3);
        infoWrap.appendChild(cat);
        infoWrap.appendChild(desc);
        infoWrap.appendChild(enabled);

        var actions = document.createElement("div");
        actions.className = "actions";

        var toggleBtn = document.createElement("button");
        toggleBtn.type = "button";
        toggleBtn.textContent = permission.enabled ? "Disable" : "Enable";

        var editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.textContent = "Configure";

        toggleBtn.addEventListener("click", async function () {
          try {
            toggleBtn.disabled = true;

            var next = normalizePermission(
              permissionsMap[command.command_name],
              guild.guild_id,
              command.command_name
            );

            next.enabled = !next.enabled;

            await saveCommandPermission(next);
            permissionsMap[command.command_name] = next;
            drawList(searchInput.value);
          } catch (err) {
            alert("Ошибка: " + (err && err.message ? err.message : err));
          } finally {
            toggleBtn.disabled = false;
          }
        });

        editBtn.addEventListener("click", function () {
          openCommandEditor({
            guild: guild,
            command: command,
            permission: permissionsMap[command.command_name],
            pageState: state
          });
        });

        actions.appendChild(toggleBtn);
        actions.appendChild(editBtn);

        item.appendChild(infoWrap);
        item.appendChild(actions);

        listWrap.appendChild(item);
      })();
    }
  }

  searchInput.addEventListener("input", function () {
    drawList(searchInput.value);
  });

  card.appendChild(title);
  card.appendChild(info);
  card.appendChild(document.createElement("hr"));
  card.appendChild(nav);
  card.appendChild(document.createElement("br"));
  card.appendChild(searchWrap);
  card.appendChild(document.createElement("br"));
  card.appendChild(listWrap);

  root.appendChild(card);

  drawList("");
}

async function start() {
  try {
    show('<div class="card"><h2>Loading</h2><p>Загрузка команд...</p></div>');

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
    var commands = await loadCommandsRegistry();
    var permissionsMap = await loadGuildCommandPermissions(guildId);

    renderCommandsPage({
      guild: access.guild,
      role: access.admin.role || "admin",
      commands: commands,
      permissionsMap: permissionsMap
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
