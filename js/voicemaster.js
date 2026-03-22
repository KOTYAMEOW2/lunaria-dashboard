
import {
  page, shell, getGuildContext, fetchAll, upsert, bindFormStatus, html, esc, fmtDate
} from "./lib.js";

page("VoiceMaster");
const root = document.getElementById("app");

async function render() {
  const ctx = await getGuildContext();
  if (!ctx) return;
  const { guild } = ctx;

  const [config] = await fetchAll("voicemaster_configs", (q) => q.eq("guild_id", guild.guild_id));
  const rooms = await fetchAll("voicemaster_rooms", (q) => q.eq("guild_id", guild.guild_id).order("created_at", { ascending: false }).limit(50));

  const cfg = config || {
    guild_id: guild.guild_id,
    enabled: false,
    creator_channel_id: "",
    category_id: "",
    log_channel_id: "",
    room_name_template: "{username}'s room",
    default_user_limit: 0,
    allow_rename: true,
    allow_lock: true,
    allow_hide: true,
    allow_transfer: true
  };

  shell(root, {
    guild,
    active: "voicemaster",
    title: `${guild.name} VoiceMaster`,
    subtitle: "VoiceMaster-style setup and live room overview.",
    content: html`
      <div class="two-col">
        <section class="card" id="configCard"></section>
        <section class="card" id="roomsCard"></section>
      </div>
    `
  });

  const configCard = document.getElementById("configCard");
  const roomsCard = document.getElementById("roomsCard");

  configCard.innerHTML = `
    <div class="section-title"><h3>Config</h3></div>
    <div class="stack">
      <label class="switch"><strong>Enabled</strong><input id="enabledInput" type="checkbox" ${cfg.enabled ? "checked" : ""}></label>
      <div class="row">
        <div class="field"><label>Creator Channel ID</label><input id="creatorInput" value="${esc(cfg.creator_channel_id || "")}"></div>
        <div class="field"><label>Category ID</label><input id="categoryInput" value="${esc(cfg.category_id || "")}"></div>
      </div>
      <div class="row">
        <div class="field"><label>Log Channel ID</label><input id="logInput" value="${esc(cfg.log_channel_id || "")}"></div>
        <div class="field"><label>Default User Limit</label><input id="limitInput" type="number" min="0" value="${esc(cfg.default_user_limit || 0)}"></div>
      </div>
      <div class="field"><label>Room Name Template</label><input id="templateInput" value="${esc(cfg.room_name_template || "{username}'s room")}"></div>
      <div class="row">
        <label class="switch"><strong>Allow Rename</strong><input id="renameInput" type="checkbox" ${cfg.allow_rename !== false ? "checked" : ""}></label>
        <label class="switch"><strong>Allow Lock</strong><input id="lockInput" type="checkbox" ${cfg.allow_lock !== false ? "checked" : ""}></label>
      </div>
      <div class="row">
        <label class="switch"><strong>Allow Hide</strong><input id="hideInput" type="checkbox" ${cfg.allow_hide !== false ? "checked" : ""}></label>
        <label class="switch"><strong>Allow Transfer</strong><input id="transferInput" type="checkbox" ${cfg.allow_transfer !== false ? "checked" : ""}></label>
      </div>
      <div class="editor-footer">
        <div class="actions"><button id="saveBtn">Save config</button></div>
        <div class="status" id="status"></div>
      </div>
    </div>
  `;

  const status = bindFormStatus(document.getElementById("status"));
  document.getElementById("saveBtn").addEventListener("click", async () => {
    try {
      status.set("Saving...");
      await upsert("voicemaster_configs", {
        guild_id: guild.guild_id,
        enabled: !!document.getElementById("enabledInput").checked,
        creator_channel_id: document.getElementById("creatorInput").value.trim() || null,
        category_id: document.getElementById("categoryInput").value.trim() || null,
        log_channel_id: document.getElementById("logInput").value.trim() || null,
        room_name_template: document.getElementById("templateInput").value.trim() || "{username}'s room",
        default_user_limit: Math.max(0, Number(document.getElementById("limitInput").value || 0)),
        allow_rename: !!document.getElementById("renameInput").checked,
        allow_lock: !!document.getElementById("lockInput").checked,
        allow_hide: !!document.getElementById("hideInput").checked,
        allow_transfer: !!document.getElementById("transferInput").checked,
        updated_at: new Date().toISOString()
      }, "guild_id");
      status.set("Saved.", "success");
    } catch (error) {
      status.set(error.message || String(error), "error");
    }
  });

  roomsCard.innerHTML = `
    <div class="section-title"><h3>Active Rooms</h3><span class="badge">${rooms.length} active</span></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Channel</th><th>Owner</th><th>Members</th><th>Locked</th><th>Created</th></tr></thead>
        <tbody>
          ${rooms.length ? rooms.map((room) => `
            <tr>
              <td>${esc(room.channel_id || "—")}</td>
              <td>${esc(room.owner_id || "—")}</td>
              <td>${esc(room.member_count ?? 0)}</td>
              <td>${esc(room.is_locked ? "Yes" : "No")}</td>
              <td>${esc(fmtDate(room.created_at))}</td>
            </tr>
          `).join("") : `<tr><td colspan="5" class="muted">No active rooms found.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

render().catch((error) => {
  root.innerHTML = `<div class="container"><section class="card"><h3>Ошибка</h3><p>${esc(error.message || String(error))}</p></section></div>`;
});
