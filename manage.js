const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";

const root =
  document.getElementById("manageView") ||
  document.body;

function show(text) {
  root.innerHTML = "<pre>" + String(text) + "</pre>";
}

async function start() {
  try {
    // 1. Проверка Supabase
    if (!window.supabase) {
      show("ERROR: supabase not loaded");
      return;
    }

    const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

    // 2. Получаем guild из URL
    const url = new URL(window.location.href);
    const guildId = url.searchParams.get("guild");

    if (!guildId) {
      show("ERROR: no guild id");
      return;
    }

    // 3. Получаем сессию
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      show("ERROR session: " + sessionError.message);
      return;
    }

    const session = sessionData?.session;

    if (!session) {
      show("NO SESSION → redirect");
      window.location.href = "./";
      return;
    }

    const user = session.user;

    // 4. Получаем Discord ID
    const discordId =
      user?.user_metadata?.provider_id ||
      user?.user_metadata?.sub ||
      null;

    if (!discordId) {
      show("ERROR: no discord id");
      return;
    }

    // 5. Проверяем доступ
    const { data: adminData, error: adminError } = await supabase
      .from("guild_admins")
      .select("*")
      .eq("guild_id", guildId)
      .eq("user_id", discordId)
      .maybeSingle();

    if (adminError) {
      show("ERROR guild_admins: " + adminError.message);
      return;
    }

    if (!adminData) {
      show("NO ACCESS");
      return;
    }

    // 6. Получаем сервер
    const { data: guild, error: guildError } = await supabase
      .from("bot_guilds")
      .select("*")
      .eq("guild_id", guildId)
      .maybeSingle();

    if (guildError) {
      show("ERROR bot_guilds: " + guildError.message);
      return;
    }

    if (!guild) {
      show("GUILD NOT FOUND");
      return;
    }

    // 7. Рендер (максимально просто)
    root.innerHTML = `
      <h1>${guild.name || "Server"}</h1>
      <p>ID: ${guild.guild_id}</p>
      <p>Role: ${adminData.role}</p>

      <hr>

      <a href="./">← Back</a><br><br>

      <a href="./settings.html?guild=${guild.guild_id}">Settings</a><br>
      <a href="./rules.html?guild=${guild.guild_id}">Rules</a><br>
      <a href="./punishments.html?guild=${guild.guild_id}">Punishments</a><br>
      <a href="./logs.html?guild=${guild.guild_id}">Logs</a>
    `;
  } catch (e) {
    show("CRASH: " + (e?.message || e));
  }
}

start();
