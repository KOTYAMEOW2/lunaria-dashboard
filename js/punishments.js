
import {
  page, shell, getGuildContext, fetchAll, upsert, html, esc, fmtDate
} from "./lib.js";

page("Punishments");
const root = document.getElementById("app");

async function render() {
  const ctx = await getGuildContext();
  if (!ctx) return;
  const { guild } = ctx;

  const [cases, tempBans, tempRoles] = await Promise.all([
    fetchAll("guild_cases", (q) => q.eq("guild_id", guild.guild_id).order("created_at", { ascending: false })),
    fetchAll("temp_bans", (q) => q.eq("guild_id", guild.guild_id).order("created_at", { ascending: false })),
    fetchAll("temp_roles", (q) => q.eq("guild_id", guild.guild_id).order("created_at", { ascending: false }))
  ]);

  const combined = [
    ...cases.map((x) => ({ source: "case", ...x })),
    ...tempBans.map((x) => ({ source: "temp_ban", type: "temp_ban", target_id: x.user_id, moderator_id: x.moderator_id, reason: x.reason, active: true, expires_at: x.expires_at, created_at: x.created_at, id: "ban:"+x.id })),
    ...tempRoles.map((x) => ({ source: "temp_role", type: "temp_role", target_id: x.user_id, moderator_id: x.moderator_id, reason: x.reason, active: true, expires_at: x.expires_at, created_at: x.created_at, id: "role:"+x.id }))
  ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));

  shell(root, {
    guild,
    active: "punishments",
    title: `${guild.name} Punishments`,
    subtitle: "Review and manage moderation outcomes. No direct creation from the dashboard yet.",
    content: html`
      <section class="card">
        <div class="section-title"><h3>Cases & Timed Actions</h3></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Type</th><th>Target</th><th>Moderator</th><th>Reason</th><th>Created</th><th>Expires</th><th>State</th><th>Manage</th></tr></thead>
            <tbody>
              ${combined.length ? combined.map((row) => `
                <tr>
                  <td>${esc(row.type || "unknown")}</td>
                  <td>${esc(row.target_id || "—")}</td>
                  <td>${esc(row.moderator_id || "—")}</td>
                  <td>${esc(row.reason || "—")}</td>
                  <td>${esc(fmtDate(row.created_at))}</td>
                  <td>${esc(fmtDate(row.expires_at))}</td>
                  <td><span class="badge ${row.active ? "gold" : "green"}">${row.active ? "Active" : "Closed"}</span></td>
                  <td>${row.source === "case" && row.active ? `<button data-revoke="${esc(row.id)}" class="ghost">Revoke</button>` : "—"}</td>
                </tr>
              `).join("") : `<tr><td colspan="8" class="muted">No punishments found.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    `
  });

  root.querySelectorAll("[data-revoke]").forEach((node) => {
    node.addEventListener("click", async () => {
      try {
        await upsert("guild_cases", {
          id: Number(node.getAttribute("data-revoke")),
          active: false,
          revoked_at: new Date().toISOString()
        }, "id");
        window.location.reload();
      } catch (error) {
        alert(error.message || String(error));
      }
    });
  });
}

render().catch((error) => {
  root.innerHTML = `<div class="container"><section class="card"><h3>Ошибка</h3><p>${esc(error.message || String(error))}</p></section></div>`;
});
