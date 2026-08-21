import { SIM } from '../../config/gameplay.js';

/**
 * WIZARD — Zoner
 *
 * From the full design document:
 *   - "Slow but powerful character."
 *   - "Neutral B shoots a fireball that deals great knockback."
 *   - "He could use his hero wings as a recovery tool."
 *   - "He could also conjure up a fire tornado with his down B or side B."
 *   - "His Evo ability could be implemented as a combo breaker... it would
 *      create a shield around the wizard that would explode of destruction.
 *      For characters that don't have a projectile, a grab would cancel the
 *      shield. The Wizard could also control when to detonate the shield by
 *      pressing down B again." Limited to one per life, expensive, and it
 *      "would have a limitation when used in hit stun."
 *   - Zoners are "fighters whose move sets are based around a projectile...
 *      These characters usually struggle with close-quarter combat."
 *
 * Fireball cost: the full document says 3 ("arbitrary number"); the executive
 * document positions it as the expensive end of the scale at 5-6, contrasted
 * against the Archer's 1-2. The executive framing is the one that makes the
 * Elixir economy legible, so 5 is used here — see FIREBALL_COST below.
 */

const S = SIM.FPS;
const FIREBALL_COST = 5;
/** Up B: the first lift is free, then this many flaps are on the button. */
const WING_FLAPS = 3;
/** Stick deflection needed to turn the wings round on a flap. */
const TURN_STICK = 0.4;

/** Down B: locked out for this long once the shield is spent. */
const FIRE_SHIELD_COOLDOWN = 10 * S;

/**
 * Fire trails on the grounded normals that conjure flame.
 *
 * Driven from `onStep` rather than baked into the renderer, so it stays a
 * property of *this fighter* — nothing shared has to learn what a wizard is.
 * Emitters are keyed on the move id and its frame window, and the positions are
 * written in sim space to match where the rig actually puts the limb, so the
 * flame sits on the fist and the arc sits on the hands rather than floating
 * near the body.
 *
 * Embers drift upward (negative vy is up) and fade, which reads as fire rather
 * than as a puff of dust.
 */
function ember(f, x, y, size, life, vx, vy) {
  f.world.spawnEffect({
    x, y, vx, vy, kind: 'smoke', size, life,
    color: Math.random() < 0.35 ? '#ffd88a' : '#ff8a3c',
    spin: (Math.random() - 0.5) * 4,
  });
}

function emberTrail(f) {
  const m = f.move;
  if (!m || f.state !== 'action') return;
  const fr = f.moveFrame;
  const h = f.def.height;
  const dir = f.facing;

  if (m.id === 'jab3') {
    // The rising uppercut: embers chase the fist up its arc, frames 6-16.
    if (fr < 6 || fr > 16) return;
    const u = (fr - 6) / 10;
    const fx = f.x + dir * (24 + u * 16);
    const fy = f.y - h * (0.42 + u * 0.78);
    ember(f, fx, fy, 15 + u * 12, 15, dir * 0.6, -1.9 - u * 1.4);
    if (fr % 2 === 0) ember(f, fx + dir * 8, fy + 10, 11, 12, dir * 1.1, -1.2);
  } else if (m.id === 'utilt') {
    // The overhead arc: embers laid along the path the hands sweep, back to
    // front, so the trail is still hanging in the air as the T-pose lands.
    if (fr < 5 || fr > 18) return;
    const u = (fr - 5) / 13;
    const spread = u * u * (3 - 2 * u);
    // Both hands, mirrored about the crown — this is the arc itself.
    for (const side of [-1, 1]) {
      const ax = f.x + dir * side * spread * 52;
      const ay = f.y - h * (1.18 - spread * 0.16);
      ember(f, ax, ay, 16 + spread * 8, 18, dir * side * 0.7, -0.7);
    }
  } else if (m.id === 'dtilt') {
    // The legsweep drags a low ring of flame round with it.
    if (fr < 8 || fr > 15) return;
    const u = (fr - 8) / 7;
    const ang = u * Math.PI * 2;
    ember(f, f.x + Math.cos(ang) * 46 * dir, f.y - h * 0.10, 13, 13, 0, -0.5);
  } else if (m.id === 'nair') {
    /**
     * The ring itself. Laid as a full circle around him on the frame it goes
     * live and then topped up, so it is a hoop of fire rather than a trail —
     * the hitbox is a 42-radius circle and the flame has to say so.
     */
    if (fr < 5 || fr > 15) return;
    const spokes = fr === 5 ? 12 : 4;
    const spin = fr * 0.35;
    for (let i = 0; i < spokes; i++) {
      const a = spin + (i / spokes) * Math.PI * 2;
      ember(f,
        f.x + Math.cos(a) * 40, f.y - h * 0.5 + Math.sin(a) * 40,
        13, 14, Math.cos(a) * 0.9, Math.sin(a) * 0.9);
    }
  } else if (m.id === 'uair') {
    // A small fireball leaving the hand on each of the three shots.
    const SHOTS = [7, 13, 19];
    const idx = SHOTS.indexOf(fr);
    if (idx < 0) return;
    // Alternating hands: left, right, left — matched to the `fireVolley` pose.
    const side = idx === 1 ? 1 : -1;
    for (let i = 0; i < 5; i++) {
      ember(f,
        f.x + dir * side * 8 + (Math.random() - 0.5) * 16,
        f.y - h * (1.05 + i * 0.09),
        13 - i, 15, 0, -2.6 - i * 0.5);
    }
  } else if (m.id === 'fsmash') {
    /**
     * Fire gathers between the chambered palms while it charges and then
     * erupts forward with the push. `f.charging` is true for as long as the
     * player holds it, so the gather has no fixed length — which is the point.
     */
    if (f.charging) {
      if (fr % 3 === 0) {
        ember(f, f.x + dir * 20 + (Math.random() - 0.5) * 14, f.y - h * 0.52,
          10 + Math.random() * 6, 12, dir * 0.4, -0.6);
      }
      return;
    }
    if (fr < 16 || fr > 26) return;
    const u = (fr - 16) / 10;
    for (let i = 0; i < 3; i++) {
      ember(f, f.x + dir * (34 + u * 84 + i * 14), f.y - h * (0.58 - i * 0.02),
        20 - i * 3, 16, dir * (2.4 + i), -0.3);
    }
  } else if (m.id === 'usmash') {
    // Flame trailing the kicking foot around its arc: up the front, over the
    // top, away behind.
    if (fr < 12 || fr > 22) return;
    const u = (fr - 12) / 10;
    const ang = -0.5 + u * 3.6;              // in front -> overhead -> behind
    ember(f, f.x + dir * Math.cos(ang) * 54, f.y - h * 0.45 - Math.sin(ang) * 62,
      17, 15, dir * 0.6, -1.0);
  } else if (m.id === 'dsmash') {
    // Two detonations, one either side, on the frame the hands land.
    if (fr < 13 || fr > 18) return;
    const u = (fr - 13) / 5;
    for (const side of [-1, 1]) {
      ember(f, f.x + side * (26 + u * 62), f.y - h * 0.06,
        22 - u * 6, 16, side * 2.2, -1.3);
    }
  } else if (m.id === 'fair') {
    // Fire dragged along the fist's arc, from over his head down past his waist.
    if (fr < 9 || fr > 18) return;
    const u = clamp01((fr - 9) / 9);
    const ang = Math.PI * 0.9 - u * Math.PI * 0.85;   // overhead -> forward -> down
    ember(f,
      f.x + dir * Math.cos(ang) * 52, f.y - h * 0.55 - Math.sin(ang) * 52,
      16, 14, dir * 0.5, 0.8);
  }
}

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

