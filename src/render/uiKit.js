/**
 * Shared UI drawing kit.
 *
 * The chunky outlined type, the rounded character card and the portrait
 * loader are used by both the in-game HUD and the character select, so they
 * live here rather than being duplicated in each screen.
 */

export const FONT_STACK = '"Segoe UI Black", "Arial Black", "Trebuchet MS", sans-serif';
export const INK = '#14161f';

/** Elixir pink, matching the Clash Royale bar. */
export const ELIXIR_LIGHT = '#ff72e2';
export const ELIXIR_MID = '#e4459f';
export const ELIXIR_DARK = '#9c1478';

/**
 * Deterministic per-vertex noise.
 *
 * The roughness has to be identical every frame or the edges crawl and the
 * panel looks like it is boiling, so it is derived from the vertex index rather
 * than from a random source.
 */
function jitterAt(seed, i) {
  const s = Math.sin((seed * 311.7 + i * 127.1)) * 43758.5453;
  const v = (s - Math.floor(s)) * 2 - 1;          // -1..1, flat
  // Squared, so most vertices sit almost on the true edge and only a few take
  // a real bite out of it. Spread evenly the edge reads as a wave rather than
  // as something chipped.
  return Math.sign(v) * v * v;
}

/**
 * A rectangle with its corners cut off and its edges chipped — the chiselled
 * counterpart to `roundRect`, for surfaces that should read as cut stone or
 * stamped metal rather than as a soft app button.
 *
 * @param {number} cut     length of the corner chamfer
 * @param {number} rough   how far an edge vertex can wander, in pixels
 * @param {number} seed    fixes the chip pattern for this shape
 * @param {number} segs    vertices per edge; more means finer chipping
 */
export function roughRect(ctx, x, y, w, h, cut, rough = 0, seed = 1, segs = 3) {
  const c = Math.min(cut, w / 2, h / 2);
  // Perimeter of the chamfered box, in order.
  const pts = [
    [x + c, y], [x + w - c, y],
    [x + w, y + c], [x + w, y + h - c],
    [x + w - c, y + h], [x + c, y + h],
    [x, y + h - c], [x, y + c],
  ];

  ctx.beginPath();
  let n = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    if (i === 0) ctx.moveTo(a[0], a[1]);
    else ctx.lineTo(a[0], a[1]);
    if (rough <= 0) continue;

    // Walk the edge, pushing each interior vertex along the edge normal.
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    for (let s = 1; s < segs; s++) {
      const t = s / segs;
      const j = jitterAt(seed, n++) * rough;
      ctx.lineTo(a[0] + dx * t + nx * j, a[1] + dy * t + ny * j);
    }
  }
  ctx.closePath();
}

