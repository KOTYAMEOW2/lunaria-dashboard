var root = document.getElementById('manageView');
var L = window.Lunaria;
var supabase = L.client;

async function loadStats(guildId) {
  var results = await Promise.allSettled([
    supabase.from('guild_configs').select('guild_id', { count: 'exact', head: true }).eq('guild_id', guildId),
    supabase.from('custom_commands').select('id', { count: 'exact', head: true }).eq('guild_id', guildId),
    supabase.from('tickets').select('id', { count: 'exact', head: true }).eq('guild_id', guildId),
    supabase.from('guild_cases').select('id', { count: 'exact', head: true }).eq('guild_id', guildId)
  ]);
  return {
    hasConfig: results[0].status === 'fulfilled' ? results[0].value.count || 0 : 0,
    customCommands: results[1].status === 'fulfilled' ? results[1].value.count || 0 : 0,
    tickets: results[2].status === 'fulfilled' ? results[2].value.count || 0 : 0,
    cases: results[3].status === 'fulfilled' ? results[3].value.count || 0 : 0
  };
}

async function start() {
  try {
    L.showLayout(root, 'overview', 'Server Overview', 'Main hub for the selected server.', '<div class="card"><p>Loading...</p></div>');
    var guildId = L.queryParam('guild');
    if (!guildId) throw new Error('Не передан guild id.');
    var access = await L.requireGuildAccess(guildId);
    var stats = await loadStats(guildId);
    var icon = L.getGuildIcon(access.guild.guild_id, access.guild.icon);
    var html = '' +
      '<div class="grid grid-3">' +
        '<div class="stats"><div class="stat-value">' + L.esc(access.role) + '</div><div class="stat-label">Your role</div></div>' +
        '<div class="stats"><div class="stat-value">' + L.esc(stats.customCommands) + '</div><div class="stat-label">Custom commands</div></div>' +
        '<div class="stats"><div class="stat-value">' + L.esc(stats.tickets) + '</div><div class="stat-label">Tickets</div></div>' +
      '</div>' +
      '<div class="card" style="margin-top:18px">' +
        '<div class="server-card">' +
          '<div style="display:flex; gap:14px; align-items:flex-start">' +
            (icon ? '<img class="server-icon" src="' + icon + '" alt="icon">' : '<div class="server-icon">LF</div>') +
            '<div class="server-info"><h2>' + L.esc(access.guild.name || 'Server') + '</h2><p>Guild ID: ' + L.esc(access.guild.guild_id) + '</p><p>Members: ' + L.esc(access.guild.member_count || '—') + '</p><p>Config rows: ' + L.esc(stats.hasConfig) + '</p><p>Cases: ' + L.esc(stats.cases) + '</p></div>' +
          '</div>' +
          '<div class="actions"><a class="button secondary" href="./">Back</a></div>' +
        '</div>' +
      '</div>' +
      '<div class="grid grid-2" style="margin-top:18px">' +
        navCard('Settings', 'General server settings, prefix, modules and core roles.', './settings.html?guild=' + encodeURIComponent(guildId)) +
        navCard('Commands', 'Enable, disable and configure command access.', './commands.html?guild=' + encodeURIComponent(guildId)) +
        navCard('Custom Commands', 'Manage server-specific custom commands.', './custom-commands.html?guild=' + encodeURIComponent(guildId)) +
        navCard('Rules', 'Store and manage the rules shown for this server.', './rules.html?guild=' + encodeURIComponent(guildId)) +
        navCard('Logs', 'Configure logging channels by event type.', './logs.html?guild=' + encodeURIComponent(guildId)) +
        navCard('Punishments', 'Inspect moderation cases and history.', './punishments.html?guild=' + encodeURIComponent(guildId)) +
        navCard('Tickets', 'Configure ticket system and inspect ticket list.', './tickets.html?guild=' + encodeURIComponent(guildId)) +
        navCard('VoiceMaster', 'Manage voice room creation settings.', './voicemaster.html?guild=' + encodeURIComponent(guildId)) +
      '</div>';
    L.showLayout(root, 'overview', access.guild.name || 'Server Overview', 'Everything for this server starts here.', html);
  } catch (err) {
    L.showLayout(root, 'overview', 'Ошибка', 'Overview failed to load.', '<div class="card"><p>' + L.esc(L.errorText(err)) + '</p></div>');
  }
}
function navCard(title, text, href) { return '<a class="card" href="' + href + '"><h3>' + L.esc(title) + '</h3><p>' + L.esc(text) + '</p><div class="actions" style="margin-top:14px"><span class="button">Open</span></div></a>'; }
start();
