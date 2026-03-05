// Lunaria Fox Dashboard (static) — single-page callback (no /auth/callback needed)
// Fixes: "login button does nothing", PKCE code flow, hash flow, Discord 429 retry, short caching.

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd"; // publishable key

const DISCORD_API = "https://discord.com/api/v10";
const MANAGE_GUILD = 0x20;
const ADMINISTRATOR = 0x8;

const view = document.getElementById("view");
const userBox = document.getElementById("userBox");
const avatarEl = document.getElementById("avatar");
const usernameEl = document.getElementById("username");
const useridEl = document.getElementById("userid");
const logoutBtn = document.getElementById("logoutBtn");

function esc(s) {
  return (s ?? "").toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function supa() {
  if (!window.supabase) throw new Error("Supabase JS не загрузился (CDN).");
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function parsePerms(p) {
  const n = typeof p === "string" ? parseInt(p, 10) : Number(p || 0);
  return Number.isFinite(n) ? n : 0;
}
function canManage(g) {
  if (g.owner) return true;
  const perms = parsePerms(g.permissions);
  return (perms & ADMINISTRATOR) === ADMINISTRATOR || (perms & MANAGE_GUILD) === MANAGE_GUILD;
}

// ---- Discord fetch with 429 retry + cache
const CACHE_KEY = "lunaria_guilds_cache_v3";
const CACHE_TTL = 60_000;
let inFlight = null;

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj?.ts || !obj?.data) return null;
    if (Date.now() - obj.ts > CACHE_TTL) return null;
    return obj.data;
  } catch { return null; }
}
function writeCache(data) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data })); } catch {}
}

async function discordFetchWithRetry(path, token, tries = 6) {
  let attempt = 0;
  while (attempt < tries) {
    attempt++;
    const res = await fetch(`${DISCORD_API}${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.ok) return res;

    if (res.status === 429) {
      let waitMs = 1200;
      try {
        const j = await res.clone().json();
        if (typeof j?.retry_after === "number") waitMs = Math.ceil(j.retry_after * 1000);
      } catch {}
      const ra = res.headers.get("Retry-After");
      if (ra && !Number.isNaN(Number(ra))) waitMs = Math.max(waitMs, Math.ceil(Number(ra) * 1000));
      waitMs += 250;
      await sleep(waitMs);
      continue;
    }

    const txt = await res.text().catch(() => "");
    throw new Error(`Discord API error ${res.status}: ${txt || res.statusText}`);
  }
  throw new Error("Discord API rate limit: слишком много 429 подряд.");
}

async function fetchGuilds(token) {
  const cached = readCache();
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    const res = await discordFetchWithRetry("/users/@me/guilds", token, 6);
    const data = await res.json();
    writeCache(data);
    return data;
  })();

  try { return await inFlight; }
  finally { inFlight = null; }
}

// ---- UI
function renderLogin(errText) {
  userBox.classList.add("hidden");
  view.innerHTML = `
    <div class="h1">Lunaria Fox</div>
    <div class="p">Войди через Discord, чтобы увидеть сервера и управлять настройками.</div>
    <div class="row" style="margin-top:12px">
      <button class="btn" id="loginBtn">Login with Discord</button>
    </div>
    <div class="note">Если Discord открылся и вернул обратно — мы автоматически сохраним сессию.</div>
    ${errText ? `<div class="err">${esc(errText)}</div>` : ``}
  `;

  document.getElementById("loginBtn").onclick = async () => {
    try {
      const supabase = supa();
      const redirectTo = location.origin + location.pathname; // same page (no folders needed)
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "discord",
        options: {
          redirectTo,
          scopes: "identify guilds"
        }
      });
      if (error) renderLogin("Login error: " + (error.message || error));
    } catch (e) {
      renderLogin(e.message || String(e));
    }
  };
}

function setUserBox(session) {
  const u = session.user;
  const meta = u.user_metadata || {};
  const uname = meta.full_name || meta.name || meta.user_name || meta.preferred_username || "User";
  const avatar = meta.avatar_url || "https://cdn.discordapp.com/embed/avatars/0.png";

  userBox.classList.remove("hidden");
  usernameEl.textContent = `Ты вошла как ${uname}`;
  useridEl.textContent = `User ID: ${u.id}`;
  avatarEl.src = avatar;
}

async function renderDashboard(session) {
  setUserBox(session);

  const token = session.provider_token;
  if (!token) {
    renderLogin("Нет provider_token. Нажми 'Выйти' и зайди снова.");
    return;
  }

  view.innerHTML = `
    <div class="h1">Гильдии</div>
    <div class="p">Показываю только те, где ты owner или у тебя есть Manage Server.</div>
    <div class="list" id="glist"></div>
    <div class="note" id="note"></div>
  `;

  const glist = document.getElementById("glist");
  const note = document.getElementById("note");

  try {
    const guilds = await fetchGuilds(token);
    const manageable = (guilds || []).filter(canManage).sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    if (!manageable.length) {
      glist.innerHTML = `<div class="p">Не нашла гильдий с правами управления.</div>`;
      note.textContent = "";
      return;
    }

    glist.innerHTML = manageable.map(g => {
      const iconUrl = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=96` : "";
      return `
        <div class="guild">
          <div class="gleft">
            <div class="gicon">${iconUrl ? `<img src="${iconUrl}" alt="">` : "🌙"}</div>
            <div style="min-width:0">
              <div class="gname">${esc(g.name)}</div>
              <div class="gmeta">ID: ${esc(g.id)}</div>
            </div>
          </div>
          <span class="badge">${g.owner ? "Owner" : "Manage"}</span>
        </div>
      `;
    }).join("");

    note.textContent = "Если Discord ограничит запросы (429) — список автоматически подождёт и повторит.";
  } catch (e) {
    note.textContent = "";
    glist.innerHTML = `<div class="err">${esc(e.message || String(e))}</div>`;
  }
}

async function handleCallbackIfAny(supabase) {
  // PKCE: ?code=...
  const url = new URL(location.href);
  const code = url.searchParams.get("code");

  if (code) {
    view.innerHTML = `<div class="h1">Авторизация…</div><div class="p">Обмен кода на сессию…</div>`;
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    // очистим URL от code
    url.searchParams.delete("code");
    history.replaceState({}, document.title, url.pathname + url.search + url.hash);
    return;
  }

  // Implicit: #access_token=...
  if (location.hash && location.hash.includes("access_token")) {
    view.innerHTML = `<div class="h1">Авторизация…</div><div class="p">Сохранение сессии…</div>`;
    const { error } = await supabase.auth.getSessionFromUrl({ storeSession: true });
    if (error) throw error;
    history.replaceState({}, document.title, location.pathname);
  }
}

async function boot() {
  const supabase = supa();

  logoutBtn.onclick = async () => {
    await supabase.auth.signOut();
    renderLogin();
  };

  try {
    await handleCallbackIfAny(supabase);
  } catch (e) {
    renderLogin("Ошибка авторизации: " + (e.message || String(e)));
    return;
  }

  const { data } = await supabase.auth.getSession();
  const session = data?.session;

  if (!session) {
    renderLogin();
  } else {
    await renderDashboard(session);
  }

  supabase.auth.onAuthStateChange(async (_event, newSession) => {
    if (!newSession) renderLogin();
    else await renderDashboard(newSession);
  });
}

boot();
