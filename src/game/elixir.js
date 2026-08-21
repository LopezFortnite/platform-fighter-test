import { ELIXIR, SIM } from '../config/gameplay.js';
import { clamp } from '../core/math.js';

/**
 * The Elixir bar — Clash Rumble's defining mechanic.
 *
 * From the design documents:
 *   - every fighter carries an Elixir bar that holds a maximum of 10
 *   - it regenerates slowly over time, exactly like Clash Royale
 *   - every special move ("B move") costs Elixir
 *   - spending on one powerful move means giving up the others until it refills
 *   - late in the match, production is increased so players are pushed to
 *     fight instead of running the clock down
 *
 * A move whose cost cannot be paid simply does not come out (unless it declares
 * a fallback, e.g. the Archer Queen's "just spot dodge instead" behaviour).
 */
export class ElixirBar {
  constructor(startValue = ELIXIR.ON_MATCH_START) {
    this.value = clamp(startValue, 0, ELIXIR.MAX);
    /** External multiplier — late game, Elixir Collector, "infinite elixir" events. */
    this.rateMultiplier = 1;
    /** Frames remaining during which regeneration is suppressed (e.g. Knight's shield). */
    this.lockFrames = 0;
    /** Purely cosmetic: pulses the HUD bar when elixir is spent or a spend fails. */
    this.flash = 0;
    this.denied = 0;
  }

  get max() { return ELIXIR.MAX; }
  get ratio() { return this.value / ELIXIR.MAX; }

  step() {
    if (this.flash > 0) this.flash--;
    if (this.denied > 0) this.denied--;

    if (this.lockFrames > 0) { this.lockFrames--; return; }
    const perFrame = 1 / (ELIXIR.SECONDS_PER_ELIXIR * SIM.FPS);
    this.value = clamp(this.value + perFrame * this.rateMultiplier, 0, ELIXIR.MAX);
  }

  canAfford(cost) { return this.value >= cost - 1e-6; }

  /** Spends if affordable. Returns whether the spend succeeded. */
  spend(cost) {
    if (cost <= 0) return true;
    if (!this.canAfford(cost)) { this.denied = 12; return false; }
    this.value = clamp(this.value - cost, 0, ELIXIR.MAX);
    this.flash = 10;
    return true;
  }

  /** Elixir Golem-style refunds, Witch soul heals, and other gains. */
  gain(amount) {
    this.value = clamp(this.value + amount, 0, ELIXIR.MAX);
    this.flash = 8;
  }

  /** Suppresses regeneration for a duration, in frames. */
  lock(frames) { this.lockFrames = Math.max(this.lockFrames, frames); }

  onRespawn() {
    this.value = ELIXIR.ON_RESPAWN;
    this.lockFrames = 0;
  }
}

/**
 * Resolves the late-game production multiplier for a given clock.
 * Returns `{ multiplier, label }`; label is null before late game begins.
 */
export function lateGameState(secondsRemaining) {
  let multiplier = 1;
  let label = null;
  for (const tier of ELIXIR.LATE_GAME) {
    if (secondsRemaining <= tier.secondsRemaining) {
      multiplier = tier.multiplier;
      label = tier.label;
    }
  }
  return { multiplier, label };
}
