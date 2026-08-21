import { ELIXIR, SIM } from '../config/gameplay.js';
import { clamp } from '../core/math.js';
import { GOLD_MAX } from '../data/fighters/goblin.js';
import {
  FONT_STACK, INK, ELIXIR_LIGHT, ELIXIR_MID, ELIXIR_DARK,
  roundRect, mix, shade, displayText, drawCharacterCard,
} from './uiKit.js';

/**
 * In-game HUD.
 *
 * Recreated from the project's own UI mock: a rounded character card with a
 * coloured frame, a large chunky damage percentage right-aligned above a
 * segmented Clash Royale-style Elixir bar, with a circular Elixir counter
 * badge sitting on the bar's left end.
 *
 * The whole panel is authored in "units" where the card is 100x100 and then
 * scaled to the canvas, so the layout holds at any resolution.
 */

/**
 * Readable names for cooldown-gated specials. A move id is an identifier, not
 * a label, and "FIRESHIELD" in the corner of the screen is neither.
 */
const COOLDOWN_LABELS = {
  fireShield: 'SHIELD',
  elixirSnatch: 'SNATCH',
  snatch: 'SNATCH',
};

/** Panel layout, in card-relative units. */
const L = {
  CARD: 100,
  CARD_RADIUS: 22,

  BAR_X: 5,
  BAR_Y: 111,
  BAR_W: 448,
  BAR_H: 34,

  BADGE_X: 27,
  BADGE_R: 24,

  PERCENT_RIGHT: 452,
  PERCENT_BASELINE: 86,
  PERCENT_SIZE: 90,

  // Gold Rush meter, sat above the card (negative y is above the panel top).
  GOLD_Y: -26,
  GOLD_H: 18,

  STOCK_Y: 165,
  STOCK_X: 14,
  STOCK_SPACING: 26,
  STOCK_R: 9,

  WIDTH: 458,
  HEIGHT: 182,
};

const BAR_EMPTY = '#4c4f5c';
const BAR_EMPTY_DARK = '#33353f';

export class HUD {
  constructor(ctx) {
    this.ctx = ctx;
  }

  /** Chunky outlined display text (see uiKit), bound to this HUD's context. */
  displayText(text, x, y, size, opts = {}) {
    displayText(this.ctx, text, x, y, size, opts);
  }

  /**
   * @param {object} match
   * @param {(simX:number, simY:number) => {x:number,y:number}} [project]
   */
  draw(match, project = null) {
    const ctx = this.ctx;
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    if (project) this.drawOffscreenMarkers(match, project, w, h);
    this.drawTimer(match, w, h);

    // Scale the panels from canvas height, then make sure two of them fit.
    let scale = (h * 0.112) / L.CARD;
    const maxScale = (w * 0.33) / L.WIDTH;
    scale = Math.min(scale, maxScale);

    const panelW = L.WIDTH * scale;
    const panelH = L.HEIGHT * scale;
    const margin = w * 0.035;
    const baseY = h - panelH - h * 0.03;

    match.fighters.forEach((f, i) => {
      const x = i === 0 ? margin : w - margin - panelW;
      this.drawPlayerPanel(f, x, baseY, scale, match);
    });

    this.drawAnnouncements(match, w, h);
    if (match.introFrames > 0) this.drawIntro(match, w, h);
    if (match.over) this.drawResult(match, w, h);
  }

  // ------------------------------------------------------------------ panel

  drawPlayerPanel(f, ox, oy, s, match) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(s, s);

    this.drawCard(f);
    this.drawPercent(f);
    this.drawElixirBar(f, match);
    this.drawStocks(f, match);
    this.drawStatus(f, match);
    this.drawGoldMeter(f);

