var root = document.getElementById('view');
var L = window.Lunaria;
var supabase = L.client;

function show(html) { root.innerHTML = html; }

function card(title, body) {
  show('<div class="page-shell"><aside class="sidebar"><div class="brand"><div class="brand-badge">LF</div><div><div class="brand-title">Lunaria Dashboard</div><div class="brand-sub">Server control panel</div></div></div></aside><main class="main"><section class="hero"><h1>' + L.esc(title || 'Lunaria Dashboard') + '</h1><p>Discord server management via Supabase</p></section><div class="card">' + body + '</div></main></div>');
}

async function login() {
  var cfg = window.LUNARIA_CONFIG || {};
  var res = await supabase.auth.signInWithOAuth({
    provider: 'discord',
    options: { scopes: 'identify guilds', redirectTo: cfg.REDIRECT_TO || (window.location.origin + '/') }
  });
  if (res.error) throw res.error;
}

async function logout() {
  var res = await supabase.auth.signOut();
  if (res.error) throw res.error;
  window.location.href = './';
}

async function loadGuilds(discordId) {
  var adminRes = await supabase.from('guild_admins').select('guild_id, role').eq('user_id', discordId);
  if (adminRes.error) throw new Error('guild_admins: ' + adminRes.error.message);
  var roleMap = {};
  var ids = [];
  (adminRes.data || []).forEach(function (row) {
    if (!row || !row.guild_id || roleMap[row.guild_id]) return;
    roleMap[row.guild_id] = row.role || 'admin';
    ids.push(row.guild_id);
  });
  if (!ids.length) return [];
  var guildRes = await supabase.from('bot_guilds').select('guild_id,name,icon,updated_at,member_count').in('guild_id', ids).order('updated_at', { ascending: false });
  if (guildRes.error) throw new Error('bot_guilds: ' + guildRes.error.message);
  return (guildRes.data || []).map(function (guild) {
    return {
      guild_id: guild.guild_id,
      name: guild.name || 'Server',
      icon: guild.icon,
      updated_at: guild.updated_at,
      member_count: guild.member_count,
      role: roleMap[guild.guild_id] || 'admin'
    };
  });
}

function renderLoggedOut() {
  card('Добро пожаловать', '<p>Войди через Discord, чтобы открыть список доступных серверов.</p><div class="actions"><button id="loginBtn">Login with Discord</button></div>');
  document.getElementById('loginBtn').addEventListener('click', async function () {
    try { await login(); } catch (err) { card('Ошибка входа', '<p>' + L.esc(L.errorText(err)) + '</p>'); }
  });
}

function renderGuilds(user, discordId, guilds) {
  var html = '<div class="grid grid-3">' +
    '<div class="stats"><div class="stat-value">' + guilds.length + '</div><div class="stat-label">Accessible servers</div></div>' +
    '<div class="stats"><div class="stat-value">' + L.esc(discordId || '-') + '</div><div class="stat-label">Discord ID</div></div>' +
    '<div class="stats"><div class="stat-value">' + L.esc(L.getUserName(user)) + '</div><div class="stat-label">Signed in</div></div>' +
    '</div><div class="card" style="margin-top:18px"><div class="split"><div><h2>Your servers</h2><p class="muted">Choose a server to open the control panel.</p></div><div class="actions"><button class="secondary" id="logoutBtn">Logout</button></div></div><div class="stack" style="margin-top:16px">';
  guilds.forEach(function (guild) {
    var icon = L.getGuildIcon(guild.guild_id, guild.icon);
    html += '<div class="server-card">' +
      '<div style="display:flex; gap:14px; align-items:flex-start; min-width:0">' +
        (icon ? '<img class="server-icon" src="' + icon + '" alt="icon">' : '<div class="server-icon">LF</div>') +
        '<div class="server-info"><h3>' + L.esc(guild.name) + '</h3><p>Guild ID: ' + L.esc(guild.guild_id) + '</p><p>Role: ' + L.esc(guild.role) + '</p><p>Members: ' + L.esc(guild.member_count || '—') + '</p></div>' +
      '</div>' +
      '<div class="actions"><a class="manage-link" href="./manage.html?guild=' + encodeURIComponent(guild.guild_id) + '">Manage</a></div>' +
    '</div>';
  });
  html += '</div></div>';
  card('Servers', html);
  document.getElementById('logoutBtn').addEventListener('click', logout);
}

async function init() {
  card('Loading', '<p>Проверка авторизации...</p>');
  var sessionRes = await supabase.auth.getSession();
  if (sessionRes.error) throw new Error('auth: ' + sessionRes.error.message);
  var session = sessionRes.data && sessionRes.data.session ? sessionRes.data.session : null;
  if (!session) return renderLoggedOut();
  var user = session.user;
  var discordId = L.getDiscordId(user);
  if (!discordId) return card('Ошибка', '<p>Discord ID не найден в сессии.</p>');
  var guilds = await loadGuilds(discordId);
  if (!guilds.length) return card('Серверов нет', '<p>Для этого Discord ID нет записей в guild_admins.</p><div class="actions"><button id="logoutBtn">Logout</button></div>');
  renderGuilds(user, discordId, guilds);
}

init().catch(function (err) { console.error(err); card('Ошибка', '<p>' + L.esc(L.errorText(err)) + '</p>'); });
