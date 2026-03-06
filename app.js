const view = document.getElementById("view");

function show(msg) {
  if (!view) return;
  view.innerHTML += `<div style="margin-top:10px; padding:10px; border-radius:10px; background:#241b42; white-space:pre-wrap;">${msg}</div>`;
}

function esc(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

try {
  show("app.js загружен");
} catch (e) {
  console.error(e);
}

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";

show("SUPABASE_URL: " + esc(SUPABASE_URL));

if (!window.supabase) {
  show("ОШИБКА: window.supabase не найден. Значит не загрузился CDN script supabase-js.");
  throw new Error("Supabase CDN not loaded");
}

show("window.supabase найден");

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
show("Supabase client создан");

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
  show("login() вызван");
  await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: {
      scopes: "identify guilds",
      redirectTo: "https://lunaria-dashboard.lunaria-fox.workers.dev/auth/callback/"
    }
  });
}

async function logout() {
  await supabase.auth.signOut();
  location.href = "/";
}

window.login = login;
window.logout = logout;

async function init() {
  try {
    show("init() стартовал");

    const result = await supabase.auth.getSession();
    show("getSession() выполнен");

    const session = result?.data?.session;
    const error = result?.error;

    if (error) {
      show("ОШИБКА getSession(): " + esc(error.message));
      return;
    }

    if (!session) {
      view.innerHTML = `
        <h2>Добро пожаловать</h2>
        <p class="muted">Сессии нет. Это нормально, если ты ещё не логинилась.</p>
        <div class="actions">
          <button onclick="login()">Login with Discord</button>
        </div>
      `;
      return;
    }

    const user = session.user;
    const discordId = getDiscordId(user);

    view.innerHTML = `
      <h2>Debug info</h2>
      <p><b>Сессия найдена</b></p>
      <p><b>Discord ID:</b> ${esc(discordId || "не найден")}</p>

      <div class="actions">
        <button class="secondary" onclick="logout()">Выйти</button>
      </div>

      <div class="card">
        <h3>user_metadata</h3>
        <pre style="white-space:pre-wrap; overflow:auto;">${esc(JSON.stringify(user?.user_metadata, null, 2))}</pre>
      </div>

      <div class="card">
        <h3>app_metadata</h3>
        <pre style="white-space:pre-wrap; overflow:auto;">${esc(JSON.stringify(user?.app_metadata, null, 2))}</pre>
      </div>

      <div class="card">
        <h3>identities</h3>
        <pre style="white-space:pre-wrap; overflow:auto;">${esc(JSON.stringify(user?.identities, null, 2))}</pre>
      </div>
    `;
  } catch (e) {
    show("FATAL ERROR: " + esc(e?.message || String(e)));
    console.error(e);
  }
}

init();
