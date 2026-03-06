const view = document.getElementById("view");

const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY = "sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function show(text){
  view.innerHTML = text;
}

async function init(){

try{

show("Проверка сессии...");

const { data, error } = await supabase.auth.getSession();

if(error){
  show("Ошибка Supabase: " + error.message);
  return;
}

const session = data.session;

if(!session){

show(`
<h2>Lunaria Fox</h2>
<button onclick="login()">Login with Discord</button>
`);

return;
}

show("Сессия найдена. Загружаем серверы...");

loadGuilds();

}catch(e){

show("JS ошибка: " + (e.message || String(e)));

}

}

async function loadGuilds(){

try{

const { data, error } = await supabase
.from("bot_guilds")
.select("*");

if(error){
show("Ошибка загрузки серверов: " + error.message);
return;
}

if(!data || data.length===0){
show("Серверы не найдены в базе.");
return;
}

view.innerHTML = `
<h2>Серверы с ботом</h2>
<div id="guilds"></div>
`;

const guildsDiv = document.getElementById("guilds");

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

}catch(e){

show("Ошибка JS: " + (e.message || String(e)));

}

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
