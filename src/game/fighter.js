import {
  PHYSICS, SHIELD, DEFENSE, LEDGE, GRAB, MATCH, SMASH_CHARGE, KNOCKBACK, INPUT,
} from '../config/gameplay.js';
import { S, GROUNDED_STATES } from './states.js';
import { ElixirBar } from './elixir.js';
import {
  StaleQueue, launchVelocity, resolveAngle, hitstunFrames, computeKnockback, rageBonus,
} from '../engine/combat.js';
import { toWorld } from '../engine/shapes.js';
import { createUniversalMoves } from '../data/universalMoves.js';
import { approach, clamp, sign, inWindow } from '../core/math.js';

let NEXT_ID = 1;

/** Move kinds during which a fighter may not snap to a ledge. */
const LEDGE_BLOCKED_KINDS = new Set([
  'ledge', 'getup', 'tech', 'throw', 'grab', 'pummel', 'roll', 'dodge', 'ground',
]);

/**
 * A fighter.
 *
 * Owns movement, the state machine, defensive options, the Elixir bar and
 * move execution. Everything character-specific — attributes, frame data,
 * gimmicks — arrives through `def`, so adding a fighter means adding one data
 * file and nothing else.
 */
export class Fighter {
  constructor(def, playerIndex, input, world) {
    this.id = NEXT_ID++;
    this.def = def;
    this.attr = def.attributes;
    this.playerIndex = playerIndex;
    this.input = input;
    this.world = world;

    this.moves = { ...createUniversalMoves(def), ...def.moves };

    this.x = 0; this.y = 0;
    this.vx = 0; this.vy = 0;
    this.prevX = 0; this.prevY = 0;
    this.facing = 1;
    this.grounded = false;
    this.platform = null;
    /** Floor a grounded attack launched from — see `holdGroundAtEdge`. */
    this._edgePlat = null;

    this.state = S.IDLE;
    this.stateFrame = 0;

    this.move = null;
    this.moveFrame = 0;
    this._moveAccum = 0;
    this.moveCtx = {};
    this.hitTargets = new Map();
    this.chargeFrames = 0;
    this.charging = false;
    /** Elixir owed by the special in progress, charged on `pendingCostFrame`. */
    this.pendingCost = 0;
    this.pendingCostFrame = 0;

    this.damage = 0;
    this.stocks = MATCH.STOCKS;
    this.alive = true;

    /**
     * Running tallies for the results screen. Gameplay never reads these — they
     * exist so the end of a match can say something about how it was won.
     */
    this.stats = {
      damageDealt: 0, damageTaken: 0,
      hits: 0, biggestHit: 0,
      kos: 0, falls: 0, selfDestructs: 0,
    };
    /** Who last connected, and when — used to credit a KO. */
    this.lastHitBy = null;
    this.lastHitByFrame = -Infinity;

    this.jumpsUsed = 0;
    this.airDodgesUsed = 0;
    this.fastFalling = false;
    this.dropThroughTimer = 0;

    this.hitlag = 0;
    this.hitlagIsVictim = false;
    this.pendingHit = null;
    this.sdiUsed = 0;

    this.hitstun = 0;
    this.tumbling = false;
    this.launchSpeed = 0;
    /** Decaying knockback vector, integrated separately from gravity. */
    this.launchActive = false;
    this.launchVx = 0;
    this.launchVy = 0;
    this.launchGravity = 0;
    /**
     * True while the fighter is riding an upward launch. Only a fighter that
     * was knocked upward can be KO'd through the ceiling; anything it does
     * under its own power (air jump, recovery) clears this.
     */
    this.launchedAirborne = false;

    this.shield = { health: SHIELD.MAX_HEALTH, active: false, radius: SHIELD.RADIUS_MAX };
    this.shieldStun = 0;

    this.elixir = new ElixirBar();
    this.stale = new StaleQueue();

    this.intangibleFrames = 0;
    this.invincibleFrames = 0;
    this.armorThreshold = 0;
    /** Fighter-wide damage multiplier, driven by character states (see Rage). */
    this.damageBuff = 1;

    this.ledge = null;
    this.ledgeLockout = 0;
    this.ledgeIntangibilityBudget = LEDGE.INTANGIBILITY_BUDGET;

    this.grabbing = null;
    this.grabbedBy = null;
    this.grabHold = 0;
    /** Frames until the next pummel is allowed; see stepGrabbing. */
    this.pummelCooldown = 0;
    this.mashProgress = 0;

    this.techWindow = 0;
    this.techLockout = 0;

    this.respawnTimer = 0;
    this.respawnQueue = null;
    this.landingLagFrames = 0;
    this.dizzyFrames = 0;

    /** Per-character scratch space: cooldowns, meters, toggles. */
    this.custom = {};
    /** Cooldowns keyed by move id, in frames. */
    this.cooldowns = new Map();

    /** Purely visual. */
    this.flashFrames = 0;
    this.lastHitEffect = null;

    if (def.onCreate) def.onCreate(this);
  }

  // ---------------------------------------------------------------- geometry

  get halfWidth() { return this.def.width / 2; }

  get height() {
    if (this.state === S.CROUCH) return this.def.height * PHYSICS.CROUCH_HEIGHT_MUL;
    if (this.state === S.DOWNED) return this.def.height * 0.45;
    return this.def.height;
  }

  /** World-space hurtbox capsules. */
  getHurtboxes() {
    if (!this.alive || this.state === S.DEAD) return [];
    const r = Math.min(this.halfWidth, this.height / 2);
    return [toWorld({ x: 0, y: r, x2: 0, y2: this.height - r, r }, this.x, this.y, this.facing)];
  }

  /** World-space hitboxes active on the current move frame. */
  getActiveHitboxes() {
    if (this.state !== S.ACTION || !this.move || !this.move.hitboxes) return [];
    const out = [];
    for (const hb of this.move.hitboxes) {
      if (!inWindow(this.moveFrame, hb.frames)) continue;
      out.push({ def: hb, capsule: toWorld(hb.shape, this.x, this.y, this.facing), owner: this });
    }
    return out;
  }

  /** World-space grab box, if the current move has one active. */
  getActiveGrabbox() {
    if (this.state !== S.ACTION || !this.move || !this.move.grabbox) return null;
    if (!inWindow(this.moveFrame, this.move.grabbox.frames)) return null;
    return toWorld(this.move.grabbox.shape, this.x, this.y, this.facing);
  }

  isIntangible() {
    return this.intangibleFrames > 0 || this.invincibleFrames > 0 || this.state === S.RESPAWN;
  }

  isShielding() {
    return (this.state === S.SHIELD || this.state === S.SHIELD_STUN) && this.shield.active;
  }

  isGrabbable() {
    return this.alive && !this.isIntangible() && !this.grabbedBy &&
      this.state !== S.RESPAWN && this.state !== S.DEAD &&
      this.state !== S.LEDGE_HANG && this.state !== S.DOWNED;
  }

  isHittable() {
    return this.alive && this.state !== S.DEAD && this.state !== S.RESPAWN && !this.isIntangible();
  }

  // ------------------------------------------------------------------ spawn

  spawnAt(x, y, facing) {
    this.x = x; this.y = y; this.prevX = x; this.prevY = y;
    this.vx = 0; this.vy = 0;
    this.facing = facing;
    this.grounded = true;
    this.setState(S.IDLE);
    this.damage = 0;
    this.resetVolatile();
  }

  resetVolatile() {
    this.move = null;
    this.moveFrame = 0;
    this._moveAccum = 0;
    this.hitTargets.clear();
    this.hitlag = 0;
    this.pendingHit = null;
    this.hitstun = 0;
    this.tumbling = false;
    this.launchedAirborne = false;
    this.launchActive = false;
    this.launchVx = 0;
    this.launchVy = 0;
    this.launchGravity = 0;
    this.shieldStun = 0;
    this.shield.active = false;
    this.shield.health = SHIELD.MAX_HEALTH;
    this.jumpsUsed = 0;
    this.airDodgesUsed = 0;
    this.fastFalling = false;
    this.charging = false;
    this.chargeFrames = 0;
    this.releaseLedge(false);
    this.ledgeIntangibilityBudget = LEDGE.INTANGIBILITY_BUDGET;
    if (this.grabbing) this.grabbing.releaseFromGrab();
    this.grabbing = null;
    this.releaseFromGrab();
  }

