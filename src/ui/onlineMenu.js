import { keyboard, mouse } from '../core/input.js';
import { clamp } from '../core/math.js';
import { displayText, roughRect, INK, shade } from '../render/uiKit.js';

const DEAD = 0.55;
const REPEAT_FIRST = 22;
const REPEAT_NEXT = 8;

/**
 * Host / join screen.
 *
 * Three states in one screen rather than three screens, because they are the
 * same six digits at different stages of being known: you are choosing, you are
 * showing a code you were given, or you are typing one you were told.
 */
export class OnlineMenu {
  constructor(players, canvas = null) {
    this.players = players;
    this.canvas = canvas;
    /** 'choose' | 'hosting' | 'entry' | 'connecting' */
    this.mode = 'choose';
    this.index = 0;
    this.digits = [];
    this.code = null;
    this.status = null;
    this.error = null;
    this.frame = 0;
    this.repeat = { dir: 0, timer: 0 };
    this.rects = [];
    for (const p of players) p.clearBuffer();
  }

  setError(message) { this.error = message; this.mode = 'entry'; }

  /** @returns {'host'|'join'|'cancel'|null} */
  update() {
    this.frame++;
    for (const p of this.players) p.poll();
    if (this.canvas) mouse.sync(this.canvas);

    let result = null;
    if (this.mode === 'choose') result = this._updateChoose();
    else if (this.mode === 'entry') result = this._updateEntry();
    else if (this.mode === 'pick') result = this._updatePick();
    else {
      // Hosting or connecting: the only thing you can do is back out.
      for (const p of this.players) {
        if (p.consume('special') || p.consume('shield')) result = 'cancel';
      }
      if (keyboard.consumeTyped) keyboard.consumeTyped();
    }

    keyboard.flush();
    mouse.flush();
    return result;
  }

  _updateChoose() {
    let hovered = -1;
    if (mouse.present) {
      hovered = this.rects.findIndex((r) => r
        && mouse.x >= r.x && mouse.x <= r.x + r.w
        && mouse.y >= r.y && mouse.y <= r.y + r.h);
      if (hovered >= 0 && mouse.moved) this.index = hovered;
    }
    if (mouse.clicked && hovered >= 0) {
      this.index = hovered;
      return this._choose();
    }

    let dir = 0;
    for (const p of this.players) {
      if (Math.abs(p.menuY) > DEAD) { dir = Math.sign(p.menuY); break; }
    }
    if (dir === 0) { this.repeat.dir = 0; this.repeat.timer = 0; }
    else if (dir !== this.repeat.dir) {
      this.repeat.dir = dir; this.repeat.timer = REPEAT_FIRST;
      this.index = (this.index + dir + 2) % 2;
    } else if (--this.repeat.timer <= 0) {
      this.repeat.timer = REPEAT_NEXT;
      this.index = (this.index + dir + 2) % 2;
    }

    for (const p of this.players) {
      if (p.consume('attack') || p.consume('jump') || p.consume('start')) return this._choose();
      if (p.consume('special') || p.consume('shield')) return 'cancel';
    }
    return null;
  }

  _choose() {
    if (this.index === 0) { this.mode = 'connecting'; this.status = 'creating a match'; return 'host'; }
    this.mode = 'entry';
    this.digits = [];
    this.error = null;
    return null;
  }

  _updateEntry() {
    // Digits come from the typed-character stream rather than from key codes,
    // so a numpad and the number row both work without a second binding table.
    const typed = keyboard.takeTyped ? keyboard.takeTyped() : '';
    for (const ch of typed) {
      if (ch >= '0' && ch <= '9' && this.digits.length < 6) this.digits.push(ch);
      else if (ch === '\b') this.digits.pop();
    }
    if (this.digits.length === 6) {
      this.mode = 'connecting';
      this.status = 'connecting';
      return 'join';
    }
    for (const p of this.players) {
      if (p.consume('special') || p.consume('shield')) { this.mode = 'choose'; return null; }
    }
    return null;
  }

