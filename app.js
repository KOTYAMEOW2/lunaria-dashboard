const view = document.getElementById("view");

try {
  view.innerHTML = "app.js загрузился";

  if (!window.supabase) {
    throw new Error("window.supabase не найден");
  }

  const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
  const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";

  const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

  async function init() {
    view.innerHTML = "supabase client создан";

    const { data, error } = await supabase.auth.getSession();

    if (error) {
      throw error;
    }

    if (!data.session) {
      view.innerHTML = '<button onclick="login()">Login with Discord</button>';
      return;
    }

    view.innerHTML = "Сессия есть, логин работает";
  }

  window.login = async function () {
    await supabase.auth.signInWithOAuth({
      provider: "discord",
      options: {
        scopes: "identify guilds",
        redirectTo: location.origin + location.pathname
      }
    });
  };

  init();
} catch (e) {
  view.innerHTML = "Ошибка JS: " + (e.message || String(e));
}
