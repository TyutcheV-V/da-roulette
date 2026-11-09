// OBS can use the local bot's working network connection to reach the API.
// Never inject the bot secret: privileged calls still need their own header.
const ALLOWED_ORIGINS = new Set(["https://tyutchev-v.github.io", "http://127.0.0.1:3000", "http://localhost:3000"]);
const API_PATHS = new Set(["/api/catch", "/api/stats", "/api/nag", "/api/da-proxy"]);
async function handleApiBridge(req, res, baseUrl) {
  const url = new URL(req.url, "http://localhost");
  if (!API_PATHS.has(url.pathname)) return false;
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    res.writeHead(403); res.end(); return true;
  }
  res.setHeader("Access-Control-Allow-Origin", origin || "https://tyutchev-v.github.io");
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Bot-Secret, Authorization");
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return true; }
  if (!["GET", "POST"].includes(req.method)) { res.writeHead(405); res.end(); return true; }
  try {
    const headers = {};
    for (const name of ["content-type", "authorization", "x-bot-secret"]) {
      if (req.headers[name]) headers[name] = req.headers[name];
    }
    let body;
    if (req.method === "POST") {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) { res.writeHead(413); res.end(); return true; }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }
    const upstream = await fetch(new URL(url.pathname + url.search, baseUrl), {
      method: req.method, headers, body, signal: AbortSignal.timeout(15000),
    });
    res.writeHead(upstream.status, { "Content-Type": upstream.headers.get("content-type") || "application/json" });
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "local_bridge_failed" }));
    console.warn("API bridge failed:", e.message);
  }
  return true;
}
module.exports = { handleApiBridge };
