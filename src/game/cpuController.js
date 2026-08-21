import { PlayerInput, ACTIONS } from '../core/input.js';
import { INPUT } from '../config/gameplay.js';
import { CPU_LEVELS } from '../config/cpu.js';
import { sign, clamp, makeRandom } from '../core/math.js';
import { S } from './states.js';

/** How long a total stand-off runs before the CPU stops playing footsies. */
const STALL_FRAMES = 180;

/**
 * Fighting CPU.
 *
 * Like the training dummy, this is a drop-in PlayerInput rather than special
 * logic inside Fighter — the CPU presses the same buttons a human does and is
 * bound by the same input buffers, frame data, landing lag, Elixir costs and
 * cooldowns. It cannot do anything a player could not.
 *
 * Structure:
 *   perceive() keeps a delayed view of the opponent, so "reaction time" is a
 *              real information delay rather than a fake accuracy penalty
 *   think()    picks a short plan (a held input plus a duration)
 *   poll()     renders the current plan into raw input fields
 *
 * Difficulty only ever changes the numbers in CPU_LEVELS.
 */
export class CPUController extends PlayerInput {
  constructor(index, level = 'normal') {
    super(index, { type: 'cpu', slot: 0 });
    this.level = level;
    this.p = CPU_LEVELS[level] || CPU_LEVELS.normal;
    this.fighter = null;
    this.foe = null;
    this.world = null;
    this.connected = true;

    this.history = [];
    this.plan = null;
    this.decideTimer = 0;
    this.comboFrames = 0;
    this.lastFoeDamage = 0;
    this.lastOwnDamage = 0;
    /** Frames since anything happened to either fighter; breaks stand-offs. */
    this.stallFrames = 0;
    this.rand = makeRandom(0x9e3779b9 ^ (index * 2654435761));
  }

  get deviceLabel() { return `CPU · ${this.p.label}`; }

  attach(fighter, world) {
    this.fighter = fighter;
    this.world = world;
    this.foe = world.fighters.find((f) => f !== fighter) || null;
  }

  chance(p) { return this.rand() < p; }
  pick(list) { return list[Math.floor(this.rand() * list.length) % list.length]; }

  // --------------------------------------------------------------- perception

  /** Records the opponent, and reads it back `reaction` frames stale. */
  perceive() {
    if (!this.foe) this.foe = this.world.fighters.find((f) => f !== this.fighter) || null;
    if (!this.foe) return null;
    const f = this.foe;
    this.history.push({
      x: f.x, y: f.y, vx: f.vx, vy: f.vy,
      grounded: f.grounded, state: f.state, damage: f.damage,
      hitstun: f.hitstun, shielding: f.isShielding(),
      moveId: f.move ? f.move.id : null,
      moveKind: f.move ? f.move.kind : null,
      moveFrame: f.moveFrame,
    });
    if (this.history.length > 80) this.history.shift();
    const idx = Math.max(0, this.history.length - 1 - this.p.reaction);
    return this.history[idx];
  }

  mainPlatform() {
    return this.world.stage.platforms.find((p) => p.type === 'solid');
  }

  isOffstage(pos) {
    const plat = this.mainPlatform();
    if (!plat) return false;
    return pos.x < plat.x + 12 || pos.x > plat.x + plat.w - 12 || pos.y > plat.y + 16;
  }

  /** Roughly how far this fighter's grounded pokes reach. */
  reach() {
    return 78 * (this.fighter.def.reach || 1);
  }

  affordable(moveId) {
    const mv = this.fighter.moves[moveId];
    if (!mv) return false;
    if (this.fighter.cooldowns.has(mv.id)) return false;
    const cost = typeof mv.cost === 'function' ? mv.cost(this.fighter) : (mv.cost || 0);
    return this.fighter.elixir.value >= cost;
  }

  /** Keeps enough Elixir in reserve to make it back from offstage. */
  reserveForRecovery() {
    const up = this.fighter.moves.upB;
    if (!up) return 0;
    return typeof up.cost === 'function' ? up.cost(this.fighter) : (up.cost || 0);
  }

  // ------------------------------------------------------------------- think

