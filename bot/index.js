// Sonechka's Twitch chat bot.
// Listens for the "catch" command during a flood round and credits the
// catcher 1 litre of milk via the /api/catch backend (which is the single
// source of truth for rounds and balances — this bot holds no Redis
// credentials itself). Answers "!молочко" by looking up the sender's balance.
const tmi = require("tmi.js");

const BOT_USERNAME = requireEnv("TWITCH_BOT_USERNAME");
const BOT_OAUTH_TOKEN = requireEnv("TWITCH_BOT_OAUTH_TOKEN"); // "oauth:xxxxxxxx"
const CHANNEL = requireEnv("TWITCH_CHANNEL").replace(/^#/, "").toLowerCase();
const CATCH_API_URL = requireEnv("CATCH_API_URL"); // e.g. https://da-roulette.vercel.app/api/catch
const CATCH_SECRET = requireEnv("CATCH_SECRET"); // must match the Vercel project's CATCH_SECRET
const CATCH_COMMAND = (process.env.CATCH_COMMAND || "!ловлю").trim().toLowerCase();
const BALANCE_COMMAND = (process.env.BALANCE_COMMAND || "!молочко").trim().toLowerCase();

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var ${name}`);
    process.exit(1);
  }
  return v;
}

async function reportCatch(user) {
  const res = await fetch(CATCH_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bot-Secret": CATCH_SECRET },
    body: JSON.stringify({ action: "catch", user }),
  });
  return res.json();
}

async function getBalance(user) {
  const res = await fetch(`${CATCH_API_URL}?action=balance&user=${encodeURIComponent(user)}`);
  return res.json();
}

function formatLiters(n) {
  const num = Number(n) || 0;
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

const client = new tmi.Client({
  identity: { username: BOT_USERNAME, password: BOT_OAUTH_TOKEN },
  channels: [CHANNEL],
});

client.on("connected", (addr, port) => {
  console.log(`connected to ${addr}:${port}, joined #${CHANNEL}`);
});

client.on("disconnected", (reason) => {
  console.warn("disconnected:", reason);
});

client.on("message", async (channel, tags, message, self) => {
  if (self) return;
  const text = message.trim().toLowerCase();
  const login = (tags.username || "").toLowerCase();
  if (!login) return;

  if (text === CATCH_COMMAND) {
    try {
      const result = await reportCatch(login);
      // намеренно молчим в чате на каждую дойку — иначе чат зафлудит при
      // дойке в 10 литров за несколько секунд; результат виден на экране
      if (!result.ok) console.warn("catch api error", result);
    } catch (e) {
      console.error("catch request failed", e);
    }
    return;
  }

  if (text === BALANCE_COMMAND) {
    try {
      const result = await getBalance(login);
      const displayName = tags["display-name"] || tags.username;
      await client.say(channel, `@${displayName}, у тебя ${formatLiters(result.liters)} л молочка 🥛`);
    } catch (e) {
      console.error("balance request failed", e);
    }
    return;
  }
});

client.connect().catch((e) => {
  console.error("failed to connect to Twitch", e);
  process.exit(1);
});

// Render's free Web Service tier requires binding to a port and answering
// HTTP, and spins the service down after inactivity unless something pings
// it — this endpoint is what an external uptime pinger (e.g. UptimeRobot)
// hits every few minutes to keep the bot connected during streams.
const http = require("http");
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Сонечка-бот жива\n");
}).listen(PORT, () => console.log(`health check server listening on :${PORT}`));