  /** Called by the match after a KO. */
  respawn(x, y) {
    this.x = x; this.y = y; this.prevX = x; this.prevY = y;
    this.vx = 0; this.vy = 0;
    this.damage = 0;
    this.resetVolatile();
    this.elixir.onRespawn();
    this.stale.clear();
    this.grounded = false;
    this.alive = true;
    this.setState(S.RESPAWN);
    this.respawnTimer = MATCH.RESPAWN_PLATFORM_TIMEOUT;
    this.invincibleFrames = MATCH.RESPAWN_INVINCIBILITY;
    this.custom = {};
    if (this.def.onCreate) this.def.onCreate(this);
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.stateFrame = 0;
    // Leaving ACTION drops the move — and with it any Elixir it had not yet
    // been charged for. This is the path every interruption takes: hitstun, a
    // grab, a KO, a shield.
    if (state !== S.ACTION) { this.move = null; this.charging = false; this.pendingCost = 0; }
    if (state !== S.SHIELD && state !== S.SHIELD_STUN) this.shield.active = false;
  }

  // ------------------------------------------------------------------- step

  step() {
    this.prevX = this.x;
    this.prevY = this.y;

    this.tickTimers();

    if (this.hitlag > 0) {
      this.stepHitlag();
      return;
    }

    if (this.state === S.DEAD) return;

    this.stateFrame++;

    switch (this.state) {
      case S.RESPAWN: this.stepRespawn(); break;
      case S.ACTION: this.stepAction(); break;
      case S.LEDGE_HANG: this.stepLedgeHang(); break;
      case S.GRABBED: this.stepGrabbed(); break;
      case S.GRABBING: this.stepGrabbing(); break;
      case S.HITSTUN:
      case S.TUMBLE: this.stepHitstun(); break;
      case S.DOWNED: this.stepDowned(); break;
      case S.SHIELD: this.stepShield(); break;
      case S.SHIELD_STUN: this.stepShieldStun(); break;
      case S.SHIELD_DROP: this.stepShieldDrop(); break;
      case S.SHIELD_BREAK: this.stepShieldBreak(); break;
      case S.DIZZY: this.stepDizzy(); break;
      case S.JUMPSQUAT: this.stepJumpsquat(); break;
      case S.LANDING: this.stepLanding(); break;
      case S.HELPLESS: this.stepHelpless(); break;
      case S.AIR: this.stepAir(); break;
      default: this.stepGrounded(); break;
    }

    // Pinned states own their own position: hanging, held in a grab, sitting on
    // the respawn platform, or performing a ledge option before the climb.
    const onLedgeAction = this.state === S.ACTION && this.move && this.move.kind === 'ledge' && this.ledge;
    const pinned = this.state === S.LEDGE_HANG || this.state === S.GRABBED ||
      this.state === S.RESPAWN || onLedgeAction;
    if (!pinned) {
      this.applyPhysics();
      this.collide();
    }

    if (this.def.onStep) this.def.onStep(this);
    this.updateShieldMeter();
  }

  tickTimers() {
    // Ticked here rather than inside the grab step so the pummel's own hitlag
    // does not stall it: counting only on unfrozen frames stretched a 16-frame
    // cadence out to 24.
    if (this.pummelCooldown > 0) this.pummelCooldown--;
    if (this.intangibleFrames > 0) this.intangibleFrames--;
    if (this.invincibleFrames > 0) this.invincibleFrames--;
    if (this.dropThroughTimer > 0) this.dropThroughTimer--;
    if (this.ledgeLockout > 0) this.ledgeLockout--;
    if (this.techWindow > 0) this.techWindow--;
    if (this.techLockout > 0) this.techLockout--;
    if (this.flashFrames > 0) this.flashFrames--;
    for (const [k, v] of this.cooldowns) {
      if (v <= 1) this.cooldowns.delete(k); else this.cooldowns.set(k, v - 1);
    }
    this.elixir.step();
  }

  /**
   * Hitlag: both fighters freeze so the hit reads. The victim may Smash-DI
   * during these frames, nudging their position before the launch resolves.
   */
  stepHitlag() {
    this.hitlag--;
    if (this.hitlagIsVictim && this.sdiUsed < KNOCKBACK.SDI_MAX_PER_HITLAG) {
      const inp = this.input;
      if (inp && (inp.smashX !== 0 || inp.smashY !== 0)) {
        this.x += inp.smashX * KNOCKBACK.SDI_DISTANCE;
        this.y += inp.smashY * KNOCKBACK.SDI_DISTANCE;
        this.sdiUsed++;
      }
    }
    if (this.hitlag === 0 && this.pendingHit) this.resolvePendingHit();
  }

  // --------------------------------------------------------------- physics

  applyPhysics() {
    const a = this.attr;

    if (this.launchActive && !this.grounded && this.state === S.HITSTUN) {
      this.stepLaunch(a);
    } else {
      this.launchActive = false;

      if (!this.grounded) {
        const gravMul = (this.move && this.move.gravityMul !== undefined) ? this.move.gravityMul : 1;
        this.vy += a.gravity * gravMul;

        /**
         * `move.maxFallMul` lifts the terminal-velocity cap for the move.
         *
         * A stall-then-fall is defined by dropping faster than the fighter ever
         * falls on his own — without this the plunge is silently clamped to
         * `maxFall * fastFallMul` and reads as an ordinary fast fall no matter
         * what velocity the move asks for. `ABSOLUTE_MAX_FALL` still applies, so
         * nothing here can tunnel through the stage.
         */
        const fallMul = (this.move && this.move.maxFallMul !== undefined) ? this.move.maxFallMul : 1;
        const maxFall = (this.fastFalling ? a.maxFall * a.fastFallMul : a.maxFall) * fallMul;
        this.vy = Math.min(this.vy, Math.min(maxFall, PHYSICS.ABSOLUTE_MAX_FALL));
      }
    }

    this.vx = clamp(this.vx, -PHYSICS.ABSOLUTE_MAX_SPEED, PHYSICS.ABSOLUTE_MAX_SPEED);
    this.x += this.vx;
    this.y += this.vy;
  }

  /**
   * The launch itself.
   *
   * The knockback vector is tracked separately from gravity and decays in
   * magnitude, so a hit reads as an explosive burst that bleeds off rather
   * than a constant slide. Gravity accumulates on top, which is what bends
   * the trajectory into an arc without eating the horizontal launch.
   */
  stepLaunch(a) {
    const speed = Math.hypot(this.launchVx, this.launchVy);
    if (speed <= KNOCKBACK.DECAY) {
      this.launchVx = 0;
      this.launchVy = 0;
    } else {
      const scale = (speed - KNOCKBACK.DECAY) / speed;
      this.launchVx *= scale;
      this.launchVy *= scale;
    }

    this.launchGravity += a.gravity * KNOCKBACK.LAUNCH_GRAVITY_MUL;

    this.vx = this.launchVx;
    this.vy = this.launchVy + this.launchGravity;
    this.vy = Math.min(this.vy, PHYSICS.ABSOLUTE_MAX_FALL * 1.6);
  }

  collide() {
    const stage = this.world.stage;
    this.holdGroundAtEdge();
    const wasGrounded = this.grounded;
    const res = stage.resolve(this);

    if (res.grounded) {
      this.platform = res.platform;
      if (!wasGrounded) this.onLand();
      this.grounded = true;
    } else if (this.grounded) {
      // Walked off an edge.
      if (!stage.groundUnder(this)) {
        this.grounded = false;
        if (GROUNDED_STATES.has(this.state) && this.state !== S.DOWNED) {
          this.setState(S.AIR);
        }
      }
    }

    if (res.hitCeiling && (this.state === S.HITSTUN || this.state === S.TUMBLE)) {
      this.vy = Math.abs(this.vy) * 0.5; // bounce off the ceiling
    }

    if (!this.grounded && this.state !== S.LEDGE_HANG) this.tryGrabLedge();
  }

