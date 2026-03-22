var root = document.getElementById('settingsView');
var L = window.Lunaria;
var supabase = L.client;

function field(id, label, value, placeholder, textarea) {
  return '<div class="field"><label for="' + id + '">' + L.esc(label) + '</label>' +
    (textarea
      ? '<textarea id="' + id + '" placeholder="' + L.esc(placeholder || '') + '">' + L.esc(value || '') + '</textarea>'
      : '<input id="' + id + '" type="text" value="' + L.esc(value || '') + '" placeholder="' + L.esc(placeholder || '') + '">') +
    '</div>';
}
function check(id, label, checked) {
  return '<label class="chip" style="display:flex; align-items:center; gap:8px"><input id="' + id + '" type="checkbox" ' + (checked ? 'checked' : '') + '> ' + L.esc(label) + '</label>';
}

async function loadConfig(guildId) {
  var res = await supabase.from('guild_configs').select('*').eq('guild_id', guildId).maybeSingle();
  if (res.error) throw new Error('guild_configs: ' + res.error.message);
  return L.normalizeGuildConfig(res.data, guildId);
}

async function saveConfig(config) {
  var res = await supabase.from('guild_configs').upsert({
    guild_id: config.guild_id,
    prefix: config.prefix,
    enabled_modules: config.enabled_modules,
    mod_roles: config.mod_roles,
    admin_roles: config.admin_roles,
    disabled_commands: config.disabled_commands,
    updated_at: new Date().toISOString()
  }, { onConflict: 'guild_id' });
  if (res.error) throw new Error('guild_configs save: ' + res.error.message);
}

function collect(guildId) {
  return L.normalizeGuildConfig({
    guild_id: guildId,
    prefix: (document.getElementById('prefix').value || '.').trim().slice(0, 5) || '.',
    enabled_modules: {
      moderation: document.getElementById('mod_moderation').checked,
      lunarialog: document.getElementById('mod_lunarialog').checked,
      tickets: document.getElementById('mod_tickets').checked,
      voicemaster: document.getElementById('mod_voicemaster').checked,
      serverpanel: document.getElementById('mod_serverpanel').checked
    },
    mod_roles: L.parseList(document.getElementById('mod_roles').value),
    admin_roles: L.parseList(document.getElementById('admin_roles').value),
    disabled_commands: L.parseList(document.getElementById('disabled_commands').value)
  }, guildId);
}

function apply(cfg) {
  document.getElementById('prefix').value = cfg.prefix;
  document.getElementById('mod_moderation').checked = cfg.enabled_modules.moderation;
  document.getElementById('mod_lunarialog').checked = cfg.enabled_modules.lunarialog;
  document.getElementById('mod_tickets').checked = cfg.enabled_modules.tickets;
  document.getElementById('mod_voicemaster').checked = cfg.enabled_modules.voicemaster;
  document.getElementById('mod_serverpanel').checked = cfg.enabled_modules.serverpanel;
  document.getElementById('mod_roles').value = L.listToInput(cfg.mod_roles);
  document.getElementById('admin_roles').value = L.listToInput(cfg.admin_roles);
  document.getElementById('disabled_commands').value = L.listToInput(cfg.disabled_commands);
}

async function start() {
  try {
    var guildId = L.queryParam('guild');
    if (!guildId) throw new Error('Не передан guild id.');
    var access = await L.requireGuildAccess(guildId);
    var cfg = await loadConfig(guildId);
    var html = '<div class="grid grid-2">' +
      '<div class="card"><h2>General</h2><p class="help">Base server settings. This is the common control block for Lunaria.</p>' +
      field('prefix', 'Prefix', cfg.prefix, 'Example: . or !', false) +
      '<div class="field"><label>Enabled modules</label><div class="actions">' +
      check('mod_moderation', 'Moderation', cfg.enabled_modules.moderation) +
      check('mod_lunarialog', 'LunariaLog', cfg.enabled_modules.lunarialog) +
      check('mod_tickets', 'Tickets', cfg.enabled_modules.tickets) +
      check('mod_voicemaster', 'VoiceMaster', cfg.enabled_modules.voicemaster) +
      check('mod_serverpanel', 'Server Panel', cfg.enabled_modules.serverpanel) +
      '</div></div></div>' +
      '<div class="card"><h2>Roles and Commands</h2><p class="help">Temporary form-based editing. Replace with pickers later.</p>' +
      field('mod_roles', 'Mod roles (comma separated)', L.listToInput(cfg.mod_roles), '123, 456', true) +
      field('admin_roles', 'Admin roles (comma separated)', L.listToInput(cfg.admin_roles), '123, 456', true) +
      field('disabled_commands', 'Disabled commands (comma separated)', L.listToInput(cfg.disabled_commands), 'ban, warn', true) +
      '</div></div>' +
      '<div class="card"><div class="actions"><button id="saveBtn">Save</button><button class="secondary" id="reloadBtn">Reload</button><button class="ghost" id="resetBtn">Reset to defaults</button></div><p id="status" class="muted" style="margin-top:14px"></p></div>';
    L.showLayout(root, 'settings', (access.guild.name || 'Server') + ' Settings', 'Common configuration and module toggles.', html);
    document.getElementById('saveBtn').addEventListener('click', async function () {
      var status = document.getElementById('status');
      try { status.textContent = 'Saving...'; await saveConfig(collect(guildId)); status.textContent = 'Saved'; } catch (err) { status.textContent = 'ERROR: ' + L.errorText(err); }
    });
    document.getElementById('reloadBtn').addEventListener('click', async function () {
      var status = document.getElementById('status');
      try { status.textContent = 'Reloading...'; apply(await loadConfig(guildId)); status.textContent = 'Reloaded'; } catch (err) { status.textContent = 'ERROR: ' + L.errorText(err); }
    });
    document.getElementById('resetBtn').addEventListener('click', function () {
      apply(L.normalizeGuildConfig(null, guildId));
      document.getElementById('status').textContent = 'Reset locally. Press Save to write defaults.';
    });
  } catch (err) {
    L.showLayout(root, 'settings', 'Ошибка', 'Settings failed to load.', '<div class="card"><p>' + L.esc(L.errorText(err)) + '</p></div>');
  }
}
start();
