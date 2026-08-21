/** Small math helpers shared across systems. */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const toRad = (deg) => (deg * Math.PI) / 180;
export const toDeg = (rad) => (rad * 180) / Math.PI;

/** Moves `v` toward `target` by at most `step`. */
export function approach(v, target, step) {
  if (v < target) return Math.min(v + step, target);
  if (v > target) return Math.max(v - step, target);
  return target;
}

/**
 * Squared distance between two segments (capsule cores).
 * Capsule overlap is then simply `d2 <= (r1 + r2)^2`.
 */
export function segmentDistanceSq(ax, ay, bx, by, cx, cy, dx, dy) {
  const ux = bx - ax, uy = by - ay;
  const vx = dx - cx, vy = dy - cy;
  const wx = ax - cx, wy = ay - cy;

  const a = ux * ux + uy * uy;
  const b = ux * vx + uy * vy;
  const c = vx * vx + vy * vy;
  const d = ux * wx + uy * wy;
  const e = vx * wx + vy * wy;
  const D = a * c - b * b;

  let sc, sN, sD = D;
  let tc, tN, tD = D;
  const EPS = 1e-8;

  if (D < EPS) {
    sN = 0; sD = 1; tN = e; tD = c;
  } else {
    sN = b * e - c * d;
    tN = a * e - b * d;
    if (sN < 0) { sN = 0; tN = e; tD = c; }
    else if (sN > sD) { sN = sD; tN = e + b; tD = c; }
  }

  if (tN < 0) {
    tN = 0;
    if (-d < 0) sN = 0;
    else if (-d > a) sN = sD;
    else { sN = -d; sD = a; }
  } else if (tN > tD) {
    tN = tD;
    if (-d + b < 0) sN = 0;
    else if (-d + b > a) sN = sD;
    else { sN = -d + b; sD = a; }
  }

  sc = Math.abs(sN) < EPS ? 0 : sN / sD;
  tc = Math.abs(tN) < EPS ? 0 : tN / tD;

  const px = wx + sc * ux - tc * vx;
  const py = wy + sc * uy - tc * vy;
  return px * px + py * py;
}

/** Axis-aligned rectangle overlap. */
export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** True when `frame` falls inside an inclusive [start, end] window. */
export const inWindow = (frame, window) => !!window && frame >= window[0] && frame <= window[1];

/** Deterministic PRNG so replays and repeated tests behave identically. */
export function makeRandom(seed = 0x2f6e2b1) {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0xffffffff;
  };
}
