// Мост "виджет просит каприз в чат" -> "бот говорит в чат". Виджет сам решает
// когда и что сказать (по своим настройкам/фразам) и шлёт готовый текст сюда;
// бот поллит GET ?action=pending и озвучивает. Эндпоинт публичный (без
// секрета, он виден в исходниках sonechka.html) — поэтому вся защита от
// спама тут в виде кулдауна: максимум одна реплика в чат за COOLDOWN_SECONDS,
// кто бы его ни дёргал и сколько раз.
const KV_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

const PENDING_KEY = "sonechka:nag:pending";
const COOLDOWN_KEY = "sonechka:nag:cooldown";
const COOLDOWN_SECONDS = 15 * 60;
const PENDING_TTL_SECONDS = 120;
const MAX_LEN = 200;

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

// убирает управляющие символы и переносы строк (чтобы нельзя было впихнуть
// что-то кроме одной реплики), обрезает длину — остальное (сам текст) это
// фразы, которые стример сам прописал в настройках виджета
function sanitize(text) {
  return String(text || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_LEN);
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  if (!KV_URL || !KV_TOKEN) {
    res.status(500).json({ error: "stats storage not configured — connect Upstash Redis to this project in Vercel" });
    return;
  }

  try {
    if (req.method === "GET") {
      if (req.query.action !== "pending") { res.status(400).json({ error: "unknown action" }); return; }
      const text = await redis("GET", PENDING_KEY);
      if (text) await redis("DEL", PENDING_KEY);
      res.status(200).json({ text: text || null });
      return;
    }

    if (req.method === "POST") {
      const rawBuf = await readRawBody(req);
      const body = rawBuf.length ? JSON.parse(rawBuf.toString("utf-8")) : {};
      const clean = sanitize(body.text);
      if (!clean) { res.status(400).json({ error: "empty text" }); return; }
      const onCooldown = await redis("GET", COOLDOWN_KEY);
      if (onCooldown) { res.status(200).json({ ok: true, skipped: true, reason: "cooldown" }); return; }
      await redis("SET", PENDING_KEY, clean, "EX", PENDING_TTL_SECONDS);
      await redis("SET", COOLDOWN_KEY, "1", "EX", COOLDOWN_SECONDS);
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).end();
  } catch (e) {
    res.status(502).json({ error: "kv failed", detail: String(e) });
  }
};