  get typedCode() { return this.digits.join(''); }

  /**
   * Fighter pick.
   *
   * Each player only ever chooses **their own** fighter, which is why this is
   * not the local character select. That screen owns two slots and decides who
   * is a CPU; online neither of those is true, and the two machines must not
   * negotiate a shared cursor over a link that already has everything it needs
   * to carry — an id each is enough.
   */
  startPicking(roster, stageName) {
    this.mode = 'pick';
    this.roster = roster;
    this.pickIndex = 0;
    this.locked = false;
    this.stageName = stageName;
    this.status = null;
    for (const p of this.players) p.clearBuffer();
  }

  _updatePick() {
    if (this.locked) {
      for (const p of this.players) {
        if (p.consume('special') || p.consume('shield')) return 'cancel';
      }
      return null;
    }
    let hovered = -1;
    if (mouse.present) {
      hovered = this.rects.findIndex((r) => r
        && mouse.x >= r.x && mouse.x <= r.x + r.w
        && mouse.y >= r.y && mouse.y <= r.y + r.h);
      if (hovered >= 0 && mouse.moved) this.pickIndex = hovered;
    }
    if (mouse.clicked && hovered >= 0) { this.pickIndex = hovered; this.locked = true; return 'pick'; }

    let dir = 0;
    for (const p of this.players) {
      if (Math.abs(p.menuX) > DEAD) { dir = Math.sign(p.menuX); break; }
    }
    if (dir === 0) { this.repeat.dir = 0; this.repeat.timer = 0; }
    else if (dir !== this.repeat.dir) {
      this.repeat.dir = dir; this.repeat.timer = REPEAT_FIRST;
      this.pickIndex = (this.pickIndex + dir + this.roster.length) % this.roster.length;
    } else if (--this.repeat.timer <= 0) {
      this.repeat.timer = REPEAT_NEXT;
      this.pickIndex = (this.pickIndex + dir + this.roster.length) % this.roster.length;
    }

    for (const p of this.players) {
      if (p.consume('attack') || p.consume('jump') || p.consume('start')) {
        this.locked = true;
        return 'pick';
      }
      if (p.consume('special') || p.consume('shield')) return 'cancel';
    }
    return null;
  }

  get pickedDef() { return this.roster ? this.roster[this.pickIndex] : null; }

  draw(ctx) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1b2338');
    g.addColorStop(0.55, '#111726');
    g.addColorStop(1, '#080b13');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const title = this.mode === 'hosting' ? 'YOUR CODE'
      : this.mode === 'entry' ? 'ENTER CODE'
        : this.mode === 'pick' ? (this.locked ? 'WAITING' : 'CHOOSE YOUR FIGHTER')
          : this.mode === 'connecting' ? 'PLEASE WAIT' : 'ONLINE MATCH';
    displayText(ctx, title, w / 2, h * 0.16, clamp(h * 0.072, 28, 68), {
      maxWidth: w * 0.9, align: 'center',
      fill: ['#fffdf3', '#c9bda4'], outline: '#241a2b', skew: -0.06,
    });

    if (this.mode === 'choose') this._drawChoose(ctx, w, h);
    else if (this.mode === 'pick') this._drawPick(ctx, w, h);
    else if (this.mode === 'hosting') this._drawCode(ctx, w, h, this.code, 'waiting for an opponent');
    else if (this.mode === 'entry') this._drawCode(ctx, w, h, this.typedCode.padEnd(6, '_'), 'type the six digits');
    else this._drawCode(ctx, w, h, this.code || this.typedCode || '······', this.status || '');

