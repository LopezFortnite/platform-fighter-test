import { MATCH, SIM } from '../config/gameplay.js';
import { Stage } from '../engine/stage.js';
import { Fighter } from './fighter.js';
import { HitSystem } from './hitSystem.js';
import { Projectile } from './projectile.js';
import { lateGameState } from './elixir.js';
import { S } from './states.js';
import { keyboard } from '../core/input.js';

/**
 * The match — the world every gameplay system talks to.
 *
 * Owns the stage, the fighters, projectiles and effects, and runs the rules
 * layer described in the design documents: stocks, blast zones, a 7-minute
 * tournament clock and the late-game Elixir production increase that exists
 * specifically so timeouts "would almost never happen".
 */
export class Match {
  constructor({ stageDef, entries, camera, rules = {} }) {
    this.stage = new Stage(stageDef);
    this.camera = camera;
    this.rules = {
      stocks: rules.stocks !== undefined ? rules.stocks : MATCH.STOCKS,
      durationSeconds: rules.durationSeconds !== undefined ? rules.durationSeconds : MATCH.DURATION_SECONDS,
      lateGame: rules.lateGame !== false,
      infiniteElixir: !!rules.infiniteElixir,
      /** Training: the clock never runs out and the match never ends. */
      untimed: !!rules.untimed,
      training: !!rules.training,
      /**
       * Netplay: the caller has already applied both players' inputs for this
       * frame, so `step` must not poll devices. Note that this object is a
       * **whitelist** rebuilt from the argument rather than a spread — a rule
       * that is not named here is silently dropped, which is exactly how this
       * one failed to take effect the first time.
       */
      externalInput: !!rules.externalInput,
    };

    this.fighters = entries.map((entry, i) => {
      const f = new Fighter(entry.def, i, entry.input, this);
      f.stocks = this.rules.stocks;
      const spawn = this.stage.spawns[i % this.stage.spawns.length];
      f.spawnAt(spawn.x, spawn.y, spawn.facing);
      f.color = entry.color || entry.def.color;
      /** HUD card frame colour; falls back to the model tint. */
      f.hudColor = entry.hudColor || f.color;
      /** Which clothing recolour the model wears — see the rig's `applyVariant`. */
      f.variant = entry.variant || null;
      f.isCPU = !!entry.cpu;
      return f;
    });

    // Controllers are attached only once every fighter exists — a CPU needs to
    // look up its opponent, which is not possible mid-construction.
    entries.forEach((entry, i) => {
      if (entry.input && typeof entry.input.attach === 'function') {
        entry.input.attach(this.fighters[i], this);
      }
    });

    this.projectiles = [];
    this.effects = [];
    this.hitSystem = new HitSystem(this);

    this.frame = 0;
    this.timerFrames = this.rules.durationSeconds * SIM.FPS;
    this.introFrames = MATCH.INTRO_FRAMES;
    this.freezeFrames = 0;
    this.over = false;
    this.result = null;
    this.overFreeze = 0;

    this.lateGameLabel = null;
    this.lateGameFlash = 0;
    /** KO banners for the HUD. */
    this.announcements = [];
  }

  get secondsRemaining() { return Math.max(0, this.timerFrames / SIM.FPS); }
  get inputsLocked() { return this.introFrames > 0 || this.over; }

  step() {
    this.frame++;

    if (this.over) {
      this.overFreeze++;
      this.stepEffects();
      this.camera.update(this.fighters, this.stage);
      return;
    }

    /**
     * Netplay supplies inputs itself.
     *
     * In an online match the lockstep driver has already applied both players'
     * inputs for this exact frame — one from the local device, one off the
     * wire. Polling here would overwrite the remote player's input with a live
     * read of *this* machine's controller, which is both wrong and an instant
     * desync. The flag is the whole integration: everything downstream is
     * unchanged and never learns that a player is remote.
     */
    if (!this.rules.externalInput) {
      for (const f of this.fighters) if (f.input) f.input.poll();
    }
    keyboard.flush();

    if (this.introFrames > 0) {
      this.introFrames--;
      for (const f of this.fighters) f.input && f.input.clearBuffer();
      this.stepEffects();
      this.camera.update(this.fighters, this.stage);
      return;
    }

    // A KO freezes the world briefly so the blast reads.
    if (this.freezeFrames > 0) {
      this.freezeFrames--;
      this.stepEffects();
      this.camera.update(this.fighters, this.stage);
      return;
    }

    this.stepClock();

    /**
     * Training's infinite Elixir, topped up **before** the fighters step so a
     * special started this frame sees a full bar. Refilling afterwards would
     * still show full on the HUD but deny the move that just asked for it.
     *
     * A rule rather than a flag on the bar: it is a property of the session, and
     * `rateMultiplier` is rewritten every step by the late-game ramp, so parking
     * it there would not survive.
     */
    if (this.rules.infiniteElixir) {
      for (const f of this.fighters) f.elixir.value = f.elixir.max;
    }

    for (const f of this.fighters) f.step();

    this.hitSystem.step(this.frame);

    for (const p of this.projectiles) if (!p.dead) p.step(this);
    this.projectiles = this.projectiles.filter((p) => !p.dead);

    this.checkBlastZones();
    this.stepRespawns();
    this.stepEffects();

    this.camera.update(this.fighters, this.stage);
    this.checkGameOver();
  }

