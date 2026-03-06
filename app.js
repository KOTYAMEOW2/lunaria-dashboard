const view = document.getElementById("view");

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

async function login() {
  await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: {
      scopes: "identify guilds",
      redirectTo: `${location.origin}/auth/callback/`
    }
  });
}

async function logout() {
  await supabase.auth.signOut();
  location.href = "/";
}

async function loadManageableGuilds(discordId) {
  const { data: adminRows, error: adminError } = await supabase
    .from("guild_admins")
    .select("guild_id")
    .eq("user_id", discordId);

  if (adminError) {
    throw new Error("Ошибка guild_admins: " + adminError.message);
  }

  const guildIds = [...new Set((adminRows || []).map(x => x.guild_id))];

  if (!guildIds.length) {
    return [];
  }

  const { data: guilds, error: guildError } = await supabase
    .from("bot_guilds")
    .select("*")
    .in("guild_id", guildIds);

  if (guildError) {
    throw new Error("Ошибка bot_guilds: " + guildError.message);
  }

  return guilds || [];
}

function renderLoggedOut() {
  view.innerHTML = `
    <h2>Добро пожаловать</h2>
    <p class="muted">Войди через Discord, чтобы открыть список доступных серверов.</p>
    <div class="actions">
      <button onclick="login()">Login with Discord</button>
    </div>
  `;
}

function renderNoAccess(user, discordId) {
  view.innerHTML = `
    <h2>Ты вошла через Discord</h2>
    <p><b>${escapeHtml(user?.user_metadata?.full_name || user?.email || "Пользователь")}</b></p>
    <p class="small">Discord ID: ${escapeHtml(discordId || "не найден")}</p>

    <div class="actions">
      <button class="secondary" onclick="logout()">Выйти</button>
    </div>

    <div class="card">
      <h3>Серверы</h3>
      <p>У тебя пока нет серверов в панели.</p>
      <p class="small">Проверь, есть ли запись в таблице <b>guild_admins</b> для твоего Discord ID.</p>
    </div>
  `;
}

function renderGuilds(user, discordId, guilds) {
  view.innerHTML = `
    <h2>Ты вошла через Discord</h2>
    <p><b>${escapeHtml(user?.user_metadata?.full_name || user?.email || "Пользователь")}</b></p>
    <p class="small">Discord ID: ${escapeHtml(discordId || "не найден")}</p>

    <div class="actions">
      <button class="secondary" onclick="logout()">Выйти</button>
    </div>

    <h3>Серверы</h3>
    <div class="card-list">
      ${guilds.map(g => `
        <div class="card">
          <h3>${escapeHtml(g.name || g.guild_name || "Server")}</h3>
          <p>ID: ${escapeHtml(g.guild_id)}</p>
          <div class="actions">
            <a class="btn" href="./manage.html?guild=${encodeURIComponent(g.guild_id)}">Manage</a>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

async function init() {
  try {
    view.innerHTML = `<p>Проверка авторизации...</p>`;

    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
      view.innerHTML = `<p class="error">Ошибка Supabase: ${escapeHtml(error.message)}</p>`;
      return;
    }

    if (!session) {
      renderLoggedOut();
      return;
    }

    const user = session.user;
    const discordId = getDiscordId(user);

    if (!discordId) {
      view.innerHTML = `
        <h2>Авторизация прошла, но Discord ID не найден</h2>
        <p class="small">Нужно проверить, какие поля Supabase вернул после Discord OAuth.</p>
        <div class="actions">
          <button class="secondary" onclick="logout()">Выйти</button>
        </div>
      `;
      console.log("SESSION_USER", user);
      return;
    }

    const guilds = await loadManageableGuilds(discordId);

    if (!guilds.length) {
      renderNoAccess(user, discordId);
      return;
    }

    renderGuilds(user, discordId, guilds);
  } catch (e) {
    view.innerHTML = `<p class="error">Ошибка JS: ${escapeHtml(e.message || String(e))}</p>`;
    console.error(e);
  }
}

window.login = login;
window.logout = logout;

init();
