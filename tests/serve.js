// Tiny local web server for the browser tests: serves a folder like Vercel serves this site.
// Usage: node tests/serve.js <port> [folder]
const http = require("http"), fs = require("fs"), path = require("path");
const port = Number(process.argv[2] || 4173), root = path.resolve(process.argv[3] || path.join(__dirname, ".."));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json", ".csv": "text/csv" };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = path.join(root, p);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
}).listen(port, () => console.log("serving " + root + " on " + port));