  /**
   * Keeps a grounded attack over the floor it started on.
   *
   * A dash attack thrown near an edge used to carry the fighter straight off
   * into the blast zone, which made the move unusable exactly where space is
   * tightest — you could not throw it without committing to a recovery. The
   * animation now plays out in full and only the *travel* is blocked.
   *
   * This clamps horizontal position rather than watching for the fighter
   * leaving the ground, because several dash attacks **hop**: the Bandit's sets
   * `vy: -5` on frame 2 and is airborne for most of its length. A grounded-only
   * check missed her completely and she still sailed off the stage. Clamping to
   * the launch platform's span catches the hop too — she simply lands back on.
   *
   * The limit lets the body hang over the lip by its own half width, which is
   * the same overlap `groundUnder` treats as standing on a platform. Anything
   * tighter would stop the move short of the edge and look like an invisible
   * wall.
   *
   * Scoped to `kind === 'ground'` — normals, tilts, smashes and dash attacks.
   * Specials are excluded on purpose: several of them are *supposed* to leave
   * the stage, and rolls already stop themselves through the `travel` path.
   */
  holdGroundAtEdge() {
    if (this.state !== S.ACTION || !this.move || this.move.kind !== 'ground') return;
    const p = this._edgePlat;
    if (!p) return;
    const lo = p.x - this.halfWidth + 1;
    const hi = p.x + p.w + this.halfWidth - 1;
    if (this.x > hi) { this.x = hi; if (this.vx > 0) this.vx = 0; }
    else if (this.x < lo) { this.x = lo; if (this.vx < 0) this.vx = 0; }
  }

  onLand() {
    this.fastFalling = false;
    this.jumpsUsed = 0;
    this.airDodgesUsed = 0;
    this.launchedAirborne = false;
    this.launchActive = false;
    this.ledgeIntangibilityBudget = LEDGE.INTANGIBILITY_BUDGET;

    if (this.state === S.HITSTUN || this.state === S.TUMBLE) {
      const hard = this.tumbling || this.launchSpeed > 9;
      if (hard) {
        this.techWindow = DEFENSE.TECH_INPUT_WINDOW;
        // A tech input buffered before landing converts the knockdown.
        if (this.techLockout === 0 && this.input && this.input.peek('shield')) {
          this.input.consume('shield');
          this.doTech();
          return;
        }
        this.vx *= 0.3;
        this.setState(S.DOWNED);
        return;
      }
      this.vx *= 0.5;
      this.setState(S.LANDING);
      this.landingLagFrames = this.attr.landFrames;
      return;
    }

    if (this.state === S.ACTION && this.move) {
      const m = this.move;
      // Aerials and air dodges land-cancel into landing lag. A special does
      // not: it plays out exactly as it would have if started on the ground.
      // Cutting specials off here is what made an aerial special silently
      // vanish when the floor arrived during its startup.
      if (m.kind === 'aerial' || m.kind === 'airdodge') {
        const auto = m.autocancel && m.autocancel.some((w) => inWindow(this.moveFrame, w));
        const lag = auto ? this.attr.landFrames : (m.landingLag !== undefined ? m.landingLag : this.attr.landFrames);
        /**
         * `move.onLand` — the arrival, for moves where hitting the ground is
         * part of the move rather than the end of it.
         *
         * Fired before `endAction` so the handler can still read `moveFrame`
         * and decide whether this was a committed landing or an autocancel; a
         * stall-then-fall wants to crater the stage on the former and do
         * nothing at all on the latter.
         */
        if (m.onLand) m.onLand(this, { autocancelled: !!auto, frame: this.moveFrame });
        this.endAction();
        this.setState(S.LANDING);
        this.landingLagFrames = lag;
        this.vx *= 0.6;
        return;
      }
      return;
    }

    if (this.state === S.HELPLESS) {
      this.setState(S.LANDING);
      this.landingLagFrames = this.attr.helplessLandLag || 22;
      return;
    }

    if (this.state === S.AIR) {
      this.setState(S.LANDING);
      this.landingLagFrames = this.attr.landFrames;
    }
  }

  // ------------------------------------------------------------ ground states

  stepGrounded() {
    const inp = this.input;
    if (!inp) return;

    if (this.tryUniversalGroundOptions()) return;

    const a = this.attr;
    const dir = Math.sign(inp.x);
    const mag = Math.abs(inp.x);

    // Dropping through a soft platform is a property of *pressing down while
    // standing on one*, not of already being crouched — so it is checked here,
    // ahead of the state machine.
    //
    // It used to live in the crouch case, where it could almost never fire. The
    // same down input that asks for the drop is also what moves IDLE or WALK
    // into CROUCH, and `fastFallFlick` lasts exactly one frame: by the time the
    // crouch case ran, the flick was gone. Holding down did nothing, and only a
    // second press while already crouched could trigger a drop.
    if (inp.fastFallFlick && this.platform && this.platform.type === 'soft'
        && (this.state === S.IDLE || this.state === S.WALK || this.state === S.CROUCH)) {
      this.dropThrough();
      return;
    }

    switch (this.state) {
      case S.IDLE:
      case S.WALK: {
        if (inp.y > PHYSICS.TILT_THRESHOLD && mag < PHYSICS.TILT_THRESHOLD) {
          this.setState(S.CROUCH);
          this.vx = approach(this.vx, 0, a.traction);
          break;
        }
        if (inp.dashPressed !== 0 && !inp.wantsWalk) { this.startDash(inp.dashPressed); break; }
        if (mag > PHYSICS.STICK_DEADZONE) {
          this.facing = dir;
          // Devices that run by default (keyboard) break into a dash straight
          // from a standstill unless the walk modifier is held. Checked here
          // rather than only on the press so it also applies after landing,
          // braking or any other return to neutral with a direction still held.
          // The smash modifier also holds them still, so a direction can be
          // aimed for a smash attack without running off.
          if (inp.autoRun && !inp.wantsWalk && !inp.smashModHeld) { this.startDash(dir); break; }
          this.setState(S.WALK);
          const target = a.walkSpeed * clamp(mag, 0, 1) * dir;
          this.vx = approach(this.vx, target, a.traction * 1.6);
        } else {
          this.setState(S.IDLE);
          this.vx = approach(this.vx, 0, a.traction);
        }
        break;
      }

      case S.CROUCH: {
        this.vx = approach(this.vx, 0, a.traction);
        if (inp.y < PHYSICS.TILT_THRESHOLD) this.setState(S.IDLE);
        break;
      }

      case S.DASH: {
        this.vx = a.initialDashSpeed * this.facing;
        // Dash dancing: a reverse flick restarts the dash at any point, so
        // flicking back and forth never drops out of the dash.
        if (inp.dashPressed !== 0 && inp.dashPressed !== this.facing) {
          this.startDash(inp.dashPressed);
          break;
        }
        if (this.stateFrame >= a.dashFrames) {
          const intoRun = !inp.wantsWalk && mag > PHYSICS.WALK_RUN_THRESHOLD && dir === this.facing;
          this.setState(intoRun ? S.RUN : S.RUN_BRAKE);
        }
        break;
      }

      case S.RUN: {
        if (mag < PHYSICS.STICK_DEADZONE) { this.setState(S.RUN_BRAKE); break; }

        // Asking to walk mid-run drops straight into a walk, so the modifier
        // can be used to settle into tilt range without stopping first.
        if (inp.wantsWalk && dir === this.facing) { this.setState(S.WALK); break; }

        // A reverse flick out of a run reverses immediately and keeps the
        // tempo — no skid, no turnaround animation. This is what makes
        // dash dancing work at full speed.
        if (inp.dashPressed !== 0 && inp.dashPressed !== this.facing) {
          this.startDash(inp.dashPressed);
          break;
        }

        if (dir !== this.facing) {
          // Not a flick: the player has deliberately tilted the other way.
          // A walk-magnitude input brakes out of the run; a full hold still
          // turns around, but pays the turnaround animation for it.
          this.setState(mag <= PHYSICS.WALK_RUN_THRESHOLD ? S.RUN_BRAKE : S.TURN);
          break;
        }

        this.vx = approach(this.vx, a.runSpeed * this.facing, a.runAccel);
        break;
      }

      case S.RUN_BRAKE: {
        // A flick during the skid picks the dash straight back up.
        if (inp.dashPressed !== 0) { this.startDash(inp.dashPressed); break; }
        this.vx = approach(this.vx, 0, a.traction);
        if (this.stateFrame >= a.runBrakeFrames || Math.abs(this.vx) < 0.05) {
          this.setState(mag > PHYSICS.STICK_DEADZONE ? S.WALK : S.IDLE);
        }
        break;
      }

      case S.TURN: {
        this.vx = approach(this.vx, 0, a.traction * 1.4);
        if (this.stateFrame >= a.turnFrames) {
          this.facing = -this.facing;
          this.setState(mag > PHYSICS.WALK_RUN_THRESHOLD ? S.RUN : S.IDLE);
        }
        break;
      }
      default: break;
    }
  }

