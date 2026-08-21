import { packRaw, unpackRaw, quantiseRaw } from '../core/input.js';
import { NET } from './connection.js';

/**
 * Deterministic lockstep.
 *
 * ## Why this and not state sync
 *
 * The simulation is already a fixed 60Hz step with no randomness anywhere in
 * `game/`, `engine/` or `core/` — the only `Math.random` calls in the project
 * spawn visual embers, which never feed back into a fighter. Two machines
 * running the same inputs therefore produce the same match, so the only thing
 * that has to cross the wire is **input**: six bytes a frame per player,
 * against kilobytes for a serialised world. It also means neither side is
 * authoritative and neither has an advantage, which for a 1v1 fighter is worth
 * more than the latency hiding a client-predicted model would buy.
 *
 * ## Input delay
 *
 * Frame N is simulated using input both players gave on frame N - DELAY. The
 * local player's own input is delayed too — that is the part that feels wrong
 * to write and is essential: if your input applied immediately and your
 * opponent's did not, the two machines would be simulating different frames.
 *
 * At 60Hz, DELAY = 3 buys 50ms of headroom, which covers a LAN and most
 * same-country connections. Beyond that the link stalls rather than desyncs,
 * which is the right failure: a stalled frame is visible and recoverable, a
 * desync silently makes two different games.
 *
 * ## Stalls
 *
 * If the peer's input for the next frame has not arrived, `step()` returns
 * `false` and the caller renders the previous frame again. No rollback and no
 * prediction: the whole design is that nothing is ever speculatively applied,
 * so there is nothing to unwind.
 */
export class Lockstep {
  /**
   * @param {import('./connection.js').Connection} conn
   * @param {Array} inputs the two PlayerInput objects, in seat order
   */
  constructor(conn, inputs) {
    this.conn = conn;
    this.inputs = inputs;
    this.seat = conn.seat;
    /** Confirmed inputs per seat, keyed by frame. */
    this.queues = [new Map(), new Map()];
    /** Next frame to simulate. */
    this.frame = 0;
    /** Highest frame we have sent our own input for. */
    this.sent = -1;
    this.stalled = false;
    this.stallFrames = 0;
    this.longestStall = 0;
    this.desync = null;
    /** Our own state hashes, kept until the peer's matching hash arrives. */
    this.hashes = new Map();

    conn.on('peerInput', (m) => {
      this.queues[1 - this.seat].set(m.frame, m.pad);
    });
    conn.on('peerSync', (m) => this._checkSync(m));

    // Both seats hold neutral input through the delay window, so the first
    // DELAY frames are defined without anyone having pressed anything yet.
    const neutral = packRaw(quantiseRaw({
      x: 0, y: 0, cx: 0, cy: 0,
      held: {}, smashMod: false, walkMod: false,
      dpad: { up: false, down: false, left: false, right: false }, connected: true,
    }));
    for (let f = 0; f < NET.DELAY; f++) {
      this.queues[0].set(f, neutral);
      this.queues[1].set(f, neutral);
    }
    this.sent = NET.DELAY - 1;
  }

  /** True when both seats' input for the next frame is known. */
  get ready() {
    return this.queues[0].has(this.frame) && this.queues[1].has(this.frame);
  }

  /**
   * Samples the local device and publishes it for `frame + DELAY`.
   *
   * Sent every tick even while stalled: the peer may be waiting on exactly this
   * packet, and going quiet during a stall is how a brief hiccup turns into a
   * deadlock.
   */
  publishLocal() {
    const target = this.frame + NET.DELAY;
    if (target <= this.sent) return;
    for (let f = this.sent + 1; f <= target; f++) {
      const pad = packRaw(this.inputs[this.seat].readDevice());
      this.queues[this.seat].set(f, pad);
      this.conn.send({ t: 'input', frame: f, pad });
    }
    this.sent = target;
  }

  /**
   * Applies both seats' inputs for the current frame and advances.
   * @returns {boolean} false if the peer's input has not arrived yet
   */
  step() {
    if (!this.ready) {
      this.stalled = true;
      this.stallFrames++;
      this.longestStall = Math.max(this.longestStall, this.stallFrames);
      // Re-send the tail of our queue: the usual cause of a long stall is a
      // dropped packet, and the peer has no way to ask for it again.
      this._resendTail();
      return false;
    }
    this.stalled = false;
    this.stallFrames = 0;

    for (let seat = 0; seat < 2; seat++) {
      const pad = this.queues[seat].get(this.frame);
      this.inputs[seat].applyRaw(unpackRaw(pad));
    }
    this.frame++;
    this._pruneQueues();
    return true;
  }

  /**
   * Records a hash of the simulation and exchanges it periodically.
   *
   * This does not fix a desync — with lockstep there is no correct recovery
   * short of a full state transfer, which this design deliberately does not
   * have. It exists so that if the two matches ever diverge the players are
   * *told*, rather than each watching a different fight and blaming the other's
   * connection.
   */
  checkpoint(match) {
    if (this.frame % NET.SYNC_EVERY !== 0) return;
    const hash = hashMatch(match);
    this.hashes.set(this.frame, hash);
    this.conn.send({ t: 'sync', frame: this.frame, hash });
  }

  _checkSync(m) {
    const mine = this.hashes.get(m.frame);
    if (mine === undefined) return;
    this.hashes.delete(m.frame);
    if (mine !== m.hash && !this.desync) {
      this.desync = { frame: m.frame, mine, theirs: m.hash };
    }
  }

  _resendTail() {
    const seat = this.seat;
    const from = Math.max(0, this.sent - NET.DELAY * 2);
    for (let f = from; f <= this.sent; f++) {
      const pad = this.queues[seat].get(f);
      if (pad) this.conn.send({ t: 'input', frame: f, pad });
    }
  }

  /** Frames already simulated can never be needed again. */
  _pruneQueues() {
    const keep = this.frame - 2;
    if (keep < 0) return;
    for (const q of this.queues) {
      for (const f of q.keys()) if (f < keep) q.delete(f);
    }
  }
}

/**
 * A cheap fingerprint of everything that must match between the two machines.
 *
 * Positions and velocities are rounded before hashing. They are already
 * bit-identical when the simulation agrees — the rounding is so that a hash
 * mismatch means a *real* divergence rather than the last bit of a float, which
 * would otherwise produce false alarms nobody could act on.
 *
 * Effects are excluded on purpose: they are spawned with `Math.random` and are
 * purely visual, so they differ between machines by design.
 */
export function hashMatch(match) {
  let h = 2166136261;
  const mix = (v) => {
    h ^= v | 0;
    h = Math.imul(h, 16777619);
  };
  mix(match.frame);
  for (const f of match.fighters) {
    mix(Math.round(f.x * 16));
    mix(Math.round(f.y * 16));
    mix(Math.round(f.vx * 16));
    mix(Math.round(f.vy * 16));
    mix(Math.round(f.damage * 16));
    mix(f.stocks);
    mix(f.facing);
    mix(f.stateFrame);
    mix(f.hitstun);
    mix(f.move ? hashString(f.move.id) : 0);
  }
  for (const p of match.projectiles) {
    mix(Math.round(p.x * 16));
    mix(Math.round(p.y * 16));
  }
  return h >>> 0;
}

function hashString(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) | 0;
  return h;
}
