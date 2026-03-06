const view = document.getElementById("view");

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function init() {

  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    view.innerHTML = `
      <button onclick="login()">Login with Discord</button>
    `;
    return;
  }

  const user = session.user;

  view.innerHTML = `
    <h2>Ты вошла как ${user.user_metadata.full_name || user.email}</h2>
    <p>ID: ${user.id}</p>
    <button onclick="logout()">Выйти</button>
    <hr>
    <h3>Серверы с ботом</h3>
    <div id="guilds">Загрузка...</div>
  `;

  loadGuilds();
}

async function loadGuilds() {

  const guildsDiv = document.getElementById("guilds");

  const { data, error } = await supabase
    .from("bot_guilds")
    .select("*");

  if (error) {
    guildsDiv.innerHTML = "Ошибка загрузки серверов";
    return;
  }

  if (!data.length) {
    guildsDiv.innerHTML = "Бот пока нет ни на одном сервере";
    return;
  }

  guildsDiv.innerHTML = data.map(g =>
    `
    <div style="
      background:#2b1c44;
      padding:15px;
      margin:10px 0;
      border-radius:12px;
    ">
      <b>${g.name || "Unknown server"}</b><br>
      ID: ${g.guild_id}
    </div>
    `
  ).join("");

}

window.login = async function () {
  await supabase.auth.signInWithOAuth({
    provider: "discord",
    options: {
      scopes: "identify guilds",
      redirectTo: location.origin
    }
  });
}

window.logout = async function () {
  await supabase.auth.signOut();
  location.reload();
}

init();
