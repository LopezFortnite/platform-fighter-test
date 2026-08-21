import { PHYSICS, INPUT } from '../config/gameplay.js';
import { clamp } from './math.js';

/**
 * Input layer.
 *
 * Produces an abstract, device-agnostic per-frame snapshot for each player:
 * an analogue stick, a C-stick, and edge-triggered actions with an input
 * buffer. Gamepads are first-class (the prototype is designed to be played on
 * a controller); keyboard exists as a fallback and for solo testing.
 *
 * Derived signals matter as much as raw ones in a platform fighter — smash
 * flicks, dash double-taps and fast-fall flicks are all computed here so that
 * gameplay code never has to inspect raw axes.
 */

export const ACTIONS = ['attack', 'special', 'jump', 'shield', 'grab', 'taunt', 'start', 'select'];

/** D-pad directions, in the bit order `packRaw` uses. */
const DPAD_DIRS = ['up', 'down', 'left', 'right'];

/**
 * Wire format for one frame of raw input.
 *
 * Four axes quantised to a byte each plus fourteen bits of buttons — 6 bytes a
 * frame, which is nothing even at 60Hz. Quantising is not a compromise: it is
 * **required**. Lockstep only stays in sync if both machines derive from bit
 * identical samples, and a raw analogue axis that round-trips through JSON at
 * full precision on one side and arrives rounded on the other would drift the
 * flick detector apart. Rounding both sides to the same grid removes the class
 * of bug entirely.
 *
 * The local player's own sample goes through the same quantisation before it is
 * simulated, so what a player feels is exactly what their opponent replays.
 */
export function packRaw(raw) {
  const q = (v) => Math.max(0, Math.min(254, Math.round((v + 1) * 127)));
  let bits = 0;
  ACTIONS.forEach((a, i) => { if (raw.held[a]) bits |= 1 << i; });
  if (raw.smashMod) bits |= 1 << 8;
  if (raw.walkMod) bits |= 1 << 9;
  DPAD_DIRS.forEach((d, i) => { if (raw.dpad && raw.dpad[d]) bits |= 1 << (10 + i); });
  if (raw.connected) bits |= 1 << 14;
  return [q(raw.x), q(raw.y), q(raw.cx), q(raw.cy), bits];
}

export function unpackRaw(p) {
  const u = (v) => v / 127 - 1;
  const bits = p[4];
  const held = {};
  ACTIONS.forEach((a, i) => { held[a] = !!(bits & (1 << i)); });
  const dpad = {};
  DPAD_DIRS.forEach((d, i) => { dpad[d] = !!(bits & (1 << (10 + i))); });
  return {
    x: u(p[0]), y: u(p[1]), cx: u(p[2]), cy: u(p[3]),
    held, smashMod: !!(bits & (1 << 8)), walkMod: !!(bits & (1 << 9)),
    dpad, connected: !!(bits & (1 << 14)),
  };
}

/** Round-trips a sample through the wire format, so local play matches remote. */
export function quantiseRaw(raw) { return unpackRaw(packRaw(raw)); }

/** Standard Gamepad API mapping, laid out like Smash Ultimate on an Xbox pad. */
const PAD_MAP = {
  attack: [0],
  special: [1],
  jump: [2, 3, 10],
  shield: [5, 6, 7],
  grab: [4],
  taunt: [12, 13, 14, 15],
  start: [9],
  select: [8],
};

