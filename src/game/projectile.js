/**
 * Projectiles.
 *
 * Zoners are an archetype in the design document ("fighters whose move sets are
 * based around a projectile"), so projectiles are a first-class entity rather
 * than a special case of a hitbox: they persist past their move, travel, can be
 * destroyed by other projectiles, and can be shielded independently.
 */
export class Projectile {
  constructor(owner, opts) {
    this.owner = owner;
    this.team = owner.playerIndex;

    this.x = opts.x;
    this.y = opts.y;
    this.vx = opts.vx || 0;
    this.vy = opts.vy || 0;
    this.gravity = opts.gravity || 0;
    this.radius = opts.radius || 14;
    this.life = opts.life || 90;
    this.age = 0;
    this.dead = false;

    this.damage = opts.damage || 5;
    this.angle = opts.angle !== undefined ? opts.angle : 361;
    this.bkb = opts.bkb || 30;
    this.kbg = opts.kbg || 60;
    this.facing = opts.facing !== undefined ? opts.facing : owner.facing;
    this.effect = opts.effect || 'none';
    this.moveId = opts.moveId || 'projectile';

    /** Hits per target and total, so piercing shots are just data. */
    this.maxHits = opts.maxHits || 1;
    this.hitsRemaining = this.maxHits;
    this.rehitRate = opts.rehitRate || 0;
    this.hitTargets = new Map();

    this.destroyOnHit = opts.destroyOnHit !== false;
    this.destroyOnGround = opts.destroyOnGround !== false;
    this.destroyOnShield = opts.destroyOnShield !== false;
    /** Projectile "HP" — a stronger shot beats a weaker one head-on. */
    this.priority = opts.priority !== undefined ? opts.priority : this.damage;
    this.collidesWithProjectiles = opts.collidesWithProjectiles !== false;

    this.color = opts.color || '#ffd166';
    this.trail = opts.trail !== false;
    this.trailPoints = [];
    this.shape = opts.shape || 'circle';
    this.spin = opts.spin || 0;
    this.rotation = 0;

    this.onStepFn = opts.onStep || null;
    this.onHitFn = opts.onHit || null;
    this.onExpireFn = opts.onExpire || null;
    this.data = opts.data || {};
  }

  step(world) {
    this.age++;
    if (this.age > this.life) { this.expire(world); return; }

    this.vy += this.gravity;
    this.x += this.vx;
    this.y += this.vy;
    this.rotation += this.spin;

    if (this.trail) {
      this.trailPoints.push({ x: this.x, y: this.y });
      if (this.trailPoints.length > 8) this.trailPoints.shift();
    }

    if (this.onStepFn) this.onStepFn(this, world);

    if (this.destroyOnGround) {
      const surface = world.stage.surfaceBelow(this.x, this.y - this.radius);
      if (surface && this.y + this.radius >= surface.y && this.vy >= 0) {
        this.expire(world);
        return;
      }
    }

    const b = world.stage.blastZones;
    if (this.x < b.left - 200 || this.x > b.right + 200 ||
        this.y < b.top - 200 || this.y > b.bottom + 200) {
      this.dead = true;
    }
  }

  canHit(target, frame) {
    if (this.hitsRemaining <= 0) return false;
    const last = this.hitTargets.get(target.id);
    if (last === undefined) return true;
    return this.rehitRate > 0 && frame - last >= this.rehitRate;
  }

  registerHit(target, frame) {
    this.hitTargets.set(target.id, frame);
    this.hitsRemaining--;
    if (this.destroyOnHit || this.hitsRemaining <= 0) this.dead = true;
  }

  expire(world) {
    if (this.dead) return;
    this.dead = true;
    if (this.onExpireFn) this.onExpireFn(this, world);
  }
}
