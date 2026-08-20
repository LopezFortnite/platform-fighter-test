/**
 * Zero-dependency static server. ES modules require a real origin (file:// is blocked
 * by CORS), so the prototype is served rather than opened directly.
 *
 *   node server.js  ->  http://localhost:5173
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
/**
 * Port, in the order a host expects it.
 *
 * `process.env.PORT` first, because every platform-as-a-service assigns the
 * port that way and ignoring it is the usual reason a deploy comes up
 * unreachable. An explicit argument still wins locally.
 */
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  // The stage select art is all .webp. Without an entry it falls back to
  // octet-stream, which browsers happen to sniff correctly today — but that is
  // luck, not a contract, and it is one line to be right about.
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);

  /**
   * Dev-only screenshot sink. The page POSTs a canvas data URL here and it is
   * written to capture/ — lets the render be inspected at full quality without
   * depending on an external screenshot tool.
   */
  if (req.method === 'POST' && urlPath === '/__capture') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const m = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(body);
      if (!m) { res.writeHead(400).end('expected an image data URL'); return; }
      const dir = path.join(ROOT, 'capture');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir);
      const name = (req.headers['x-capture-name'] || 'shot').replace(/[^\w.-]/g, '');
      const file = path.join(dir, `${name}.${m[1] === 'png' ? 'png' : 'jpg'}`);
      fs.writeFile(file, Buffer.from(m[2], 'base64'), (err) => {
        if (err) { res.writeHead(500).end(String(err)); return; }
        res.writeHead(200).end(file);
      });
    });
    return;
  }
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = path.join(ROOT, rel);

  // Refuse to serve anything outside the project directory.
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    }).end(data);
  });
});

/**
 * Netplay relay.
 *
 * Lives on the same origin and port as the page, which is the whole reason the
 * client never needs a URL configured: it derives the socket address from
 * `location`. One process to start, and a LAN opponent only needs the host's
 * address.
 *
 * The protocol is deliberately tiny. Clients send `{t, ...}` JSON:
 *   host                     -> hosted {code, seat}
 *   join {code}              -> joined {code, seat} | error {message}
 *   ready {def}              -> relayed to the peer as `peerReady`
 *   input {frame, pad}       -> relayed verbatim as `peerInput`
 *   sync {frame, hash}       -> relayed verbatim as `peerSync`
 *   bye                      -> leave the room
 * Anything with an unknown `t` is relayed to the peer untouched, so the client
 * can add message kinds without the server learning about them.
 */
const { attach } = require('./src/net/wsserver.js');
const { Rooms } = require('./src/net/rooms.js');

const rooms = new Rooms();

attach(server, (conn) => {
  conn.room = null;
  conn.seat = -1;

  conn.onMessage = (text) => {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'host') {
      const r = rooms.host(conn);
      conn.send(JSON.stringify(r.error ? { t: 'error', message: r.error } : { t: 'hosted', ...r }));
      return;
    }
    if (msg.t === 'join') {
      const r = rooms.join(conn, msg.code);
      if (r.error) { conn.send(JSON.stringify({ t: 'error', message: r.error })); return; }
      conn.send(JSON.stringify({ t: 'joined', ...r }));
      // Both sides need to know the room filled, and the host learns it here.
      for (const p of rooms.peers(conn)) p.send(JSON.stringify({ t: 'peerJoined' }));
      return;
    }
    if (msg.t === 'bye') { rooms.leave(conn); return; }

    // Everything else is opaque traffic between the two clients.
    const relayed = JSON.stringify({ ...msg, t: `peer${msg.t[0].toUpperCase()}${msg.t.slice(1)}` });
    for (const p of rooms.peers(conn)) p.send(relayed);
  };

  conn.onClose = () => rooms.leave(conn);
});

server.listen(PORT, () => {
  console.log(`Clash Rumble prototype -> http://localhost:${PORT}`);
  console.log('Netplay relay attached on the same port (ws://).');
});