    ctx.restore();
  }

  /**
   * The Goblin's Gold Rush meter, sat above his card.
   *
   * Only drawn for a fighter that actually has the mechanic — it is keyed on
   * the presence of `custom.gold`, so no other character grows an empty bar,
   * and a future fighter with a meter of their own gets one for free.
   *
   * The same bar serves two states. Filling, it is how close he is to being
   * able to spend it; spent, it drains across the six seconds and becomes the
   * timer. One bar rather than two, because the player only ever cares about
   * one of those questions at a time.
   */
  drawGoldMeter(f) {
    const g = f.custom && f.custom.gold;
    if (!g) return;
    const ctx = this.ctx;
    const ratio = clamp(g.value / GOLD_MAX, 0, 1);
    const full = ratio >= 1;
    const x = 0, y = L.GOLD_Y, w = L.CARD, h = L.GOLD_H;
    const r = h / 2;

    ctx.save();

    // A full meter pulses, which is the cue that Down B is live. It stops the
    // moment it is spent — a draining bar must not look like a ready one.
    if (full && !g.active) {
      ctx.shadowColor = 'rgba(245,197,66,0.95)';
      ctx.shadowBlur = 14 + Math.sin(Date.now() / 120) * 6;
    }

    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = BAR_EMPTY_DARK;
    ctx.fill();
    ctx.shadowBlur = 0;

    if (ratio > 0) {
      ctx.save();
      roundRect(ctx, x, y, w, h, r);
      ctx.clip();
      const grad = ctx.createLinearGradient(0, y, 0, y + h);
      grad.addColorStop(0, full && !g.active ? '#ffe9a3' : '#f5c542');
      grad.addColorStop(1, '#b8862a');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, w * ratio, h);
      ctx.restore();
    }

    roundRect(ctx, x, y, w, h, r);
    ctx.strokeStyle = full ? '#ffe9a3' : 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // The label only appears when it means something: ready, or counting down.
    if (full && !g.active) {
      this.displayText('GOLD RUSH', w / 2, y - 3, h * 0.95, {
        align: 'center', fill: ['#fffdf3', '#f5c542'], outline: '#3a2a08', skew: -0.05,
      });
    } else if (g.active) {
      this.displayText('GOLD RUSH', w / 2, y - 3, h * 0.95, {
        align: 'center', fill: ['#ffe9a3', '#b8862a'], outline: '#3a2a08', skew: -0.05,
      });
    }
    ctx.restore();
  }

  /** Rounded character card, shared with the character select screen. */
  drawCard(f) {
    drawCharacterCard(this.ctx, f.def, 0, 0, L.CARD, f.hudColor || f.color);
  }

  /** Large right-aligned damage readout, e.g. "32.6%". */
  drawPercent(f) {
    const pct = f.damage;
    // Cream at low percent (as in the mock), heating toward red as it climbs.
    const t = clamp((pct - 55) / 145, 0, 1);
    const top = mix('#fffdf3', '#ff5a48', t);
    const bottom = mix('#e6d8bd', '#c11f1f', t);

    this.displayText(`${pct.toFixed(1)}%`, L.PERCENT_RIGHT, L.PERCENT_BASELINE, L.PERCENT_SIZE, {
      align: 'right',
      fill: [top, bottom],
      outline: '#241a2b',
    });
  }

  /** Segmented Elixir meter with the circular counter badge on its left end. */
  drawElixirBar(f, match) {
    const ctx = this.ctx;
    const x = L.BAR_X, y = L.BAR_Y, w = L.BAR_W, h = L.BAR_H, r = h / 2;
    const ratio = clamp(f.elixir.value / ELIXIR.MAX, 0, 1);
    const denied = f.elixir.denied > 0;
    const flash = f.elixir.flash > 0;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(ctx, x + 2.5, y + 2.5, w - 5, h - 5, r - 2.5);
    ctx.clip();

    // Empty track.
    const eg = ctx.createLinearGradient(0, y, 0, y + h);
    eg.addColorStop(0, BAR_EMPTY);
    eg.addColorStop(1, BAR_EMPTY_DARK);
    ctx.fillStyle = eg;
    ctx.fillRect(x, y, w, h);

    // Fill.
    const fw = (w - 5) * ratio;
    if (fw > 0) {
      const fg = ctx.createLinearGradient(0, y, 0, y + h);
      if (denied) {
        fg.addColorStop(0, '#ff8a8a');
        fg.addColorStop(0.5, '#e04b4b');
        fg.addColorStop(1, '#8f1f1f');
      } else {
        fg.addColorStop(0, flash ? '#ffc0f2' : ELIXIR_LIGHT);
        fg.addColorStop(0.52, ELIXIR_MID);
        fg.addColorStop(1, ELIXIR_DARK);
      }
      ctx.fillStyle = fg;
      ctx.fillRect(x + 2.5, y + 2.5, fw, h - 5);

      // Specular strip along the top of the fill.
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(x + 2.5, y + 4, fw, h * 0.22);
    }

    // Segment dividers, one per Elixir point, across the whole bar.
    ctx.strokeStyle = 'rgba(12,14,20,0.85)';
    ctx.lineWidth = 2.2;
    for (let i = 1; i < ELIXIR.MAX; i++) {
      const sx = x + (i / ELIXIR.MAX) * w;
      ctx.beginPath();
      ctx.moveTo(sx, y);
      ctx.lineTo(sx, y + h);
      ctx.stroke();
    }
    ctx.restore();

    // Rim.
    roundRect(ctx, x + 1.5, y + 1.5, w - 3, h - 3, r - 1.5);
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    this.drawElixirBadge(f, denied, flash);
  }

  drawElixirBadge(f, denied, flash) {
    const ctx = this.ctx;
    const cx = L.BADGE_X;
    const cy = L.BAR_Y + L.BAR_H / 2;
    const r = L.BADGE_R;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.restore();

    const g = ctx.createLinearGradient(0, cy - r, 0, cy + r);
    g.addColorStop(0, denied ? '#ff8a8a' : (flash ? '#ffc0f2' : ELIXIR_LIGHT));
    g.addColorStop(1, denied ? '#8f1f1f' : ELIXIR_DARK);
    ctx.beginPath();
    ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, r - 3, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    const value = Math.floor(f.elixir.value);
    this.displayText(String(value), cx, cy + r * 0.42, r * 1.18, {
      align: 'center', fill: '#ffffff', outline: '#5c0a48',
      outlineScale: 0.24, skew: 0, shadow: false,
    });
  }

  /** Stock pips under the bar — not in the mock, but the match needs them. */
  drawStocks(f, match) {
    const ctx = this.ctx;
    const frame = f.hudColor || f.color;

    // Training runs on a nominally huge stock count; show it as endless rather
    // than drawing ninety-nine pips across the screen.
    if (match && match.rules.training) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(L.STOCK_X + L.STOCK_R, L.STOCK_Y, L.STOCK_R, 0, Math.PI * 2);
      ctx.fillStyle = frame;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.restore();
      this.displayText('∞', L.STOCK_X + L.STOCK_R * 2 + 14, L.STOCK_Y + L.STOCK_R * 0.9,
        L.STOCK_R * 2.6, {
          align: 'left', fill: [frame, shade(frame, -0.35)], outline: '#241a2b',
          skew: 0, shadow: false,
        });
      return;
    }

    // Long stock counts collapse to a few pips plus a multiplier.
    const MAX_PIPS = 5;
    const pips = Math.min(f.stocks, MAX_PIPS);
    for (let i = 0; i < pips; i++) {
      const cx = L.STOCK_X + i * L.STOCK_SPACING;
      const cy = L.STOCK_Y;
      ctx.beginPath();
      ctx.arc(cx, cy, L.STOCK_R, 0, Math.PI * 2);
      ctx.fillStyle = frame;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.4;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx - L.STOCK_R * 0.28, cy - L.STOCK_R * 0.3, L.STOCK_R * 0.34, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fill();
    }

    if (f.stocks > MAX_PIPS) {
      ctx.save();
      ctx.textAlign = 'left';
      ctx.font = `900 15px ${FONT_STACK}`;
      ctx.fillStyle = frame;
      ctx.fillText(`x${f.stocks}`, L.STOCK_X + pips * L.STOCK_SPACING, L.STOCK_Y + 5);
      ctx.restore();
    }
  }

  /**
   * Where the stock display actually ends, so anything placed after it lands in
   * the right spot.
   *
   * It cannot be derived from `f.stocks`: the pips cap at five and collapse to a
   * multiplier beyond that, and training draws a single pip plus an infinity
   * glyph for a nominal count of ninety-nine. Using the raw number pushed the
   * cooldown readout two thousand pixels off the side of the screen in training.
   */
  stocksEndX(f, match) {
    if (match && match.rules.training) return L.STOCK_X + L.STOCK_R * 2 + 40;
    const MAX_PIPS = 5;
    const pips = Math.min(f.stocks, MAX_PIPS);
    return L.STOCK_X + pips * L.STOCK_SPACING + (f.stocks > MAX_PIPS ? 26 : 0);
  }

  /** Late-game multiplier, respawn timer and special cooldowns. */
  drawStatus(f, match) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `700 15px ${FONT_STACK}`;
    ctx.textBaseline = 'alphabetic';

    if (match.lateGameLabel) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffb3f0';
      ctx.fillText(`x${f.elixir.rateMultiplier.toFixed(1)}`, L.BAR_X + L.BAR_W - 8, L.STOCK_Y + 5);
    }

    if (!f.alive && f.respawnQueue) {
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.fillText(`RESPAWN ${Math.ceil(f.respawnQueue / SIM.FPS)}s`,
        this.stocksEndX(f, match) + 6, L.STOCK_Y + 5);
    } else if (f.cooldowns.size) {
      /**
       * Special cooldowns, as a name plus a live countdown.
       *
       * The name alone was enough when cooldowns were a couple of seconds, but
       * the Fire Shield's is ten — long enough that the player needs to know
       * *how long*, not merely that it is unavailable. The longest one is shown,
       * because that is the one still gating a decision.
       */
      let label = null;
      let longest = 0;
      for (const [id, frames] of f.cooldowns) {
        if (frames <= longest) continue;
        longest = frames;
        label = id;
      }
      const secs = Math.ceil(longest / SIM.FPS);
      const x = this.stocksEndX(f, match) + 10;
      const y = L.STOCK_Y + 5;
      const text = `${COOLDOWN_LABELS[label] || label.toUpperCase()} ${secs}s`;

      // On a dark chip, because this sits over the stage rather than over the
      // panel and a ten-second lockout is worth being able to find at a glance.
      ctx.font = `700 17px ${FONT_STACK}`;
      const w = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(12,14,22,0.72)';
      roundRect(ctx, x - 7, y - 15, w + 14, 25, 6);
      ctx.fill();

      // A bar drains left to right along the chip's foot, so the wait reads
      // without having to parse the number.
      ctx.fillStyle = 'rgba(255,214,120,0.9)';
      ctx.fillRect(x - 4, y + 5, (w + 8) * clamp(longest / (10 * SIM.FPS), 0, 1), 3);

      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffd678';
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------------ timer

  drawTimer(match, w, h) {
    if (match.rules.untimed) {
      const size = clamp(h * 0.05, 22, 44);
      this.displayText('TRAINING', w / 2, size * 1.25, size, {
        align: 'center', fill: ['#bff3a8', '#4f9c34'], outline: '#123309', skew: 0,
      });
      return;
    }
    const total = Math.ceil(match.secondsRemaining);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    const urgent = total <= 60;
    const size = clamp(h * 0.072, 30, 62);

    this.displayText(`${mins}:${String(secs).padStart(2, '0')}`, w / 2, size * 1.25, size, {
      align: 'center',
      fill: urgent ? ['#ff8f8f', '#c11f1f'] : ['#fffdf3', '#d9cfbb'],
      outline: '#241a2b',
      skew: 0,
    });

    if (match.lateGameLabel) {
      const pulse = 0.65 + 0.35 * Math.sin(match.frame * 0.18);
      this.displayText(match.lateGameLabel, w / 2, size * 1.95, size * 0.4, {
        align: 'center', fill: '#ffb3f0', outline: '#3d0a33', skew: 0, alpha: pulse,
      });
    }
  }

  // ---------------------------------------------------------------- overlays

  drawOffscreenMarkers(match, project, w, h) {
    const ctx = this.ctx;
    for (const f of match.fighters) {
      if (!f.alive || f.state === 'dead') continue;
      const p = project(f.x, f.y - f.height / 2);
      const off = p.behind || p.x < 40 || p.x > w - 40 || p.y < 40 || p.y > h - 40;
      if (!off) continue;

      const cx = clamp(p.behind ? w / 2 : p.x, 46, w - 46);
      const cy = clamp(p.behind ? h / 2 : p.y, 46, h - 46);
      const frame = f.hudColor || f.color;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, 22, 0, Math.PI * 2);
      ctx.fillStyle = frame;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
      this.displayText(`P${f.playerIndex + 1}`, cx, cy + 7, 20, {
        align: 'center', fill: '#ffffff', outline: INK, outlineScale: 0.2, skew: 0, shadow: false,
      });
    }
  }

  drawAnnouncements(match, w, h) {
    let y = h * 0.19;
    for (const a of match.announcements) {
      const alpha = Math.min(1, a.life / 30);
      this.displayText(a.text, w / 2, y, clamp(h * 0.05, 24, 44), {
        align: 'center', fill: [a.color || '#ffffff', shade(a.color || '#ffffff', -0.35)],
        outline: '#241a2b', skew: 0, alpha,
      });
      y += h * 0.062;
    }
  }

  drawIntro(match, w, h) {
    const t = match.introFrames;
    const text = t > 30 ? 'READY' : 'GO!';
    const size = clamp(h * 0.13, 60, 130);
    this.displayText(text, w / 2, h / 2, size, {
      align: 'center',
      fill: t > 30 ? ['#fffdf3', '#cfc4ad'] : ['#ffe28a', '#e08a1e'],
      outline: '#241a2b', skew: -0.09,
    });
  }

  // ------------------------------------------------------------- ceremony

  /**
   * The victory ceremony overlay. During the shot sequence this is only
   * cinematic framing — bars, a punch on each cut, the winner's name arriving
   * on the last shot. The stats panel belongs to the phase after it, and is
   * laid out to sit in the gap between the two fighters on stage.
   *
   * @param {import('../game/victory.js').VictorySequence} seq
   */
  drawCeremony(match, seq, w, h) {
    const ctx = this.ctx;
    const anim = seq.phase === 'anim';

    // Bars slide in for the sequence and pull back out for the stats.
    const barsIn = anim
      ? clamp(seq.frame / 14, 0, 1)
      : Math.max(0, 1 - seq.statsFrame / 12);
    if (barsIn > 0.01) {
      const bar = h * 0.085 * barsIn;
      ctx.save();
      ctx.fillStyle = '#05060c';
      ctx.fillRect(0, 0, w, bar);
      ctx.fillRect(0, h - bar, w, bar);
      ctx.restore();
    }

    // A punch of light on every cut, which is what reads as a cut.
    const flash = seq.cutFlash;
    if (flash > 0.01) {
      ctx.save();
      ctx.fillStyle = `rgba(255,255,255,${(flash * flash * 0.32).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
      ctx.restore();
    }

    if (anim) this.drawCeremonyTitles(seq, w, h);
    else this.drawStatsPanel(match, seq, w, h);
  }

  /** "GAME!" on the opening beat, the winner's name on the closing one. */
  drawCeremonyTitles(seq, w, h) {
    const opening = clamp((20 - seq.frame) / 12, 0, 1);
    if (opening > 0) {
      this.displayText('GAME!', w / 2, h * 0.44, clamp(h * 0.16, 70, 170), {
        align: 'center', fill: ['#fffdf3', '#e0b23c'], outline: '#241a2b',
        skew: -0.09, alpha: opening,
      });
    }

    if (seq.shotIndex !== 3 || !seq.winner) return;
    const t = clamp(seq.shotFrame / 16, 0, 1);
    const c = seq.winner.hudColor || seq.winner.color;
    const slide = (1 - t) * w * 0.08;
    this.displayText(`${seq.winner.def.name.toUpperCase()} WINS`, w / 2 - slide, h * 0.30,
      clamp(h * 0.095, 44, 96), {
        align: 'center', fill: [shade(c, 0.5), c], outline: '#241a2b',
        maxWidth: w * 0.8, alpha: t,
      });
  }

  /**
   * The results panel: a narrow column of match stats between the two fighters,
   * with the options menu drawn underneath it by ResultMenu.
   */
  drawStatsPanel(match, seq, w, h) {
    const ctx = this.ctx;
    const t = clamp(seq.statsFrame / 18, 0, 1);
    const rise = (1 - t) * h * 0.04;

    // A scrim under the text, weighted to the top and bottom where the title
    // and the options sit. The middle band stays light so the fighters behind
    // it still read.
    const scrim = ctx.createLinearGradient(0, 0, 0, h);
    scrim.addColorStop(0, 'rgba(6,8,16,0.78)');
    scrim.addColorStop(0.30, 'rgba(6,8,16,0.30)');
    scrim.addColorStop(0.60, 'rgba(6,8,16,0.30)');
    scrim.addColorStop(1, 'rgba(6,8,16,0.68)');
    ctx.save();
    ctx.globalAlpha = t;
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = t;
    ctx.translate(0, rise);

    // Heading.
    const r = seq.result;
    if (r.winner) {
      const c = r.winner.hudColor || r.winner.color;
      this.displayText(`${r.winner.def.name.toUpperCase()} WINS`, w / 2, h * 0.145,
        clamp(h * 0.082, 38, 84), {
          align: 'center', fill: [shade(c, 0.5), c], outline: '#241a2b', maxWidth: w * 0.7,
        });
    } else {
      this.displayText('DRAW', w / 2, h * 0.145, clamp(h * 0.082, 38, 84), {
        align: 'center', fill: ['#fffdf3', '#cfc4ad'], outline: '#241a2b',
      });
    }

    const rows = seq.statRows();
    const fighters = match.fighters;
    const panelW = Math.min(w * 0.44, h * 0.78);
    const px = (w - panelW) / 2;
    const py = h * 0.185;
    const headH = h * 0.052;
    const rowH = h * 0.037;
    const panelH = headH + rows.length * rowH + h * 0.045;

    ctx.save();
    roundRect(ctx, px, py, panelW, panelH, h * 0.018);
    ctx.fillStyle = 'rgba(10,13,24,0.78)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = Math.max(1, h * 0.002);
    ctx.stroke();
    ctx.restore();

    // Column headers, in each fighter's own HUD colour.
    const colX = [px + panelW * 0.62, px + panelW * 0.88];
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `900 ${Math.round(h * 0.026)}px ${FONT_STACK}`;
    fighters.forEach((f, i) => {
      ctx.fillStyle = f.hudColor || f.color;
      ctx.fillText(f.def.name.toUpperCase(), colX[i], py + headH * 0.72);
    });
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(px + panelW * 0.05, py + headH);
    ctx.lineTo(px + panelW * 0.95, py + headH);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.font = `700 ${Math.round(h * 0.024)}px ${FONT_STACK}`;
    rows.forEach((row, i) => {
      const y = py + headH + rowH * (i + 0.72);
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(206,216,234,0.82)';
      ctx.fillText(row.label, px + panelW * 0.07, y);
      ctx.textAlign = 'center';
      row.values.forEach((v, c) => {
        // The better of the two numbers is the one worth reading first.
        ctx.fillStyle = row.leader === c ? '#ffe08a' : '#e8edf7';
        ctx.fillText(v, colX[c], y);
      });
    });
    ctx.restore();

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(h * 0.021)}px ${FONT_STACK}`;
    ctx.fillStyle = 'rgba(180,192,214,0.7)';
    const reason = r.reason === 'time' ? 'TIME UP' : 'BY STOCKS';
    ctx.fillText(`${reason}  ·  ${seq.durationText()}`, w / 2, py + panelH - h * 0.016);
    ctx.restore();

    ctx.restore();
  }

  drawResult(match, w, h) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = 'rgba(6,8,16,0.74)';
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    // Sits in the upper half, leaving the lower half for the options menu.
    const r = match.result;
    const size = clamp(h * 0.085, 40, 84);
    if (r.winner) {
      const c = r.winner.hudColor || r.winner.color;
      this.displayText(`${r.winner.def.name.toUpperCase()} WINS`, w / 2, h * 0.34, size, {
        align: 'center', fill: [shade(c, 0.45), c], outline: '#241a2b', maxWidth: w * 0.85,
      });
    } else {
      this.displayText('DRAW', w / 2, h * 0.34, size, {
        align: 'center', fill: ['#fffdf3', '#cfc4ad'], outline: '#241a2b',
      });
    }

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(h * 0.024)}px ${FONT_STACK}`;
    ctx.fillStyle = 'rgba(210,222,240,0.85)';
    ctx.fillText(r.reason === 'time' ? 'TIME UP' : 'BY STOCKS', w / 2, h * 0.40);

    let y = h * 0.46;
    ctx.font = `700 ${Math.round(h * 0.026)}px ${FONT_STACK}`;
    for (const s of r.standings) {
      ctx.fillStyle = s.fighter.hudColor || s.fighter.color;
      ctx.fillText(`${s.fighter.def.name} — ${s.stocks} stocks · ${s.damage.toFixed(1)}%`, w / 2, y);
      y += h * 0.038;
    }

    ctx.restore();
    // The options themselves are a real menu, drawn by ResultMenu on top.
  }
}
