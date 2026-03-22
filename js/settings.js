
import {
  page, shell, getGuildContext, fetchAll, upsert, createTokenField, bindFormStatus, html, esc
} from "./lib.js";

page("Settings");
const root = document.getElementById("app");

function normalizeConfig(guildId, row) {
  const data = row || {};
  const mods = data.enabled_modules || {};
  return {
    guild_id: guildId,
    prefix: data.prefix || ".",
    enabled_modules: {
      moderation: mods.moderation !== false,
      lunarialog: mods.lunarialog !== false,
      tickets: !!mods.tickets,
      voicemaster: !!mods.voicemaster,
      serverpanel: mods.serverpanel !== false
    },
    mod_roles: Array.isArray(data.mod_roles) ? data.mod_roles : [],
    admin_roles: Array.isArray(data.admin_roles) ? data.admin_roles : [],
    disabled_commands: Array.isArray(data.disabled_commands) ? data.disabled_commands : []
  };
}

async function render() {
  const ctx = await getGuildContext();
  if (!ctx) return;
  const { guild } = ctx;
  const config = normalizeConfig(guild.guild_id, (await fetchAll("guild_configs", (q) => q.eq("guild_id", guild.guild_id)))[0]);

  shell(root, {
    guild,
    active: "settings",
    title: `${guild.name} Settings`,
    subtitle: "General configuration, role access, and command defaults.",
    content: html`
      <section class="card">
        <div class="split">
          <div class="panel" id="generalPanel"></div>
          <div class="panel" id="accessPanel"></div>
        </div>
      </section>
    `
  });

  const general = document.getElementById("generalPanel");
  const access = document.getElementById("accessPanel");

  general.innerHTML = `
    <div class="section-title"><h3>General</h3></div>
    <div class="field"><label>Prefix</label><input id="prefixInput" maxlength="5" value="${esc(config.prefix)}"></div>
    <hr class="sep">
    <div class="section-title"><h3>Modules</h3></div>
    <div class="stack">
      ${["moderation","lunarialog","tickets","voicemaster","serverpanel"].map((key) => `
        <label class="switch">
          <strong>${esc(key)}</strong>
          <input type="checkbox" data-module="${esc(key)}" ${config.enabled_modules[key] ? "checked" : ""}>
        </label>
      `).join("")}
    </div>
  `;

  access.innerHTML = `
    <div class="section-title"><h3>Roles and Commands</h3></div>
    <p class="muted">Temporary chip-based editing. Replace with pickers later.</p>
    <div id="modRolesField"></div>
    <div style="height:12px"></div>
    <div id="adminRolesField"></div>
    <div style="height:12px"></div>
    <div id="disabledCommandsField"></div>
    <div class="editor-footer">
      <div class="actions">
        <button id="saveBtn">Save</button>
        <button class="ghost" id="reloadBtn">Reload</button>
        <button class="ghost" id="resetBtn">Reset</button>
      </div>
      <div class="status" id="status"></div>
    </div>
  `;

  const modRolesField = createTokenField({ label: "Mod roles", values: config.mod_roles, placeholder: "Role ID" });
  const adminRolesField = createTokenField({ label: "Admin roles", values: config.admin_roles, placeholder: "Role ID" });
  const disabledCommandsField = createTokenField({ label: "Disabled commands", values: config.disabled_commands, placeholder: "Command name" });

  document.getElementById("modRolesField").appendChild(modRolesField.element);
  document.getElementById("adminRolesField").appendChild(adminRolesField.element);
  document.getElementById("disabledCommandsField").appendChild(disabledCommandsField.element);

  const status = bindFormStatus(document.getElementById("status"));

  function collect() {
    const enabled_modules = {};
    document.querySelectorAll("[data-module]").forEach((node) => {
      enabled_modules[node.getAttribute("data-module")] = !!node.checked;
    });
    return {
      guild_id: guild.guild_id,
      prefix: (document.getElementById("prefixInput").value || ".").trim().slice(0, 5) || ".",
      enabled_modules,
      mod_roles: modRolesField.getValue(),
      admin_roles: adminRolesField.getValue(),
      disabled_commands: disabledCommandsField.getValue(),
      updated_at: new Date().toISOString()
    };
  }

  document.getElementById("saveBtn").addEventListener("click", async () => {
    try {
      status.set("Saving...");
      await upsert("guild_configs", collect(), "guild_id");
      status.set("Saved.", "success");
    } catch (error) {
      status.set(error.message || String(error), "error");
    }
  });

  document.getElementById("reloadBtn").addEventListener("click", () => window.location.reload());
  document.getElementById("resetBtn").addEventListener("click", () => {
    document.getElementById("prefixInput").value = ".";
    document.querySelectorAll("[data-module]").forEach((node) => node.checked = !["tickets","voicemaster"].includes(node.getAttribute("data-module")));
    modRolesField.setValue([]);
    adminRolesField.setValue([]);
    disabledCommandsField.setValue([]);
    status.set("Reset locally. Click Save to write to Supabase.", "warn");
  });
}

render().catch((error) => {
  root.innerHTML = `<div class="container"><section class="card"><h3>Ошибка</h3><p>${esc(error.message || String(error))}</p></section></div>`;
});
