import {
  INK, roughRect, shade, displayText, drawLock,
} from '../render/uiKit.js';
import { mouse } from '../core/input.js';

/**
 * A vertical, controller-navigable menu list.
 *
 * Shared by the main menu and the pause menu so both navigate identically and
 * look like the rest of the UI. Any connected player can drive it — menus
 * should never care which pad is "player one".
 */

const REPEAT_FIRST = 22;
const REPEAT_NEXT = 8;
const DEAD = 0.55;

export class MenuList {
  /**
   * @param {Array<{id:string,label:string,locked?:boolean}>} items
   * @param {{startConfirms?:boolean, startCancels?:boolean, cancelId?:string}} opts
   */
  constructor(items, opts = {}) {
    this.items = items;
    this.index = items.findIndex((i) => !i.locked);
    if (this.index < 0) this.index = 0;
    this.startConfirms = opts.startConfirms !== false;
    this.startCancels = !!opts.startCancels;
    this.repeat = { dir: 0, timer: 0 };
    this.denyFlash = 0;
    this.moveAnim = 0;
    this.frame = 0;
    /** Item rects from the last draw, so the mouse can pick them directly. */
    this.rects = [];
    this.canvas = null;
  }

  /** Lets the list convert mouse position into canvas space. */
  bindCanvas(canvas) { this.canvas = canvas; }

  move(dir) {
    this.index = (this.index + dir + this.items.length) % this.items.length;
    this.moveAnim = 8;
  }

  /**
   * @param {Array} players PlayerInput instances
   * @returns {{type:'confirm'|'cancel', item?:object}|null}
   */
  update(players) {
    this.frame++;
    if (this.denyFlash > 0) this.denyFlash--;
    if (this.moveAnim > 0) this.moveAnim--;

    // Mouse: hovering highlights an entry, clicking it confirms.
    if (this.canvas) mouse.sync(this.canvas);
    let hoveredByMouse = -1;
    if (mouse.present) {
      hoveredByMouse = this.rects.findIndex((r) => r
        && mouse.x >= r.x && mouse.x <= r.x + r.w
        && mouse.y >= r.y && mouse.y <= r.y + r.h);
      if (hoveredByMouse >= 0 && mouse.moved) this.index = hoveredByMouse;
    }
    if (mouse.clicked) {
      if (hoveredByMouse >= 0) {
        const item = this.items[hoveredByMouse];
        this.index = hoveredByMouse;
        if (item.locked) { this.denyFlash = 20; return null; }
        return { type: 'confirm', item };
      }
    }

    let dir = 0;
    for (const p of players) {
      const y = p.menuY;
      if (Math.abs(y) > DEAD) { dir = Math.sign(y); break; }
    }

    if (dir === 0) {
      this.repeat.dir = 0;
      this.repeat.timer = 0;
    } else if (dir !== this.repeat.dir) {
      this.repeat.dir = dir;
      this.repeat.timer = REPEAT_FIRST;
      this.move(dir);
    } else if (--this.repeat.timer <= 0) {
      this.repeat.timer = REPEAT_NEXT;
      this.move(dir);
    }

    for (const p of players) {
      const start = p.peek('start');
      if (this.startCancels && start) { p.consume('start'); return { type: 'cancel' }; }

      if (p.consume('attack') || p.consume('jump') || (this.startConfirms && p.consume('start'))) {
        const item = this.items[this.index];
        if (item.locked) { this.denyFlash = 20; return null; }
        return { type: 'confirm', item };
      }
      if (p.consume('special') || p.consume('shield')) return { type: 'cancel' };
    }
    return null;
  }

  /** Total height this list occupies, for centring by the caller. */
  height(itemH, gap) {
    return this.items.length * itemH + (this.items.length - 1) * gap;
  }

