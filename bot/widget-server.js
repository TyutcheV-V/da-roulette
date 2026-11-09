const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const TYPES = { ".png":"image/png", ".webp":"image/webp", ".svg":"image/svg+xml", ".gif":"image/gif", ".jpg":"image/jpeg", ".mp4":"video/mp4", ".mp3":"audio/mpeg" };
function serveWidget(req, res) {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/sonechka.html") {
    let html = fs.readFileSync(path.join(ROOT, "sonechka.html"), "utf8");
    const seedPath = path.join(__dirname, ".widget-bootstrap.json");
    if (fs.existsSync(seedPath)) {
      const seed = JSON.stringify(JSON.parse(fs.readFileSync(seedPath, "utf8"))).replace(/</g, "\\u003c");
      html = html.replace("<head>", `<head><script>for(const [k,v] of Object.entries(${seed})){if(localStorage.getItem(k)===null)localStorage.setItem(k,JSON.stringify(v))}</script>`);
    }
    res.writeHead(200, { "Content-Type":"text/html; charset=utf-8", "Cache-Control":"no-store" });
    res.end(html); return true;
  }
  if (!/^\/(images|sounds)\//.test(url.pathname)) return false;
  let file;
  try { file = path.resolve(ROOT, "." + decodeURIComponent(url.pathname)); } catch { res.writeHead(400); res.end(); return true; }
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); res.end(); return true; }
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error("not file");
    res.writeHead(200, { "Content-Type":TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Content-Length":stat.size });
    if(req.method === "HEAD") res.end(); else fs.createReadStream(file).pipe(res);
  } catch { res.writeHead(404); res.end(); }
  return true;
}
module.exports = { serveWidget };
