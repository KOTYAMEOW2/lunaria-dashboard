// Lunaria Fox Dashboard — Cloudflare Workers/Pages friendly (no build)
// Uses Supabase Auth (Discord provider) + reads guilds from Discord API in the browser.
//
// IMPORTANT:
// - Keep ONLY publishable/anon key here (НЕ service_role).
// - Redirect URLs must include your deployed origin + /auth/callback in Supabase Auth settings.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // we handle callback explicitly
  },
});

const el = (id) => document.getElementById(id);

const noticeEl = el("notice");
const authView = el("authView");
const appView = el("appView");
const btnLogin = el("btnLogin");
const btnLogout = el("btnLogout");
const guildsEl = el("guilds");

function showNotice(type, text) {
  noticeEl.classList.remove("hidden","ok","bad");
  noticeEl.classList.add(type === "bad" ? "bad" : "ok");
  noticeEl.textContent = text;
}

function clearNotice() {
  noticeEl.classList.add("hidden");
  noticeEl.textContent = "";
  noticeEl.classList.remove("ok","bad");
}

function setView(isAuthed) {
  authView.classList.toggle("hidden", isAuthed);
  appView.classList.toggle("hidden", !isAuthed);
}

function guildIconUrl(guild) {
  if (guild.icon) {
    return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=96`;
  }
  return "";
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function renderGuilds(items) {
  if (!items || items.length === 0) {
    guildsEl.innerHTML = '<div class="skeleton">Не нашла гильдий с правами управления. Проверь, что ты owner или у тебя Manage Server.</div>';
    return;
  }
  guildsEl.innerHTML = items.map(g => {
    const icon = guildIconUrl(g);
    const badge = g.owner
      ? '<span class="badge good">Owner</span>'
      : '<span class="badge warn">Manage Server</span>';
    return `
      <div class="guild">
        <div class="guildLeft">
          <div class="guildIcon" style="${icon ? `background-image:url('${icon}')` : ""}"></div>
          <div>
            <div class="guildName">${escapeHtml(g.name)}</div>
            <div class="guildMeta">ID: ${g.id}</div>
          </div>
        </div>
        ${badge}
      </div>
    `;
  }).join("");
}

async function handleCallbackIfNeeded() {
  // Support both /auth/callback and /auth/callback/
  const p = window.location.pathname.replace(/\/+$/,"");
  if (p !== "/auth/callback") return false;

  clearNotice();
  try {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");
    const errorDesc = url.searchParams.get("error_description");

    if (error) {
      showNotice("bad", `OAuth error: ${errorDesc || error}`);
      return true;
    }

    if (!code) {
      showNotice("bad", "Callback открыт без параметра code. Проверь Redirect URLs в Supabase.");
      return true;
    }

    const { error: exErr } = await supabase.auth.exchangeCodeForSession(window.location.href);
    if (exErr) throw exErr;

    // clean URL
    window.history.replaceState({}, "", "/");
    showNotice("ok", "Готово! Вход выполнен.");
    return true;
  } catch (e) {
    console.error(e);
    showNotice("bad", `Не смогла завершить вход: ${e?.message || e}`);
    return true;
  }
}

async function login() {
  clearNotice();
  const redirectTo = `${window.location.origin}/auth/callback`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: {
      redirectTo,
      // Need guilds scope to read /users/@me/guilds in browser
      scopes: "identify guilds",
    },
  });
  if (error) {
    showNotice("bad", error.message);
  }
}

async function logout() {
  clearNotice();
  const { error } = await supabase.auth.signOut();
  if (error) showNotice("bad", error.message);
}

function hasManageGuild(permissions) {
  // Discord "Manage Guild" = 0x20 (32)
  const p = Number(permissions || 0);
  return (p & 0x20) === 0x20;
}

async function loadDiscordGuilds(session) {
  const token = session?.provider_token;
  if (!token) {
    renderGuilds([]);
    showNotice("bad", "Нет provider_token. Перелогинься и проверь, что у Discord scope включает 'guilds'.");
    return;
  }

  guildsEl.innerHTML = '<div class="skeleton">Загружаю…</div>';

  try {
    const res = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Discord API error (${res.status}): ${txt}`);
    }

    const guilds = await res.json();

    const manageable = (guilds || []).filter(g => g?.owner || hasManageGuild(g?.permissions));
    manageable.sort((a,b) => (a.owner === b.owner) ? a.name.localeCompare(b.name) : (a.owner ? -1 : 1));

    renderGuilds(manageable);
  } catch (e) {
    console.error(e);
    renderGuilds([]);
    showNotice("bad", `Не смогла получить гильдии: ${e?.message || e}`);
  }
}

async function render() {
  await handleCallbackIfNeeded();

  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    setView(false);
    return;
  }

  setView(true);

  // show user info
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;

    const user = data?.user;
    const md = user?.user_metadata || {};
    const name = md?.full_name || md?.name || user?.email || user?.id || "—";
    el("meName").textContent = name;
    el("meId").textContent = user?.id ? `User ID: ${user.id}` : "—";

    const avatarUrl = md?.avatar_url || "";
    if (avatarUrl) {
      el("meAvatar").style.backgroundImage = `url('${avatarUrl}')`;
    }
  } catch (e) {
    console.error(e);
  }

  await loadDiscordGuilds(session);
}

btnLogin?.addEventListener("click", login);
btnLogout?.addEventListener("click", logout);

supabase.auth.onAuthStateChange(() => {
  render();
});

render();
