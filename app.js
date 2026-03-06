
const SUPABASE_URL="https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY="sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";
const CLIENT_ID="1473237338460127382";

const supabase=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const view=document.getElementById("view");

async function login(){
 await supabase.auth.signInWithOAuth({provider:"discord",options:{scopes:"identify guilds"}});
}

async function loadGuilds(session){
 const res=await fetch("https://discord.com/api/users/@me/guilds",{headers:{Authorization:"Bearer "+session.provider_token}});
 const guilds=await res.json();
 const {data:botGuilds}=await supabase.from("bot_guilds").select("guild_id");
 const botSet=new Set(botGuilds.map(g=>g.guild_id));

 view.innerHTML="";

 guilds.forEach(g=>{
  if(!(g.owner||(g.permissions&0x20)))return;

  const div=document.createElement("div");
  div.className="guild";

  const name=document.createElement("div");
  name.innerText=g.name;

  const btn=document.createElement("button");

  if(botSet.has(g.id)){
   btn.innerText="Manage";
   btn.onclick=()=>openGuild(g.id);
  }else{
   btn.innerText="Invite";
   btn.onclick=()=>window.open("https://discord.com/oauth2/authorize?client_id="+CLIENT_ID+"&scope=bot%20applications.commands&permissions=8&guild_id="+g.id,"_blank");
  }

  div.appendChild(name);
  div.appendChild(btn);
  view.appendChild(div);
 });
}

async function openGuild(id){
 const {data}=await supabase.from("guild_rules").select("*").eq("guild_id",id).single();
 const rules=data?.rules_md||"";

 view.innerHTML=`
 <h2>Rules</h2>
 <textarea id="rules" style="width:100%;height:200px">${rules}</textarea>
 <br><br>
 <button onclick="saveRules('${id}')">Save</button>
 <br><br>
 <button onclick="location.reload()">Back</button>
 `;
}

async function saveRules(id){
 const text=document.getElementById("rules").value;
 await supabase.from("guild_rules").upsert({guild_id:id,rules_md:text,updated_at:new Date().toISOString()});
 alert("Saved");
}

async function init(){
 const {data:{session}}=await supabase.auth.getSession();
 if(!session){view.innerHTML='<button onclick="login()">Login with Discord</button>';return;}
 loadGuilds(session);
}

init();
