const settingsView =
  document.getElementById("settingsView") ||
  document.body;

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";

function clearRoot() {
  settingsView.innerHTML = "";
}

function text(value) {
  return document.createTextNode(String(value ?? ""));
}

function el(tag, options = {}) {
  const node = document.createElement(tag);

  if (options.className) node.className = options.className;
  if (options.text !== undefined) node.textContent = String(options.text);
  if (options.html !== undefined) node.innerHTML = options.html;
  if (options.type) node.type = options.type;
  if (options.value !== undefined) node.value = options.value;
  if (options.placeholder !== undefined) node.placeholder = options.placeholder;
  if (options.href) node.href = options.href;
  if (options.target) node.target = options.target;
  if (options.rel) node.rel = options.rel;
  if (options.checked !== undefined) node.checked = !!options.checked;
  if (options.disabled !== undefined) node.disabled = !!options.disabled;

  return node;
}

function showMessage(message) {
  clearRoot();
  const box = el("div", { className: "card" });
  const p = el("p", { text: message });
  box.appendChild(p);
  settingsView.appendChild(box);
}

function getGuildIdFromUrl() {
  const url = new URL(window.location.href);
  return url.searchParams.get("guild");
}

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

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  showMessage("Supabase library is not loaded.");
  throw new Error("Supabase library is not loaded.");
}

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function ensureAccess(guildId, discordId) {
  const res = await supabase
    .from("guild_admins")
    .select("guild_id, role")
    .eq("guild_id", guildId)
    .eq("user_id", discordId)
    .maybeSingle();

  if (res.error) {
    throw new Error("guild_admins: " + res.error.message);
  }

  return res.data;
}

async function loadGuild(guildId) {
  const res = await supabase
    .from("bot_guilds")
    .select("guild_id, name, icon, updated_at")
    .eq("guild_id", guildId)
    .maybeSingle();

  if (res.error) {
    throw new Error("bot_guilds: " + res.error.message);
  }

  return res.data;
}

async function loadGuildConfig(guildId) {
  const res = await supabase
    .from("guild_configs")
    .select("*")
    .eq("guild_id", guildId)
    .maybeSingle();

  if (res.error) {
    throw new Error("guild_configs: " + res.error.message);
  }

  return res.data;
}

function normalizeEnabledModules(row) {
  const raw =
    row?.enabled_modules ||
    row?.enabledModules ||
    {};

  return {
    moderation: !!raw.moderation,
    lunarialog: !!raw.lunarialog,
    tickets: !!raw.tickets,
    voicemaster: !!raw.voicemaster,
    serverpanel: raw.serverpanel !== false
  };
}

function renderSettingsPage(guild, role, configRow) {
  clearRoot();

  const card = el("section", { className: "card" });
  const actions = el("div", { className: "actions" });

  const back = el("a", {
    href: "./manage.html?guild=" + encodeURIComponent(guild.guild_id),
    text: "← Back to Manage"
  });

  actions.appendChild(back);
  card.appendChild(actions);

  const title = el("h2", {
    text: (guild?.name || "Server") + " — Settings"
  });
  card.appendChild(title);

  const info = el("p", {
    text: "Guild ID: " + guild.guild_id + " | Role: " + role
  });
  card.appendChild(info);

  const form = el("form");
  form.autocomplete = "off";

  const prefixWrap = el("div");
  const prefixLabel = el("label", { text: "Prefix" });
  prefixLabel.htmlFor = "prefixInput";

  const prefixInput = el("input", {
    type: "text",
    value: configRow?.prefix || "!"
  });
  prefixInput.id = "prefixInput";
  prefixInput.maxLength = 5;

  prefixWrap.appendChild(prefixLabel);
  prefixWrap.appendChild(document.createElement("br"));
  prefixWrap.appendChild(prefixInput);
  form.appendChild(prefixWrap);

  form.appendChild(document.createElement("br"));

  const modulesTitle = el("h3", { text: "Enabled modules" });
  form.appendChild(modulesTitle);

  const enabledModules = normalizeEnabledModules(configRow);

  const moduleKeys = [
    ["moderation", "Moderation"],
    ["lunarialog", "LunariaLog"],
    ["tickets", "Tickets"],
    ["voicemaster", "VoiceMaster"],
    ["serverpanel", "Server Panel"]
  ];

  const moduleInputs = {};

  for (const [key, labelText] of moduleKeys) {
    const wrap = el("div");
    const label = el("label");

    const checkbox = el("input", {
      type: "checkbox",
      checked: !!enabledModules[key]
    });

    moduleInputs[key] = checkbox;

    label.appendChild(checkbox);
    label.appendChild(text(" " + labelText));
    wrap.appendChild(label);
    form.appendChild(wrap);
  }

  form.appendChild(document.createElement("br"));

  const status = el("p", { text: "" });
  const saveBtn = el("button", {
    type: "submit",
    text: "Save"
  });

  form.appendChild(saveBtn);
  form.appendChild(status);

  form.addEventListener("submit", async function (event) {
    event.preventDefault();

    saveBtn.disabled = true;
    status.textContent = "Saving...";

    const payload = {
      guild_id: guild.guild_id,
      prefix: (prefixInput.value || "!").trim().slice(0, 5) || "!",
      enabled_modules: {
        moderation: moduleInputs.moderation.checked,
        lunarialog: moduleInputs.lunarialog.checked,
        tickets: moduleInputs.tickets.checked,
        voicemaster: moduleInputs.voicemaster.checked,
        serverpanel: moduleInputs.serverpanel.checked
      },
      updated_at: new Date().toISOString()
    };

    const res = await supabase
      .from("guild_configs")
      .upsert(payload, { onConflict: "guild_id" });

    saveBtn.disabled = false;

    if (res.error) {
      status.textContent = "Error: " + res.error.message;
      return;
    }

    status.textContent = "Saved.";
  });

  card.appendChild(form);
  settingsView.appendChild(card);
}

async function init() {
  try {
    const guildId = getGuildIdFromUrl();

    if (!guildId) {
      showMessage("ERROR: no guild id");
      return;
    }

    const sessionRes = await supabase.auth.getSession();

    if (sessionRes.error) {
      showMessage("ERROR auth: " + sessionRes.error.message);
      return;
    }

    const session = sessionRes.data?.session;

    if (!session) {
      window.location.href = "./";
      return;
    }

    const discordId = getDiscordId(session.user);

    if (!discordId) {
      showMessage("ERROR: no discord id");
      return;
    }

    const access = await ensureAccess(guildId, discordId);

    if (!access) {
      showMessage("NO ACCESS");
      return;
    }

    const guild = await loadGuild(guildId);

    if (!guild) {
      showMessage("GUILD NOT FOUND");
      return;
    }

    const configRow = await loadGuildConfig(guildId);

    renderSettingsPage(guild, access.role, configRow);
  } catch (error) {
    console.error("settings.js error:", error);
    showMessage("CRASH: " + (error?.message || String(error)));
  }
}

init();