const KEYBOARD_PROFILES = [
  {
    label: 'Keyboard (left)',
    left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS',
    attack: ['KeyF'], special: ['KeyG'], jump: ['Space'], shield: ['KeyH'],
    grab: ['KeyT'], taunt: ['KeyQ'], start: ['Enter'], select: ['Backquote'],
    // Shift is the walk modifier (see `autoRun`), so smash inputs moved to E.
    smashMod: ['KeyE'],
    walkMod: ['ShiftLeft'],
    cLeft: null, cRight: null, cUp: null, cDown: null,
  },
  {
    label: 'Keyboard (right)',
    left: 'ArrowLeft', right: 'ArrowRight', up: 'ArrowUp', down: 'ArrowDown',
    attack: ['Numpad1', 'Period'], special: ['Numpad2', 'Comma'],
    jump: ['Numpad0', 'Enter'], shield: ['Numpad3', 'Slash'],
    grab: ['Numpad4', 'Quote'], taunt: ['Numpad5'], start: ['NumpadEnter'], select: [],
    smashMod: ['Numpad6'],
    walkMod: ['ShiftRight'],
    cLeft: null, cRight: null, cUp: null, cDown: null,
  },
];

/**
 * Bindings are expressed as KeyboardEvent.code, which is layout-independent.
 * A few environments (remote desktops, some automation and IME paths) deliver
 * events with an empty `code`, so fall back to deriving one from `key`.
 */
const KEY_TO_CODE = {
  ' ': 'Space', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab',
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  Shift: 'ShiftLeft', '.': 'Period', ',': 'Comma', '/': 'Slash', "'": 'Quote', '`': 'Backquote',
};

function eventCode(e) {
  if (e.code) return e.code;
  const k = e.key;
  if (!k) return '';
  if (KEY_TO_CODE[k]) return KEY_TO_CODE[k];
  if (/^[a-zA-Z]$/.test(k)) return `Key${k.toUpperCase()}`;
  if (/^[0-9]$/.test(k)) return `Digit${k}`;
  return '';
}

/**
 * Raw keyboard state, shared by all keyboard-bound players.
 *
 * Keys are latched on keydown and only cleared once the frame has been polled,
 * so a press-and-release that happens entirely between two simulation frames
 * still registers. Dropping a 1-frame tap is exactly the kind of input loss
 * that makes a fighting game feel unresponsive.
 */
class Keyboard {
  constructor() {
    this.down = new Set();
    this.latch = new Set();
    /**
     * Characters typed since the last read, for text entry like the netplay
     * room code. Separate from the binding tables on purpose: a code is typed,
     * not *bound*, so it should come off whatever key produces the digit — the
     * number row and the numpad both, without a second mapping to maintain.
     * Backspace arrives as `\b`.
     */
    this.typed = '';
    window.addEventListener('keydown', (e) => {
      const code = eventCode(e);
      // Stop the page from scrolling / activating browser shortcuts mid-match.
      if (code.startsWith('Arrow') || code === 'Space' || code === 'Tab') e.preventDefault();
      if (e.key && e.key.length === 1) this.typed += e.key;
      else if (e.key === 'Backspace') this.typed += '\b';
      if (this.typed.length > 64) this.typed = this.typed.slice(-64);
      if (e.repeat || !code) return;
      this.down.add(code);
      this.latch.add(code);
    });
    window.addEventListener('keyup', (e) => this.down.delete(eventCode(e)));
    window.addEventListener('blur', () => { this.down.clear(); this.latch.clear(); this.typed = ''; });
  }

  isDown(code) { return this.down.has(code) || this.latch.has(code); }
  anyDown(codes) { return !!codes && codes.some((c) => this.isDown(c)); }

  /** Drains the typed-character buffer. */
  takeTyped() { const t = this.typed; this.typed = ''; return t; }

  /** Discards anything typed, so stale keystrokes do not leak between screens. */
  consumeTyped() { this.typed = ''; }

  /** Call once per simulation frame, after every player has polled. */
  flush() { this.latch.clear(); }
}

export const keyboard = new Keyboard();

/**
 * Mouse tracker for menu pointers.
 *
 * Kept out of the gameplay input path entirely — a platform fighter is played
 * on a stick, and this exists only so the character select can be driven with
 * a mouse as well as a controller.
 */
