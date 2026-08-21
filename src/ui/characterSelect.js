import { keyboard, mouse } from '../core/input.js';
import { clamp } from '../core/math.js';
import { ROSTER_FLAT, TOTAL_SLOTS, findSlot } from '../data/roster.js';
import { CPU_LEVELS, CPU_ORDER } from '../config/cpu.js';
import {
  FONT_STACK, INK, roundRect, shade, displayText,
  drawCharacterCard, drawHandCursor, drawLock, fitLabel,
} from '../render/uiKit.js';

/**
 * Smash-style roster grid.
 *
 * All 61 fighters from the design document sit in one continuous grid. Only
 * the two with data files are selectable; the rest are locked slots, named so
 * the intended roster reads at a glance.
 *
 * Each player drives a free-roaming hand cursor — left stick or mouse moves it
 * anywhere on screen, and whichever slot sits under the fingertip is the one
 * that gets picked. Attack/A (or a mouse click) locks in, Special/B cancels,
 * Start begins the match.
 */

/** Column counts that leave a reasonably full last row for 61 slots. */
const COLUMN_CANDIDATES = [8, 9, 11, 13];

/** Cursor travel at full stick tilt, as a fraction of canvas height per frame. */
const CURSOR_SPEED = 0.0155;
/** Response curve exponent — higher gives finer control near centre. */
const CURSOR_GAMMA = 1.6;

export class CharacterSelect {
  /**
   * @param {Array} players PlayerInput instances
   * @param {string[]} frameColors per-player cursor / card colour
   * @param {HTMLCanvasElement} canvas used to map mouse position into canvas space
   * @param {'battle'|'training'} mode
   * @param {string|null} cpuLevel difficulty when player 2 is a CPU
   *
   * Whenever player 2 is not a human — training dummy or CPU — there is only
   * one person at the screen, so a single cursor picks both fighters in turn.
   */
  constructor(players, frameColors = [], canvas = null, mode = 'battle', cpuLevel = null) {
    this.players = players;
    this.frameColors = frameColors;
    this.canvas = canvas;
    this.mode = mode;
    this.training = mode === 'training';
    /**
     * Player 2's slot type, cycled on this screen the way Smash does it:
     * null means a second human, otherwise it is a CPU difficulty.
     */
    this.cpuLevel = cpuLevel;
    /** Solo only: 0 = choosing your fighter, 1 = choosing the opponent's. */
    this.step = 0;
    /** Difficulty remembered while player 2 is switched back to a human. */
    this.lastCpuLevel = cpuLevel || 'normal';
    /** Screen rects of the slot-type chip and difficulty cells, set while drawing. */
    this._typeChip = null;
    this._diffCells = [];
    this._chipHot = false;
    this._diffHot = -1;
    /**
     * Bounds of the interactive UI outside the grid. The cursor clamp is
     * derived from these as well as the grid, so a target can never sit
     * somewhere the cursor is forbidden to go.
     */
    this._uiBottom = 0;
    this._uiLeft = Infinity;
    this._uiRight = 0;
    this.slots = ROSTER_FLAT;

    this.ready = players.map(() => false);
    /** Slot index locked in, once ready. */
    this.chosen = players.map(() => -1);
    /** Free-roaming pointer, in canvas pixels. Initialised on first layout. */
    this.pointer = players.map(() => null);
    /** Slot currently under the fingertip, or -1. */
    this.hovered = players.map(() => -1);
    /** Last valid hover, so the info bar does not flicker between slots. */
    this.lastHover = players.map((_, i) => findSlot(['bandit', 'wizard'][i] || 'bandit'));
    this.denyFlash = players.map(() => 0);
    /** Player 0 hands control to the mouse as soon as it moves. */
    this.mouseOwner = 0;
    this.usingMouse = false;

    this.done = false;
    this.frame = 0;
    this._layout = null;
  }

  color(i) { return this.frameColors[i] || '#d2382f'; }

