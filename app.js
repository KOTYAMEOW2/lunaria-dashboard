const SUPABASE_URL="https://hqggzsfcswtqgwejblxe.supabase.co";
const SUPABASE_KEY="sb_publishable_6AmJxlgJz9BN47fIagW5lg_zjxAguyd";
const CLIENT_ID="1473237338460127382";

const supabase=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY);
const view=document.getElementById("view");

function showError(text){
  const box=document.createElement("div");
  box.style.marginTop="12px";
  box.style.padding="12px";
  box.style.border="1px solid rgba(255,100,120,.35)";
  box.style.borderRadius="12px";
  box.style.background="rgba(255,100,120,.08)";
  box.style.whiteSpace="pre-wrap";
  box.innerText=text;
  view.appendChild(box);
}

async function login(){
  await supabase.auth.signInWithOAuth({
    provider:"discord",
    options:{
      scopes:"identify guilds",
      redirectTo: location.origin + location.pathname
    }
  });
}

async function fetchGuilds(session){
  if(!session?.provider_token){
    throw new Error("У сессии нет provider_token Discord. Нажми 'Выйти' и войди заново.");
  }

  const res=await fetch("https://discord.com/api/users/@me/guilds",{
    headers:{Authorization:"Bearer "+session.provider_token}
  });

  if(!res.ok){
    const txt=await res.text().catch(()=>res.statusText || "Unknown error");
    throw new Error("Discord guilds error "+res.status+": "+txt);
  }

  return await res.json();
}

async function loadGuilds(session){

  view.innerHTML="<h2>Гильдии</h2><p>Показываю только те, где ты owner или у тебя есть Manage Server.</p>";

  try{

    const guilds=await fetchGuilds(session);

    const {data:botGuilds,error:botErr}=await supabase
      .from("bot_guilds")
      .select("guild_id");

    if(botErr) throw new Error("Supabase bot_guilds error: "+botErr.message);

    const botSet=new Set((botGuilds||[]).map(g=>g.guild_id));

    let shown=0;

    guilds.forEach(g=>{

      const perms = typeof g.permissions === "string"
        ? parseInt(g.permissions,10)
        : (g.permissions||0);

      if(!(g.owner || (perms & 0x20) === 0x20 || (perms & 0x8) === 0x8)) return;

      shown++;

      const div=document.createElement("div");
      div.className="guild";

      const name=document.createElement("div");
      name.innerHTML="<b>"+g.name+"</b><br><small>ID: "+g.id+"</small>";

      const btn=document.createElement("button");

      if(botSet.has(g.id)){
        btn.innerText="Manage";
        btn.onclick=()=>openGuild(g.id);
      }else{
        btn.innerText="Invite";
        btn.onclick=()=>window.open(
          "https://discord.com/oauth2/authorize?client_id="+CLIENT_ID+
          "&scope=bot%20applications.commands&permissions=8&guild_id="+g.id,
          "_blank"
        );
      }

      div.appendChild(name);
      div.appendChild(btn);
      view.appendChild(div);

    });

    if(shown===0){
      showError("Не найдено ни одной гильдии, где у тебя есть Owner / Manage Server / Administrator.");
    }

  }catch(err){
    showError(err.message || String(err));
  }
}

async function openGuild(id){

  try{

    const {data,error}=await supabase
      .from("guild_rules")
      .select("*")
      .eq("guild_id",id)
      .single();

    if(error && error.code !== "PGRST116"){
      throw error;
    }

    const rules=data?.rules_md||"";

    view.innerHTML=`
    <h2>Rules</h2>

    <textarea id="rules" style="width:100%;height:200px">${rules}</textarea>

    <br><br>

    <button onclick="saveRules('${id}')">Save</button>

    <br><br>

    <button onclick="location.reload()">Back</button>
    `;

  }catch(err){

    view.innerHTML='<button onclick="location.reload()">Back</button>';
    showError("Не удалось открыть Rules: " + (err.message || String(err)));

  }

}

async function saveRules(id){

  const text=document.getElementById("rules").value;

  const {error}=await supabase
    .from("guild_rules")
    .upsert({
      guild_id:id,
      rules_md:text,
      updated_at:new Date().toISOString()
    });

  if(error){
    alert("Save error: " + error.message);
    return;
  }

  alert("Saved");

}

async function init(){

  const {data:{session}}=await supabase.auth.getSession();

  if(!session){
    view.innerHTML='<button onclick="login()">Login with Discord</button>';
    return;
  }

  loadGuilds(session);

}

window.login = login;
window.saveRules = saveRules;

init();
