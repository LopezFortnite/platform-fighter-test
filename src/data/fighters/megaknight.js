/**
 * MEGA KNIGHT — Heavy
 *
 * The biggest and heaviest fighter on the roster, and the slowest across the
 * ground. Two spiked maces welded to his fists, a great helm, and enough plate
 * to make him the hardest thing in the game to launch.
 *
 * **The armour cuts both ways, and that is the character.** He survives to
 * percentages nobody else sees, but he is 82 wide and 122 tall with the highest
 * gravity and the fastest fall on the roster — so once he is off the ground he
 * comes straight back down into whatever is waiting, and every hurtbox he owns
 * is easy to find. He is not hard to hit. He is hard to *finish*.
 *
 * Everything below the attributes is **placeholder**. The moves share existing
 * pose families and their frame data is deliberately unremarkable: slow, heavy,
 * and sized off the Barbarian's so he is playable and legible without pretending
 * to be finished. What is real here is his weight class, his reach and his
 * silhouette. The move set is meant to be replaced wholesale.
 */

/**
 * The crater he leaves on arrival.
 *
 * Shared by the down air, the up B and the down B, because they are the same
 * event at different weights — `power` scales the ring, the dust and the shake
 * together rather than each move tuning its own numbers and drifting apart.
 *
 * Two layers doing different jobs: heavy dark clods thrown out low and fast
 * along the deck, and a slower pale dust cloud rising behind them. Either alone
 * reads as a puff of nothing or a shower of pebbles; the pairing reads as
 * impact.
 */
function crater(f, power = 1) {
  const w = f.world;
  const y = f.y - 4;
  w.camera.addShake(24 * power);
  w.spawnEffect({ x: f.x, y, kind: 'explosion', size: 74 * power, life: 16, color: '#c9b896' });
  for (const side of [-1, 1]) {
    for (let i = 0; i < Math.round(9 * power); i++) {
      const a = -0.10 - Math.random() * 1.15;
      const sp = (3.0 + Math.random() * 4.4) * power;
      w.spawnEffect({
        x: f.x + side * (10 + i * 5), y,
        vx: side * Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5,
        kind: 'smoke', size: (8 + Math.random() * 10) * power, life: 22 + (i % 5) * 4,
        color: i % 3 === 0 ? '#5a4630' : '#7a6244',
        spin: (Math.random() - 0.5) * 12,
      });
    }
    for (let i = 0; i < Math.round(5 * power); i++) {
      w.spawnEffect({
        x: f.x + side * (Math.random() * 54 * power), y: y - Math.random() * 12,
        vx: side * (0.7 + Math.random() * 1.8), vy: -0.8 - Math.random() * 1.1,
        kind: 'smoke', size: (22 + Math.random() * 18) * power, life: 34 + i * 4,
        color: '#b9ab93',
      });
    }
  }
}

