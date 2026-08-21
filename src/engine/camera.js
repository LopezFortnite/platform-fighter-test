import { CAMERA } from '../config/gameplay.js';
import { clamp, lerp } from '../core/math.js';

/**
 * Camera that frames all live fighters, zooming out as they separate.
 * Smoothed rather than snapped — a jittery camera reads as unresponsive
 * gameplay even when the simulation is perfect.
 */
export class Camera {
  constructor(viewWidth, viewHeight) {
    this.x = 0; this.y = -120;
    this.zoom = 0.8;
    this.targetX = 0; this.targetY = -120;
    this.targetZoom = 0.8;
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.shake = 0;
    this.shakeX = 0; this.shakeY = 0;
    this._rand = 0;
  }

  resize(w, h) { this.viewWidth = w; this.viewHeight = h; }

  addShake(knockback) {
    this.shake = Math.min(CAMERA.SHAKE_MAX, this.shake + knockback * CAMERA.SHAKE_PER_KB);
  }

  /** @param {Array<{x:number,y:number,alive:boolean}>} targets */
  update(targets, stage) {
    const live = targets.filter((t) => t.alive);
    if (live.length) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const t of live) {
        minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x);
        minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y);
      }
      this.targetX = (minX + maxX) / 2;
      this.targetY = (minY + maxY) / 2 - 70;

      const spanX = (maxX - minX) + CAMERA.PADDING_X;
      const spanY = (maxY - minY) + CAMERA.PADDING_Y;
      const zoomX = this.viewWidth / spanX;
      const zoomY = this.viewHeight / spanY;
      this.targetZoom = clamp(Math.min(zoomX, zoomY), CAMERA.MIN_ZOOM, CAMERA.MAX_ZOOM);
    }

    // Never show past the blast zones; seeing the void breaks the illusion.
    if (stage) {
      const b = stage.blastZones;
      const halfW = this.viewWidth / (2 * this.targetZoom);
      const halfH = this.viewHeight / (2 * this.targetZoom);
      if (b.right - b.left > halfW * 2) {
        this.targetX = clamp(this.targetX, b.left + halfW, b.right - halfW);
      } else {
        this.targetX = (b.left + b.right) / 2;
      }
      if (b.bottom - b.top > halfH * 2) {
        this.targetY = clamp(this.targetY, b.top + halfH, b.bottom - halfH);
      } else {
        this.targetY = (b.top + b.bottom) / 2;
      }
    }

    this.x = lerp(this.x, this.targetX, CAMERA.LERP);
    this.y = lerp(this.y, this.targetY, CAMERA.LERP);
    this.zoom = lerp(this.zoom, this.targetZoom, CAMERA.ZOOM_LERP);

    if (this.shake > 0.05) {
      this._rand = (this._rand * 1103515245 + 12345) & 0x7fffffff;
      const a = (this._rand / 0x7fffffff) * Math.PI * 2;
      this.shakeX = Math.cos(a) * this.shake;
      this.shakeY = Math.sin(a) * this.shake;
      this.shake *= CAMERA.SHAKE_DECAY;
    } else {
      this.shake = 0; this.shakeX = 0; this.shakeY = 0;
    }
  }

  /** Applies the camera transform to a 2D context. */
  apply(ctx) {
    ctx.translate(this.viewWidth / 2, this.viewHeight / 2);
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(-(this.x + this.shakeX), -(this.y + this.shakeY));
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - (this.x + this.shakeX)) * this.zoom + this.viewWidth / 2,
      y: (wy - (this.y + this.shakeY)) * this.zoom + this.viewHeight / 2,
    };
  }
}
