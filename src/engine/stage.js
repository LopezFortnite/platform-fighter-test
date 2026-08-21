import { LEDGE } from '../config/gameplay.js';

/**
 * Stage geometry and collision.
 *
 * Two platform kinds, matching the competitive layout the design document
 * describes ("a main flat ground with ledge grab points at both ends, and
 * between 0-3 floating platforms"):
 *
 *   solid — collides on every face, and carries grabbable ledges at its corners
 *   soft  — collides only from above, and can be dropped through
 */
export class Stage {
  constructor(def) {
    this.def = def;
    this.name = def.name;
    this.platforms = def.platforms.map((p, i) => ({ ...p, index: i }));
    this.blastZones = def.blastZones;
    this.spawns = def.spawns;
    this.respawnX = def.respawnX !== undefined ? def.respawnX : 0;
    this.ledges = [];

    for (const p of this.platforms) {
      if (p.type !== 'solid' || p.ledges === false) continue;
      this.ledges.push({ x: p.x, y: p.y, dir: -1, platform: p, occupant: null });
      this.ledges.push({ x: p.x + p.w, y: p.y, dir: 1, platform: p, occupant: null });
    }
  }

  /** True when the point is outside the blast zones. */
  isOutOfBounds(x, y) {
    const b = this.blastZones;
    return x < b.left || x > b.right || y < b.top || y > b.bottom;
  }

  /** Which blast zone was crossed, for KO direction effects. */
  blastSide(x, y) {
    const b = this.blastZones;
    if (y > b.bottom) return 'bottom';
    if (y < b.top) return 'top';
    if (x < b.left) return 'left';
    return 'right';
  }

  /**
   * Resolves a fighter against the geometry.
   *
   * The fighter is treated as an axis-aligned box whose origin is its feet.
   * Vertical resolution runs first so that landing takes priority over a wall
   * graze, which is what makes platform landings feel clean.
   *
   * @param {object} f fighter-like: { x, y, vx, vy, halfWidth, height, prevY, prevX, dropThroughTimer, grounded }
   * @returns {{grounded:boolean, platform:object|null, hitCeiling:boolean, hitWall:number}}
   */
  resolve(f) {
    const result = { grounded: false, platform: null, hitCeiling: false, hitWall: 0 };
    const left = f.x - f.halfWidth;
    const right = f.x + f.halfWidth;
    const head = f.y - f.height;

    for (const p of this.platforms) {
      const withinX = right > p.x && left < p.x + p.w;
      if (!withinX) continue;

      const isSoft = p.type === 'soft';

      // --- Landing on top ---
      if (f.vy >= 0 && f.prevY <= p.y + 1 && f.y >= p.y) {
        const droppingThrough = isSoft && f.dropThroughTimer > 0;
        const passingUp = isSoft && f.prevY > p.y;
        if (!droppingThrough && !passingUp) {
          f.y = p.y;
          f.vy = 0;
          result.grounded = true;
          result.platform = p;
          continue;
        }
      }

      if (isSoft) continue;

      // --- Solid platform: ceiling and walls ---
      const overlapsY = f.y > p.y && head < p.y + p.h;
      if (!overlapsY) continue;

      if (f.vy < 0 && f.prevY - f.height >= p.y + p.h - 1) {
        f.y = p.y + p.h + f.height;
        f.vy = 0;
        result.hitCeiling = true;
        continue;
      }

      // Wall push-out, resolved on the shallower axis.
      const penLeft = right - p.x;
      const penRight = p.x + p.w - left;
      if (penLeft > 0 && penLeft <= penRight) {
        f.x = p.x - f.halfWidth;
        if (f.vx > 0) f.vx = 0;
        result.hitWall = 1;
      } else if (penRight > 0) {
        f.x = p.x + p.w + f.halfWidth;
        if (f.vx < 0) f.vx = 0;
        result.hitWall = -1;
      }
    }

    return result;
  }

  /** True if a solid surface sits directly under the fighter (used to leave the ground). */
  groundUnder(f, tolerance = 2) {
    for (const p of this.platforms) {
      if (f.x + f.halfWidth <= p.x || f.x - f.halfWidth >= p.x + p.w) continue;
      if (Math.abs(f.y - p.y) <= tolerance) return p;
    }
    return null;
  }

  /**
   * Finds a grabbable ledge for a fighter.
   * A ledge is grabbable when the fighter is airborne, descending (or in
   * special fall), positioned outside the stage lip, and not locked out.
   */
  findLedge(f) {
    if (f.grounded || f.vy < 0) return null;
    if (f.ledgeLockout > 0) return null;

    const px = f.x;
    const py = f.y - f.height * 0.55; // chest height

    for (const ledge of this.ledges) {
      if (ledge.occupant && ledge.occupant !== f) {
        if (!LEDGE.TRUMP_ENABLED) continue;
      }
      const outward = ledge.dir;
      // The fighter must be on the outside of the lip: no grabbing from on-stage.
      if (outward === -1 && px > ledge.x + 10) continue;
      if (outward === 1 && px < ledge.x - 10) continue;

      /**
       * The grab box has to reach at least as far out as the fighter can
       * physically be.
       *
       * A fighter hugging the wall is pushed clear of it by their own half
       * width — so a wide one comes to rest further out than a narrow one, for
       * reasons that have nothing to do with how they are recovering. At the
       * flat 34 the Mega Knight could never grab a ledge with *any* move: his
       * half width is 41, the side collision parked him at exactly 41, and the
       * box stopped seven units short of where he was standing. Measured, the
       * check flipped from true to false on the single frame the collision
       * resolved.
       *
       * Widening it by the body means every fighter gets the same reach
       * relative to the wall they are actually against, and nothing changes for
       * anyone the old constant already covered.
       */
      const outset = Math.max(LEDGE.BOX_OUTSET, f.halfWidth + 6);
      const minX = outward === -1 ? ledge.x - outset : ledge.x - 10;
      const maxX = outward === -1 ? ledge.x + 10 : ledge.x + outset;
      if (px < minX || px > maxX) continue;
      if (py < ledge.y - 26 || py > ledge.y + LEDGE.BOX_HEIGHT) continue;

      return ledge;
    }
    return null;
  }

  /**
   * Position a hanging fighter's feet so the body reads as gripping the lip.
   * Scaled by the fighter's height so every character hangs with its head the
   * same distance below the edge.
   */
  hangPosition(ledge, height) {
    return {
      x: ledge.x + LEDGE.HANG_OFFSET_X * ledge.dir,
      y: ledge.y + height * LEDGE.HANG_DROP_RATIO,
    };
  }

  /** Nearest platform surface below a point, for AI and effects. */
  surfaceBelow(x, y) {
    let best = null;
    for (const p of this.platforms) {
      if (x < p.x || x > p.x + p.w) continue;
      if (p.y < y) continue;
      if (!best || p.y < best.y) best = p;
    }
    return best;
  }
}
