import { SIM } from '../../config/gameplay.js';

/**
 * BARBARIAN — Swordie
 *
 * The document's third archetype: "Melee weapon range; excel in neutral." He is
 * the middle of the three implemented fighters — heavier and further-reaching
 * than the Bandit, faster and more committal than the Wizard — and his whole
 * game is the sword's disjointed range in front of him.
 *
 * His weakness is written into the specials rather than the attributes. Every
 * one of them costs Elixir, including his **recovery**: the Up B spring is 3
 * Elixir, so a Barbarian who spends everything on Battle Rams cannot get back
 * to the stage. No other fighter pays to recover.
 *
 * From the design notes:
 *   - "Side B is a Battle Ram burst option that would be quite fast… it would
 *      last until the player cancels it with pressing B, hitting the opponent,
 *      or getting hit. It would be powerful, but would have a lot of end lag."
 *   - "Down B could be his Evo ability. For like 10 seconds, he's enraged and
 *      deals more damage… he would glow purple."
 *   - "Barbarian Barrel dash attack."
 *   - "Up B is the spring trap meme from Clash of Clans. By holding up b, the
 *      spring could charge up, giving the Barb more distance… the spring would
 *      have a hitbox while falling after it's used."
 *
 * Neutral B was left open, so it is the Sword Slam below.
 */

const S = SIM.FPS;

const RAM_COST = 4;
const SPRING_COST = 3;
const RAGE_COST = 10;
const SLAM_COST = 2;

/** Rage: ten seconds of extra speed, then a twelve second lockout. */
const RAGE_DURATION = 10 * S;
const RAGE_COOLDOWN = 12 * S;
/** Rage makes him quicker, not harder: movement and startup, no damage change. */
const RAGE_MOVE_MUL = 1.75;
const RAGE_RATE = 1.25;

/** Frame the Battle Ram's charge actually begins, and what it is charged on. */
const RAM_LAUNCH = 14;
/** Frame the spring is planted and the launch fires. */
const SPRING_LAUNCH = 12;
/** Frame the shockwave leaves the sword. */
const SLAM_RELEASE = 16;

/**
 * Purple sparks while Rage is up, and the ember trail on the sword slam.
 *
 * Driven from `onStep` so it stays a property of this fighter — the same
 * approach the Wizard's fire trails use, and for the same reason: nothing
 * shared has to learn what a Barbarian is.
 */
function rageAura(f) {
  const r = f.custom.rage;
  if (!r || !r.active) return;
  const h = f.def.height;
  /**
   * A steady soft haze centred on him, rather than a spray of sparks.
   *
   * `smoke` swells and thins as it ages, so overlapping a couple of large
   * low-contrast puffs a frame apart reads as a glow around the body. Sparks
   * flying off him read as a hit effect, which is the wrong signal for a state
   * that lasts ten seconds.
   */
  if (f.world.frame % 2 === 0) {
    f.world.spawnEffect({
      x: f.x, y: f.y - h * 0.48,
      vx: 0, vy: -0.15,
      kind: 'smoke', size: f.def.width * 0.95, life: 12,
      color: '#7a34c0',
    });
  }
  // The occasional ember on top, kept sparse so it stays a glow.
  if (f.world.frame % 9 === 0) {
    f.world.spawnEffect({
      x: f.x + (Math.random() - 0.5) * f.def.width * 0.8,
      y: f.y - h * (0.2 + Math.random() * 0.7),
      vx: (Math.random() - 0.5) * 0.4, vy: -0.9,
      kind: 'smoke', size: 8 + Math.random() * 5, life: 14,
      color: '#e07bff',
    });
  }
}

/**
 * Rage on and off.
 *
 * The speed buff swaps in a **copy** of his attributes rather than editing
 * them. `fighter.attr` is a straight reference to the shared definition object,
 * so scaling it in place would speed up every Barbarian in the match — both
 * players in a mirror, and every match afterwards in the same session.
 */
function startRage(f) {
  const r = f.custom.rage;
  r.active = true;
  r.frames = RAGE_DURATION;
  const a = f.def.attributes;
  f.attr = {
    ...a,
    walkSpeed: a.walkSpeed * RAGE_MOVE_MUL,
    runSpeed: a.runSpeed * RAGE_MOVE_MUL,
    initialDashSpeed: a.initialDashSpeed * RAGE_MOVE_MUL,
    airSpeed: a.airSpeed * RAGE_MOVE_MUL,
    runAccel: a.runAccel * RAGE_MOVE_MUL,
    airAccel: a.airAccel * RAGE_MOVE_MUL,
  };
  f.moveRate = RAGE_RATE;
}

