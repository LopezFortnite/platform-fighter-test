import { SIM } from '../../config/gameplay.js';

/**
 * BANDIT — Brawler
 *
 * From the full design document:
 *   - "Fast, agile, medium weight."
 *   - "Dash mechanic that would use elixir to apply a lot of shield pressure.
 *      There would probably be a cooldown of like 1-2 seconds before dashing
 *      again. It would probably be a side B that you could aim in every
 *      direction. Great recovery tool as well."
 *   - "Up B could be some sort of upgraded dash that would deal no damage, but
 *      cover a greater distance."
 *   - Brawlers are "fighters with limited range that prefer hand-to-hand
 *      combat... smaller, faster, and offer an oppressive and combo-oriented
 *      playstyle."
 *
 * Assumptions where the document is silent (kept inside the character's Clash
 * identity, and easy to change here):
 *   - Neutral B "Stone Toss": a 1-Elixir combo starter, matching the document's
 *     framing that cheap specials should be reliable neutral tools.
 *   - Down B "Snatch": invented. The document leaves her down B open, and a
 *     second escape option (the smoke bomb this replaces) sat awkwardly beside
 *     two dashes that already do that job. Stealing Elixir is the one thing the
 *     character's name promises and nothing else in the game touches the
 *     resource layer — see the move for the full reasoning.
 *
 * She fights with the wooden bat she carries in Clash Royale, so her melee is
 * built around blunt, sweeping swings. The bat buys her reach over a blade —
 * but only reach: she is a Brawler, and her speed, weight and combo game are
 * unchanged, so she still has less range than the Wizard's arms on every
 * comparable move.
 */

const S = SIM.FPS; // frames per second, for expressing cooldowns in seconds

/**
 * Frames on which her specials actually commit — the projectile leaves her
 * hand, the intangibility starts. Shared between the move's own logic and its
 * `costFrame` so the Elixir is charged on exactly the frame the move delivers,
 * never earlier. Specials with a hitbox derive this from the hitbox instead.
 */
const STONE_RELEASE = 9;
const DASH_LAUNCH = 8;
const VANISH_BURST = 7;
const SNATCH_GRAB = 7;
/** Elixir moved from the victim to her on a Snatch. */
const SNATCH_STEAL = 3;

/** Bandit's dash: aimable in all eight directions from the stick. */
function dashVelocity(f, speed) {
  const inp = f.input;
  let x = inp.x, y = inp.y;
  if (Math.hypot(x, y) < 0.3) { x = f.facing; y = 0; }
  const mag = Math.hypot(x, y) || 1;
  return { vx: (x / mag) * speed, vy: (y / mag) * speed };
}

