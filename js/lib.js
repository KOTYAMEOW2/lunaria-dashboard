
const CONFIG = window.LUNARIA_CONFIG || {};

if (!CONFIG.SUPABASE_URL || !CONFIG.SUPABASE_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_KEY in config.js");
}
if (!window.supabase || typeof window.supabase.createClient !== "function") {
  throw new Error("Supabase CDN library is missing");
}

export const supabase = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);

export const NAV_ITEMS = [
  { href: "./overview.html", key: "overview", label: "Overview" },
  { href: "./settings.html", key: "settings", label: "Settings" },
  { href: "./commands.html", key: "commands", label: "Commands" },
  { href: "./custom-commands.html", key: "custom-commands", label: "Custom Commands" },
  { href: "./rules.html", key: "rules", label: "Rules" },
  { href: "./logs.html", key: "logs", label: "Logs" },
  { href: "./punishments.html", key: "punishments", label: "Punishments" },
  { href: "./tickets.html", key: "tickets", label: "Tickets" },
  { href: "./voicemaster.html", key: "voicemaster", label: "VoiceMaster" }
];

export function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function html(strings, ...values) {
  return strings.reduce((acc, str, i) => acc + str + (values[i] ?? ""), "");
}

export function parseList(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function uniq(arr) {
  return [...new Set((arr || []).map((x) => String(x).trim()).filter(Boolean))];
}

export function listText(arr) {
  return Array.isArray(arr) && arr.length ? arr.join(", ") : "—";
}

export function fmtDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(+d) ? "—" : d.toLocaleString();
}

export function getDiscordId(user) {
  if (!user) return null;
  if (Array.isArray(user.identities)) {
    for (const identity of user.identities) {
      if (identity && identity.provider === "discord" && identity.id) return identity.id;
    }
  }
  return user?.user_metadata?.provider_id
    || user?.user_metadata?.sub
    || user?.app_metadata?.provider_id
    || null;
}

export function getUserName(user) {
  return user?.user_metadata?.full_name
    || user?.user_metadata?.name
    || user?.email
    || "User";
}

export function guildIconUrl(guild) {
  if (!guild?.guild_id || !guild?.icon) return "";
  return `https://cdn.discordapp.com/icons/${encodeURIComponent(guild.guild_id)}/${encodeURIComponent(guild.icon)}.png?size=128`;
}

export async function signIn() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: {
      scopes: "identify guilds",
      redirectTo: CONFIG.REDIRECT_TO || window.location.origin + "/"
    }
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
  window.location.href = "./";
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data?.session || null;
}

export async function requireSession() {
  const session = await getSession();
  if (!session) {
    window.location.href = "./";
    return null;
  }
  return session;
}

export function getGuildIdFromUrl() {
  return new URL(window.location.href).searchParams.get("guild");
}

export async function getGuildContext() {
  const session = await requireSession();
  if (!session) return null;

  const discordId = getDiscordId(session.user);
  if (!discordId) throw new Error("Discord ID not found in session.");

  const guildId = getGuildIdFromUrl();
  if (!guildId) throw new Error("Guild ID is missing in URL.");

  const { data: admin, error: adminError } = await supabase
    .from("guild_admins")
    .select("guild_id,user_id,role,created_at")
    .eq("guild_id", guildId)
    .eq("user_id", discordId)
    .maybeSingle();
  if (adminError) throw new Error("guild_admins: " + adminError.message);
  if (!admin) throw new Error("You do not have access to this server.");

  const { data: guild, error: guildError } = await supabase
    .from("bot_guilds")
    .select("guild_id,name,icon,updated_at,member_count,owner_id")
    .eq("guild_id", guildId)
    .maybeSingle();
  if (guildError) throw new Error("bot_guilds: " + guildError.message);
  if (!guild) throw new Error("Guild not found in bot_guilds.");

  return { session, admin, guild, discordId };
}

export async function getAccessibleGuilds() {
  const session = await requireSession();
  if (!session) return [];
  const discordId = getDiscordId(session.user);
  if (!discordId) throw new Error("Discord ID not found.");

  const { data: adminRows, error: adminError } = await supabase
    .from("guild_admins")
    .select("guild_id,role")
    .eq("user_id", discordId);
  if (adminError) throw new Error("guild_admins: " + adminError.message);

  const guildIds = [...new Set((adminRows || []).map((x) => x.guild_id).filter(Boolean))];
  if (!guildIds.length) return [];

  const { data: guildRows, error: guildError } = await supabase
    .from("bot_guilds")
    .select("guild_id,name,icon,updated_at,member_count,owner_id")
    .in("guild_id", guildIds)
    .order("updated_at", { ascending: false });
  if (guildError) throw new Error("bot_guilds: " + guildError.message);

  const roleMap = Object.fromEntries((adminRows || []).map((x) => [x.guild_id, x.role || "admin"]));
  return (guildRows || []).map((row) => ({ ...row, role: roleMap[row.guild_id] || "admin" }));
}

