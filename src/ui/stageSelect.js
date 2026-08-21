import { keyboard, mouse } from '../core/input.js';
import { clamp } from '../core/math.js';
import { displayText, roughRect, getImage, INK, shade } from '../render/uiKit.js';
import { STAGES } from '../data/stages/index.js';

// Matched to MenuList so every menu in the game repeats at the same rate.
const DEAD = 0.55;
const REPEAT_FIRST = 22;
const REPEAT_NEXT = 8;

/**
 * Stage select — sits between the main menu and the character select.
 *
 * A row of cards, each the arena's own art with its name under it. No stats, no
 * blurbs: the layouts differ and the pictures are the fastest way to say so.
 * The selected card lifts and takes the same chipped gold rim the menu buttons
 * use, so it reads as the same family of screen.
 */
export class StageSelect {
  constructor(players, canvas = null) {
    this.players = players;
    this.canvas = canvas;
    this.index = 0;
    this.frame = 0;
    this.repeat = { x: 0, y: 0, tx: 0, ty: 0 };
    this.rects = [];
    /** Columns the last draw used; navigation follows the shape on screen. */
    this.cols = STAGES.length;
    for (const p of players) p.clearBuffer();
  }

  get stage() { return STAGES[this.index]; }

  move(dir) {
    this.index = (this.index + dir + STAGES.length) % STAGES.length;
  }

  /** Row moves clamp instead of wrapping: the last row is usually short. */
  moveRow(dir) {
    const next = this.index + dir * this.cols;
    if (next >= 0 && next < STAGES.length) this.index = next;
  }

  /** Held-direction repeat for one axis: fire once, pause, then auto-repeat. */
  axis(dirKey, timerKey, dir, step) {
    if (dir === 0) { this.repeat[dirKey] = 0; this.repeat[timerKey] = 0; return; }
    if (dir !== this.repeat[dirKey]) {
      this.repeat[dirKey] = dir; this.repeat[timerKey] = REPEAT_FIRST; step(dir);
    } else if (--this.repeat[timerKey] <= 0) {
      this.repeat[timerKey] = REPEAT_NEXT; step(dir);
    }
  }

  /** @returns {'confirm'|'cancel'|null} */
  update() {
    this.frame++;
    for (const p of this.players) p.poll();

    if (this.canvas) mouse.sync(this.canvas);
    let hovered = -1;
    if (mouse.present) {
      hovered = this.rects.findIndex((r) => r
        && mouse.x >= r.x && mouse.x <= r.x + r.w
        && mouse.y >= r.y && mouse.y <= r.y + r.h);
      if (hovered >= 0 && mouse.moved) this.index = hovered;
    }
    let result = null;
    if (mouse.clicked && hovered >= 0) { this.index = hovered; result = 'confirm'; }

    // Both axes: left/right steps through the roster, up/down jumps a row when
    // the grid has wrapped onto more than one.
    let dx = 0, dy = 0;
    for (const p of this.players) {
      if (dx === 0 && Math.abs(p.menuX) > DEAD) dx = Math.sign(p.menuX);
      if (dy === 0 && Math.abs(p.menuY) > DEAD) dy = Math.sign(p.menuY);
    }
    this.axis('x', 'tx', dx, (d) => this.move(d));
    this.axis('y', 'ty', dy, (d) => this.moveRow(d));

    for (const p of this.players) {
      if (p.consume('attack') || p.consume('jump') || p.consume('start')) result = 'confirm';
      else if (p.consume('special') || p.consume('shield')) result = 'cancel';
    }

    keyboard.flush();
    mouse.flush();
    return result;
  }

  draw(ctx) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1b2338');
    g.addColorStop(0.55, '#111726');
    g.addColorStop(1, '#080b13');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    displayText(ctx, 'CHOOSE YOUR STAGE', w / 2, h * 0.155, clamp(h * 0.075, 30, 74), {
      maxWidth: w * 0.9,
      align: 'center', fill: ['#fffdf3', '#c9bda4'], outline: '#241a2b', skew: -0.06,
    });