/**
 * Frames on which his projectile specials actually commit. Shared between the
 * spawn logic and `costFrame` so the Elixir is charged on exactly the frame the
 * projectile appears — being knocked out of a 5-Elixir Fireball during its
 * 18-frame windup should cost nothing. Specials with a hitbox derive this from
 * the hitbox instead.
 */
const FIREBALL_RELEASE = 18;
/**
 * Late on purpose. The summon animation raises both arms over the move's
 * startup and the tornado should appear with his hands already up, not halfway
 * through the lift. The pose clock for a move with no hitboxes runs to
 * `total * 0.55`, so this sits just under that.
 */
const TORNADO_RELEASE = 30;

export const wizard = {
  id: 'wizard',
  name: 'Wizard',
  archetype: 'Zoner',
  blurb: 'Slow, powerful, projectile-driven. Every Elixir point is a decision.',
  color: '#ff8a4c',
  accent: '#8c3b12',
  width: 58,
  height: 100,
  reach: 1.15,
  weight: 104,
  /** Everything he throws is fire. */
  hitEffect: 'fire',

  /**
   * 3D model, built from these colours and features by src/render/rig.js.
   * Matched to the Wizard's card art: blue hooded robe with silver trim,
   * brown beard and moustache, brown tabard down the front, gold belt buckle.
   */
  model: {
    palette: {
      garment: '#2f5fa8',     // blue robe
      garmentDark: '#24487f',
      trim: '#a8b4c4',        // silver-grey robe trim
      skin: '#e8b48c',
      hair: '#5a3720',        // brown hair and beard
      leather: '#7a4f2a',     // bracers
      metal: '#b9c4d6',
      gold: '#c9a227',
      trousers: '#3a3a44',
      boot: '#2b2f3d',
      eye: '#3a2a1a',
      wood: '#4a3520',
    },
    hood: { color: '#2f5fa8', trim: '#a8b4c4' },
    hair: 'short',
    brows: true,
    beard: true,
    tabard: { color: '#6b4a2c' },
    belt: { color: '#4a3018', buckle: 'gold' },
    shoulderTrim: true,
    // Darker than the robe, or the cape merges into the body as one blue mass.
    cloak: { color: '#1d3c6e', length: 0.5 },
    // No weapon: the Clash Wizard casts from his hands.

    /**
     * Player-slot recolours: the robe, its trim and the cape. The beard, the
     * skin and the brown tabard are the Wizard regardless of side.
     */
    variants: {
      red: {
        palette: {
          garment: '#a8402f', garmentDark: '#7f2f23',
          trim: '#e0a08c', trousers: '#4a2a2a',
        },
        hood: { color: '#a8402f', trim: '#e0a08c' },
        cloak: { color: '#6e2118' },
      },
      blue: {
        palette: {
          garment: '#2f5fa8', garmentDark: '#24487f',
          trim: '#a8b4c4', trousers: '#3a3a44',
        },
        hood: { color: '#2f5fa8', trim: '#a8b4c4' },
        cloak: { color: '#1d3c6e' },
      },
    },
  },

  /**
   * HUD card art. `crop` is [x, y, w, h] in 0..1 of the source image and
   * frames a square bust out of the full character card.
   * Drop a replacement at the same path to change it; if the file is missing
   * the HUD falls back to placeholder bust art.
   */
  portrait: { src: 'assets/portraits/wizard.png', crop: [0.20, 0.15, 0.60, 0.41] },

  attributes: {
    // Traversal is a flat 10% above where it started. He is a Zoner, not a
    // slow character — being unable to reposition made his spacing game read
    // as sluggishness rather than as a deliberate trade.
    walkSpeed: 2.75,
    runSpeed: 5.83,
    initialDashSpeed: 7.04,
    // Shortened the same way as the Bandit's, but kept a frame longer than
    // hers: the heavy is meant to commit further to a dash. 7.04 x 5 = 35px.
    dashFrames: 5,
    runAccel: 0.55,
    traction: 0.40,
    turnFrames: 8,
    runBrakeFrames: 16,

    airSpeed: 4.95,
    airAccel: 0.23,
    airFriction: 0.03,
    gravity: 0.44,
    maxFall: 8.8,
    fastFallMul: 1.55,

    // Full hop peaks at ~180px with ~57 frames of airtime — still floatier
    // than the Bandit, which is the archetype difference.
    fullHopVelocity: -12.6,
    shortHopVelocity: -7.6,
    airJumpVelocity: -11.4,
    airJumps: 1,
    jumpHorizontalBoost: 0.5,

    landFrames: 5,
    helplessLandLag: 24,
  },

  onCreate(f) {
    f.custom.fireShield = { active: false };
    f.custom.wings = { active: false, flaps: 0, sinceFlap: 0, flapAnim: 0 };
  },

  onStep(f) {
    emberTrail(f);

    /**
     * The wings belong to the Up B action and nothing else. `onEnd` covers the
     * move finishing normally, but a fighter knocked out of it mid-flight never
     * reaches that — so the state is also reconciled against reality here, or
     * the wings stay stuck on his back for the rest of the stock.
     */
    const wg = f.custom.wings;
    if (wg && wg.active && (!f.move || f.move.id !== 'heroWings')) wg.active = false;

    // The Fire Shield has no timer. It is a once-per-stock resource that stays
    // up until it is *spent* — absorbing a hit, detonated on purpose, or
    // cancelled by a grab. A shield that expires on its own turns the decision
    // into "activate early and hope"; one that waits makes it a real commitment
    // the opponent has to play around.
  },

  /**
   * The combo breaker. Absorbing a hit consumes the shield and detonates it.
   * Returning true tells the fighter the knockback was absorbed.
   */
  onHitTaken(f, info) {
    const fs = f.custom.fireShield;
    if (!fs || !fs.active) return false;
    fs.active = false;
    f.hitlag = 0;
    f.hitstun = 0;
    f.pendingHit = null;
    f.startAction(f.moves.fireShieldBurst);
    return true;
  },

  /**
   * "a grab would cancel the shield" — no explosion, no refund, and it still
   * goes on cooldown. Being grabbed is the counterplay to the shield, so it has
   * to actually cost him the tool rather than just the cast.
   */
  onGrabbed(f) {
    const fs = f.custom.fireShield;
    if (fs && fs.active) {
      fs.active = false;
      f.cooldowns.set('fireShield', FIRE_SHIELD_COOLDOWN);
      f.world.spawnEffect({ x: f.x, y: f.y - f.def.height * 0.5, kind: 'smoke', size: 36, life: 14, color: '#8fa3b8' });
    }
  },

  moves: {
    // ------------------------------------------------------------- grounded
    /**
     * A one-two-three: left straight, right straight, rising fire uppercut.
     *
     * Jabs 1 and 2 state their **hitstun and their knockback separately**, which
     * is the only way this string works.
     *
     * Scaling knockback pushed the target out of the finisher's range, and
     * pushed them further the higher their percent, so the string got harder to
     * complete exactly as the launcher became worth landing. Dropping knockback
     * to zero fixed the range and took the *hitstun* with it — hitstun is
     * normally derived from knockback — so the opponent could simply walk away
     * between jabs. Raising it back to a fixed 34 restored 13 frames of hold but
     * cost 55px of shove per link, which walked them out of range again.
     *
     * The two quantities have to come apart: `setKnockback: 5` is a nudge worth
     * a few pixels, and `hitstun: 15` is the hold, independent of it and of the
     * victim's percent. That is what a jab string needs to be a string.
     *
     * All the payoff is in jab 3, which launches. That is what makes the string
     * worth finishing rather than jab-cancelling out of.
     */
    jab: {
      id: 'jab', name: 'Jab 1', kind: 'ground', total: 20, pose: 'punchL',
      cancelInto: { from: 5, to: 18, attack: 'jab2', special: true },
      hitboxes: [{
        id: 0, frames: [4, 6],
        shape: { x: 30, y: 58, x2: 60, y2: 57, r: 18 },
        damage: 2, angle: 361, bkb: 0, kbg: 0, setKnockback: 5, hitstun: 15, effect: 'fire',
      }],
    },
    jab2: {
      id: 'jab2', name: 'Jab 2', kind: 'ground', total: 22, pose: 'punchR',
      cancelInto: { from: 5, to: 20, attack: 'jab3', special: true },
      hitboxes: [{
        id: 0, frames: [4, 6],
        shape: { x: 30, y: 60, x2: 64, y2: 58, r: 19 },
        damage: 2, angle: 361, bkb: 0, kbg: 0, setKnockback: 5, hitstun: 15, effect: 'fire',
      }],
    },
    jab3: {
      id: 'jab3', name: 'Jab 3', kind: 'ground', total: 42, pose: 'uppercut',
      /**
       * The fist travels from hip height to over his head, so the box is the
       * whole path rather than a point at the end of it.
       *
       * It also has to reach as far **forward** as jabs 1 and 2 do. A rising
       * capsule that only extended to x 40 fell short of the 64 the first two
       * cover, so a string started at the tip of jab 1 whiffed the finisher —
       * the exact case where landing it matters. The lower end of the capsule is
       * pushed out to match, which leans the whole arc forward as well.
       */
      hitboxes: [{
        id: 0, frames: [10, 14],
        shape: { x: 64, y: 44, x2: 34, y2: 116, r: 24 },
        damage: 6, angle: 85, bkb: 62, kbg: 118, effect: 'fire',
      }],
    },

    ftilt: {
      id: 'ftilt', name: 'Forward Tilt', kind: 'ground', total: 34, pose: 'sideKick',
      // Kick height, not fist height — matched to where the foot measures at
      // full extension (fwd 48, height 30), not to where a kick "ought" to land.
      hitboxes: [{
        id: 0, frames: [9, 12],
        shape: { x: 32, y: 36, x2: 98, y2: 32, r: 24 },
        damage: 11, angle: 361, bkb: 32, kbg: 88, effect: 'fire',
      }],
    },

    utilt: {
      id: 'utilt', name: 'Up Tilt', kind: 'ground', total: 32, pose: 'fireArc',
      // The arc is drawn overhead from back to front, so the box is a wide
      // horizontal capsule above the head rather than a point in front of it.
      // Matched to where the hands measure at contact: spread from -69 to +70
      // at about head height, rather than a point above the crown.
      hitboxes: [{
        id: 0, frames: [8, 13],
        shape: { x: -52, y: 92, x2: 58, y2: 92, r: 30 },
        damage: 9, angle: 93, bkb: 52, kbg: 96, effect: 'fire',
      }],
    },

    dtilt: {
      id: 'dtilt', name: 'Down Tilt', kind: 'ground', total: 34, pose: 'legSweep',
      /**
       * A combo starter, so it pops straight up rather than away: a high angle
       * with modest growth keeps the opponent in front of him at the percents
       * where follow-ups exist, instead of sending them out of reach.
       *
       * The box spans both sides because the leg goes all the way round.
       */
      hitboxes: [{
        id: 0, frames: [9, 14],
        shape: { x: -40, y: 14, x2: 64, y2: 12, r: 18 },
        damage: 8, angle: 80, bkb: 52, kbg: 62, effect: 'fire',
      }],
    },

    /**
     * Dash attack — a horizontal dive that finishes in a forward roll.
     *
     * The hitbox is on the **flight**, not the landing: he is off the ground
     * with both arms speared out in front, and the roll afterwards is recovery.
     * The movement script carries him through the dive and bleeds off as he
     * comes down, so the distance is in the leap rather than in a slide.
     */
    dashAttack: {
      id: 'dashAttack', name: 'Dash Attack', kind: 'ground', total: 46, pose: 'diveRoll',
      momentum: 0.9, keepMomentum: true,
      movement: [
        { frame: 1, vx: 8.6, mode: 'set' },
        { frame: 17, vx: 3.4, mode: 'set' },
        { frame: 28, vx: 0.8, mode: 'set' },
      ],
      hitboxes: [{
        id: 0, frames: [10, 16],
        shape: { x: 24, y: 44, x2: 92, y2: 40, r: 26 },
        damage: 11, angle: 361, bkb: 55, kbg: 73, effect: 'fire',
      }],
    },

    // --------------------------------------------------------------- smashes
    fsmash: {
      id: 'fsmash', name: 'Forward Smash', kind: 'ground', total: 58, pose: 'fireHeave',
      charge: { frame: 10, maxFrames: 60 },
      hitboxes: [{
        id: 0, frames: [18, 21],
        shape: { x: 32, y: 62, x2: 118, y2: 56, r: 30 },
        damage: 20, angle: 361, bkb: 34, kbg: 90, effect: 'fire', shieldDamage: 4,
      }],
    },

    /**
     * Up smash — a backflip kick whose foot travels from in front of him, up
     * over his head, and away behind.
     *
     * That is an arc, and a capsule is a straight segment, so it takes three
     * boxes on the **same frames** to cover it. They cannot double up: repeat
     * hits are tracked per move, so whichever one connects first locks the
     * others out — which is exactly the behaviour a single-hit smash wants.
     */
    usmash: {
      id: 'usmash', name: 'Up Smash', kind: 'ground', total: 46, pose: 'flipKick',
      charge: { frame: 6, maxFrames: 60 },
      // The pose is driven by `sweep`, which is a fraction of the last active
      // frame — so pulling the whole window forward retimes the flip with it
      // and the foot still arrives where each box expects it.
      hitboxes: [
        {
          id: 0, frames: [10, 14],
          shape: { x: 30, y: 26, x2: 48, y2: 98, r: 28 },
          damage: 19, angle: 86, bkb: 32, kbg: 92, effect: 'fire',
        },
        {
          id: 1, frames: [12, 17],
          shape: { x: 28, y: 112, x2: -20, y2: 130, r: 28 },
          damage: 19, angle: 86, bkb: 32, kbg: 92, effect: 'fire',
        },
        {
          id: 2, frames: [15, 20],
          shape: { x: -24, y: 116, x2: -54, y2: 62, r: 26 },
          damage: 16, angle: 88, bkb: 30, kbg: 86, effect: 'fire', awayFromAttacker: true,
        },
      ],
    },

    dsmash: {
      id: 'dsmash', name: 'Down Smash', kind: 'ground', total: 50, pose: 'groundPound',
      charge: { frame: 8, maxFrames: 60 },
      hitboxes: [
        {
          id: 0, frames: [14, 17],
          shape: { x: 24, y: 18, x2: 88, y2: 14, r: 24 },
          damage: 15, angle: 35, bkb: 28, kbg: 90, effect: 'fire',
        },
        {
          id: 1, frames: [14, 17],
          shape: { x: -24, y: 18, x2: -88, y2: 14, r: 24 },
          damage: 15, angle: 35, bkb: 28, kbg: 90, effect: 'fire', awayFromAttacker: true,
        },
      ],
    },

    // --------------------------------------------------------------- aerials
    /**
     * A cannonball tuck wrapped in a ring of fire — his fastest option and the
     * one that gets him out of trouble. Trimmed like the Bandit's: nair is the
     * one aerial both fighters are meant to be able to follow up from.
     *
     * `awayFromAttacker` is what makes it read as a *ring*: the launch angle is
     * mirrored about him, so whoever it catches is thrown out and up on the side
     * they were standing, rather than everything being flung along his facing.
     * A round hitbox that sent one direction would look like a kick.
     */
    nair: {
      id: 'nair', name: 'Neutral Air', kind: 'aerial', total: 36, pose: 'cannonball',
      landingLag: 6, autocancel: [[1, 4], [31, 36]],
      hitboxes: [{
        id: 0, frames: [6, 14],
        shape: { x: 20, y: 50, x2: -20, y2: 50, r: 42 },
        damage: 9, angle: 48, bkb: 24, kbg: 80, effect: 'fire', awayFromAttacker: true,
        rehitRate: 0,
      }],
    },

    /**
     * Forward air — a fire punch thrown from over his head down past his waist.
     *
     * The hitbox follows the fist through that arc rather than sitting at the
     * end of it, so the capsule covers the whole swing from high-and-forward
     * down to low-and-close. It is a big box, and it is meant to be: this is
     * his main aerial spacing tool.
     *
     * It sends **horizontally** rather than spiking. A downward angle off a
     * move with this much reach turned every stray hit offstage into a kill,
     * and it left him with no aerial that simply pushes someone away.
     */
    fair: {
      id: 'fair', name: 'Forward Air', kind: 'aerial', total: 46, pose: 'firePunch',
      landingLag: 10, autocancel: [[1, 6], [41, 46]],
      hitboxes: [{
        id: 0, frames: [12, 18],
        shape: { x: 56, y: 112, x2: 44, y2: -2, r: 34 },
        damage: 13, angle: 38, bkb: 26, kbg: 87, effect: 'fire',
      }],
    },

    bair: {
      id: 'bair', name: 'Back Air', kind: 'aerial', total: 38, pose: 'spinKick',
      landingLag: 8, autocancel: [[1, 5], [33, 38]],
      hitboxes: [{
        id: 0, frames: [8, 12],
        shape: { x: -26, y: 56, x2: -86, y2: 50, r: 24 },
        damage: 12, angle: 361, bkb: 26, kbg: 98, effect: 'fire', awayFromAttacker: true,
      }],
    },

    /**
     * Up air — three fireballs in quick succession, alternating hands.
     *
     * The first two are **links, not hits**: fixed low knockback with a stated
     * hitstun, the same trick the jab string uses, so they hold the target in
     * place above him instead of pushing them out of the third. Only the last
     * one launches.
     *
     * Deliberately short. Reach is about one body length up — it is a juggling
     * tool that has to be positioned under someone, not a wall above his head.
     */
    uair: {
      id: 'uair', name: 'Up Air', kind: 'aerial', total: 40, pose: 'fireVolley',
      landingLag: 8, autocancel: [[1, 4], [35, 40]],
      /**
       * `rehitRate` is what makes this a three-hit move at all.
       *
       * Repeat hits are tracked per **move**, not per hitbox — the key is
       * `moveId:victimId` — so by default a target struck by the first fireball
       * is locked out of the other two and the string ends after one shot. Any
       * move whose hitboxes are meant to land in sequence has to opt back in.
       *
       * The links also carry the victim *upward* rather than just holding them:
       * a stun that leaves them falling drops them out of the next hitbox before
       * it comes round, because gravity does not care about hitstun.
       *
       * The rate is measured against **global** frames while the move's own
       * frames are frozen by hitlag, so a hitbox stays live well past its stated
       * window. Too low and each box hits twice on its way through (5 gave six
       * hits for 16.6%); too high and the third never lands (11 gave two). 7-9
       * all give exactly three, so 8 sits in the middle with margin either side.
       */
      hitboxes: [
        {
          id: 0, frames: [7, 9], rehitRate: 8,
          shape: { x: 6, y: 92, x2: -4, y2: 136, r: 28 },
          damage: 2, angle: 88, bkb: 0, kbg: 0, setKnockback: 22, hitstun: 16, effect: 'fire',
        },
        {
          id: 1, frames: [13, 15], rehitRate: 8,
          shape: { x: -6, y: 92, x2: 4, y2: 136, r: 28 },
          damage: 2, angle: 88, bkb: 0, kbg: 0, setKnockback: 22, hitstun: 16, effect: 'fire',
        },
        {
          id: 2, frames: [19, 22], rehitRate: 8,
          shape: { x: 6, y: 92, x2: -4, y2: 140, r: 30 },
          damage: 6, angle: 86, bkb: 28, kbg: 112, effect: 'fire',
        },
      ],
    },

    /**
     * Down air — a two-footed stomp. Spikes, which is what the long landing lag
     * and the slow startup are paying for.
     */
    dair: {
      id: 'dair', name: 'Down Air', kind: 'aerial', total: 52, pose: 'stomp',
      landingLag: 14, autocancel: [[1, 6], [47, 52]],
      hitboxes: [{
        id: 0, frames: [16, 20],
        shape: { x: 14, y: 12, x2: -14, y2: -30, r: 27 },
        damage: 14, angle: 270, bkb: 26, kbg: 72, effect: 'fire',
      }],
    },

    // --------------------------------------------------------------- specials
    /**
     * Neutral B — Fireball (5 Elixir).
     * The document's flagship example of the Elixir mechanic: a devastating
     * move you must consciously decide to spend on.
     */
    neutralB: {
      id: 'fireball', name: 'Fireball', kind: 'special', total: 46,
      cost: FIREBALL_COST,
      costFrame: FIREBALL_RELEASE,
      pose: 'castHeave',
      onFrame(f, frame) {
        if (frame !== FIREBALL_RELEASE) return;
        f.world.spawnProjectile(f, {
          x: f.x + 44 * f.facing,
          y: f.y - f.def.height * 0.58,
          vx: 8.6 * f.facing,
          vy: 0,
          gravity: 0,
          radius: 24,
          life: 110,
          damage: 12,
          angle: 45,
          // "a fireball that deals great knockback" — still a real kill threat,
          // which is what justifies its 5-Elixir price, but no longer one that
          // ends stocks on its own from the middle of the stage.
          bkb: 44,
          kbg: 92,
          facing: f.facing,
          effect: 'fire',
          moveId: 'fireball',
          color: '#ff7b2e',
          shape: 'fireball',
          // High priority: melee swings do not swat this out of the air.
          priority: 22,
          destroyOnGround: false,
          onHit(p, victim, world) {
            world.spawnEffect({ x: p.x, y: p.y, kind: 'explosion', size: 52, life: 18, color: '#ff9b3d' });
            world.camera.addShake(40);
          },
          onExpire(p, world) {
            world.spawnEffect({ x: p.x, y: p.y, kind: 'explosion', size: 34, life: 14, color: '#ff9b3d' });
          },
        });
        f.world.camera.addShake(14);
      },
    },

    /**
     * Side B — Fire Tornado (4 Elixir).
     * A slow, drifting multi-hit that drags opponents in and pops them up.
     */
    sideB: {
      id: 'fireTornado', name: 'Fire Tornado', kind: 'special', total: 62,
      cost: 4,
      costFrame: TORNADO_RELEASE,
      pose: 'summon',
      /**
       * Planted on the ground, free in the air.
       *
       * Specials keep their momentum by default, which is right for an aerial
       * cast but wrong here — sprinting into it slid him most of a body length
       * while he was supposedly standing still conjuring something. Killing the
       * run only when grounded leaves the air version untouched, where carrying
       * the drift is the whole point.
       */
      onStart(f) { if (f.grounded) f.vx = 0; },
      onFrame(f, frame) {
        // Embers gather at his hands through the long summon, so the slow raise
        // reads as building something rather than as startup being padded.
        if (frame > 4 && frame < TORNADO_RELEASE && frame % 2 === 0) {
          const u = frame / TORNADO_RELEASE;
          ember(f, f.x + f.facing * 10 + (Math.random() - 0.5) * 26,
            f.y - f.def.height * (0.6 + u * 0.7), 10 + u * 8, 14, 0, -0.8);
        }
        if (frame !== TORNADO_RELEASE) return;
        f.world.spawnProjectile(f, {
          x: f.x + 60 * f.facing,
          y: f.y - 46,
          vx: 2.6 * f.facing,
          vy: 0,
          gravity: 0,
          radius: 40,
          life: 100,
          // Cut once the trap actually held. At 1.6 a full 22-tick capture was
          // nearly 29% from a single 4-Elixir cast, which is a kill setup and a
          // third of a stock in the same button.
          // Tuned against the measured total, not the raw sum: staling eats
          // roughly a sixth of a fourteen-hit string, so the numbers on the page
          // are always higher than what a target actually takes.
          damage: 0.8,
          /**
           * The churn launches **along the tornado's travel**, not upward.
           *
           * At 85 degrees every tick threw the victim out of the top, so they
           * popped free long before the finisher and the trap never closed —
           * the whole move was a few chip hits. A shallow forward angle carries
           * them with it instead, and the drag in `onHit` keeps them centred.
           *
           * `kbg 0` matters as much as the angle: any growth at all means the
           * trap stops working at exactly the percents where the finisher's
           * launch would be worth having.
           */
          angle: 18,
          bkb: 15,
          kbg: 0,
          facing: f.facing,
          effect: 'fire',
          moveId: 'fireTornado',
          color: '#ffb84d',
          shape: 'tornado',
          spin: 0.4,
          priority: 18,
          maxHits: 40,
          // Tighter than before: the gap between ticks is how long the victim
          // has to fall out of the funnel under their own weight.
          rehitRate: 5,
          destroyOnHit: false,
          destroyOnGround: false,
          destroyOnShield: false,
          collidesWithProjectiles: false,
          // Flames spiralling up the funnel. Written as a helix in the vortex's
          // own frame so the particles climb *with* the spin instead of being
          // sprayed out of it.
          onStep(p, world) {
            const climb = (p.age % 26) / 26;
            for (const turn of [0, 2.1, 4.2]) {
              const a = p.rotation * 2.4 + turn + climb * 3.6;
              // Widens as it climbs, matching the funnel it is riding.
              const wide = p.radius * (0.28 + climb * 0.85);
              world.spawnEffect({
                x: p.x + Math.cos(a) * wide,
                y: p.y + p.radius * 1.0 - climb * p.radius * 2.1,
                vx: Math.cos(a) * 0.5, vy: -1.6,
                // Solid sparks rather than smoke: smoke fades on the square of
                // its age and the flames washed out against the funnel's glow.
                size: 9 + climb * 7, life: 13,
                color: climb > 0.55 ? '#ffe9a8' : '#ff7a2e',
              });
            }
          },
          // Drags the victim toward the tornado's centre while it churns. The
          // launch itself is resolved after hitlag, so this cannot set velocity
          // outright — it is a nudge that biases where they end up between ticks.
          onHit(p, victim) {
            victim.vx += (p.x - victim.x) * 0.12;
            victim.vy += (p.y - victim.y) * 0.06;
          },
          /**
           * The finisher. The churn itself barely moves anyone — that is what
           * makes it a trap rather than a hit — so the tornado ends by throwing
           * whoever is still inside straight up, which is where the Wizard's up
           * air and up tilt are waiting.
           *
           * Tuned by measurement against the 900 ceiling: a 119 pop at 0%, which
           * is inside a full hop (175) so he can chase it, rising to a KO at
           * about 230%. Low base with steep growth is what buys both ends — the
           * first draft at `kbg 42` popped 74 and could not kill at *any*
           * percent, which made the finisher pure decoration.
           */
          onExpire(p, world) {
            world.spawnEffect({ x: p.x, y: p.y, kind: 'explosion', size: 64, life: 20, color: '#ffb84d' });
            world.spawnProjectile(p.owner, {
              x: p.x, y: p.y,
              vx: 0, vy: 0, gravity: 0,
              radius: 52, life: 4,
              damage: 4, angle: 88, bkb: 48, kbg: 190,
              facing: p.facing, effect: 'fire',
              moveId: 'fireTornadoPop',
              color: '#ffd88a', shape: 'burst',
              priority: 20, maxHits: 2,
              destroyOnGround: false, destroyOnShield: false,
              collidesWithProjectiles: false,
            });
          },
        });
      },
    },

    /**
     * Up B — Hero Wings (2 Elixir).
     * Cheap and reliable: the Wizard needs a dependable way back, because
     * everything else in his kit is expensive.
     */
    /**
     * Up B — Hero Wings (2 Elixir).
     *
     * Golden wings unfurl on his back and lift him once, and then he **stays
     * winged** until he chooses to leave. Flight is a state, not an animation
     * with a fixed length.
     *
     * The controls split cleanly, which is what makes the state usable:
     *
     *   jump    — flap, up to WING_FLAPS times, each buying height
     *   special — furl the wings and drop into freefall
     *   attack  — cancel into an aerial, which inherits the freefall
     *   getting hit — the wings come off, but **no** freefall; a hit already
     *                 costs him the position, and adding helplessness on top
     *                 turns every stray jab offstage into a stock
     *
     * Putting the flap on jump rather than on B is what buys the whole thing.
     * The two jobs — gain height, leave the state — were on the same button, so
     * the player could not hold the state open to look for an aerial, and any
     * hesitation dropped him into freefall. Split across two buttons, staying up
     * is free and leaving is deliberate.
     *
     * The flap count is still capped: unlimited flaps is unlimited recovery, and
     * the interesting decision is *when* to spend them, not whether they run
     * out. Once they are gone he keeps the wings and the aerial cancel, he just
     * stops climbing.
     *
     * `total` is a safety ceiling, not a duration — five seconds of hanging is
     * far past any real recovery, and something has to bound an open state.
     */
    upB: {
      id: 'heroWings', name: 'Hero Wings', kind: 'special', total: 300,
      cost: 2,
      costFrame: 8,
      pose: 'soar',
      freefallAfter: true,
      // Closer to normal weight than a glide. He is held up by the flaps, not
      // by the state — without this he floats gently for as long as he likes.
      gravityMul: 0.82,
      onStart(f) {
        f.vy = 0;
        f.custom.wings = { active: true, flaps: WING_FLAPS, sinceFlap: 0, flapAnim: 0 };
      },
      onEnd(f) {
        if (f.custom.wings) f.custom.wings.active = false;
      },
      onFrame(f, frame) {
        const wg = f.custom.wings;
        if (!wg) return;
        wg.sinceFlap++;
        if (wg.flapAnim > 0) wg.flapAnim--;

        // Landing ends the recovery. Specials are not interrupted by landing in
        // general — that rule exists so an aerial special still comes out — but
        // a recovery that keeps flapping on the ground is nonsense.
        if (f.grounded && frame > 10) { f.endAction(); return; }

        /**
         * @param {number} power upward launch speed
         * @param {boolean} straight kills horizontal drift instead of adding to it
         *
         * Height goes as the square of the launch speed, so "50% more height"
         * is a factor of sqrt(1.5) ≈ 1.22 on these numbers, not 1.5.
         */
        const flap = (power, straight = false) => {
          f.vy = -power;
          // The opening lift goes **straight up**. Carrying the run into it
          // meant the direction he happened to be moving decided how much of
          // the recovery went upward, so the same input recovered different
          // distances depending on momentum he no longer wanted.
          if (straight) f.vx *= 0.15;
          else f.vx += 1.1 * f.facing;
          wg.sinceFlap = 0;
          wg.flapAnim = 12;
          f.world.spawnEffect({
            x: f.x, y: f.y - f.def.height * 0.45,
            kind: 'wings', size: 46, life: 18, color: '#ffd28a',
          });
          for (let i = 0; i < 5; i++) {
            const side = i % 2 ? 1 : -1;
            ember(f,
              f.x - f.facing * 16 + side * (14 + Math.random() * 20),
              f.y - f.def.height * (0.5 + Math.random() * 0.35),
              14, 16, side * 0.9, 1.4);
          }
        };

        // The opening lift, which is what the 2 Elixir actually buys.
        if (frame === 8) { flap(11.8, true); return; }
        if (frame < 8) return;

        /**
         * Cancel into an aerial. The aerial carries the freefall with it, so
         * this is a way to *use* the remaining airtime, not a way to keep it.
         *
         * The **right stick counts too**. Everywhere else in the game a C-stick
         * flick is an attack input (`stepAir` reads it alongside the button), so
         * a state that only listened for the button left pad players unable to
         * cancel with the input they actually use for aerials.
         */
        const cdir = f.input.cCardinal();
        if (f.input.consume('attack') || cdir !== 'neutral') {
          if (f.tryAerial(cdir !== 'neutral' ? cdir : undefined)) {
            f.moveCtx.freefallAfter = true;
            return;
          }
        }

        // Special furls the wings deliberately.
        if (f.input.consume('special')) {
          f.world.spawnEffect({
            x: f.x, y: f.y - f.def.height * 0.45,
            kind: 'smoke', size: 44, life: 18, color: '#ffd28a',
          });
          f.endAction();
          return;
        }

        // Jump flaps. The gap stops a mashed button from spending every flap on
        // the same frame the first one landed.
        if (wg.flaps > 0 && wg.sinceFlap >= 9 && f.input.consume('jump')) {
          wg.flaps--;
          /**
           * Flapping lets him turn round.
           *
           * This is the one place a fighter may reverse facing in mid-air
           * without a directional special — normally facing is committed the
           * moment you leave the ground. It is granted here because the wings
           * are a *flight* state rather than a jump arc, and being unable to
           * face the stage while recovering onto it made the good flaps and the
           * bad ones feel identical.
           */
          if (Math.abs(f.input.x) > TURN_STICK) f.facing = Math.sign(f.input.x);
          // Later flaps give slightly less, so the total climb is bounded and
          // the first press is always the most valuable one.
          flap(11.6 - (WING_FLAPS - 1 - wg.flaps) * 1.0);
        }
      },
      hitboxes: [{
        id: 0, frames: [8, 12],
        shape: { x: 0, y: 54, x2: 0, y2: 86, r: 30 },
        damage: 6, angle: 88, bkb: 40, kbg: 60, effect: 'fire',
      }],
    },

    /**
     * Down B — Fire Shield (10 Elixir, then a 10-second cooldown).
     *
     * Activating wraps the Wizard in an explosive shield. The next hit he takes
     * is absorbed and detonates it; pressing down B again detonates it manually.
     * A grab cancels it outright. It cannot be activated while in hitstun.
     *
     * The gate used to be once per stock, which made it a thing you saved for
     * so long that most stocks ended without it ever coming out. Full Elixir
     * plus a cooldown is a *rhythm* instead of a single use: the price means he
     * has nothing else banked while it is up, and the cooldown means spending it
     * badly costs him ten seconds rather than the rest of the life.
     *
     * The cooldown starts when the shield **ends**, not when it is cast — a
     * shield held for thirty seconds should not be refunding its own downtime.
     */
    downB: {
      id: 'fireShield', name: 'Fire Shield', kind: 'special', total: 30,
      cost: 10,
      // While the shield is already up, down B falls through to the manual
      // detonation instead of trying to activate a second one.
      fallback: (f) => ((f.custom.fireShield && f.custom.fireShield.active) ? 'fireShieldBurst' : null),
      condition(f) {
        const fs = f.custom.fireShield;
        if (fs && fs.active) return false;                 // -> fallback: detonate
        if (f.hitstun > 0) return false;                    // not while in hitstun
        return true;
      },
      onStart(f) {
        f.custom.fireShield = { active: true };
        f.world.spawnEffect({ x: f.x, y: f.y - f.def.height * 0.5, kind: 'shieldUp', size: 60, life: 20, color: '#c06cff' });
      },
    },

    /** The detonation itself — reached by taking a hit or by pressing down B. */
    fireShieldBurst: {
      id: 'fireShieldBurst', name: 'Fire Shield Burst', kind: 'special', total: 40,
      cost: 0,
      intangible: [1, 12],
      allowDrift: false,
      gravityMul: 0.3,
      onStart(f) {
        if (f.custom.fireShield) f.custom.fireShield.active = false;
        // The cooldown is keyed to the *shield's* id, not the burst's, because
        // it is Down B that has to be locked out. Started here rather than on
        // cast so holding the shield never pays down its own downtime.
        f.cooldowns.set('fireShield', FIRE_SHIELD_COOLDOWN);
        f.vx *= 0.2; f.vy = Math.min(f.vy, 0);
        f.world.spawnEffect({ x: f.x, y: f.y - f.def.height * 0.5, kind: 'explosion', size: 96, life: 24, color: '#ff9b3d' });
        f.world.camera.addShake(70);
      },
      hitboxes: [{
        id: 0, frames: [3, 7],
        shape: { x: 0, y: 50, x2: 0, y2: 52, r: 96 },
        damage: 13, angle: 361, bkb: 70, kbg: 74, effect: 'fire',
        shieldDamage: 6, awayFromAttacker: true,
      }],
    },

    // ---------------------------------------------------------------- throws
    // Heavier, more damaging throws; less combo utility than the Bandit's,
    // but they scale hard — the Wizard's grab is a real kill option.
    fthrow: {
      id: 'fthrow', name: 'Forward Throw', kind: 'throw',
      total: 38, releaseFrame: 16,
      damage: 10, angle: 44, bkb: 48, kbg: 100,
    },
    bthrow: {
      id: 'bthrow', name: 'Back Throw', kind: 'throw',
      total: 42, releaseFrame: 20, reverse: true,
      damage: 11, angle: 44, bkb: 42, kbg: 128,
    },
    uthrow: {
      id: 'uthrow', name: 'Up Throw', kind: 'throw',
      total: 36, releaseFrame: 15,
      damage: 9, angle: 88, bkb: 66, kbg: 118,
    },
    dthrow: {
      id: 'dthrow', name: 'Down Throw', kind: 'throw',
      total: 42, releaseFrame: 18,
      damage: 8, angle: 70, bkb: 68, kbg: 72,
    },

    taunt: {
      id: 'taunt', name: 'Taunt', kind: 'ground', total: 55,
      onStart(f) {
        f.world.spawnEffect({ x: f.x, y: f.y - f.def.height - 20, kind: 'taunt', size: 22, life: 44, color: '#ff8a4c' });
      },
    },
  },
};