  /**
   * @param {number} cx centre x
   * @param {number} topY top of the first item
   * @param {[string,string]} accent [light, dark] highlight colours
   */
  draw(ctx, cx, topY, w, itemH, gap, accent = ['#ffe9a3', '#e0a01e']) {
    this.rects = [];
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const y = topY + i * (itemH + gap);
      this.rects.push({ x: cx - w / 2, y, w, h: itemH });
      const selected = i === this.index;
      const denying = selected && this.denyFlash > 0;
      const shake = denying ? Math.sin(this.frame * 1.3) * itemH * 0.05 : 0;

      const pop = selected && this.moveAnim > 0 ? 1 + (this.moveAnim / 8) * 0.03 : 1;
      const x = cx - w / 2 + shake;

      ctx.save();
      ctx.translate(cx, y + itemH / 2);
      ctx.scale(pop, pop);
      ctx.translate(-cx, -(y + itemH / 2));

      // Chamfered and chipped rather than rounded. The seed is the item's own
      // index, so each entry has its own chip pattern and keeps it — the shape
      // must not change frame to frame or the edges crawl.
      const cut = itemH * 0.19;
      const rough = itemH * 0.038;
      const seed = i + 1;
      const inset = itemH * 0.055;
      const SEGS = 9;

      // Slab.
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = itemH * 0.10;
      ctx.shadowOffsetY = itemH * 0.08;
      roughRect(ctx, x, y, w, itemH, cut, rough, seed, SEGS);
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.restore();

      const g = ctx.createLinearGradient(0, y, 0, y + itemH);
      if (item.locked) {
        g.addColorStop(0, '#333846');
        g.addColorStop(0.5, '#2a2f3c');
        g.addColorStop(1, '#20242f');
      } else if (selected) {
        // A hard step partway down instead of a smooth ramp, so the face reads
        // as two bevelled planes catching the light rather than as a gel pill.
        g.addColorStop(0, shade(accent[0], 0.12));
        g.addColorStop(0.48, accent[0]);
        g.addColorStop(0.52, shade(accent[1], -0.06));
        g.addColorStop(1, shade(accent[1], -0.32));
      } else {
        g.addColorStop(0, '#39435c');
        g.addColorStop(0.48, '#2b3346');
        g.addColorStop(0.52, '#232a3a');
        g.addColorStop(1, '#171c28');
      }
      const face = () => roughRect(ctx, x + inset, y + inset, w - inset * 2, itemH - inset * 2,
        cut * 0.8, rough * 0.8, seed + 90, SEGS);
      face();
      ctx.fillStyle = g;
      ctx.fill();

      // Bevel. Stroking the face's own path with a top-to-bottom gradient lights
      // the chipped contour itself — drawing straight highlight lines instead
      // leaves them floating free of the edge they are supposed to be catching.
      const bevel = ctx.createLinearGradient(0, y, 0, y + itemH);
      bevel.addColorStop(0, item.locked ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.42)');
      bevel.addColorStop(0.5, 'rgba(255,255,255,0.04)');
      bevel.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.save();
      face();
      ctx.clip();
      face();
      ctx.strokeStyle = bevel;
      ctx.lineWidth = Math.max(2, itemH * 0.10);
      ctx.lineJoin = 'miter';
      ctx.stroke();
      ctx.restore();

      // Rim.
      if (selected && !item.locked) {
        const pulse = 0.65 + 0.35 * Math.sin(this.frame * 0.15);
        // The rim is the selection indicator, so it is the calmest edge of the
        // three — a jagged gold outline is hard to read as "this one".
        roughRect(ctx, x - itemH * 0.03, y - itemH * 0.03,
          w + itemH * 0.06, itemH + itemH * 0.06, cut * 1.12, rough * 0.5, seed + 40, SEGS);
        ctx.strokeStyle = denying ? '#b04a4a' : accent[0];
        ctx.globalAlpha = pulse;
        ctx.lineWidth = Math.max(2, itemH * 0.055);
        ctx.lineJoin = 'miter';
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Label.
      const fill = item.locked
        ? ['#9aa4ba', '#5d6579']
        : selected ? ['#fffdf3', '#e8dcc0'] : ['#e2e9f5', '#a8b4c8'];
      displayText(ctx, item.label, cx, y + itemH * 0.63, itemH * 0.36, {
        align: 'center', fill, outline: '#241a2b', skew: -0.05,
        maxWidth: w - itemH * (item.locked ? 1.5 : 0.6),
      });

      // The selected entry is already unmistakable from its gold fill, so it
      // carries no extra marker — that only crowded the label.
      if (item.locked) {
        drawLock(ctx, x + itemH * 0.42, y + itemH * 0.5, itemH * 0.3, '#7b8398');
      }

      ctx.restore();
    }
  }
}