  think(foe) {
    const me = this.fighter;
    const P = this.p;

    if (me.state === S.DEAD) return this.hold({}, 6);
    if (me.state === S.RESPAWN) return this.hold({ y: 1 }, 4);
    if (me.hitlag > 0) return this.hold({}, 1);

    // Being launched: survive.
    if (me.state === S.HITSTUN || me.hitstun > 0) return this.survive();

    if (me.state === S.DOWNED) {
      return this.chance(0.5) ? this.jumpPlan({}, 4) : this.hold({ shield: true }, 4);
    }

    if (me.state === S.LEDGE_HANG) return this.fromLedge();

    if (this.isOffstage(me) && !me.grounded) return this.recover();

    if (!foe) return this.hold({}, 8);

    const dx = foe.x - me.x;
    const dist = Math.abs(dx);
    const dir = sign(dx) || me.facing;
    /** Positive when the opponent is higher up (simulation y grows downward). */
    const gap = me.y - foe.y;
    const foeAbove = gap > 55;
    const range = this.reach();

    // Opponent is offstage: contest it.
    if (this.isOffstage(foe) && !foe.grounded && this.chance(P.edgeguard)) {
      return this.edgeguard(foe, dir);
    }

    // Opponent is committing to something close by: defend.
    if (this.threatened(foe, dist) && this.chance(P.defense)) return this.defend(dir, dist);

    // We just connected: chase it.
    if (this.comboFrames > 0 && this.chance(P.combo)) return this.chase(foe, dir, foeAbove, dist);

    // Opponent standing on a different floor. Nothing in the moveset crosses a
    // platform gap, so swinging from here is swinging at nothing: go to them.
    // Only for a *standing* opponent — one that is merely airborne above us is
    // being juggled, which the normal anti-air handles.
    if (foe.grounded) {
      if (gap > this.floorGap()) return this.climb(foe, dir, gap);
      if (-gap > this.floorGap() && me.grounded) return this.descend(foe, dir);
    }

    if (!me.grounded) return this.airPlan(foe, dir, dist, foeAbove);

    // Slightly generous so it commits at the edge of its range rather than
    // shuffling just outside it.
    if (dist <= range * 1.25) return this.attack(foe, dir, dist, foeAbove);

    // Mid range: a projectile is good Elixir value for a Zoner.
    if (dist > range * 1.6 && dist < range * 5
      && this.chance(P.useSpecials) && this.affordable('neutralB')
      && this.fighter.elixir.value >= this.reserveForRecovery() + 1) {
      return this.hold({ x: 0, y: 0, special: true, face: dir }, 6);
    }

    return this.approach(foe, dir, dist);
  }

  /** Survival DI: push the launch angle perpendicular, biased upward. */
  survive() {
    const me = this.fighter;
    const q = this.p.di;
    const input = {};
    if (q > 0) {
      const mag = Math.hypot(me.vx, me.vy) || 1;
      let px = -me.vy / mag;
      let py = me.vx / mag;
      if (py > 0) { px = -px; py = -py; }      // prefer bending upward
      input.x = px * q;
      input.y = py * q;
    }
    // Buffer a tech if we are about to hit the floor hard.
    const plat = this.mainPlatform();
    if (plat && me.vy > 0 && !me.grounded
      && me.y > plat.y - 90 && me.x > plat.x && me.x < plat.x + plat.w
      && this.chance(this.p.tech)) {
      input.shield = true;
    }
    return this.hold(input, 2);
  }

  fromLedge() {
    const me = this.fighter;
    const inward = me.ledge ? -me.ledge.dir : 1;
    const roll = this.rand();
    if (roll < 0.45) return this.hold({ x: inward }, 6);            // regular getup
    if (roll < 0.7) return this.jumpPlan({ x: inward * 0.5 }, 6);
    if (roll < 0.9 && this.p.aerial > 0.3) return this.hold({ attack: true }, 8);
    return this.hold({ shield: true }, 6);                          // ledge roll
  }

  /** Get back to the stage: drift, double jump, then up special. */
  recover() {
    const me = this.fighter;
    const plat = this.mainPlatform();
    const centre = plat.x + plat.w / 2;
    const toward = sign(centre - me.x) || 1;

    if (me.state === S.ACTION && me.move && me.move.kind === 'special') {
      return this.hold({ x: toward * 0.9, y: -0.6 }, 3);
    }
    if (me.state === S.HELPLESS) return this.hold({ x: toward }, 4);

    // Better players save the up special until it actually gets them there.
    const height = me.y;
    const needsJumpNow = me.vy > 0 && (height > 40 || Math.abs(me.x - centre) > plat.w * 0.6);

    if (me.vy > 0 && me.jumpsUsed < me.attr.airJumps && needsJumpNow) {
      return this.jumpPlan({ x: toward }, 3);
    }
    if (me.vy > 0 && me.jumpsUsed >= me.attr.airJumps && me.state !== S.HELPLESS) {
      if (this.affordable('upB')) return this.hold({ x: 0, y: -1, special: true }, 4);
    }
    return this.hold({ x: toward }, 3);
  }

