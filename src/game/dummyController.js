import { PlayerInput, ACTIONS } from '../core/input.js';
import { INPUT } from '../config/gameplay.js';
import { sign, clamp } from '../core/math.js';
import { S } from './states.js';

/**
 * Training dummy.
 *
 * Implemented as a drop-in replacement for a PlayerInput rather than as a
 * special case inside Fighter — the fighter stays completely input-agnostic,
 * so the dummy is subject to exactly the same rules, physics and frame data a
 * human is.
 *
 * Behaviour, per the brief: it stands still. The moment it is knocked off the
 * stage it tries to get back, using its double jump first and its up special
 * second — the same two-stage recovery a player would use.
 *
 * It deliberately does **not** DI. Leaving the stick neutral while in hitstun
 * keeps launch trajectories reproducible, which is the whole point of a
 * training dummy.
 */
export class DummyController extends PlayerInput {
  constructor(index) {
    super(index, { type: 'cpu', slot: 0 });
    this.fighter = null;
    this.world = null;
    this.connected = true;
    this.ledgeWait = 0;
  }

  get deviceLabel() { return 'CPU DUMMY'; }

  /** Called by Match once the fighter exists. */
  attach(fighter, world) {
    this.fighter = fighter;
    this.world = world;
  }

  /** The solid platform the dummy considers "the stage". */
  mainPlatform() {
    return this.world.stage.platforms.find((p) => p.type === 'solid');
  }

  /**
   * Decides what the dummy is "holding" this frame.
   * @returns {{x:number, y:number, jump?:boolean, special?:boolean}}
   */
  decide() {
    const out = { x: 0, y: 0 };
    const f = this.fighter;
    if (!f || !this.world) return out;
    if (f.state === S.DEAD || f.state === S.RESPAWN) return out;

    // No DI, no mashing: keep it predictable.
    if (f.hitstun > 0 || f.hitlag > 0) return out;

    const plat = this.mainPlatform();
    if (!plat) return out;
    const centre = plat.x + plat.w / 2;

    // Hanging on the ledge: wait a beat, then climb back up.
    if (f.state === S.LEDGE_HANG) {
      this.ledgeWait++;
      if (this.ledgeWait > 24 && f.ledge) out.x = -f.ledge.dir;
      return out;
    }
    this.ledgeWait = 0;

    // Already committed to the recovery move: steer it back toward the stage.
    // Aimable up specials read the stick while they travel.
    if (f.state === S.ACTION && f.move && f.move.kind === 'special') {
      out.x = clamp(sign(centre - f.x) * 0.9, -1, 1);
      out.y = -0.6;
      return out;
    }

    if (f.grounded) return out;              // stands still on stage
    if (f.state === S.HELPLESS) {            // out of options; just drift back
      out.x = sign(centre - f.x);
      return out;
    }

    const offstageX = f.x < plat.x + 20 || f.x > plat.x + plat.w - 20;
    const belowStage = f.y > plat.y + 12;
    if (!offstageX && !belowStage) return out;   // will land on the stage anyway

    // Drift back toward the middle.
    out.x = sign(centre - f.x);

    // Recover only on the way down, double jump first.
    if (f.vy > 0) {
      if (f.jumpsUsed < f.attr.airJumps) {
        out.jump = true;
      } else {
        // Up special: the stick must read as "up" for the right move to come
        // out, so drop the horizontal lean for this one frame.
        out.x = 0;
        out.y = -1;
        out.special = true;
      }
    }
    return out;
  }

  /** Mirrors PlayerInput.poll()'s bookkeeping from the decided intent. */
  poll() {
    this._frame++;
    const prevHeld = { ...this.held };
    const want = this.decide();

    this.x = want.x || 0;
    this.y = want.y || 0;
    this.mag = Math.min(1, Math.hypot(this.x, this.y));
    this.cx = 0; this.cy = 0; this.cmag = 0;

    for (const a of ACTIONS) {
      const now = !!want[a];
      this.pressed[a] = now && !prevHeld[a];
      this.released[a] = !now && prevHeld[a];
      this.held[a] = now;
      if (this.pressed[a]) this.buffer[a] = INPUT.BUFFER_FRAMES;
      else if (this.buffer[a] > 0) this.buffer[a]--;
    }

    this.smashX = 0;
    this.smashY = 0;
    this.dashPressed = 0;
    this.fastFallFlick = false;
    this.smashXAge++;
    this.smashYAge++;
    this.dpad = { up: false, down: false, left: false, right: false };
  }
}
