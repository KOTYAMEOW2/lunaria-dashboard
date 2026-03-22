
import {
  page, loginShell, signIn, signOut, getSession, getUserName, getAccessibleGuilds, guildIconUrl, html, esc, mount
} from "./lib.js";

page("Servers");

const root = document.getElementById("app");

async function render() {
  const session = await getSession();
  if (!session) {
    loginShell(root, html`
      <section class="hero">
        <h2>Welcome to Lunaria Dashboard</h2>
        <p>Sign in with Discord to manage your servers.</p>
      </section>
      <section class="card">
        <div class="actions">
          <button id="loginBtn">Login with Discord</button>
        </div>
      </section>
    `);
    document.getElementById("loginBtn").addEventListener("click", async () => {
      try { await signIn(); } catch (error) { alert(error.message || String(error)); }
    });
    return;
  }

  const guilds = await getAccessibleGuilds();
  loginShell(root, html`
    <section class="hero">
      <h2>Hello, ${esc(getUserName(session.user))}</h2>
      <p>Select a server to open its dashboard.</p>
    </section>
    <section class="card">
      <div class="section-title">
        <h3>Your Servers</h3>
        <div class="actions"><button class="ghost" id="logoutBtn">Logout</button></div>
      </div>
      <div class="server-grid">
        ${guilds.length ? guilds.map((guild) => {
          const icon = guildIconUrl(guild);
          return `
            <a class="server-card" href="./overview.html?guild=${encodeURIComponent(guild.guild_id)}">
              ${icon ? `<img class="server-icon" src="${icon}" alt="">` : `<div class="server-icon">LF</div>`}
              <div style="flex:1">
                <strong>${esc(guild.name || "Server")}</strong>
                <div class="card-subtitle">Guild ID: ${esc(guild.guild_id)}</div>
                <div class="card-subtitle">Role: ${esc(guild.role || "admin")}</div>
                <div class="card-subtitle">Members: ${esc(guild.member_count ?? 0)}</div>
              </div>
            </a>`;
        }).join("") : `<div class="empty">No servers found in guild_admins for this account.</div>`}
      </div>
    </section>
  `);
  document.getElementById("logoutBtn").addEventListener("click", async () => {
    try { await signOut(); } catch (error) { alert(error.message || String(error)); }
  });
}

render().catch((error) => {
  mount(root, `<div class="container"><section class="card"><h3>Ошибка</h3><p>${esc(error.message || String(error))}</p></section></div>`);
});
