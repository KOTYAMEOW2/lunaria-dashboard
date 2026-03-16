const manageView = document.getElementById("manageView");

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";
const DISCORD_BOT_CLIENT_ID = "1473237338460127382";

if (!manageView) {
  throw new Error('Element #manageView not found');
}

if (!window.supabase || typeof window.supabase.createClient !== "function") {
  manageView.innerHTML = `<div class="card error">Supabase library is not loaded.</div>`;
  throw new Error("Supabase library is not loaded");
}

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  const url = new URL(window.location.href);
  return url.searchParams.get("guild");
}

function getGuildIconUrl(guildId, icon) {
  if (!guildId || !icon) return "";
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=128`;
}

function getInviteUrl() {
  return `https://discord.com/oauth2/authorize?client_id=${DISCORD_BOT_CLIENT_ID}&scope=bot%20applications.commands&permissions=8`;
}

async function logout() {
  try {
    await supabase.auth.signOut();
    location.href = "./";
  } catch (error) {
    manageView.innerHTML = `<div class="card error">Logout error: ${escapeHtml(error.message || String(error))}</div>`;
  }
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
      throw new Error(error.message);
    }

    const session = data?.session;

    if (!session) {
      location.href = "./";
      return;
    }

    const discordId = getDiscordId(session.user);

    if (!discordId) {
      manageView.innerHTML = `<div class="card error">Discord ID не найден в сессии.</div>`;
      return;
    }

    const { data: adminRow, error: adminError } = await supabase
      .from("guild_admins")
      .select("guild_id, role")
      .eq("guild_id", guildId)
      .eq("user_id", discordId)
      .maybeSingle();

    if (adminError) {
      throw new Error(`guild_admins: ${adminError.message}`);
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
      throw new Error(`bot_guilds: ${guildError.message}`);
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

    const iconHtml = guild.icon
      ? `<img class="server-icon large" src="${getGuildIconUrl(guild.guild_id, guild.icon)}" alt="${escapeHtml(guild.name || "Server")}">`
      : `<div class="server-icon large">LF</div>`;

    manageView.innerHTML = `
      <div class="actions">
        <a class="button secondary" href="./">← Назад к серверам</a>
        <button type="button" class="secondary" onclick="logout()">Logout</button>
      </div>

      <div class="server-head">
        ${iconHtml}
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
  } catch (error) {
    manageView.innerHTML = `
      <div class="card error">
        Ошибка загрузки: ${escapeHtml(error.message || String(error))}
      </div>
      <div class="actions">
        <a class="button secondary" href="./">Назад</a>
      </div>
    `;
  }
}

window.logout = logout;

initManage();