export function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/** Mixes two hex colours. */
export function mix(a, b, t) {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

export function shade(hex, amount) {
  return mix(hex, amount > 0 ? '#ffffff' : '#000000', Math.abs(amount));
}

/**
 * Chunky outlined display text: heavy face, thick dark outline, soft drop
 * shadow, slight forward lean. The signature treatment from the UI mock.
 */
export function displayText(ctx, text, x, y, size, opts = {}) {
  const {
    align = 'left', fill = '#fffdf3', outline = '#241a2b',
    outlineScale = 0.26, skew = -0.07, shadow = true, alpha = 1, maxWidth = 0,
  } = opts;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.font = `900 ${size}px ${FONT_STACK}`;

  // Shrink to fit rather than overrun neighbouring UI.
  if (maxWidth > 0) {
    while (size > 6 && ctx.measureText(text).width > maxWidth) {
      size -= 0.5;
      ctx.font = `900 ${size}px ${FONT_STACK}`;
    }
  }
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  // Mitred joins, not round: the outline then comes to a point at every corner
  // of the letterform instead of being sanded off, which is the difference
  // between chiselled type and a soft app label. The limit is low because an
  // outline this thick will otherwise throw long spikes off the sharpest
  // corners of the glyphs.
  ctx.lineJoin = 'miter';
  ctx.miterLimit = 2.6;
  ctx.lineCap = 'butt';

  ctx.translate(x, y);
  ctx.transform(1, 0, skew, 1, 0, 0);

  if (shadow) {
    // A hard offset drop, not a blur — it reads as a raised slab.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillText(text, size * 0.035, size * 0.10);
  }
  ctx.strokeStyle = outline;
  ctx.lineWidth = size * outlineScale;
  ctx.strokeText(text, 0, 0);

  if (typeof fill === 'string') ctx.fillStyle = fill;
  else {
    const g = ctx.createLinearGradient(0, -size * 0.75, 0, size * 0.15);
    g.addColorStop(0, fill[0]);
    g.addColorStop(1, fill[1]);
    ctx.fillStyle = g;
  }
  ctx.fillText(text, 0, 0);
  const width = ctx.measureText(text).width;
  ctx.restore();
  // Callers that need to place something beside the text use the width it
  // actually rendered at, which may be smaller than requested via maxWidth.
  return { size, width };
}

/** Loads and caches an image; callers check `ready` and draw a fallback until then. */
const imageCache = new Map();
export function getImage(src) {
  if (!src) return null;
  let entry = imageCache.get(src);
  if (!entry) {
    const img = new Image();
    entry = { img, ready: false, failed: false };
    img.onload = () => { entry.ready = true; };
    img.onerror = () => { entry.failed = true; };
    img.src = src;
    imageCache.set(src, entry);
  }
  return entry;
}

/** Card portraits; missing files fall back to placeholder art. */
export const getPortrait = getImage;

/**
 * Fills the canvas with an image, scaled to cover and centred — the same rule
 * as CSS `background-size: cover`, so a menu backdrop fills any window shape
 * without letterboxing or stretching. Returns false if the art is not loaded.
 */
export function drawBackgroundCover(ctx, src, w, h) {
  const entry = getImage(src);
  if (!entry || !entry.ready) return false;
  const img = entry.img;
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return true;
}

/**
 * The game logo, keyed and trimmed once on load.
 *
 * The source art is a white plate, not a transparent PNG, so it would render as
 * a white slab on a dark menu.
 *
 * Two things make this more than a threshold. White is not only *around* the
 * logo — it fills the pockets between CLASH and RUMBLE, the counters of the A
 * and E, the gap before the shield — so the key cannot be limited to background
 * reachable from the border. And the artwork's own highlights (the shine on the
 * sword blades, the tops of the stone caps) run bright, so the cut has to land
 * above them or it eats the art.
 *
 * The white sits at 243+ on all channels and the brightest highlight that must
 * survive is well under that, so a flat key at LOGO_KEY separates them cleanly.
 * The remaining problem is the antialiased boundary: a hard cut leaves a rim of
 * half-white pixels that reads as a halo on a dark background. Those are faded
 * out across LOGO_FEATHER..LOGO_KEY and un-blended back toward their true
 * colour, but only where they touch keyed pixels — the same brightness in the
 * middle of a blade is a highlight and is left alone.
 *
 * The result is trimmed to its content so callers can position it exactly
 * instead of compensating for the artwork's own margins.
 */
const LOGO_SRC = 'assets/logo.png';
/** At or above this, on all three channels, a pixel is background. */
const LOGO_KEY = 240;
/** Below this luminance an edge pixel is artwork, not a blend with the plate. */
const LOGO_FEATHER = 200;
let logoEntry = null;

export function getLogo() {
  if (logoEntry) return logoEntry;
  logoEntry = { canvas: null, ready: false, failed: false };
  const img = new Image();
  img.onload = () => {
    try {
      logoEntry.canvas = keyOutBackground(img);
      logoEntry.ready = true;
    } catch (err) {
      // Canvas reads are same-origin only; a failure here just means the menu
      // keeps its drawn title.
      console.warn('Logo could not be processed:', err);
      logoEntry.failed = true;
    }
  };
  img.onerror = () => { logoEntry.failed = true; };
  img.src = LOGO_SRC;
  return logoEntry;
}

function keyOutBackground(img) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const src = document.createElement('canvas');
  src.width = W; src.height = H;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0);
  const image = sctx.getImageData(0, 0, W, H);
  const d = image.data;
  const N = W * H;

  // Pass 1 — the plate itself, wherever it is. Enclosed pockets count.
  const bg = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    if (d[i] >= LOGO_KEY && d[i + 1] >= LOGO_KEY && d[i + 2] >= LOGO_KEY) bg[p] = 1;
  }

  // Pass 2 — the one-pixel-wide blend along every keyed edge. Marking the band
  // first is what keeps an interior highlight of the same brightness intact.
  const edge = new Uint8Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (bg[p]) continue;
      const touches = (x > 0 && bg[p - 1]) || (x < W - 1 && bg[p + 1])
        || (y > 0 && bg[p - W]) || (y < H - 1 && bg[p + W]);
      if (touches) edge[p] = 1;
    }
  }

  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    if (bg[p]) { d[i + 3] = 0; continue; }

    if (edge[p]) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (lum > LOGO_FEATHER) {
        const t = (lum - LOGO_FEATHER) / (LOGO_KEY - LOGO_FEATHER);
        const a = Math.max(0, Math.min(1, 1 - t));
        // The pixel is a blend of the real colour over white. Recover the real
        // colour, or the softened edge reads as a milky rim instead of fading.
        if (a > 0.12) {
          for (let k = 0; k < 3; k++) {
            d[i + k] = Math.max(0, Math.min(255, (d[i + k] - (1 - a) * 255) / a));
          }
        }
        d[i + 3] = Math.round(a * 255);
        if (a === 0) continue;
      }
    }

    const x = p % W, y = (p - x) / W;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  sctx.putImageData(image, 0, 0);

  if (maxX < minX) return src;    // nothing survived; hand back the original
  const out = document.createElement('canvas');
  out.width = maxX - minX + 1;
  out.height = maxY - minY + 1;
  out.getContext('2d').drawImage(src, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/**
 * Draws the logo to fit inside a box, preserving aspect and centring on
 * (cx, cy). Returns false when the art is not ready, so the caller can fall
 * back to drawing the title as text.
 */
export function drawLogo(ctx, cx, cy, maxW, maxH) {
  const entry = getLogo();
  if (!entry.ready || !entry.canvas) return false;
  const art = entry.canvas;
  const scale = Math.min(maxW / art.width, maxH / art.height);
  const w = art.width * scale, h = art.height * scale;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // A soft drop shadow seats it against the gradient instead of floating on it.
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = h * 0.09;
  ctx.shadowOffsetY = h * 0.035;
  ctx.drawImage(art, cx - w / 2, cy - h / 2, w, h);
  ctx.restore();
  return true;
}

/**
 * Draws a fighter's portrait art cropped to the region its data declares,
 * covering the given box. Returns false if the art is not available so the
 * caller can draw a placeholder.
 */
export function drawPortraitCrop(ctx, spec, x, y, w, h) {
  const entry = spec ? getPortrait(spec.src) : null;
  if (!entry || !entry.ready) return false;

  const img = entry.img;
  const c = spec.crop || [0, 0, 1, 1];
  const sx = c[0] * img.naturalWidth;
  const sy = c[1] * img.naturalHeight;
  const sw = c[2] * img.naturalWidth;
  const sh = c[3] * img.naturalHeight;
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale, dh = sh * scale;
  ctx.drawImage(img, sx, sy, sw, sh, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  return true;
}

/** Programmer-art bust, used until real portrait art exists for a fighter. */
export function drawPlaceholderBust(ctx, def, x, y, w, h) {
  const body = def.color;
  const accent = def.accent;
  const cx = x + w / 2;

  ctx.save();
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 1.06, w * 0.52, h * 0.42, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = shade(body, -0.2);
  ctx.fillRect(cx - w * 0.11, y + h * 0.52, w * 0.22, h * 0.2);
  ctx.fillStyle = shade(body, 0.42);
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.42, w * 0.24, h * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.30, w * 0.27, h * 0.13, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.ellipse(cx - w * 0.09, y + h * 0.43, w * 0.032, h * 0.042, 0, 0, Math.PI * 2);
  ctx.ellipse(cx + w * 0.09, y + h * 0.43, w * 0.032, h * 0.042, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * The rounded character card: dark rim, coloured frame band, portrait well.
 * `size` is the card's edge length; the whole thing scales from it.
 *
 * @param {object} [opts] glow: outer halo strength 0..1, radiusRatio, rimRatio
 */
export function drawCharacterCard(ctx, def, x, y, size, frameColor, opts = {}) {
  const {
    glow = 0, radiusRatio = 0.22, bandRatio = 0.04, wellRatio = 0.13,
  } = opts;
  const R = size * radiusRatio;
  const band = size * bandRatio;
  const well = size * wellRatio;

  ctx.save();
  if (glow > 0) {
    ctx.shadowColor = frameColor;
    ctx.shadowBlur = size * 0.18 * glow;
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = size * 0.1;
    ctx.shadowOffsetY = size * 0.04;
  }
  roundRect(ctx, x, y, size, size, R);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.restore();

  // Coloured frame band.
  const g = ctx.createLinearGradient(0, y, 0, y + size);
  g.addColorStop(0, shade(frameColor, 0.32));
  g.addColorStop(1, shade(frameColor, -0.24));
  roundRect(ctx, x + band, y + band, size - band * 2, size - band * 2, R - band);
  ctx.fillStyle = g;
  ctx.fill();

  // Inner highlight line.
  const hl = band * 2.1;
  roundRect(ctx, x + hl, y + hl, size - hl * 2, size - hl * 2, R - hl);
  ctx.strokeStyle = shade(frameColor, 0.5);
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.stroke();

  // Portrait well.
  const px = x + well, py = y + well;
  const pw = size - well * 2, ph = size - well * 2;
  const pr = R - well * 0.85;

  ctx.save();
  roundRect(ctx, px, py, pw, ph, pr);
  ctx.clip();
  ctx.fillStyle = shade(frameColor, -0.55);
  ctx.fillRect(px, py, pw, ph);
  if (!drawPortraitCrop(ctx, def.portrait, px, py, pw, ph)) {
    drawPlaceholderBust(ctx, def, px, py, pw, ph);
  }
  const gl = ctx.createLinearGradient(0, py, 0, py + ph);
  gl.addColorStop(0, 'rgba(255,255,255,0.20)');
  gl.addColorStop(0.45, 'rgba(255,255,255,0.03)');
  gl.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = gl;
  ctx.fillRect(px, py, pw, ph);
  ctx.restore();

  roundRect(ctx, px, py, pw, ph, pr);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.stroke();

  roundRect(ctx, x + size * 0.015, y + size * 0.015, size * 0.97, size * 0.97, R - size * 0.01);
  ctx.strokeStyle = '#0b0d14';
  ctx.lineWidth = Math.max(1.5, size * 0.03);
  ctx.stroke();
}

/**
 * Shrinks the font until `text` fits `maxW`, then draws it centred at (cx, y).
 * Used for roster slot names, which vary from "Monk" to "Goblin Demolisher".
 */
export function fitText(ctx, text, cx, y, maxW, startSize, minSize = 6, weight = 900) {
  let size = startSize;
  ctx.font = `${weight} ${size}px ${FONT_STACK}`;
  while (size > minSize && ctx.measureText(text).width > maxW) {
    size -= 0.5;
    ctx.font = `${weight} ${size}px ${FONT_STACK}`;
  }
  ctx.fillText(text, cx, y);
  return size;
}

/**
 * Draws a slot label, breaking it onto two lines rather than shrinking a long
 * multi-word name into illegibility. "GOBLIN DEMOLISHER" stays readable in the
 * same cell that holds "MONK".
 */
export function fitLabel(ctx, text, cx, y, maxW, maxSize, minSize = 5) {
  ctx.font = `900 ${maxSize}px ${FONT_STACK}`;
  if (ctx.measureText(text).width <= maxW) {
    ctx.fillText(text, cx, y);
    return;
  }

  const words = text.split(' ');
  if (words.length < 2) {
    fitText(ctx, text, cx, y, maxW, maxSize, minSize);
    return;
  }

  // Split where the two halves are most even.
  let best = 1, bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(' ');
    const b = words.slice(i).join(' ');
    const score = Math.abs(a.length - b.length);
    if (score < bestScore) { bestScore = score; best = i; }
  }
  const l1 = words.slice(0, best).join(' ');
  const l2 = words.slice(best).join(' ');

  // Shrink until the wider line fits.
  let size = maxSize;
  ctx.font = `900 ${size}px ${FONT_STACK}`;
  while (size > minSize
    && Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) > maxW) {
    size -= 0.5;
    ctx.font = `900 ${size}px ${FONT_STACK}`;
  }
  ctx.fillText(l1, cx, y - size * 0.55);
  ctx.fillText(l2, cx, y + size * 0.55);
}

/** Padlock glyph for locked roster slots. */
export function drawLock(ctx, cx, cy, size, color = '#8d94a8') {
  const w = size * 0.72, h = size * 0.58;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.4, size * 0.13);
  ctx.lineCap = 'round';
  // Shackle.
  ctx.beginPath();
  ctx.arc(cx, cy - h * 0.34, w * 0.32, Math.PI, 0);
  ctx.stroke();
  // Body.
  ctx.fillStyle = color;
  roundRect(ctx, cx - w / 2, cy - h * 0.06, w, h, size * 0.12);
  ctx.fill();
  // Keyhole.
  ctx.fillStyle = 'rgba(20,22,31,0.85)';
  ctx.beginPath();
  ctx.arc(cx, cy + h * 0.26, size * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/**
 * Smash-style pointing hand cursor. The fingertip is the hot spot at (x, y);
 * the fist trails down-right from it.
 */
export function drawHandCursor(ctx, x, y, size, color, opts = {}) {
  const { label = null, alpha = 1 } = opts;
  const s = size;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);

  ctx.shadowColor = 'rgba(0,0,0,0.5)';
  ctx.shadowBlur = s * 0.25;
  ctx.shadowOffsetY = s * 0.08;

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = s * 0.15;

  // Fist.
  const fx = s * 0.62, fy = s * 0.86;
  ctx.beginPath();
  ctx.ellipse(fx, fy, s * 0.42, s * 0.38, -0.25, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.stroke();
  ctx.fill();

  // Pointing index finger, from the fist up to the hot spot.
  ctx.beginPath();
  ctx.moveTo(s * 0.06, s * 0.10);
  ctx.lineTo(fx - s * 0.12, fy - s * 0.30);
  ctx.lineWidth = s * 0.40;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = s * 0.24;
  ctx.strokeStyle = color;
  ctx.stroke();

  // Thumb.
  ctx.beginPath();
  ctx.moveTo(fx + s * 0.30, fy - s * 0.16);
  ctx.lineTo(fx + s * 0.52, fy + s * 0.16);
  ctx.lineWidth = s * 0.28;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = s * 0.15;
  ctx.strokeStyle = color;
  ctx.stroke();

  ctx.shadowColor = 'transparent';

  // Fingertip highlight, so the hot spot is unambiguous.
  ctx.beginPath();
  ctx.arc(s * 0.06, s * 0.10, s * 0.10, 0, Math.PI * 2);
  ctx.fillStyle = shade(color, 0.55);
  ctx.fill();

  if (label) {
    ctx.beginPath();
    ctx.arc(fx + s * 0.18, fy + s * 0.62, s * 0.34, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = s * 0.10;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${s * 0.40}px ${FONT_STACK}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, fx + s * 0.18, fy + s * 0.64);
  }

  ctx.restore();
}

/** Wraps text to a width, returning the number of lines drawn. */
export function wrapText(ctx, text, cx, y, maxW, lineH) {
  const words = text.split(' ');
  let line = '';
  let yy = y;
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, cx, yy);
      line = word;
      yy += lineH;
      lines++;
    } else {
      line = test;
    }
  }
  if (line) { ctx.fillText(line, cx, yy); lines++; }
  return lines;
}
