const root =
  document.getElementById("settingsView") ||
  document.body;

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";

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

async function start() {
  try {
    show("settings.js started...");

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
      show("NO SESSION");
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

    const configRes = await supabase
      .from("guild_configs")
      .select("*")
      .eq("guild_id", guildId)
      .maybeSingle();

    if (configRes.error) {
      show("ERROR guild_configs: " + configRes.error.message);
      return;
    }

    const guild = guildRes.data;
    const config = configRes.data || {};

    root.innerHTML = "";

    const title = document.createElement("h2");
    title.textContent = (guild.name || "Server") + " Settings";

    const info = document.createElement("p");
    info.textContent = "Guild ID: " + guild.guild_id + " | Role: " + adminRes.data.role;

    const back = document.createElement("a");
    back.href = "./manage.html?guild=" + encodeURIComponent(guild.guild_id);
    back.textContent = "← Back to Manage";

    const prefixLabel = document.createElement("label");
    prefixLabel.textContent = "Prefix";

    const prefixInput = document.createElement("input");
    prefixInput.type = "text";
    prefixInput.maxLength = 5;
    prefixInput.value = config.prefix || "!";

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save";

    const status = document.createElement("p");
    status.textContent = "";

    saveBtn.addEventListener("click", async function () {
      saveBtn.disabled = true;
      status.textContent = "Saving...";

      const payload = {
        guild_id: guild.guild_id,
        prefix: (prefixInput.value || "!").trim().slice(0, 5) || "!",
        updated_at: new Date().toISOString()
      };

      const saveRes = await supabase
        .from("guild_configs")
        .upsert(payload, { onConflict: "guild_id" });

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
    root.appendChild(saveBtn);
    root.appendChild(status);
  } catch (e) {
    show("CRASH: " + (e?.message || e));
  }
}

start();