export const megaknight = {
  id: 'megaknight',
  name: 'Mega Knight',
  archetype: 'Heavy',
  blurb: 'Enormous, armoured and slow. Survives forever; gets juggled the whole way.',
  color: '#5a6377',
  accent: '#3b7ddd',

  /**
   * Widest and tallest of the four. The width matters more than the height —
   * he is stocky rather than merely large, and a broad hurtbox on a fighter who
   * cannot move quickly is exactly the trade the archetype is built on.
   */
  width: 82,
  height: 122,
  reach: 1.35,
  /**
   * Heaviest by a clear margin. The Barbarian at 106 is the next nearest, and
   * the gap is meant to be felt: he should visibly refuse to die at percentages
   * that kill everyone else.
   */
  weight: 128,
  hitEffect: 'blunt',

  /**
   * Built from the card art: charcoal plate over a bare-armed frame, a great
   * helm with a barred slit and a blue plume, light scale-mail tassets, a broad
   * belt with an orange buckle, and two spiked maces where his hands should be.
   */
  model: {
    palette: {
      garment: '#4a5160',        // the torso is a breastplate
      garmentDark: '#3a404d',
      trim: '#7d8695',
      skin: '#f0c49a',           // bare upper arms, the one warm note
      hair: '#3f4551',
      leather: '#4a5568',
      metal: '#b8bec9',
      gold: '#e8933c',           // the orange buckle
      trousers: '#39414f',
      boot: '#2f3643',
      eye: '#4a90e2',            // blue, and barely visible behind the slit
      wood: '#7a5433',
      woodDark: '#5a3d24',
    },
    /**
     * Massive through the shoulders and thick everywhere else. The arms
     * multiplier is high because the maces hang off them and thin arms under
     * huge fists read as a mistake rather than as a design.
     */
    build: {
      shoulders: 1.34, chest: 1.26, arms: 1.30, legs: 1.34,
      /**
       * A small head on a big body. The default 0.21 of his width gave him a
       * head as broad as his own chest, and once the helm went on it looked
       * like the helmet was wearing him.
       */
      head: 0.82,
      /**
       * Short legs, long torso — the single proportion that most says Mega
       * Knight. This scales the hip height along with the bones, so the feet
       * stay planted and the waistline simply drops.
       */
      legLength: 0.84,
    },

    /**
     * A touch larger than his box, cosmetically. He should loom slightly over
     * what he actually occupies — the hurtbox is untouched, so this costs
     * nothing in balance.
     */
    scale: 1.06,

    /**
     * He does not walk like the others. See `poseStrutWalk` — both maces held
     * up in front, a bounce on every footfall, and the shoulders rolling.
     */
    gait: 'strut',

    helm: {
      color: '#3f4551', plate: '#4b5262', trim: '#565e6e',
      bolt: '#6e7788', plume: '#3b7ddd',
    },
    pauldrons: { color: '#3f4551' },
    scaleSkirt: { color: '#b8bec9', shade: '#98a0ad' },
    maces: { color: '#4a5160', spike: '#6b7280' },
    belt: { color: '#4a5568', buckle: 'gold' },

    variants: {
      red: { palette: { trim: '#c0392b' }, helm: { plume: '#c0392b' } },
      blue: { palette: { trim: '#3b7ddd' }, helm: { plume: '#3b7ddd' } },
    },
  },

  portrait: { src: 'assets/portraits/megaknight.jpg', crop: [0.12, 0.06, 0.78, 0.52] },

  attributes: {
    /**
     * Slowest on the ground in every respect, and the low traction means he
     * keeps sliding after he stops asking to — a heavy fighter should feel like
     * he has momentum to fight, not just a low top speed.
     */
    walkSpeed: 2.5,
    runSpeed: 5.4,
    initialDashSpeed: 6.6,
    dashFrames: 6,
    runAccel: 0.50,
    traction: 0.42,
    turnFrames: 8,
    runBrakeFrames: 14,

    airSpeed: 4.6,
    airAccel: 0.24,
    airFriction: 0.03,
    /**
     * **The combo food half of the character.** Highest gravity and fastest
     * fall on the roster: he drops back into hitstun range faster than anyone,
     * which is what turns his size from pure durability into a real weakness.
     */
    gravity: 0.58,
    maxFall: 11.6,
    fastFallMul: 1.55,

    fullHopVelocity: -13.2,
    shortHopVelocity: -7.6,
    airJumpVelocity: -12.2,
    airJumps: 1,
    jumpHorizontalBoost: 0.5,

    landFrames: 6,
    helplessLandLag: 26,
  },

  onCreate(f) {
    f.custom.uairLift = false;
  },

  /**
   * Clears the up air's once-per-airtime lift the moment he touches down.
   *
   * Without it the move was its own recovery: every up air gave him half an air
   * jump, so he could throw them back to back and never come down. Tying the
   * boost to a trip off the ground means the *first* one in a jump lifts him
   * and the rest do not, which keeps it a follow-up tool rather than flight.
   */
  onStep(f) {
    if (f.grounded) f.custom.uairLift = false;
  },

  moves: {
    // ------------------------------------------------------- grounded normals
    /**
     * Jab — a 1-2, right then left, with a step behind each punch.
     *
     * Both halves move him forward. He is the slowest fighter on the roster and
     * a jab thrown from a standstill leaves him swinging at air the moment
     * anyone backs off, so the step is not flavour: it is what makes the string
     * connect at all at his speed.
     */
    jab: {
      id: 'jab', name: 'Jab 1', kind: 'ground', total: 24, pose: 'mkPunchR',
      cancelInto: { from: 9, to: 22, attack: 'jab2', special: true },
      movement: [{ frame: 3, vx: 6.4, mode: 'set' }, { frame: 12, vx: 0.4, mode: 'set' }],
      hitboxes: [{
        id: 0, frames: [7, 10],
        shape: { x: 34, y: 74, x2: 92, y2: 70, r: 25 },
        damage: 4, angle: 361, bkb: 20, kbg: 24, effect: 'blunt',
      }],
    },
    jab2: {
      id: 'jab2', name: 'Jab 2', kind: 'ground', total: 34, pose: 'mkPunchL',
      movement: [{ frame: 4, vx: 7.4, mode: 'set' }, { frame: 15, vx: 0.4, mode: 'set' }],
      hitboxes: [{
        id: 0, frames: [9, 13],
        shape: { x: 34, y: 72, x2: 96, y2: 68, r: 26 },
        damage: 7, angle: 361, bkb: 58, kbg: 74, effect: 'blunt',
      }],
    },

    /**
     * Forward tilt — a wide, fast sweep with the **left**.
     *
     * Not a punch. An earlier version unrolled the arm straight out in front
     * and played as "jab 1 but stronger", because that is mechanically what it
     * was. This travels the other way through a much wider arc, locks the elbow
     * out early so the whole back half happens at full stretch, and carries him
     * forward with it — the box reaches 126, half again what the jab does.
     */
    ftilt: {
      id: 'ftilt', name: 'Forward Tilt', kind: 'ground', total: 32, pose: 'mkUnroll',
      // He travels through it. A sweep this wide thrown from a standstill
      // reads as a fighter waving; carrying his weight into it is the energy.
      movement: [{ frame: 4, vx: 5.6, mode: 'set' }, { frame: 13, vx: 0.5, mode: 'set' }],
      hitboxes: [{
        id: 0, frames: [6, 11],
        shape: { x: 26, y: 62, x2: 114, y2: 52, r: 30 },
        damage: 11, angle: 361, bkb: 46, kbg: 88, effect: 'blunt',
      }],
    },

    /**
     * Up tilt — a full uppercut. The box is a **tall capsule running from his
     * waist to well above the helm**, not a puck overhead: the fist sweeps the
     * whole front of him on the way up and the move is supposed to catch
     * someone standing in front as well as someone above.
     */
    utilt: {
      id: 'utilt', name: 'Up Tilt', kind: 'ground', total: 42, pose: 'mkUppercut',
      // Steps under it. The uppercut had almost no horizontal range and this
      // is half of the fix; the other half is the arc itself, in the pose.
      movement: [{ frame: 6, vx: 4.8, mode: 'set' }, { frame: 16, vx: 0.4, mode: 'set' }],
      hitboxes: [
        {
          // The swing itself, front-low up to overhead.
          id: 0, frames: [8, 16],
          shape: { x: 72, y: 24, x2: 58, y2: 128, r: 32 },
          damage: 12.6, angle: 84, bkb: 76, kbg: 80, effect: 'blunt',
        },
        {
          /**
           * A low box running **back through his own feet**.
           *
           * The uppercut starts behind his hip and travels up, so anyone stood
           * against him was inside the arc before it began and the swing passed
           * over them. Only one of these can land — repeat hits are locked per
           * move — so this is coverage, not a second hit.
           */
          id: 1, frames: [8, 16],
          shape: { x: 56, y: 16, x2: -38, y2: 22, r: 30 },
          damage: 12.6, angle: 84, bkb: 76, kbg: 80, effect: 'blunt',
        },
      ],
    },

    /**
     * Down tilt — two slams into the floor, right then left.
     *
     * Two boxes on one move, so it needs  to clear the per-move
     * repeat lock between them; without it only the first slam would ever
     * connect. Both sit **on the deck** rather than in front of him, because
     * the maces come down vertically.
     */
    dtilt: {
      id: 'dtilt', name: 'Down Tilt', kind: 'ground', total: 46, pose: 'mkFloorPound',
      hitboxes: [
        {
          id: 0, frames: [9, 12], rehitRate: 10,
          shape: { x: 24, y: 16, x2: 62, y2: 10, r: 22 },
          damage: 5, angle: 76, setKnockback: 60, hitstun: 18, effect: 'blunt',
        },
        {
          id: 1, frames: [26, 30], rehitRate: 10,
          shape: { x: 24, y: 16, x2: 62, y2: 10, r: 22 },
          damage: 8, angle: 72, bkb: 78, kbg: 74, effect: 'blunt',
        },
      ],
    },

    /**
     * Dash attack — a lunging headbutt, thrown **low**.
     *
     * The answer to a small fighter crouching under everything else he owns:
     * the helm comes down to knee height instead of the maces coming down from
     * above. The box is correspondingly squat and wide rather than tall.
     */
    dashAttack: {
      id: 'dashAttack', name: 'Dash Attack', kind: 'ground', total: 40,
      pose: 'mkHeadbutt', momentum: 1, keepMomentum: true,
      movement: [
        { frame: 1, vx: 9.4, mode: 'set' },
        { frame: 14, vx: 4.0, mode: 'set' },
        { frame: 22, vx: 0.5, mode: 'set' },
      ],
      hitboxes: [{
        id: 0, frames: [8, 14],
        shape: { x: 22, y: 26, x2: 84, y2: 20, r: 30 },
        damage: 13, angle: 62, bkb: 62, kbg: 80, effect: 'blunt',
      }],
    },

    // --------------------------------------------------------------- smashes
    /**
     * Forward smash — both maces driven forward together. His signature.
     *
     * The hardest single hit on the roster, and priced like it: 58 frames long
     * with the box live for five of them. A whiff should be a real loss.
     */
    fsmash: {
      id: 'fsmash', name: 'Forward Smash', kind: 'ground', total: 58,
      pose: 'mkDoubleSmash', charge: { frame: 12, maxFrames: 60 },
      // Steps through it — both arms and his whole weight go the same way.
      movement: [{ frame: 16, vx: 4.2, mode: 'set' }, { frame: 24, vx: 0.4, mode: 'set' }],
      hitboxes: [{
        id: 0, frames: [18, 22],
        shape: { x: 34, y: 92, x2: 106, y2: 66, r: 32 },
        damage: 23, angle: 361, bkb: 38, kbg: 96, effect: 'blunt',
        shieldDamage: 7,
      }],
    },

    /**
     * Up smash — both maces swept up the sides to meet overhead.
     *
     * Three boxes, and the structure is the move: two **scoops** at ankle
     * height on either side that pick a grounded opponent up, and one enormous
     * hit above the helm that they feed into.
     *
     * The interval is **15**, not the gap between the windows. It has to be
     * long enough to outlast the finisher's own hitlag or the finisher lands
     * twice — measured at 9 it hit for 18.4 and then again for 17.4, nearly
     * doubling the move. It also has to be short enough that the scoop's lock
     * has expired by the time the finisher swings, which it is: ten move frames
     * plus the scoop's hitlag comes to about sixteen.
     *
     * The scoops carry `setKnockback` with a long `hitstun` so they hold at any
     * percent — a scoop that scaled would stop linking into the finisher at
     * exactly the percents where the finisher starts killing. And the move
     * needs `rehitRate` to clear the per-move repeat lock between the scoop and
     * the finisher; without it only the scoop would ever land.
     */
    usmash: {
      id: 'usmash', name: 'Up Smash', kind: 'ground', total: 54,
      pose: 'mkUpSmash', charge: { frame: 6, maxFrames: 60 },
      hitboxes: [
        {
          id: 0, frames: [9, 13], rehitRate: 15,
          shape: { x: 34, y: 18, x2: 112, y2: 30, r: 28 },
          damage: 4, angle: 88, setKnockback: 52, hitstun: 22, effect: 'blunt',
        },
        {
          id: 1, frames: [9, 13], rehitRate: 15,
          shape: { x: -34, y: 18, x2: -112, y2: 30, r: 28 },
          damage: 4, angle: 88, setKnockback: 52, hitstun: 22, effect: 'blunt',
        },
        {
          id: 2, frames: [23, 27], rehitRate: 15,
          shape: { x: 44, y: 132, x2: -30, y2: 140, r: 36 },
          damage: 20, angle: 88, bkb: 34, kbg: 86, effect: 'blunt',
        },
      ],
    },

    /**
     * Down smash — both maces into the deck, one either side, on the same
     * frame. The Wizard's shape at his weight: it covers both approaches at
     * once, which is what makes it the option he reaches for when cornered.
     */
    dsmash: {
      id: 'dsmash', name: 'Down Smash', kind: 'ground', total: 56,
      pose: 'mkFloorBoth', charge: { frame: 10, maxFrames: 60 },
      /**
       * The craters. Fired on the frame the maces land, not on contact, so the
       * ground breaks whether or not he actually hit anybody — the move should
       * look like it damaged the stage either way.
       *
       * Two layers doing different jobs: heavy dark clods thrown out low and
       * fast along the deck, and a slower pale dust cloud rising behind them.
       * One alone reads as either a puff of nothing or a shower of pebbles; it
       * is the pairing that reads as impact.
       */
      onFrame(f, frame) {
        if (frame !== 16) return;
        const w = f.world;
        const y = f.y - 4;
        w.camera.addShake(16);
        for (const side of [-1, 1]) {
          const ox = f.x + side * 62;
          // Clods: low, fast, along the ground and away from him.
          for (let i = 0; i < 7; i++) {
            const a = -0.15 - Math.random() * 1.05;      // up and outward
            const sp = 2.4 + Math.random() * 3.6;
            w.spawnEffect({
              x: ox + side * i * 3, y,
              vx: side * Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.2,
              kind: 'smoke', size: 7 + Math.random() * 7, life: 20 + (i % 4) * 4,
              color: i % 3 === 0 ? '#5a4630' : '#7a6244',
              spin: (Math.random() - 0.5) * 10,
            });
          }
          // Dust: slower, paler, rising and spreading.
          for (let i = 0; i < 5; i++) {
            w.spawnEffect({
              x: ox + (Math.random() - 0.5) * 34, y: y - Math.random() * 10,
              vx: side * (0.5 + Math.random() * 1.5), vy: -0.7 - Math.random() * 0.9,
              kind: 'smoke', size: 18 + Math.random() * 16, life: 30 + i * 4,
              color: '#b9ab93',
            });
          }
          w.spawnEffect({ x: ox, y, kind: 'explosion', size: 40, life: 12, color: '#c9b896' });
        }
      },
      hitboxes: [
        {
          id: 0, frames: [16, 21],
          shape: { x: 26, y: 26, x2: 92, y2: 18, r: 26 },
          damage: 17, angle: 40, bkb: 40, kbg: 94, effect: 'blunt',
        },
        {
          id: 1, frames: [16, 20],
          shape: { x: -26, y: 26, x2: -92, y2: 18, r: 26 },
          damage: 17, angle: 40, bkb: 40, kbg: 94,
          awayFromAttacker: true, effect: 'blunt',
        },
      ],
    },


    // ---------------------------------------------------------------- aerials
    /**
     * Neutral air — a belly bash, King K. Rool's shape.
     *
     * One fat box centred on his gut rather than reaching out anywhere: the
     * hitbox *is* his torso, so it wraps him and hits on both sides. `r: 40` on
     * a fighter 82 wide is what makes it a body, not a limb.
     *
     * `momentum: 1` with no movement steps at all — he keeps whatever drift he
     * came in with and the move adds nothing. It is a hitbox he wears, not a
     * lunge.
     */
    nair: {
      id: 'nair', name: 'Neutral Air', kind: 'aerial', total: 34,
      pose: 'mkBellyBash', landingLag: 9, autocancel: [[1, 4], [29, 34]],
      momentum: 1,
      hitboxes: [{
        id: 0, frames: [7, 14],
        shape: { x: 26, y: 70, x2: -18, y2: 56, r: 40 },
        damage: 11, angle: 52, bkb: 56, kbg: 98,
        awayFromAttacker: true, effect: 'blunt',
      }],
    },

    /**
     * Forward air — a big overhand swing thrown downward, with a spike in it.
     *
     * **Three windows, one hit.** Repeat hits are locked per move, so whichever
     * box catches you first is the one that lands and the other two never fire.
     * That is exactly the sweetspot pattern this move wants: catch it early and
     * you get launched forward, catch it in the middle — the frames where the
     * mace is genuinely travelling downward at the bottom of the arc — and you
     * get spiked, catch it late and it is a weak drag-along.
     */
    fair: {
      id: 'fair', name: 'Forward Air', kind: 'aerial', total: 50,
      pose: 'mkAirHammer', landingLag: 14, autocancel: [[1, 5], [45, 50]],
      hitboxes: [
        {
          // Early: the mace coming over the top, out in front and high.
          id: 0, frames: [10, 11],
          shape: { x: 34, y: 98, x2: 74, y2: 76, r: 26 },
          damage: 14, angle: 361, bkb: 34, kbg: 90, effect: 'blunt',
        },
        {
          /**
           * The spike. Only three frames, at the bottom of the arc — this is
           * the reward for timing it, and it should be genuinely hard to land.
           */
          id: 1, frames: [12, 14],
          shape: { x: 30, y: 50, x2: 74, y2: 10, r: 28 },
          damage: 17, angle: 270, bkb: 30, kbg: 78, effect: 'blunt',
        },
        {
          // Late: trailing out of the bottom. Weak, and sends nowhere useful.
          id: 2, frames: [15, 18],
          shape: { x: 24, y: 22, x2: 62, y2: 0, r: 26 },
          damage: 9, angle: 40, bkb: 26, kbg: 62, effect: 'blunt',
        },
      ],
    },

    /**
     * Back air — the backhand, out of a full spin. His cleanest aerial kill.
     */
    bair: {
      id: 'bair', name: 'Back Air', kind: 'aerial', total: 44,
      pose: 'mkSpinBack', landingLag: 11, autocancel: [[1, 5], [39, 44]],
      hitboxes: [{
        id: 0, frames: [16, 20],
        shape: { x: -18, y: 60, x2: -66, y2: 50, r: 30 },
        damage: 15, angle: 361, bkb: 34, kbg: 106,
        awayFromAttacker: true, effect: 'blunt',
      }],
    },

    /**
     * Up air — a 1-2 overhead, right mace then left.
     *
     * The first hit is a link, not a hit: `setKnockback` with a long `hitstun`
     * holds the victim exactly where the second swing is going, at every
     * percent. Growth on the first would break the chain at precisely the
     * percents where the second starts killing.
     *
     * `rehitRate` clears the per-move repeat lock between the two. Set above
     * the second hit's own hitlag so the finisher cannot double-dip — the same
     * trap the up smash fell into.
     */
    uair: {
      id: 'uair', name: 'Up Air', kind: 'aerial', total: 44,
      /**
       * **A small lift, not a stall.**
       *
       * An earlier version killed his vertical for the whole move to keep the
       * two swings level with each other. It worked and it felt dead — he hung
       * in place mid-jump. This gives him about half an air jump's worth of rise
       * instead: enough to carry him up with the swing and keep the 1-2
       * together, without the move becoming a hover.
       */
      onFrame(f, frame) {
        if (frame !== 3 || f.grounded) return;
        // One per trip off the ground — see , which clears it on landing.
        if (f.custom.uairLift) return;
        f.custom.uairLift = true;
        const boost = f.attr.airJumpVelocity * 0.5;
        // Only ever a lift: taken as a floor rather than an assignment so it
        // cannot slow a fighter who is already rising faster than this.
        f.vy = Math.min(f.vy, boost);
      },
      pose: 'mkUpDouble', landingLag: 11, autocancel: [[1, 4], [39, 44]],
      /**
       * **Hangs while it runs.** He is the fastest faller on the roster, and at
       * full gravity he dropped far enough between the two overhead punches that
       * the second missed over the top of whatever the first had set up. A
       * quarter gravity for the length of the move holds him in place long
       * enough for his own combo to work.
       */
      gravityMul: 0.25,
      hitboxes: [
        {
          id: 0, frames: [8, 11], rehitRate: 14,
          shape: { x: 22, y: 118, x2: -6, y2: 150, r: 30 },
          damage: 5, angle: 88, setKnockback: 54, hitstun: 20, effect: 'blunt',
        },
        {
          id: 1, frames: [24, 28], rehitRate: 14,
          shape: { x: 56, y: 118, x2: 20, y2: 152, r: 32 },
          /**
           * **Heavy base knockback, and sent forward.**
           *
           * At bkb 42 and a near-vertical 86 it dropped the victim straight back
           * down onto him, which is what made the move chain into itself over
           * and over. Angling it out to 64 and nearly doubling the base means
           * the first one puts real distance between them at any percent.
           */
          damage: 14, angle: 64, bkb: 80, kbg: 98, effect: 'blunt',
        },
      ],
    },

    /**
     * Down air — **stall-then-fall**, and the first on the roster.
     *
     * His deploy from Clash. He hangs for sixteen frames with both maces over
     * his head, then drops like a dropped anvil and craters the stage.
     *
     * The risk is the whole design. `freefallAfter` means a whiff off the side
     * is simply death, and the hang is long enough to be reacted to — so it is
     * a hard read on the way down rather than a safe approach.
     */
    dair: {
      id: 'dair', name: 'Down Air', kind: 'aerial', total: 60,
      pose: 'mkDeployDrop', landingLag: 26, autocancel: [[1, 3]],
      /** Read by the pose, so the hang and the animation cannot drift apart. */
      stallFrames: 16,
      /**
       * Gravity is off for the hang and then well over doubled for the plunge.
       * Driven here rather than through `movement` steps because the hang has
       * to kill *existing* velocity, not add new velocity — a `set` step would
       * leave him drifting for the frames before it fires.
       */
      gravityMul: 0,
      // Drops at roughly half again his own fast-fall terminal velocity.
      maxFallMul: 1.5,
      onFrame(f, frame) {
        if (frame <= 16) {
          // The hang. Everything stops, including whatever he came in with.
          f.vx = 0; f.vy = 0;
          if (frame === 1) f.world.camera.addShake(4);
          return;
        }
        if (frame === 17) {
          f.vy = 19.0;
          f.vx = 0;
          f.fastFalling = true;
        }
        // Keep driving it down: he should not float on the way, and the plunge
        // has to out-run his own terminal velocity to read as a drop.
        f.vy = Math.min(27, f.vy + 2.2);
        f.vx = 0;
      },
      /**
       * The arrival. Same two-layer debris as the down smash — heavy clods low
       * and fast, pale dust rising behind — but thrown in a full ring rather
       * than two craters, because he lands on top of it rather than beside it.
       *
       * Skipped entirely on an autocancel: catching the very first frames is
       * not an impact and should not shake the screen.
       */
      onLand(f, info) {
        if (info.autocancelled) return;
        const w = f.world;
        const y = f.y - 4;
        w.camera.addShake(26);
        w.spawnEffect({ x: f.x, y, kind: 'explosion', size: 78, life: 16, color: '#c9b896' });
        for (const side of [-1, 1]) {
          for (let i = 0; i < 9; i++) {
            const a = -0.10 - Math.random() * 1.15;
            const sp = 3.0 + Math.random() * 4.4;
            w.spawnEffect({
              x: f.x + side * (10 + i * 4), y,
              vx: side * Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5,
              kind: 'smoke', size: 8 + Math.random() * 9, life: 22 + (i % 5) * 4,
              color: i % 3 === 0 ? '#5a4630' : '#7a6244',
              spin: (Math.random() - 0.5) * 12,
            });
          }
          for (let i = 0; i < 6; i++) {
            w.spawnEffect({
              x: f.x + side * (Math.random() * 52), y: y - Math.random() * 12,
              vx: side * (0.7 + Math.random() * 1.9), vy: -0.8 - Math.random() * 1.1,
              kind: 'smoke', size: 22 + Math.random() * 20, life: 34 + i * 4,
              color: '#b9ab93',
            });
          }
        }
      },
      hitboxes: [
        {
          /**
           * The **spike**, and only for the opening frames of the drop. Catching
           * someone at the very top of the plunge is the hard read, so it is the
           * one that takes them down with him.
           */
          id: 0, frames: [18, 22],
          shape: { x: 30, y: 44, x2: -30, y2: 4, r: 34 },
          damage: 17, angle: 270, bkb: 32, kbg: 74, effect: 'blunt',
        },
        {
          /**
           * The rest of the descent sends **outward**, not down.
           *
           * `awayFromAttacker` mirrors the angle about him, so whoever it
           * catches is thrown out to the side they were standing on rather than
           * everything being flung along his facing. A drop this long spiking
           * for its whole length made it an unmissable kill on anybody below
           * him; sending them away turns the bulk of it into stage control and
           * leaves the spike as the reward for timing.
           */
          id: 1, frames: [23, 52],
          shape: { x: 32, y: 46, x2: -32, y2: 4, r: 36 },
          damage: 14, angle: 42, bkb: 46, kbg: 84,
          awayFromAttacker: true, effect: 'blunt',
        },
      ],
    },


    // --------------------------------------------------------------- specials
    /**
     * A shared crater. The down air, the up B and the down B all arrive the
     * same way, so they all break the ground the same way — `power` scales the
     * whole thing rather than each site tuning its own numbers.
     */

    /**
     * Neutral B — the stomp, and a shockwave that walks away from him.
     *
     * **Three hitboxes in succession, each further out, wider and weaker.** The
     * falloff is the design: the tremor at his feet is the one worth landing and
     * the far edge is a nuisance that pushes people off him. Each ring has its
     * own frame window, and since repeat hits are locked per move nobody is ever
     * caught by two of them — you get the one you were standing in.
     */
    neutralB: {
      id: 'mkStomp', name: 'Seismic Stomp', kind: 'special', total: 48,
      /**
       * Cheap, and it ends almost as soon as the last ring does — the whole
       * point is to act again off the hit. At 66 frames the tail outlived every
       * follow-up he owns.
       */
      cost: 2, costFrame: 16, pose: 'mkStomp',
      /** Read by the pose so the impact and the first ring cannot drift apart. */
      stompFrame: 16,
      /** Off the ground it is a different move entirely — see `mkStompAir`. */
      airVariant: 'mkStompAir',
      onFrame(f, frame) {
        /**
         * The rings, **in front of him only**.
         *
         * A stomp that cracks the ground behind him as well reads as an
         * explosion centred on his feet rather than as a wave leaving them, and
         * it made the move a panic option in both directions. One direction
         * gives it a front to face.
         *
         * The spacing is deliberately slow — nine frames apart rather than
         * five. You should be able to watch the wave coming and get out of its
         * way, which is what makes standing your ground a decision.
         */
        const RINGS = [
          { at: 17, dist: 62, size: 1.0 },
          { at: 26, dist: 138, size: 1.35 },
          { at: 35, dist: 216, size: 1.7 },
        ];
        const r = RINGS.find((x) => x.at === frame);
        if (!r) return;
        const w = f.world;
        w.camera.addShake(frame === 17 ? 18 : 10);
        const ox = f.x + f.facing * r.dist;
        for (let i = 0; i < 8; i++) {
          w.spawnEffect({
            x: ox + (Math.random() - 0.5) * 44 * r.size,
            y: f.y - 4,
            vx: f.facing * (0.4 + Math.random() * 1.6),
            // Thrown straight up: the ground is being lifted, not blown sideways.
            vy: -(3.2 + Math.random() * 3.4),
            kind: 'smoke', size: (7 + Math.random() * 8) * r.size,
            life: 22 + i * 3,
            color: i % 3 === 0 ? '#5a4630' : '#7a6244',
            spin: (Math.random() - 0.5) * 10,
          });
        }
        w.spawnEffect({
          x: ox, y: f.y - 6, kind: 'explosion',
          size: 34 * r.size, life: 12, color: '#c9b896',
        });
      },
      hitboxes: [
        {
          id: 0, frames: [17, 19],
          shape: { x: 22, y: 30, x2: 104, y2: 26, r: 38 },
          /**
           * **Set knockback**, so it launches the same distance at 10% and at
           * 150%. That is what turns it into a confirm: the follow-up is the
           * same read every time rather than only working inside a window of
           * percents.
           *
           * The value is solved against measured travel, not guessed: 62 moved
           * them 66 units — barely their own body — and 120 sends them 255,
           * which is just past twice his height. The two outer rings keep the
           * same falloff.
           */
          damage: 14, angle: 80, setKnockback: 120, hitstun: 26, effect: 'blunt',
        },
        {
          id: 1, frames: [26, 28],
          shape: { x: 92, y: 26, x2: 186, y2: 24, r: 46 },
          damage: 9, angle: 74, setKnockback: 100, hitstun: 22, effect: 'blunt',
        },
        {
          id: 2, frames: [35, 38],
          shape: { x: 166, y: 24, x2: 268, y2: 22, r: 56 },
          damage: 5, angle: 68, setKnockback: 84, hitstun: 18, effect: 'blunt',
        },
      ],
    },

    /**
     * Neutral B in the air — a short stall and a small spike.
     *
     * Not reachable from the move list; `neutralB` routes here when he is off
     * the ground. He hangs for a moment and drives a single mace down, and the
     * box is **deliberately tiny** — this is a precise edgeguard tool, not the
     * ground version's wall of shockwaves, and it should be genuinely hard to
     * land.
     *
     * The stall is what makes it usable at all: it buys the frames to aim, and
     * it doubles as a way to break his own fall for an instant, which a fighter
     * who falls this fast otherwise has no access to.
     */
    mkStompAir: {
      id: 'mkStompAir', name: 'Air Stomp', kind: 'special', total: 40,
      cost: 1, costFrame: 8, pose: 'mkStompAir',
      gravityMul: 0,
      /**
       * **Hangs for the whole animation**, not just the wind-up. It used to drop
       * out of the stall the instant the foot came down, which meant the stall
       * bought nothing — he was falling again before the hitbox had finished.
       * Held to the end it is a genuine hover, and the fall resumes only once
       * the move releases him.
       */
      onFrame(f, frame) {
        f.vy = 0;
        f.vx *= 0.88;
      },
      hitboxes: [{
        // Small, and directly under the driving foot.
        id: 0, frames: [13, 17],
        shape: { x: 20, y: 16, x2: 20, y2: -14, r: 20 },
        damage: 13, angle: 270, bkb: 28, kbg: 74, effect: 'blunt',
      }],
    },

    /**
     * Side B — the hug. A **command grab**, and his answer to shields.
     *
     * Grabs ignore shielding for free, which is the whole reason this exists:
     * everything else he owns can be waited out behind a shield, and this is
     * the move that punishes doing so.
     *
     * `commandGrab` routes a successful catch straight into `mkBodySlam`
     * instead of the normal grab hold — there is no direction to choose and no
     * mashing out of it. It caught you; the slam is what happens.
     */
    sideB: {
      id: 'mkHug', name: 'Mega Hug', kind: 'special', total: 44,
      /**
       * **Cheap to throw, expensive to land.** Three up front so whiffing it is
       * survivable, and the slam charges two more on connect — you pay the real
       * price only for the version that did something. Priced this way round it
       * stays a tool he can use to open, rather than a coin flip he has to save
       * up for.
       */
      cost: 3, costFrame: 8, pose: 'mkHug',
      commandGrab: 'mkBodySlam',
      grabbox: {
        frames: [12, 17],
        shape: { x: 26, y: 88, x2: 84, y2: 44, r: 32 },
      },
    },

    /**
     * The slam itself. Not reachable from the move list — `sideB` starts it on a
     * successful grab.
     *
     * A `throw`, so the shared machinery carries the victim along at his hold
     * offset and launches them on `releaseFrame`; he simply happens to leap
     * across the stage in between. `gravityMul` is doubled so the arc is short
     * and the landing frame is predictable enough to put the release on.
     */
    mkBodySlam: {
      id: 'mkBodySlam', name: 'Body Slam', kind: 'throw', total: 76,
      pose: 'mkBodySlam',
      releaseFrame: 52,
      damage: 18, angle: 42, bkb: 72, kbg: 78,
      gravityMul: 2.0,
      movement: [
        { frame: 9, vy: -24.0, mode: 'set' },
      ],
      onFrame(f, frame) {
        /**
         * The rest of the price, taken on connect. The grab itself paid three;
         * a successful slam is worth five.
         */
        if (frame === 1) f.elixir.spend(2);
        /**
         * **Aimable.** The leap takes its direction from the stick at the
         * moment it fires, so a landed grab can be carried toward the ledge or
         * back to centre instead of always going the same way. Neutral still
         * travels forward — this adds a choice rather than requiring one.
         */
        if (frame === 9) {
          const aim = f.input.x || 0;
          f.vx = (Math.abs(aim) > 0.3 ? Math.sign(aim) : f.facing) * 5.2;
        }
        if (frame !== 52) return;
        crater(f, 1.1);
      },
    },

    /**
     * Up B — the jump attack. Chargeable, and his recovery.
     *
     * Charge on the ground, launch, and come down like the down air with the
     * whole crater. It **sends upward** rather than spiking, which is what
     * separates it from every other way he arrives: this one starts combos
     * instead of ending stocks.
     *
     * `charge.button: 'special'` — a special that charged on the attack button
     * would fight with its own input.
     */
    upB: {
      id: 'mkJump', name: 'Mega Jump', kind: 'special', total: 400,
      cost: 3, costFrame: 12, pose: 'mkLeapSlam',
      charge: { frame: 12, maxFrames: 52, button: 'special' },
      freefallAfter: true,
      /**
       * Grey exhaust while he winds up — the tell that he is holding it. Thin
       * and low, so it reads as pressure building under him rather than as a
       * hit that already happened.
       */
      onChargeFrame(f, charged) {
        /**
         * **Charging in the air holds him up.**
         *
         * The charge freezes the move but not the world, so holding it off the
         * ground simply meant falling for as long as you held it — off the side
         * of the stage, usually fatally. Cancelling gravity exactly (the
         * integrator adds it back the same frame) pins him where he started.
         */
        if (!f.grounded) {
          f.vy = -f.attr.gravity;
          f.vx *= 0.88;
        }
        if (charged % 3) return;
        const w = f.world;
        const k = Math.min(1, charged / 52);
        for (const side of [-1, 1]) {
          w.spawnEffect({
            x: f.x + side * (10 + Math.random() * 26), y: f.y - 6 - Math.random() * 14,
            vx: side * (0.3 + Math.random() * 0.8), vy: -0.5 - Math.random() * 0.8,
            kind: 'smoke', size: 10 + k * 16, life: 20 + k * 12,
            color: '#9aa0a8',
          });
        }
      },
      onFrame(f, frame, ctx) {
        if (frame === 12) {
          /**
           * Height scales with the charge, and so does the damage — held to the
           * cap it is roughly half again the uncharged jump in both.
           */
          const k = Math.min(1, (f.chargeFrames || 0) / 52);
          f.vy = -(15.5 + k * 7.5);
          f.vx = (f.input.x || 0) * 3.4;
          f.grounded = false;
          f.y -= 2;
          ctx.charged = k;
          f.world.camera.addShake(10 + k * 10);
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2;
            f.world.spawnEffect({
              x: f.x + Math.cos(a) * 22, y: f.y - 6,
              vx: Math.cos(a) * 3.0, vy: Math.abs(Math.sin(a)) * -1.2,
              kind: 'smoke', size: 14, life: 20, color: '#9aa0a8',
            });
          }
          return;
        }
        /**
         * The arrival, detected here rather than through `move.onLand`.
         *
         * That hook only fires for aerials and air dodges — specials are
         * deliberately excluded so they play out in full instead of being cut
         * short by the floor. Which means a special that is *supposed* to end on
         * landing has to notice it itself. Measured, the crater simply never
         * appeared until this was moved here.
         */
        /**
         * **The move runs until he arrives**, however long that takes.
         *
         * `total` is a ceiling, not a duration: a fixed length either cut the
         * descent short on a full charge or left him standing in end lag after
         * a short one. Landing and catching the ledge both jump the counter to
         * the tail, so the recovery ends when the recovery is over.
         */
        if (!ctx.landed && f.ledge) {
          ctx.landed = true;
          f.moveFrame = f.move.total - 4;
          return;
        }
        if (!ctx.landed && f.grounded && frame > 13) {
          ctx.landed = true;
          crater(f, 1.25);
          f.moveFrame = f.move.total - 6;
        }
      },
      hitboxes: [
        {
          /**
           * The launch, on the way up — and deliberately weak.
           *
           * ** is what makes the move work.** Repeat hits are locked
           * per move, so catching someone on the rise used to consume the whole
           * move against them and the landing passed straight through. A long
           * interval clears the lock by the time he arrives without letting the
           * rise and the descent double up on each other.
           */
          id: 0, frames: [13, 20], rehitRate: 40,
          shape: { x: 34, y: 120, x2: -34, y2: 60, r: 38 },
          damage: 8, angle: 88, bkb: 40, kbg: 66, effect: 'blunt',
        },
        {
          /**
           * **The shockwave, and the reason to throw this at all.**
           *
           * Fires on the frames the landing branch jumps the counter to, so it
           * is exactly synchronised with the crater without needing to know how
           * long he was in the air. Wide and low, and it is the only part of the
           * move that hits hard — the flight is a delivery system.
           *
           * **Nothing hits on the way down.** A descent box made the heavy
           * landing nearly impossible to land: anyone the descent caught was
           * launched clear before he arrived, and anyone it missed had already
           * moved. A weak window going up and a heavy one on arrival is the
           * whole move.
           */
          id: 1, frames: [394, 397], rehitRate: 40,
          shape: { x: 108, y: 34, x2: -108, y2: 30, r: 46 },
          damage: 20, angle: 86, bkb: 58, kbg: 98,
          awayFromAttacker: true, effect: 'blunt',
        },
      ],
    },

    /**
     * Down B — the cannonball. **Instantly breaks shield.**
     *
     * Two entries into the same fall. From the air it is a stall-then-fall like
     * the down air, only tighter and squared to the camera. From the ground he
     * vaults *forward* first and then drops out of it, which turns the same
     * button into an approach.
     *
     * `shieldDamage: 60` against a 50-point shield is a guaranteed break on
     * contact, whatever is left of it. That is what he gets for a move this
     * committal — it is slow, it is telegraphed, and whiffing it in the air is
     * a free punish.
     */
    downB: {
      id: 'mkCannon', name: 'Cannonball', kind: 'special', total: 96,
      cost: 3, costFrame: 10, pose: 'mkCannonDrop',
      freefallAfter: true,
      /** Read by the pose, so the hang and the curl stay in step. */
      stallFrames: 14,
      gravityMul: 0,
      maxFallMul: 1.45,
      onFrame(f, frame, ctx) {
        if (frame === 1) ctx.fromGround = f.grounded;

        /**
         * **The plunge is gated on reaching the top of the arc, not on a frame
         * number.** The airborne version has a fixed hang because nothing is
         * moving; the grounded vault does not, because how long it takes to
         * peak is physics. An earlier version used one fixed window for both
         * and it cut the vault off on the way up — measured, the grounded
         * branch topped out at 121 against the 201 it was supposed to match.
         */
        if (!ctx.plunging) {
          if (ctx.fromGround) {
            if (frame === 6) {
              f.vy = -15.5;
              f.vx = 8.2 * f.facing;
              f.grounded = false;
              f.y -= 2;
              f.world.camera.addShake(10);
            }
            // Gravity is off for the whole move, so the arc is hand-rolled —
            // at his own 0.58, so it reaches an uncharged Up B height.
            if (frame > 6) f.vy += 0.58;
            if (frame > 8 && f.vy >= 0) ctx.plunging = true;
            if (!ctx.plunging) return;
          } else {
            // Airborne: everything stops for the hang, then he drops.
            if (frame <= 14) { f.vx = 0; f.vy = 0; return; }
            ctx.plunging = true;
          }
        }

        if (!ctx.kicked) { ctx.kicked = true; f.vy = Math.max(f.vy, 17.0); f.fastFalling = true; }
        f.vy = Math.min(26, f.vy + 2.0);
        f.vx *= 0.86;
        // Specials never land-cancel, so the crater is triggered from here
        // rather than through .
        if (!ctx.landed && f.grounded) {
          ctx.landed = true;
          crater(f, 1.15);
          // Much less end lag: the move was carrying a long tail sized for the
          // worst-case fall and he stood in the rest of it after a short one.
          f.moveFrame = f.move.total - 10;
        }
      },
      hitboxes: [
        {
          /**
           * **The scoop**, live across the grounded vault only.
           *
           * The angle is **forward, not up**. Sent skyward they simply stayed
           * behind while he vaulted 250 past them and the impact landed on
           * nothing; thrown along his own arc they arrive where he does. The
           * long hitstun is what keeps them there once they do.  clears the per-move lock
           * so the same victim can be caught by both.
           */
          id: 0, frames: [6, 15], rehitRate: 30,
          shape: { x: 40, y: 96, x2: -20, y2: 10, r: 40 },
          damage: 6, angle: 44, setKnockback: 96, hitstun: 46, effect: 'blunt',
        },
        {
          id: 1, frames: [16, 88], rehitRate: 30,
          shape: { x: 34, y: 50, x2: -34, y2: 4, r: 38 },
          damage: 19, angle: 50, bkb: 58, kbg: 96,
          shieldDamage: 60, awayFromAttacker: true, effect: 'blunt',
        },
      ],
    },


    // ----------------------------------------------------------------- throws
    dthrow: {
      id: 'dthrow', name: 'Down Throw', kind: 'throw',
      total: 44, releaseFrame: 19,
      damage: 8, angle: 78, bkb: 72, kbg: 96,
    },
    uthrow: {
      id: 'uthrow', name: 'Up Throw', kind: 'throw',
      total: 38, releaseFrame: 16,
      damage: 9, angle: 90, bkb: 70, kbg: 108,
    },
    bthrow: {
      id: 'bthrow', name: 'Back Throw', kind: 'throw',
      total: 44, releaseFrame: 21, reverse: true,
      damage: 13, angle: 40, bkb: 48, kbg: 112,
    },
    fthrow: {
      id: 'fthrow', name: 'Forward Throw', kind: 'throw',
      total: 40, releaseFrame: 17,
      damage: 11, angle: 45, bkb: 52, kbg: 92,
    },

    taunt: {
      id: 'taunt', name: 'Taunt', kind: 'ground', total: 60,
      onStart(f) {
        f.world.spawnEffect({
          x: f.x, y: f.y - f.def.height - 24,
          kind: 'taunt', size: 24, life: 44, color: '#3b7ddd',
        });
      },
    },
  },
};
