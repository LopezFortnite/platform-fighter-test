import { SMASH_CHARGE, SHIELD } from '../config/gameplay.js';
import { capsulesOverlap, capsuleBounds, boundsOverlap, capsuleCenter, circleHitsCapsule } from '../engine/shapes.js';
import { hitlagFrames, shieldstunFrames } from '../engine/combat.js';
import { S } from './states.js';

/**
 * Resolves every interaction between attackers and defenders in a frame:
 * melee hitboxes, grab boxes, projectiles, shields and clanks.
 *
 * Kept separate from Fighter so that hit resolution is a single, auditable
 * place — the usual source of subtle bugs in fighting games.
 */
export class HitSystem {
  constructor(world) {
    this.world = world;
  }

  step(frame) {
    const fighters = this.world.fighters;

    for (const attacker of fighters) {
      if (attacker.hitlag > 0 || !attacker.alive) continue;
      this.resolveGrab(attacker, fighters);
      this.resolveHitboxes(attacker, fighters, frame);
    }

    this.resolveProjectiles(frame);
    this.resolveClank();
  }

  // ------------------------------------------------------------------ melee

  resolveHitboxes(attacker, fighters, frame) {
    const boxes = attacker.getActiveHitboxes();
    if (!boxes.length) return;

    for (const box of boxes) {
      const hb = box.def;
      const bounds = capsuleBounds(box.capsule);

      for (const victim of fighters) {
        if (victim === attacker || !victim.isHittable()) continue;
        if (victim.state === S.GRABBED && victim.grabbedBy === attacker) continue;
        if (hb.hitGrounded === false && victim.grounded) continue;
        if (hb.hitAerial === false && !victim.grounded) continue;

        // One connection per move, per target — not per hitbox. Moves are
        // authored with an early sweetspot and a late weaker hitbox; keying on
        // the hitbox let the late one re-catch a victim the strong one had
        // already launched, replacing a fast launch with a slow one and making
        // kill percents non-monotonic. Explicit multi-hits opt back in via
        // `rehitRate`.
        const key = `${attacker.move.id}:${victim.id}`;
        const last = attacker.hitTargets.get(key);
        if (last !== undefined) {
          if (!hb.rehitRate || frame - last < hb.rehitRate) continue;
        }

        // Shield first: the bubble sits in front of the hurtbox.
        if (victim.isShielding() && !hb.ignoresShield) {
          const sc = this.shieldCircle(victim);
          if (circleHitsCapsule(sc.x, sc.y, sc.r, box.capsule)) {
            attacker.hitTargets.set(key, frame);
            this.applyShieldHit(attacker, victim, hb);
            continue;
          }
        }

        let connected = false;
        for (const hurt of victim.getHurtboxes()) {
          if (!boundsOverlap(bounds, capsuleBounds(hurt))) continue;
          if (capsulesOverlap(box.capsule, hurt)) { connected = true; break; }
        }
        if (!connected) continue;

        attacker.hitTargets.set(key, frame);
        this.applyHit(attacker, victim, hb, box);
      }
    }
  }

  shieldCircle(f) {
    return { x: f.x, y: f.y - f.def.height * 0.5, r: f.shield.radius };
  }

  /** Damage and knockback multipliers from smash charge and move staling. */
  scalars(attacker, hb) {
    let mul = 1;
    if (attacker.chargeFrames > 0 && attacker.move && attacker.move.charge) {
      const max = attacker.move.charge.maxFrames || SMASH_CHARGE.MAX_FRAMES;
      const t = Math.min(attacker.chargeFrames / max, 1);
      mul *= 1 + t * (SMASH_CHARGE.MAX_MULTIPLIER - 1);
    }
    const stale = attacker.stale.multiplier(attacker.move ? attacker.move.id : 'x');
    /**
     * A fighter-wide damage buff, set by whatever the character wants — the
     * Barbarian's Rage sets it for its duration. Kept off knockback on purpose:
     * a buff that scaled launch as well would move every kill percent while it
     * was up, and a temporary state should not rewrite the whole matchup.
     */
    const buff = attacker.damageBuff || 1;
    return { damageMul: mul * stale * buff, kbMul: mul };
  }

