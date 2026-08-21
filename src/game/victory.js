import { SIM } from '../config/gameplay.js';
import { S } from './states.js';
import { clamp } from '../core/math.js';

/**
 * The victory ceremony.
 *
 * When a match ends the simulation stops, and the fighters stop being
 * simulated objects: nothing steps them any more. This takes them over as
 * props — placing them on the stage, choosing a pose for each and cutting a
 * short camera sequence around the winner — and then settles into the framing
 * the results panel is laid out against.
 *
 * Two phases:
 *   'anim'  — a cut sequence of shots on the winner, played in full
 *   'stats' — the held two-shot the results panel and options menu draw over
 *
 * Camera shots are described in *simulation* coordinates (y grows downward)
 * and stay free of any renderer types, so the 3D layer keeps its one-way
 * dependency on the game layer.
 */

/**
 * Where the ceremony stands the fighters, relative to stage centre. They are
 * apart far enough that the results panel sits in the gap between them.
 */
const WINNER_X = -145;
const LOSER_X = 145;

/**
 * The shot list. Each entry cuts (no blending between shots — the cut is the
 * point) and then eases from `from` to `to` across its own frames.
 *
 *   dist  — metres back from the subject
 *   yaw   — 0 looks straight down +z at the subject; positive swings right
 *   pitch — elevation; negative looks *up* at the subject
 *   lift  — how far up the subject the camera aims, as a fraction of height
 *
 * The winner is stood facing +x, so a *positive* yaw is the side their face is
 * on. Shots that end on the winner end positive; the orbit is the one that
 * starts behind them, which is the whole point of it.
 */
const SHOTS = [
  {
    id: 'impact', frames: 52, pose: 'raise', subject: 'winner',
    from: { dist: 330, yaw: 0.95, pitch: -0.10, lift: 0.55, fov: 34 },
    to: { dist: 250, yaw: 0.60, pitch: -0.05, lift: 0.58, fov: 34 },
  },
  {
    id: 'orbit', frames: 66, pose: 'spin', subject: 'winner',
    from: { dist: 340, yaw: -0.95, pitch: 0.22, lift: 0.50, fov: 40 },
    to: { dist: 290, yaw: 0.70, pitch: 0.12, lift: 0.50, fov: 40 },
  },
  {
    id: 'hero', frames: 56, pose: 'point', subject: 'winner',
    from: { dist: 300, yaw: 0.45, pitch: -0.20, lift: 0.62, fov: 32 },
    to: { dist: 245, yaw: 0.15, pitch: -0.10, lift: 0.64, fov: 32 },
  },
  {
    id: 'settle', frames: 48, pose: 'cheer', subject: 'pair',
    from: { dist: 380, yaw: -0.35, pitch: 0.10, lift: 0.62, fov: 40 },
    to: { dist: 620, yaw: -0.04, pitch: 0.14, lift: 0.75, fov: 40 },
  },
];

/** The framing the results panel is laid out against; held, with a slow drift. */
const STATS_SHOT = { dist: 630, yaw: -0.04, pitch: 0.14, lift: 0.75, fov: 40 };

/** Ease-out, so each shot lands rather than stopping dead. */
function ease(t) {
  return 1 - Math.pow(1 - clamp(t, 0, 1), 2.2);
}

function lerpShot(a, b, t) {
  return {
    dist: a.dist + (b.dist - a.dist) * t,
    yaw: a.yaw + (b.yaw - a.yaw) * t,
    pitch: a.pitch + (b.pitch - a.pitch) * t,
    lift: a.lift + (b.lift - a.lift) * t,
    fov: a.fov + (b.fov - a.fov) * t,
  };
}

export class VictorySequence {
  /** @param {import('./match.js').Match} match a match whose result has settled */
  constructor(match) {
    this.match = match;
    this.result = match.result || { winner: null, standings: [], reason: 'stocks' };

    const winner = this.result.winner || null;
    this.winner = winner;
    this.loser = match.fighters.find((f) => f !== winner) || null;
    // A draw has no one to celebrate, so both fighters get the loser's pose and
    // the sequence is only the settle shot.
    this.draw = !winner;

    this.frame = 0;
    this.shotIndex = this.draw ? SHOTS.length - 1 : 0;
    this.shotFrame = 0;
    this.phase = 'anim';
    /** Counts up once the stats are showing, for the panel's own entrance. */
    this.statsFrame = 0;

    this.placeFighters();
  }

  // ------------------------------------------------------------------ setup

  /**
   * Stands the fighters up on the stage floor. The match is over, so this is
   * writing to props rather than to a running simulation — but it is still
   * simulation state, which is why the ceremony lives in the game layer and
   * not in the renderer.
   */
  placeFighters() {
    const ground = this.groundY();
    // On a draw there is no winner to put on the left, so the fighters simply
    // keep their own order — both of them get the losing pose anyway.
    const cast = this.draw
      ? this.match.fighters.map((f, i) => ({ f, x: i === 0 ? WINNER_X : LOSER_X, facing: i === 0 ? 1 : -1 }))
      : [
        { f: this.winner, x: WINNER_X, facing: 1 },
        { f: this.loser, x: LOSER_X, facing: -1 },
      ];
    for (const { f, x, facing } of cast) {
      if (!f) continue;
      f.x = x;
      f.y = ground;
      f.vx = 0; f.vy = 0;
      f.facing = facing;
      // A KO'd fighter is left in DEAD, which the rig hides. They have to be
      // on stage to look sad about it.
      f.state = S.IDLE;
      f.alive = true;
      f.move = null;
      f.hitlag = 0;
      f.flashFrames = 0;
      f.shield.active = false;
    }
  }