class Mouse {
  constructor() {
    this.clientX = 0; this.clientY = 0;
    this.x = 0; this.y = 0;
    this.moved = false;
    this.clicked = false;
    this.present = false;

    window.addEventListener('mousemove', (e) => {
      if (e.clientX === this.clientX && e.clientY === this.clientY) return;
      this.clientX = e.clientX;
      this.clientY = e.clientY;
      this.moved = true;
      this.present = true;
    });
    window.addEventListener('mousedown', (e) => { if (e.button === 0) this.clicked = true; });
  }

  /** Converts the last client position into canvas pixels. */
  sync(canvas) {
    if (!canvas) return;
    const r = canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.x = (this.clientX - r.left) * (canvas.width / r.width);
    this.y = (this.clientY - r.top) * (canvas.height / r.height);
  }

  /** Call once per frame after consumers have read the flags. */
  flush() { this.moved = false; this.clicked = false; }
}

export const mouse = new Mouse();

/** Applies a radial deadzone and rescales so the usable range still reaches 1.0. */
function deadzone(x, y, dz = PHYSICS.STICK_DEADZONE) {
  const mag = Math.hypot(x, y);
  if (mag < dz) return [0, 0, 0];
  const scaled = Math.min((mag - dz) / (1 - dz), 1);
  return [(x / mag) * scaled, (y / mag) * scaled, scaled];
}

/**
 * One player's input. Owns its own history, buffer and derived signals.
 */
export class PlayerInput {
  /**
   * @param {number} index player index
   * @param {{type:'pad'|'keyboard', slot:number}} binding
   */
  constructor(index, binding) {
    this.index = index;
    this.binding = binding;

    this.x = 0; this.y = 0; this.mag = 0;
    this.cx = 0; this.cy = 0; this.cmag = 0;
    this.prevX = 0; this.prevY = 0;

    this.held = {}; this.pressed = {}; this.released = {};
    for (const a of ACTIONS) { this.held[a] = false; this.pressed[a] = false; this.released[a] = false; }

    /** Frames each buffered action remains valid. */
    this.buffer = {};
    /** Rolling stick history used for flick detection. */
    this._histX = new Array(8).fill(0);
    this._histY = new Array(8).fill(0);

    this.smashX = 0;      // -1 | 0 | 1, set on the frame a horizontal flick lands
    this.smashY = 0;      // -1 | 0 | 1 (negative = up, matching screen space)
    this.fastFallFlick = false;
    this.dashPressed = 0; // -1 | 0 | 1, set when a dash should start

    // A flick lasts one frame, but the attack button rarely lands on exactly
    // that frame. These remember the flick briefly so "flick + A" reliably
    // produces a smash attack rather than a tilt.
    this.smashXDir = 0; this.smashXAge = 999;
    this.smashYDir = 0; this.smashYAge = 999;

    /**
     * True while the player is asking to move at walking pace. On a stick that
     * is expressed by tilting part-way; on a keyboard there is no part-way, so
     * it is an explicit modifier key.
     */
    this.wantsWalk = false;
    /**
     * True while the keyboard smash modifier is held. Suppresses auto-run, or
     * holding a direction to line up a smash attack would break into a dash
     * instead and turn it into a dash attack.
     */
    this.smashModHeld = false;

    /** D-pad state, kept separate because in-game the D-pad is the taunt input. */
    this.dpad = { up: false, down: false, left: false, right: false };

    this._lastTapDir = 0;
    this._lastTapFrame = -999;
    this._frame = 0;
    this._smashCooldown = 0;
    this.connected = false;
  }

  get isPad() { return this.binding.type === 'pad'; }

  /**
   * Whether holding a direction should default to running rather than walking.
   *
   * A stick gives an analogue magnitude, so walk-vs-run comes out of how far
   * it is pushed. A keyboard cannot express that, and defaulting to a walk
   * meant PC players had to double-tap for every approach. Keyboards therefore
   * run by default and use the walk modifier to slow down.
   */
  get autoRun() { return this.binding.type === 'keyboard'; }

