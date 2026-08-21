import { DEBUG, SHIELD } from '../config/gameplay.js';
import { S } from '../game/states.js';

/**
 * Deliberately programmer art.
 *
 * Fighters are capsules, attacks are their hitboxes, the stage is rectangles.
 * The only rendering that matters here is the kind that makes gameplay
 * readable: state colour coding, hitbox/hurtbox overlays, shield bubbles,
 * launch trails and blast-zone edges.
 */
export class Renderer {
  constructor(ctx, camera) {
    this.ctx = ctx;
    this.camera = camera;
    this.debug = { ...DEBUG };
  }

  draw(match) {
    const ctx = this.ctx;
    const { width, height } = ctx.canvas;

    this.drawBackground(match, width, height);

    ctx.save();
    this.camera.apply(ctx);

    this.drawBlastZones(match.stage);
    this.drawStage(match.stage);
    this.drawProjectiles(match);
    for (const f of match.fighters) this.drawFighter(f, match);
    this.drawEffects(match);
    if (this.debug.SHOW_BOXES) this.drawBoxes(match);

    ctx.restore();
  }

  drawBackground(match, w, h) {
    const ctx = this.ctx;
    const theme = match.stage.def.theme;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, theme.sky);
    g.addColorStop(1, theme.skyLow);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  drawBlastZones(stage) {
    const ctx = this.ctx;
    const b = stage.blastZones;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,90,120,0.28)';
    ctx.setLineDash([16, 14]);
    ctx.lineWidth = 3;
    ctx.strokeRect(b.left, b.top, b.right - b.left, b.bottom - b.top);
    ctx.restore();
  }

  drawStage(stage) {
    const ctx = this.ctx;
    const theme = stage.def.theme;

    for (const p of stage.platforms) {
      const solid = p.type === 'solid';
      ctx.fillStyle = solid ? theme.ground : theme.platform;
      ctx.fillRect(p.x, p.y, p.w, Math.min(p.h, solid ? 700 : 16));
      ctx.fillStyle = solid ? theme.groundTop : theme.platformTop;
      ctx.fillRect(p.x, p.y, p.w, solid ? 8 : 5);
    }

    // Ledge markers — the single most important geometry to read at a glance.
    ctx.fillStyle = theme.accent;
    for (const l of stage.ledges) {
      ctx.beginPath();
      ctx.arc(l.x, l.y, 7, 0, Math.PI * 2);
      ctx.fill();
      if (l.occupant) {
        ctx.strokeStyle = l.occupant.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(l.x, l.y, 14, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  /** Colour-codes the fighter's current state so behaviour is legible on sight. */
  stateTint(f) {
    switch (f.state) {
      case S.HITSTUN: return '#ff5470';
      case S.SHIELD:
      case S.SHIELD_STUN: return '#7ec8ff';
      case S.DIZZY:
      case S.SHIELD_BREAK: return '#ffe066';
      case S.LEDGE_HANG: return '#c9a0ff';
      case S.HELPLESS: return '#8a8a9a';
      case S.DOWNED: return '#a0616a';
      case S.GRABBED: return '#ff9f43';
      default: return null;
    }
  }

  drawFighter(f, match) {
    const ctx = this.ctx;
    if (f.state === S.DEAD) return;

    const r = Math.min(f.halfWidth, f.height / 2);
    const topY = f.y - f.height + r;
    const botY = f.y - r;

    ctx.save();

    // Launch trail: shows knockback direction and magnitude.
    if ((f.state === S.HITSTUN) && Math.hypot(f.vx, f.vy) > 8) {
      ctx.strokeStyle = 'rgba(255,84,112,0.35)';
      ctx.lineWidth = r * 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(f.x, f.y - f.height / 2);
      ctx.lineTo(f.x - f.vx * 2.2, f.y - f.height / 2 - f.vy * 2.2);
      ctx.stroke();
    }

    const intangible = f.isIntangible();
    ctx.globalAlpha = intangible ? 0.42 : 1;

    // Body capsule.
    const tint = this.stateTint(f);
    ctx.fillStyle = f.flashFrames > 0 ? '#ffffff' : (tint || f.color);
    ctx.beginPath();
    ctx.moveTo(f.x - r, topY);
    ctx.arc(f.x, topY, r, Math.PI, 0);
    ctx.lineTo(f.x + r, botY);
    ctx.arc(f.x, botY, r, 0, Math.PI);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.strokeStyle = f.def.accent;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Facing indicator.
    ctx.fillStyle = '#0d1018';
    ctx.beginPath();
    ctx.arc(f.x + f.facing * r * 0.55, f.y - f.height * 0.78, r * 0.22, 0, Math.PI * 2);
    ctx.fill();

    // Player marker.
    ctx.fillStyle = f.color;
    ctx.font = 'bold 20px Trebuchet MS';
    ctx.textAlign = 'center';
    ctx.fillText(`P${f.playerIndex + 1}`, f.x, f.y - f.height - 14);

    // Shield bubble.
    if (f.isShielding()) {
      const health = f.shield.health / SHIELD.MAX_HEALTH;
      ctx.fillStyle = `rgba(120,200,255,${0.22 + health * 0.22})`;
      ctx.strokeStyle = `rgba(160,220,255,${0.5 + health * 0.4})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(f.x, f.y - f.def.height * 0.5, f.shield.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Wizard's Fire Shield — a gameplay state that must be visible to both players.
    if (f.custom.fireShield && f.custom.fireShield.active) {
      const pulse = 0.6 + 0.4 * Math.sin(match.frame * 0.25);
      ctx.strokeStyle = `rgba(255,138,76,${0.55 + pulse * 0.35})`;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(f.x, f.y - f.def.height * 0.5, f.def.height * 0.62 + pulse * 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Charge indicator for smash attacks.
    if (f.charging && f.chargeFrames > 0) {
      const t = Math.min(f.chargeFrames / (f.move.charge.maxFrames || 60), 1);
      ctx.fillStyle = `rgba(255,${Math.round(220 - t * 180)},60,0.85)`;
      ctx.fillRect(f.x - 26, f.y - f.height - 34, 52 * t, 6);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.strokeRect(f.x - 26, f.y - f.height - 34, 52, 6);
    }

    // Respawn platform.
    if (f.state === S.RESPAWN) {
      ctx.fillStyle = 'rgba(200,220,255,0.35)';
      ctx.fillRect(f.x - 60, f.y, 120, 10);
    }

    if (this.debug.SHOW_STATE) {
      ctx.fillStyle = 'rgba(255,255,255,0.65)';
      ctx.font = '13px Consolas, monospace';
      const label = f.state === S.ACTION && f.move ? `${f.move.id} ${f.moveFrame}/${f.move.total}` : f.state;
      ctx.fillText(label, f.x, f.y + 20);
    }

    ctx.restore();
  }

  drawProjectiles(match) {
    const ctx = this.ctx;
    for (const p of match.projectiles) {
      ctx.save();
      if (p.trail && p.trailPoints.length > 1) {
        ctx.strokeStyle = p.color;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = p.radius * 0.9;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(p.trailPoints[0].x, p.trailPoints[0].y);
        for (const pt of p.trailPoints) ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotation);
      ctx.fillStyle = p.color;

      if (p.shape === 'dagger') {
        ctx.fillRect(-p.radius, -3, p.radius * 2, 6);
      } else if (p.shape === 'tornado') {
        ctx.globalAlpha = 0.5;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.ellipse(0, -p.radius * 0.5 + i * p.radius * 0.5, p.radius * (0.5 + i * 0.25), p.radius * 0.28, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, p.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath();
        ctx.arc(0, 0, p.radius * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawEffects(match) {
    const ctx = this.ctx;
    for (const e of match.effects) {
      const t = e.age / e.life;
      ctx.save();
      ctx.globalAlpha = 1 - t;

      switch (e.kind) {
        case 'hit': {
          ctx.fillStyle = e.effect === 'fire' ? '#ffb24d' : e.effect === 'electric' ? '#9fd8ff' : e.effect === 'blunt' ? '#ffe0a8' : '#fff2b0';
          const r = e.size * (0.6 + t * 1.4);
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            const rr = i % 2 ? r * 0.45 : r;
            ctx[i ? 'lineTo' : 'moveTo'](e.x + Math.cos(a) * rr, e.y + Math.sin(a) * rr);
          }
          ctx.closePath();
          ctx.fill();
          break;
        }
        case 'explosion': {
          ctx.fillStyle = e.color || '#ff9b3d';
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.size * (0.4 + t), 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'shield': {
          ctx.strokeStyle = '#8fd3ff';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.size * (1 + t), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'clank': {
          ctx.strokeStyle = '#ffe066';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.size * (0.5 + t), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'ko': {
          ctx.strokeStyle = e.color || '#ffffff';
          ctx.lineWidth = 8;
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.size * (0.3 + t * 1.6), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'airjump': {
          // Flattened, matching the 2.5D view's ground-hugging puff.
          ctx.globalAlpha = (1 - t) * 0.95;
          ctx.strokeStyle = '#dcefff';
          ctx.lineWidth = 4;
          const r = e.size * (0.35 + Math.sqrt(t) * 0.85);
          ctx.beginPath();
          ctx.ellipse(e.x, e.y, r, r * 0.45, 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        default: {
          ctx.fillStyle = e.color || '#ffffff';
          ctx.beginPath();
          ctx.arc(e.x, e.y, e.size * (1 - t * 0.4), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  drawBoxes(match) {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineWidth = 2;

    for (const f of match.fighters) {
      if (f.state === S.DEAD) continue;
      ctx.strokeStyle = f.isIntangible() ? 'rgba(120,220,255,0.85)' : 'rgba(255,235,60,0.5)';
      for (const h of f.getHurtboxes()) this.strokeCapsule(h);

      ctx.strokeStyle = 'rgba(255,60,90,0.95)';
      ctx.fillStyle = 'rgba(255,60,90,0.18)';
      for (const box of f.getActiveHitboxes()) this.strokeCapsule(box.capsule, true);

      const gb = f.getActiveGrabbox();
      if (gb) {
        ctx.strokeStyle = 'rgba(150,90,255,0.95)';
        ctx.fillStyle = 'rgba(150,90,255,0.2)';
        this.strokeCapsule(gb, true);
      }
    }

    ctx.restore();
  }

  strokeCapsule(c, fill = false) {
    const ctx = this.ctx;
    const dx = c.x2 - c.x, dy = c.y2 - c.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len * c.r, ny = dx / len * c.r;
    const a0 = Math.atan2(dy, dx);

    ctx.beginPath();
    ctx.moveTo(c.x + nx, c.y + ny);
    ctx.lineTo(c.x2 + nx, c.y2 + ny);
    ctx.arc(c.x2, c.y2, c.r, a0 - Math.PI / 2, a0 + Math.PI / 2);
    ctx.lineTo(c.x - nx, c.y - ny);
    ctx.arc(c.x, c.y, c.r, a0 + Math.PI / 2, a0 + (3 * Math.PI) / 2);
    ctx.closePath();
    if (fill) ctx.fill();
    ctx.stroke();
  }

}
