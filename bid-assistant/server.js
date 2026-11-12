#!/usr/bin/env node
/* Zero-dependency static server for local use: `node bid-assistant/server.js [port]`. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

// Relay for map servers that refuse cross-origin browser requests. Only the public data hosts
// the packs use are allowed, so this cannot be used as an open proxy.
const ALLOWED = new Set(['services6.arcgis.com', 'services.arcgis.com', 'psearch.kitsap.gov', 'hazards.fema.gov', 'gis.ecology.wa.gov',
  'fwspublicservices.wim.usgs.gov', 'data.wsdot.wa.gov', 'gis.dnr.wa.gov', 'wisaard.dahp.wa.gov', 'elevation.nationalmap.gov']);

async function relay(req, res, target) {
  let u;
  try { u = new URL(target); } catch (e) { res.writeHead(400).end('Bad url'); return; }
  if (u.protocol !== 'https:' || !ALLOWED.has(u.hostname)) { res.writeHead(403).end('Host not allowed'); return; }
  try {
    const init = { method: req.method, signal: AbortSignal.timeout(45000) };
    if (req.method === 'POST') {
      const chunks = []; let size = 0;
      for await (const c of req) { size += c.length; if (size > 2e6) { res.writeHead(413).end('Too large'); return; } chunks.push(c); }
      init.body = Buffer.concat(chunks);
      init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    }
    const r = await fetch(u, init);
    const buf = Buffer.from(await r.arrayBuffer());
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json' });
    res.end(buf);
  } catch (e) { res.writeHead(502, { 'Content-Type': 'text/plain' }).end('Relay failed: ' + e.message); }
}

http.createServer((req, res) => {
  const full = new URL(req.url, 'http://x');
  if (full.pathname === '/proxy/ping') { res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok'); return; }
  if (full.pathname === '/proxy') { relay(req, res, full.searchParams.get('url') || ''); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end('Method not allowed'); return; }
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400).end('Bad request'); return; }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) { res.writeHead(403).end('Forbidden'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  });
}).listen(PORT, () => console.log('Bid assistant: http://localhost:' + PORT));