  /**
   * Contest an offstage opponent — without walking off the stage doing it.
   * The guard post is *inside* the ledge, and going out is only an option when
   * we could actually get back.
   */
  edgeguard(foe, dir) {
    const me = this.fighter;
    const plat = this.mainPlatform();
    const onLeft = foe.x < plat.x;
    const guardX = onLeft ? plat.x + 45 : plat.x + plat.w - 45;
    const toGuard = Math.abs(me.x - guardX) > 26 ? sign(guardX - me.x) : 0;

    // A projectile is the safe option; going out is the committed one.
    if (this.affordable('neutralB') && this.chance(0.45)) {
      return this.hold({ x: 0, special: true, face: dir }, 6);
    }

    // Only chase offstage if we can get home: a jump in reserve, the up
    // special affordable, and not already at a percent where we die to a poke.
    const canReturn = me.jumpsUsed < me.attr.airJumps
      && this.fighter.elixir.value >= this.reserveForRecovery()
      && me.damage < 110;
    if (this.p.edgeguard > 0.4 && canReturn && this.chance(0.35)
      && me.grounded && toGuard === 0) {
      return this.jumpPlan({ x: onLeft ? -1 : 1 }, 8);
    }

    if (!me.grounded) {
      if (Math.abs(foe.x - me.x) < 140) return this.hold({ x: -dir, attack: true }, 6); // back air
      // Get back on before we run out of options.
      const centre = plat.x + plat.w / 2;
      return this.hold({ x: sign(centre - me.x) }, 6);
    }

    return this.hold({ x: toGuard }, 8);
  }

  threatened(foe, dist) {
    if (!foe.moveKind) return false;
    const attacking = foe.moveKind === 'ground' || foe.moveKind === 'aerial'
      || foe.moveKind === 'special' || foe.moveKind === 'grab';
    return attacking && dist < this.reach() * 1.5;
  }

  defend(dir, dist) {
    const roll = this.rand();
    if (roll < 0.45) return this.hold({ shield: true }, 12);
    if (roll < 0.65) return this.hold({ shield: true, smashY: 1, y: 1 }, 6);   // spot dodge
    if (roll < 0.85) return this.hold({ shield: true, smashX: -dir, x: -dir }, 8); // roll away
    return this.jumpPlan({ x: -dir * 0.6 }, 6);
  }

  /** Follow up a landed hit. */
  chase(foe, dir, foeAbove, dist) {
    const me = this.fighter;
    if (foeAbove || !foe.grounded) {
      if (me.grounded && this.chance(this.p.juggle)) {
        return this.jumpPlan({ x: dir * 0.5 }, 5);      // hop after them
      }
      if (!me.grounded) return this.hold({ x: dir * 0.6, y: -1, attack: true }, 8); // up air
      return this.hold({ x: 0, y: -1, attack: true }, 8);        // up tilt
    }
    if (dist > this.reach()) return this.hold({ x: dir, dash: dir }, 6);
    return this.hold({ x: dir, attack: true }, 8);
  }

  /**
   * The height difference at which the opponent counts as being on another
   * floor rather than just standing on a slope of the same one. A shade over a
   * body height, which is already past what any anti-air reaches.
   */
  floorGap() {
    return this.fighter.def.height * 1.15;
  }

  /**
   * Go up to an opponent camping a platform. Get underneath them first, then
   * jump — spending the air jump at the apex if the platform is high enough to
   * need it, which the top platform of a Battlefield-style stage always is.
   */
  climb(foe, dir, gap) {
    const me = this.fighter;
    const dx = foe.x - me.x;
    const toward = sign(dx) || me.facing;
    const under = Math.abs(dx) < 55;

    if (me.grounded) {
      if (!under) return this.hold({ x: toward, dash: Math.abs(dx) > 240 ? toward : 0 }, 6);
      // Held rather than tapped, so this is a full hop.
      return this.jumpPlan({ x: toward * 0.3 }, 10);
    }

    // Rising: just steer.
    if (me.vy < 0) return this.hold({ x: toward * 0.5 }, 4);

    if (gap > 40 && me.jumpsUsed < me.attr.airJumps) {
      // Buttons are edge-triggered, so the jump has to be let go of before it
      // can be pressed again — two plans both holding it would be one press.
      if (this.held.jump) return this.hold({ x: toward * 0.5 }, 2);
      return this.jumpPlan({ x: toward * 0.5 }, 6);
    }
    // Level with them and out of jumps: swing on the way past.
    if (Math.abs(gap) < 45 && Math.abs(dx) < this.reach() * 1.4) {
      return this.hold({ x: toward * 0.5, attack: true }, 8);
    }
    return this.hold({ x: toward * 0.5 }, 4);
  }

