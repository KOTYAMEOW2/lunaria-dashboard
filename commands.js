var root = document.getElementById('commandsView');
var L = window.Lunaria;
var supabase = L.client;

function normalizePermission(row, guildId, commandName) {
  var src = row || {};
  return {
    guild_id: guildId,
    command_name: commandName,
    enabled: src.enabled !== false,
    allowed_roles: Array.isArray(src.allowed_roles) ? src.allowed_roles : [],
    denied_roles: Array.isArray(src.denied_roles) ? src.denied_roles : [],
    allowed_channels: Array.isArray(src.allowed_channels) ? src.allowed_channels : [],
    denied_channels: Array.isArray(src.denied_channels) ? src.denied_channels : [],
    cooldown: typeof src.cooldown === 'number' ? src.cooldown : 0
  };
}
async function loadRegistry() {
  var res = await supabase.from('commands_registry').select('command_name,category,description,is_active,is_public').eq('is_public', true).order('category').order('command_name');
  if (res.error) throw new Error('commands_registry: ' + res.error.message);
  return res.data || [];
}
async function loadPermissions(guildId) {
  var res = await supabase.from('command_permissions').select('*').eq('guild_id', guildId);
  if (res.error) throw new Error('command_permissions: ' + res.error.message);
  var map = {};
  (res.data || []).forEach(function (row) { map[row.command_name] = row; });
  return map;
}
async function savePermission(p) {
  var res = await supabase.from('command_permissions').upsert({
    guild_id: p.guild_id,
    command_name: p.command_name,
    enabled: p.enabled,
    allowed_roles: p.allowed_roles,
    denied_roles: p.denied_roles,
    allowed_channels: p.allowed_channels,
    denied_channels: p.denied_channels,
    cooldown: p.cooldown,
    updated_at: new Date().toISOString()
  }, { onConflict: 'guild_id,command_name' });
  if (res.error) throw new Error('command_permissions save: ' + res.error.message);
}
function editorHtml(command, p) {
  return '<div class="card"><div class="split"><div><h2>' + L.esc(command.command_name) + '</h2><p class="muted">Category: ' + L.esc(command.category || 'other') + '</p><p>' + L.esc(command.description || 'No description.') + '</p></div><div class="actions"><button class="secondary" id="backBtn">Back</button></div></div>' +
    '<hr>' +
    '<div class="grid grid-2">' +
      '<div class="card"><div class="field"><label><input id="enabled" type="checkbox" ' + (p.enabled ? 'checked' : '') + '> Enabled</label></div><div class="field"><label for="cooldown">Cooldown</label><input id="cooldown" type="number" min="0" value="' + L.esc(p.cooldown) + '"></div></div>' +
      '<div class="card"><div class="field"><label for="allowed_roles">Allowed roles</label><textarea id="allowed_roles">' + L.esc(L.listToInput(p.allowed_roles)) + '</textarea></div><div class="field"><label for="denied_roles">Denied roles</label><textarea id="denied_roles">' + L.esc(L.listToInput(p.denied_roles)) + '</textarea></div></div>' +
      '<div class="card"><div class="field"><label for="allowed_channels">Allowed channels</label><textarea id="allowed_channels">' + L.esc(L.listToInput(p.allowed_channels)) + '</textarea></div><div class="field"><label for="denied_channels">Denied channels</label><textarea id="denied_channels">' + L.esc(L.listToInput(p.denied_channels)) + '</textarea></div></div>' +
    '</div><div class="card" style="margin-top:18px"><div class="actions"><button id="saveBtn">Save</button><button class="secondary" id="reloadBtn">Reload</button><button class="ghost" id="resetBtn">Reset</button></div><p id="status" class="muted" style="margin-top:14px"></p></div>';
}
function collect(guildId, commandName) {
  return normalizePermission({
    enabled: document.getElementById('enabled').checked,
    cooldown: Math.max(0, parseInt(document.getElementById('cooldown').value || '0', 10) || 0),
    allowed_roles: L.parseList(document.getElementById('allowed_roles').value),
    denied_roles: L.parseList(document.getElementById('denied_roles').value),
    allowed_channels: L.parseList(document.getElementById('allowed_channels').value),
    denied_channels: L.parseList(document.getElementById('denied_channels').value)
  }, guildId, commandName);
}
function apply(p) {
  document.getElementById('enabled').checked = p.enabled;
  document.getElementById('cooldown').value = p.cooldown;
  document.getElementById('allowed_roles').value = L.listToInput(p.allowed_roles);
  document.getElementById('denied_roles').value = L.listToInput(p.denied_roles);
  document.getElementById('allowed_channels').value = L.listToInput(p.allowed_channels);
  document.getElementById('denied_channels').value = L.listToInput(p.denied_channels);
}
async function start() {
  try {
    var guildId = L.queryParam('guild');
    if (!guildId) throw new Error('Не передан guild id.');
    var access = await L.requireGuildAccess(guildId);
    var commands = await loadRegistry();
    var permissions = await loadPermissions(guildId);
    renderList(access, commands, permissions);
  } catch (err) {
    L.showLayout(root, 'commands', 'Ошибка', 'Commands failed to load.', '<div class="card"><p>' + L.esc(L.errorText(err)) + '</p></div>');
  }
}
function renderList(access, commands, permissions) {
  var html = '<div class="card"><div class="split"><div><h2>Commands</h2><p class="muted">Enable, disable and fine-tune command access like a Juniper-style dashboard.</p></div><div class="kbd">Total: ' + commands.length + '</div></div><hr><div class="field"><label for="search">Search</label><input id="search" type="text" placeholder="ban, warn, ticket"></div><div id="commandList" class="stack"></div></div>';
  L.showLayout(root, 'commands', (access.guild.name || 'Server') + ' Commands', 'Command permissions and feature toggles.', html);
  var search = document.getElementById('search');
  var list = document.getElementById('commandList');
  function draw() {
    var q = (search.value || '').trim().toLowerCase();
    var filtered = commands.filter(function (cmd) {
      return !q || (cmd.command_name || '').toLowerCase().indexOf(q) !== -1 || (cmd.category || '').toLowerCase().indexOf(q) !== -1 || (cmd.description || '').toLowerCase().indexOf(q) !== -1;
    });
    if (!filtered.length) { list.innerHTML = '<div class="empty">No commands found.</div>'; return; }
    list.innerHTML = filtered.map(function (cmd) {
      var p = normalizePermission(permissions[cmd.command_name], access.guild.guild_id, cmd.command_name);
      return '<div class="list-item"><div class="server-info"><h3>' + L.esc(cmd.command_name) + '</h3><p>Category: ' + L.esc(cmd.category || 'other') + '</p><p>' + L.esc(cmd.description || 'No description.') + '</p><div>' + (p.enabled ? '<span class="chip">Enabled</span>' : '<span class="chip muted">Disabled</span>') + '</div></div><div class="actions"><button data-action="toggle" data-command="' + L.esc(cmd.command_name) + '">' + (p.enabled ? 'Disable' : 'Enable') + '</button><button class="secondary" data-action="open" data-command="' + L.esc(cmd.command_name) + '">Configure</button></div></div>';
    }).join('');
    Array.prototype.forEach.call(list.querySelectorAll('button[data-action="toggle"]'), function (btn) {
      btn.addEventListener('click', async function () {
        var name = btn.getAttribute('data-command');
        var current = normalizePermission(permissions[name], access.guild.guild_id, name);
        current.enabled = !current.enabled;
        try { await savePermission(current); permissions[name] = current; draw(); } catch (err) { alert(L.errorText(err)); }
      });
    });
    Array.prototype.forEach.call(list.querySelectorAll('button[data-action="open"]'), function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-command');
        var cmd = commands.find(function (x) { return x.command_name === name; });
        openEditor(access, cmd, permissions, commands);
      });
    });
  }
  search.addEventListener('input', draw);
  draw();
}
function openEditor(access, command, permissions, commands) {
  var p = normalizePermission(permissions[command.command_name], access.guild.guild_id, command.command_name);
  L.showLayout(root, 'commands', command.command_name + ' Settings', 'Command level access control.', editorHtml(command, p));
  document.getElementById('backBtn').addEventListener('click', function () { renderList(access, commands, permissions); });
  document.getElementById('saveBtn').addEventListener('click', async function () {
    var status = document.getElementById('status');
    try { status.textContent = 'Saving...'; var next = collect(access.guild.guild_id, command.command_name); await savePermission(next); permissions[command.command_name] = next; status.textContent = 'Saved'; } catch (err) { status.textContent = 'ERROR: ' + L.errorText(err); }
  });
  document.getElementById('reloadBtn').addEventListener('click', function () { apply(normalizePermission(permissions[command.command_name], access.guild.guild_id, command.command_name)); document.getElementById('status').textContent = 'Reloaded'; });
  document.getElementById('resetBtn').addEventListener('click', function () { apply(normalizePermission(null, access.guild.guild_id, command.command_name)); document.getElementById('status').textContent = 'Reset locally. Press Save to persist.'; });
}
start();
