// Sonechka's Twitch chat bot.
// Listens for the "catch" command during a flood round and credits the
// catcher 1 litre of milk via the /api/catch backend (which is the single
// source of truth for rounds and balances — this bot holds no Redis
// credentials itself). Answers "!молочко" by looking up the sender's balance,
// "!просьба <текст>" spends balance to queue an ask for the widget, and
// "!взболтать <N>" gambles N litres on a random outcome (backend decides it).
const tmi = require("tmi.js");

const BOT_USERNAME = requireEnv("TWITCH_BOT_USERNAME");
const BOT_OAUTH_TOKEN = requireEnv("TWITCH_BOT_OAUTH_TOKEN"); // "oauth:xxxxxxxx"
const CHANNEL = requireEnv("TWITCH_CHANNEL").replace(/^#/, "").toLowerCase();
const CATCH_API_URL = requireEnv("CATCH_API_URL"); // e.g. https://da-roulette.vercel.app/api/catch
const CATCH_SECRET = requireEnv("CATCH_SECRET"); // must match the Vercel project's CATCH_SECRET
const CATCH_COMMAND = (process.env.CATCH_COMMAND || "!ловлю").trim().toLowerCase();
const BALANCE_COMMAND = (process.env.BALANCE_COMMAND || "!молочко").trim().toLowerCase();
const REQUEST_COMMAND = (process.env.REQUEST_COMMAND || "!просьба").trim().toLowerCase();
const REQUEST_COST = Math.max(1, Math.round(Number(process.env.REQUEST_COST) || 1));
const SHAKE_COMMAND = (process.env.SHAKE_COMMAND || "!взболтать").trim().toLowerCase();

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

async function spendOnRequest(user, text, cost) {
  const res = await fetch(CATCH_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bot-Secret": CATCH_SECRET },
    body: JSON.stringify({ action: "request", user, text, cost }),
  });
  return res.json();
}

async function shakeMilk(user, amount) {
  const res = await fetch(CATCH_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bot-Secret": CATCH_SECRET },
    body: JSON.stringify({ action: "shake", user, amount }),
  });
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
  const original = message.trim();
  const text = original.toLowerCase();
  const login = (tags.username || "").toLowerCase();
  if (!login) return;

  if (text === REQUEST_COMMAND || text.startsWith(REQUEST_COMMAND + " ")) {
    const requestText = original.slice(REQUEST_COMMAND.length).trim();
    const displayName = tags["display-name"] || tags.username;
    if (!requestText) {
      await client.say(channel, `@${displayName}, напиши просьбу после команды: ${REQUEST_COMMAND} <что сделать>`);
      return;
    }
    try {
      const result = await spendOnRequest(login, requestText, REQUEST_COST);
      if (result.spent) {
        await client.say(channel, `@${displayName}, принято! (осталось ${formatLiters(result.balance)} л) 📣`);
      } else {
        await client.say(channel, `@${displayName}, не хватает молочка — нужно ${REQUEST_COST} л, у тебя ${formatLiters(result.balance)} 🥛`);
      }
    } catch (e) {
      console.error("request spend failed", e);
    }
    return;
  }

  if (text === SHAKE_COMMAND || text.startsWith(SHAKE_COMMAND + " ")) {
    const argStr = original.slice(SHAKE_COMMAND.length).trim().replace(",", ".");
    const amount = parseFloat(argStr);
    const displayName = tags["display-name"] || tags.username;
    if (!(amount > 0)) {
      await client.say(channel, `@${displayName}, укажи сколько взболтать: ${SHAKE_COMMAND} <число>`);
      return;
    }
    try {
      const result = await shakeMilk(login, amount);
      if (!result.staked) {
        await client.say(channel, `@${displayName}, не хватает молочка — у тебя ${formatLiters(result.balance)} л 🥛`);
        return;
      }
      if (result.outcome === "doubled") {
        await client.say(channel, `@${displayName}, взболтал(а) — и молоко удвоилось! 🎉 (теперь ${formatLiters(result.balance)} л)`);
      } else if (result.outcome === "transferred") {
        await client.say(channel, `@${displayName}, взболтал(а) — и молоко улетело к @${result.to}! 🌀 (осталось ${formatLiters(result.balance)} л)`);
      } else {
        await client.say(channel, `@${displayName}, взболтал(а)... и расплескал(а) всё 😩 (осталось ${formatLiters(result.balance)} л)`);
      }
    } catch (e) {
      console.error("shake request failed", e);
    }
    return;
  }

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

// Текстовые команды прямо в этом же окне консоли — набрал и Enter, без
// закрытия самого процесса (и без второго окна/веб-панели).
const readline = require("readline");
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const cmd = line.trim().toLowerCase();
  if (cmd === "stop" || cmd === "выкл") {
    client.disconnect().then(() => console.log("отключено от чата (наберите start, чтобы вернуть)"));
  } else if (cmd === "start" || cmd === "вкл") {
    client.connect().catch((e) => console.error("не удалось подключиться", e));
  } else if (cmd) {
    console.log("команды: stop — отключить бота от чата, start — подключить обратно");
  }
});
console.log("готово. команды: stop — отключить, start — подключить обратно");

// Капризы в чат ("АЛЁ Я ГОЛОДНАЯ((((" и т.п.): виджет сам решает когда и что
// сказать и кладёт готовый текст на /api/nag, бот просто периодически
// проверяет и озвучивает. Тот же Vercel-проект, что и у catch/stats.
const NAG_API_URL = CATCH_API_URL.replace(/\/api\/catch$/, "/api/nag");
async function checkNag() {
  try {
    const res = await fetch(`${NAG_API_URL}?action=pending`);
    const json = await res.json();
    if (json.text) await client.say(`#${CHANNEL}`, json.text);
  } catch (e) {
    console.error("nag check failed", e);
  }
}
setInterval(checkNag, 20 * 1000);

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