  /** Top surface of the stage's main platform. */
  groundY() {
    const main = this.match.stage.platforms.find((p) => p.type === 'solid');
    return main ? main.y : 0;
  }

  // ----------------------------------------------------------------- update

  /** The shot sequence runs to its end; there is no skip. */
  step() {
    this.frame++;
    if (this.phase === 'stats') { this.statsFrame++; return; }

    this.shotFrame++;
    if (this.shotFrame >= SHOTS[this.shotIndex].frames) {
      if (this.shotIndex === SHOTS.length - 1) { this.finishAnim(); return; }
      this.shotIndex++;
      this.shotFrame = 0;
    }
  }

  finishAnim() {
    this.phase = 'stats';
    this.statsFrame = 0;
  }

  /**
   * 1 on a cut, falling to 0 over a few frames — the presentation punches the
   * frame on it, which is what sells a cut as a cut rather than a glitch.
   */
  get cutFlash() {
    if (this.phase !== 'anim') return 0;
    return Math.max(0, 1 - this.shotFrame / 7);
  }

  get shot() { return SHOTS[this.shotIndex]; }

  /** 0..1 through the current shot. */
  get shotProgress() {
    const s = this.shot;
    return s ? clamp(this.shotFrame / s.frames, 0, 1) : 1;
  }

  // ----------------------------------------------------------------- camera

  /**
   * The camera for this frame, in simulation space.
   * @returns {{x:number, y:number, dist:number, yaw:number, pitch:number, fov:number}}
   */
  camera() {
    const subject = this.subjectPoint();
    let s;
    if (this.phase === 'stats') {
      // A very slow drift keeps the held shot from looking like a still.
      const t = this.statsFrame / SIM.FPS;
      s = { ...STATS_SHOT, yaw: STATS_SHOT.yaw + Math.sin(t * 0.35) * 0.045 };
    } else {
      s = lerpShot(this.shot.from, this.shot.to, ease(this.shotProgress));
    }
    const height = subject.height;
    return {
      x: subject.x,
      y: subject.y - height * s.lift,
      dist: s.dist,
      yaw: s.yaw,
      pitch: s.pitch,
      fov: s.fov,
    };
  }

  /** What the current shot is aimed at. */
  subjectPoint() {
    const pair = this.phase === 'stats' || this.draw || this.shot.subject === 'pair';
    if (pair) {
      const fs = this.match.fighters;
      const xs = fs.map((f) => f.x);
      return {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: this.groundY(),
        height: Math.max(...fs.map((f) => f.def.height)),
      };
    }
    const w = this.winner || this.loser;
    return { x: w.x, y: w.y, height: w.def.height };
  }

  // ------------------------------------------------------------------ poses

  /**
   * The pose for a fighter this frame, consumed by the rig.
   * @returns {{pose:string, t:number, clock:number}|null}
   */
  poseFor(fighter) {
    if (!fighter) return null;
    const loop = this.frame / SIM.FPS;
    if (this.draw) return { pose: 'sad', t: 1, clock: loop };
    if (fighter === this.winner) {
      const pose = this.phase === 'stats' ? 'cheer' : this.shot.pose;
      const t = this.phase === 'stats' ? 1 : ease(this.shotProgress);
      return { pose, t, clock: loop };
    }
    // The loser is only on camera once the shot widens out to both of them.
    return { pose: 'sad', t: 1, clock: loop };
  }

  /** Hides the loser until the sequence widens out to include them. */
  isVisible(fighter) {
    if (fighter === this.winner || this.draw) return true;
    return this.phase === 'stats' || this.shot.subject === 'pair';
  }

  // ------------------------------------------------------------------ stats

  /**
   * Rows for the results panel: a label, one value per fighter in the
   * fighters' own order so the columns line up with the HUD colours, and which
   * column won that row so the panel can pick it out.
   */
  statRows() {
    const fs = this.match.fighters;
    const pct = (v) => `${v.toFixed(1)}%`;
    const rows = [
      { label: 'KOs', pick: (f) => f.stats.kos, best: 'high', fmt: String },
      { label: 'Falls', pick: (f) => f.stats.falls, best: 'low', fmt: String },
      { label: 'Damage dealt', pick: (f) => f.stats.damageDealt, best: 'high', fmt: pct },
      { label: 'Damage taken', pick: (f) => f.stats.damageTaken, best: 'low', fmt: pct },
      { label: 'Biggest hit', pick: (f) => f.stats.biggestHit, best: 'high', fmt: pct },
      { label: 'Self-destructs', pick: (f) => f.stats.selfDestructs, best: 'low', fmt: String },
      { label: 'Stocks left', pick: (f) => Math.max(0, f.stocks), best: 'high', fmt: String },
    ];

    return rows.map((r) => {
      const raw = fs.map(r.pick);
      let leader = -1;
      if (raw.length === 2 && raw[0] !== raw[1]) {
        const first = r.best === 'high' ? raw[0] > raw[1] : raw[0] < raw[1];
        leader = first ? 0 : 1;
      }
      return { label: r.label, values: raw.map(r.fmt), leader };
    });
  }

  /** Match length as m:ss. */
  durationText() {
    const frames = this.result.durationFrames || this.match.frame;
    const total = Math.round(frames / SIM.FPS);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }
}
