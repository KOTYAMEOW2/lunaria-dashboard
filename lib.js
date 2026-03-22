(function () {
  var CONFIG = window.LUNARIA_CONFIG || {};
  var SUPABASE_URL = CONFIG.SUPABASE_URL;
  var SUPABASE_KEY = CONFIG.SUPABASE_KEY;

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('Supabase library is not loaded');
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error('Config is missing SUPABASE_URL or SUPABASE_KEY');
  }

  var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function errorText(err) {
    if (!err) return 'Unknown error';
    if (err.message) return err.message;
    return String(err);
  }

  function getDiscordId(user) {
    if (!user) return null;
    if (Array.isArray(user.identities)) {
      for (var i = 0; i < user.identities.length; i += 1) {
        var identity = user.identities[i];
        if (identity && identity.provider === 'discord' && identity.id) return identity.id;
      }
    }
    if (user.user_metadata && user.user_metadata.provider_id) return user.user_metadata.provider_id;
    if (user.user_metadata && user.user_metadata.sub) return user.user_metadata.sub;
    if (user.app_metadata && user.app_metadata.provider_id) return user.app_metadata.provider_id;
    return null;
  }

  function getUserName(user) {
    if (!user) return 'User';
    if (user.user_metadata && user.user_metadata.full_name) return user.user_metadata.full_name;
    if (user.user_metadata && user.user_metadata.name) return user.user_metadata.name;
    if (user.email) return user.email;
    return 'User';
  }

  function getGuildIcon(guildId, icon) {
    if (!guildId || !icon) return '';
    return 'https://cdn.discordapp.com/icons/' + encodeURIComponent(guildId) + '/' + encodeURIComponent(icon) + '.png?size=128';
  }

  function parseList(value) {
    if (!value) return [];
    return String(value)
      .split(',')
      .map(function (item) { return item.trim(); })
      .filter(function (item) { return item.length > 0; });
  }

  function listToInput(value) {
    if (!Array.isArray(value) || !value.length) return '';
    return value.join(', ');
  }

  function queryParam(name) {
    return new URL(window.location.href).searchParams.get(name);
  }

  function layout(section, title, subtitle) {
    return (
      '<div class="page-shell">' +
        '<aside class="sidebar">' +
          '<div class="brand"><div class="brand-badge">LF</div><div><div class="brand-title">Lunaria Dashboard</div><div class="brand-sub">Server control panel</div></div></div>' +
          '<div class="nav-group"><div class="nav-label">Navigation</div>' +
            navLink('./', 'Servers', section === 'servers') +
            navLink(withGuild('./manage.html'), 'Overview', section === 'overview') +
            navLink(withGuild('./settings.html'), 'Settings', section === 'settings') +
            navLink(withGuild('./commands.html'), 'Commands', section === 'commands') +
            navLink(withGuild('./custom-commands.html'), 'Custom Commands', section === 'custom-commands') +
            navLink(withGuild('./rules.html'), 'Rules', section === 'rules') +
            navLink(withGuild('./logs.html'), 'Logs', section === 'logs') +
            navLink(withGuild('./punishments.html'), 'Punishments', section === 'punishments') +
            navLink(withGuild('./tickets.html'), 'Tickets', section === 'tickets') +
            navLink(withGuild('./voicemaster.html'), 'VoiceMaster', section === 'voicemaster') +
          '</div>' +
        '</aside>' +
        '<main class="main">' +
          '<section class="hero"><h1>' + esc(title || 'Lunaria Dashboard') + '</h1><p>' + esc(subtitle || '') + '</p></section>' +
          '<div id="pageContent"></div>' +
        '</main>' +
      '</div>'
    );
  }

  function navLink(href, label, active) {
    return '<a class="nav-link' + (active ? ' active' : '') + '" href="' + href + '"><span>' + esc(label) + '</span></a>';
  }

  function withGuild(path) {
    var guild = queryParam('guild');
    if (!guild) return path;
    var glue = path.indexOf('?') === -1 ? '?' : '&';
    return path + glue + 'guild=' + encodeURIComponent(guild);
  }

  function showLayout(root, section, title, subtitle, innerHtml) {
    root.innerHTML = layout(section, title, subtitle);
    var target = document.getElementById('pageContent');
    target.innerHTML = innerHtml || '';
  }

  async function requireSession() {
    var sessionRes = await client.auth.getSession();
    if (sessionRes.error) throw new Error('session: ' + sessionRes.error.message);
    var session = sessionRes.data && sessionRes.data.session ? sessionRes.data.session : null;
    if (!session) {
      window.location.href = './';
      return null;
    }
    return session;
  }

  async function requireGuildAccess(guildId) {
    var session = await requireSession();
    if (!session) return null;
    var discordId = getDiscordId(session.user);
    if (!discordId) throw new Error('Discord ID not found in session');

    var adminRes = await client.from('guild_admins').select('guild_id,user_id,role').eq('guild_id', guildId).eq('user_id', discordId).maybeSingle();
    if (adminRes.error) throw new Error('guild_admins: ' + adminRes.error.message);
    if (!adminRes.data) throw new Error('No access to this server');

    var guildRes = await client.from('bot_guilds').select('guild_id,name,icon,member_count,owner_id,updated_at').eq('guild_id', guildId).maybeSingle();
    if (guildRes.error) throw new Error('bot_guilds: ' + guildRes.error.message);
    if (!guildRes.data) throw new Error('Guild not found in bot_guilds');

    return {
      session: session,
      discordId: discordId,
      role: adminRes.data.role || 'admin',
      guild: guildRes.data
    };
  }

  function renderChips(items, mutedText) {
    if (!items || !items.length) return '<span class="chip muted">' + esc(mutedText || 'Not set') + '</span>';
    return items.map(function (item) { return '<span class="chip">' + esc(item) + '</span>'; }).join('');
  }

  function normalizeGuildConfig(row, guildId) {
    var src = row || {};
    var enabled = src.enabled_modules || {};
    return {
      guild_id: guildId,
      prefix: typeof src.prefix === 'string' && src.prefix.trim() ? src.prefix.trim().slice(0, 5) : '.',
      enabled_modules: {
        moderation: enabled.moderation !== false,
        lunarialog: enabled.lunarialog !== false,
        tickets: !!enabled.tickets,
        voicemaster: !!enabled.voicemaster,
        serverpanel: enabled.serverpanel !== false
      },
      mod_roles: Array.isArray(src.mod_roles) ? src.mod_roles : [],
      admin_roles: Array.isArray(src.admin_roles) ? src.admin_roles : [],
      disabled_commands: Array.isArray(src.disabled_commands) ? src.disabled_commands : []
    };
  }

  window.Lunaria = {
    client: client,
    esc: esc,
    errorText: errorText,
    getDiscordId: getDiscordId,
    getUserName: getUserName,
    getGuildIcon: getGuildIcon,
    parseList: parseList,
    listToInput: listToInput,
    queryParam: queryParam,
    withGuild: withGuild,
    showLayout: showLayout,
    requireSession: requireSession,
    requireGuildAccess: requireGuildAccess,
    renderChips: renderChips,
    normalizeGuildConfig: normalizeGuildConfig
  };
})();