  /** Human-readable device name, for the controls screen. */
  get deviceLabel() {
    if (this.isPad) {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = pads[this.binding.slot];
      return pad ? `Pad ${this.binding.slot + 1}` : `Pad ${this.binding.slot + 1} (disconnected)`;
    }
    return KEYBOARD_PROFILES[this.binding.slot].label;
  }

  /** Polls the device and recomputes every derived signal. Call once per sim frame. */
  poll() {
    this.applyRaw(this.readDevice());
  }

  /**
   * A single frame of **raw device state** — sticks, buttons, d-pad, nothing
   * derived.
   *
   * This split exists for netplay. Everything else on this class (buffers,
   * flick detection, smash memory, dash taps) is a pure function of this
   * sample plus the previous internal state, so two machines fed the same
   * sequence of samples derive byte-identical inputs. That is what makes
   * deterministic lockstep possible: only this crosses the wire, and the
   * expensive interpretation happens independently on both sides.
   *
   * Kept deliberately flat and small — see `packRaw`.
   */
  readDevice() {
    const raw = {
      x: 0, y: 0, cx: 0, cy: 0,
      held: {}, smashMod: false, walkMod: false,
      dpad: { up: false, down: false, left: false, right: false },
      connected: false,
    };
    for (const a of ACTIONS) raw.held[a] = false;

    if (this.isPad) {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const pad = pads[this.binding.slot];
      raw.connected = !!pad;
      if (pad) {
        raw.x = pad.axes[0] || 0;
        raw.y = pad.axes[1] || 0;
        raw.cx = pad.axes[2] || 0;
        raw.cy = pad.axes[3] || 0;
        for (const action of ACTIONS) {
          for (const b of PAD_MAP[action]) {
            const btn = pad.buttons[b];
            if (btn && (btn.pressed || btn.value > 0.35)) { raw.held[action] = true; break; }
          }
        }
        const dp = (i) => !!(pad.buttons[i] && pad.buttons[i].pressed);
        raw.dpad = { up: dp(12), down: dp(13), left: dp(14), right: dp(15) };
      }
    } else {
      const p = KEYBOARD_PROFILES[this.binding.slot];
      raw.connected = true;
      raw.x = (keyboard.isDown(p.right) ? 1 : 0) - (keyboard.isDown(p.left) ? 1 : 0);
      raw.y = (keyboard.isDown(p.down) ? 1 : 0) - (keyboard.isDown(p.up) ? 1 : 0);
      for (const action of ACTIONS) raw.held[action] = keyboard.anyDown(p[action]);
      raw.smashMod = keyboard.anyDown(p.smashMod);
      raw.walkMod = keyboard.anyDown(p.walkMod);
    }
    return raw;
  }

  /**
   * Derives every signal the simulation reads from one raw sample.
   *
   * Called with a live sample locally, and with a sample pulled off the
   * network queue in an online match. Nothing in here may touch a device.
   */
  applyRaw(sample) {
    this._frame++;
    this.prevX = this.x; this.prevY = this.y;

    const prevHeld = { ...this.held };
    let rawX = sample.x, rawY = sample.y;
    const rawCX = sample.cx, rawCY = sample.cy;
    const nextHeld = {};
    for (const a of ACTIONS) nextHeld[a] = !!sample.held[a];
    const smashMod = !!sample.smashMod;
    const walkMod = !!sample.walkMod;
    this.connected = !!sample.connected;
    this.dpad = sample.dpad || { up: false, down: false, left: false, right: false };
    // D-pad doubles as a digital stick for menus.
    if (this.dpad.left) rawX = -1;
    if (this.dpad.right) rawX = 1;

    this._deriveFrom(rawX, rawY, rawCX, rawCY, nextHeld, prevHeld, smashMod, walkMod);
  }

