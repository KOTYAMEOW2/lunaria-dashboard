
import {
  page, shell, getGuildContext, fetchAll, upsert, createTokenField, bindFormStatus, searchFilter, html, esc
} from "./lib.js";

page("Commands");
const root = document.getElementById("app");

function normalizePermission(guildId, command, row) {
  const data = row || {};
  return {
    guild_id: guildId,
    command_name: command.command_name,
    enabled: data.enabled !== false,
    allowed_roles: Array.isArray(data.allowed_roles) ? data.allowed_roles : [],
    denied_roles: Array.isArray(data.denied_roles) ? data.denied_roles : [],
    allowed_channels: Array.isArray(data.allowed_channels) ? data.allowed_channels : [],
    denied_channels: Array.isArray(data.denied_channels) ? data.denied_channels : [],
    cooldown: Number.isFinite(data.cooldown) ? data.cooldown : 0,
    updated_at: new Date().toISOString()
  };
}

async function render() {
  const ctx = await getGuildContext();
  if (!ctx) return;
  const { guild } = ctx;

  const commands = await fetchAll("commands_registry", (q) => q.eq("is_active", true).order("category").order("command_name"));
  const permissions = await fetchAll("command_permissions", (q) => q.eq("guild_id", guild.guild_id));

  const permissionMap = Object.fromEntries(permissions.map((x) => [x.command_name, x]));
  let selectedName = commands[0]?.command_name || null;
  let currentFilter = "all";

  shell(root, {
    guild,
    active: "commands",
    title: `${guild.name} Commands`,
    subtitle: "Command permissions, channel/role access, cooldowns, and visibility.",
    content: html`
      <section class="card">
        <div class="split narrow">
          <div class="panel">
            <div class="section-title">
              <h3>Command Catalog</h3>
              <span class="badge" id="totalBadge">Total: ${commands.length}</span>
            </div>
            <div class="search-bar">
              <input id="searchInput" placeholder="ban, warn, ticket">
              <select id="categoryFilter">
                <option value="all">All categories</option>
                ${[...new Set(commands.map((x) => x.category || "unknown"))].map((cat) => `<option value="${esc(cat)}">${esc(cat)}</option>`).join("")}
              </select>
            </div>
            <div style="height:12px"></div>
            <div id="commandList" class="list"></div>
          </div>
          <div class="panel" id="editorPanel"></div>
        </div>
      </section>
    `
  });

  const listEl = document.getElementById("commandList");
  const editorEl = document.getElementById("editorPanel");
  const searchInput = document.getElementById("searchInput");
  const categoryFilter = document.getElementById("categoryFilter");

  function filteredCommands() {
    let rows = searchFilter(commands, searchInput.value, ["command_name","category","description"]);
    if (currentFilter !== "all") rows = rows.filter((x) => (x.category || "unknown") === currentFilter);
    return rows;
  }

  function renderList() {
    const rows = filteredCommands();
    listEl.innerHTML = rows.length ? rows.map((command) => {
      const perm = normalizePermission(guild.guild_id, command, permissionMap[command.command_name]);
      return `
        <button type="button" class="list-item ${selectedName === command.command_name ? "active" : ""}" data-command="${esc(command.command_name)}">
          <div style="text-align:left">
            <strong>${esc(command.command_name)}</strong>
            <div class="item-meta">${esc(command.category || "unknown")} · ${esc(command.description || "No description")}</div>
          </div>
          <span class="badge ${perm.enabled ? "green" : "red"}">${perm.enabled ? "Enabled" : "Disabled"}</span>
        </button>
      `;
    }).join("") : `<div class="empty">No commands found.</div>`;

    listEl.querySelectorAll("[data-command]").forEach((node) => {
      node.addEventListener("click", () => {
        selectedName = node.getAttribute("data-command");
        renderList();
        renderEditor();
      });
    });
  }

  function renderEditor() {
    const command = commands.find((x) => x.command_name === selectedName);
    if (!command) {
      editorEl.innerHTML = `<div class="empty">Select a command from the list.</div>`;
      return;
    }

    const permission = normalizePermission(guild.guild_id, command, permissionMap[command.command_name]);

    editorEl.innerHTML = `
      <div class="section-title">
        <div>
          <h3>${esc(command.command_name)}</h3>
          <div class="item-meta">${esc(command.category || "unknown")} · ${esc(command.description || "No description")}</div>
        </div>
        <span class="badge ${permission.enabled ? "green" : "red"}">${permission.enabled ? "Enabled" : "Disabled"}</span>
      </div>

      <div class="row">
        <label class="switch"><strong>Enabled</strong><input id="enabledInput" type="checkbox" ${permission.enabled ? "checked" : ""}></label>
        <div class="field"><label>Cooldown (seconds)</label><input id="cooldownInput" type="number" min="0" step="1" value="${esc(permission.cooldown)}"></div>
      </div>
      <div style="height:12px"></div>
      <div class="row">
        <div id="allowedRolesField"></div>
        <div id="deniedRolesField"></div>
      </div>
      <div style="height:12px"></div>
      <div class="row">
        <div id="allowedChannelsField"></div>
        <div id="deniedChannelsField"></div>
      </div>

      <div class="editor-footer">
        <div class="actions">
          <button id="saveBtn">Save</button>
          <button class="ghost" id="resetBtn">Reset</button>
        </div>
        <div class="status" id="status"></div>
      </div>
    `;

    const allowedRoles = createTokenField({ label: "Allowed roles", values: permission.allowed_roles, placeholder: "Role ID" });
    const deniedRoles = createTokenField({ label: "Denied roles", values: permission.denied_roles, placeholder: "Role ID" });
    const allowedChannels = createTokenField({ label: "Allowed channels", values: permission.allowed_channels, placeholder: "Channel ID" });
    const deniedChannels = createTokenField({ label: "Denied channels", values: permission.denied_channels, placeholder: "Channel ID" });

    document.getElementById("allowedRolesField").appendChild(allowedRoles.element);
    document.getElementById("deniedRolesField").appendChild(deniedRoles.element);
    document.getElementById("allowedChannelsField").appendChild(allowedChannels.element);
    document.getElementById("deniedChannelsField").appendChild(deniedChannels.element);

    const status = bindFormStatus(document.getElementById("status"));

    document.getElementById("saveBtn").addEventListener("click", async () => {
      try {
        const next = {
          guild_id: guild.guild_id,
          command_name: command.command_name,
          enabled: !!document.getElementById("enabledInput").checked,
          allowed_roles: allowedRoles.getValue(),
          denied_roles: deniedRoles.getValue(),
          allowed_channels: allowedChannels.getValue(),
          denied_channels: deniedChannels.getValue(),
          cooldown: Math.max(0, Number(document.getElementById("cooldownInput").value || 0)),
          updated_at: new Date().toISOString()
        };
        status.set("Saving...");
        await upsert("command_permissions", next, "guild_id,command_name");
        permissionMap[command.command_name] = next;
        status.set("Saved.", "success");
        renderList();
      } catch (error) {
        status.set(error.message || String(error), "error");
      }
    });

    document.getElementById("resetBtn").addEventListener("click", () => {
      document.getElementById("enabledInput").checked = true;
      document.getElementById("cooldownInput").value = 0;
      allowedRoles.setValue([]);
      deniedRoles.setValue([]);
      allowedChannels.setValue([]);
      deniedChannels.setValue([]);
      status.set("Reset locally. Click Save to persist.", "warn");
    });
  }

  searchInput.addEventListener("input", renderList);
  categoryFilter.addEventListener("change", () => { currentFilter = categoryFilter.value; renderList(); });

  renderList();
  renderEditor();
}

render().catch((error) => {
  root.innerHTML = `<div class="container"><section class="card"><h3>Ошибка</h3><p>${esc(error.message || String(error))}</p></section></div>`;
});
