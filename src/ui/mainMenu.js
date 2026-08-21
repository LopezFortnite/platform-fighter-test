import { keyboard, mouse } from '../core/input.js';
import { clamp } from '../core/math.js';
import { displayText, drawLogo, drawBackgroundCover } from '../render/uiKit.js';
import { MenuList } from './menuList.js';

const MENU_BACKDROP = 'assets/menu-bg.png';

/**
 * The backdrop is a bright daytime painting and the buttons are light, so the
 * two need separating or the menu washes out against the sky. A vertical wash
 * plus a vignette darkens it enough to read against while leaving the scene
 * legible.
 */
function drawBackdropScrim(ctx, w, h) {
  const wash = ctx.createLinearGradient(0, 0, 0, h);
  wash.addColorStop(0, 'rgba(10,14,26,0.62)');
  wash.addColorStop(0.45, 'rgba(10,14,26,0.44)');
  wash.addColorStop(1, 'rgba(6,9,17,0.80)');
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, w, h);

  const vignette = ctx.createRadialGradient(
    w / 2, h * 0.45, Math.min(w, h) * 0.20,
    w / 2, h * 0.45, Math.max(w, h) * 0.75,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

/**
 * Main menu — the entry point.
 *
 * Training mode is present but locked; it is the next feature, and showing it
 * greyed out is more useful than hiding it.
 */
export class MainMenu {
  constructor(players, canvas = null) {
    this.players = players;
    this.list = new MenuList([
      { id: 'battle', label: 'NORMAL BATTLE' },
      { id: 'online', label: 'ONLINE MATCH' },
      { id: 'training', label: 'TRAINING MODE' },
    ]);
    /** One-line message shown under the buttons, e.g. why a link dropped. */
    this.notice = null;
    this.list.bindCanvas(canvas);
    this.frame = 0;
  }

  /** @returns {string|null} the chosen item id */
  update() {
    this.frame++;
    for (const p of this.players) p.poll();
    const action = this.list.update(this.players);
    keyboard.flush();
    mouse.flush();
    return action && action.type === 'confirm' ? action.item.id : null;
  }

  draw(ctx) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    // The painted backdrop when it has loaded, the character select's gradient
    // if it has not — the same treatment the other screens use, so the menu
    // stays coherent either way.
    if (drawBackgroundCover(ctx, MENU_BACKDROP, w, h)) {
      drawBackdropScrim(ctx, w, h);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1b2338');
      g.addColorStop(0.55, '#111726');
      g.addColorStop(1, '#080b13');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);

      const r = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, w * 0.6);
      r.addColorStop(0, 'rgba(228,69,159,0.12)');
      r.addColorStop(1, 'rgba(228,69,159,0)');
      ctx.fillStyle = r;
      ctx.fillRect(0, 0, w, h);
    }

    // With the strapline and the status footers gone, the logo and the two
    // buttons split the screen between them: logo through the top half,
    // buttons through the bottom.
    if (!drawLogo(ctx, w / 2, h * 0.32, w * 0.80, h * 0.36)) {
      const titleSize = clamp(h * 0.16, 44, 168);
      displayText(ctx, 'CLASH RUMBLE', w / 2, h * 0.37, titleSize, {
        maxWidth: w * 0.9,
        align: 'center', fill: ['#fffdf3', '#c9bda4'], outline: '#241a2b', skew: -0.06,
      });
    }

    const itemW = Math.min(w * 0.36, h * 0.62);
    const itemH = clamp(h * 0.09, 40, 92);
    const gap = itemH * 0.22;
    const topY = h * 0.57;
    this.list.draw(ctx, w / 2, topY, itemW, itemH, gap);

    if (this.notice) {
      displayText(ctx, this.notice.toUpperCase(), w / 2, h * 0.95, clamp(h * 0.028, 12, 21), {
        maxWidth: w * 0.8, align: 'center',
        fill: ['#ff9a9a', '#c05555'], outline: '#241a2b', skew: -0.04,
      });
    }
  }
}
