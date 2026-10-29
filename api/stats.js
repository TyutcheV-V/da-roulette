// Leaderboard storage for Sonechka — who donated most towards milk, and which
// Twitch chatters caught (drank) the most. Backed by Upstash Redis, connected
// to this Vercel project via the Marketplace integration.
const KV_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

async function redis(...command) {
  const res = await fetch(KV_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${KV_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  return json.result;
}

function pairUp(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (let i = 0; i < arr.length; i += 2) out.push({ name: arr[i], score: Number(arr[i + 1]) });
  return out;
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
    if (req.method === "GET" && req.query.debug === "1") {
      const raw = await redis("ZREVRANGE", "sonechka:donors", 0, 19, "WITHSCORES");
      res.status(200).json({ raw, charCodes: raw.map(s => typeof s === "string" ? Array.from(s).map(c=>c.charCodeAt(0)) : s) });
      return;
    }
    if (req.method === "GET") {
      const [donors, drinkers] = await Promise.all([
        redis("ZREVRANGE", "sonechka:donors", 0, 19, "WITHSCORES"),
        redis("ZREVRANGE", "sonechka:drinkers", 0, 19, "WITHSCORES"),
      ]);
      res.status(200).json({ donors: pairUp(donors), drinkers: pairUp(drinkers) });
      return;
    }
    if (req.method === "POST") {
      const { type, name, amount } = req.body || {};
      if (!name || !amount || (type !== "donor" && type !== "drinker")) {
        res.status(400).json({ error: "bad request" });
        return;
      }
      const key = type === "donor" ? "sonechka:donors" : "sonechka:drinkers";
      await redis("ZINCRBY", key, Number(amount), String(name).slice(0, 64));
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).end();
  } catch (e) {
    res.status(502).json({ error: "kv failed", detail: String(e) });
  }
};