  /**
   * Drop down to an opponent below. Soft platforms are left by crouching and
   * flicking down, which is the one input the CPU never had a reason to press
   * until now.
   */
  descend(foe, dir) {
    const me = this.fighter;
    const onSoft = me.platform && me.platform.type === 'soft';
    if (!onSoft) {
      // Solid ground with the opponent below means they are off the side of
      // the stage, which is edgeguarding's business, not this.
      return this.hold({ x: dir }, 6);
    }
    if (me.state !== S.CROUCH) return this.hold({ y: 1 }, 4);
    return this.hold({ y: 1, fastFall: true }, 4);
  }

  /** Aerial decision-making while airborne. */
  airPlan(foe, dir, dist, foeAbove) {
    const me = this.fighter;
    if (dist < this.reach() * 1.4 && this.chance(this.p.aerial)) {
      if (foeAbove) return this.hold({ x: dir * 0.4, y: -1, attack: true }, 8);
      if (me.y < foe.y - 40) return this.hold({ x: dir * 0.4, y: 1, attack: true }, 10);
      const back = this.chance(0.35);
      return this.hold({ x: back ? -dir : dir, attack: true }, 8);
    }
    // Drift toward them, fast-fall to land sooner at higher levels.
    return this.hold({ x: dir, y: this.chance(this.p.aerial) ? 1 : 0 }, 4);
  }

  /** Grounded attack selection. */
  attack(foe, dir, dist, foeAbove) {
    const me = this.fighter;
    const P = this.p;
    const killing = foe.damage >= P.killPercent && this.chance(P.killAware);

    // Shielding opponent: grab it.
    if (foe.shielding && this.chance(0.6)) return this.hold({ x: dir, grab: true, face: dir }, 10);

    if (foeAbove) {
      return this.chance(0.5)
        ? this.hold({ x: 0, y: -1, attack: true }, 8)                       // up tilt
        : this.hold({ x: 0, y: -1, smashY: -1, attack: true }, 12);         // up smash
    }

    if (killing) {
      const roll = this.rand();
      if (roll < 0.55) return this.hold({ x: dir, smashX: dir, attack: true, face: dir }, 14);
      if (roll < 0.75 && this.affordable('sideB')) {
        return this.hold({ x: dir, special: true, face: dir }, 10);
      }
      if (roll < 0.9) return this.hold({ x: dir, smashY: 1, attack: true }, 12);   // down smash
      return this.jumpPlan({ x: dir }, 6);                                 // go for an aerial
    }

    // Low percent: combo starters.
    const roll = this.rand();
    if (roll < 0.28) return this.hold({ x: dir, attack: true, face: dir }, 8);      // ftilt
    if (roll < 0.46) return this.hold({ x: 0, y: 1, attack: true }, 8);             // dtilt
    if (roll < 0.60) return this.hold({ x: 0, y: -1, attack: true }, 8);            // utilt
    if (roll < 0.72) return this.hold({ attack: true }, 6);                         // jab
    if (roll < 0.84) return this.hold({ x: dir, grab: true, face: dir }, 10);       // grab
    if (roll < 0.94 && this.chance(P.aerial)) return this.jumpPlan({ x: dir * 0.4 }, 5);
    if (this.affordable('sideB') && this.chance(P.useSpecials)) {
      return this.hold({ x: dir, special: true, face: dir }, 10);
    }
    return this.hold({ x: dir, attack: true, face: dir }, 8);
  }

