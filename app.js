// ===== Discord 429 protection + cache =====
const DISCORD_API = "https://discord.com/api/v10";
const GUILDS_CACHE_KEY = "lunaria_guilds_cache_v1";
const GUILDS_CACHE_TTL_MS = 60_000; // 60 секунд

let guildsRequestInFlight = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readGuildsCache() {
  try {
    const raw = sessionStorage.getItem(GUILDS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.ts || !parsed.data) return null;
    if (Date.now() - parsed.ts > GUILDS_CACHE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeGuildsCache(data) {
  try {
    sessionStorage.setItem(
      GUILDS_CACHE_KEY,
      JSON.stringify({ ts: Date.now(), data })
    );
  } catch {}
}

async function discordFetchWithRetry(path, token, tries = 5) {
  let attempt = 0;

  while (attempt < tries) {
    attempt++;

    const res = await fetch(`${DISCORD_API}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    // OK
    if (res.ok) return res;

    // 429 rate limit
    if (res.status === 429) {
      let waitMs = 1000;

      // Discord часто возвращает JSON с retry_after (в секундах)
      try {
        const data = await res.clone().json();
        if (typeof data?.retry_after === "number") {
          waitMs = Math.ceil(data.retry_after * 1000);
        }
      } catch {}

      // иногда есть Retry-After header (сек)
      const ra = res.headers.get("Retry-After");
      if (ra && !Number.isNaN(Number(ra))) {
        waitMs = Math.max(waitMs, Math.ceil(Number(ra) * 1000));
      }

      // небольшой буфер, чтобы точно отпустило
      waitMs += 250;

      // можешь заменить на вывод в UI, если у тебя есть функция showError/showToast
      console.warn(`[Discord 429] waiting ${waitMs}ms then retry...`);

      await sleep(waitMs);
      continue;
    }

    // другие ошибки — выходим с текстом
    const txt = await res.text().catch(() => "");
    throw new Error(`Discord API error (${res.status}): ${txt}`);
  }

  throw new Error(`Discord API error: too many 429 retries`);
}

async function fetchUserGuildsSafe(token) {
  // 1) кеш
  const cached = readGuildsCache();
  if (cached) return cached;

  // 2) анти-дубль (если кто-то уже запросил — ждём тот же Promise)
  if (guildsRequestInFlight) return guildsRequestInFlight;

  guildsRequestInFlight = (async () => {
    const res = await discordFetchWithRetry("/users/@me/guilds", token, 6);
    const data = await res.json();
    writeGuildsCache(data);
    return data;
  })();

  try {
    return await guildsRequestInFlight;
  } finally {
    guildsRequestInFlight = null;
  }
}
// ===== end protection =====