  _deriveFrom(rawX, rawY, rawCX, rawCY, nextHeld, prevHeld, smashMod, walkMod) {
    // Shield + attack is a universal grab shortcut, as in Smash.
    if (nextHeld.shield && nextHeld.attack) nextHeld.grab = true;

    const [dx, dy, mag] = deadzone(rawX, rawY);
    this.x = dx; this.y = dy; this.mag = mag;
    const [cx, cy, cmag] = deadzone(rawCX, rawCY, 0.4);
    this.cx = cx; this.cy = cy; this.cmag = cmag;

    for (const a of ACTIONS) {
      this.pressed[a] = nextHeld[a] && !prevHeld[a];
      this.released[a] = !nextHeld[a] && prevHeld[a];
      this.held[a] = nextHeld[a];
      if (this.pressed[a]) this.buffer[a] = INPUT.BUFFER_FRAMES;
      else if (this.buffer[a] > 0) this.buffer[a]--;
    }

    this.wantsWalk = walkMod;
    this.smashModHeld = smashMod;
    this._updateFlicks(smashMod, rawX, rawY);
  }

  _updateFlicks(smashMod, rawX, rawY) {
    const T = PHYSICS.SMASH_THRESHOLD;
    const W = PHYSICS.SMASH_WINDOW_FRAMES;
    const DW = PHYSICS.DASH_WINDOW_FRAMES;

    this._histX.push(this.x); this._histX.shift();
    this._histY.push(this.y); this._histY.shift();

    this.smashX = 0; this.smashY = 0; this.fastFallFlick = false; this.dashPressed = 0;
    if (this._smashCooldown > 0) this._smashCooldown--;

    if (this.isPad) {
      // A flick is the stick crossing the smash threshold from a near-neutral
      // position inside a short window. That velocity is what separates a tilt
      // from a smash, and a dash from a walk.
      //
      // Smash and dash read the *same* motion but not the same window. A dash
      // wants to be easy — it is how you move, and dash-dancing means throwing
      // the stick back and forth all game. A smash wants to be deliberate,
      // because the cost of a false positive is committing to 40 frames of
      // recovery when a tilt was intended. Sharing one window meant tightening
      // the smash also broke dash-dancing.
      const lowIn = (hist, frames) => hist.slice(-1 - frames, -1)
        .some((v) => Math.abs(v) < PHYSICS.TILT_THRESHOLD);
      const beyond = Math.abs(this.x) >= T;

      if (beyond && lowIn(this._histX, DW) && this._smashCooldown === 0) {
        this.dashPressed = Math.sign(this.x);
        this._smashCooldown = 3;
        if (lowIn(this._histX, W)) this.smashX = Math.sign(this.x);
      }
      if (Math.abs(this.y) >= T && lowIn(this._histY, W)) {
        this.smashY = Math.sign(this.y);
      }
      if (this.y > 0 && Math.abs(this.y) >= T && lowIn(this._histY, DW)) {
        this.fastFallFlick = true;
      }
    } else {
      // Digital input has no flick velocity: a key goes 0 -> 1 in one frame,
      // which is indistinguishable from a stick flick. Running the analog
      // detector on it would make every keypress a dash and every directional
      // attack a smash, leaving walks and tilts unreachable. So keyboard
      // derives these from explicit intent instead: a modifier key for smash
      // inputs, and a double tap for dashes.
      const dir = Math.sign(rawX);
      if (dir !== 0 && this._lastDirRaw !== dir) {
        // Running by default means any fresh direction press is a dash, which
        // is also what makes dash-dancing work by tapping left and right.
        if (this.autoRun && !this.wantsWalk) {
          this.dashPressed = dir;
        } else if (dir === this._lastTapDir
          && this._frame - this._lastTapFrame <= INPUT.DOUBLE_TAP_FRAMES) {
          this.dashPressed = dir;
        }
        this._lastTapDir = dir;
        this._lastTapFrame = this._frame;
      }
      this._lastDirRaw = dir;

      if (smashMod) {
        if (Math.abs(rawX) > 0) this.smashX = Math.sign(rawX);
        if (Math.abs(rawY) > 0) this.smashY = Math.sign(rawY);
        this.dashPressed = 0;
      } else if (rawY > 0 && this._prevRawY <= 0) {
        this.fastFallFlick = true;
      }
      this._prevRawY = rawY;
      this.smashModHeld = smashMod;
      // Digital sticks are always "fully" tilted.
      if (Math.abs(this.x) > 0 || Math.abs(this.y) > 0) this.mag = 1;
    }

    this.smashXAge++;
    this.smashYAge++;
    if (this.smashX !== 0) { this.smashXDir = this.smashX; this.smashXAge = 0; }
    if (this.smashY !== 0) { this.smashYDir = this.smashY; this.smashYAge = 0; }
  }

