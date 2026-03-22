
import {
  page, shell, getGuildContext, fetchAll, upsert, removeById, createTokenField, bindFormStatus, searchFilter, html, esc
} from "./lib.js";

page("Custom Commands");
const root = document.getElementById("app");

function normalizeRow(guildId, row) {
  const data = row || {};
  return {
    id: data.id ?? null,
    guild_id: guildId,
    command_name: data.command_name || data.name || "",
    response: data.response || "",
    enabled: data.enabled !== false,
    embed_enabled: !!data.embed_enabled,
    allowed_roles: Array.isArray(data.allowed_roles) ? data.allowed_roles : [],
    denied_roles: Array.isArray(data.denied_roles) ? data.denied_roles : [],
    allowed_channels: Array.isArray(data.allowed_channels) ? data.allowed_channels : [],
    denied_channels: Array.isArray(data.denied_channels) ? data.denied_channels : [],
    cooldown: Number.isFinite(data.cooldown) ? data.cooldown : 0
  };
}

async function render() {
  const ctx = await getGuildContext();
  if (!ctx) return;
  const { guild } = ctx;

  let rows = (await fetchAll("custom_commands", (q) => q.eq("guild_id", guild.guild_id).order("updated_at", { ascending: false }))).map((x) => normalizeRow(guild.guild_id, x));
  let selectedId = rows[0]?.id || "new";

  shell(root, {
    guild,
    active: "custom-commands",
    title: `${guild.name} Custom Commands`,
    subtitle: "Juniper-style custom command editor with permissions, embeds, and quick duplication.",
    content: html`
      <section class="card">
        <div class="split narrow">
          <div class="panel">
            <div class="section-title">
              <h3>Custom Commands</h3>
              <div class="actions">
                <button id="createBtn">Create</button>
              </div>
            </div>
            <input id="searchInput" placeholder="Search command name or response">
            <div style="height:12px"></div>
            <div id="listEl" class="list"></div>
          </div>
          <div class="panel" id="editorEl"></div>
        </div>
      </section>
    `
  });

  const listEl = document.getElementById("listEl");
  const editorEl = document.getElementById("editorEl");
  const searchInput = document.getElementById("searchInput");

  function currentRecord() {
    return selectedId === "new"
      ? normalizeRow(guild.guild_id, {})
      : normalizeRow(guild.guild_id, rows.find((x) => String(x.id) === String(selectedId)));
  }

  function renderList() {
    const filtered = searchFilter(rows, searchInput.value, ["command_name","response"]);
    listEl.innerHTML = [
      `<button type="button" class="list-item ${selectedId === "new" ? "active" : ""}" data-id="new">
        <div><strong>+ New custom command</strong><div class="item-meta">Create a new custom response or mini-tool.</div></div>
        <span class="badge">Draft</span>
      </button>`,
      ...filtered.map((row) => `
        <button type="button" class="list-item ${String(selectedId) === String(row.id) ? "active" : ""}" data-id="${esc(row.id)}">
          <div>
            <strong>${esc(row.command_name || "(unnamed)")}</strong>
            <div class="item-meta">${esc((row.response || "").slice(0, 80) || "No response yet")}</div>
          </div>
          <span class="badge ${row.enabled ? "green" : "red"}">${row.enabled ? "Enabled" : "Disabled"}</span>
        </button>
      `)
    ].join("");

    listEl.querySelectorAll("[data-id]").forEach((node) => {
      node.addEventListener("click", () => {
        selectedId = node.getAttribute("data-id");
        renderList();
        renderEditor();
      });
    });
  }

  function renderEditor() {
    const row = currentRecord();
    editorEl.innerHTML = `
      <div class="section-title">
        <div>
          <h3>${esc(row.command_name || "New Custom Command")}</h3>
          <div class="item-meta">Ticket Tool / Juniper style editor with access gates.</div>
        </div>
        <span class="badge ${row.enabled ? "green" : "red"}">${row.enabled ? "Enabled" : "Disabled"}</span>
      </div>

      <div class="row">
        <div class="field"><label>Command name</label><input id="nameInput" value="${esc(row.command_name)}" placeholder="example"></div>
        <div class="field"><label>Cooldown</label><input id="cooldownInput" type="number" min="0" step="1" value="${esc(row.cooldown)}"></div>
      </div>

      <div style="height:12px"></div>
      <div class="row">
        <label class="switch"><strong>Enabled</strong><input id="enabledInput" type="checkbox" ${row.enabled ? "checked" : ""}></label>
        <label class="switch"><strong>Embed enabled</strong><input id="embedInput" type="checkbox" ${row.embed_enabled ? "checked" : ""}></label>
      </div>

      <div style="height:12px"></div>
      <div class="field"><label>Response</label><textarea id="responseInput" placeholder="Write the response or embed body...">${esc(row.response)}</textarea></div>

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
          <button class="ghost" id="duplicateBtn">Duplicate</button>
          ${row.id ? `<button class="danger" id="deleteBtn">Delete</button>` : ""}
        </div>
        <div class="status" id="status"></div>
      </div>
    `;

    const allowedRoles = createTokenField({ label: "Allowed roles", values: row.allowed_roles, placeholder: "Role ID" });
    const deniedRoles = createTokenField({ label: "Denied roles", values: row.denied_roles, placeholder: "Role ID" });
    const allowedChannels = createTokenField({ label: "Allowed channels", values: row.allowed_channels, placeholder: "Channel ID" });
    const deniedChannels = createTokenField({ label: "Denied channels", values: row.denied_channels, placeholder: "Channel ID" });

    document.getElementById("allowedRolesField").appendChild(allowedRoles.element);
    document.getElementById("deniedRolesField").appendChild(deniedRoles.element);
    document.getElementById("allowedChannelsField").appendChild(allowedChannels.element);
    document.getElementById("deniedChannelsField").appendChild(deniedChannels.element);

    const status = bindFormStatus(document.getElementById("status"));

    function collect() {
      return {
        ...(row.id ? { id: row.id } : {}),
        guild_id: guild.guild_id,
        command_name: (document.getElementById("nameInput").value || "").trim().toLowerCase(),
        response: document.getElementById("responseInput").value || "",
        enabled: !!document.getElementById("enabledInput").checked,
        embed_enabled: !!document.getElementById("embedInput").checked,
        allowed_roles: allowedRoles.getValue(),
        denied_roles: deniedRoles.getValue(),
        allowed_channels: allowedChannels.getValue(),
        denied_channels: deniedChannels.getValue(),
        cooldown: Math.max(0, Number(document.getElementById("cooldownInput").value || 0)),
        updated_at: new Date().toISOString()
      };
    }

    document.getElementById("saveBtn").addEventListener("click", async () => {
      try {
        const payload = collect();
        if (!payload.command_name) throw new Error("Command name is required.");
        status.set("Saving...");
        await upsert("custom_commands", payload, row.id ? "id" : "guild_id,command_name");
        rows = (await fetchAll("custom_commands", (q) => q.eq("guild_id", guild.guild_id).order("updated_at", { ascending: false }))).map((x) => normalizeRow(guild.guild_id, x));
        selectedId = rows.find((x) => x.command_name === payload.command_name)?.id || "new";
        renderList();
        renderEditor();
        status.set("Saved.", "success");
      } catch (error) {
        status.set(error.message || String(error), "error");
      }
    });

    document.getElementById("duplicateBtn").addEventListener("click", () => {
      const cloned = collect();
      cloned.id = null;
      cloned.command_name = cloned.command_name ? cloned.command_name + "_copy" : "";
      selectedId = "new";
      rows.unshift(normalizeRow(guild.guild_id, cloned));
      renderList();
      renderEditor();
    });

    const deleteBtn = document.getElementById("deleteBtn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        if (!confirm("Delete this custom command?")) return;
        try {
          await removeById("custom_commands", "id", row.id);
          rows = rows.filter((x) => x.id !== row.id);
          selectedId = rows[0]?.id || "new";
          renderList();
          renderEditor();
        } catch (error) {
          status.set(error.message || String(error), "error");
        }
      });
    }
  }

  document.getElementById("createBtn").addEventListener("click", () => {
    selectedId = "new";
    renderList();
    renderEditor();
  });
  searchInput.addEventListener("input", renderList);

  renderList();
  renderEditor();
}

render().catch((error) => {
  root.innerHTML = `<div class="container"><section class="card"><h3>Ошибка</h3><p>${esc(error.message || String(error))}</p></section></div>`;
});
