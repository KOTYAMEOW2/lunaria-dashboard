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

function getGuildIconUrl(guildId, icon) {
  if (!guildId || !icon) return "";
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=128`;
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
    .select("guild_id, role")
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
    .select("guild_id, name, icon, updated_at")
    .in("guild_id", guildIds)
    .order("updated_at", { ascending: false });

  if (guildError) {
    throw new Error("Ошибка bot_guilds: " + guildError.message);
  }

  const roleMap = new Map((adminRows || []).map(row => [row.guild_id, row.role || "admin"]));

  return (guilds || []).map(guild => ({
    ...guild,
    role: roleMap.get(guild.guild_id) || "admin"
  }));
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
      <p>Для этого аккаунта пока нет доступных серверов.</p>
      <p class="small">Нужно добавить запись в <b>guild_admins</b> с твоим Discord ID и нужным <b>guild_id</b>.</p>
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
          <div style="display:flex; gap:14px; align-items:center;">
            ${
              g.icon
                ? `<img src="${getGuildIconUrl(g.guild_id, g.icon)}" alt="${escapeHtml(g.name)}" style="width:56px; height:56px; border-radius:14px; object-fit:cover;">`
                : `<div style="width:56px; height:56px; border-radius:14px; background:#33285e; display:flex; align-items:center; justify-content:center; font-weight:bold;">LF</div>`
            }

            <div>
              <h3 style="margin:0 0 6px;">${escapeHtml(g.name || "Server")}</h3>
              <p class="small">Guild ID: ${escapeHtml(g.guild_id)}</p>
              <p class="small">Role: ${escapeHtml(g.role || "admin")}</p>
            </div>
          </div>

          <div class="actions" style="margin-top:14px;">
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
        <p class="small">Нужно посмотреть объект session.user в консоли.</p>
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