  /** Options available from any actionable grounded state. */
  tryUniversalGroundOptions() {
    const inp = this.input;

    if (inp.consume('jump')) { this.startJumpsquat(); return true; }

    if (inp.held.shield) { this.enterShield(); return true; }

    if (inp.consume('grab')) {
      const dashing = this.state === S.DASH || this.state === S.RUN;
      this.startAction(dashing ? this.moves.dashGrab : this.moves.grab);
      return true;
    }

    if (inp.consume('special')) { if (this.trySpecial()) return true; }

    if (inp.consume('attack')) { if (this.tryGroundAttack()) return true; }

    // Right stick on the ground is a *tilt* stick. Smashes are the left
    // stick's flick plus attack, and nothing else — so the stick you reach for
    // when you want a quick poke cannot hand you a committal smash instead.
    const cdir = inp.cCardinal();
    if (cdir !== 'neutral') {
      const move = cdir === 'up' ? this.moves.utilt : cdir === 'down' ? this.moves.dtilt : this.moves.ftilt;
      if (cdir === 'left' || cdir === 'right') this.facing = cdir === 'right' ? 1 : -1;
      if (move) { this.startAction(move); return true; }
    }

    if (inp.consume('taunt')) { if (this.moves.taunt) { this.startAction(this.moves.taunt); return true; } }

    return false;
  }

  startDash(dir) {
    this.facing = dir;
    this.setState(S.DASH);
    this.vx = this.attr.initialDashSpeed * dir;
  }

  dropThrough() {
    this.dropThroughTimer = PHYSICS.PLATFORM_DROP_FRAMES;
    this.grounded = false;
    this.y += 2;
    this.setState(S.AIR);
  }

  startJumpsquat() {
    this.setState(S.JUMPSQUAT);
    this.jumpsUsed = 0;

    /**
     * **Horizontal carry into a jump is capped at run speed, on entry.**
     *
     * An initial dash is deliberately faster than a run — that burst is what
     * makes dashing feel responsive on the ground. Handing it straight to the
     * jump meant a dash-jump flew noticeably further and faster than a run-jump
     * off the same input, and once airborne there was no trimming it: air
     * acceleration is small, so the fighter simply sailed. Every fighter has
     * `initialDashSpeed > runSpeed`, so this affected all of them.
     *
     * The clamp happens **here rather than at takeoff** so the dash entry then
     * decays through jumpsquat exactly as a run entry does. Capping at takeoff
     * instead left the dash version 8% faster, because the run had spent three
     * frames bleeding off traction and the clamped dash had not.
     *
     * Run momentum below the cap is untouched, so a run-jump still carries
     * properly — this equalises the two takeoffs rather than slowing jumps down.
     */
    const carryCap = Math.max(this.attr.runSpeed, this.attr.airSpeed);
    if (Math.abs(this.vx) > carryCap) this.vx = Math.sign(this.vx) * carryCap;
  }

  stepJumpsquat() {
    const a = this.attr;
    this.vx = approach(this.vx, 0, a.traction * 0.4);

    // Releasing jump (or pressing attack) during jumpsquat produces a short hop.
    if (this.stateFrame === 1) this.custom._jumpHeld = true;
    if (!this.input.held.jump) this.custom._jumpHeld = false;

    if (this.stateFrame >= PHYSICS.JUMP_SQUAT_FRAMES) {
      const short = !this.custom._jumpHeld;
      this.vy = short ? a.shortHopVelocity : a.fullHopVelocity;

      // The carry was capped on entry to jumpsquat; see `startJumpsquat`.
      this.vx += this.input.x * a.jumpHorizontalBoost;
      this.grounded = false;
      this.y -= 1;
      this.fastFalling = false;
      this.setState(S.AIR);

      // An attack buffered during jumpsquat comes out immediately as an aerial.
      if (this.input.peek('attack')) { this.input.consume('attack'); this.tryAerial(); }
      else if (this.input.peek('special')) { this.input.consume('special'); this.trySpecial(); }
    }
  }

  stepLanding() {
    this.vx = approach(this.vx, 0, this.attr.traction);
    if (this.stateFrame >= (this.landingLagFrames || this.attr.landFrames)) {
      this.setState(S.IDLE);
    }
  }

  // --------------------------------------------------------------- air state

  stepAir() {
    const inp = this.input;
    this.airDrift();

    if (inp.consume('jump')) { if (this.tryAirJump()) return; }
    if (inp.consume('special')) { if (this.trySpecial()) return; }
    if (inp.consume('attack')) { if (this.tryAerial()) return; }

    const cdir = inp.cCardinal();
    if (cdir !== 'neutral') { this.tryAerial(cdir); return; }

    if (inp.consume('shield')) { if (this.tryAirDodge()) return; }

    if (inp.fastFallFlick && this.vy > 0 && !this.fastFalling) this.fastFalling = true;
  }

  airDrift() {
    const a = this.attr;
    const inp = this.input;
    const target = inp.x * a.airSpeed;

    if (Math.abs(inp.x) > PHYSICS.STICK_DEADZONE) {
      if (Math.abs(this.vx) <= a.airSpeed || sign(this.vx) !== sign(inp.x)) {
        this.vx = approach(this.vx, target, a.airAccel);
      } else {
        this.vx = approach(this.vx, target, a.airFriction);
      }
      // No aerial turnaround: facing is committed on leaving the ground and can
      // only be changed deliberately (air jump, or a directional special).
      // Auto-flipping on drift would make back air unreachable.
    } else {
      this.vx = approach(this.vx, 0, a.airFriction);
    }
  }

  tryAirJump() {
    const a = this.attr;
    if (this.jumpsUsed >= a.airJumps) return false;
    this.jumpsUsed++;
    this.vy = a.airJumpVelocity;
    this.fastFalling = false;
    // Rising under their own power from here on.
    this.launchedAirborne = false;
    // Air jumps redirect horizontal momentum toward the stick, as in Ultimate,
    // but do NOT change facing: once a fighter leaves the ground its facing is
    // committed. Only a directional special can reverse it mid-air.
    if (Math.abs(this.input.x) > PHYSICS.TILT_THRESHOLD) {
      this.vx = this.input.x * a.airSpeed * 0.95;
    } else {
      this.vx *= 0.6;
    }
    // Visual cue, as in Ultimate: an air jump is a resource you spend, and the
    // ring is how a player sees it leave. Struck at knee height rather than at
    // the feet, so it still reads when the jump happens close to the floor.
    this.world.spawnEffect({
      x: this.x, y: this.y - this.def.height * 0.22,
      kind: 'airjump', size: this.def.width * 0.95, life: 18,
    });
    this.setState(S.AIR);
    return true;
  }

  tryAirDodge() {
    if (this.airDodgesUsed >= DEFENSE.AIRDODGES_PER_AIRTIME) return false;
    this.airDodgesUsed++;
    const inp = this.input;
    if (inp.mag > PHYSICS.TILT_THRESHOLD) {
      this.startAction(this.moves.airdodgeDirectional);
      const m = this.moves.airdodgeDirectional;
      const nx = inp.x / inp.mag, ny = inp.y / inp.mag;
      this.vx = nx * m.directionalBurst;
      this.vy = ny * m.directionalBurst;
    } else {
      this.startAction(this.moves.airdodgeNeutral);
    }
    return true;
  }

  stepHelpless() {
    this.airDrift();
  }

  // ------------------------------------------------------------ attack input

