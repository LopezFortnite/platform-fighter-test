import { DEFENSE, LEDGE, GRAB } from '../config/gameplay.js';

/**
 * Actions every fighter shares: dodges, rolls, air dodges, techs, getups,
 * ledge options and the grab. They are built per-fighter so hitbox reach and
 * roll distance scale with the character's size, and any of them can be
 * overridden in a fighter's data file.
 *
 * Move schema (see also src/data/fighters/*.js):
 *   id, name, kind, total, cost
 *   costFrame: frame the Elixir is actually charged on — the frame the move
 *              delivers. Defaults to the first active hitbox, then to 1.
 *   hitboxes: [{ id, frames:[s,e], shape:{x,y,x2,y2,r}, damage, angle, bkb, kbg, ... }]
 *   intangible / invincible: [startFrame, endFrame]
 *   movement: [{ frame, vx?, vy?, mode:'set'|'add' }]
 *   freefallAfter, landingLag, autocancel, onStart/onFrame/onEnd/onHit
 */
export function createUniversalMoves(def) {
  const reach = def.reach || 1;
  // Shared moves borrow the fighter's hit type, so a getup or ledge attack
  // sparks like the rest of its moveset rather than always reading as a blade.
  const hit = def.hitEffect || 'slash';
  const h = def.height;
  const mid = h * 0.5;

  return {
    spotdodge: {
      id: 'spotdodge', name: 'Spot Dodge', kind: 'dodge',
      total: DEFENSE.SPOTDODGE.total,
      intangible: DEFENSE.SPOTDODGE.intangible,
      movement: [{ frame: 1, vx: 0, mode: 'set' }],
    },

    rollForward: {
      id: 'rollForward', name: 'Forward Roll', kind: 'roll',
      total: DEFENSE.ROLL.total,
      intangible: DEFENSE.ROLL.intangible,
      travel: { frames: [3, 20], distance: DEFENSE.ROLL.distance, dir: 1 },
    },

    rollBack: {
      id: 'rollBack', name: 'Back Roll', kind: 'roll',
      total: DEFENSE.ROLL.total,
      intangible: DEFENSE.ROLL.intangible,
      travel: { frames: [3, 20], distance: DEFENSE.ROLL.distance, dir: -1 },
    },

    airdodgeNeutral: {
      id: 'airdodgeNeutral', name: 'Air Dodge', kind: 'airdodge',
      total: DEFENSE.AIRDODGE_NEUTRAL.total,
      intangible: DEFENSE.AIRDODGE_NEUTRAL.intangible,
      landingLag: DEFENSE.AIRDODGE_NEUTRAL.landingLag,
      gravityMul: 0.32,
      movement: [{ frame: 1, vx: 0, vy: 0, mode: 'set' }],
    },

    airdodgeDirectional: {
      id: 'airdodgeDirectional', name: 'Directional Air Dodge', kind: 'airdodge',
      total: DEFENSE.AIRDODGE_DIRECTIONAL.total,
      intangible: DEFENSE.AIRDODGE_DIRECTIONAL.intangible,
      landingLag: DEFENSE.AIRDODGE_DIRECTIONAL.landingLag,
      gravityMul: 0.28,
      directionalBurst: DEFENSE.AIRDODGE_DIRECTIONAL.speed,
      burstDecay: DEFENSE.AIRDODGE_DIRECTIONAL.burstDecay,
    },

    techInPlace: {
      id: 'techInPlace', name: 'Tech', kind: 'tech',
      total: DEFENSE.TECH_IN_PLACE.total,
      intangible: DEFENSE.TECH_IN_PLACE.intangible,
      movement: [{ frame: 1, vx: 0, vy: 0, mode: 'set' }],
    },

    techRollForward: {
      id: 'techRollForward', name: 'Tech Roll', kind: 'tech',
      total: DEFENSE.TECH_ROLL.total,
      intangible: DEFENSE.TECH_ROLL.intangible,
      travel: { frames: [2, 22], distance: DEFENSE.TECH_ROLL.distance, dir: 1 },
    },

    techRollBack: {
      id: 'techRollBack', name: 'Tech Roll', kind: 'tech',
      total: DEFENSE.TECH_ROLL.total,
      intangible: DEFENSE.TECH_ROLL.intangible,
      travel: { frames: [2, 22], distance: DEFENSE.TECH_ROLL.distance, dir: -1 },
    },

    getup: {
      id: 'getup', name: 'Get Up', kind: 'getup',
      total: DEFENSE.GETUP.total,
      intangible: DEFENSE.GETUP.intangible,
    },

    getupRollForward: {
      id: 'getupRollForward', name: 'Getup Roll', kind: 'getup',
      total: DEFENSE.GETUP_ROLL.total,
      intangible: DEFENSE.GETUP_ROLL.intangible,
      travel: { frames: [4, 24], distance: DEFENSE.GETUP_ROLL.distance, dir: 1 },
    },

    getupRollBack: {
      id: 'getupRollBack', name: 'Getup Roll', kind: 'getup',
      total: DEFENSE.GETUP_ROLL.total,
      intangible: DEFENSE.GETUP_ROLL.intangible,
      travel: { frames: [4, 24], distance: DEFENSE.GETUP_ROLL.distance, dir: -1 },
    },

    getupAttack: {
      id: 'getupAttack', name: 'Getup Attack', kind: 'getup',
      total: DEFENSE.GETUP_ATTACK.total,
      intangible: DEFENSE.GETUP_ATTACK.intangible,
      hitboxes: [
        {
          id: 0, frames: [19, 22],
          shape: { x: 58 * reach, y: mid * 0.5, x2: 10, y2: mid * 0.6, r: 30 },
          damage: 7, angle: 361, bkb: 60, kbg: 45, effect: hit,
        },
        {
          id: 1, frames: [23, 26],
          shape: { x: -58 * reach, y: mid * 0.5, x2: -10, y2: mid * 0.6, r: 30 },
          damage: 7, angle: 361, bkb: 60, kbg: 45, effect: hit,
        },
      ],
    },

    // --- Ledge options -----------------------------------------------------
    ledgeGetup: {
      id: 'ledgeGetup', name: 'Ledge Getup', kind: 'ledge',
      total: LEDGE.GETUP.total,
      intangible: LEDGE.GETUP.intangible,
      ledgeClimb: { frame: LEDGE.GETUP.total - 6 },
    },

    ledgeRoll: {
      id: 'ledgeRoll', name: 'Ledge Roll', kind: 'ledge',
      total: LEDGE.ROLL.total,
      intangible: LEDGE.ROLL.intangible,
      ledgeClimb: { frame: 10, extra: LEDGE.ROLL.distance },
    },

    ledgeJump: {
      id: 'ledgeJump', name: 'Ledge Jump', kind: 'ledge',
      total: LEDGE.JUMP.total,
      intangible: LEDGE.JUMP.intangible,
      ledgeRelease: { frame: 2, vy: LEDGE.JUMP.vy, vx: LEDGE.JUMP.vx },
    },

    ledgeAttack: {
      id: 'ledgeAttack', name: 'Ledge Attack', kind: 'ledge',
      total: LEDGE.ATTACK.total,
      intangible: LEDGE.ATTACK.intangible,
      ledgeClimb: { frame: 16 },
      hitboxes: [{
        id: 0, frames: [21, 25],
        shape: { x: 20, y: mid * 0.55, x2: 74 * reach, y2: mid * 0.5, r: 28 },
        damage: 9, angle: 361, bkb: 70, kbg: 48, effect: hit,
      }],
    },

    // --- Grab --------------------------------------------------------------
    grab: {
      id: 'grab', name: 'Grab', kind: 'grab',
      total: 34,
      grabbox: {
        frames: [6, 8],
        shape: { x: 26, y: mid * 0.95, x2: 66 * reach, y2: mid * 0.9, r: 24 },
      },
    },

    dashGrab: {
      id: 'dashGrab', name: 'Dash Grab', kind: 'grab',
      total: 42,
      momentum: 0.55,
      grabbox: {
        frames: [8, 11],
        shape: { x: 30, y: mid * 0.95, x2: 78 * reach, y2: mid * 0.9, r: 26 },
      },
    },

    pummel: {
      id: 'pummel', name: 'Pummel', kind: 'pummel',
      total: GRAB.PUMMEL_FRAMES,
      damage: GRAB.PUMMEL_DAMAGE,
    },

    // Throws. Damage/knockback here are the shared baseline; heavies and
    // combo characters override them in their own data files.
    //
    // Throws are deliberately low-base/high-growth. The opposite (high base,
    // low growth) produces a flat curve that pops the opponent the same
    // distance at 20% and 180%, which makes throws feel dead at kill percent.
    // Down throw is the exception: it stays weak on purpose so it keeps the
    // opponent close enough to combo.
    fthrow: {
      id: 'fthrow', name: 'Forward Throw', kind: 'throw',
      total: 34, releaseFrame: 14,
      damage: 8, angle: 45, bkb: 46, kbg: 98,
    },
    /**
     * `reverse` already flips the launch to point behind the thrower, so the
     * angle is measured in that reversed frame and reads like a forward throw's
     * — 45 is up-and-away. Writing a rear-facing angle here as well reverses it
     * twice and the back throw sends them forwards, which is exactly what it
     * used to do.
     */
    bthrow: {
      id: 'bthrow', name: 'Back Throw', kind: 'throw',
      total: 38, releaseFrame: 18, reverse: true,
      damage: 9, angle: 45, bkb: 40, kbg: 124,
    },
    uthrow: {
      id: 'uthrow', name: 'Up Throw', kind: 'throw',
      total: 32, releaseFrame: 13,
      damage: 7, angle: 88, bkb: 40, kbg: 116,
    },
    dthrow: {
      id: 'dthrow', name: 'Down Throw', kind: 'throw',
      total: 38, releaseFrame: 16,
      damage: 6, angle: 78, bkb: 42, kbg: 70,
    },
  };
}
