import { segmentDistanceSq } from '../core/math.js';

/**
 * Hitboxes and hurtboxes are capsules — a segment with a radius. Capsules give
 * fighting-game-appropriate coverage for limbs and swings without the cost or
 * authoring pain of polygons.
 *
 * Authoring convention (fighter-local space):
 *   x  -> forward, in the direction the fighter faces
 *   y  -> UP (positive is above the fighter's feet)
 *
 * World space is screen space (y grows downward), so the transform flips y.
 * Authoring moves with y-up keeps the data files readable.
 */

/**
 * Converts a locally-authored capsule into world space.
 * @param {{x:number,y:number,x2?:number,y2?:number,r:number}} local
 * @param {number} originX fighter x (centre)
 * @param {number} originY fighter y (feet)
 * @param {number} facing +1 or -1
 */
export function toWorld(local, originX, originY, facing) {
  const x2 = local.x2 !== undefined ? local.x2 : local.x;
  const y2 = local.y2 !== undefined ? local.y2 : local.y;
  return {
    x: originX + local.x * facing,
    y: originY - local.y,
    x2: originX + x2 * facing,
    y2: originY - y2,
    r: local.r,
  };
}

/** Capsule vs capsule overlap. */
export function capsulesOverlap(a, b) {
  const rr = a.r + b.r;
  return segmentDistanceSq(a.x, a.y, a.x2, a.y2, b.x, b.y, b.x2, b.y2) <= rr * rr;
}

/** Midpoint of a capsule, used for effect spawn positions. */
export function capsuleCenter(c) {
  return { x: (c.x + c.x2) / 2, y: (c.y + c.y2) / 2 };
}

/** Axis-aligned bounds of a capsule, for broad-phase rejection. */
export function capsuleBounds(c) {
  return {
    minX: Math.min(c.x, c.x2) - c.r,
    maxX: Math.max(c.x, c.x2) + c.r,
    minY: Math.min(c.y, c.y2) - c.r,
    maxY: Math.max(c.y, c.y2) + c.r,
  };
}

export function boundsOverlap(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** Point inside a capsule. */
export function pointInCapsule(px, py, c) {
  return segmentDistanceSq(px, py, px, py, c.x, c.y, c.x2, c.y2) <= c.r * c.r;
}

/** Circle vs capsule, for projectiles. */
export function circleHitsCapsule(cx, cy, r, cap) {
  const rr = r + cap.r;
  return segmentDistanceSq(cx, cy, cx, cy, cap.x, cap.y, cap.x2, cap.y2) <= rr * rr;
}
