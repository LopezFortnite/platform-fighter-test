import { keyboard, mouse } from '../core/input.js';
import { clamp } from '../core/math.js';
import { MenuList } from './menuList.js';

/**
 * End-of-match options, drawn over the result overlay.
 *
 * The result screen used to rely on remembering which button did what, which
 * left players stuck staring at it. This gives the same explicit, navigable
 * list every other menu uses — d-pad, keys or mouse.
 */
export class ResultMenu {
  constructor(players, canvas = null) {
    this.players = players;
    this.list = new MenuList([
      { id: 'rematch', label: 'REMATCH' },
      { id: 'select', label: 'CHARACTER SELECT' },
      { id: 'main', label: 'MAIN MENU' },
    ], { startConfirms: true });
    this.list.bindCanvas(canvas);
    this.frame = 0;
    for (const p of players) p.clearBuffer();
  }

  /** @returns {string|null} chosen action id */
  update() {
    this.frame++;
    for (const p of this.players) p.poll();
    const action = this.list.update(this.players);
    keyboard.flush();
    mouse.flush();
    if (!action) return null;
    // Cancel is the same as backing out to the roster.
    return action.type === 'cancel' ? 'select' : action.item.id;
  }

  draw(ctx, w, h) {
    const itemW = Math.min(w * 0.34, h * 0.5);
    const itemH = clamp(h * 0.062, 32, 66);
    const gap = itemH * 0.2;
    const topY = h * 0.62;
    this.list.draw(ctx, w / 2, topY, itemW, itemH, gap);
  }
}
