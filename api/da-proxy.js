// Relays requests to the DonationAlerts REST API and adds the CORS headers
// DonationAlerts' own server doesn't send, so a widget hosted on a different
// origin (e.g. GitHub Pages) can call it from the browser.
module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const path = req.query.path;
  if (!path || Array.isArray(path)) {
    res.status(400).json({ error: "missing path" });
    return;
  }

  try {
    const upstream = await fetch(`https://www.donationalerts.com/api/v1/${path}`, {
      method: req.method,
      headers: {
        Authorization: req.headers.authorization || "",
        "Content-Type": "application/json",
      },
      body: req.method === "POST" ? JSON.stringify(req.body) : undefined,
    });
    const text = await upstream.text();
    res.status(upstream.status).setHeader("Content-Type", "application/json").send(text);
  } catch (e) {
    res.status(502).json({ error: "upstream fetch failed", detail: String(e) });
  }
}