export function page(title) {
  document.title = `${CONFIG.APP_NAME || "Lunaria Dashboard"} - ${title}`;
}

export function mount(el, htmlText) {
  el.innerHTML = htmlText;
}

export function renderSidebar(guild, activeKey) {
  const icon = guildIconUrl(guild);
  return html`
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-badge">${icon ? `<img src="${icon}" alt="" class="server-icon" style="width:44px;height:44px;border-radius:14px">` : "LF"}</div>
        <div>
          <h1>${esc(guild?.name || CONFIG.APP_NAME || "Lunaria Dashboard")}</h1>
          <p>${guild ? "Server control panel" : "Server control panel"}</p>
        </div>
      </div>
      <div class="nav-title">Navigation</div>
      <a class="nav-link" href="./">Servers</a>
      ${guild ? NAV_ITEMS.map((item) => `
        <a class="nav-link ${item.key === activeKey ? "active" : ""}" href="${item.href}?guild=${encodeURIComponent(guild.guild_id)}">${item.label}</a>
      `).join("") : ""}
    </aside>
  `;
}

export function shell(root, opts) {
  const { guild, active, title, subtitle, content } = opts;
  mount(root, html`
    <div class="container">
      <div class="app-shell">
        ${renderSidebar(guild, active)}
        <main class="content">
          <section class="hero">
            <h2>${esc(title || guild?.name || "Dashboard")}</h2>
            <p>${esc(subtitle || "")}</p>
          </section>
          ${content}
        </main>
      </div>
    </div>
  `);
}

export function loginShell(root, bodyHtml) {
  mount(root, html`
    <div class="login-shell">
      <div class="login-wrap">
        <div class="sidebar">
          <div class="brand">
            <div class="brand-badge">LF</div>
            <div>
              <h1>${esc(CONFIG.APP_NAME || "Lunaria Dashboard")}</h1>
              <p>Discord server control panel</p>
            </div>
          </div>
        </div>
        <main class="content">${bodyHtml}</main>
      </div>
    </div>
  `);
}

export function stat(label, value, tone="") {
  return html`<div class="stat"><div class="label">${esc(label)}</div><div class="value ${tone}">${esc(value)}</div></div>`;
}

export function createTokenField({ label, values = [], placeholder = "" }) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const labelEl = document.createElement("label");
  labelEl.textContent = label;
  const box = document.createElement("div");
  box.className = "token-box";
  const input = document.createElement("input");
  input.className = "token-input";
  input.placeholder = placeholder;

  let tokens = uniq(values);

  function render() {
    box.innerHTML = "";
    tokens.forEach((token, index) => {
      const chip = document.createElement("span");
      chip.className = "token";
      chip.textContent = token;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "×";
      btn.addEventListener("click", () => {
        tokens.splice(index, 1);
        render();
      });
      chip.appendChild(btn);
      box.appendChild(chip);
    });
    box.appendChild(input);
  }

  function commit(raw) {
    const next = uniq((raw || "").split(",").map((x) => x.trim()).filter(Boolean));
    if (!next.length) return;
    tokens = uniq([...tokens, ...next]);
    input.value = "";
    render();
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(input.value);
    }
    if (event.key === "Backspace" && !input.value && tokens.length) {
      tokens.pop();
      render();
    }
  });
  input.addEventListener("blur", () => {
    if (input.value.trim()) commit(input.value);
  });

  wrap.append(labelEl, box);
  render();

  return {
    element: wrap,
    getValue() { return uniq(tokens); },
    setValue(next) { tokens = uniq(next); render(); }
  };
}

export function searchFilter(items, query, fields) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return items.slice();
  return items.filter((item) =>
    fields.some((field) => String(item?.[field] || "").toLowerCase().includes(q))
  );
}

export function bindFormStatus(el) {
  return {
    set(text, kind="") {
      el.textContent = text || "";
      el.style.color =
        kind === "error" ? "#ff9bb0" :
        kind === "success" ? "#92f1bf" :
        kind === "warn" ? "#ffd983" : "";
    }
  };
}

export async function upsert(table, payload, onConflict) {
  const { error } = await supabase.from(table).upsert(payload, onConflict ? { onConflict } : undefined);
  if (error) throw new Error(`${table}: ${error.message}`);
}

export async function removeById(table, idField, idValue) {
  const { error } = await supabase.from(table).delete().eq(idField, idValue);
  if (error) throw new Error(`${table}: ${error.message}`);
}

export async function fetchAll(table, queryBuilder) {
  let query = supabase.from(table).select("*");
  if (queryBuilder) query = queryBuilder(query);
  const { data, error } = await query;
  if (error) throw new Error(`${table}: ${error.message}`);
  return data || [];
}

export function errorCard(title, message) {
  return html`
    <section class="card">
      <div class="section-title"><h3>${esc(title || "Error")}</h3></div>
      <p class="muted">${esc(message || "")}</p>
    </section>
  `;
}
