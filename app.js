// app.js (Supabase JS v2 + Discord OAuth)
// ВСТАВЬ СЮДА СВОИ ДАННЫЕ:
const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";

// Создаём клиент (UMD сборка даёт глобальный объект `supabase`)
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const view = document.getElementById("view");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[m]));
}

function setView(html) {
  view.innerHTML = html;
}

function uiLoading(text = "Авторизация...") {
  setView(`<div style="padding:16px;opacity:.9">${escapeHtml(text)}</div>`);
}

function uiError(err) {
  const msg = (err && (err.message || err.error_description || err.error)) ? (err.message || err.error_description || err.error) : String(err);
  setView(`
    <div style="padding:16px;border:1px solid rgba(255,80,120,.35);border-radius:14px;background:rgba(255,80,120,.06)">
      <div style="font-weight:700;margin-bottom:6px">Ошибка</div>
      <div style="white-space:pre-wrap;opacity:.9">${escapeHtml(msg)}</div>
    </div>
    <div style="height:12px"></div>
    <button id="btnLogin" class="btn">Login with Discord</button>
  `);
  const btn = document.getElementById("btnLogin");
  if (btn) btn.onclick = login;
}

function uiLoggedOut() {
  setView(`
    <div style="padding:6px 0 14px 0;opacity:.9">
      Войди через Discord, чтобы увидеть сервера и управлять настройками.
    </div>
    <button id="btnLogin" class="btn">Login with Discord</button>
  `);
  document.getElementById("btnLogin").onclick = login;
}

function uiLoggedIn(session) {
  const user = session.user;
  const name = user.user_metadata?.full_name || user.user_metadata?.name || user.user_metadata?.preferred_username || user.email || user.id;
  setView(`
    <div style="display:flex;gap:12px;align-items:center">
      <div style="flex:1">
        <div style="font-weight:800;font-size:18px">Ты вошла как ${escapeHtml(name)}</div>
        <div style="opacity:.8;font-size:12px;margin-top:4px">User ID: ${escapeHtml(user.id)}</div>
      </div>
      <button id="btnLogout" class="btn btn-ghost">Выйти</button>
    </div>
    <div style="height:14px"></div>
    <div style="opacity:.85">Дальше подключим получение гильдий/прав и таблицы правил.</div>
  `);

  document.getElementById("btnLogout").onclick = async () => {
    uiLoading("Выход...");
    await sb.auth.signOut();
    uiLoggedOut();
  };
}

async function login() {
  uiLoading("Открываю Discord...");
  const redirectTo = window.location.origin; // важно: без /auth/callback, просто корень сайта

  const { error } = await sb.auth.signInWithOAuth({
    provider: "discord",
    options: {
      redirectTo,
      // scopes обычно не нужно указывать — Supabase сам настроит,
      // но если надо — можно раскомментить:
      // scopes: "identify guilds"
    },
  });

  if (error) uiError(error);
}

// Главная инициализация: ловим `?code=...` после Discord (PKCE code flow)
async function init() {
  try {
    uiLoading("Проверяю сессию...");

    const url = new URL(window.location.href);

    // Если Supabase вернул код авторизации — меняем его на сессию
    if (url.searchParams.get("code")) {
      uiLoading("Завершаю авторизацию...");
      const { data, error } = await sb.auth.exchangeCodeForSession(window.location.href);
      if (error) throw error;

      // Чистим URL от ?code=...
      window.history.replaceState({}, document.title, window.location.origin);

      const session = data?.session;
      if (session) uiLoggedIn(session);
      else uiLoggedOut();
      return;
    }

    // Обычная проверка текущей сессии
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;

    if (data?.session) uiLoggedIn(data.session);
    else uiLoggedOut();
  } catch (e) {
    uiError(e);
  }
}

init();