  /**
   * A recent horizontal flick that the stick is still holding — the input a
   * smash attack actually reads. Returns -1, 0 or 1.
   */
  get smashXHeld() {
    if (this.smashXAge > INPUT.DIRECTION_MEMORY) return 0;
    if (Math.abs(this.x) < PHYSICS.TILT_THRESHOLD) return 0;
    if (Math.sign(this.x) !== this.smashXDir) return 0;
    return this.smashXDir;
  }

  /**
   * Menu navigation axes: the stick plus the full D-pad. Menus use these so
   * that D-pad up/down navigates, while in-game the D-pad stays bound to taunt.
   */
  get menuX() {
    if (this.dpad.left) return -1;
    if (this.dpad.right) return 1;
    return this.x;
  }

  get menuY() {
    if (this.dpad.up) return -1;
    if (this.dpad.down) return 1;
    return this.y;
  }

  get smashYHeld() {
    if (this.smashYAge > INPUT.DIRECTION_MEMORY) return 0;
    if (Math.abs(this.y) < PHYSICS.TILT_THRESHOLD) return 0;
    if (Math.sign(this.y) !== this.smashYDir) return 0;
    return this.smashYDir;
  }

  /** True if the action was pressed within the buffer window; consumes it. */
  consume(action) {
    if (this.buffer[action] > 0) { this.buffer[action] = 0; return true; }
    return false;
  }

  /** True if buffered, without consuming. */
  peek(action) { return this.buffer[action] > 0; }

  clearBuffer() { for (const a of ACTIONS) this.buffer[a] = 0; }

  /** Stick direction as a cardinal, for tilts and throws. */
  cardinal(threshold = PHYSICS.TILT_THRESHOLD) {
    const ax = Math.abs(this.x), ay = Math.abs(this.y);
    if (ax < threshold && ay < threshold) return 'neutral';
    if (ax >= ay) return this.x > 0 ? 'right' : 'left';
    return this.y > 0 ? 'down' : 'up';
  }

  /** C-stick direction, used for smash attacks and directional aerials. */
  cCardinal() {
    if (this.cmag < 0.4) return 'neutral';
    const ax = Math.abs(this.cx), ay = Math.abs(this.cy);
    if (ax >= ay) return this.cx > 0 ? 'right' : 'left';
    return this.cy > 0 ? 'down' : 'up';
  }
}

/**
 * Chooses a sensible device for each player: connected pads first, then the
 * two keyboard halves. Called at boot and whenever a pad connects.
 */
export function autoBind(playerCount = 2) {
  const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  const connected = [];
  pads.forEach((p, i) => { if (p) connected.push(i); });

  const bindings = [];
  for (let i = 0; i < playerCount; i++) {
    if (connected[i] !== undefined) bindings.push({ type: 'pad', slot: connected[i] });
    else bindings.push({ type: 'keyboard', slot: bindings.filter((b) => b.type === 'keyboard').length % 2 });
  }
  return bindings;
}

export function padCount() {
  const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  return pads.filter(Boolean).length;
}

export { KEYBOARD_PROFILES };