  tryGroundAttack() {
    const inp = this.input;
    const a = this.moves;

    if (this.state === S.DASH || this.state === S.RUN) {
      if (a.dashAttack) { this.startAction(a.dashAttack); return true; }
    }

    // A recent flick plus the attack button is a smash attack.
    const sx = inp.smashXHeld;
    const sy = inp.smashYHeld;
    if (sx !== 0) {
      this.facing = sx;
      if (a.fsmash) { this.startAction(a.fsmash); return true; }
    }
    if (sy < 0 && a.usmash) { this.startAction(a.usmash); return true; }
    if (sy > 0 && a.dsmash) { this.startAction(a.dsmash); return true; }

    const dir = inp.cardinal();
    if (this.state === S.CROUCH || dir === 'down') { if (a.dtilt) { this.startAction(a.dtilt); return true; } }
    if (dir === 'up') { if (a.utilt) { this.startAction(a.utilt); return true; } }
    if (dir === 'left' || dir === 'right') {
      this.facing = dir === 'right' ? 1 : -1;
      if (a.ftilt) { this.startAction(a.ftilt); return true; }
    }
    if (a.jab) { this.startAction(a.jab); return true; }
    return false;
  }

  tryAerial(forcedDir = null) {
    const inp = this.input;
    const a = this.moves;
    const dir = forcedDir || inp.cardinal();

    let move = a.nair;
    if (dir === 'up') move = a.uair;
    else if (dir === 'down') move = a.dair;
    else if (dir === 'left' || dir === 'right') {
      const forward = (dir === 'right' ? 1 : -1) === this.facing;
      move = forward ? a.fair : a.bair;
    }
    if (!move) move = a.nair;
    if (!move) return false;
    this.startAction(move);
    return true;
  }

  /**
   * Special moves — the Elixir-gated "B moves".
   * Cost is checked before the move starts. If it cannot be paid the move does
   * not come out, unless the definition declares a `fallback`.
   */
  trySpecial() {
    const inp = this.input;
    const a = this.moves;
    const dir = inp.cardinal();

    let move = a.neutralB;
    if (dir === 'up') move = a.upB;
    else if (dir === 'down') move = a.downB;
    else if (dir === 'left' || dir === 'right') {
      this.facing = dir === 'right' ? 1 : -1;
      move = a.sideB;
    }
    if (!move) return false;
    return this.startSpecial(move);
  }

  /**
   * `fallback` lets a special declare what happens when it cannot be used —
   * either because its condition failed or because the Elixir isn't there.
   * The document describes exactly this for the Archer Queen: without enough
   * Elixir "she would just do a normal spot dodge".
   */
  resolveFallback(move) {
    const id = typeof move.fallback === 'function' ? move.fallback(this) : move.fallback;
    return id && this.moves[id] ? this.moves[id] : null;
  }

  startSpecial(move) {
    /**
     * `move.airVariant` — a special that is a different move off the ground.
     *
     * Cleaner than branching inside one move, because the two versions differ
     * in the parts that are *data*: their hitboxes, their frame windows and
     * their length. A grounded shockwave and an airborne dive cannot be
     * expressed as one hitbox list, and gating boxes at runtime would need a
     * predicate on every one of them.
     *
     * Resolved before the cost and cooldown checks so the variant's own price
     * is the one that applies.
     */
    if (!this.grounded && move.airVariant && this.moves[move.airVariant]) {
      move = this.moves[move.airVariant];
    }

    if (this.cooldowns.has(move.id)) { this.elixir.denied = 12; return false; }

    if (move.condition && !move.condition(this)) {
      const fb = this.resolveFallback(move);
      if (fb) { this.startAction(fb); return true; }
      this.elixir.denied = 12;
      return false;
    }

    const cost = typeof move.cost === 'function' ? move.cost(this) : (move.cost || 0);
    if (cost > 0 && !this.elixir.canAfford(cost)) {
      const fb = this.resolveFallback(move);
      if (fb) { this.startAction(fb); return true; }
      this.elixir.denied = 12;
      return false;
    }
    if (move.cooldown) this.cooldowns.set(move.id, move.cooldown);
    // A special is self-propulsion (recoveries especially), so height gained
    // from here cannot KO the fighter through the ceiling.
    this.launchedAirborne = false;
    this.startAction(move);
    // The Elixir is not taken yet — it is committed on the frame the move
    // actually produces something (see stepAction). Charging up front meant a
    // special knocked out of its startup was paid for and never came out.
    if (cost > 0) {
      this.pendingCost = cost;
      this.pendingCostFrame = this.releaseFrameOf(move);
    }
    return true;
  }

  /**
   * The frame a special's cost is committed on: the moment it actually
   * produces something. Declared per move as `costFrame`, defaulting to the
   * first active hitbox, and finally to frame 1 — a special with neither
   * spends its whole effect in `onStart`, so by frame 1 it has already
   * delivered and is owed payment.
   */
  releaseFrameOf(move) {
    if (move.costFrame !== undefined) return move.costFrame;
    if (move.hitboxes && move.hitboxes.length) {
      return Math.min(...move.hitboxes.map((h) => h.frames[0]));
    }
    return 1;
  }

  // ---------------------------------------------------------- action runner

  startAction(move, opts = {}) {
    if (!move) return;
    // Assign state directly: setState() short-circuits when already in ACTION,
    // which would leave the previous move's frame counter running.
    this.state = S.ACTION;
    this.stateFrame = 0;
    this.shield.active = false;
    // Any new action supersedes an unpaid one — a special cancelled into
    // another move never came out, so it is never charged.
    this.pendingCost = 0;
    this.move = move;
    this.moveFrame = 0;
    this._moveAccum = 0;
    this.moveCtx = { ...opts };
    this.hitTargets.clear();
    this.charging = false;
    this.chargeFrames = 0;

    /**
     * The floor a grounded attack was launched from, so it can be kept over it.
     * Captured here rather than read live because several dash attacks leave the
     * ground mid-move — once airborne there is nothing underneath to ask.
     */
    this._edgePlat = (move.kind === 'ground' && this.grounded)
      ? (this.platform || this.world.stage.groundUnder(this))
      : null;

    if (move.momentum !== undefined) this.vx *= move.momentum;
    else if (move.kind === 'ground' || move.kind === 'grab') {
      if (this.grounded && !move.keepMomentum) this.vx *= 0.4;
    }

    if (move.onStart) move.onStart(this, this.moveCtx);
  }

  endAction() {
    const m = this.move;
    if (m && m.onEnd) m.onEnd(this, this.moveCtx);
    this.move = null;
    this.charging = false;
    this.chargeFrames = 0;

    // `freefallAfter` is usually a property of the move, but it can also be
    // handed to a single invocation through `moveCtx`. That is what lets a
    // recovery be cancelled into an aerial without the aerial itself becoming a
    // freefall move: the recovery has already been spent, so whatever it was
    // cancelled into inherits the consequence.
    if (m && (m.freefallAfter || this.moveCtx.freefallAfter) && !this.grounded) {
      this.setState(S.HELPLESS);
      return;
    }
    if (this.grounded) this.setState(S.IDLE);
    else this.setState(S.AIR);
  }