export const bandit = {
  id: 'bandit',
  name: 'Bandit',
  archetype: 'Brawler',
  blurb: 'Fast, agile, medium weight. Elixir-fuelled dashes and relentless bat pressure.',
  color: '#5ad2c4',
  accent: '#2d6f7a',
  width: 52,
  height: 92,
  reach: 1.0,
  weight: 92,
  /** Blunt wooden bat: shared getup and ledge attacks spark to match. */
  hitEffect: 'blunt',

  /**
   * 3D model, built from these colours and features by src/render/rig.js.
   * Matched to the Bandit's card art: green hood and cloak over a blue tunic,
   * white bob with a straight fringe, black domino mask, brown gloves and belt, wooden bat.
   */
  model: {
    palette: {
      garment: '#3f6ea8',     // blue tunic and sleeves
      garmentDark: '#2f5480',
      trim: '#5fa06f',        // lighter green hood edge
      skin: '#c98d5e',
      hair: '#e9e7dd',        // white-silver bob
      leather: '#6b4423',     // gloves, bracers, belt
      metal: '#c0c8d4',
      gold: '#b8912f',
      trousers: '#2f5480',
      boot: '#4a2f18',
      eye: '#2fb8c4',         // teal, visible through the mask
      wood: '#c9a068',
      woodDark: '#7a5533',
    },
    hood: { color: '#3d7a4f', trim: '#5fa06f', peak: true },
    hair: 'bob',
    mask: true,
    belt: { color: '#6b4423', buckle: 'metal' },
    cloak: { color: '#356b46', length: 0.5 },
    weapon: 'bat',

    /**
     * Player-slot recolours. Only the cloth changes — the white bob, the mask,
     * her teal eyes, the leather and the bat all stay, so she is still plainly
     * the Bandit on either side of a mirror match.
     */
    variants: {
      red: {
        palette: {
          garment: '#b04a42', garmentDark: '#8a352f',
          trim: '#e08a72', trousers: '#8a352f',
        },
        hood: { color: '#9c3a34', trim: '#e08a72' },
        cloak: { color: '#7d2a26' },
      },
      blue: {
        palette: {
          garment: '#3f6ea8', garmentDark: '#2f5480',
          trim: '#79b0dc', trousers: '#2f5480',
        },
        hood: { color: '#2f6096', trim: '#79b0dc' },
        cloak: { color: '#25486f' },
      },
    },
  },

  /**
   * HUD card art, cropped to a head-and-shoulders bust out of the full
   * character card. `crop` is [x, y, w, h] in 0..1 of the source image
   * (source is 1066x992, so this differs from the Wizard's portrait card).
   */
  portrait: { src: 'assets/portraits/bandit.png', crop: [0.242, 0.146, 0.469, 0.504] },

  attributes: {
    walkSpeed: 3.2,
    runSpeed: 7.2,
    initialDashSpeed: 8.5,
    // Dash distance is speed x frames. Shortened rather than slowed: the burst
    // has to stay faster than the run to read as a burst at all. 8.5 x 4 = 34px,
    // about two thirds of a body width — short enough that a dash reads as a
    // step-in rather than a commitment.
    dashFrames: 4,
    runAccel: 0.78,
    traction: 0.52,
    turnFrames: 6,
    runBrakeFrames: 12,

    airSpeed: 6.1,
    airAccel: 0.33,
    airFriction: 0.04,
    gravity: 0.52,
    maxFall: 10.4,
    fastFallMul: 1.62,

    // Full hop peaks at ~178px (13.6^2 / 2g) with ~52 frames of airtime,
    // clearing the side platforms at 150 with room to act.
    fullHopVelocity: -13.6,
    shortHopVelocity: -8.4,
    airJumpVelocity: -12.3,
    airJumps: 1,
    jumpHorizontalBoost: 0.7,

    landFrames: 4,
    helplessLandLag: 20,
  },

  onCreate(f) {
    f.custom.dashReady = true;
  },

  moves: {
    // ------------------------------------------------------------- grounded
    /**
     * Jab is a one-two with the bat: a flat forehand swept across the front,
     * then a backhand coming back the other way. Both are horizontal — she
     * swings the bat, she does not chop with it. Two hits, not three: the
     * second is the finisher and sends them away, so there is nothing for a
     * third to follow up.
     */
    jab: {
      id: 'jab', name: 'Jab 1', kind: 'ground', total: 18,
      pose: 'swingAcross',
      cancelInto: { from: 5, to: 16, attack: 'jab2', special: true },
      hitboxes: [{
        id: 0, frames: [4, 6],
        shape: { x: 28, y: 62, x2: 66, y2: 44, r: 18 },
        damage: 3, angle: 361, bkb: 14, kbg: 20, effect: 'blunt',
      }],
    },
    jab2: {
      id: 'jab2', name: 'Jab 2', kind: 'ground', total: 24,
      pose: 'swingBack',
      hitboxes: [{
        id: 0, frames: [5, 7],
        shape: { x: 30, y: 38, x2: 70, y2: 62, r: 19 },
        damage: 5, angle: 361, bkb: 48, kbg: 66, effect: 'blunt',
      }],
    },

    /**
     * Forward tilt — a one-handed vertical swing off the shoulder. The
     * grounded cousin of her forward air: the bat comes over the top and down
     * through the front, so the hitbox is a tall capsule covering the descent
     * rather than a flat poke.
     *
     * Still her longest grounded reach, and still paid for with slower startup
     * than the jab and no cancel out of it — but the coverage is now vertical,
     * which is what catches someone jumping in at her.
     */
    ftilt: {
      id: 'ftilt', name: 'Forward Tilt', kind: 'ground', total: 32,
      pose: 'shoulderSwing',
      hitboxes: [{
        id: 0, frames: [8, 11],
        shape: { x: 32, y: 96, x2: 86, y2: 16, r: 21 },
        damage: 8.5, angle: 361, bkb: 30, kbg: 90, effect: 'blunt',
      }],
    },

    /**
     * Up tilt — anti-air. The bat winds up behind her, travels over the head
     * and finishes out in front, so it is two hitboxes chasing the arc in that
     * order rather than one box parked
     * overhead: catching someone on the way in *and* someone crossing up.
     */
    utilt: {
      id: 'utilt', name: 'Up Tilt', kind: 'ground', total: 30,
      pose: 'arcOver',
      hitboxes: [
        {
          id: 0, frames: [6, 9],
          shape: { x: -46, y: 72, x2: 6, y2: 122, r: 24 },
          damage: 5.5, angle: 100, bkb: 48, kbg: 182, effect: 'blunt',
        },
        {
          id: 1, frames: [10, 14],
          shape: { x: 20, y: 110, x2: 60, y2: 70, r: 24 },
          damage: 6, angle: 88, bkb: 52, kbg: 190, effect: 'blunt',
        },
      ],
    },

    /**
     * Down tilt — a low kick that pops them up. The launch angle is the whole
     * point: it lifts rather than skidding them along the floor, which is what
     * turns it into a combo starter for a Brawler.
     */
    dtilt: {
      id: 'dtilt', name: 'Down Tilt', kind: 'ground', total: 26,
      pose: 'lowKick',
      hitboxes: [{
        id: 0, frames: [6, 8],
        shape: { x: 24, y: 16, x2: 76, y2: 22, r: 18 },
        damage: 6, angle: 80, bkb: 40, kbg: 125, effect: 'blunt',
      }],
    },

    /**
     * Dash attack — a lunging smack. She hops into it and brings the bat down
     * from overhead, so the hitbox is a tall capsule running from head height
     * to the floor: the whole descending arc is the hit, and it finishes on
     * the ground rather than poking straight out in front.
     */
    dashAttack: {
      id: 'dashAttack', name: 'Dash Attack', kind: 'ground', total: 38,
      pose: 'chopDown',
      momentum: 0.9, keepMomentum: true,
      // The hop is timed so she comes down as the bat does: the last active
      // frame is the smack, and she lands on the knee to meet it.
      movement: [
        { frame: 1, vx: 7.4, mode: 'set' },
        { frame: 2, vy: -5.0, mode: 'set' },
        { frame: 16, vx: 1.5, mode: 'set' },
      ],
      hitboxes: [
        {
          id: 0, frames: [10, 14],
          shape: { x: 34, y: 96, x2: 74, y2: 10, r: 22 },
          damage: 10, angle: 361, bkb: 55, kbg: 80, effect: 'blunt',
        },
        {
          id: 1, frames: [15, 19],
          shape: { x: 24, y: 26, x2: 72, y2: 6, r: 21 },
          damage: 6, angle: 361, bkb: 40, kbg: 60, effect: 'blunt',
        },
      ],
    },

    // --------------------------------------------------------------- smashes
    /**
     * Forward smash — a two-handed baseball swing. Her hardest single hit, and
     * the longest windup she has to pay for it.
     */
    fsmash: {
      id: 'fsmash', name: 'Forward Smash', kind: 'ground', total: 58,
      pose: 'batSwing2H',
      charge: { frame: 8, maxFrames: 60 },
      // The bat itself moves fast — contact is over in three frames — and then
      // she spends a long time unwinding out of it. A real swing does not stop
      // where it hits, and the follow-through is what she is punishable for.
      hitboxes: [{
        id: 0, frames: [11, 13],
        shape: { x: 28, y: 58, x2: 101, y2: 46, r: 24 },
        damage: 16, angle: 361, bkb: 30, kbg: 96, effect: 'blunt', shieldDamage: 2,
      }],
    },

    /**
     * Up smash — she leaps and swoops the bat overhead. The hop is real
     * movement, not animation: it carries her off the ground and she lands
     * inside the move's own recovery.
     */
    usmash: {
      id: 'usmash', name: 'Up Smash', kind: 'ground', total: 42,
      pose: 'swoopUp',
      charge: { frame: 6, maxFrames: 60 },
      movement: [{ frame: 8, vy: -8.6, mode: 'set' }],
      hitboxes: [
        {
          id: 0, frames: [10, 12],
          // Arcs from in front of the Bandit up overhead: an anti-air that
          // still punishes someone standing right next to her.
          shape: { x: 34, y: 38, x2: 10, y2: 135, r: 26 },
          damage: 14, angle: 88, bkb: 28, kbg: 98, effect: 'blunt',
        },
        {
          id: 1, frames: [13, 16],
          shape: { x: 24, y: 42, x2: 8, y2: 125, r: 21 },
          damage: 9, angle: 88, bkb: 24, kbg: 88, effect: 'blunt',
        },
      ],
    },

    /**
     * Down smash — a splits kick, fast and flat. Both hitboxes come out early
     * and send almost horizontally, which makes it her edge-of-stage answer
     * rather than a combo tool: it does not lift, it removes.
     */
    dsmash: {
      id: 'dsmash', name: 'Down Smash', kind: 'ground', total: 36,
      pose: 'splits',
      charge: { frame: 4, maxFrames: 60 },
      hitboxes: [
        {
          id: 0, frames: [6, 8],
          shape: { x: 22, y: 15, x2: 82, y2: 12, r: 20 },
          damage: 12, angle: 14, bkb: 34, kbg: 94, effect: 'blunt',
        },
        {
          id: 1, frames: [11, 13],
          shape: { x: -22, y: 15, x2: -82, y2: 12, r: 20 },
          damage: 11, angle: 14, bkb: 34, kbg: 94, effect: 'blunt', awayFromAttacker: true,
        },
      ],
    },

    // --------------------------------------------------------------- aerials
    /**
     * Neutral air — a sex kick. Out on frame 4 and then *staying* out: a strong
     * early window followed by a long weak one, so it keeps hitting for most of
     * a second. That decay is the move — early it starts combos, late it is a
     * lingering wall you can throw out and land behind.
     *
     * The hitbox trails the extended foot rather than wrapping her, which is
     * what stops a lingering box that large being oppressive.
     */
    nair: {
      id: 'nair', name: 'Neutral Air', kind: 'aerial', total: 40,
      pose: 'sexKick',
      landingLag: 5, autocancel: [[1, 3], [35, 40]],
      hitboxes: [
        {
          id: 0, frames: [4, 6],
          shape: { x: 34, y: 44, x2: -10, y2: 54, r: 30 },
          damage: 7, angle: 361, bkb: 20, kbg: 80, effect: 'blunt', awayFromAttacker: true,
        },
        {
          id: 1, frames: [7, 28],
          shape: { x: 30, y: 40, x2: -8, y2: 50, r: 25 },
          damage: 4.5, angle: 361, bkb: 14, kbg: 62, effect: 'blunt', awayFromAttacker: true,
        },
      ],
    },

    /**
     * Forward air — a full vertical swipe, overhead down to low, and fast.
     * The hitbox is a tall capsule covering the whole descending arc rather
     * than a poke at the end of it.
     */
    fair: {
      id: 'fair', name: 'Forward Air', kind: 'aerial', total: 30,
      pose: 'chopAir',
      landingLag: 6, autocancel: [[1, 3], [26, 30]],
      hitboxes: [{
        id: 0, frames: [6, 9],
        shape: { x: 30, y: 96, x2: 60, y2: 10, r: 21 },
        damage: 9, angle: 361, bkb: 20, kbg: 92, effect: 'blunt',
      }],
    },

    /**
     * Back air — a hard horizontal swipe behind her, turning into the swing.
     *
     * Startup lengthened from 6 frames to 10. It is her strongest aerial and it
     * was coming out almost on the first frame, which left no windup to read
     * and no coil for the animation to play — the arm was already extended by
     * the time anything happened.
     */
    bair: {
      id: 'bair', name: 'Back Air', kind: 'aerial', total: 38,
      pose: 'swipeBack',
      landingLag: 6, autocancel: [[1, 4], [33, 38]],
      /**
       * One capsule laid along the bat, not two flat boxes stacked near each
       * other.
       *
       * The old pair sat level with her chest while the bat measured its
       * *lowest* point on the active frames and rose afterwards, so what hit
       * and what you could see had almost nothing to do with each other. This
       * runs from just behind her hip up and back to where the bat tip actually
       * measures at contact (about 70 back, 71 up), which makes it a single
       * readable diagonal.
       */
      hitboxes: [
        {
          id: 0, frames: [10, 13],
          shape: { x: -22, y: 52, x2: -76, y2: 76, r: 23 },
          damage: 11.5, angle: 361, bkb: 24, kbg: 114, effect: 'blunt', awayFromAttacker: true,
        },
        {
          id: 1, frames: [14, 17],
          shape: { x: -20, y: 66, x2: -66, y2: 96, r: 21 },
          damage: 7, angle: 361, bkb: 18, kbg: 72, effect: 'blunt', awayFromAttacker: true,
        },
      ],
    },

    /**
     * Up air — a backflip kick. Her juggle finisher, and a ladder at low
     * percent only.
     *
     * The growth used to be deliberately tiny so it chained into itself
     * forever, which made it a move that never sent anyone anywhere. It now
     * scales properly: 404px of launch at 100% against 84px before, killing off
     * the top at 210%. The ladder survives at 0-20%, where she still out-climbs
     * the launch; past that they outpace her, which is the point of a move that
     * actually sends.
     */
    uair: {
      id: 'uair', name: 'Up Air', kind: 'aerial', total: 25,
      pose: 'backflipKick',
      landingLag: 4, autocancel: [[1, 3], [21, 25]],
      hitboxes: [{
        id: 0, frames: [5, 8],
        shape: { x: 10, y: 92, x2: -10, y2: 129, r: 26 },
        damage: 6.5, angle: 88, bkb: 16, kbg: 180, effect: 'blunt',
      }],
    },

    /**
     * Down air — both hands on the bat, straight down through the middle. The
     * central box spikes; the shallower one beside it catches anyone clipped by
     * the edge of the swing and sends them out instead of down, so a miss is
     * not a free stage spike.
     */
    dair: {
      id: 'dair', name: 'Down Air', kind: 'aerial', total: 44,
      pose: 'batSpike',
      landingLag: 10, autocancel: [[1, 5], [40, 44]],
      hitboxes: [
        {
          id: 0, frames: [10, 12],
          shape: { x: 4, y: 26, x2: 4, y2: -22, r: 23 },
          damage: 11, angle: 270, bkb: 20, kbg: 82, effect: 'blunt',
        },
        {
          id: 1, frames: [10, 12],
          shape: { x: 26, y: 24, x2: 34, y2: 2, r: 19 },
          damage: 8, angle: 45, bkb: 22, kbg: 70, effect: 'blunt',
        },
      ],
    },

    // --------------------------------------------------------------- specials
    /**
     * Neutral B — Stone Toss (1 Elixir).
     * She carries a bat, not throwing knives, so her cheap neutral tool is a
     * stone flicked out of the free hand. Mechanically unchanged from the
     * thrown blade it replaces: a reliable, low-commitment combo starter, which
     * is what the document asks a cheap special to be.
     */
    neutralB: {
      id: 'stoneToss', name: 'Stone Toss', kind: 'special', total: 30,
      cost: 1,
      pose: 'throwOver',
      // The stone leaves her hand on this frame, so that is the frame she pays
      // for it — knocked out of the throw beforehand and it costs nothing.
      costFrame: STONE_RELEASE,
      onFrame(f, frame) {
        if (frame !== STONE_RELEASE) return;
        f.world.spawnProjectile(f, {
          x: f.x + 34 * f.facing,
          y: f.y - f.def.height * 0.62,
          // Lobbed, not flung flat: it leaves her hand rising and real gravity
          // brings it back down, so it arcs over a crouching opponent and lands
          // short instead of running to the blast zone at head height.
          vx: 10.5 * f.facing,
          vy: -5.4,
          gravity: 0.34,
          radius: 10,
          life: 60,
          damage: 4,
          angle: 361,
          bkb: 18,
          kbg: 42,
          facing: f.facing,
          effect: 'blunt',
          moveId: 'stoneToss',
          color: '#b6ab99',
          shape: 'stone',
          priority: 4,
        });
      },
    },

    /**
     * Side B — Bandit Dash (2 Elixir, 1.5 s cooldown).
     * "a dash mechanic that would use elixir to apply a lot of shield pressure...
     *  a cooldown of like 1-2 seconds before dashing again... you could aim it
     *  in every direction. Great recovery tool as well."
     * Intangible through the dash itself, as the Bandit is in Clash Royale.
     */
    sideB: {
      id: 'banditDash', name: 'Bandit Dash', kind: 'special', total: 41,
      cost: 2,
      pose: 'sprintSet',
      cooldown: Math.round(1.5 * S),
      allowDrift: false,
      gravityMul: 0,
      // Startup is three frames longer than it was. The dash is intangible and
      // chips shields hard; the tell has to be long enough to react to, or it
      // is a safe approach with no answer.
      intangible: [DASH_LAUNCH, 16],
      onStart(f) {
        f.custom.dashReady = false;
        f.vx = 0; f.vy = 0;
      },
      onFrame(f, frame) {
        // Grey smoke boils up around her while she loads, drifting upward.
        if (frame < DASH_LAUNCH && frame % 2 === 1) {
          const spread = f.def.width * 0.8;
          f.world.spawnEffect({
            x: f.x + (Math.random() - 0.5) * spread,
            y: f.y - f.def.height * (0.15 + Math.random() * 0.5),
            kind: 'smoke', size: 15 + Math.random() * 10, life: 20,
            color: '#9aa3ad',
            vx: (Math.random() - 0.5) * 0.8, vy: -0.7 - Math.random() * 0.5,
            spin: (Math.random() - 0.5) * 3,
          });
        }
        if (frame === DASH_LAUNCH) {
          const v = dashVelocity(f, 23.3);
          f.vx = v.vx; f.vy = v.vy;
          f.facing = v.vx >= 0 ? 1 : -1;
          f.world.spawnEffect({ x: f.x, y: f.y - f.def.height * 0.5, kind: 'dash', size: 34, life: 12, color: '#5ad2c4' });
        }
        // Streaks laid down behind her along her heading while she travels.
        if (frame > DASH_LAUNCH && frame <= 17) {
          const ang = Math.atan2(-f.vy, f.vx);
          for (let i = 0; i < 2; i++) {
            f.world.spawnEffect({
              x: f.x - f.vx * 0.3 + (Math.random() - 0.5) * 14,
              y: f.y - f.def.height * (0.2 + Math.random() * 0.6),
              kind: 'streak', size: 30 + Math.random() * 18, life: 11,
              color: '#8fd8ff', angle: ang,
            });
          }
        }
        if (frame === 18) { f.vx *= 0.25; f.vy *= 0.25; }
      },
      onEnd(f) {
        f.custom.dashReady = true;
      },
      hitboxes: [{
        id: 0, frames: [DASH_LAUNCH, 17],
        shape: { x: 0, y: 48, x2: 24, y2: 46, r: 28 },
        damage: 8, angle: 361, bkb: 30, kbg: 76, effect: 'blunt',
        // The shield pressure the document calls for: heavy shield chip.
        shieldDamage: 7, shieldstunMul: 1.5,
      }],
    },

    /**
     * Up B — Vanishing Dash (3 Elixir).
     * "an upgraded dash that would deal no damage, but cover a greater distance."
     */
    upB: {
      id: 'vanishingDash', name: 'Vanishing Dash', kind: 'special', total: 48,
      cost: 3,
      pose: 'sprintSet',
      freefallAfter: true,
      allowDrift: false,
      gravityMul: 0,
      intangible: [VANISH_BURST, 14],
      costFrame: VANISH_BURST,
      noLedgeGrab: false,
      onStart(f) { f.vx = 0; f.vy = 0; },
      onFrame(f, frame) {
        if (frame < VANISH_BURST && frame % 2 === 1) {
          const spread = f.def.width * 0.8;
          f.world.spawnEffect({
            x: f.x + (Math.random() - 0.5) * spread,
            y: f.y - f.def.height * (0.15 + Math.random() * 0.5),
            kind: 'smoke', size: 16 + Math.random() * 11, life: 22,
            color: '#a6b0bb',
            vx: (Math.random() - 0.5) * 0.8, vy: -0.7 - Math.random() * 0.5,
            spin: (Math.random() - 0.5) * 3,
          });
        }
        if (frame === VANISH_BURST) {
          const inp = f.input;
          let x = inp.x, y = inp.y;
          // Defaults to straight up when the stick is neutral.
          if (Math.hypot(x, y) < 0.3) { x = 0; y = -1; }
          // Bias upward so it always functions as a recovery.
          if (y > 0.2) y = Math.min(y, 0.55);
          const mag = Math.hypot(x, y) || 1;
          // The upgrade over the side dash is *distance*, so it is faster and
          // holds that speed longer. It still deals no damage, which is what
          // the document trades that reach against.
          f.vx = (x / mag) * 30.7;
          f.vy = (y / mag) * 30.7;
          if (Math.abs(x) > 0.3) f.facing = x > 0 ? 1 : -1;
          f.world.spawnEffect({ x: f.x, y: f.y - f.def.height * 0.5, kind: 'dash', size: 40, life: 14, color: '#9ff3e8' });
        }
        if (frame > VANISH_BURST && frame <= 22) {
          const ang = Math.atan2(-f.vy, f.vx);
          for (let i = 0; i < 2; i++) {
            f.world.spawnEffect({
              x: f.x - f.vx * 0.3 + (Math.random() - 0.5) * 14,
              y: f.y - f.def.height * (0.2 + Math.random() * 0.6),
              kind: 'streak', size: 34 + Math.random() * 20, life: 12,
              color: '#a8e6ff', angle: ang,
            });
          }
        }
        if (frame === 23) { f.vx *= 0.2; f.vy *= 0.2; }
      },
    },

    /**
     * Down B — Snatch (1 Elixir, 2.5 s cooldown).
     *
     * A short lunge that robs the opponent: on hit it deals little damage and
     * almost no knockback, and takes SNATCH_STEAL Elixir off them and puts it
     * on her.
     *
     * Invented for her, and the reasoning is worth recording. She is a bandit —
     * stealing is the one thing the character is actually named for — and
     * Elixir is the mechanic the whole game is built on, so a move that moves
     * Elixir between players is doing something nothing else in the kit does.
     * It also fills a real gap: her other three specials are all burst movement
     * or a projectile, none of which touch the resource layer.
     *
     * The balance is in the swing, not the damage. Landing it is worth up to
     * SNATCH_STEAL * 2 Elixir of tempo — she gains what he loses — which can be
     * the difference between him having a Fireball and not. Against that it is
     * short-ranged, slow to start, has almost no knockback so it does not even
     * get her space, and on a whiff she has spent nothing but is stood in front
     * of him for 15 frames.
     */
    downB: {
      id: 'snatch', name: 'Snatch', kind: 'special', total: 34,
      cost: 1,
      pose: 'snatch',
      cooldown: Math.round(2.5 * S),
      costFrame: SNATCH_GRAB,
      allowDrift: false,
      gravityMul: 0.35,
      onStart(f) { f.vx = 3.4 * f.facing; f.vy = 0; },
      onFrame(f, frame) {
        if (frame === SNATCH_GRAB) f.vx *= 0.35;
        if (frame === 14) f.vx *= 0.4;
      },
      onHit(f, victim, hb, world) {
        // Takes what he has, up to the cap — no conjuring Elixir out of an
        // empty bar, so robbing a broke opponent is its own punishment.
        const taken = Math.min(SNATCH_STEAL, victim.elixir.value);
        victim.elixir.value -= taken;
        victim.elixir.denied = 14;
        f.elixir.gain(taken);
        world.spawnEffect({
          x: (f.x + victim.x) / 2, y: f.y - f.def.height * 0.55,
          kind: 'smoke', size: 30, life: 20, color: '#e4459f',
          vy: -1.1, spin: 2,
        });
        // Only shout about it when there was something worth taking — the bar
        // regenerates continuously, so an empty opponent still has a sliver on
        // them and "snatched 0.1 Elixir" is not worth a banner.
        if (taken < 0.5) return;
        world.announcements.push({
          text: `${f.def.name} snatched ${taken.toFixed(1)} Elixir`,
          life: 70, color: '#ff72e2',
        });
      },
      hitboxes: [{
        id: 0, frames: [SNATCH_GRAB, 10],
        shape: { x: 24, y: 44, x2: 62, y2: 34, r: 20 },
        // Deliberately weak: the point is the theft, and knockback would only
        // push him out of the pressure she just paid to earn.
        damage: 4, angle: 361, bkb: 14, kbg: 18, effect: 'blunt',
      }],
    },

    // ---------------------------------------------------------------- throws
    // Brawlers are combo-oriented, but the base knockback on these has a floor
    // for a reason: at 42 and 39 both throws fed straight back into an up tilt
    // at 0%, 20% *and* 40%, which is not a combo game so much as a loop. The
    // growth is what makes them scale; the base is what stops them chaining.
    dthrow: {
      id: 'dthrow', name: 'Down Throw', kind: 'throw',
      total: 36, releaseFrame: 15,
      damage: 5, angle: 80, bkb: 76, kbg: 116,
    },
    uthrow: {
      id: 'uthrow', name: 'Up Throw', kind: 'throw',
      total: 30, releaseFrame: 12,
      damage: 6, angle: 90, bkb: 74, kbg: 121,
    },
    bthrow: {
      id: 'bthrow', name: 'Back Throw', kind: 'throw',
      total: 36, releaseFrame: 17, reverse: true,
      damage: 9, angle: 40, bkb: 39, kbg: 125,
    },
    fthrow: {
      id: 'fthrow', name: 'Forward Throw', kind: 'throw',
      total: 32, releaseFrame: 13,
      damage: 7, angle: 45, bkb: 46, kbg: 98,
    },

    taunt: {
      id: 'taunt', name: 'Taunt', kind: 'ground', total: 50,
      onStart(f) {
        f.world.spawnEffect({ x: f.x, y: f.y - f.def.height - 20, kind: 'taunt', size: 20, life: 40, color: '#5ad2c4' });
      },
    },
  },
};
