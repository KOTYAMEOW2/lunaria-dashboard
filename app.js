// Lunaria Dashboard (single-page static) — stable guilds list
// - Uses Supabase Auth (Discord provider)
// - Fetches Discord guilds ONCE with cache + 429 retry
// - Uses Supabase table public.bot_guilds to decide Invite vs Manage (no bot token in browser)

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";
const BOT_CLIENT_ID = "1473237338460127382";

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

function sb() {
  if (!window.supabase) throw new Error("Supabase JS (UMD) не загрузился.");
  return window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function renderLogin(errText) {
  userBox.classList.add("hidden");
  view.innerHTML = `
    <div class="h1">Lunaria Fox</div>
    <div class="p">Войди через Discord, чтобы увидеть сервера и управлять настройками.</div>
    <div class="row" style="margin-top:12px">
      <button class="btn" id="loginBtn">Login with Discord</button>
    </div>
    <div class="note">Если Discord ограничит запросы — мы подождём и повторим автоматически.</div>
    ${errText ? `<div class="err">${esc(errText)}</div>` : ``}
  `;
  document.getElementById("loginBtn").onclick = async () => {
    try {
      const supabase = sb();
      const redirectTo = location.origin + location.pathname; // same page
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "discord",
        options: { redirectTo, scopes: "identify guilds" }
      });
      if (error) renderLogin(error.message || String(error));
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

function parsePerms(p) {
  const n = typeof p === "string" ? parseInt(p,10) : Number(p||0);
  return Number.isFinite(n) ? n : 0;
}
function canManage(g) {
  if (g.owner) return true;
  const perms = parsePerms(g.permissions);
  return (perms & ADMINISTRATOR) === ADMINISTRATOR || (perms & MANAGE_GUILD) === MANAGE_GUILD;
}

// ---- Discord fetch with 429 retry + cache
const CACHE_KEY = "lunaria_guilds_cache_v4";
const CACHE_TTL = 60_000;
let inFlightGuilds = null;

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

async function discordFetchWithRetry(path, token, tries=6) {
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
      if (ra && !Number.isNaN(Number(ra))) waitMs = Math.max(waitMs, Math.ceil(Number(ra)*1000));
      waitMs += 250;
      await sleep(waitMs);
      continue;
    }

    const txt = await res.text().catch(()=> "");
    throw new Error(`Discord API error ${res.status}: ${txt || res.statusText}`);
  }
  throw new Error("Discord API rate limit: слишком много 429 подряд.");
}

async function fetchGuilds(token) {
  const cached = readCache();
  if (cached) return cached;
  if (inFlightGuilds) return inFlightGuilds;

  inFlightGuilds = (async () => {
    const res = await discordFetchWithRetry("/users/@me/guilds", token, 6);
    const data = await res.json();
    writeCache(data);
    return data;
  })();

  try { return await inFlightGuilds; }
  finally { inFlightGuilds = null; }
}

function inviteUrl() {
  const redirect = encodeURIComponent(location.href);
  return `https://discord.com/api/oauth2/authorize?client_id=${BOT_CLIENT_ID}&permissions=8&scope=bot%20applications.commands&redirect_uri=${redirect}`;
}

async function fetchBotGuildIds(supabase) {
  // table: public.bot_guilds (guild_id text)
  const { data, error } = await supabase.from("bot_guilds").select("guild_id");
  if (error) throw error;
  const set = new Set((data || []).map(r => r.guild_id));
  return set;
}

async function renderDashboard(session) {
  setUserBox(session);

  const token = session.provider_token;
  if (!token) {
    renderLogin("Нет provider_token. Выйди и зайди снова через Discord.");
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
    const supabase = sb();

    // Fetch both in parallel
    const [guilds, botGuildIds] = await Promise.all([
      fetchGuilds(token),
      fetchBotGuildIds(supabase),
    ]);

    const manageable = (guilds || []).filter(canManage).sort((a,b)=> (a.name||"").localeCompare(b.name||""));

    if (!manageable.length) {
      glist.innerHTML = `<div class="p">Не нашла гильдий с правами управления.</div>`;
      note.textContent = "";
      return;
    }

    glist.innerHTML = manageable.map(g => {
      const iconUrl = g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=96` : "";
      const hasBot = botGuildIds.has(g.id);

      return `
        <div class="guild">
          <div class="gleft">
            <div class="gicon">${iconUrl ? `<img src="${iconUrl}" alt="">` : "🌙"}</div>
            <div style="min-width:0">
              <div class="gname">${esc(g.name)}</div>
              <div class="gmeta">ID: ${esc(g.id)}</div>
            </div>
          </div>

          <div class="split">
            ${hasBot
              ? `<a class="btn small ok" href="#/guild/${g.id}">Manage</a>`
              : `<a class="btn small warn" href="${inviteUrl()}" target="_blank" rel="noopener">Invite</a>`
            }
            <span class="badge">${g.owner ? "Owner" : "Manage"}</span>
          </div>
        </div>
      `;
    }).join("");

    note.textContent = "Invite показывается, если guild_id нет в bot_guilds. Бот должен синкать таблицу при старте.";
  } catch (e) {
    note.textContent = "";
    glist.innerHTML = `<div class="err">${esc(e.message || String(e))}</div>`;
  }
}

async function handleCallbackIfAny(supabase) {
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  if (code) {
    view.innerHTML = `<div class="h1">Авторизация…</div><div class="p">Обмен кода на сессию…</div>`;
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    url.searchParams.delete("code");
    history.replaceState({}, document.title, url.pathname + url.search + url.hash);
  }
}

async function boot() {
  let supabase;
  try {
    supabase = sb();
  } catch (e) {
    renderLogin(e.message || String(e));
    return;
  }

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
    return;
  }

  await renderDashboard(session);

  supabase.auth.onAuthStateChange(async (_event, newSession) => {
    if (!newSession) renderLogin();
    else await renderDashboard(newSession);
  });
}

boot();
