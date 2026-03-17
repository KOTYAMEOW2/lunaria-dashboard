const root =
  document.getElementById("settingsView") ||
  document.body;

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";
const STORAGE_KEY = "guild-config.json";

function show(text) {
  root.innerHTML = "<pre>" + String(text) + "</pre>";
}

function getDiscordId(user) {
  return (
    user?.user_metadata?.provider_id ||
    user?.user_metadata?.sub ||
    null
  );
}

function normalizeGuildConfig(config) {
  const current = config || {};

  return {
    prefix: typeof current.prefix === "string" ? current.prefix : ".",
    enabledModules: {
      moderation: current.enabledModules?.moderation !== false,
      lunarialog: current.enabledModules?.lunarialog !== false,
      tickets: current.enabledModules?.tickets === true,
      voicemaster: current.enabledModules?.voicemaster === true,
      serverpanel: current.enabledModules?.serverpanel !== false
    },
    modRoles: Array.isArray(current.modRoles) ? current.modRoles : [],
    adminRoles: Array.isArray(current.adminRoles) ? current.adminRoles : [],
    disabledCommands: Array.isArray(current.disabledCommands) ? current.disabledCommands : []
  };
}

async function start() {
  try {
    if (!window.supabase) {
      show("ERROR: supabase not loaded");
      return;
    }

    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    const url = new URL(window.location.href);
    const guildId = url.searchParams.get("guild");

    if (!guildId) {
      show("ERROR: no guild id");
      return;
    }

    const sessionRes = await supabase.auth.getSession();

    if (sessionRes.error) {
      show("ERROR session: " + sessionRes.error.message);
      return;
    }

    const session = sessionRes.data?.session;

    if (!session) {
      window.location.href = "./";
      return;
    }

    const discordId = getDiscordId(session.user);

    if (!discordId) {
      show("ERROR: no discord id");
      return;
    }

    const adminRes = await supabase
      .from("guild_admins")
      .select("*")
      .eq("guild_id", guildId)
      .eq("user_id", discordId)
      .maybeSingle();

    if (adminRes.error) {
      show("ERROR guild_admins: " + adminRes.error.message);
      return;
    }

    if (!adminRes.data) {
      show("NO ACCESS");
      return;
    }

    const guildRes = await supabase
      .from("bot_guilds")
      .select("*")
      .eq("guild_id", guildId)
      .maybeSingle();

    if (guildRes.error) {
      show("ERROR bot_guilds: " + guildRes.error.message);
      return;
    }

    if (!guildRes.data) {
      show("GUILD NOT FOUND");
      return;
    }

    const storageRes = await supabase
      .from("bot_storage")
      .select("*")
      .eq("key", STORAGE_KEY)
      .maybeSingle();

    if (storageRes.error) {
      show("ERROR bot_storage read: " + storageRes.error.message);
      return;
    }

    const storageValue =
      storageRes.data?.value && typeof storageRes.data.value === "object"
        ? storageRes.data.value
        : {};

    const guildConfig = normalizeGuildConfig(storageValue[guildId]);

    root.innerHTML = "";

    const title = document.createElement("h2");
    title.textContent = (guildRes.data.name || "Server") + " Settings";

    const info = document.createElement("p");
    info.textContent = "Guild ID: " + guildRes.data.guild_id + " | Role: " + adminRes.data.role;

    const back = document.createElement("a");
    back.href = "./manage.html?guild=" + encodeURIComponent(guildRes.data.guild_id);
    back.textContent = "← Back to Manage";

    const prefixLabel = document.createElement("label");
    prefixLabel.textContent = "Prefix";

    const prefixInput = document.createElement("input");
    prefixInput.type = "text";
    prefixInput.maxLength = 5;
    prefixInput.value = guildConfig.prefix || ".";

    const modulesTitle = document.createElement("h3");
    modulesTitle.textContent = "Enabled modules";

    function makeCheckbox(labelText, checked) {
      const wrap = document.createElement("div");
      const label = document.createElement("label");
      const input = document.createElement("input");

      input.type = "checkbox";
      input.checked = !!checked;

      label.appendChild(input);
      label.appendChild(document.createTextNode(" " + labelText));
      wrap.appendChild(label);

      return { wrap, input };
    }

    const moderation = makeCheckbox("Moderation", guildConfig.enabledModules.moderation);
    const lunarialog = makeCheckbox("LunariaLog", guildConfig.enabledModules.lunarialog);
    const tickets = makeCheckbox("Tickets", guildConfig.enabledModules.tickets);
    const voicemaster = makeCheckbox("VoiceMaster", guildConfig.enabledModules.voicemaster);
    const serverpanel = makeCheckbox("Server Panel", guildConfig.enabledModules.serverpanel);

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";

    const status = document.createElement("p");
    status.textContent = "";

    saveBtn.addEventListener("click", async function () {
      saveBtn.disabled = true;
      status.textContent = "Saving...";

      const currentStorage = { ...storageValue };

      currentStorage[guildId] = {
        ...guildConfig,
        prefix: (prefixInput.value || ".").trim().slice(0, 5) || ".",
        enabledModules: {
          moderation: moderation.input.checked,
          lunarialog: lunarialog.input.checked,
          tickets: tickets.input.checked,
          voicemaster: voicemaster.input.checked,
          serverpanel: serverpanel.input.checked
        }
      };

      const saveRes = await supabase
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

    root.appendChild(title);
    root.appendChild(info);
    root.appendChild(document.createElement("hr"));
    root.appendChild(back);
    root.appendChild(document.createElement("br"));
    root.appendChild(document.createElement("br"));
    root.appendChild(prefixLabel);
    root.appendChild(document.createElement("br"));
    root.appendChild(prefixInput);
    root.appendChild(document.createElement("br"));
    root.appendChild(document.createElement("br"));
    root.appendChild(modulesTitle);
    root.appendChild(moderation.wrap);
    root.appendChild(lunarialog.wrap);
    root.appendChild(tickets.wrap);
    root.appendChild(voicemaster.wrap);
    root.appendChild(serverpanel.wrap);
    root.appendChild(document.createElement("br"));
    root.appendChild(saveBtn);
    root.appendChild(status);
  } catch (e) {
    show("CRASH: " + (e?.message || e));
  }
}

start();
