// ====== CONFIG ======
// ВСТАВЬ СЮДА:
const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_ANON_KEY = "PASTE_YOUR_SUPABASE_ANON_PUBLIC_KEY_HERE";

// Discord Bot Client ID (чтобы делать Invite ссылку)
const DISCORD_BOT_CLIENT_ID = "1473237338460127382";
// Права при инвайте (минимум + можно поменять позже)
const DISCORD_INVITE_PERMS = "268823632";

// =====================
const { createClient } = window.supabase;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const view = document.getElementById("view");
const userBox = document.getElementById("userBox");
const avatarEl = document.getElementById("avatar");
const usernameEl = document.getElementById("username");
const useridEl = document.getElementById("userid");
const logoutBtn = document.getElementById("logoutBtn");

logoutBtn.onclick = async () => {
  await supabase.auth.signOut();
  location.hash = "";
  render();
};

function esc(s){ return (s ?? "").toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function inviteUrl(guildId){
  const base = new URL("https://discord.com/oauth2/authorize");
  base.searchParams.set("client_id", DISCORD_BOT_CLIENT_ID);
  base.searchParams.set("scope", "bot applications.commands");
  base.searchParams.set("permissions", DISCORD_INVITE_PERMS);
  base.searchParams.set("guild_id", guildId);
  base.searchParams.set("disable_guild_select", "true");
  return base.toString();
}

async function getSession(){
  const { data } = await supabase.auth.getSession();
  return data.session;
}

async function loginWithDiscord(){
  // Важно: redirectTo должен совпадать с тем, что добавлен в Supabase Redirect URLs
  const redirectTo = `${location.origin}${location.pathname}`;
  await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo }
  });
}

