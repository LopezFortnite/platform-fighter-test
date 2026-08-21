/**
 * A minimal RFC 6455 WebSocket server, written by hand.
 *
 * The rest of the project has no runtime dependencies and the static server is
 * plain `node:http`, so pulling in `ws` for one relay would be the largest
 * dependency in the repo by a wide margin. What netplay actually needs is a
 * small subset of the protocol — the opening handshake, text frames, close and
 * pong — and that subset is about a hundred lines.
 *
 * Deliberately not implemented, because the relay never needs them:
 *   - permessage-deflate (payloads here are a few dozen bytes)
 *   - fragmented frames (nothing sent is anywhere near a frame limit)
 *   - binary frames (the protocol is JSON)
 *
 * A frame longer than `MAX_FRAME` is dropped and the socket closed rather than
 * buffered, so a malformed or hostile client cannot grow a server-side buffer.
 */
const crypto = require('crypto');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_FRAME = 1 << 16;

const OP_TEXT = 0x1;
const OP_CLOSE = 0x8;
const OP_PING = 0x9;
const OP_PONG = 0xa;

/** Encodes a text payload as a single unmasked server frame. */
function encode(text) {
  const body = Buffer.from(text, 'utf8');
  const len = body.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  header[0] = 0x80 | OP_TEXT;      // FIN + text
  return Buffer.concat([header, body]);
}

/**
 * Wraps an upgraded socket. Emits decoded text messages to `onMessage`.
 */
class WSConnection {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.open = true;
    this.onMessage = null;
    this.onClose = null;

    socket.on('data', (chunk) => this._feed(chunk));
    socket.on('error', () => this.close());
    socket.on('close', () => {
      this.open = false;
      if (this.onClose) this.onClose();
    });
  }

  send(text) {
    if (!this.open) return;
    try { this.socket.write(encode(text)); } catch { this.close(); }
  }

  close() {
    if (!this.open) return;
    this.open = false;
    try {
      this.socket.write(Buffer.from([0x80 | OP_CLOSE, 0]));
      this.socket.end();
    } catch { /* already gone */ }
    if (this.onClose) this.onClose();
  }

  _feed(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    // Decode as many whole frames as the buffer holds; a partial tail is kept.
    for (;;) {
      const frame = this._readFrame();
      if (!frame) break;
      if (frame.op === OP_CLOSE) { this.close(); return; }
      if (frame.op === OP_PING) {
        try { this.socket.write(Buffer.from([0x80 | OP_PONG, 0])); } catch { /* gone */ }
        continue;
      }
      if (frame.op === OP_TEXT && this.onMessage) {
        this.onMessage(frame.payload.toString('utf8'));
      }
    }
  }

  /** @returns {{op:number,payload:Buffer}|null} null when a whole frame is not yet buffered */
  _readFrame() {
    const b = this.buf;
    if (b.length < 2) return null;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f;
    let off = 2;
    if (len === 126) {
      if (b.length < off + 2) return null;
      len = b.readUInt16BE(off); off += 2;
    } else if (len === 127) {
      if (b.length < off + 8) return null;
      const big = b.readBigUInt64BE(off); off += 8;
      if (big > BigInt(MAX_FRAME)) { this.close(); return null; }
      len = Number(big);
    }
    if (len > MAX_FRAME) { this.close(); return null; }
    // Every client-to-server frame must be masked; an unmasked one is a
    // protocol violation and the spec says to fail the connection.
    if (!masked) { this.close(); return null; }
    if (b.length < off + 4 + len) return null;
    const mask = b.subarray(off, off + 4); off += 4;
    const payload = Buffer.allocUnsafe(len);
    for (let i = 0; i < len; i++) payload[i] = b[off + i] ^ mask[i & 3];
    this.buf = b.subarray(off + len);
    return { op, payload };
  }
}

/**
 * Attaches WebSocket upgrade handling to an existing http server.
 * @param {import('http').Server} server
 * @param {(conn: WSConnection) => void} onConnection
 */
function attach(server, onConnection) {
  server.on('upgrade', (req, socket) => {
    const key = req.headers['sec-websocket-key'];
    if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    socket.setNoDelay(true);      // latency matters far more than packing here
    onConnection(new WSConnection(socket));
  });
}

module.exports = { attach };