  stepAction() {
    const m = this.move;
    if (!m) { this.setState(this.grounded ? S.IDLE : S.AIR); return; }

    // --- Smash charging: hold the frame counter while the button is held ---
    if (m.charge && this.moveFrame === m.charge.frame - 1 && !this.charging && !this.moveCtx.noCharge) {
      this.charging = true;
    }
    if (this.charging) {
      // Smashes charge on attack; a special that charges does it on its own
      // button, or holding B to wind one up would also be holding B to cancel.
      const held = m.charge.button === 'special'
        ? this.input.held.special : this.input.held.attack;
      const max = m.charge.maxFrames || SMASH_CHARGE.MAX_FRAMES;
      if (held && this.chargeFrames < max) {
        this.chargeFrames++;
        this.vx = approach(this.vx, 0, this.attr.traction);
        if (m.onChargeFrame) m.onChargeFrame(this, this.chargeFrames);
        return; // freeze the move on its charge frame
      }
      this.charging = false;
    }

    /**
     * `moveRate` lets a state run a fighter's moves faster or slower than real
     * time — the Barbarian's Rage uses it to cut his startup.
     *
     * Fractional rates are carried in an accumulator and spent as whole frames,
     * so at 1.25 the counter goes 1, 1, 1, 2 rather than drifting out of step
     * with hitbox windows that are written as integers. Every window in the game
     * is at least three frames wide, so a skipped frame cannot skip a hitbox.
     */
    this._moveAccum += (this.moveRate || 1);
    const advance = Math.floor(this._moveAccum);
    this._moveAccum -= advance;
    this.moveFrame += advance;

    // Pay for the special on the frame it comes out, not on the frame it was
    // input. Anything that knocked the fighter out of it before now — a hit, a
    // grab, a cancel — costs them nothing.
    if (this.pendingCost > 0 && this.moveFrame >= this.pendingCostFrame) {
      this.elixir.spend(this.pendingCost);
      this.pendingCost = 0;
    }

    if (m.movement) {
      for (const step of m.movement) {
        if (step.frame !== this.moveFrame) continue;
        if (step.mode === 'set') {
          if (step.vx !== undefined) this.vx = step.vx * this.facing;
          if (step.vy !== undefined) this.vy = step.vy;
        } else {
          if (step.vx !== undefined) this.vx += step.vx * this.facing;
          if (step.vy !== undefined) this.vy += step.vy;
        }
        // A move that drives itself upward is leaving the ground — without
        // this the velocity is handed straight back to the floor collision and
        // the leap never happens. The nudge clears the surface so the same
        // collision does not catch it again on the frame it starts.
        if (step.vy !== undefined && step.vy < 0 && this.grounded) {
          this.grounded = false;
          this.y -= 1;
        }
      }
    }

    if (m.travel && inWindow(this.moveFrame, m.travel.frames)) {
      const span = m.travel.frames[1] - m.travel.frames[0] + 1;
      const perFrame = m.travel.distance / span;
      const dir = m.travel.dir * this.facing;
      this.x += perFrame * dir;
      this.vx = 0;
      // Rolls stop at the edge rather than sliding off, matching Smash.
      if (this.grounded && !this.world.stage.groundUnder(this, 4)) {
        this.x -= perFrame * dir;
      }
    }

    if (m.intangible && inWindow(this.moveFrame, m.intangible)) this.intangibleFrames = Math.max(this.intangibleFrames, 1);
    if (m.invincible && inWindow(this.moveFrame, m.invincible)) this.invincibleFrames = Math.max(this.invincibleFrames, 1);
    this.armorThreshold = (m.armor && inWindow(this.moveFrame, m.armor.frames)) ? m.armor.threshold : 0;

    // Hold the hang position until the option actually leaves the ledge.
    if (m.kind === 'ledge' && this.ledge) {
      const pos = this.world.stage.hangPosition(this.ledge, this.height);
      this.x = pos.x; this.y = pos.y;
      this.vx = 0; this.vy = 0;
    }

    if (m.ledgeRelease && this.moveFrame === m.ledgeRelease.frame) {
      this.releaseLedge(true);
      this.vy = m.ledgeRelease.vy;
      this.vx = m.ledgeRelease.vx * this.facing;
      this.grounded = false;
    }

    if (m.ledgeClimb && this.moveFrame === m.ledgeClimb.frame) {
      const ledge = this.ledge;
      if (ledge) {
        // Step up onto the lip: inward from the ledge by half the body width.
        this.x = ledge.x - ledge.dir * (this.halfWidth + 8);
        if (m.ledgeClimb.extra) this.x -= ledge.dir * m.ledgeClimb.extra;
        this.y = ledge.y;
        this.grounded = true;
        this.vx = 0; this.vy = 0;
        this.releaseLedge(false);
      }
    }

    // Throws hold the victim until the release frame, then launch them.
    if (m.kind === 'throw') {
      if (this.grabbing) {
        this.grabbing.x = this.x + GRAB.HOLD_OFFSET * this.facing * (m.reverse ? -1 : 1);
        this.grabbing.y = this.y;
        this.grabbing.vx = 0; this.grabbing.vy = 0;
      }
      if (this.moveFrame === m.releaseFrame) this.executeThrow(m);
    }

    if (m.onFrame) m.onFrame(this, this.moveFrame, this.moveCtx);

    // Air actions still drift unless the move locks movement.
    if (!this.grounded && m.allowDrift !== false && m.kind !== 'airdodge') this.airDrift();
    // A directional air dodge is an impulse that bleeds off, not a constant
    // glide — otherwise it carries the fighter halfway across the stage.
    if (m.kind === 'airdodge' && m.burstDecay) {
      this.vx = approach(this.vx, 0, m.burstDecay);
      if (this.vy < 0) this.vy = approach(this.vy, 0, m.burstDecay);
    }
    if (this.grounded && m.kind === 'ground') this.vx = approach(this.vx, 0, this.attr.traction * 0.8);

    // Interrupt windows: jab rekindles, cancels into specials, etc.
    if (m.cancelInto && this.moveFrame >= m.cancelInto.from && this.moveFrame <= m.cancelInto.to) {
      if (this.input.consume('attack') && m.cancelInto.attack && this.moves[m.cancelInto.attack]) {
        this.startAction(this.moves[m.cancelInto.attack]);
        return;
      }
      if (this.input.peek('special') && m.cancelInto.special) {
        this.input.consume('special');
        if (this.trySpecial()) return;
      }
    }

    if (this.moveFrame >= m.total) this.endAction();
  }

  // ------------------------------------------------------------- shielding

  enterShield() {
    if (this.state !== S.SHIELD) {
      this.setState(S.SHIELD);
      this.shield.active = true;
    }
  }

  stepShield() {
    const inp = this.input;
    this.shield.active = true;
    this.vx = approach(this.vx, 0, this.attr.traction);

    this.shield.health -= SHIELD.DECAY_PER_FRAME;
    if (this.shield.health <= 0) { this.breakShield(); return; }

    // Out-of-shield options.
    if (inp.consume('jump')) { this.startJumpsquat(); return; }
    if (inp.consume('grab')) { this.startAction(this.moves.grab); return; }
    // Up-smash out of shield is an up flick plus attack. The right stick no
    // longer reaches it — it is the tilt stick now, and having it still produce
    // a smash from exactly one state would be the inconsistency this change
    // exists to remove.
    if (inp.smashY < 0 && inp.consume('attack')) {
      if (this.moves.usmash) { this.startAction(this.moves.usmash); return; }
    }
    if (inp.consume('special')) { if (this.trySpecial()) return; }

    if (inp.smashY > 0) { this.startAction(this.moves.spotdodge); return; }
    if (inp.smashX !== 0) {
      const forward = inp.smashX === this.facing;
      this.startAction(forward ? this.moves.rollForward : this.moves.rollBack);
      if (!forward) this.moveCtx.back = true;
      return;
    }

    if (!inp.held.shield) { this.setState(S.SHIELD_DROP); }
  }

  stepShieldStun() {
    this.shield.active = true;
    this.vx = approach(this.vx, 0, this.attr.traction * 0.5);
    this.shieldStun--;
    if (this.shieldStun <= 0) {
      this.setState(this.input.held.shield ? S.SHIELD : S.SHIELD_DROP);
    }
  }

  stepShieldDrop() {
    this.vx = approach(this.vx, 0, this.attr.traction);
    if (this.input.held.shield) { this.enterShield(); return; }
    if (this.stateFrame >= SHIELD.RELEASE_FRAMES) this.setState(S.IDLE);
  }

  breakShield() {
    this.shield.health = 0;
    this.shield.active = false;
    this.setState(S.SHIELD_BREAK);
    this.vy = SHIELD.BREAK_LAUNCH;
    this.grounded = false;
  }

  stepShieldBreak() {
    if (this.grounded && this.stateFrame > 4) {
      this.setState(S.DIZZY);
      this.dizzyFrames = SHIELD.BREAK_STUN;
    }
  }

  stepDizzy() {
    this.vx = approach(this.vx, 0, this.attr.traction);
    this.dizzyFrames -= 1 + (this.input.mag > 0.5 ? 1 : 0); // mashing shortens it
    if (this.dizzyFrames <= 0) {
      this.shield.health = SHIELD.MAX_HEALTH * 0.6;
      this.setState(S.IDLE);
    }
  }

  updateShieldMeter() {
    if (!this.shield.active && this.shield.health < SHIELD.MAX_HEALTH) {
      this.shield.health = Math.min(SHIELD.MAX_HEALTH, this.shield.health + SHIELD.REGEN_PER_FRAME);
    }
    const t = clamp(this.shield.health / SHIELD.MAX_HEALTH, 0, 1);
    this.shield.radius = SHIELD.RADIUS_MIN + (SHIELD.RADIUS_MAX - SHIELD.RADIUS_MIN) * t;
  }

  // --------------------------------------------------------------- hitstun

