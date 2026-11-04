// Relays the iHAQ Donate test-trigger call and adds CORS headers — iHAQ's own
// server doesn't send them, so a widget hosted on a different origin
// (e.g. GitHub Pages) can't call it directly from the browser.
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const token = req.query.token;
  if (!token || Array.isArray(token)) {
    res.status(400).json({ error: "missing token" });
    return;
  }

  try {
    const upstream = await fetch(`https://ihaqdonate.com/api/v1/integration/test/${encodeURIComponent(token)}`, {
      method: req.method,
    });
    const text = await upstream.text();
    res.status(upstream.status).setHeader("Content-Type", "application/json").send(text);
  } catch (e) {
    res.status(502).json({ error: "upstream fetch failed", detail: String(e) });
  }
}
