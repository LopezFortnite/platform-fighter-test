import { keyboard, mouse } from '../core/input.js';
import { clamp } from '../core/math.js';
import { FONT_STACK, displayText } from '../render/uiKit.js';
import { MenuList } from './menuList.js';

/**
 * In-match pause menu.
 *
 * Drawn over the frozen battle. The match is not stepped while this is open,
 * so pausing costs no simulation frames and resuming is exact.
 */
export class PauseMenu {
  /**
   * @param {Array} players PlayerInput instances
   * @param {number} pausedBy index of the player who paused
   * @param {string} accent that player's colour
   */
  constructor(players, pausedBy = 0, accent = '#d2382f', canvas = null, opts = {}) {
    this.players = players;
    this.pausedBy = pausedBy;
    this.accent = accent;
    /**
     * Training gets one extra row. It **toggles in place** rather than closing
     * the menu, so flipping it is one button press and you can see the new
     * state before resuming — the whole point is to stop breaking flow while
     * testing specials.
     */
    this.training = !!opts.training;
    this.infiniteElixir = !!opts.infiniteElixir;
    const items = [
      { id: 'resume', label: 'RESUME' },
      { id: 'restart', label: 'RESTART BATTLE' },
    ];
    if (this.training) items.push({ id: 'elixir', label: this.elixirLabel() });
    items.push({ id: 'select', label: 'CHARACTER SELECT' });
    items.push({ id: 'main', label: 'MAIN MENU' });
    this.list = new MenuList(items, { startConfirms: false, startCancels: true });
    this.list.bindCanvas(canvas);
    this.frame = 0;

    // Swallow anything queued before the pause so resuming does not fire a
    // buffered attack, and the Start press that opened this does not confirm.
    for (const p of players) p.clearBuffer();
  }

  elixirLabel() {
    return 'INFINITE ELIXIR: ' + (this.infiniteElixir ? 'ON' : 'OFF');
  }

  /** @returns {string|null} chosen action id ('resume' on cancel) */
  update() {
    this.frame++;
    for (const p of this.players) p.poll();
    const action = this.list.update(this.players);
    keyboard.flush();
    mouse.flush();
    if (!action) return null;
    if (action.type === 'cancel') return 'resume';
    // Toggled in place: flip it, relabel it, and stay open.
    if (action.item.id === 'elixir') {
      this.infiniteElixir = !this.infiniteElixir;
      action.item.label = this.elixirLabel();
      return 'elixir';
    }
    return action.item.id;
  }

  draw(ctx) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    ctx.save();
    ctx.fillStyle = 'rgba(6,8,16,0.78)';
    ctx.fillRect(0, 0, w, h);
    const r = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h * 0.45, w * 0.5);
    r.addColorStop(0, 'rgba(228,69,159,0.10)');
    r.addColorStop(1, 'rgba(228,69,159,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    const titleSize = clamp(h * 0.085, 34, 88);
    displayText(ctx, 'PAUSED', w / 2, h * 0.195, titleSize, {
      align: 'center', fill: ['#fffdf3', '#c9bda4'], outline: '#241a2b', skew: -0.06,
    });

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `900 ${Math.round(clamp(h * 0.024, 12, 22))}px ${FONT_STACK}`;
    ctx.fillStyle = this.accent;
    ctx.fillText(`BY PLAYER ${this.pausedBy + 1}`, w / 2, h * 0.234);
    ctx.restore();

    // Sized so the whole block clears the HUD panels along the bottom.
    const itemW = Math.min(w * 0.34, h * 0.58);
    const itemH = clamp(h * 0.088, 40, 92);
    const gap = itemH * 0.19;
    const topY = h * 0.285;
    this.list.draw(ctx, w / 2, topY, itemW, itemH, gap);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `700 ${Math.round(clamp(h * 0.0175, 10, 16))}px ${FONT_STACK}`;
    ctx.fillStyle = 'rgba(190,204,226,0.6)';
    ctx.fillText('A / ATTACK: CONFIRM   ·   B / SPECIAL / START: RESUME',
      w / 2, topY + this.list.height(itemH, gap) + h * 0.042);
    ctx.restore();
  }
}
