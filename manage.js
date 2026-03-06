const manageView = document.getElementById("manageView");

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getDiscordId(user) {
  return (
    user?.user_metadata?.provider_id ||
    user?.user_metadata?.sub ||
    user?.identities?.[0]?.id ||
    user?.app_metadata?.provider_id ||
    null
  );
}

function getGuildIdFromUrl() {
  const url = new URL(location.href);
  return url.searchParams.get("guild");
}

async function initManage() {
  try {
    const guildId = getGuildIdFromUrl();

    if (!guildId) {
      manageView.innerHTML = `
        <h2>Ошибка</h2>
        <p class="error">guild ID не передан</p>
        <a class="btn secondary" href="./">Назад</a>
      `;
      return;
    }

    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      location.href = "./";
      return;
    }

    const discordId = getDiscordId(session.user);

    if (!discordId) {
      manageView.innerHTML = `<p class="error">Discord ID не найден</p>`;
      return;
    }

    const { data: adminRow, error: adminError } = await supabase
      .from("guild_admins")
      .select("guild_id")
      .eq("guild_id", guildId)
      .eq("user_id", discordId)
      .maybeSingle();

    if (adminError) {
      manageView.innerHTML = `<p class="error">Ошибка доступа: ${escapeHtml(adminError.message)}</p>`;
      return;
    }

    if (!adminRow) {
      manageView.innerHTML = `
        <h2>Доступ запрещён</h2>
        <p>У тебя нет доступа к этому серверу.</p>
        <a class="btn secondary" href="./">Назад</a>
      `;
      return;
    }

    const { data: guild, error: guildError } = await supabase
      .from("bot_guilds")
      .select("*")
      .eq("guild_id", guildId)
      .maybeSingle();

    if (guildError) {
      manageView.innerHTML = `<p class="error">Ошибка сервера: ${escapeHtml(guildError.message)}</p>`;
      return;
    }

    if (!guild) {
      manageView.innerHTML = `
        <h2>Сервер не найден</h2>
        <a class="btn secondary" href="./">Назад</a>
      `;
      return;
    }

    manageView.innerHTML = `
      <a class="btn secondary" href="./">← Назад к серверам</a>

      <div style="height:16px"></div>

      <h1>${escapeHtml(guild.name || guild.guild_name || "Server")}</h1>
      <p class="small">Guild ID: ${escapeHtml(guild.guild_id)}</p>

      <div style="height:20px"></div>

      <div class="grid-2">
        <div class="card">
          <h3>Rules</h3>
          <p class="small">Управление правилами сервера</p>
        </div>

        <div class="card">
          <h3>Punishments</h3>
          <p class="small">Система наказаний</p>
        </div>

        <div class="card">
          <h3>Logs</h3>
          <p class="small">Категории и каналы логов</p>
        </div>

        <div class="card">
          <h3>Settings</h3>
          <p class="small">Основные настройки бота</p>
        </div>
      </div>
    `;
  } catch (e) {
    manageView.innerHTML = `<p class="error">Ошибка JS: ${escapeHtml(e.message || String(e))}</p>`;
    console.error(e);
  }
}

initManage();
