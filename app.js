const SUPABASE_URL = "https://hqggzsfcswtqgwejblxe.supabase.co"
const SUPABASE_ANON_KEY = "PASTE_YOUR_ANON_KEY"

const { createClient } = window.supabase
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const view = document.getElementById("view")

const DISCORD_API = "https://discord.com/api/v10"

let guildCache = null
let guildCacheTime = 0
let guildRequestRunning = false

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function discordFetch(url, token) {

  let attempts = 0

  while (attempts < 5) {

    attempts++

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    })

    if (res.ok) return res

    if (res.status === 429) {

      let retry = 1000

      try {
        const data = await res.clone().json()
        if (data.retry_after) retry = data.retry_after * 1000
      } catch {}

      console.warn("Discord rate limit, waiting", retry)

      await sleep(retry + 200)

      continue
    }

    throw new Error("Discord API error " + res.status)
  }

  throw new Error("Too many Discord retries")
}

async function fetchGuilds(token) {

  if (guildCache && Date.now() - guildCacheTime < 60000) {
    return guildCache
  }

  if (guildRequestRunning) {
    await sleep(500)
    return guildCache
  }

  guildRequestRunning = true

  const res = await discordFetch(
    DISCORD_API + "/users/@me/guilds",
    token
  )

  const guilds = await res.json()

  guildCache = guilds
  guildCacheTime = Date.now()

  guildRequestRunning = false

  return guilds
}

async function render() {

  const { data } = await supabase.auth.getSession()

  const session = data.session

  if (!session) {

    view.innerHTML = `
    <button id="login">Login with Discord</button>
    `

    document.getElementById("login").onclick = async () => {

      await supabase.auth.signInWithOAuth({
        provider: "discord",
        options: {
          redirectTo: location.origin
        }
      })

    }

    return
  }

  const token = session.provider_token

  let guilds = []

  try {

    guilds = await fetchGuilds(token)

  } catch (err) {

    view.innerHTML = `
    <div class="error">
    Не смогла получить гильдии: ${err.message}
    </div>
    `

    return
  }

  const MANAGE_GUILD = 0x20

  const filtered = guilds.filter(
    g => g.owner || (g.permissions & MANAGE_GUILD)
  )

  let html = `
  <h2>Гильдии</h2>
  `

  if (!filtered.length) {

    html += `<div>Не нашла гильдий с правами управления</div>`

  } else {

    filtered.forEach(g => {

      html += `
      <div class="guild">
        <b>${g.name}</b>
        <div>ID: ${g.id}</div>
      </div>
      `
    })

  }

  view.innerHTML = html
}

render()
