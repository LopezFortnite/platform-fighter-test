import { SIM, ELIXIR } from '../../config/gameplay.js';

/**
 * GOBLIN — Brawler
 *
 * The document's first archetype: "Limited range, hand-to-hand, combo-oriented."
 * The smallest and fastest fighter on the roster — a fifth shorter than the
 * Bandit and a tenth quicker — with a dagger in his **right** hand.
 *
 * His mechanic is **Gold Rush**. Landing normals mints gold; enough gold buys a
 * ten second window where he is much faster and hits much harder. Everything about him is
 * built around that loop: he is fragile and short-ranged, so the meter is the
 * reward for actually getting in, and spending it is what makes the risk pay.
 *
 * His normals, smashes and aerials are all authored against his own `dag*`
 * poses. The specials other than Down B are still placeholders on shared pose
 * families — deliberately unremarkable frame data that can be replaced
 * wholesale without disturbing anything else.
 */

const S = SIM.FPS;

/** Elixir cost to spend a full meter. */
const RUSH_COST = 10;
/** How long the state lasts once bought. */
const RUSH_DURATION = 10 * S;

/**
 * What a full meter is worth.
 *
 * Sized against the gold values below: a jab pays 1, a smash pays 8. Lowering
 * this is how the meter is made to fill faster — the per-move values keep their
 * relative worth and only the target moves, which is one edit rather than
 * twenty. At 74 it fills roughly a third quicker than it did at 100.
 */
export const GOLD_MAX = 74;

/** Gold Rush: quicker, harder, and slower to refill Elixir while it runs. */
const RUSH_MOVE_MUL = 1.32;
const RUSH_DAMAGE_MUL = 1.35;
const RUSH_ELIXIR_MUL = 0.75;

/**
 * What each move is worth when it lands.
 *
 * Keyed by move id, falling back by kind, so a move that has not been given a
 * value still mints something rather than silently paying nothing. Bigger,
 * more committal hits pay more — the meter should reward landing the things
 * that are actually hard to land.
 */
const GOLD_BY_MOVE = {
  jab: 1, jab2: 1, jab3: 2,
  ftilt: 3, utilt: 3, dtilt: 3,
  dashAttack: 4,
  nair: 2, fair: 3, bair: 3, uair: 3, dair: 4,
  fsmash: 8, usmash: 7, dsmash: 7,
  fthrow: 4, bthrow: 4, uthrow: 4, dthrow: 4,
};
const GOLD_BY_KIND = { ground: 2, aerial: 2, throw: 4 };

/**
 * Gold is minted by **normals only**.
 *
 * Specials are excluded by design: they already cost Elixir, and letting them
 * pay into the meter as well would mean the cheapest way to fund Gold Rush is
 * to spend Elixir, which is a loop that feeds itself. The meter is meant to be
 * earned with the moves that cost nothing but risk.
 */
function goldFor(move) {
  if (!move || move.kind === 'special') return 0;
  const byId = GOLD_BY_MOVE[move.id];
  if (byId !== undefined) return byId;
  return GOLD_BY_KIND[move.kind] || 0;
}

function startRush(f) {
  const g = f.custom.gold;
  g.active = true;
  g.frames = RUSH_DURATION;
  // Frames of the activation judder — see the rig, which reads this.
  g.shake = 26;
  g.value = GOLD_MAX;               // drains from full as the state runs
  /**
   * A **copy** of his attributes, not an edit of them. `fighter.attr` points
   * straight at the shared definition object, so scaling it in place would
   * speed up every Goblin in the session — including the opponent in a mirror.
   */
  const a = f.def.attributes;
  f.attr = {
    ...a,
    walkSpeed: a.walkSpeed * RUSH_MOVE_MUL,
    runSpeed: a.runSpeed * RUSH_MOVE_MUL,
    initialDashSpeed: a.initialDashSpeed * RUSH_MOVE_MUL,
    airSpeed: a.airSpeed * RUSH_MOVE_MUL,
    runAccel: a.runAccel * RUSH_MOVE_MUL,
    airAccel: a.airAccel * RUSH_MOVE_MUL,
  };
  f.damageBuff = RUSH_DAMAGE_MUL;
}

function endRush(f) {
  const g = f.custom.gold;
  g.active = false;
  g.value = 0;
  f.attr = f.def.attributes;
  f.damageBuff = 1;
  f.world.spawnEffect({
    x: f.x, y: f.y - f.def.height * 0.5,
    kind: 'smoke', size: 40, life: 16, color: '#e8b33c',
  });
}

