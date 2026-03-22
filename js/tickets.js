
import {
  page, shell, getGuildContext, fetchAll, upsert, removeById, createTokenField, bindFormStatus, html, esc, fmtDate
} from "./lib.js";

page("Tickets");
const root = document.getElementById("app");

async function render() {
  const ctx = await getGuildContext();
  if (!ctx) return;
  const { guild } = ctx;

  let [config] = await fetchAll("ticket_configs", (q) => q.eq("guild_id", guild.guild_id));
  let panels = await fetchAll("ticket_panels", (q) => q.eq("guild_id", guild.guild_id).order("updated_at", { ascending: false }));
  let tickets = await fetchAll("tickets", (q) => q.eq("guild_id", guild.guild_id).order("created_at", { ascending: false }).limit(50));
  config = config || {
    guild_id: guild.guild_id,
    enabled: false,
    category_id: "",
    channel_id: "",
    log_channel_id: "",
    support_roles: [],
    ticket_name_template: "ticket-{user}",
    max_open_per_user: 1,
    panels: []
  };

  let selectedPanelId = panels[0]?.id || "new";

  shell(root, {
    guild,
    active: "tickets",
    title: `${guild.name} Tickets`,
    subtitle: "Ticket Tool–style multi-panel setup with overview and recent tickets.",
    content: html`
      <div class="three-col">
        <section class="card" id="configCard"></section>
        <section class="card" id="panelsCard" style="grid-column: span 1;"></section>
        <section class="card" id="recentCard" style="grid-column: span 1;"></section>
      </div>
    `
  });

  const configCard = document.getElementById("configCard");
  const panelsCard = document.getElementById("panelsCard");
  const recentCard = document.getElementById("recentCard");

  configCard.innerHTML = `
    <div class="section-title"><h3>Ticket Config</h3></div>
    <div class="stack">
      <label class="switch"><strong>Enabled</strong><input id="enabledInput" type="checkbox" ${config.enabled ? "checked" : ""}></label>
      <div class="field"><label>Category ID</label><input id="categoryInput" value="${esc(config.category_id || "")}"></div>
      <div class="field"><label>Panel Channel ID</label><input id="channelInput" value="${esc(config.channel_id || "")}"></div>
      <div class="field"><label>Log Channel ID</label><input id="logInput" value="${esc(config.log_channel_id || "")}"></div>
      <div id="supportRolesField"></div>
      <div class="row">
        <div class="field"><label>Ticket Name Template</label><input id="nameTemplateInput" value="${esc(config.ticket_name_template || "ticket-{user}")}"></div>
        <div class="field"><label>Max Open / User</label><input id="maxOpenInput" type="number" min="1" step="1" value="${esc(config.max_open_per_user || 1)}"></div>
      </div>
      <div class="editor-footer">
        <div class="actions"><button id="saveConfigBtn">Save config</button></div>
        <div class="status" id="configStatus"></div>
      </div>
    </div>
  `;

  const supportRoles = createTokenField({ label: "Support Roles", values: config.support_roles || [], placeholder: "Role ID" });
  document.getElementById("supportRolesField").appendChild(supportRoles.element);
  const configStatus = bindFormStatus(document.getElementById("configStatus"));

  document.getElementById("saveConfigBtn").addEventListener("click", async () => {
    try {
      configStatus.set("Saving...");
      await upsert("ticket_configs", {
        guild_id: guild.guild_id,
        enabled: !!document.getElementById("enabledInput").checked,
        category_id: document.getElementById("categoryInput").value.trim() || null,
        channel_id: document.getElementById("channelInput").value.trim() || null,
        log_channel_id: document.getElementById("logInput").value.trim() || null,
        support_roles: supportRoles.getValue(),
        ticket_name_template: document.getElementById("nameTemplateInput").value.trim() || "ticket-{user}",
        max_open_per_user: Math.max(1, Number(document.getElementById("maxOpenInput").value || 1)),
        updated_at: new Date().toISOString()
      }, "guild_id");
      configStatus.set("Saved.", "success");
    } catch (error) {
      configStatus.set(error.message || String(error), "error");
    }
  });

  function panelEditor() {
    const current = selectedPanelId === "new"
      ? { guild_id: guild.guild_id, panel_name: "", panel_channel_id: "", panel_message_id: "", panel_type: "default", description: "", button_label: "Open Ticket", button_style: "primary", enabled: true }
      : panels.find((x) => String(x.id) === String(selectedPanelId));

    panelsCard.innerHTML = `
      <div class="section-title">
        <h3>Panels</h3>
        <div class="actions"><button id="createPanelBtn">Create Panel</button></div>
      </div>
      <div class="list" id="panelList">
        ${[
          `<button type="button" class="list-item ${selectedPanelId === "new" ? "active" : ""}" data-panel="new"><strong>+ New Panel</strong></button>`,
          ...panels.map((panel) => `<button type="button" class="list-item ${String(selectedPanelId) === String(panel.id) ? "active" : ""}" data-panel="${esc(panel.id)}"><div><strong>${esc(panel.panel_name || "Unnamed panel")}</strong><div class="item-meta">${esc(panel.panel_type || "default")} · ${esc(panel.panel_channel_id || "no channel")}</div></div><span class="badge ${panel.enabled ? "green" : "red"}">${panel.enabled ? "Enabled" : "Disabled"}</span></button>`)
        ].join("")}
      </div>
      <hr class="sep">
      <div class="stack">
        <div class="field"><label>Panel name</label><input id="panelNameInput" value="${esc(current.panel_name || "")}"></div>
        <div class="row">
          <div class="field"><label>Panel Channel ID</label><input id="panelChannelInput" value="${esc(current.panel_channel_id || "")}"></div>
          <div class="field"><label>Panel Message ID</label><input id="panelMessageInput" value="${esc(current.panel_message_id || "")}"></div>
        </div>
        <div class="row">
          <div class="field"><label>Panel type</label><input id="panelTypeInput" value="${esc(current.panel_type || "default")}"></div>
          <div class="field"><label>Button label</label><input id="buttonLabelInput" value="${esc(current.button_label || "Open Ticket")}"></div>
        </div>
        <div class="field"><label>Description</label><textarea id="panelDescInput">${esc(current.description || "")}</textarea></div>
        <label class="switch"><strong>Enabled</strong><input id="panelEnabledInput" type="checkbox" ${current.enabled !== false ? "checked" : ""}></label>
        <div class="editor-footer">
          <div class="actions">
            <button id="savePanelBtn">Save panel</button>
            ${current.id ? `<button class="danger" id="deletePanelBtn">Delete</button>` : ""}
          </div>
          <div class="status" id="panelStatus"></div>
        </div>
      </div>
    `;

    const panelStatus = bindFormStatus(document.getElementById("panelStatus"));

    panelsCard.querySelectorAll("[data-panel]").forEach((node) => {
      node.addEventListener("click", () => {
        selectedPanelId = node.getAttribute("data-panel");
        panelEditor();
      });
    });
    document.getElementById("createPanelBtn").addEventListener("click", () => {
      selectedPanelId = "new";
      panelEditor();
    });
    document.getElementById("savePanelBtn").addEventListener("click", async () => {
      try {
        const payload = {
          ...(current.id ? { id: current.id } : {}),
          guild_id: guild.guild_id,
          panel_name: document.getElementById("panelNameInput").value.trim() || "New Panel",
          panel_channel_id: document.getElementById("panelChannelInput").value.trim() || null,
          panel_message_id: document.getElementById("panelMessageInput").value.trim() || null,
          panel_type: document.getElementById("panelTypeInput").value.trim() || "default",
          description: document.getElementById("panelDescInput").value || "",
          button_label: document.getElementById("buttonLabelInput").value.trim() || "Open Ticket",
          enabled: !!document.getElementById("panelEnabledInput").checked,
          updated_at: new Date().toISOString()
        };
        panelStatus.set("Saving...");
        await upsert("ticket_panels", payload, current.id ? "id" : undefined);
        panels = await fetchAll("ticket_panels", (q) => q.eq("guild_id", guild.guild_id).order("updated_at", { ascending: false }));
        selectedPanelId = panels[0]?.id || "new";
        panelEditor();
        panelStatus.set("Saved.", "success");
      } catch (error) {
        panelStatus.set(error.message || String(error), "error");
      }
    });

    const deleteBtn = document.getElementById("deletePanelBtn");
    if (deleteBtn) {
      deleteBtn.addEventListener("click", async () => {
        if (!confirm("Delete this panel?")) return;
        try {
          await removeById("ticket_panels", "id", current.id);
          panels = panels.filter((x) => x.id !== current.id);
          selectedPanelId = panels[0]?.id || "new";
          panelEditor();
        } catch (error) {
          panelStatus.set(error.message || String(error), "error");
        }
      });
    }
  }

  recentCard.innerHTML = `
    <div class="section-title"><h3>Recent Tickets</h3><span class="badge">Last 50</span></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Owner</th><th>Status</th><th>Claimed</th><th>Created</th></tr></thead>
        <tbody>
          ${tickets.length ? tickets.map((ticket) => `
            <tr>
              <td>${esc(ticket.ticket_id || ticket.id || "—")}</td>
              <td>${esc(ticket.owner_id || "—")}</td>
              <td>${esc(ticket.status || "open")}</td>
              <td>${esc(ticket.claimed_by || "—")}</td>
              <td>${esc(fmtDate(ticket.created_at))}</td>
            </tr>
          `).join("") : `<tr><td colspan="5" class="muted">No tickets found.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;

  panelEditor();
}

render().catch((error) => {
  root.innerHTML = `<div class="container"><section class="card"><h3>Ошибка</h3><p>${esc(error.message || String(error))}</p></section></div>`;
});