  stepHitstun() {
    this.hitstun--;
    // No drift during hitstun — DI was already committed when the launch resolved.
    if (this.hitstun <= 0) {
      this.tumbling = false;
      // Whatever the launch has left folds into ordinary momentum, so the
      // fighter keeps drifting out of it rather than stopping dead.
      this.launchActive = false;
      this.setState(this.grounded ? S.IDLE : S.AIR);
    }
  }

  stepDowned() {
    this.vx = approach(this.vx, 0, this.attr.traction * 1.5);
    const inp = this.input;
    if (this.stateFrame < 8) return;
    if (inp.smashX !== 0) {
      this.startAction(inp.smashX === this.facing ? this.moves.getupRollForward : this.moves.getupRollBack);
      return;
    }
    if (inp.consume('attack')) { this.startAction(this.moves.getupAttack); return; }
    if (inp.consume('jump') || inp.consume('shield') || this.stateFrame >= DEFENSE.KNOCKDOWN_MIN_FRAMES) {
      this.startAction(this.moves.getup);
    }
  }

  doTech() {
    this.techLockout = DEFENSE.TECH_LOCKOUT;
    this.hitstun = 0;
    this.tumbling = false;
    const inp = this.input;
    if (inp && Math.abs(inp.x) > PHYSICS.TILT_THRESHOLD) {
      const forward = sign(inp.x) === this.facing;
      this.startAction(forward ? this.moves.techRollForward : this.moves.techRollBack);
    } else {
      this.startAction(this.moves.techInPlace);
    }
    this.vx = 0; this.vy = 0;
  }

  // ------------------------------------------------------------------ ledge

  tryGrabLedge() {
    // Aerials and specials can be interrupted by a ledge grab, as in Ultimate;
    // scripted ground/ledge sequences cannot.
    const BLOCKED = LEDGE_BLOCKED_KINDS;
    if (this.state === S.ACTION && this.move && BLOCKED.has(this.move.kind)) return;
    if (this.state === S.HITSTUN || this.state === S.GRABBED) return;
    if (this.move && this.move.noLedgeGrab) return;

    const ledge = this.world.stage.findLedge(this);
    if (!ledge) return;

    // Ledge trump: a fresh grab knocks the current occupant off.
    if (ledge.occupant && ledge.occupant !== this) {
      const victim = ledge.occupant;
      victim.releaseLedge(true);
      victim.setState(S.TUMBLE);
      victim.hitstun = LEDGE.TRUMP_STUN;
      victim.tumbling = true;
      victim.vx = ledge.dir * 3;
      victim.vy = -2;
      victim.setState(S.HITSTUN);
    }

    this.grabLedge(ledge);
  }

  grabLedge(ledge) {
    this.ledge = ledge;
    ledge.occupant = this;
    const pos = this.world.stage.hangPosition(ledge, this.height);
    this.x = pos.x; this.y = pos.y;
    this.vx = 0; this.vy = 0;
    this.facing = -ledge.dir;
    this.grounded = false;
    this.fastFalling = false;
    this.jumpsUsed = 0;
    this.airDodgesUsed = 0;
    this.launchedAirborne = false;
    this.launchActive = false;
    this.move = null;
    this.hitstun = 0;
    this.setState(S.LEDGE_HANG);

    // Intangibility on grab, drained from a per-airtime budget so repeated
    // regrabs stop being free.
    const grant = Math.min(LEDGE.GRAB_INTANGIBILITY, this.ledgeIntangibilityBudget);
    if (grant > 0) {
      this.intangibleFrames = Math.max(this.intangibleFrames, grant);
      this.ledgeIntangibilityBudget -= grant;
    }
  }

  releaseLedge(lockout = true) {
    if (this.ledge) {
      if (this.ledge.occupant === this) this.ledge.occupant = null;
      this.ledge = null;
    }
    if (lockout) this.ledgeLockout = LEDGE.REGRAB_LOCKOUT;
  }

  stepLedgeHang() {
    const inp = this.input;
    const ledge = this.ledge;
    if (!ledge) { this.setState(S.AIR); return; }

    const pos = this.world.stage.hangPosition(ledge, this.height);
    this.x = pos.x; this.y = pos.y;
    this.vx = 0; this.vy = 0;
    this.ledgeIntangibilityBudget = Math.max(0, this.ledgeIntangibilityBudget - 1);

    const inward = -ledge.dir;

    if (inp.consume('jump') || inp.smashY < 0 || inp.y < -PHYSICS.SMASH_THRESHOLD) {
      this.startAction(this.moves.ledgeJump); return;
    }
    if (inp.consume('attack')) { this.startAction(this.moves.ledgeAttack); return; }
    if (inp.consume('shield')) { this.startAction(this.moves.ledgeRoll); return; }
    if (inp.consume('special')) {
      this.releaseLedge(true);
      this.grounded = false;
      if (this.trySpecial()) return;
      this.setState(S.AIR); return;
    }
    if (Math.abs(inp.x) > PHYSICS.TILT_THRESHOLD && sign(inp.x) === inward) {
      this.startAction(this.moves.ledgeGetup); return;
    }
    if ((Math.abs(inp.x) > PHYSICS.TILT_THRESHOLD && sign(inp.x) === ledge.dir) || inp.y > PHYSICS.SMASH_THRESHOLD) {
      this.releaseLedge(true);
      this.grounded = false;
      this.jumpsUsed = 0;
      this.setState(S.AIR);
    }
  }

  // ------------------------------------------------------------------ grabs

  /** Called by the hit system when this fighter's grab box catches someone. */
  onGrabConnect(victim) {
    // A grab cancels shield-style gimmicks — the documented counterplay to
    // moves like the Wizard's Fire Shield.
    if (victim.def.onGrabbed) victim.def.onGrabbed(victim, this);
    this.grabbing = victim;
    victim.grabbedBy = this;
    victim.setState(S.GRABBED);
    victim.move = null;
    victim.hitstun = 0;
    victim.vx = 0; victim.vy = 0;
    victim.mashProgress = 0;
    this.grabHold = Math.min(
      GRAB.MAX_HOLD_FRAMES,
      GRAB.BASE_HOLD_FRAMES + victim.damage * GRAB.HOLD_FRAMES_PER_PERCENT,
    );
    // Fresh grab, fresh pummel timer — otherwise a leftover cooldown from the
    // last grab would eat the first pummel of this one.
    this.pummelCooldown = 0;

    /**
     * `move.commandGrab` — a grab that goes straight into its own throw.
     *
     * A normal grab drops into `GRABBING`, where the player chooses a direction
     * and can be mashed out of. A command grab is a *move*: it caught you, and
     * what happens next is scripted. Naming the follow-up here routes it into
     * the ordinary throw machinery, which already carries the victim along and
     * launches them on `releaseFrame` — so the slam needs no special handling
     * beyond being a throw that happens to travel.
     *
     * These bypass shield for free, because `isGrabbable` never excluded
     * shielding fighters. That is the whole point of the archetype.
     */
    const cg = this.move && this.move.commandGrab;
    if (cg && this.moves[cg]) { this.startThrow(this.moves[cg]); return; }

    this.setState(S.GRABBING);
  }

  stepGrabbing() {
    const victim = this.grabbing;
    if (!victim || victim.grabbedBy !== this) { this.grabbing = null; this.setState(S.IDLE); return; }

    this.vx = 0;
    victim.x = this.x + GRAB.HOLD_OFFSET * this.facing;
    victim.y = this.y;
    victim.facing = -this.facing;

    this.grabHold -= 1 + victim.mashProgress;
    victim.mashProgress = 0;

    const inp = this.input;
    const dir = inp.cardinal();

    /**
     * One pummel per `PUMMEL_FRAMES`, mashing or not.
     *
     * The pummel move declares a length but never runs as an action — the hit
     * is applied inline and the fighter stays in the grab — so nothing was
     * enforcing that length and the only thing spacing pummels out was their
     * own hitlag. That let a mashed grab land one every 8.6 frames against the
     * 16 the data asks for, roughly doubling the damage a grab was worth.
     */
    if (this.pummelCooldown <= 0 && inp.consume('attack')) {
      const p = this.moves.pummel;
      victim.damage += p.damage;
      victim.recordDamage(this, p.damage);
      this.grabHold -= 6;
      this.hitlag = 8; victim.hitlag = 8; victim.hitlagIsVictim = false;
      victim.flashFrames = 4;
      this.pummelCooldown = p.total;
      return;
    }

    let throwMove = null;
    if (dir === 'up') throwMove = this.moves.uthrow;
    else if (dir === 'down') throwMove = this.moves.dthrow;
    else if (dir === 'left' || dir === 'right') {
      throwMove = (dir === 'right' ? 1 : -1) === this.facing ? this.moves.fthrow : this.moves.bthrow;
    }
    if (throwMove) { this.startThrow(throwMove); return; }

    if (this.grabHold <= 0) {
      // Grab release: both fighters pop out neutral.
      victim.releaseFromGrab();
      this.grabbing = null;
      this.setState(S.IDLE);
      victim.intangibleFrames = 8;
    }
  }