/**
 * The Goblin Barrel coming apart, in staves and dust.
 *
 * Two flavours from one function because the two landings are the same event
 * dressed differently: arriving on the stage is an impact and gets debris, a
 * thump and a shake; catching the ledge is a fumble and gets a few quiet
 * splinters. Sharing the code keeps them recognisably the same barrel.
 */
function breakBarrel(f, quiet) {
  const w = f.world;
  const cy = f.y - f.def.height * 0.46;

  /**
   * Landing on the stage is itself an attack.
   *
   * Spawned as a stationary, single-frame projectile rather than added to the
   * move's own hitbox list, because by the time this fires the move is being cut
   * short — a box scheduled on a frame the move will never reach cannot go live.
   * A projectile is the engine's existing way to say "damage at this point in
   * space, now", and it already handles teams and shields.
   *
   * The ledge landing gets none of it. Catching the ledge is the fumble ending,
   * and rewarding it would make the recovery an edgeguard as well.
   */
  if (!quiet) {
    w.spawnProjectile(f, {
      x: f.x, y: cy,
      vx: 0, vy: 0, gravity: 0,
      radius: 46, life: 2,
      damage: 7, angle: 74, bkb: 56, kbg: 62,
      facing: f.facing, moveId: 'goblinBarrelImpact',
      color: '#c08a4e', shape: 'burst', priority: 40,
      effect: 'blunt',
      destroyOnGround: false, collidesWithProjectiles: false,
    });
  }
  const n = quiet ? 5 : 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    w.spawnEffect({
      x: f.x + Math.cos(a) * 14, y: cy + Math.sin(a) * 12,
      vx: Math.cos(a) * (quiet ? 1.6 : 3.4),
      vy: Math.sin(a) * (quiet ? 1.2 : 2.6) - (quiet ? 0.8 : 2.0),
      kind: 'smoke', size: quiet ? 9 : 13, life: quiet ? 18 : 26,
      color: i % 3 === 0 ? '#7a5228' : '#c08a4e',
      spin: (Math.random() - 0.5) * 9,
    });
  }
  if (!quiet) {
    w.spawnEffect({ x: f.x, y: cy, kind: 'explosion', size: 46, life: 14, color: '#e0b070' });
    w.camera.addShake(12);
  }
}