  /**
   * The clock, and with it the Elixir economy.
   * "if the game clock hits the 2-minute mark, elixir production is increased
   * by 50%... then, at the 1-minute mark, it goes up to 100%."
   */
  stepClock() {
    if (!this.rules.untimed && this.timerFrames > 0) this.timerFrames--;

    let multiplier = 1;
    let label = null;
    if (this.rules.lateGame) {
      const state = lateGameState(this.secondsRemaining);
      multiplier = state.multiplier;
      label = state.label;
    }
    if (this.rules.infiniteElixir) multiplier = 1000;

    if (label !== this.lateGameLabel) {
      this.lateGameLabel = label;
      if (label) {
        this.lateGameFlash = 120;
        this.announcements.push({ text: label, life: 120, color: '#e46fd0' });
      }
    }
    if (this.lateGameFlash > 0) this.lateGameFlash--;

    for (const f of this.fighters) f.elixir.rateMultiplier = multiplier;

    if (!this.rules.untimed && this.timerFrames <= 0) this.endByTimeout();
  }

  checkBlastZones() {
    const b = this.stage.blastZones;

    for (const f of this.fighters) {
      if (!f.alive || f.state === S.DEAD || f.state === S.RESPAWN) continue;

      const cx = f.x;
      const cy = f.y - f.height * 0.5;
      const outSide = cx < b.left || cx > b.right;
      const outBottom = cy > b.bottom;
      const outTop = cy < b.top;
      if (!outSide && !outBottom && !outTop) continue;

      // Vertical KOs require having been launched. A fighter cannot kill
      // itself on the ceiling with its own jumps or recovery — it just stops
      // rising and falls back in. Side and bottom self-destructs still count,
      // because failing a recovery is supposed to kill you.
      if (outTop && !outSide && !outBottom && !f.launchedAirborne) {
        f.y = b.top + f.height * 0.5 + 2;
        if (f.vy < 0) f.vy = 0;
        continue;
      }

      const side = this.stage.blastSide(cx, cy);

      // Credit the KO. A recent hit means someone sent them there; anything
      // older is a self-destruct, which the results screen counts separately.
      const killer = this.frame - f.lastHitByFrame <= MATCH.KO_CREDIT_FRAMES ? f.lastHitBy : null;
      f.stats.falls++;
      if (killer && killer !== f) killer.stats.kos++;
      else f.stats.selfDestructs++;
      f.lastHitBy = null;

      f.onKO();
      this.clearProjectilesOf(f);
      this.freezeFrames = MATCH.KO_FREEZE_FRAMES;
      this.camera.addShake(120);
      this.announcements.push({
        text: `${f.def.name} KO'd`,
        life: 90,
        color: f.color,
      });
      this.spawnEffect({
        x: Math.max(this.stage.blastZones.left, Math.min(this.stage.blastZones.right, f.x)),
        y: Math.max(this.stage.blastZones.top, Math.min(this.stage.blastZones.bottom, f.y)),
        kind: 'ko', size: 90, life: 30, color: f.color,
      });

      // The KO'd fighter's opponents get their staling queue refreshed on a
      // successful kill, matching Ultimate.
      for (const other of this.fighters) if (other !== f) other.stale.clear();

      if (f.stocks > 0) f.respawnQueue = MATCH.RESPAWN_FRAMES;
      side; // (retained for future directional KO effects)
    }
  }

  stepRespawns() {
    for (const f of this.fighters) {
      if (f.respawnQueue === undefined || f.respawnQueue === null) continue;
      if (f.alive) { f.respawnQueue = null; continue; }
      f.respawnQueue--;
      if (f.respawnQueue > 0) continue;
      f.respawnQueue = null;
      f.respawn(this.stage.respawnX, -MATCH.RESPAWN_HEIGHT);
    }
  }

  stepEffects() {
    // Effects carry a velocity so smoke can drift and streaks can trail. It
    // defaults to zero, so anything that does not ask for it stays put.
    for (const e of this.effects) { e.age++; e.x += e.vx; e.y += e.vy; }
    this.effects = this.effects.filter((e) => e.age < e.life);
    for (const a of this.announcements) a.life--;
    this.announcements = this.announcements.filter((a) => a.life > 0);
  }

  checkGameOver() {
    if (this.rules.training) return;   // training never ends
    const remaining = this.fighters.filter((f) => f.stocks > 0);
    if (remaining.length <= 1) {
      this.over = true;
      this.result = {
        reason: 'stocks',
        winner: remaining[0] || null,
        standings: this.standings(),
        durationFrames: this.frame,
      };
    }
  }

  /** Timeout: most stocks, then least damage — the ruleset from the documents. */
  endByTimeout() {
    if (this.over) return;
    const standings = this.standings();
    const top = standings[0];
    const tie = standings.length > 1 &&
      standings[1].stocks === top.stocks &&
      Math.abs(standings[1].damage - top.damage) < 0.001;
    this.over = true;
    this.result = {
      reason: 'time',
      winner: tie ? null : top.fighter,
      standings,
      durationFrames: this.frame,
    };
  }

  standings() {
    return this.fighters
      .map((f) => ({ fighter: f, stocks: f.stocks, damage: f.damage }))
      .sort((a, b) => (b.stocks - a.stocks) || (a.damage - b.damage));
  }

  // ------------------------------------------------------------- spawn API

  spawnProjectile(owner, opts) {
    const p = new Projectile(owner, opts);
    this.projectiles.push(p);
    return p;
  }

  spawnEffect(opts) {
    this.effects.push({
      x: opts.x, y: opts.y,
      kind: opts.kind || 'hit',
      size: opts.size || 16,
      life: opts.life || 12,
      age: 0,
      color: opts.color || null,
      effect: opts.effect || 'none',
      vx: opts.vx || 0, vy: opts.vy || 0,
      /** Streaks are drawn along this heading; smoke rolls by it. */
      angle: opts.angle || 0,
      spin: opts.spin || 0,
    });
  }

  /** Removes every projectile owned by a fighter (used on KO and on state resets). */
  clearProjectilesOf(owner) {
    for (const p of this.projectiles) if (p.owner === owner) p.dead = true;
  }
}