  startThrow(move) {
    this.moveCtx = { victim: this.grabbing };
    this.startAction(move);
    this.moveCtx.victim = this.grabbing;
  }

  /** Applies a throw's damage and knockback. Called from the throw's release frame. */
  executeThrow(move) {
    const victim = this.grabbing;
    if (!victim) return;
    const facing = move.reverse ? -this.facing : this.facing;
    victim.damage += move.damage;
    victim.releaseFromGrab();
    this.grabbing = null;

    victim.applyLaunch({
      attacker: this,
      damage: move.damage,
      angle: move.angle,
      bkb: move.bkb,
      kbg: move.kbg,
      facing,
      moveId: move.id,
      throwing: true,
    });
    this.intangibleFrames = Math.max(this.intangibleFrames, GRAB.THROW_RELEASE_INTANGIBILITY);
  }

  stepGrabbed() {
    const inp = this.input;
    // Mashing (any input) shortens the hold.
    if (inp.pressed.attack || inp.pressed.special || inp.pressed.jump ||
        inp.pressed.shield || inp.pressed.grab || inp.smashX !== 0 || inp.smashY !== 0) {
      this.mashProgress += GRAB.MASH_FRAMES_PER_INPUT;
    }
    if (!this.grabbedBy || this.grabbedBy.grabbing !== this) this.releaseFromGrab();
  }

  releaseFromGrab() {
    if (this.grabbedBy) {
      if (this.grabbedBy.grabbing === this) this.grabbedBy.grabbing = null;
      this.grabbedBy = null;
    }
    if (this.state === S.GRABBED) this.setState(this.grounded ? S.IDLE : S.AIR);
  }

  // ------------------------------------------------------------ taking hits

  /**
   * Books a connected hit for the results screen, and records who landed it so
   * the following KO can be credited. Every path that adds damage — attacks,
   * throws, pummels, armoured absorbs — funnels through here.
   */
  recordDamage(attacker, amount) {
    this.stats.damageTaken += amount;
    if (!attacker || attacker === this) return;
    attacker.stats.damageDealt += amount;
    attacker.stats.hits++;
    if (amount > attacker.stats.biggestHit) attacker.stats.biggestHit = amount;
    this.lastHitBy = attacker;
    this.lastHitByFrame = this.world ? this.world.frame : 0;
  }

  /**
   * Applies a hit. Called by the hit system after it has resolved staling,
   * charge multipliers and shield.
   */
  applyLaunch({ attacker, damage, angle, bkb, kbg, facing, moveId, hitlagFrames = 0, setKnockback = null, hitstun = null, throwing = false, effect = 'none' }) {
    this.damage += throwing ? 0 : damage;
    this.flashFrames = 6;
    this.lastHitEffect = effect;
    this.recordDamage(attacker, damage);

    // Character hook: combo breakers and on-hit gimmicks (e.g. the Wizard's
    // Fire Shield) fire here, before the launch resolves. Returning true means
    // the hit was absorbed — damage still lands, knockback does not.
    if (this.def.onHitTaken && this.def.onHitTaken(this, { attacker, damage, effect, moveId })) {
      this.pendingHit = null;
      return;
    }

    this.pendingHit = { attacker, damage, angle, bkb, kbg, facing, moveId, setKnockback, hitstun };
    this.sdiUsed = 0;

    if (hitlagFrames > 0 && !throwing) {
      this.hitlag = hitlagFrames;
      this.hitlagIsVictim = true;
    } else {
      this.resolvePendingHit();
    }
  }

  /** Converts the stored hit into an actual launch, reading DI at this instant. */
  resolvePendingHit() {
    const hit = this.pendingHit;
    this.pendingHit = null;
    if (!hit) return;

    const wasGrounded = this.grounded;
    let knockback;
    if (hit.setKnockback !== null && hit.setKnockback !== undefined) {
      knockback = hit.setKnockback;
    } else {
      knockback = computeKnockback({
        percent: this.damage,
        damage: hit.damage,
        weight: this.def.weight,
        bkb: hit.bkb,
        kbg: hit.kbg,
        rageBonus: hit.attacker ? rageBonus(hit.attacker.damage) : 0,
      });
    }

    const angleDeg = resolveAngle(hit.angle, knockback, wasGrounded);

    /**
     * A hitbox may state its own hitstun instead of deriving it from knockback.
     *
     * The two are normally the same quantity seen twice, which is right for
     * almost everything — hit harder, hold longer. It is wrong for a jab string.
     * There, the hold has to be long enough that the opponent cannot walk out
     * between links, while the push has to be near zero so they stay in range of
     * the finisher; tying them together means every frame of hold buys another
     * few pixels of separation, and the string defeats itself.
     */
    const stun = (kb) => (hit.hitstun !== null && hit.hitstun !== undefined
      ? hit.hitstun : hitstunFrames(kb));

    // Low knockback on a grounded target does not launch — it just shoves.
    if (wasGrounded && knockback < KNOCKBACK.GROUNDED_THRESHOLD && angleDeg === 0) {
      this.vx = knockback * KNOCKBACK.SPEED_PER_KB * 0.6 * hit.facing;
      this.hitstun = stun(knockback);
      this.tumbling = false;
      this.launchSpeed = Math.abs(this.vx);
      this.setState(S.HITSTUN);
      this.releaseLedge(true);
      return;
    }

    const di = this.input ? { x: this.input.x, y: this.input.y } : { x: 0, y: 0 };
    const v = launchVelocity(knockback, angleDeg, hit.facing, di);

    this.vx = v.vx;
    this.vy = v.vy;
    // Hand the launch to the decaying-vector integrator; gravity is tracked
    // separately from here so it does not eat the horizontal burst.
    this.launchActive = true;
    this.launchVx = v.vx;
    this.launchVy = v.vy;
    this.launchGravity = 0;
    // Only an upward launch arms the ceiling.
    if (v.vy < 0) this.launchedAirborne = true;
    this.launchSpeed = knockback * KNOCKBACK.SPEED_PER_KB;
    this.hitstun = stun(knockback);
    this.tumbling = knockback >= KNOCKBACK.TUMBLE_THRESHOLD;
    this.fastFalling = false;
    this.grounded = false;
    this.y -= 1;
    this.move = null;
    this.charging = false;
    this.releaseLedge(true);
    this.releaseFromGrab();
    if (this.grabbing) { this.grabbing.releaseFromGrab(); this.grabbing = null; }
    this.setState(S.HITSTUN);

    this.world.camera.addShake(knockback);
  }

  /** Shield absorbs a hit. */
  applyShieldHit({ damage, stun, pushback, facing }) {
    this.shield.health -= damage * SHIELD.DAMAGE_MUL;
    this.shieldStun = stun;
    this.vx += pushback * facing;
    this.setState(S.SHIELD_STUN);
    this.shield.active = true;
    if (this.shield.health <= 0) this.breakShield();
  }

  // -------------------------------------------------------------------- KO

  onKO() {
    this.alive = false;
    this.stocks--;
    this.setState(S.DEAD);
    this.resetVolatile();
    this.vx = 0; this.vy = 0;
  }

  stepRespawn() {
    this.vx = 0; this.vy = 0;
    this.respawnTimer--;
    const inp = this.input;
    const wantsOut = inp && (inp.mag > PHYSICS.TILT_THRESHOLD || inp.pressed.attack ||
      inp.pressed.jump || inp.pressed.special || inp.pressed.shield);
    if (this.respawnTimer <= 0 || (wantsOut && this.stateFrame > 12)) {
      this.grounded = false;
      this.setState(S.AIR);
      if (inp) inp.clearBuffer();
    }
  }
}
