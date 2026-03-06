const view = document.getElementById("view");

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

async function init(){

try{

view.innerHTML = "Проверка авторизации...";

const { data:{ session }, error } = await supabase.auth.getSession();

if(error){
view.innerHTML = "Ошибка Supabase: " + error.message;
return;
}

if(!session){

view.innerHTML = `
<h2>Lunaria Fox Dashboard</h2>
<button onclick="login()">Login with Discord</button>
`;

return;

}

view.innerHTML = `
<h2>Ты вошла через Discord</h2>

<button onclick="logout()">Выйти</button>

<h3>Серверы с ботом</h3>

<div id="guilds">Загрузка серверов...</div>
`;

loadGuilds();

}catch(e){

view.innerHTML = "Ошибка JS: " + (e.message || String(e));

}

}

async function loadGuilds(){

const guildsDiv = document.getElementById("guilds");

const { data, error } = await supabase
.from("bot_guilds")
.select("*");

if(error){
guildsDiv.innerHTML = "Ошибка загрузки серверов: " + error.message;
return;
}

if(!data || data.length===0){
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

window.logout = async function(){

await supabase.auth.signOut();
location.reload();

}

init();
