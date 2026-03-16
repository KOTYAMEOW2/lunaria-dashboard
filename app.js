const view = document.getElementById("view");

function show(html) {
  if (view) view.innerHTML = html;
}

try {
  if (!view) {
    throw new Error('Элемент #view не найден');
  }

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('Supabase CDN загружен некорректно');
  }

  const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
  const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  function getDiscordId(user) {
    return (
      user?.user_metadata?.provider_id ||
      user?.user_metadata?.sub ||
      user?.identities?.[0]?.id ||
      user?.app_metadata?.provider_id ||
      null
    );
  }

  async function login() {
    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        scopes: "identify guilds",
        redirectTo: "https://lunaria-dashboard.pages.dev/auth/callback/"
      }
    });
  }

  async function logout() {
    await supabase.auth.signOut();
    location.reload();
  }

  window.login = login;
  window.logout = logout;

  (async () => {
    try {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        throw new Error("Ошибка getSession: " + error.message);
      }

      const session = data?.session;

      if (!session) {
        show(`
          <h2>Lunaria Fox Dashboard</h2>
          <p>Сессии нет.</p>
          <button onclick="login()">Login with Discord</button>
        `);
        return;
      }

      const user = session.user;
      const discordId = getDiscordId(user);

      if (!discordId) {
        throw new Error("Discord ID не найден в session.user");
      }

      show(`
        <h2>Lunaria Fox Dashboard</h2>
        <p>Вход выполнен.</p>
        <p>Discord ID: ${discordId}</p>
        <button onclick="logout()">Logout</button>
      `);
    } catch (err) {
      show(`<div>Ошибка: ${err.message}</div>`);
    }
  })();

} catch (err) {
  if (view) {
    view.innerHTML = `<div>Ошибка запуска: ${err.message}</div>`;
  }
}