export const goblin = {
  id: 'goblin',
  name: 'Goblin',
  archetype: 'Brawler',
  blurb: 'Small, quick and greedy. Landing hits mints gold; gold buys speed.',
  color: '#7ac74f',
  accent: '#2f6b22',
  /**
   * A fifth smaller than the Bandit (52x92) in both directions, and lighter
   * with it, so he is launched further for the same hit. That fragility is the
   * counterweight to the speed and the meter.
   */
  width: 42,
  height: 74,
  reach: 0.82,
  weight: 74,
  hitEffect: 'slash',

  /**
   * Built from the card art: green skin, long swept-back ears, a wide grin, red
   * braces over a bare chest, dark cropped trousers and brown boots. The dagger
   * is in his **right** hand.
   *
   * No coin — that is the card's joke, not the model's.
   */
  model: {
    palette: {
      garment: '#7ac74f',        // bare chest: the torso wears skin
      garmentDark: '#5da33a',
      trim: '#c0392b',
      skin: '#7ac74f',
      hair: '#5da33a',
      leather: '#6b4426',
      metal: '#c2c8d2',
      gold: '#e8b33c',
      trousers: '#3b3f47',       // dark cropped trousers
      boot: '#7a4f27',
      eye: '#f0e6c8',
      wood: '#7a5433',
      woodDark: '#5a3d24',
    },
    /**
     * Wiry rather than merely scaled down. Narrow shoulders and thin limbs on a
     * short frame is what separates "small fighter" from "the Bandit at 80%".
     */
    build: { shoulders: 0.86, chest: 0.88, arms: 0.80, legs: 0.92 },

    ears: { length: 2.4 },
    brows: true,
    shorts: true,
    belt: { color: '#6b4426', buckle: 'gold' },
    suspenders: { color: '#c0392b' },
    // Bare-handed — nothing on his hands in the card art.
    gloves: false,
    weapon: 'dagger',
    weaponHand: 'right',

    // Props for his specials — all hidden until the move that needs them.
    spear: { wood: '#b08040', wrap: '#6b4426', metal: '#c9d0da' },
    gobBarrel: { wood: '#c08a4e', woodDark: '#a06f38', band: '#7a5228' },
    drill: { metal: '#d3d8de', metalDark: '#9aa3ad', rivet: '#7d868f' },

    variants: {
      red: { palette: { trim: '#c0392b' }, suspenders: { color: '#c0392b' } },
      blue: { palette: { trim: '#2f6fd0' }, suspenders: { color: '#2f6fd0' } },
    },
  },

  portrait: { src: 'assets/portraits/goblin.png', crop: [0.16, 0.06, 0.68, 0.46] },

  attributes: {
    // A tenth quicker than the Bandit across the board, and floatier with it —
    // a light fighter should feel light in the air as well as on the ground.
    walkSpeed: 3.5,
    runSpeed: 7.9,
    initialDashSpeed: 9.4,
    dashFrames: 4,
    runAccel: 0.82,
    traction: 0.52,
    turnFrames: 5,
    runBrakeFrames: 10,

    airSpeed: 6.7,
    airAccel: 0.34,
    airFriction: 0.04,
    gravity: 0.50,
    maxFall: 9.0,
    fastFallMul: 1.6,

    fullHopVelocity: -12.6,
    shortHopVelocity: -7.4,
    airJumpVelocity: -11.6,
    airJumps: 1,
    jumpHorizontalBoost: 0.7,

    landFrames: 3,
    helplessLandLag: 20,
  },

  onCreate(f) {
    f.custom.gold = { value: 0, active: false, frames: 0, shake: 0 };
  },

  /**
   * Every landed normal mints a coin.
   *
   * Hung on `onHit` rather than counted anywhere central, so the whole mechanic
   * lives in this file — nothing shared has to know what gold is.
   */
  onHit(f, victim, hb, world) {
    const g = f.custom.gold;
    if (g.active) return;                      // spending, not earning
    const worth = goldFor(f.move);
    if (worth <= 0) return;
    g.value = Math.min(GOLD_MAX, g.value + worth);

    // One coin per hit, rising out of the victim and fading.
    world.spawnEffect({
      x: victim.x + (Math.random() - 0.5) * 14,
      y: victim.y - victim.def.height * 0.62,
      vx: (Math.random() - 0.5) * 0.5, vy: -1.9,
      kind: 'smoke', size: 11, life: 26, color: '#f5c542',
      spin: (Math.random() - 0.5) * 6,
    });
  },

  onStep(f) {
    const g = f.custom.gold;
    if (g.shake > 0) g.shake--;
    if (!g.active) return;
    /**
     * Reapplied every frame rather than set once.
     *
     * The match writes `rateMultiplier` itself each step for the late-game
     * Elixir ramp, so a value assigned at activation is overwritten before it
     * ever regenerates anything — measured, it read 1.0 for the whole state.
     * Multiplying into it here keeps the penalty *and* keeps the late-game
     * scaling, instead of one clobbering the other.
     */
    f.elixir.rateMultiplier *= RUSH_ELIXIR_MUL;
    g.frames--;
    // The meter doubles as the timer: it drains across the ten seconds, so the
    // same bar answers both "can I use it" and "how long is left".
    g.value = GOLD_MAX * Math.max(0, g.frames / RUSH_DURATION);
    if (g.frames <= 0) endRush(f);
  },

  moves: {
    // ------------------------------------------------------------- placeholder
    // Frame data below is a stand-in so he is playable while the mechanic is
    // tested. The pose families are borrowed; none of it is authored for him.
    /**
     * A three-hit chain of straight stabs, all off the dagger hand.
     *
     * The first two are **links**: fixed knockback with a stated hitstun, so
     * they hold the target in place at any percent instead of shoving them out
     * of the third. The same pairing the other jab strings use.
     */
    jab: {
      id: 'jab', name: 'Jab 1', kind: 'ground', total: 20, pose: 'dagStab1',
      cancelInto: { from: 6, to: 18, attack: 'jab2', special: true },
      hitboxes: [{
        id: 0, frames: [5, 7],
        shape: { x: 16, y: 40, x2: 50, y2: 39, r: 12 },
        damage: 2, angle: 361, bkb: 0, kbg: 0, setKnockback: 20, hitstun: 14,
      }],
    },
    jab2: {
      id: 'jab2', name: 'Jab 2', kind: 'ground', total: 21, pose: 'dagStab2',
      cancelInto: { from: 6, to: 19, attack: 'jab3', special: true },
      hitboxes: [{
        id: 0, frames: [5, 7],
        shape: { x: 16, y: 41, x2: 53, y2: 40, r: 12 },
        damage: 2, angle: 361, bkb: 0, kbg: 0, setKnockback: 20, hitstun: 14,
      }],
    },
    jab3: {
      id: 'jab3', name: 'Jab 3', kind: 'ground', total: 30, pose: 'dagStab3',
      hitboxes: [{
        id: 0, frames: [6, 9],
        shape: { x: 16, y: 41, x2: 52, y2: 40, r: 13 },
        damage: 5, angle: 361, bkb: 44, kbg: 88,
      }],
    },

    /** A diagonal slash, high and back to low and front. */
    ftilt: {
      id: 'ftilt', name: 'Forward Tilt', kind: 'ground', total: 26, pose: 'dagSwipeDiag',
      hitboxes: [{
        id: 0, frames: [6, 9],
        shape: { x: 20, y: 52, x2: 60, y2: 24, r: 15 },
        damage: 7, angle: 361, bkb: 30, kbg: 96,
      }],
    },

    /**
     * A half circle over his head. The box follows the blade round rather than
     * sitting at one end of it, so it catches in front, overhead and behind —
     * three capsules on overlapping frames, since an arc is not a line.
     */
    utilt: {
      id: 'utilt', name: 'Up Tilt', kind: 'ground', total: 28, pose: 'dagArcOver',
      hitboxes: [
        {
          id: 0, frames: [5, 8],
          shape: { x: 28, y: 60, x2: 8, y2: 108, r: 16 },
          damage: 6, angle: 90, bkb: 54, kbg: 104,
        },
        {
          id: 1, frames: [7, 11],
          shape: { x: 10, y: 110, x2: -38, y2: 105, r: 17 },
          damage: 6, angle: 90, bkb: 54, kbg: 104,
        },
        {
          id: 2, frames: [10, 13],
          shape: { x: -30, y: 106, x2: -54, y2: 99, r: 16 },
          damage: 5, angle: 92, bkb: 52, kbg: 98, awayFromAttacker: true,
        },
      ],
    },

    /** Quick and low, along the deck. Pops up, so it starts combos. */
    dtilt: {
      id: 'dtilt', name: 'Down Tilt', kind: 'ground', total: 22, pose: 'dagStabLow',
      hitboxes: [{
        id: 0, frames: [4, 7],
        shape: { x: 16, y: 11, x2: 54, y2: 10, r: 11 },
        damage: 5, angle: 82, bkb: 60, kbg: 96,
      }],
    },

    /**
     * Dash attack — a low lunge into a rising cut.
     *
     * The hitbox climbs with the blade rather than sitting where it finishes,
     * so it catches low on the way in and high on the way out. It stops at
     * chin height: the slash never goes overhead, so neither does the box.
     */
    dashAttack: {
      id: 'dashAttack', name: 'Dash Attack', kind: 'ground', total: 32,
      pose: 'dagLungeUp', momentum: 1, keepMomentum: true,
      movement: [{ frame: 1, vx: 9.6, mode: 'set' }, { frame: 14, vx: 2.0, mode: 'set' }],
      hitboxes: [{
        id: 0, frames: [7, 12],
        shape: { x: 20, y: 14, x2: 34, y2: 58, r: 16 },
        damage: 8, angle: 80, bkb: 58, kbg: 96,
      }],
    },

    /**
     * Forward smash — fast, long and deliberately not a kill move.
     *
     * His reward for landing it is **gold**, not a stock: it fills the meter
     * faster than anything else he has, and the meter is what actually kills.
     * Quick in and quick out, so it is safe to throw at range.
     */
    fsmash: {
      id: 'fsmash', name: 'Forward Smash', kind: 'ground', total: 36, pose: 'dagSlash',
      charge: { frame: 6, maxFrames: 60 },
      hitboxes: [{
        id: 0, frames: [11, 14],
        shape: { x: 20, y: 44, x2: 88, y2: 40, r: 17 },
        damage: 11, angle: 361, bkb: 30, kbg: 84, shieldDamage: 2,
      }],
    },

    /** Up smash — a leaping stab through a full turn. */
    usmash: {
      id: 'usmash', name: 'Up Smash', kind: 'ground', total: 44, pose: 'dagLeapStab',
      charge: { frame: 7, maxFrames: 60 },
      hitboxes: [
        {
          id: 0, frames: [12, 18],
          shape: { x: 8, y: 54, x2: 2, y2: 112, r: 17 },
          damage: 13, angle: 88, bkb: 34, kbg: 116,
        },
        {
          // The turn catches anyone stood right beside him on the way up.
          id: 1, frames: [12, 16],
          shape: { x: 30, y: 34, x2: -30, y2: 34, r: 15 },
          damage: 8, angle: 84, bkb: 30, kbg: 100, awayFromAttacker: true,
        },
      ],
    },

    /** Down smash — a grounded turn with the blade out at shin height. */
    dsmash: {
      id: 'dsmash', name: 'Down Smash', kind: 'ground', total: 40, pose: 'dagSpinLow',
      charge: { frame: 7, maxFrames: 60 },
      hitboxes: [
        {
          id: 0, frames: [10, 16],
          shape: { x: 18, y: 15, x2: 68, y2: 13, r: 15 },
          damage: 11, angle: 34, bkb: 32, kbg: 106,
        },
        {
          id: 1, frames: [10, 16],
          shape: { x: -18, y: 15, x2: -68, y2: 13, r: 15 },
          damage: 10, angle: 34, bkb: 32, kbg: 106, awayFromAttacker: true,
        },
      ],
    },

    /**
     * Neutral air — tuck, then burst into a star.
     *
     * One hitbox that wraps him rather than a front and a back half: the move
     * is the extension, and it happens in every direction at once. `r: 34` on a
     * fighter 42 wide is what makes it a genuine sphere.
     *
     * Launches at 78 — nearly straight up, with low growth — so it stays a
     * combo extender at the percents where follow-ups exist instead of turning
     * into a weak kill move at high ones. Cheap on both ends (4 frames of
     * landing lag) because that is the only way a combo starter is worth
     * throwing twice in a string.
     *
     * **The startup is deliberately long for a move this cheap.** At 30 frames
     * with the box on 5, the tuck lasted about two frames and nobody could see
     * it. The extra six frames buy a cannonball that is actually legible, and
     * the pose curve holds the ball rather than passing through it.
     */
    nair: {
      id: 'nair', name: 'Neutral Air', kind: 'aerial', total: 32, pose: 'dagStarBurst',
      landingLag: 4, autocancel: [[1, 4], [27, 32]],
      hitboxes: [{
        id: 0, frames: [8, 14],
        shape: { x: 4, y: 40, x2: -4, y2: 38, r: 34 },
        damage: 7, angle: 78, bkb: 56, kbg: 84,
      }],
    },

    /**
     * Forward air — two stabs, low then high.
     *
     * Three rungs was one too many: the window was long, the middle stab did
     * nothing the other two did not, and the sequence dropped. Two hits give
     * each thrust room to chamber and extend.
     *
     * The first carries `setKnockback` so it holds the victim in place
     * regardless of percent — the only way a two-part aerial connects at 10%
     * and at 90%. The second is the payoff and scales normally.
     *
     * **`rehitRate` on both boxes is what makes this two hits at all.** Repeat
     * hits are tracked per *move*, not per hitbox, so once the first stab
     * connects the victim is locked out and the second box passes straight
     * through them — which is exactly why the move only ever landed one hit no
     * matter how many boxes it carried. The field is read off each box
     * individually (`hitSystem.js`), so it has to be on every box that needs to
     * clear the lock, and it is counted in GLOBAL frames while hitlag freezes
     * move frames — which is why the number cannot be read off the gap in the
     * table below. Measured: at 7 the second box cleared its own lock inside
     * its own window and the move landed *three* times (f7, f20, f27). 12 sits
     * above that self-repeat and below the 13 frame gap between the two stabs,
     * so it lands exactly twice.
     */
    fair: {
      id: 'fair', name: 'Forward Air', kind: 'aerial', total: 34, pose: 'dagTripleStab',
      landingLag: 8, autocancel: [[1, 4], [30, 34]],
      hitboxes: [
        {
          id: 0, frames: [7, 10], rehitRate: 12,
          shape: { x: 22, y: 36, x2: 58, y2: 46, r: 17 },
          damage: 4, angle: 62, setKnockback: 44, hitstun: 21,
        },
        {
          id: 1, frames: [17, 21], rehitRate: 12,
          shape: { x: 22, y: 38, x2: 58, y2: 50, r: 18 },
          /**
         * **Angled up, not away.** The Sakurai angle sends near-horizontal at
         * low percent, which put the victim exactly where a second forward air
         * could reach them — the chain ran as long as he had the stage. A fixed
         * 66 lifts them above his own follow-up instead, so the string ends on
         * its own rather than needing the hit to be weak enough to escape.
         *
         * The damage and growth come down with it: it was killing on top of
         * being a guaranteed follow-up.
         */
        damage: 8, angle: 66, bkb: 38, kbg: 104,
        },
      ],
    },

    /**
     * Back air — a spinning back kick.
     *
     * His only real aerial kill move, so it is the one aerial with genuine
     * growth. The box reaches behind him with the leg and sits slightly high,
     * matching the upward cant of the kick.
     */
    bair: {
      id: 'bair', name: 'Back Air', kind: 'aerial', total: 34, pose: 'goblinBackKick',
      landingLag: 7, autocancel: [[1, 4], [30, 34]],
      hitboxes: [{
        id: 0, frames: [8, 12],
        shape: { x: -16, y: 40, x2: -54, y2: 50, r: 18 },
        damage: 11, angle: 361, bkb: 27, kbg: 106, awayFromAttacker: true,
      }],
    },

    /**
     * Up air — a big semicircle over the head.
     *
     * The box spans the dome the blade actually traces, front to back, rather
     * than sitting in a column above him: the whole point of the arc is that it
     * catches an opponent who is not directly overhead.
     */
    uair: {
      id: 'uair', name: 'Up Air', kind: 'aerial', total: 32, pose: 'dagRiseArc',
      landingLag: 6, autocancel: [[1, 3], [28, 32]],
      hitboxes: [{
        id: 0, frames: [5, 9],
        shape: { x: 34, y: 80, x2: -34, y2: 84, r: 26 },
        damage: 9, angle: 88, bkb: 42, kbg: 118,
      }],
    },

    /**
     * Down air — a backflip with a cut through the bottom of it.
     *
     * **Not a spike.** Angle 42 sends the victim forward and up, off the front
     * of the flip, which is what makes it the combo starter it is meant to be.
     * A 270 here would have been the obvious reading of "downward swipe" and
     * exactly the wrong move.
     *
     * The box is a flat capsule slung **under him and running forward**, fitted
     * to the blade measured across frames 16-22: it dips to 23 below his feet
     * at the midpoint and exits ahead of him. That direction changed when the
     * flip became a three-step motion — on the old smooth version the sweep and
     * the body rotation cancelled, and the blade trailed behind instead.
     */
    dair: {
      id: 'dair', name: 'Down Air', kind: 'aerial', total: 42, pose: 'dagBackflipArc',
      landingLag: 9, autocancel: [[1, 5], [36, 40]],
      hitboxes: [{
        id: 0, frames: [16, 22],
        shape: { x: -6, y: -18, x2: 30, y2: -16, r: 22 },
        damage: 9, angle: 42, bkb: 36, kbg: 74,
      }],
    },

    // ---------------------------------------------------------------- specials
    /**
     * Down B — **Gold Rush**.
     *
     * Only available on a full meter, and it costs 10 Elixir on top. Ten
     * seconds at +32% movement and +35% damage, with Elixir regenerating a
     * quarter slower throughout — so the window is paid for twice, once in the
     * gold he had to earn and once in the economy he gives up while spending it.
     */
    downB: {
      id: 'goldRush', name: 'Gold Rush', kind: 'special', total: 30,
      cost: RUSH_COST,
      costFrame: 10,
      pose: 'cast',
      condition(f) {
        const g = f.custom.gold;
        return !g.active && g.value >= GOLD_MAX;
      },
      onFrame(f, frame) {
        if (frame !== 10) return;
        startRush(f);
        f.world.camera.addShake(20);
        f.world.spawnEffect({
          x: f.x, y: f.y - f.def.height * 0.5,
          kind: 'explosion', size: 64, life: 20, color: '#f5c542',
        });
        // A shower of coins on activation.
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          f.world.spawnEffect({
            x: f.x + Math.cos(a) * 12, y: f.y - f.def.height * 0.5,
            vx: Math.cos(a) * 2.2, vy: Math.sin(a) * 1.6 - 1.6,
            kind: 'smoke', size: 10, life: 24, color: '#f5c542',
            spin: (Math.random() - 0.5) * 8,
          });
        }
      },
    },

    /**
     * Neutral B — **Spear Throw**, the Spear Goblin.
     *
     * One Elixir, which is the cheapest thing on the roster and the whole point:
     * it is a tool he can afford to throw constantly rather than a commitment.
     * Everything else about it is priced to match — 5%, slow, and a lazy arc
     * that anyone can walk under from range.
     *
     * What it buys is the **launch**. Angle 80 with almost no growth pops the
     * victim straight up a fixed distance whatever their percent, which is a
     * combo starter at 20% and still a combo starter at 120%. A short fighter
     * whose whole game is getting in now has a way to open from outside.
     */
    neutralB: {
      id: 'spearThrow', name: 'Spear Throw', kind: 'special', total: 40,
      cost: 1, costFrame: 16, pose: 'spearThrow',
      onFrame(f, frame) {
        /**
         * Plants his feet. Thrown out of a run he used to keep sliding through
         * the whole wind-up, which made a 1 Elixir poke into a free approach —
         * the throw should cost him his momentum, not carry it.
         *
         * Grounded only: in the air he keeps his drift, because a spear that
         * froze him mid-jump would be a self-inflicted stall.
         */
        if (frame === 1 && f.grounded) f.vx = 0;
        if (frame !== 16) return;
        f.world.spawnProjectile(f, {
          // Leaves from above the shoulder, where the wind-up held it.
          x: f.x + 20 * f.facing, y: f.y - f.def.height * 0.78,
          /**
           * Deliberately slow, and the gravity is what shapes the move. 0.17
           * over a 9.2 throw drops it about a body height across its useful
           * range — a lob that clears a crouching fighter early and comes down
           * at their feet late, rather than the flat laser a faster shot with
           * less gravity would be.
           */
          vx: 9.2 * f.facing, vy: -2.4,
          gravity: 0.17, radius: 13, life: 110,
          damage: 5, angle: 80, bkb: 52, kbg: 22,
          facing: f.facing, moveId: 'spearThrow',
          color: '#c9d0da', shape: 'spear', priority: 6,
          effect: 'slash',
        });
      },
    },

    /**
     * Side B — the **Goblin Drill**.
     *
     * Structured like the Wizard's tornado and balanced against it: a trap of
     * fast weak ticks that holds the victim in place, then one real hit. The
     * difference is where it leaves them — the tornado pops straight up to set
     * up a juggle, this one throws them **out**, which is what a fighter with no
     * ranged pressure wants. Getting a kill at the ledge is his reward for the
     * commitment.
     *
     * The ticks use `setKnockback` with `hitstun` rather than growth so the trap
     * holds at every percent. Any growth at all and it stops working exactly
     * where the finisher would start being worth having.
     */
    sideB: {
      id: 'goblinDrill', name: 'Goblin Drill', kind: 'special', total: 52,
      /**
       * **He does not fall while the drill is running.** The machine is holding
       * him up as much as it is pulling him along, and a goblin sagging out of
       * the sky mid-charge read as the move failing. Gravity is off for the
       * whole move and returns the instant it ends, so the drop is the
       * *punctuation* on the move rather than something happening during it.
       */
      gravityMul: 0,
      cost: 3, costFrame: 8, pose: 'drillPush',
      /**
       * A short shove, not the Battle Ram's charge. He gets going, digs in, and
       * is stopped well before the recovery — the distance is about two body
       * lengths, so it closes a gap without crossing the stage.
       */
      movement: [
        { frame: 8, vx: 6.4, mode: 'set' },
        { frame: 24, vx: 3.0, mode: 'set' },
        { frame: 33, vx: 0.4, mode: 'set' },
      ],
      onFrame(f, frame) {
        /**
         * Airborne, the drill carries him **much** further.
         *
         * On the ground the distance is deliberately short, and that stays. In
         * the air there is no traction to fight and nothing to stop on, so the
         * same shove should read as a genuine flight — it also gives him a
         * horizontal recovery option to go with the barrel's vertical one.
         *
         * `movement` is applied before this runs, so scaling `vx` here rides on
         * top of whatever step just fired rather than racing it.
         */
        if (f.grounded) return;
        if (frame === 1) f.vy = 0;          // no carried fall speed while it holds him up
        if (frame === 8 || frame === 24 || frame === 33) f.vx *= 1.7;
      },
      hitboxes: [
        {
          /**
           * The churn. `rehitRate` is on the box because the field is read per
           * hitbox, and 4 is fast enough that nobody falls out between ticks.
           */
          id: 0, frames: [10, 26], rehitRate: 7,
          shape: { x: 14, y: 30, x2: 58, y2: 34, r: 20 },
          damage: 1.7, angle: 20, setKnockback: 28, hitstun: 14,
          effect: 'blunt',
        },
        {
          /**
           * The finisher: out and slightly up, angle 32.
           *
           * **A two frame window, and a rehit interval longer than its own
           * hitlag.** Repeat hits are tracked per move, so it needs an interval
           * at all to clear the lock the last churn tick left. But the interval
           * is counted in global frames, and landing 8% freezes the move for
           * several of them — so a wide window let the same swing connect on
           * every frame of it. Measured at [33,36] with rate 4 it hit *four*
           * times for 38% total. The gap back to the last tick (8 move frames
           * plus that tick's own hitlag) comfortably clears 10; its own next
           * frame does not.
           */
          id: 1, frames: [34, 35], rehitRate: 10,
          shape: { x: 16, y: 30, x2: 64, y2: 38, r: 22 },
          damage: 9, angle: 32, bkb: 74, kbg: 108, effect: 'blunt',
        },
      ],
    },

    /**
     * Up B — the **Goblin Barrel**.
     *
     * He is sealed in and posted. The barrel is the whole silhouette while it
     * flies, it breaks on arrival, and how it arrives is the move: the launch
     * takes his **current** motion and turns it into an arc, so a standing
     * recovery goes nearly straight up and one taken while drifting back toward
     * the stage carries a long way sideways. That makes the same button a
     * different recovery depending on how you set it up.
     *
     * Two landings, deliberately different. Onto the stage it breaks, deals its
     * damage and frees him with little end lag. Into the ledge he simply grabs
     * it and the barrel breaks for nothing — no reward for using a recovery as
     * an edgeguard, which is the trade that keeps it honest.
     */
    upB: {
      id: 'goblinBarrel', name: 'Goblin Barrel', kind: 'special',
      /**
       * **Long enough that the flight never runs out.** The barrel ends when it
       * arrives, not on a timer — `onFrame` cuts the move short the instant he
       * lands or catches the ledge, so this number only has to exceed the
       * longest survivable arc. At 60 the barrel dissolved in mid-air on a high
       * recovery and dropped him out of it.
       */
      total: 240,
      cost: 3, costFrame: 8, pose: 'gobBarrel',
      freefallAfter: true,
      hitboxes: [{
        /**
         * Live for the whole flight. No `rehitRate`, so it strikes each victim
         * once — but the barrel itself is unaffected by connecting and keeps
         * going, which is what makes it a delivery rather than a projectile.
         */
        id: 0, frames: [12, 232],
        shape: { x: 0, y: 34, x2: 0, y2: 34, r: 30 },
        damage: 9, angle: 50, bkb: 48, kbg: 74, effect: 'blunt',
      }],
      onFrame(f, frame) {
        const st = f.custom.barrel || (f.custom.barrel = {});
        if (frame === 8) {
          /**
           * The arc is built from what he was already doing.
           *
           * `carry` is his horizontal speed at launch, clamped so a full-speed
           * run cannot turn the recovery into a horizontal missile. The vertical
           * kick is traded against it — the further out it throws him, the less
           * height he gets, which is what makes it an arc and not a menu of two
           * separate recoveries.
           */
          const dir = Math.abs(f.vx) > 0.6 ? Math.sign(f.vx) : (f.input.x || 0);
          const speed = Math.min(Math.abs(f.vx), f.attr.runSpeed) / f.attr.runSpeed;
          const lean = dir === 0 ? 0 : Math.max(speed, Math.abs(f.input.x) * 0.55);
          f.vx = dir * lean * 8.6;
          f.vy = -19.4 + lean * 3.1;
          f.grounded = false;
          f.y -= 2;
          st.flying = true;
          st.broke = false;
          f.world.camera.addShake(6);
        }
        if (!st.flying || st.broke) return;

        /**
         * Landing, either kind.
         *
         * `f.ledge` is set by the shared ledge grab, which runs for specials —
         * so catching the ledge needs no special case here beyond noticing it
         * happened and breaking the barrel quietly.
         */
        const hitLedge = !!f.ledge;
        if (hitLedge || f.grounded) {
          st.flying = false;
          st.broke = true;
          breakBarrel(f, hitLedge);
          // On the stage he is free almost at once; on the ledge the hang state
          // has already taken him and the move just ends.
          f.moveFrame = Math.max(f.moveFrame, f.move.total - 6);
        }
      },
      onEnd(f) {
        const st = f.custom.barrel;
        if (st) { st.flying = false; st.broke = false; }
      },
    },

    // ------------------------------------------------------------------ throws
    fthrow: {
      id: 'fthrow', name: 'Forward Throw', kind: 'throw',
      total: 28, releaseFrame: 12,
      damage: 6, angle: 42, bkb: 42, kbg: 76,
    },
    bthrow: {
      id: 'bthrow', name: 'Back Throw', kind: 'throw',
      total: 30, releaseFrame: 14, reverse: true,
      damage: 7, angle: 42, bkb: 44, kbg: 80,
    },
    uthrow: {
      id: 'uthrow', name: 'Up Throw', kind: 'throw',
      total: 28, releaseFrame: 12,
      damage: 6, angle: 88, bkb: 50, kbg: 112,
    },
    dthrow: {
      id: 'dthrow', name: 'Down Throw', kind: 'throw',
      total: 32, releaseFrame: 14,
      damage: 5, angle: 72, bkb: 44, kbg: 58,
    },

    taunt: {
      id: 'taunt', name: 'Taunt', kind: 'ground', total: 46,
      onStart(f) {
        f.world.spawnEffect({
          x: f.x, y: f.y - f.def.height - 14,
          kind: 'taunt', size: 18, life: 40, color: '#f5c542',
        });
      },
    },
  },
};