  /** One cursor picks for both slots whenever player 2 is not a human. */
  get solo() { return this.training || !!this.cpuLevel; }

  /**
   * Toggles player 2 between a human and a CPU. Difficulty is picked
   * separately on the slider, so this is a two-state switch — cycling through
   * every level here meant overshooting cost you a full lap.
   */
  toggleSlotType() {
    if (this.cpuLevel) {
      this.lastCpuLevel = this.cpuLevel;
      this.cpuLevel = null;
    } else {
      this.cpuLevel = this.lastCpuLevel || 'normal';
    }
    // Who is picking has changed, so player 2's choice is cleared.
    this.ready[1] = false;
    this.chosen[1] = -1;
    this.step = this.ready[0] ? 1 : 0;
    this.pointer[1] = null;
  }

  /** Sets the CPU difficulty directly. Fighter choices are unaffected. */
  setCpuLevel(level) {
    if (!level || this.cpuLevel === level) return;
    this.cpuLevel = level;
    this.lastCpuLevel = level;
  }

  /** Indices that actually drive a cursor. Training has just the one. */
  get drivers() { return this.solo ? [0] : this.players.map((_, i) => i); }

  /** Which player slot the single training cursor is currently choosing for. */
  get activeSlot() { return this.solo ? this.step : -1; }

  allReady() { return this.ready.every(Boolean); }

  // ----------------------------------------------------------------- layout

  /**
   * One uniform grid. The column count is chosen so the grid's aspect ratio
   * best matches the space available, while keeping the final row from being
   * left with an awkward orphan (61 is prime, so some remainder is unavoidable).
   */
  computeLayout(w, h) {
    const top = h * 0.115;
    // Leaves room for the enlarged fighter cards and the difficulty slider.
    const bottom = h * 0.655;
    const availW = w * 0.92;
    const availH = bottom - top;
    const targetAspect = availW / availH;

    let cols = COLUMN_CANDIDATES[0];
    let bestScore = Infinity;
    for (const c of COLUMN_CANDIDATES) {
      const r = Math.ceil(TOTAL_SLOTS / c);
      const score = Math.abs(c / r - targetAspect);
      if (score < bestScore) { bestScore = score; cols = c; }
    }
    const rows = Math.ceil(TOTAL_SLOTS / cols);

    const gap = Math.min(availW * 0.007, 9);
    const cell = Math.max(
      18,
      Math.min(
        (availW - gap * (cols - 1)) / cols,
        (availH - gap * (rows - 1)) / rows,
      ),
    );

    const gridW = cols * cell + gap * (cols - 1);
    const gridH = rows * cell + gap * (rows - 1);
    const originX = (w - gridW) / 2;
    const originY = top + (availH - gridH) / 2;
    const lastRowLen = TOTAL_SLOTS - (rows - 1) * cols;

    return { cols, rows, cell, gap, originX, originY, gridW, gridH, lastRowLen };
  }

  /** Screen rect of a slot. The final, partial row is centred. */
  slotRect(layout, index) {
    const { cols, cell, gap, originX, originY, rows, lastRowLen } = layout;
    const row = Math.floor(index / cols);
    const col = index % cols;
    const stride = cell + gap;
    const indent = row === rows - 1 ? ((cols - lastRowLen) * stride) / 2 : 0;
    return {
      x: originX + indent + col * stride,
      y: originY + row * stride,
      s: cell,
    };
  }

  slotAtPoint(layout, px, py) {
    for (let i = 0; i < this.slots.length; i++) {
      const r = this.slotRect(layout, i);
      if (px >= r.x && px <= r.x + r.s && py >= r.y && py <= r.y + r.s) return i;
    }
    return -1;
  }

  // ----------------------------------------------------------------- update