  /** Close the gap, with some spacing noise and retreat mix-ups. */
  approach(foe, dir, dist) {
    const P = this.p;
    // Two fighters can both decide to hold position and stand there forever.
    // If nothing at all has happened for a few seconds, stop asking.
    if (this.stallFrames < STALL_FRAMES && !this.chance(P.aggression)) {
      // Hold position, or dance just outside range.
      if (this.chance(P.footsies)) return this.hold({ x: -dir, dash: -dir }, 6);
      return this.hold({}, 8);
    }
    const target = this.reach() * 0.8 + (this.rand() - 0.5) * P.spacing;
    if (dist > target + 30) {
      const wantDash = dist > this.reach() * 2.2;
      return this.hold({ x: dir, dash: wantDash ? dir : 0 }, wantDash ? 8 : 6);
    }
    // Right on the edge of range: step in and swing rather than hover.
    if (dist < this.reach() * 1.7 && this.chance(0.5)) {
      return this.hold({ x: dir, attack: true, face: dir }, 8);
    }
    if (dist < target - 30) return this.hold({ x: -dir }, 5);
    if (this.chance(P.footsies)) return this.hold({ x: -dir, dash: -dir }, 5);
    return this.hold({ x: dir }, 4);
  }

  hold(input, frames) { return { input, frames: Math.max(1, frames), age: 0 }; }

  /**
   * A plan that jumps.
   *
   * Buttons are edge-triggered — a press is registered when the input goes from
   * released to held — and one plan's held inputs run straight into the next
   * one's. So two plans that both hold jump are a *single* press, and a CPU
   * that wants to jump again has to let go first. Without this a fighter that
   * keeps deciding to jump jumps exactly once and then walks around with the
   * button welded down, which is what left it whiffing under a platform.
   */
  jumpPlan(input, frames) {
    if (this.held.jump) return this.hold(input, 2);
    return this.hold({ ...input, jump: true }, frames);
  }

  // -------------------------------------------------------------------- poll

  poll() {
    this._frame++;

    const foe = this.perceive();

    // Track when our hit lands, to open a combo window.
    if (this.foe) {
      if (this.foe.damage > this.lastFoeDamage + 0.01 && this.foe.hitstun > 0) {
        this.comboFrames = 45;
      }
      // Any damage on either side means the match is still moving.
      const own = this.fighter ? this.fighter.damage : 0;
      const moving = this.foe.damage !== this.lastFoeDamage || own !== this.lastOwnDamage;
      this.stallFrames = moving ? 0 : this.stallFrames + 1;
      this.lastFoeDamage = this.foe.damage;
      this.lastOwnDamage = own;
    }
    if (this.comboFrames > 0) this.comboFrames--;

    if (this.plan) { this.plan.frames--; this.plan.age++; }
    if (!this.plan || this.plan.frames <= 0) {
      this.plan = this.fighter && this.world ? this.think(foe) : this.hold({}, 6);
    }
    const want = this.plan.input || {};
    /** Smash flicks and dashes are edge-triggered: only on a plan's first frame. */
    const fresh = this.plan.age === 0;

    const prevHeld = { ...this.held };

    this.x = clamp(want.x || 0, -1, 1);
    this.y = clamp(want.y || 0, -1, 1);
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

    /**
     * The flick is re-thrown while the attack is still queued.
     *
     * A plan asks for its smash on frame one, but the fighter often cannot act
     * yet — landing lag, an action still running — and a single flick goes
     * stale long before the queued attack resolves, so the smash arrives as a
     * tilt. A player re-flicks in exactly that situation. This is that, not a
     * longer window than the player gets: the moment the attack is spent, the
     * flick stops.
     */
    const attackQueued = this.buffer.attack > 0;
    this.smashX = (fresh || attackQueued) ? (want.smashX || 0) : 0;
    this.smashY = (fresh || attackQueued) ? (want.smashY || 0) : 0;
    this.dashPressed = fresh ? (want.dash || 0) : 0;
    // Edge-triggered like the smash flicks: this is the down-flick that drops
    // through a soft platform.
    this.fastFallFlick = fresh ? !!want.fastFall : false;

    this.smashXAge++;
    this.smashYAge++;
    if (this.smashX !== 0) { this.smashXDir = this.smashX; this.smashXAge = 0; }
    if (this.smashY !== 0) { this.smashYDir = this.smashY; this.smashYAge = 0; }

    // Keep the stick held in the smashed direction so smashXHeld stays valid.
    if (want.smashX && this.x === 0) this.x = want.smashX;
    if (want.smashY && this.y === 0) this.y = want.smashY;

    this.dpad = { up: false, down: false, left: false, right: false };
  }
}