function endRage(f) {
  f.custom.rage.active = false;
  f.attr = f.def.attributes;
  f.moveRate = 1;
  f.world.spawnEffect({
    x: f.x, y: f.y - f.def.height * 0.5,
    kind: 'smoke', size: 46, life: 18, color: '#8b3ecf',
  });
}

export const barbarian = {
  id: 'barbarian',
  name: 'Barbarian',
  archetype: 'Swordie',
  blurb: 'Sword range and a Battle Ram. Even his recovery costs Elixir.',
  color: '#e8b83c',
  accent: '#8a5a1c',
  // The biggest of the three, and genuinely so: this is the hurtbox, not just
  // the model. Bandit 52x92, Wizard 58x100, Barbarian 62x104.
  width: 62,
  height: 104,
  reach: 1.30,
  weight: 106,
  hitEffect: 'blunt',

  /**
   * Built from the card art: bare chest, heavy yellow hair and the horseshoe
   * moustache, studded leather bracers, a red belt with a steel buckle over a
   * brown loincloth, and the sword.
   *
   * `garment` is skin here rather than cloth — he is shirtless, and the torso
   * takes the garment material.
   */
  model: {
    /**
     * Everything on him is some kind of brown, so the palette is built around
     * *separating* those browns rather than picking nice ones: a light skin, a
     * much darker loincloth, and a mid leather between them. The first pass had
     * all three within a few percent of each other and he rendered as one tan
     * block with a sword.
     */
    palette: {
      garment: '#f2c39a',      // bare chest: the torso wears skin, not cloth
      garmentDark: '#dba87e',
      trim: '#c0392b',
      skin: '#f2c39a',
      hair: '#f5c11e',         // the Clash yellow
      leather: '#5f3d21',      // bracers
      metal: '#c2c8d2',
      gold: '#b08028',
      trousers: '#432a14',     // loincloth, darkest thing on him
      boot: '#6b4426',         // sandals
      eye: '#2f5fa8',          // blue
      wood: '#7a5433',
      woodDark: '#5a3d24',
    },
    /**
     * Broader and blockier than the shared silhouette. He is the biggest of the
     * three and it should be legible at a glance rather than only in the stat
     * line — wide through the shoulders, thick through the legs.
     */
    build: { shoulders: 1.22, chest: 1.12, arms: 1.42, legs: 1.26 },

    /**
     * A 5% trim on the whole silhouette. The `build` multipliers above make him
     * broad, which is the point, but they compound with his already large box
     * and he was reading as oversized next to the others rather than merely
     * biggest. Cosmetic only — his hurtbox is unchanged.
     */
    scale: 0.95,

    // Bare-handed. The studded bracers stay as his wristbands, but the shared
    // leather glove and forearm cuff on top of them turned the whole lower arm
    // into one brown block.
    gloves: false,

    hair: 'mane',
    brows: true,
    beard: 'horseshoe',
    // Shorts, not trousers: the thigh takes the garment and the shin stays bare.
    shorts: true,
    // No tabard. He is bare-chested — a hanging front panel covered the whole
    // torso and buried the belt that is supposed to be his team colour.
    belt: { color: '#c0392b', buckle: 'metal' },
    bracers: { color: '#5f3d21' },
    // Hidden until the dash attack calls for it.
    barrel: { wood: '#8a5a2b', woodDark: '#6d4520', metal: '#9aa2ad' },
    // Hidden until the Up B calls for it.
    spring: { wood: '#c58a4a', frame: '#7a4a24', coil: '#d8a521' },
    // Hidden until the Side B calls for it.
    ram: { wood: '#8a5a2b', woodDark: '#68411c', stone: '#6f7175', stoneDark: '#55575b', metal: '#8d949d' },
    weapon: 'sword',

    /**
     * Player-slot recolours. The belt is the team colour — the hair, skin and
     * moustache are the Barbarian whichever side he is on, and recolouring
     * those would stop him reading as himself.
     */
    variants: {
      red: { palette: { trim: '#c0392b' }, belt: { color: '#c0392b', buckle: 'metal' } },
      blue: { palette: { trim: '#2f6fd0' }, belt: { color: '#2f6fd0', buckle: 'metal' } },
    },
  },

  portrait: { src: 'assets/portraits/barbarian.png', crop: [0.14, 0.10, 0.72, 0.49] },

  attributes: {
    // Between the other two on every axis. He is not the slow one — the Wizard
    // is — but he commits harder than the Bandit does to everything he throws.
    walkSpeed: 3.0,
    runSpeed: 6.6,
    initialDashSpeed: 7.6,
    dashFrames: 5,
    runAccel: 0.66,
    traction: 0.46,
    turnFrames: 7,
    runBrakeFrames: 14,

    airSpeed: 5.4,
    airAccel: 0.27,
    airFriction: 0.035,
    gravity: 0.49,
    maxFall: 9.6,
    fastFallMul: 1.58,

    fullHopVelocity: -13.0,
    shortHopVelocity: -8.0,
    airJumpVelocity: -11.9,
    airJumps: 1,
    jumpHorizontalBoost: 0.6,

    landFrames: 4,
    helplessLandLag: 22,
  },

  onCreate(f) {
    f.custom.rage = { active: false, frames: 0 };
    f.custom.ram = { active: false };
  },

  onStep(f) {
    rageAura(f);

    // The spring flight pose runs until he is back on the floor — the Up B
    // action itself ends long before that, mid-air.
    if (f.custom.springFlight && f.grounded) f.custom.springFlight = false;

    const r = f.custom.rage;
    if (r && r.active) {
      r.frames--;
      if (r.frames <= 0) endRage(f);
    }

    /**
     * The Battle Ram ends the moment he is no longer running it. `onEnd` covers
     * the move finishing normally, but a fighter knocked out of it mid-charge
     * never reaches that, so the flag is also reconciled against reality here —
     * otherwise the ram stays "active" for the rest of the stock.
     */
    const ram = f.custom.ram;
    if (ram && ram.active && (!f.move || f.move.id !== 'battleRam')) ram.active = false;
  },

  /** Rage is a buff, not a shield: taking a hit does not strip it. */
  onHitTaken() { return false; },

  moves: {
    // ------------------------------------------------------------- grounded
    /**
     * A two-hit sword string: a horizontal slash across, then a second back the
     * other way. Both are the shared swing families the Bandit's bat uses —
     * they were written for "a long thing in the right hand", which is exactly
     * what the sword is.
     */
    /**
     * A one-two-three of sword swings: out, back, out again.
     *
     * The first two are **links, not hits** — fixed low knockback with a stated
     * hitstun, so the target stays in front of him instead of being pushed out
     * of the finisher. All the payoff is in jab 3.
     */
    jab: {
      id: 'jab', name: 'Jab 1', kind: 'ground', total: 20, pose: 'swordJab1',
      cancelInto: { from: 5, to: 18, attack: 'jab2', special: true },
      hitboxes: [{
        id: 0, frames: [4, 7],
        shape: { x: 28, y: 62, x2: 80, y2: 58, r: 21 },
        damage: 3, angle: 361, bkb: 0, kbg: 0, setKnockback: 6, hitstun: 15,
      }],
    },
    jab2: {
      id: 'jab2', name: 'Jab 2', kind: 'ground', total: 22, pose: 'swordJab2',
      cancelInto: { from: 5, to: 20, attack: 'jab3', special: true },
      hitboxes: [{
        id: 0, frames: [5, 8],
        shape: { x: 26, y: 60, x2: 82, y2: 56, r: 21 },
        damage: 3, angle: 361, bkb: 0, kbg: 0, setKnockback: 6, hitstun: 15,
      }],
    },
    jab3: {
      id: 'jab3', name: 'Jab 3', kind: 'ground', total: 38, pose: 'swordJab3',
      hitboxes: [{
        id: 0, frames: [8, 12],
        shape: { x: 26, y: 60, x2: 98, y2: 54, r: 24 },
        damage: 8, angle: 361, bkb: 62, kbg: 92,
      }],
    },

    /**
     * Forward tilt — the big overhead chop, and the reason he is a Swordie.
     *
     * The reach is the whole point: it starts above his head and comes down
     * through everything in front of him, so the capsule runs from high and
     * close out to low and far rather than sitting at arm's length.
     */
    ftilt: {
      id: 'ftilt', name: 'Forward Tilt', kind: 'ground', total: 42, pose: 'swordChop',
      hitboxes: [{
        id: 0, frames: [12, 17],
        shape: { x: 34, y: 106, x2: 112, y2: 40, r: 25 },
        damage: 13, angle: 361, bkb: 36, kbg: 96,
      }],
    },

    /**
     * Up tilt — a stab straight up, with a scoop beside him.
     *
     * The scoop is what makes it usable: a pure vertical thrust whiffs on
     * anything standing next to him, and this is his anti-air. It sends inward
     * and up rather than away, so a grounded opponent caught by it is lifted
     * into the same place the main hit covers.
     */
    utilt: {
      id: 'utilt', name: 'Up Tilt', kind: 'ground', total: 36, pose: 'swordStabUp',
      hitboxes: [
        {
          id: 0, frames: [10, 15],
          shape: { x: 12, y: 78, x2: 4, y2: 168, r: 25 },
          damage: 10, angle: 90, bkb: 40, kbg: 128,
        },
        {
          /**
           * The scoop launches **as hard as the point does**.
           *
           * It was carrying a third of the tip's knockback growth, and growth is
           * what scales a hit with the victim's percent — so it went nowhere at
           * any percent and caught people only to drop them at his feet. It is a
           * sourspot on damage, not on launch.
           */
          id: 1, frames: [8, 12],
          shape: { x: 44, y: 24, x2: -44, y2: 24, r: 24 },
          damage: 6, angle: 78, bkb: 40, kbg: 128,
        },
      ],
    },

    dtilt: {
      id: 'dtilt', name: 'Down Tilt', kind: 'ground', total: 28, pose: 'swordStabLow',
      // Pops straight up and barely scales, so it stays a combo starter at the
      // percents where follow-ups actually exist.
      hitboxes: [{
        id: 0, frames: [6, 9],
        shape: { x: 26, y: 18, x2: 96, y2: 14, r: 18 },
        damage: 8, angle: 86, bkb: 80, kbg: 58,
      }],
    },

    /**
     * Dash attack — the Barbarian Barrel.
     *
     * He leaps into a spiked barrel and rolls two full turns through whatever is
     * in front of him. The hitbox is **continuous** across the whole roll rather
     * than a single swing, because the barrel is a moving object and there is no
     * one frame where it "connects".
     *
     * It does **not** re-hit, and that is the important part. Repeat hits are
     * tracked per move (`moveId:victimId`) and a hitbox only opts back in with
     * `rehitRate` — leaving that off means the barrel strikes each target once
     * and is then locked out, including against a shield. A continuous hitbox
     * that *did* re-hit would drain a shield to nothing in a single dash, which
     * is exactly the instant shieldbreak to avoid.
     *
     * Launches away rather than up: `awayFromAttacker` sends the victim out on
     * whichever side the barrel caught them, which is what a rolling object
     * should do to you.
     */
    dashAttack: {
      id: 'dashAttack', name: 'Barbarian Barrel', kind: 'ground', total: 72, pose: 'barrelRoll',
      /**
       * `momentum: 1` — a dash attack should never brake you. The default for a
       * grounded move scrubs most of the run speed off on frame one, which made
       * the barrel start from almost a standstill and read as slow no matter
       * what the roll was doing.
       */
      momentum: 1, keepMomentum: true,
      /**
       * It carries speed the whole way and then **stops dead on the frame the
       * barrel breaks**. Tapering off first left it spinning on the spot for a
       * few frames, and a barrel that is still rolling has to be going
       * somewhere — the break is what ends the roll, not a slowdown before it.
       */
      movement: [
        { frame: 6, vx: 11.6, mode: 'set' },    // into the roll
        { frame: 40, vx: 10.0, mode: 'set' },
        { frame: 52, vx: 0, mode: 'set' },      // the frame it bursts
      ],
      /**
       * The active window is also what sets the roll's speed: the pose is driven
       * by `sweep`, which normalises against the last active frame, so widening
       * the window slows the two rotations down without changing their count.
       */
      hitboxes: [{
        id: 0, frames: [10, 51],
        shape: { x: 26, y: 50, x2: -20, y2: 48, r: 34 },
        damage: 13, angle: 45, bkb: 64, kbg: 76, awayFromAttacker: true,
      }],
      /** The barrel bursts apart on the frame he stops, as it does in Clash. */
      onFrame(f, frame) {
        if (frame !== 52) return;
        const h = f.def.height;
        f.world.camera.addShake(22);
        // Staves outward, hoops and spikes with them.
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
          const steel = i % 4 === 0;
          f.world.spawnEffect({
            x: f.x + Math.cos(a) * 20,
            y: f.y - h * 0.42 + Math.sin(a) * 20,
            vx: Math.cos(a) * (2.4 + Math.random() * 2.2) + f.vx * 0.3,
            vy: Math.sin(a) * (2.4 + Math.random() * 2.2) - 1.4,
            kind: 'smoke', size: steel ? 10 : 15, life: 20 + Math.random() * 10,
            color: steel ? '#9aa2ad' : (Math.random() < 0.5 ? '#8a5a2b' : '#6d4520'),
            spin: (Math.random() - 0.5) * 8,
          });
        }
        f.world.spawnEffect({
          x: f.x, y: f.y - h * 0.42,
          kind: 'explosion', size: 46, life: 16, color: '#c99a5c',
        });
      },
    },

    // -------------------------------------------------------------- smashes
    /**
     * Forward smash — two two-handed swings, the second one **opted into**.
     *
     * The smash input buys only the first, weaker cut. Pressing attack again
     * inside the window commits to the follow-up, which is where the kill power
     * is. That makes the move a decision rather than a single button: whiff the
     * first and you can stop, and the opponent has to respect both.
     *
     * They are separate moves rather than one with two hitboxes, because the
     * second only exists if the player asks for it — and separating them means
     * each gets a clean swing clock instead of sharing one.
     */
    fsmash: {
      id: 'fsmash', name: 'Forward Smash', kind: 'ground', total: 52, pose: 'swordHeaveA',
      charge: { frame: 11, maxFrames: 60 },
      cancelInto: { from: 20, to: 44, attack: 'fsmash2' },
      hitboxes: [{
        id: 0, frames: [17, 21],
        shape: { x: 32, y: 72, x2: 122, y2: 50, r: 29 },
        damage: 12, angle: 361, bkb: 0, kbg: 0, setKnockback: 14, hitstun: 26, shieldDamage: 3,
      }],
    },
    /** The follow-up: same swing back the other way, and the one that kills. */
    fsmash2: {
      id: 'fsmash2', name: 'Forward Smash 2', kind: 'ground', total: 54, pose: 'swordHeaveB',
      hitboxes: [{
        id: 0, frames: [15, 20],
        shape: { x: 34, y: 66, x2: 130, y2: 44, r: 31 },
        damage: 19, angle: 361, bkb: 42, kbg: 96, shieldDamage: 6,
      }],
    },

    /**
     * Up smash — two cuts straight up, the first feeding the second.
     *
     * `rehitRate` is what makes this two hits at all. Repeat hits are tracked
     * per **move** (`moveId:victimId`), so without it the target struck by the
     * first swing is locked out of the second and the follow-up whiffs on
     * someone standing still. It is measured in global frames while hitlag
     * freezes the move's own, so it has to clear the first box's live span
     * without reaching the second's start.
     */
    usmash: {
      id: 'usmash', name: 'Up Smash', kind: 'ground', total: 58, pose: 'swordDoubleUp',
      charge: { frame: 9, maxFrames: 60 },
      hitboxes: [
        {
          // The link: fixed knockback and a stated hitstun, so it holds them
          // above him at any percent instead of pushing them out of the second.
          id: 0, frames: [11, 15], rehitRate: 12,
          shape: { x: 22, y: 56, x2: 4, y2: 150, r: 29 },
          damage: 5, angle: 88, bkb: 0, kbg: 0, setKnockback: 30, hitstun: 18,
        },
        {
          id: 1, frames: [25, 30], rehitRate: 12,
          shape: { x: 24, y: 54, x2: 2, y2: 162, r: 31 },
          damage: 16, angle: 88, bkb: 36, kbg: 100,
        },
      ],
    },

    /**
     * Down smash — one cut to each side in succession, left then right.
     *
     * Squared to the camera and laid right down, so both halves are visible;
     * side-on, a move that hits behind him as well is mostly hidden behind his
     * own body.
     */
    dsmash: {
      id: 'dsmash', name: 'Down Smash', kind: 'ground', total: 56, pose: 'swordSweepBoth',
      charge: { frame: 9, maxFrames: 60 },
      hitboxes: [
        {
          id: 0, frames: [12, 17],
          shape: { x: -22, y: 20, x2: -96, y2: 14, r: 24 },
          damage: 13, angle: 32, bkb: 28, kbg: 86, awayFromAttacker: true,
        },
        {
          id: 1, frames: [23, 28],
          shape: { x: 22, y: 20, x2: 96, y2: 14, r: 24 },
          damage: 15, angle: 32, bkb: 32, kbg: 94,
        },
      ],
    },

    // -------------------------------------------------------------- aerials
    nair: {
      id: 'nair', name: 'Neutral Air', kind: 'aerial', total: 40, pose: 'swordSpin',
      landingLag: 7, autocancel: [[1, 5], [35, 40]],
      hitboxes: [{
        id: 0, frames: [8, 19],
        shape: { x: 26, y: 56, x2: -24, y2: 50, r: 38 },
        damage: 9, angle: 48, bkb: 70, kbg: 78, awayFromAttacker: true,
      }],
    },

    fair: {
      id: 'fair', name: 'Forward Air', kind: 'aerial', total: 30, pose: 'swordSlice',
      landingLag: 8, autocancel: [[1, 4], [26, 30]],
      hitboxes: [{
        id: 0, frames: [8, 11],
        shape: { x: 30, y: 66, x2: 104, y2: 58, r: 26 },
        damage: 13, angle: 361, bkb: 26, kbg: 94,
      }],
    },

    bair: {
      id: 'bair', name: 'Back Air', kind: 'aerial', total: 40, pose: 'swordRiseBack',
      landingLag: 8, autocancel: [[1, 5], [35, 40]],
      hitboxes: [{
        id: 0, frames: [10, 15],
        shape: { x: -26, y: 28, x2: -92, y2: 92, r: 25 },
        damage: 10, angle: 62, bkb: 30, kbg: 84, awayFromAttacker: true,
      }],
    },

    uair: {
      id: 'uair', name: 'Up Air', kind: 'aerial', total: 38, pose: 'swordPunchUp',
      landingLag: 7, autocancel: [[1, 4], [33, 38]],
      hitboxes: [{
        id: 0, frames: [8, 13],
        shape: { x: 10, y: 100, x2: -10, y2: 146, r: 28 },
        damage: 11, angle: 86, bkb: 24, kbg: 108,
      }],
    },

    dair: {
      id: 'dair', name: 'Down Air', kind: 'aerial', total: 52, pose: 'swordDive',
      landingLag: 13, autocancel: [[1, 6], [47, 52]],
      hitboxes: [{
        id: 0, frames: [15, 19],
        shape: { x: 14, y: 24, x2: 14, y2: -32, r: 25 },
        damage: 15, angle: 270, bkb: 24, kbg: 72,
      }],
    },

    // -------------------------------------------------------------- specials
    /**
     * Neutral B — Sword Slam (2 Elixir).
     *
     * Left to me by the brief. He drives the sword into the deck and a
     * shockwave runs forward along the floor.
     *
     * **Ground only**, and that is the whole design: it gives a Swordie a poke
     * that covers the ground he cannot reach, without turning him into a Zoner.
     * An opponent who jumps is completely safe from it, which is exactly the
     * kind of answer a projectile should have.
     */
    neutralB: {
      id: 'swordSlam', name: 'Sword Slam', kind: 'special', total: 46,
      cost: SLAM_COST,
      costFrame: SLAM_RELEASE,
      pose: 'chopDown',
      onFrame(f, frame) {
        if (frame !== SLAM_RELEASE) return;
        f.world.spawnProjectile(f, {
          x: f.x + 52 * f.facing,
          y: f.y - 12,
          vx: 7.4 * f.facing,
          vy: 0,
          gravity: 0,
          radius: 22,
          life: 46,
          damage: 9,
          angle: 60,
          bkb: 40,
          kbg: 84,
          facing: f.facing,
          effect: 'blunt',
          moveId: 'swordSlam',
          color: '#d9c07a',
          shape: 'shock',
          priority: 12,
          // Runs along the deck rather than through the air. It is only
          // *thematically* ground-only — the engine has no such flag — so the
          // capsule is kept low and shallow instead, which an opponent clears
          // with any jump. That is the intended answer to it.
          destroyOnGround: false,
          onHit(p, victim, world) {
            world.spawnEffect({ x: p.x, y: p.y, kind: 'explosion', size: 34, life: 14, color: '#e8d9a0' });
          },
        });
        f.world.camera.addShake(18);
      },
    },

    /**
     * Side B — Battle Ram (4 Elixir).
     *
     * He shoulders the ram and charges. It runs until one of three things
     * happens: he presses B, he connects, or he is hit. The first two drop him
     * into `battleRamEnd`, which is where the promised "lot of end lag" lives —
     * the move is a burst movement option *and* a commitment, and it has to be
     * punishable on block or it would simply be free.
     */
    sideB: {
      id: 'battleRam', name: 'Battle Ram', kind: 'special', total: 150,
      cost: RAM_COST,
      costFrame: RAM_LAUNCH,
      pose: 'ramCharge',
      momentum: 0,
      onStart(f) { f.custom.ram.active = false; },
      onFrame(f, frame) {
        if (frame < RAM_LAUNCH) {
          f.vx = 0;
          return;
        }
        if (frame === RAM_LAUNCH) {
          f.custom.ram.active = true;
          f.world.camera.addShake(20);
        }
        // Held at a flat charge speed rather than decaying, so the distance is
        // decided by when the player lets go and not by the animation.
        f.vx = 11.4 * f.facing;
        if (!f.grounded) f.vy = Math.min(f.vy, 3.2);

        // Cancel on B. Consumed so the same press cannot also buffer the next
        // special out of the end lag.
        if (frame > RAM_LAUNCH + 4 && f.input.consume('special')) {
          f.startAction(f.moves.battleRamEnd);
        }
      },
      // Connecting ends the charge — the ram is a burst, not a bulldozer.
      // Clearing the flag is left to `onStep`, which reconciles it against the
      // active move every frame and so also covers being knocked out of it.
      onHit(f) { f.startAction(f.moves.battleRamEnd); },
      hitboxes: [{
        id: 0, frames: [RAM_LAUNCH, 150],
        shape: { x: 24, y: 62, x2: 84, y2: 48, r: 28 },
        damage: 14, angle: 361, bkb: 62, kbg: 88, shieldDamage: 6,
      }],
    },
    /** The price of the ram: forty frames of nothing, whether it hit or not. */
    battleRamEnd: {
      id: 'battleRamEnd', name: 'Battle Ram', kind: 'special', total: 40,
      pose: 'ramSlam',
      momentum: 0.2,
      /**
       * The charge holds him near-level in the air, and cutting it used to hand
       * him straight back to full gravity — measured, he went from 3.7 to
       * terminal 9.6 inside a dozen frames and dropped 224 units before the end
       * lag was over, which read as being shot at the ground rather than as
       * putting something down. He comes down under control instead.
       */
      gravityMul: 0.4,
      onStart(f) {
        f.custom.ram.active = false;
        // Dust where the ram lands, so it has somewhere to have gone.
        f.world.spawnEffect({
          x: f.x + 30 * f.facing, y: f.y - 8,
          kind: 'smoke', size: 34, life: 18, color: '#9c8f7a',
        });
        f.world.camera.addShake(10);
      },
      onFrame(f) {
        // And a ceiling on the descent, so the 40 frames of end lag are not
        // also 40 frames of falling.
        if (!f.grounded) f.vy = Math.min(f.vy, 4.6);
      },
    },

    /**
     * Up B — Spring Trap (3 Elixir).
     *
     * The Clash of Clans spring. Tapping gives a fixed, reasonable launch;
     * holding B winds it up for considerably more. The spring is left where he
     * launched from and falls with a hitbox on it, which makes a recovery from
     * below a genuine two-way threat rather than a pure escape.
     *
     * Charging on **special** rather than attack: holding B is how you wind it
     * up, and the engine's charge hook defaults to the attack button because
     * smashes own it.
     */
    upB: {
      id: 'springTrap', name: 'Spring Trap', kind: 'special', total: 44,
      cost: SPRING_COST,
      costFrame: SPRING_LAUNCH,
      pose: 'springLaunch',
      /**
       * The spring **arrests him** rather than inheriting what he was doing.
       *
       * Reducing gravity alone was not enough: it scaled the acceleration but
       * left the velocity he arrived with, so winding up straight out of a jump
       * carried him on up and winding up out of a fall drove him down. Whatever
       * he was doing vertically stops dead here, and horizontal is cut to a
       * fifth, so the move always starts from the same place.
       *
       * The residual gravity is what makes the wind-up cost something at all —
       * a slow sag of a few units over a full charge, enough to feel without
       * making the charge a trap.
       */
      momentum: 0.2,
      onStart(f) { f.vy = 0; },
      gravityMul: 0.035,
      charge: { frame: 6, maxFrames: 42, button: 'special' },
      /**
       * The sag is moved by hand, on the charge hook.
       *
       * A charging move freezes its own frame and returns before the physics
       * step, so **no gravity reaches him at all** while winding — measured, a
       * full 42-frame charge drifted a single unit, and `gravityMul` had
       * nothing to scale. `onFrame` is skipped in that state too, so the drop
       * belongs here. Position rather than velocity, because the integrator is
       * not running either.
       *
       * Airborne only: the collision pass is skipped as well, so nudging a
       * grounded fighter downward would sink him into the stage.
       */
      onChargeFrame(f) {
        if (!f.grounded) f.y += 0.3;
      },
      onFrame(f, frame) {
        if (frame !== SPRING_LAUNCH) return;
        const t = Math.min(f.chargeFrames / 42, 1);
        // Tapped it still recovers; fully wound it clears a lot of stage.
        f.vy = -(8.8 + t * 5.6);
        f.vx = f.input.x * 3.4;
        f.grounded = false;
        f.custom.springFlight = true;
        // Cleared here so the flip count cannot survive from a previous use.
        f.custom.springSpin = 0;
        f.world.camera.addShake(14 + t * 14);

        // The spring stays behind and drops, hitbox live the whole way.
        f.world.spawnProjectile(f, {
          // Thrown up hard enough to have a real arc. At -3.2 it barely cleared
          // his ankles and was back on the deck inside eight frames, which is
          // not a hitbox anyone could interact with.
          x: f.x, y: f.y - 6,
          vx: 0, vy: -8.5,
          gravity: 0.42,
          // Sized to the prop rather than the other way round: at 20 the model
          // rendered noticeably smaller than the one he launched off.
          radius: 30,
          life: 150,
          damage: 8,
          angle: 88,
          bkb: 42,
          kbg: 74,
          facing: f.facing,
          effect: 'blunt',
          moveId: 'springTrap',
          color: '#c9a227',
          shape: 'spring',
          priority: 10,
          destroyOnGround: true,
        });
      },
      // A spent recovery drops him into freefall, same as every other Up B.
      freefallAfter: true,
    },

    /**
     * Down B — Rage (10 Elixir, once it is off cooldown).
     *
     * Ten seconds of **speed**, not power: 75% faster movement, moves coming
     * out a quarter quicker, and a faint purple glow.
     *
     * Deliberately nothing to damage or knockback. Buffing those would move
     * every one of his kill percents for the duration and rewrite the matchup
     * for ten seconds; changing how fast he closes and how soon his swings
     * arrive changes what he can *do* without touching what anything is worth.
     */
    downB: {
      id: 'rage', name: 'Rage', kind: 'special', total: 34,
      cost: RAGE_COST,
      costFrame: 12,
      cooldown: RAGE_COOLDOWN,
      pose: 'cast',
      condition(f) { return !f.custom.rage.active; },
      onFrame(f, frame) {
        if (frame !== 12) return;
        startRage(f);
        f.world.camera.addShake(26);
        f.world.spawnEffect({
          x: f.x, y: f.y - f.def.height * 0.5,
          kind: 'explosion', size: 78, life: 22, color: '#a24ce0',
        });
      },
    },

    // --------------------------------------------------------------- throws
    fthrow: {
      id: 'fthrow', name: 'Forward Throw', kind: 'throw',
      total: 34, releaseFrame: 14,
      damage: 10, angle: 44, bkb: 56, kbg: 62,
    },
    bthrow: {
      id: 'bthrow', name: 'Back Throw', kind: 'throw',
      total: 38, releaseFrame: 17, reverse: true,
      damage: 12, angle: 40, bkb: 58, kbg: 64,
    },
    uthrow: {
      id: 'uthrow', name: 'Up Throw', kind: 'throw',
      total: 36, releaseFrame: 15,
      damage: 9, angle: 88, bkb: 66, kbg: 82,
    },
    dthrow: {
      id: 'dthrow', name: 'Down Throw', kind: 'throw',
      total: 40, releaseFrame: 17,
      damage: 8, angle: 72, bkb: 62, kbg: 60,
    },

    taunt: {
      id: 'taunt', name: 'Taunt', kind: 'ground', total: 55,
      onStart(f) {
        f.world.spawnEffect({
          x: f.x, y: f.y - f.def.height - 20,
          kind: 'taunt', size: 22, life: 44, color: '#f5c11e',
        });
      },
    },
  },
};
