const view = document.getElementById("view");

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function init(){

const { data:{ session } } = await supabase.auth.getSession();

if(!session){
view.innerHTML = '<button onclick="login()">Login with Discord</button>';
return;
}

view.innerHTML = `
<h2>Dashboard</h2>
<p>Ты вошла через Discord</p>

<h3>Серверы с ботом</h3>
<div id="guilds">Загрузка...</div>
`;

loadGuilds();

}

async function loadGuilds(){

const guildsDiv = document.getElementById("guilds");

const { data } = await supabase
.from("bot_guilds")
.select("*");

if(!data || !data.length){
guildsDiv.innerHTML = "Бот пока нет ни на одном сервере";
return;
}

guildsDiv.innerHTML = data.map(g=>`

<div style="
background:#2b1c44;
padding:12px;
margin:10px 0;
border-radius:10px
">

<b>${g.name || "Server"}</b><br>
ID: ${g.guild_id}

</div>

`).join("");

}

window.login = async function(){

await supabase.auth.signInWithOAuth({
provider:"discord",
options:{
scopes:"identify guilds",
redirectTo: location.origin
}
});

}

init();