    // One row of five only works on a wide window; on anything squarer the
    // cards shrink to thumbnails with the bottom half of the screen empty. So
    // the column count is solved for rather than fixed: try every shape and
    // keep whichever makes the cards biggest inside the available box.
    const box = { x: w * 0.05, y: h * 0.24, w: w * 0.90, h: h * 0.70 };
    const AR = 0.86;              // card height / card width
    let cols = STAGES.length, cardW = 0;
    for (let c = 1; c <= STAGES.length; c++) {
      const rows = Math.ceil(STAGES.length / c);
      const gapX = box.w * 0.02, gapY = box.h * 0.05;
      const byWidth = (box.w - gapX * (c - 1)) / c;
      const byHeight = ((box.h - gapY * (rows - 1)) / rows) / AR;
      const cw = Math.min(byWidth, byHeight, box.w * 0.32);
      if (cw > cardW) { cardW = cw; cols = c; }
    }
    this.cols = cols;
    const rows = Math.ceil(STAGES.length / cols);
    const cardH = cardW * AR;
    const gapX = box.w * 0.02, gapY = box.h * 0.05;
    const gridH = rows * cardH + gapY * (rows - 1);
    const top0 = box.y + (box.h - gridH) / 2;

    this.rects = [];
    for (let i = 0; i < STAGES.length; i++) {
      const st = STAGES[i];
      const selected = i === this.index;
      const row = Math.floor(i / cols);
      // Short final rows stay centred rather than left-aligned under the others.
      const inRow = Math.min(cols, STAGES.length - row * cols);
      const rowW = inRow * cardW + gapX * (inRow - 1);
      const x = (w - rowW) / 2 + (i - row * cols) * (cardW + gapX);
      const top = top0 + row * (cardH + gapY);
      this.rects.push({ x, y: top, w: cardW, h: cardH });

      const pop = selected ? 1.07 : 1;
      ctx.save();
      ctx.translate(x + cardW / 2, top + cardH / 2);
      ctx.scale(pop, pop);
      ctx.translate(-(x + cardW / 2), -(top + cardH / 2));

      const cut = cardH * 0.10;
      const rough = cardH * 0.022;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = cardH * 0.09;
      ctx.shadowOffsetY = cardH * 0.05;
      roughRect(ctx, x, top, cardW, cardH, cut, rough, i + 1, 8);
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.restore();

      // Arena art, clipped to the card's chipped shape.
      const inset = cardH * 0.045;
      const artH = cardH * 0.70;
      ctx.save();
      roughRect(ctx, x + inset, top + inset, cardW - inset * 2, artH, cut * 0.8, rough * 0.8, i + 40, 8);
      ctx.clip();
      const entry = getImage(st.thumbnail);
      if (entry && entry.ready) {
        const img = entry.img;
        const scale = Math.max((cardW - inset * 2) / img.naturalWidth, artH / img.naturalHeight);
        const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
        ctx.drawImage(img, x + cardW / 2 - dw / 2, top + inset + artH / 2 - dh / 2, dw, dh);
      } else {
        ctx.fillStyle = '#2b3346';
        ctx.fillRect(x + inset, top + inset, cardW - inset * 2, artH);
      }
      ctx.restore();

      // Name plate under the art.
      const plateY = top + inset + artH;
      const plateH = cardH - artH - inset * 2;
      const pg = ctx.createLinearGradient(0, plateY, 0, plateY + plateH);
      if (selected) {
        pg.addColorStop(0, shade('#ffe9a3', 0.05));
        pg.addColorStop(1, shade('#e0a01e', -0.2));
      } else {
        pg.addColorStop(0, '#2b3346');
        pg.addColorStop(1, '#1b2231');
      }
      ctx.fillStyle = pg;
      ctx.fillRect(x + inset, plateY, cardW - inset * 2, plateH);

      displayText(ctx, st.name.toUpperCase(), x + cardW / 2, plateY + plateH * 0.72,
        clamp(cardW * 0.115, 11, 26), {
          align: 'center',
          fill: selected ? ['#fffdf3', '#e8dcc0'] : ['#e2e9f5', '#a8b4c8'],
          outline: '#241a2b', skew: -0.05,
          maxWidth: cardW - inset * 3,
        });

      if (selected) {
        const pulse = 0.65 + 0.35 * Math.sin(this.frame * 0.15);
        roughRect(ctx, x - cardH * 0.02, top - cardH * 0.02,
          cardW + cardH * 0.04, cardH + cardH * 0.04, cut * 1.1, rough * 0.5, i + 90, 8);
        ctx.strokeStyle = '#ffe9a3';
        ctx.globalAlpha = pulse;
        ctx.lineWidth = Math.max(2, cardH * 0.022);
        ctx.lineJoin = 'miter';
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }
}