function parseRoute(){
  const h = (location.hash || "").replace(/^#/, "");
  const parts = h.split("/").filter(Boolean);
  // #/server/<id>
  if (parts[0] === "server" && parts[1]) return { name:"server", guildId: parts[1] };
  return { name:"home" };
}

async function loadMe(session){
  // user metadata обычно хранит username/avatar
  const u = session.user;
  const meta = u.user_metadata || {};
  const uname = meta.full_name || meta.name || meta.user_name || meta.preferred_username || "User";
  const avatar = meta.avatar_url || "";
  return { id: u.id, uname, avatar };
}

async function fetchUserGuilds(session){
  // Тянем гильдии через Discord API, используя provider token Supabase
  const token = session.provider_token;
  if (!token) throw new Error("No provider_token from Discord. Re-login.");

  const res = await fetch("https://discord.com/api/users/@me/guilds", {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error("Discord /users/@me/guilds failed");
  const guilds = await res.json();

  // Оставим только те, где owner или есть Manage Guild (0x20)
  const MANAGE_GUILD = 0x20;
  return guilds.filter(g => g.owner || ((g.permissions & MANAGE_GUILD) === MANAGE_GUILD));
}

async function fetchBotGuildIds(){
  const { data, error } = await supabase
    .from("bot_guilds")
    .select("guild_id");
  if (error) throw error;
  return new Set((data || []).map(x => x.guild_id));
}

async function isGuildAdmin(guildId, userId){
  const { data, error } = await supabase
    .from("guild_admins")
    .select("guild_id")
    .eq("guild_id", guildId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function loadRules(guildId){
  const { data, error } = await supabase
    .from("guild_rules")
    .select("rules_md, updated_at")
    .eq("guild_id", guildId)
    .maybeSingle();
  if (error) throw error;
  return data || { rules_md: "", updated_at: null };
}

async function saveRules(guildId, rulesMd){
  const { error } = await supabase
    .from("guild_rules")
    .upsert({ guild_id: guildId, rules_md: rulesMd, updated_at: new Date().toISOString() });
  if (error) throw error;
}

function renderLogin(){
  view.innerHTML = `
    <div class="h1">Lunaria Fox</div>
    <div class="p">Войди через Discord, чтобы увидеть сервера и управлять настройками.</div>
    <div class="hr"></div>
    <div class="row">
      <button class="btn" id="loginBtn">Login with Discord</button>
    </div>
    <div class="smallnote">Если застряло на “Авторизация…”, просто обнови страницу.</div>
  `;
  document.getElementById("loginBtn").onclick = loginWithDiscord;
}

async function renderHome(session){
  const me = await loadMe(session);

  userBox.classList.remove("hidden");
  usernameEl.textContent = `Ты вошла как ${me.uname}`;
  useridEl.textContent = `User ID: ${me.id}`;
  avatarEl.src = me.avatar || "https://cdn.discordapp.com/embed/avatars/0.png";

  view.innerHTML = `
    <div class="h1">Гильдии</div>
    <div class="p">Только те, где ты owner или у тебя есть <b>Manage Server</b>.</div>
    <div class="list" id="glist"></div>
  `;

  const [guilds, botGuildIds] = await Promise.all([
    fetchUserGuilds(session),
    fetchBotGuildIds()
  ]);

  const glist = document.getElementById("glist");
  glist.innerHTML = "";

  for (const g of guilds){
    const hasBot = botGuildIds.has(g.id);

    const iconUrl = g.icon
      ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=96`
      : "";

    const btn = hasBot
      ? `<button class="btn ok small" data-act="manage" data-id="${esc(g.id)}">Manage</button>`
      : `<a class="btn warn small" href="${inviteUrl(g.id)}" target="_blank" rel="noopener">Invite</a>`;

    glist.insertAdjacentHTML("beforeend", `
      <div class="guild">
        <div class="gleft">
          <div class="gicon">${iconUrl ? `<img src="${iconUrl}" alt="">` : "🌙"}</div>
          <div style="min-width:0">
            <div class="gname">${esc(g.name)}</div>
            <div class="gmeta">ID: ${esc(g.id)}</div>
          </div>
        </div>
        <div class="row">
          ${g.owner ? `<span class="badge">Owner</span>` : `<span class="badge">Manage</span>`}
          ${btn}
        </div>
      </div>
    `);
  }

  glist.querySelectorAll("[data-act='manage']").forEach(btn => {
    btn.onclick = () => {
      const id = btn.getAttribute("data-id");
      location.hash = `#/server/${id}`;
    };
  });
}

async function renderServer(session, guildId){
  const me = await loadMe(session);

  userBox.classList.remove("hidden");
  usernameEl.textContent = `Ты вошла как ${me.uname}`;
  useridEl.textContent = `User ID: ${me.id}`;
  avatarEl.src = me.avatar || "https://cdn.discordapp.com/embed/avatars/0.png";

  const admin = await isGuildAdmin(guildId, me.id);

  view.innerHTML = `
    <div class="row" style="justify-content:space-between">
      <div>
        <div class="h1">Сервер</div>
        <div class="p">Guild ID: <b>${esc(guildId)}</b></div>
      </div>
      <button class="btn ghost small" id="backBtn">← Назад</button>
    </div>

    <div class="tabs">
      <button class="tab active" data-tab="rules">Rules</button>
      <button class="tab" data-tab="logs">Logs</button>
      <button class="tab" data-tab="settings">Settings</button>
    </div>

    <div class="hr"></div>
    <div id="tabView"></div>
  `;

  document.getElementById("backBtn").onclick = () => location.hash = "";

  const tabView = document.getElementById("tabView");
  const tabs = Array.from(view.querySelectorAll(".tab"));

  const showTab = async (name) => {
    tabs.forEach(t => t.classList.toggle("active", t.dataset.tab === name));

    if (name === "rules"){
      const r = await loadRules(guildId);
      tabView.innerHTML = `
        <div class="h1">Rules</div>
        <div class="p">Правила в Markdown/тексте. Бот потом будет их читать и использовать в мод-консоли.</div>
        <div class="hr"></div>
        <textarea id="rulesBox" ${admin ? "" : "disabled"} placeholder="Например:
1) Запрещены оскорбления
2) Запрещён спам
3) ...">${esc(r.rules_md)}</textarea>
        <div class="row" style="margin-top:10px; justify-content:space-between">
          <div class="smallnote">${admin ? "Ты можешь редактировать (ты в guild_admins)." : "Редактирование закрыто: добавь себя в guild_admins для этого guild_id."}</div>
          <button class="btn small" id="saveRulesBtn" ${admin ? "" : "disabled"}>Сохранить</button>
        </div>
      `;
      if (admin){
        document.getElementById("saveRulesBtn").onclick = async () => {
          const text = document.getElementById("rulesBox").value;
          document.getElementById("saveRulesBtn").textContent = "Сохраняю...";
          try{
            await saveRules(guildId, text);
            document.getElementById("saveRulesBtn").textContent = "Сохранено ✅";
            setTimeout(()=>document.getElementById("saveRulesBtn").textContent="Сохранить", 900);
          }catch(e){
            alert("Ошибка сохранения rules: " + (e.message || e));
            document.getElementById("saveRulesBtn").textContent = "Сохранить";
          }
        };
      }
      return;
    }

    if (name === "logs"){
      tabView.innerHTML = `
        <div class="h1">Logs</div>
        <div class="p">Следующим шагом сделаем категории + фильтры (Moderation / Appeals / Blacklist / System).</div>
        <div class="hr"></div>
        <div class="p">Пока тут заглушка.</div>
      `;
      return;
    }

    if (name === "settings"){
      tabView.innerHTML = `
        <div class="h1">Settings</div>
        <div class="p">Позже: включатели модулей, каналы логов, роли модерации и т.д.</div>
        <div class="hr"></div>
        <div class="p">Пока тут заглушка.</div>
      `;
      return;
    }
  };

  tabs.forEach(t => t.onclick = () => showTab(t.dataset.tab));
  await showTab("rules");
}

async function render(){
  const session = await getSession();
  const route = parseRoute();

  if (!session){
    userBox.classList.add("hidden");
    renderLogin();
    return;
  }

  try{
    if (route.name === "server"){
      await renderServer(session, route.guildId);
    } else {
      await renderHome(session);
    }
  }catch(e){
    console.error(e);
    view.innerHTML = `
      <div class="h1">Ошибка</div>
      <div class="p">${esc(e.message || e)}</div>
      <div class="hr"></div>
      <button class="btn ghost small" id="retryBtn">Перезагрузить</button>
    `;
    document.getElementById("retryBtn").onclick = () => location.reload();
  }
}

window.addEventListener("hashchange", render);
render();
