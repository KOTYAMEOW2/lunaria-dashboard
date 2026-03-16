const manageView = document.getElementById("manageView");

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";
const DISCORD_BOT_CLIENT_ID = "1473237338460127382";

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

function getGuildIconUrl(guildId, icon) {
  if (!guildId || !icon) return "";
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=128`;
}

function getInviteUrl() {
  const clientId = DISCORD_BOT_CLIENT_ID;
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=8`;
}

async function logout() {
  await supabase.auth.signOut();
  location.href = "./";
}

async function initManage() {
  try {
    const guildId = getGuildIdFromUrl();

    if (!guildId) {
      manageView.innerHTML = `
        <div class="card error">Guild ID не передан.</div>
        <div class="actions">
          <a class="button secondary" href="./">Назад</a>
        </div>
      `;
      return;
    }

    const { data, error } = await supabase.auth.getSession();

    if (error) {
      manageView.innerHTML = `<div class="card error">Ошибка сессии: ${escapeHtml(error.message)}</div>`;
      return;
    }

    const session = data?.session;

    if (!session) {
      location.href = "./";
      return;
    }

    const discordId = getDiscordId(session.user);

    if (!discordId) {
      manageView.innerHTML = `<div class="card error">Discord ID не найден.</div>`;
      return;
    }

    const { data: adminRow, error: adminError } = await supabase
      .from("guild_admins")
      .select("guild_id, role")
      .eq("guild_id", guildId)
      .eq("user_id", discordId)
      .maybeSingle();

    if (adminError) {
      manageView.innerHTML = `<div class="card error">Ошибка доступа: ${escapeHtml(adminError.message)}</div>`;
      return;
    }

    if (!adminRow) {
      manageView.innerHTML = `
        <div class="card error">У тебя нет доступа к этому серверу.</div>
        <div class="actions">
          <a class="button secondary" href="./">Назад</a>
        </div>
      `;
      return;
    }

    const { data: guild, error: guildError } = await supabase
      .from("bot_guilds")
      .select("guild_id, name, icon, updated_at")
      .eq("guild_id", guildId)
      .maybeSingle();

    if (guildError) {
      manageView.innerHTML = `<div class="card error">Ошибка сервера: ${escapeHtml(guildError.message)}</div>`;
      return;
    }

    if (!guild) {
      manageView.innerHTML = `
        <div class="card error">Сервер не найден.</div>
        <div class="actions">
          <a class="button secondary" href="./">Назад</a>
        </div>
      `;
      return;
    }

    manageView.innerHTML = `
      <div class="actions">
        <a class="button secondary" href="./">← Назад к серверам</a>
        <button class="secondary" onclick="logout()">Logout</button>
      </div>

      <div class="server-head">
        ${
          guild.icon
            ? `<img class="server-icon large" src="${getGuildIconUrl(guild.guild_id, guild.icon)}" alt="${escapeHtml(guild.name)}">`
            : `<div class="server-icon large">LF</div>`
        }
        <div>
          <h1>${escapeHtml(guild.name || "Server")}</h1>
          <p class="small">Guild ID: ${escapeHtml(guild.guild_id)}</p>
          <p class="small">Role: ${escapeHtml(adminRow.role || "admin")}</p>
        </div>
      </div>

      <div class="grid-2">
        <a class="card" href="./rules.html?guild=${encodeURIComponent(guild.guild_id)}">
          <h3>Rules</h3>
          <p class="small">Просмотр правил сервера</p>
        </a>

        <a class="card" href="./punishments.html?guild=${encodeURIComponent(guild.guild_id)}">
          <h3>Punishments</h3>
          <p class="small">Система наказаний</p>
        </a>

        <a class="card" href="./logs.html?guild=${encodeURIComponent(guild.guild_id)}">
          <h3>Logs</h3>
          <p class="small">Категории логов</p>
        </a>

        <a class="card" href="./settings.html?guild=${encodeURIComponent(guild.guild_id)}">
          <h3>Settings</h3>
          <p class="small">Настройки сервера</p>
        </a>

        <a class="card" href="${getInviteUrl()}" target="_blank" rel="noopener noreferrer">
          <h3>Invite</h3>
          <p class="small">Добавить бота на сервер</p>
        </a>
      </div>
    `;
  } catch (e) {
    manageView.innerHTML = `<div class="card error">Ошибка загрузки: ${escapeHtml(e.message || String(e))}</div>`;
  }
}

window.logout = logout;

initManage();