  applyHit(attacker, victim, hb, box) {
    const { damageMul, kbMul } = this.scalars(attacker, hb);
    const damage = hb.damage * damageMul;

    // Super armour: absorb the hit's damage without the knockback.
    if (victim.armorThreshold > 0 && damage < victim.armorThreshold) {
      victim.damage += damage;
      victim.recordDamage(attacker, damage);
      victim.flashFrames = 5;
      victim.hitlag = hitlagFrames(damage);
      attacker.hitlag = victim.hitlag;
      this.spark(box, hb, 0.6);
      return;
    }

    const lag = Math.round(hitlagFrames(damage) * (hb.hitlagMul || 1));
    attacker.hitlag = lag;
    attacker.hitlagIsVictim = false;
    attacker.stale.push(attacker.move.id);

    victim.applyLaunch({
      attacker,
      damage,
      angle: hb.angle,
      bkb: (hb.bkb || 0) * kbMul,
      kbg: hb.kbg || 0,
      facing: this.hitDirection(attacker, victim, hb),
      moveId: attacker.move.id,
      hitlagFrames: lag,
      setKnockback: hb.setKnockback !== undefined ? hb.setKnockback : null,
      hitstun: hb.hitstun !== undefined ? hb.hitstun : null,
      effect: hb.effect || 'none',
    });

    this.spark(box, hb, 1);
    if (attacker.move.onHit) attacker.move.onHit(attacker, victim, hb, this.world);
    if (attacker.def.onHit) attacker.def.onHit(attacker, victim, hb, this.world);
  }

  /**
   * Which way the victim flies. Most hitboxes use the attacker's facing, but
   * `reverseHit` hitboxes (sourspots, sweetspots behind the fighter) push away
   * from the attacker instead.
   */
  hitDirection(attacker, victim, hb) {
    if (hb.awayFromAttacker) return victim.x >= attacker.x ? 1 : -1;
    return attacker.facing;
  }

  applyShieldHit(attacker, victim, hb) {
    const { damageMul } = this.scalars(attacker, hb);
    const damage = hb.damage * damageMul + (hb.shieldDamage || 0);
    const lag = Math.round(hitlagFrames(damage, true) * (hb.hitlagMul || 1));

    attacker.hitlag = lag;
    attacker.hitlagIsVictim = false;
    attacker.vx -= SHIELD.PUSH_ATTACKER * attacker.facing;

    victim.hitlag = lag;
    victim.hitlagIsVictim = false;
    victim.applyShieldHit({
      damage,
      stun: shieldstunFrames(damage) * (hb.shieldstunMul || 1),
      pushback: SHIELD.PUSH_DEFENDER,
      facing: attacker.facing,
    });

    this.world.spawnEffect({
      x: victim.x, y: victim.y - victim.def.height * 0.5,
      kind: 'shield', size: 26, life: 12,
    });
  }

  // ------------------------------------------------------------------ grabs

  resolveGrab(attacker, fighters) {
    const gb = attacker.getActiveGrabbox();
    if (!gb) return;

    for (const victim of fighters) {
      if (victim === attacker || !victim.isGrabbable()) continue;
      let caught = false;
      for (const hurt of victim.getHurtboxes()) {
        if (capsulesOverlap(gb, hurt)) { caught = true; break; }
      }
      if (!caught) continue;

      attacker.onGrabConnect(victim);
      this.world.spawnEffect({ x: victim.x, y: victim.y - victim.def.height * 0.5, kind: 'grab', size: 22, life: 10 });
      return;
    }
  }

  // ------------------------------------------------------------ projectiles

