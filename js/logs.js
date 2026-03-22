
import {
  page, shell, getGuildContext, fetchAll, upsert, bindFormStatus, html, esc, fmtDate
} from "./lib.js";

page("Logs");
const root = document.getElementById("app");
const LOG_TYPES = [
  "message_delete","message_edit","member_join","member_leave",
  "ban","unban","warn","mute","unmute","ticket","voicemaster"
];

async function render() {
  const ctx = await getGuildContext();
  if (!ctx) return;
  const { guild } = ctx;

  const [settingsRows, entries] = await Promise.all([
    fetchAll("guild_log_settings", (q) => q.eq("guild_id", guild.guild_id).order("log_type")),
    fetchAll("guild_logs", (q) => q.eq("guild_id", guild.guild_id).order("created_at", { ascending: false }).limit(50))
  ]);
  const settingsMap = Object.fromEntries(settingsRows.map((x) => [x.log_type, x]));

  shell(root, {
    guild,
    active: "logs",
    title: `${guild.name} Logs`,
    subtitle: "Configure routing and inspect recent log entries.",
    content: html`
      <div class="two-col">
        <section class="card" id="settingsCard"></section>
        <section class="card" id="entriesCard"></section>
      </div>
    `
  });

  const settingsCard = document.getElementById("settingsCard");
  const entriesCard = document.getElementById("entriesCard");

  settingsCard.innerHTML = `
    <div class="section-title"><h3>Log Settings</h3></div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Type</th><th>Enabled</th><th>Channel ID</th></tr></thead>
        <tbody>
          ${LOG_TYPES.map((type) => {
            const row = settingsMap[type] || {};
            return `
              <tr>
                <td><strong>${esc(type)}</strong></td>
                <td><input type="checkbox" data-enabled="${esc(type)}" ${row.enabled ? "checked" : ""}></td>
                <td><input data-channel="${esc(type)}" value="${esc(row.channel_id || "")}" placeholder="Channel ID"></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
    </div>
    <div class="editor-footer">
      <div class="actions"><button id="saveLogsBtn">Save log routing</button></div>
      <div class="status" id="logsStatus"></div>
    </div>
  `;
  const status = bindFormStatus(document.getElementById("logsStatus"));
  document.getElementById("saveLogsBtn").addEventListener("click", async () => {
    try {
      status.set("Saving...");
      const payload = LOG_TYPES.map((type) => ({
        guild_id: guild.guild_id,
        log_type: type,
        enabled: !!document.querySelector(`[data-enabled="${type}"]`).checked,
        channel_id: document.querySelector(`[data-channel="${type}"]`).value.trim() || null,
        updated_at: new Date().toISOString()
      }));
      await upsert("guild_log_settings", payload, "guild_id,log_type");
      status.set("Saved.", "success");
    } catch (error) {
      status.set(error.message || String(error), "error");
    }
  });

  entriesCard.innerHTML = `
    <div class="section-title"><h3>Recent Entries</h3><span class="badge">Last 50</span></div>
    <div class="table-wrap">
      <table>
        <thead>
          <tr><th>Time</th><th>Type</th><th>Message</th><th>User</th><th>Target</th><th>Moderator</th></tr>
        </thead>
        <tbody>
          ${entries.length ? entries.map((row) => `
            <tr>
              <td>${esc(fmtDate(row.created_at))}</td>
              <td>${esc(row.type || row.log_type || "unknown")}</td>
              <td>${esc(row.message || "—")}</td>
              <td>${esc(row.user_id || "—")}</td>
              <td>${esc(row.target_id || "—")}</td>
              <td>${esc(row.moderator_id || "—")}</td>
            </tr>
          `).join("") : `<tr><td colspan="6" class="muted">No log entries yet.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

render().catch((error) => {
  root.innerHTML = `<div class="container"><section class="card"><h3>Ошибка</h3><p>${esc(error.message || String(error))}</p></section></div>`;
});
