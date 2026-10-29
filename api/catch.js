// Milk-catching rounds + per-viewer milk balance ("молочко"), backed by the
// same Upstash Redis used by stats.js. The widget opens a round when the
// flood happens; the Twitch bot (the only thing that can actually post
// "!ловлю" results) calls action=catch for every catch and action=balance
// for "!молочко", and action=request to spend balance on a "!просьба"
// (queued for the widget to show via action=requests). action=catch and
// action=request are gated by a shared secret so a random visitor can't
// credit or spend milk by hitting this URL directly.
const KV_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
const CATCH_SECRET = process.env.CATCH_SECRET;

const ROUND_KEY = "sonechka:round:remaining";
const CATCHES_KEY = "sonechka:round:catches";
const BALANCE_KEY = "sonechka:drinkers"; // reused: lifetime milk balance per Twitch login
const REQUESTS_KEY = "sonechka:requests"; // queue of paid "!просьба" asks, drained by the widget
const REQUEST_TEXT_MAX_LEN = 150;

function sanitizeRequestText(text) {
  return String(text || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, REQUEST_TEXT_MAX_LEN);
}

async function redis(...command) {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json; charset=utf-8" },
    body: Buffer.from(JSON.stringify(command), "utf-8"),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bot-Secret");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  if (!KV_URL || !KV_TOKEN) {
    res.status(500).json({ error: "stats storage not configured — connect Upstash Redis to this project in Vercel" });
    return;
  }

  try {
    if (req.method === "GET") {
      const action = req.query.action;
      if (action === "balance") {
        const user = String(req.query.user || "").toLowerCase().trim();
        if (!user) { res.status(400).json({ error: "missing user" }); return; }
        const score = await redis("ZSCORE", BALANCE_KEY, user);
        res.status(200).json({ user, liters: score ? Number(score) : 0 });
        return;
      }
      if (action === "status") {
        const [remainingRaw, catches] = await Promise.all([
          redis("GET", ROUND_KEY),
          redis("LRANGE", CATCHES_KEY, 0, -1),
        ]);
        res.status(200).json({
          active: remainingRaw !== null,
          remaining: remainingRaw !== null ? Number(remainingRaw) : 0,
          catches: catches || [],
        });
        return;
      }
      // просьбы, оплаченные литрами — бот кладёт их сюда (action=request),
      // виджет периодически вычерпывает всю очередь разом
      if (action === "requests") {
        const items = await redis("LRANGE", REQUESTS_KEY, 0, -1);
        if (items && items.length) await redis("DEL", REQUESTS_KEY);
        const requests = (items || [])
          .map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
          .filter(Boolean);
        res.status(200).json({ requests });
        return;
      }
      res.status(400).json({ error: "unknown action" });
      return;
    }

    if (req.method === "POST") {
      const rawBuf = await readRawBody(req);
      const body = rawBuf.length ? JSON.parse(rawBuf.toString("utf-8")) : {};
      const action = body.action;

      // открывает новый раунд ловли — вызывается виджетом в момент заливки
      if (action === "start") {
        const liters = Math.max(1, Math.round(Number(body.liters) || 10));
        const ttlSeconds = Math.max(5, Math.round(Number(body.ttlSeconds) || 30));
        await redis("SET", ROUND_KEY, liters, "EX", ttlSeconds);
        await redis("DEL", CATCHES_KEY);
        res.status(200).json({ ok: true, liters });
        return;
      }

      // засчитывает одну пойманную дойку (1 литр) — только для бота, с секретом
      if (action === "catch") {
        if (!CATCH_SECRET || req.headers["x-bot-secret"] !== CATCH_SECRET) {
          res.status(401).json({ error: "unauthorized" });
          return;
        }
        const user = String(body.user || "").toLowerCase().trim();
        if (!user) { res.status(400).json({ error: "missing user" }); return; }
        // проверяем до декремента: DECRBY на отсутствующем ключе сам создаёт
        // его (как 0) БЕЗ TTL, и раунд выглядел бы "активным" вечно
        const currentRaw = await redis("GET", ROUND_KEY);
        if (currentRaw === null) {
          res.status(200).json({ ok: true, caught: false, reason: "no_round" });
          return;
        }
        if (Number(currentRaw) <= 0) {
          res.status(200).json({ ok: true, caught: false, reason: "empty", remaining: 0 });
          return;
        }
        const remaining = await redis("DECRBY", ROUND_KEY, 1);
        if (remaining < 0) {
          await redis("INCRBY", ROUND_KEY, 1); // кто-то поймал параллельно последний литр — компенсируем
          res.status(200).json({ ok: true, caught: false, reason: "empty", remaining: 0 });
          return;
        }
        await Promise.all([
          redis("ZINCRBY", BALANCE_KEY, 1, user),
          redis("RPUSH", CATCHES_KEY, user),
        ]);
        await redis("EXPIRE", CATCHES_KEY, 60); // не держим список поймавших вечно
        const balance = await redis("ZSCORE", BALANCE_KEY, user);
        res.status(200).json({ ok: true, caught: true, remaining, balance: Number(balance) });
        return;
      }

      // "!просьба <текст>" — списывает литры с баланса зрителя и кладёт
      // просьбу в очередь для виджета; только для бота, с секретом
      if (action === "request") {
        if (!CATCH_SECRET || req.headers["x-bot-secret"] !== CATCH_SECRET) {
          res.status(401).json({ error: "unauthorized" });
          return;
        }
        const user = String(body.user || "").toLowerCase().trim();
        const text = sanitizeRequestText(body.text);
        const cost = Math.max(1, Math.min(1000, Math.round(Number(body.cost) || 1)));
        if (!user || !text) { res.status(400).json({ error: "missing user or text" }); return; }
        // как и с раундом ловли: списываем сразу, и если ушли в минус (не
        // хватило) — компенсируем обратно, а не проверяем-потом-списываем
        // отдельными командами (гонка между двумя просьбами подряд)
        const afterSpend = Number(await redis("ZINCRBY", BALANCE_KEY, -cost, user));
        if (afterSpend < 0) {
          await redis("ZINCRBY", BALANCE_KEY, cost, user);
          res.status(200).json({ ok: true, spent: false, balance: afterSpend + cost });
          return;
        }
        await redis("RPUSH", REQUESTS_KEY, JSON.stringify({ user, text }));
        await redis("LTRIM", REQUESTS_KEY, -50, -1); // не копим бесконечно, если виджет долго офлайн
        res.status(200).json({ ok: true, spent: true, balance: afterSpend });
        return;
      }

      res.status(400).json({ error: "unknown action" });
      return;
    }

    res.status(405).end();
  } catch (e) {
    res.status(502).json({ error: "kv failed", detail: String(e) });
  }
};
