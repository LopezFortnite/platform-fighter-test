/**
 * Client half of the netplay link.
 *
 * Wraps one WebSocket to the relay and turns its messages into events. Knows
 * nothing about the simulation — see `lockstep.js` for that.
 *
 * The address defaults to the page's own origin, which is right when `server.js`
 * is serving both the files and the socket. It is **overridable** because that
 * stops being true the moment the game is hosted somewhere static: a CDN has no
 * WebSocket server behind it, so the relay has to live elsewhere and be named
 * explicitly. See `relayURL`.
 */
export const NET = {
  /** Frames of input delay. See `lockstep.js` for why this is the number. */
  DELAY: 3,
  /** How often to exchange a state hash, in frames. */
  SYNC_EVERY: 30,
};

function relayURL() {
  /**
   * An explicit relay, for deployments where the page and the socket are not
   * the same machine. Set it in `index.html` before the module loads:
   *
   *     <script>window.CLASH_RELAY = 'wss://my-relay.example.com';</script>
   *
   * Static hosts — Cloudflare Pages, GitHub Pages, Netlify — serve files and
   * nothing else, so without this the client would dial its own origin, find
   * no server there, and report the relay as down.
   */
  const override = typeof window !== 'undefined' && window.CLASH_RELAY;
  if (override) return String(override).replace(/^http/, "ws").replace(new RegExp("/+$"), "");

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}

export class Connection {
  constructor() {
    this.ws = null;
    /** 'idle' | 'connecting' | 'hosting' | 'joining' | 'paired' | 'closed' */
    this.state = 'idle';
    this.code = null;
    /** 0 for the host, 1 for the joiner. Decides which fighter slot you drive. */
    this.seat = -1;
    this.error = null;
    this.handlers = {};
  }

  on(type, fn) { this.handlers[type] = fn; return this; }

  _emit(type, msg) { if (this.handlers[type]) this.handlers[type](msg); }

  connect() {
    if (this.ws) return Promise.resolve();
    this.state = 'connecting';
    this.error = null;
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(relayURL()); } catch (e) { reject(e); return; }
      this.ws = ws;
      ws.onopen = () => resolve();
      ws.onerror = () => {
        // A failure before `open` is "no relay there"; after, it is a drop.
        if (this.state === 'connecting') {
          this.error = 'could not reach the relay';
          this.state = 'closed';
          reject(new Error(this.error));
        }
      };
      ws.onclose = () => {
        if (this.state !== 'closed') {
          this.state = 'closed';
          this._emit('closed');
        }
      };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        this._receive(msg);
      };
    });
  }

  _receive(msg) {
    switch (msg.t) {
      case 'hosted':
        this.code = msg.code; this.seat = msg.seat; this.state = 'hosting';
        this._emit('hosted', msg);
        break;
      case 'joined':
        this.code = msg.code; this.seat = msg.seat; this.state = 'paired';
        this._emit('paired', msg);
        break;
      case 'peerJoined':
        this.state = 'paired';
        this._emit('paired', msg);
        break;
      case 'peerLeft':
        this._emit('peerLeft', msg);
        break;
      case 'error':
        this.error = msg.message;
        this._emit('error', msg);
        break;
      default:
        this._emit(msg.t, msg);
        break;
    }
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }

  host() { this.send({ t: 'host' }); }

  join(code) { this.state = 'joining'; this.send({ t: 'join', code }); }

  close() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.send({ t: 'bye' });
    this.state = 'closed';
    if (this.ws) { this.ws.onclose = null; this.ws.close(); }
    this.ws = null;
    this.code = null;
    this.seat = -1;
  }
}