  resolveProjectiles(frame) {
    const projectiles = this.world.projectiles;

    for (const p of projectiles) {
      if (p.dead) continue;

      for (const victim of this.world.fighters) {
        if (victim === p.owner || !victim.isHittable()) continue;
        if (!p.canHit(victim, frame)) continue;

        if (victim.isShielding()) {
          const sc = this.shieldCircle(victim);
          if (Math.hypot(sc.x - p.x, sc.y - p.y) <= sc.r + p.radius) {
            const lag = hitlagFrames(p.damage, true);
            victim.hitlag = lag;
            victim.hitlagIsVictim = false;
            victim.applyShieldHit({
              damage: p.damage,
              stun: shieldstunFrames(p.damage),
              pushback: SHIELD.PUSH_DEFENDER * 0.7,
              facing: p.facing,
            });
            p.registerHit(victim, frame);
            if (p.destroyOnShield) p.dead = true;
            this.world.spawnEffect({ x: p.x, y: p.y, kind: 'shield', size: 20, life: 10 });
            continue;
          }
        }

        let connected = false;
        for (const hurt of victim.getHurtboxes()) {
          if (circleHitsCapsule(p.x, p.y, p.radius, hurt)) { connected = true; break; }
        }
        if (!connected) continue;

        const lag = hitlagFrames(p.damage);
        // Read the staling multiplier before recording this hit, or the very
        // first shot would already count as stale.
        const staleMul = p.owner ? p.owner.stale.multiplier(p.moveId) : 1;
        if (p.owner) p.owner.stale.push(p.moveId);
        victim.applyLaunch({
          attacker: p.owner,
          damage: p.damage * staleMul,
          angle: p.angle,
          bkb: p.bkb,
          kbg: p.kbg,
          facing: p.facing,
          moveId: p.moveId,
          hitlagFrames: lag,
          effect: p.effect,
        });
        this.world.spawnEffect({ x: p.x, y: p.y, kind: 'hit', size: 8 + p.damage, life: 12, color: p.color });
        if (p.onHitFn) p.onHitFn(p, victim, this.world);
        p.registerHit(victim, frame);
      }
    }

    // Projectile vs projectile: the higher-priority shot survives.
    for (let i = 0; i < projectiles.length; i++) {
      const a = projectiles[i];
      if (a.dead || !a.collidesWithProjectiles) continue;
      for (let j = i + 1; j < projectiles.length; j++) {
        const b = projectiles[j];
        if (b.dead || !b.collidesWithProjectiles) continue;
        if (a.owner === b.owner) continue;
        if (Math.hypot(a.x - b.x, a.y - b.y) > a.radius + b.radius) continue;

        this.world.spawnEffect({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, kind: 'clank', size: 22, life: 14 });
        if (a.priority > b.priority + 2) { b.dead = true; }
        else if (b.priority > a.priority + 2) { a.dead = true; }
        else { a.dead = true; b.dead = true; }
      }
    }

    // Melee hitboxes destroy weak projectiles, which is what makes swinging
    // through a zoner's wall a real option.
    for (const f of this.world.fighters) {
      const boxes = f.getActiveHitboxes();
      if (!boxes.length) continue;
      for (const p of projectiles) {
        if (p.dead || p.owner === f) continue;
        if (p.priority > 14) continue;
        for (const box of boxes) {
          if (circleHitsCapsule(p.x, p.y, p.radius, box.capsule)) {
            p.dead = true;
            this.world.spawnEffect({ x: p.x, y: p.y, kind: 'clank', size: 20, life: 12 });
            break;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------ clank

  /**
   * Grounded attacks of similar strength cancel each other out, so trading
   * jabs does not simply reward whoever has the bigger hitbox.
   */
  resolveClank() {
    const fighters = this.world.fighters;
    for (let i = 0; i < fighters.length; i++) {
      const a = fighters[i];
      if (!a.move || a.move.kind !== 'ground' || a.move.noClank) continue;
      for (let j = i + 1; j < fighters.length; j++) {
        const b = fighters[j];
        if (!b.move || b.move.kind !== 'ground' || b.move.noClank) continue;
        if (a.hitlag > 0 || b.hitlag > 0) continue;

        const ba = a.getActiveHitboxes();
        const bb = b.getActiveHitboxes();
        if (!ba.length || !bb.length) continue;

        for (const x of ba) {
          for (const y of bb) {
            if (!capsulesOverlap(x.capsule, y.capsule)) continue;
            const diff = x.def.damage - y.def.damage;
            if (Math.abs(diff) > 9) return; // the stronger move simply wins
            const c = capsuleCenter(x.capsule);
            this.world.spawnEffect({ x: c.x, y: c.y, kind: 'clank', size: 30, life: 16 });
            a.hitlag = 10; b.hitlag = 10;
            a.hitlagIsVictim = false; b.hitlagIsVictim = false;
            a.endAction(); b.endAction();
            a.vx = -2.5 * a.facing; b.vx = -2.5 * b.facing;
            return;
          }
        }
      }
    }
  }

  spark(box, hb, scale) {
    const c = capsuleCenter(box.capsule);
    this.world.spawnEffect({
      x: c.x, y: c.y,
      kind: 'hit',
      size: (8 + hb.damage * 1.4) * scale,
      life: 14,
      effect: hb.effect || 'none',
    });
  }
}