    if (this.error) {
      displayText(ctx, this.error.toUpperCase(), w / 2, h * 0.82, clamp(h * 0.032, 13, 24), {
        maxWidth: w * 0.85, align: 'center',
        fill: ['#ff9a9a', '#c05555'], outline: '#241a2b', skew: -0.04,
      });
    }
    const hint = this.mode === 'choose' ? 'B / SHIELD  —  BACK' : 'B / SHIELD  —  CANCEL';
    displayText(ctx, hint, w / 2, h * 0.92, clamp(h * 0.026, 11, 19), {
      maxWidth: w * 0.8, align: 'center',
      fill: ['#8f9bb3', '#5d6579'], outline: '#12161f', skew: -0.04,
    });
  }

  _drawChoose(ctx, w, h) {
    const itemW = Math.min(w * 0.44, h * 0.7);
    const itemH = clamp(h * 0.11, 46, 104);
    const gap = itemH * 0.26;
    const top = h * 0.40;
    const labels = ['HOST A MATCH', 'JOIN A MATCH'];
    this.rects = [];
    for (let i = 0; i < labels.length; i++) {
      const y = top + i * (itemH + gap);
      const x = w / 2 - itemW / 2;
      this.rects.push({ x, y, w: itemW, h: itemH });
      const selected = i === this.index;
      const cut = itemH * 0.19;
      const rough = itemH * 0.038;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = itemH * 0.10;
      ctx.shadowOffsetY = itemH * 0.08;
      roughRect(ctx, x, y, itemW, itemH, cut, rough, i + 1, 9);
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.restore();

      const face = ctx.createLinearGradient(0, y, 0, y + itemH);
      if (selected) {
        face.addColorStop(0, shade('#ffe9a3', 0.12));
        face.addColorStop(0.5, '#ffe9a3');
        face.addColorStop(1, shade('#e0a01e', -0.3));
      } else {
        face.addColorStop(0, '#39435c');
        face.addColorStop(0.5, '#2b3346');
        face.addColorStop(1, '#171c28');
      }
      const inset = itemH * 0.055;
      roughRect(ctx, x + inset, y + inset, itemW - inset * 2, itemH - inset * 2,
        cut * 0.8, rough * 0.8, i + 90, 9);
      ctx.fillStyle = face;
      ctx.fill();

      displayText(ctx, labels[i], w / 2, y + itemH * 0.63, itemH * 0.34, {
        align: 'center',
        fill: selected ? ['#fffdf3', '#e8dcc0'] : ['#e2e9f5', '#a8b4c8'],
        outline: '#241a2b', skew: -0.05, maxWidth: itemW - itemH * 0.6,
      });
    }
  }

  _drawPick(ctx, w, h) {
    const n = this.roster.length;
    const cardW = Math.min(w * 0.30, h * 0.34);
    const cardH = cardW * 1.24;
    const gap = cardW * 0.14;
    const total = cardW * n + gap * (n - 1);
    const left = (w - total) / 2;
    const top = h * 0.34;

    this.rects = [];
    for (let i = 0; i < n; i++) {
      const def = this.roster[i];
      const x = left + i * (cardW + gap);
      this.rects.push({ x, y: top, w: cardW, h: cardH });
      const selected = i === this.pickIndex;
      const cut = cardH * 0.09;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = cardH * 0.08;
      ctx.shadowOffsetY = cardH * 0.05;
      roughRect(ctx, x, top, cardW, cardH, cut, cardH * 0.018, i + 3, 8);
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.restore();

      const inset = cardH * 0.045;
      const gg = ctx.createLinearGradient(0, top, 0, top + cardH);
      if (selected) {
        gg.addColorStop(0, shade(def.color, 0.25));
        gg.addColorStop(1, shade(def.color, -0.45));
      } else {
        gg.addColorStop(0, '#2b3346');
        gg.addColorStop(1, '#161b26');
      }
      roughRect(ctx, x + inset, top + inset, cardW - inset * 2, cardH - inset * 2,
        cut * 0.8, cardH * 0.014, i + 60, 8);
      ctx.fillStyle = gg;
      ctx.fill();

      displayText(ctx, def.name.toUpperCase(), x + cardW / 2, top + cardH * 0.60,
        clamp(cardW * 0.155, 14, 34), {
          align: 'center',
          fill: selected ? ['#fffdf3', '#e8dcc0'] : ['#e2e9f5', '#a8b4c8'],
          outline: '#241a2b', skew: -0.05, maxWidth: cardW - inset * 3,
        });
      displayText(ctx, (def.archetype || '').toUpperCase(), x + cardW / 2, top + cardH * 0.78,
        clamp(cardW * 0.085, 10, 18), {
          align: 'center', fill: ['#cfd8e8', '#8f9bb3'], outline: '#12161f', skew: -0.04,
          maxWidth: cardW - inset * 3,
        });

      if (selected) {
        const pulse = 0.65 + 0.35 * Math.sin(this.frame * 0.15);
        roughRect(ctx, x - cardH * 0.018, top - cardH * 0.018,
          cardW + cardH * 0.036, cardH + cardH * 0.036, cut * 1.1, cardH * 0.01, i + 90, 8);
        ctx.strokeStyle = this.locked ? '#9fe870' : '#ffe9a3';
        ctx.globalAlpha = pulse;
        ctx.lineWidth = Math.max(2, cardH * 0.018);
        ctx.lineJoin = 'miter';
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    const caption = this.locked ? 'waiting for your opponent' : `stage: ${this.stageName || '?'}`;
    displayText(ctx, caption.toUpperCase(), w / 2, top + cardH * 1.22, clamp(h * 0.032, 13, 25), {
      maxWidth: w * 0.8, align: 'center',
      fill: ['#cfd8e8', '#8f9bb3'], outline: '#12161f', skew: -0.04,
    });
  }

  /** The six digits, boxed one per character so they are easy to read aloud. */
  _drawCode(ctx, w, h, code, caption) {
    this.rects = [];
    const text = String(code || '······').slice(0, 6).padEnd(6, '·');
    const boxW = Math.min(w * 0.115, h * 0.13);
    const gap = boxW * 0.18;
    const total = boxW * 6 + gap * 5;
    const left = (w - total) / 2;
    const top = h * 0.40;
    const boxH = boxW * 1.32;

    for (let i = 0; i < 6; i++) {
      const x = left + i * (boxW + gap);
      const filled = text[i] !== '·' && text[i] !== '_';
      roughRect(ctx, x, top, boxW, boxH, boxH * 0.14, boxH * 0.025, i + 5, 9);
      ctx.fillStyle = INK;
      ctx.fill();
      const inset = boxH * 0.06;
      const gg = ctx.createLinearGradient(0, top, 0, top + boxH);
      gg.addColorStop(0, filled ? '#39435c' : '#242b3a');
      gg.addColorStop(1, filled ? '#171c28' : '#141924');
      roughRect(ctx, x + inset, top + inset, boxW - inset * 2, boxH - inset * 2,
        boxH * 0.11, boxH * 0.02, i + 70, 9);
      ctx.fillStyle = gg;
      ctx.fill();

      if (filled) {
        displayText(ctx, text[i], x + boxW / 2, top + boxH * 0.74, boxH * 0.62, {
          align: 'center', fill: ['#ffe9a3', '#e0a01e'], outline: '#241a2b', skew: -0.05,
        });
      }
    }

    if (caption) {
      const pulse = 0.6 + 0.4 * Math.abs(Math.sin(this.frame * 0.05));
      ctx.save();
      ctx.globalAlpha = pulse;
      displayText(ctx, caption.toUpperCase(), w / 2, top + boxH * 1.55, clamp(h * 0.032, 13, 25), {
        maxWidth: w * 0.8, align: 'center',
        fill: ['#cfd8e8', '#8f9bb3'], outline: '#12161f', skew: -0.04,
      });
      ctx.restore();
    }
  }
}