  update() {
    this.frame++;
    for (const p of this.players) p.poll();

    const w = this.canvas ? this.canvas.width : 1280;
    const h = this.canvas ? this.canvas.height : 720;
    const layout = this.computeLayout(w, h);
    this._layout = layout;

    mouse.sync(this.canvas);
    if (mouse.moved) this.usingMouse = true;
    this._chipHot = false;
    this._diffHot = -1;

    for (const i of this.drivers) {
      if (this.denyFlash[i] > 0) this.denyFlash[i]--;
      const inp = this.players[i];

      // In training one cursor fills both slots in turn.
      const target = this.solo ? this.step : i;

      // Initialise the pointer over this player's default fighter.
      if (!this.pointer[i]) {
        const r = this.slotRect(layout, this.lastHover[i]);
        this.pointer[i] = { x: r.x + r.s * 0.5, y: r.y + r.s * 0.5 };
      }

      // The cursor keeps moving even once a fighter is locked in — otherwise
      // the difficulty row becomes unreachable after choosing the CPU's
      // fighter. Only the roster selection freezes, not the cursor.
      const frozen = this.solo ? this.allReady() : this.ready[i];
      this.movePointer(i, inp, w, h, layout);
      if (!frozen) {
        const hit = this.slotAtPoint(layout, this.pointer[i].x, this.pointer[i].y);
        this.hovered[i] = hit;
        if (hit >= 0) this.lastHover[i] = hit;
      } else {
        this.hovered[i] = this.chosen[i];
      }

      const clickConfirm = this.usingMouse && i === this.mouseOwner && mouse.clicked;
      const confirm = inp.consume('attack') || inp.consume('jump') || clickConfirm;

      // The slot-type chip and difficulty cells sit outside the grid, so they
      // are tested before the roster.
      const p = this.pointer[i];
      const inRect = (r) => r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

      const overChip = !this.training && inRect(this._typeChip);
      this._chipHot = this._chipHot || !!overChip;
      if (confirm && overChip) { this.toggleSlotType(); continue; }

      const cell = this._diffCells.findIndex(inRect);
      if (cell >= 0) this._diffHot = cell;
      if (confirm && cell >= 0) { this.setCpuLevel(this._diffCells[cell].level); continue; }

      if (confirm) {
        const hit = this.hovered[i];
        if (hit >= 0 && this.slots[hit].def && !this.ready[target]) {
          this.ready[target] = true;
          this.chosen[target] = hit;
          if (this.solo && this.step === 0) this.step = 1;
        } else if (hit < 0 || !this.slots[hit].def) {
          this.denyFlash[i] = 18;
        }
      }
      if (inp.consume('special') || inp.consume('shield')) this.cancel(i);
    }

    keyboard.flush();
    mouse.flush();

    const allReady = this.ready.every(Boolean);
    if (allReady && this.players.some((p) => p.consume('start'))) this.done = true;
    return this.done;
  }

  /** Backs out one step: the dummy's pick first, then the player's. */
  cancel(i) {
    if (!this.solo) {
      this.ready[i] = false;
      this.chosen[i] = -1;
      return;
    }
    if (this.ready[1]) { this.ready[1] = false; this.chosen[1] = -1; this.step = 1; }
    else if (this.step === 1) { this.step = 0; this.ready[0] = false; this.chosen[0] = -1; }
  }

