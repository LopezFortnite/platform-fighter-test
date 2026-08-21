import { SIM } from '../config/gameplay.js';

/**
 * Fixed-timestep game loop.
 *
 * A platform fighter is defined by its frame data, so the simulation must
 * advance in whole 60 Hz steps regardless of display refresh rate. Rendering
 * is decoupled and receives an interpolation alpha.
 */
export class GameLoop {
  constructor({ update, render }) {
    this.update = update;
    this.render = render;
    this.running = false;
    this.accumulator = 0;
    this.lastTime = 0;
    this.frame = 0;
    /** Set to advance exactly one frame while paused — invaluable for frame-data checks. */
    this.stepRequested = false;
    this.paused = false;
    this._tick = this._tick.bind(this);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this._tick);
  }

  stop() {
    this.running = false;
  }

  _tick(now) {
    if (!this.running) return;
    requestAnimationFrame(this._tick);

    let delta = (now - this.lastTime) / 1000;
    this.lastTime = now;
    // A long stall (tab switch, breakpoint) must not produce a burst of catch-up frames.
    if (delta > 0.25) delta = 0.25;

    if (this.paused) {
      if (this.stepRequested) {
        this.stepRequested = false;
        this.frame++;
        this.update(SIM.DT, this.frame);
      }
      this.accumulator = 0;
      this.render(0);
      return;
    }

    this.accumulator += delta;
    let steps = 0;
    while (this.accumulator >= SIM.DT && steps < SIM.MAX_CATCHUP_STEPS) {
      this.accumulator -= SIM.DT;
      this.frame++;
      this.update(SIM.DT, this.frame);
      steps++;
    }
    if (steps === SIM.MAX_CATCHUP_STEPS) this.accumulator = 0;

    this.render(this.accumulator / SIM.DT);
  }
}
