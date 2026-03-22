
import {
  page, shell, getGuildContext, fetchAll, stat, html, esc
} from "./lib.js";

page("Overview");
const root = document.getElementById("app");

async function render() {
  const ctx = await getGuildContext();
  if (!ctx) return;
  const { guild, admin } = ctx;

  const [configs, customCommands, rules, openTickets, activeRooms, activeCases] = await Promise.all([
    fetchAll("guild_configs", (q) => q.eq("guild_id", guild.guild_id)),
    fetchAll("custom_commands", (q) => q.eq("guild_id", guild.guild_id)),
    fetchAll("guild_rules", (q) => q.eq("guild_id", guild.guild_id)),
    fetchAll("tickets", (q) => q.eq("guild_id", guild.guild_id).eq("status", "open")),
    fetchAll("voicemaster_rooms", (q) => q.eq("guild_id", guild.guild_id).eq("is_active", true)),
    fetchAll("guild_cases", (q) => q.eq("guild_id", guild.guild_id).eq("active", true))
  ]);

  const config = configs[0] || null;

  shell(root, {
    guild,
    active: "overview",
    title: `${guild.name} Overview`,
    subtitle: "Quick server health, module status, and moderation overview.",
    content: html`
      <section class="card">
        <div class="stats-grid">
          ${stat("Members", guild.member_count ?? 0)}
          ${stat("Your Role", admin.role || "admin")}
          ${stat("Custom Commands", customCommands.length)}
          ${stat("Rules", rules.length)}
          ${stat("Open Tickets", openTickets.length)}
          ${stat("Active Voice Rooms", activeRooms.length)}
          ${stat("Active Cases", activeCases.length)}
          ${stat("Prefix", config?.prefix || ".")}
        </div>
      </section>

      <div class="two-col">
        <section class="card">
          <div class="section-title"><h3>Module Status</h3></div>
          <div class="stack">
            ${["moderation","lunarialog","tickets","voicemaster","serverpanel"].map((key) => {
              const enabled = config?.enabled_modules?.[key] !== false && (key !== "tickets" && key !== "voicemaster" ? true : !!config?.enabled_modules?.[key]);
              return `<div class="switch"><strong>${esc(key)}</strong><span class="badge ${enabled ? "green" : "red"}">${enabled ? "Enabled" : "Disabled"}</span></div>`;
            }).join("")}
          </div>
        </section>

        <section class="card">
          <div class="section-title"><h3>Server Facts</h3></div>
          <div class="stack">
            <div class="switch"><strong>Guild ID</strong><span class="badge">${esc(guild.guild_id)}</span></div>
            <div class="switch"><strong>Owner ID</strong><span class="badge">${esc(guild.owner_id || "unknown")}</span></div>
            <div class="switch"><strong>Updated</strong><span class="badge">${esc(guild.updated_at || "—")}</span></div>
          </div>
        </section>
      </div>
    `
  });
}

render().catch((error) => {
  root.innerHTML = `<div class="container"><section class="card"><h3>Ошибка</h3><p>${esc(error.message || String(error))}</p></section></div>`;
});
