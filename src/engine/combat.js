import { KNOCKBACK, HITLAG, SHIELD, STALE } from '../config/gameplay.js';
import { clamp, toRad } from '../core/math.js';

/**
 * Pure combat math. No knowledge of fighters, states or rendering — it takes
 * numbers and returns numbers, which keeps it trivially testable and lets the
 * whole feel of the game be tuned from config.
 */

/** Sakurai angle. Grounded targets slide at low knockback, launch at ~44° once it's high. */
export const SAKURAI_ANGLE = 361;

/**
 * Resolves a special angle value into concrete degrees.
 * @param {number} angle raw angle from the hitbox definition
 * @param {number} knockback computed knockback magnitude
 * @param {boolean} grounded whether the victim is on the ground
 */
export function resolveAngle(angle, knockback, grounded) {
  if (angle !== SAKURAI_ANGLE) return angle;
  if (!grounded) return 44;
  if (knockback < 60) return 0;
  if (knockback > 88) return 40;
  return ((knockback - 60) / 28) * 40;
}

/**
 * Ultimate's knockback formula.
 *
 *   KB = ((((p/10 + p*d/20) * (200/(w+100)) * 1.4) + 18) * (kbg/100)) + bkb
 *
 * `percent` must already include the damage from this hit.
 */
export function computeKnockback({ percent, damage, weight, bkb, kbg, rageBonus = 0 }) {
  const K = KNOCKBACK;
  const p = percent;
  const base = (p / K.PERCENT_DIV + (p * damage) / K.PRODUCT_DIV)
    * (K.WEIGHT_NUM / (weight + K.WEIGHT_OFF))
    * K.SCALE
    + K.CONSTANT;
  const kb = base * (kbg / 100) + bkb;
  return Math.max(0, kb * (1 + rageBonus));
}

/** Rage: a fighter at high percent launches opponents further. */
export function rageBonus(attackerPercent) {
  if (!KNOCKBACK.RAGE_ENABLED) return 0;
  const t = clamp(attackerPercent / KNOCKBACK.RAGE_MAX_PERCENT, 0, 1);
  return t * KNOCKBACK.RAGE_MAX_BONUS;
}

/** Hitstun duration in frames for a given knockback. */
export function hitstunFrames(knockback) {
  return Math.floor(knockback * KNOCKBACK.HITSTUN_PER_KB);
}

/** Freeze frames applied to both fighters on connect. */
export function hitlagFrames(damage, isShield = false) {
  const raw = damage * HITLAG.MUL + HITLAG.BASE;
  return Math.min(HITLAG.MAX, Math.floor(raw * (isShield ? HITLAG.SHIELD_MUL : 1)));
}

/** Frames the defender is locked in shieldstun. */
export function shieldstunFrames(damage) {
  return Math.floor(damage * SHIELD.STUN_MUL + SHIELD.STUN_BASE);
}

/**
 * Converts knockback + angle into a launch velocity, applying the victim's
 * directional influence.
 *
 * @param {number} knockback
 * @param {number} angleDeg launch angle, 0 = right, 90 = up (math convention)
 * @param {number} facing attacker facing (+1 right, -1 left)
 * @param {{x:number,y:number}} di victim stick input (screen space, y down)
 * @returns {{vx:number, vy:number, angle:number}} velocity in screen space
 */
export function launchVelocity(knockback, angleDeg, facing, di) {
  let angle = toRad(angleDeg);
  // Mirror the angle for a left-facing attacker so hitboxes are authored once.
  if (facing < 0) angle = Math.PI - angle;

  if (di && (di.x !== 0 || di.y !== 0)) {
    const lx = Math.cos(angle), ly = Math.sin(angle);
    // Stick arrives in screen space (y down); flip into math space.
    const sx = di.x, sy = -di.y;
    // Cross product gives the component of DI perpendicular to the launch.
    const cross = clamp(lx * sy - ly * sx, -1, 1);
    angle += KNOCKBACK.DI_MAX_ROTATION * cross * Math.abs(cross);
  }

  const speed = knockback * KNOCKBACK.SPEED_PER_KB;
  return { vx: Math.cos(angle) * speed, vy: -Math.sin(angle) * speed, angle };
}

/**
 * Staling. Each fighter keeps a queue of recently landed moves; repeats do
 * less damage and knockback, which discourages spamming one kill move.
 */
export class StaleQueue {
  constructor() { this.queue = []; }

  multiplier(moveId) {
    if (!STALE.ENABLED) return 1;
    const count = this.queue.filter((m) => m === moveId).length;
    if (count === 0) return STALE.FRESH_BONUS;
    return STALE.MULTIPLIERS[Math.min(count, STALE.MULTIPLIERS.length - 1)];
  }

  push(moveId) {
    if (!STALE.ENABLED) return;
    this.queue.unshift(moveId);
    if (this.queue.length > STALE.QUEUE_SIZE) this.queue.pop();
  }

  /** Landing a KO refreshes the whole queue, as in Ultimate. */
  clear() { this.queue.length = 0; }
}
