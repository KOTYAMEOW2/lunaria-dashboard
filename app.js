const view = document.getElementById("view");

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function showError(text) {
  view.innerHTML = `
    <div style="
      margin-top:12px;
      padding:12px;
      border:1px solid rgba(255,100,120,.35);
      border-radius:12px;
      background:rgba(255,100,120,.08);
      white-space:pre-wrap;
    ">${text}</div>
  `;
}

async function init() {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error) {
      throw error;
    }

    if (!session) {
      view.innerHTML = `
        <button onclick="login()">Login with Discord</button>
      `;
      return;
    }

    const user = session.user;
    const name =
      user.user_metadata?.full_name ||
      user.user_metadata?.name ||
      user.email ||
      user.id;

    view.innerHTML = `
      <h2>Ты вошла как ${name}</h2>
      <p>ID: ${user.id}</p>
      <button onclick="logout()">Выйти</button>
      <hr>
      <h3>Серверы с ботом</h3>
      <div id="guilds">Загрузка...</div>
    `;

    await loadGuilds();
  } catch (e) {
    showError("Ошибка init: " + (e.message || String(e)));
  }
}

async function loadGuilds() {
  const guildsDiv = document.getElementById("guilds");

  try {
    const { data, error } = await supabase
      .from("bot_guilds")
      .select("*");

    if (error) {
      throw error;
    }

    if (!data || !data.length) {
      guildsDiv.innerHTML = "Бот пока нет ни на одном сервере";
      return;
    }

    guildsDiv.innerHTML = data.map(g => `
      <div style="
        background:#2b1c44;
        padding:15px;
        margin:10px 0;
        border-radius:12px;
      ">
        <b>${g.name || "Unknown server"}</b><br>
        ID: ${g.guild_id}
      </div>
    `).join("");
  } catch (e) {
    guildsDiv.innerHTML = "Ошибка загрузки серверов: " + (e.message || String(e));
  }
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

window.logout = async function () {
  await supabase.auth.signOut();
  location.reload();
};

init();