  /** Free-roaming cursor: mouse takes over directly, stick steers analogue. */
  movePointer(i, inp, w, h, layout) {
    const p = this.pointer[i];

    if (this.usingMouse && i === this.mouseOwner && mouse.moved) {
      p.x = mouse.x;
      p.y = mouse.y;
    } else {
      const mx = inp.menuX;
      const my = inp.menuY;
      const mag = Math.hypot(mx, my);
      if (mag > 0.001) {
        const speed = h * CURSOR_SPEED * Math.pow(Math.min(mag, 1), CURSOR_GAMMA);
        p.x += (mx / mag) * speed;
        p.y += (my / mag) * speed;
        if (i === this.mouseOwner) this.usingMouse = false;
      }
    }

    // Keep the cursor on the grid's neighbourhood rather than the whole canvas,
    // so it never wanders somewhere with nothing to pick — but let it reach
    // down to the slot-type chip on the player bar, which is a target too.
    // The cursor may roam the grid's neighbourhood plus whatever interactive
    // UI sits outside it. Clamping to the grid alone made the difficulty cells
    // unreachable on wide, short windows, where the grid is height-limited and
    // narrower than the player bar it sits above.
    const pad = layout.cell * 0.75;
    let minX = layout.originX - pad;
    let maxX = layout.originX + layout.gridW + pad;
    let maxY = layout.originY + layout.gridH + pad;
    if (this._uiBottom) maxY = Math.max(maxY, this._uiBottom + pad * 0.4);
    if (this._uiRight) maxX = Math.max(maxX, this._uiRight + pad * 0.25);
    if (Number.isFinite(this._uiLeft)) minX = Math.min(minX, this._uiLeft - pad * 0.25);
    p.x = clamp(p.x, minX, maxX);
    p.y = clamp(p.y, layout.originY - pad, maxY);
  }

  selections() {
    return this.chosen.map((idx, i) => this.slots[idx >= 0 ? idx : this.lastHover[i]].def);
  }

  /** Slot a given player panel should display right now. */
  displaySlot(playerIndex) {
    if (this.chosen[playerIndex] >= 0) return this.slots[this.chosen[playerIndex]];
    if (this.solo) {
      // Only the panel currently being chosen for follows the cursor.
      if (playerIndex === this.step) {
        return this.slots[this.hovered[0] >= 0 ? this.hovered[0] : this.lastHover[0]];
      }
      return null;
    }
    const h = this.hovered[playerIndex];
    return this.slots[h >= 0 ? h : this.lastHover[playerIndex]];
  }

  // ------------------------------------------------------------------- draw

  draw(ctx) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;

    this.drawBackground(ctx, w, h);

    // The heading is the prompt — it says what to do right now, so the bottom
    // of the screen is free for the chosen fighters.
    const allReady = this.allReady();
    const heading = allReady ? 'PRESS START'
      : (!this.solo || this.step === 0) ? 'CHOOSE YOUR FIGHTER'
        : (this.training ? 'CHOOSE THE TRAINING DUMMY' : "CHOOSE THE CPU'S FIGHTER");
    const pulse = allReady ? 0.65 + 0.35 * Math.sin(this.frame * 0.13) : 1;
    displayText(ctx, heading, w / 2, h * 0.076, clamp(h * 0.055, 24, 54), {
      align: 'center',
      fill: allReady ? ['#ffe9a3', '#e0a01e'] : ['#fffdf3', '#c9bda4'],
      outline: allReady ? '#3a2405' : '#241a2b', skew: -0.06,
      alpha: pulse, maxWidth: w * 0.9,
    });

    const layout = this._layout || this.computeLayout(w, h);
    this.drawGrid(ctx, layout);
    this.drawCursors(ctx, layout);
    this.drawPlayerBars(ctx, w, h);
  }

  drawBackground(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1b2338');
    g.addColorStop(0.55, '#111726');
    g.addColorStop(1, '#080b13');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const r = ctx.createRadialGradient(w / 2, h * 0.42, 0, w / 2, h * 0.42, w * 0.55);
    r.addColorStop(0, 'rgba(228,69,159,0.09)');
    r.addColorStop(1, 'rgba(228,69,159,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, w, h);
  }

  drawGrid(ctx, layout) {
    for (let i = 0; i < this.slots.length; i++) {
      this.drawSlot(ctx, this.slots[i], this.slotRect(layout, i), i);
    }
  }

  drawSlot(ctx, slot, rect, index) {
    const { x, y, s } = rect;
    const radius = s * 0.16;
    const playable = !!slot.def;

    const hovering = [];
    const locked = [];
    for (let i = 0; i < this.players.length; i++) {
      if (this.chosen[i] === index) locked.push(i);
    }
    if (this.solo) {
      if (!this.allReady() && this.hovered[0] === index && this.chosen[this.step] < 0) {
        hovering.push(this.step);
      }
    } else {
      for (let i = 0; i < this.players.length; i++) {
        if (!this.ready[i] && this.hovered[i] === index) hovering.push(i);
      }
    }

    ctx.save();

    if (playable) {
      drawCharacterCard(ctx, slot.def, x, y, s, slot.def.color, {
        radiusRatio: 0.16, bandRatio: 0.035, wellRatio: 0.10,
      });
    } else {
      roundRect(ctx, x, y, s, s, radius);
      ctx.fillStyle = '#171a24';
      ctx.fill();
      roundRect(ctx, x + s * 0.05, y + s * 0.05, s * 0.9, s * 0.9, radius * 0.8);
      const g = ctx.createLinearGradient(0, y, 0, y + s);
      g.addColorStop(0, '#333846');
      g.addColorStop(1, '#242833');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = Math.max(1, s * 0.015);
      ctx.stroke();

      drawLock(ctx, x + s / 2, y + s * 0.36, s * 0.29, '#7b8398');

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(178,192,216,0.75)';
      fitLabel(ctx, slot.name.toUpperCase(), x + s / 2, y + s * 0.755, s * 0.86, s * 0.155, 5);
    }

    for (const i of hovering) {
      const pulse = 0.55 + 0.45 * Math.sin(this.frame * 0.16 + i);
      roundRect(ctx, x - s * 0.03, y - s * 0.03, s * 1.06, s * 1.06, radius * 1.15);
      ctx.strokeStyle = this.color(i);
      ctx.globalAlpha = pulse;
      ctx.lineWidth = Math.max(2, s * 0.055);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const i of locked) {
      roundRect(ctx, x - s * 0.045, y - s * 0.045, s * 1.09, s * 1.09, radius * 1.2);
      ctx.strokeStyle = this.color(i);
      ctx.lineWidth = Math.max(2.5, s * 0.075);
      ctx.stroke();
      const tr = s * 0.17;
      ctx.beginPath();
      ctx.arc(x + s - tr * 0.4, y + tr * 0.4, tr, 0, Math.PI * 2);
      ctx.fillStyle = this.color(i);
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.2, s * 0.028);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `900 ${Math.round(tr * 1.15)}px ${FONT_STACK}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${i + 1}`, x + s - tr * 0.4, y + tr * 0.5);
    }

    ctx.restore();
  }

  drawCursors(ctx, layout) {
    for (const i of this.drivers) {
      const p = this.pointer[i];
      if (!p) continue;

      // In training the single cursor takes on the colour and tag of whichever
      // slot it is currently choosing for.
      const slotIdx = this.solo ? this.step : i;
      const frozen = this.solo ? this.allReady() : this.ready[i];

      const deny = this.denyFlash[i] > 0;
      const shake = deny ? Math.sin(this.frame * 1.2) * layout.cell * 0.06 : 0;
      const bob = frozen ? 0 : Math.sin(this.frame * 0.11 + i * 2) * layout.cell * 0.02;

      drawHandCursor(
        ctx, p.x + shake, p.y + bob, layout.cell * 0.80,
        deny ? '#b04a4a' : this.color(slotIdx),
        { label: this.solo && slotIdx === 1 ? 'C' : `${slotIdx + 1}` },
      );
    }
  }

  drawPlayerBars(ctx, w, h) {
    const barY = h * 0.695;
    const cardS = Math.min(h * 0.205, w * 0.15);
    // Rebuilt each frame; stale targets would otherwise linger after a toggle.
    this._diffCells = [];
    this._typeChip = null;
    this._uiBottom = 0;
    this._uiLeft = Infinity;
    this._uiRight = 0;

    for (let i = 0; i < this.players.length; i++) {
      const slot = this.displaySlot(i);
      const inp = this.players[i];
      const ready = this.ready[i];
      const col = this.color(i);
      const isDummy = this.solo && i === 1;
      const awaiting = slot === null;
      const left = i === 0;
      const margin = w * 0.045;
      const cardX = left ? margin : w - margin - cardS;
      const textX = left ? cardX + cardS + w * 0.016 : cardX - w * 0.016;
      const align = left ? 'left' : 'right';

      if (slot && slot.def) {
        drawCharacterCard(ctx, slot.def, cardX, barY, cardS, col, {
          glow: ready ? 0.5 + 0.25 * Math.sin(this.frame * 0.12) : 0,
        });
      } else if (awaiting) {
        // Training: this slot has not been chosen for yet.
        roundRect(ctx, cardX, barY, cardS, cardS, cardS * 0.2);
        ctx.fillStyle = 'rgba(23,26,36,0.75)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(120,140,175,0.3)';
        ctx.lineWidth = Math.max(1.5, cardS * 0.02);
        ctx.stroke();
        displayText(ctx, '?', cardX + cardS / 2, barY + cardS * 0.68, cardS * 0.5, {
          align: 'center', fill: ['#5d6579', '#3a404f'], outline: '#171a24', skew: 0, shadow: false,
        });
      } else {
        roundRect(ctx, cardX, barY, cardS, cardS, cardS * 0.2);
        ctx.fillStyle = '#171a24';
        ctx.fill();
        roundRect(ctx, cardX + cardS * 0.05, barY + cardS * 0.05, cardS * 0.9, cardS * 0.9, cardS * 0.16);
        ctx.fillStyle = '#2b3040';
        ctx.fill();
        drawLock(ctx, cardX + cardS / 2, barY + cardS / 2, cardS * 0.34, '#7b8398');
      }

      ctx.save();
      ctx.textAlign = align;
      ctx.font = `900 ${Math.round(cardS * 0.20)}px ${FONT_STACK}`;
      ctx.fillStyle = col;
      // The chip below already says HUMAN or CPU, so the title stays the slot.
      const title = this.training && i === 1 ? 'TRAINING DUMMY' : `PLAYER ${i + 1}`;
      ctx.fillText(title, textX, barY + cardS * 0.20);
      ctx.restore();

      // Player 2's slot type is toggled here rather than on its own screen:
      // point at the chip and confirm to cycle human -> each CPU difficulty.
      // Type toggle and difficulty form one strip directly under the title,
      // so the controls sit together and high rather than at the screen edge.
      if (i === 1 && !this.training) {
        const stripY = barY + cardS * 0.27;
        let chipRight = textX;
        if (this.cpuLevel) chipRight = this.drawDifficulty(ctx, textX, stripY, cardS) - cardS * 0.11;
        this.drawTypeChip(ctx, chipRight, stripY, cardS);
      }

      const nameRoom = Math.abs((left ? w * 0.5 - w * 0.105 : w * 0.5 + w * 0.105) - textX);
      const nameText = awaiting ? '— CHOOSE —' : slot.name.toUpperCase();
      displayText(ctx, nameText, textX, barY + cardS * 0.68, cardS * 0.26, {
        align,
        fill: (slot && slot.def) ? [shade(col, 0.55), col] : ['#9aa4ba', '#5d6579'],
        outline: '#241a2b', skew: -0.05, maxWidth: nameRoom,
      });

      // Locked fighters still say so; playable ones need no caption.
      if (!awaiting && slot && !slot.def) {
        ctx.save();
        ctx.textAlign = align;
        ctx.font = `900 ${Math.round(cardS * 0.145)}px ${FONT_STACK}`;
        ctx.fillStyle = 'rgba(150,162,186,0.75)';
        ctx.fillText('NOT YET PLAYABLE', textX, barY + cardS * 0.88);
        ctx.restore();
      }

      if (ready) {
        displayText(ctx, 'READY', textX, barY + cardS * 1.12, cardS * 0.22, {
          align, fill: ['#b6ffa8', '#3fa02c'], outline: '#123309', skew: -0.05,
        });
      }
    }
  }

  /**
   * Player 2's slot-type chip. Records its rect so update() can treat it as a
   * cursor target, the same way a roster slot is.
   */
  /** @param {number} rightX right edge to align the chip against */
  drawTypeChip(ctx, rightX, topY, cardS) {
    const isCpu = !!this.cpuLevel;
    const label = isCpu ? 'CPU' : 'HUMAN';

    ctx.save();
    ctx.font = `900 ${Math.round(cardS * 0.125)}px ${FONT_STACK}`;
    const textW = ctx.measureText(label).width;
    const padX = cardS * 0.12;
    const cw = textW + padX * 2;
    const ch = cardS * 0.2;
    const cx = rightX - cw;

    this._typeChip = { x: cx, y: topY, w: cw, h: ch };
    this.registerTarget(this._typeChip);
    const hot = this._chipHot;

    roundRect(ctx, cx, topY, cw, ch, ch / 2);
    ctx.fillStyle = isCpu ? 'rgba(228,69,159,0.24)' : 'rgba(120,200,255,0.18)';
    ctx.fill();
    ctx.strokeStyle = hot ? '#ffffff' : (isCpu ? '#e4459f' : '#78c8ff');
    ctx.lineWidth = hot ? 2.4 : 1.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isCpu ? '#ffc3ec' : '#bfe4ff';
    ctx.fillText(label, cx + cw / 2, topY + ch / 2 + 1);
    ctx.restore();
  }

  /** Widens the cursor's roaming area to include an interactive rect. */
  registerTarget(r) {
    this._uiBottom = Math.max(this._uiBottom, r.y + r.h);
    this._uiRight = Math.max(this._uiRight, r.x + r.w);
    this._uiLeft = Math.min(this._uiLeft, r.x);
  }

  /**
   * Difficulty selector under player 2's card. Every level is its own target,
   * so any of them is one confirm away rather than a lap through the others.
   */
  drawDifficulty(ctx, rightX, topY, cardS) {
    const cells = [];
    const w = cardS * 1.95;
    const hgt = cardS * 0.2;
    const x0 = rightX - w;
    const cw = w / CPU_ORDER.length;

    ctx.save();
    roundRect(ctx, x0, topY, w, hgt, hgt * 0.34);
    ctx.fillStyle = 'rgba(16,20,32,0.85)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(228,69,159,0.45)';
    ctx.lineWidth = Math.max(1, cardS * 0.012);
    ctx.stroke();

    CPU_ORDER.forEach((level, n) => {
      const cx = x0 + n * cw;
      const active = this.cpuLevel === level;
      const hot = this._diffHot === n;
      cells.push({ x: cx, y: topY, w: cw, h: hgt, level });

      if (active) {
        roundRect(ctx, cx + cw * 0.04, topY + hgt * 0.12, cw * 0.92, hgt * 0.76, hgt * 0.28);
        const g = ctx.createLinearGradient(0, topY, 0, topY + hgt);
        g.addColorStop(0, '#ff72e2');
        g.addColorStop(1, '#9c1478');
        ctx.fillStyle = g;
        ctx.fill();
      } else if (hot) {
        roundRect(ctx, cx + cw * 0.04, topY + hgt * 0.12, cw * 0.92, hgt * 0.76, hgt * 0.28);
        ctx.fillStyle = 'rgba(255,255,255,0.14)';
        ctx.fill();
      }

      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${Math.round(cardS * 0.095)}px ${FONT_STACK}`;
      ctx.fillStyle = active ? '#ffffff' : hot ? '#ffd7f2' : 'rgba(190,204,226,0.7)';
      ctx.fillText(CPU_LEVELS[level].label, cx + cw / 2, topY + hgt / 2 + 1);
    });
    ctx.restore();

    this._diffCells = cells;
    for (const c of cells) this.registerTarget(c);
    return x0;
  }

}
