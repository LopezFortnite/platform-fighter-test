/**
 * Universal gameplay tuning.
 *
 * Every number that governs "feel" lives here or in a fighter's data file.
 * Nothing downstream should hardcode a magic constant — balance passes happen
 * in this file alone.
 *
 * Units: pixels and frames. The simulation is a fixed 60 Hz step, so a value
 * expressed "per frame" is also "per 1/60 s".
 */

export const SIM = {
  FPS: 60,
  DT: 1 / 60,
  /** Max simulation steps per rendered frame before we drop time (spiral-of-death guard). */
  MAX_CATCHUP_STEPS: 5,
};

/**
 * Knockback model, ported from Super Smash Bros. Ultimate.
 *
 *   KB = ((((p/10 + p*d/20) * (200/(w+100)) * 1.4) + 18) * (kbg/100)) + bkb
 *
 * p = victim percent AFTER the hit, d = damage, w = victim weight,
 * kbg = knockback growth, bkb = base knockback.
 */
export const KNOCKBACK = {
  PERCENT_DIV: 10,
  PRODUCT_DIV: 20,
  WEIGHT_NUM: 200,
  WEIGHT_OFF: 100,
  SCALE: 1.4,
  CONSTANT: 18,

  /**
   * Launch profile.
   *
   * A hit produces a short freeze and then an explosive launch that bleeds
   * off — not a constant glide. `SPEED_PER_KB` sets how fast the launch
   * starts and `DECAY` how quickly it dies, applied to the launch *vector*
   * (both axes), with gravity accumulating separately on top.
   *
   * Range is v^2 / (2 * DECAY), so it stays quadratic in knockback: high
   * percent is dramatically more dangerous than low percent, which is the
   * property that makes damage matter.
   */
  SPEED_PER_KB: 0.17,
  DECAY: 0.49,
  /** Hitstun frames per unit of knockback. */
  HITSTUN_PER_KB: 0.4,
  /** Above this knockback the victim tumbles (can tech, must jump/airdodge to recover). */
  TUMBLE_THRESHOLD: 80,
  /** Knockback below this leaves the victim grounded instead of launching them. */
  GROUNDED_THRESHOLD: 60,
  /** Gravity multiplier applied while in launch — full gravity feels too sharp. */
  LAUNCH_GRAVITY_MUL: 0.62,

  /** Rage: knockback bonus scaling from 0% to RAGE_MAX percent. */
  RAGE_ENABLED: true,
  RAGE_MAX_PERCENT: 150,
  RAGE_MAX_BONUS: 0.10,

  /** Directional Influence: max launch-angle rotation, in radians. */
  DI_MAX_ROTATION: 0.3141, // 18 degrees
  /** Smash DI: displacement per stick flick during hitlag. */
  SDI_DISTANCE: 6,
  SDI_MAX_PER_HITLAG: 4,
};

export const HITLAG = {
  /**
   * Freeze frames on connect: a short, punchy hold that sells the impact and
   * then gets out of the way, rather than a long mushy pause. A jab freezes
   * for ~3 frames and a heavy smash for ~6.
   *
   * frames = damage * MUL + BASE
   */
  MUL: 0.15,
  BASE: 3,
  /** Attacker hitlag on shield is slightly longer — sells the "thud". */
  SHIELD_MUL: 1.0,
  MAX: 12,
};

export const SHIELD = {
  MAX_HEALTH: 50,
  /** Passive drain per frame while shield is held. */
  DECAY_PER_FRAME: 0.15,
  /** Regeneration per frame while not shielding. */
  REGEN_PER_FRAME: 0.08,
  /** Damage taken by the shield = move damage * this. */
  DAMAGE_MUL: 1.0,
  /** Defender freeze frames = damage * MUL + BASE. */
  STUN_MUL: 0.8,
  STUN_BASE: 2,
  /** Pushback applied to the defender / attacker on a shielded hit. */
  PUSH_DEFENDER: 1.1,
  PUSH_ATTACKER: 0.55,
  /** Frames before the shield bubble appears (also the parry-ish window). */
  STARTUP_FRAMES: 1,
  /** Frames of vulnerability when dropping shield normally. */
  RELEASE_FRAMES: 11,
  /** Shield radius interpolates between these as health drains. */
  RADIUS_MAX: 62,
  RADIUS_MIN: 30,
  /** Stun on shield break, in frames. */
  BREAK_STUN: 180,
  /** Upward launch on shield break. */
  BREAK_LAUNCH: -9,
};

export const DEFENSE = {
  SPOTDODGE: { total: 23, intangible: [3, 17] },
  ROLL: { total: 31, intangible: [4, 17], distance: 155 },
  /** Neutral air dodge: long intangibility, long recovery, no momentum. */
  AIRDODGE_NEUTRAL: { total: 49, intangible: [3, 28], landingLag: 10 },
  /**
   * Directional air dodge: a short repositioning burst, not a teleport.
   * `speed` is the initial impulse and `burstDecay` bleeds it off per frame,
   * so total travel is roughly speed^2 / (2 * burstDecay) — about 120px here,
   * a bit over two character widths.
   */
  AIRDODGE_DIRECTIONAL: { total: 42, intangible: [4, 20], speed: 8, burstDecay: 0.26, landingLag: 10 },
  /** Air dodges are limited per airtime, like Ultimate. */
  AIRDODGES_PER_AIRTIME: 1,
  /** Tech window after touching the ground in tumble. */
  TECH_INPUT_WINDOW: 20,
  TECH_LOCKOUT: 40,
  TECH_IN_PLACE: { total: 26, intangible: [1, 20] },
  TECH_ROLL: { total: 40, intangible: [1, 20], distance: 165 },
  /** Being knocked down. */
  KNOCKDOWN_MIN_FRAMES: 40,
  GETUP: { total: 30, intangible: [1, 22] },
  GETUP_ROLL: { total: 35, intangible: [1, 22], distance: 145 },
  GETUP_ATTACK: { total: 42, intangible: [1, 18] },
};

export const GRAB = {
  /** Grab hold duration scales with the victim's percent. */
  BASE_HOLD_FRAMES: 60,
  HOLD_FRAMES_PER_PERCENT: 0.6,
  MAX_HOLD_FRAMES: 200,
  /** Each mash input shortens the hold. */
  MASH_FRAMES_PER_INPUT: 4,
  PUMMEL_DAMAGE: 1.3,
  PUMMEL_FRAMES: 16,
  /** Frames the thrower is locked after a throw starts. */
  THROW_RELEASE_INTANGIBILITY: 10,
  /** Distance in front of the grabber where the victim is held. */
  HOLD_OFFSET: 42,
};

export const LEDGE = {
  /** Ledge grab box, relative to the ledge corner. */
  BOX_WIDTH: 62,
  BOX_HEIGHT: 110,
  BOX_OUTSET: 34,
  /**
   * Where the fighter's body sits while hanging. The vertical drop is a
   * multiple of the fighter's own height, not a flat distance: hanging is about
   * where the *head* ends up relative to the lip, and a flat offset leaves a
   * tall fighter's skull sticking further over the edge than a short one's.
   * Past 1.0 the whole body is below the lip and only the arms reach over it,
   * which is what keeps a hanging fighter out of range of grounded pokes.
   */
  HANG_OFFSET_X: 26,
  HANG_DROP_RATIO: 1.12,
  /** Intangibility on grabbing the ledge, decreasing with cumulative ledge time. */
  GRAB_INTANGIBILITY: 24,
  /** After this much cumulative hang time in one airtime, regrabs give no intangibility. */
  INTANGIBILITY_BUDGET: 120,
  /** Frames after releasing the ledge before it can be regrabbed. */
  REGRAB_LOCKOUT: 20,
  /** Ledge options. */
  GETUP: { total: 28, intangible: [1, 20] },
  ROLL: { total: 40, intangible: [1, 24], distance: 150 },
  JUMP: { total: 12, intangible: [1, 8], vy: -13.2, vx: 2.2 },
  ATTACK: { total: 44, intangible: [1, 18] },
  /** A fresh ledge grab steals the ledge from an opponent hanging on it (ledge trump). */
  TRUMP_ENABLED: true,
  TRUMP_STUN: 26,
};

export const ELIXIR = {
  /** Both documents specify a 10-elixir bar, matching Clash Royale. */
  MAX: 10,
  /**
   * Regeneration. The docs leave this explicitly open ("it's difficult to tell
   * how fast it regenerates. This would be a later decision to take during
   * balancing"), so this is a prototype value.
   *
   * One Elixir per 2.0 s (Clash Royale is 2.8 s). Fast enough that a cheap
   * 1-2 cost tool is always somewhere on the horizon, slow enough that a
   * 5-cost Fireball is a real investment: roughly one every 10 s from empty.
   * The whole point of the mechanic is that spending on one powerful move
   * means giving up the others until the bar refills, so sitting at max
   * Elixir should be the exception, not the resting state.
   */
  SECONDS_PER_ELIXIR: 2.0,
  /** Elixir carried over on death. Respawning with an empty bar feels punishing twice. */
  ON_RESPAWN: 4,
  /** Starting elixir at match start. */
  ON_MATCH_START: 5,
  /**
   * Late game (full doc): production increases as the clock winds down, so
   * players are pushed to fight rather than time each other out.
   */
  LATE_GAME: [
    { secondsRemaining: 120, multiplier: 1.5, label: 'DOUBLE ELIXIR' },
    { secondsRemaining: 60, multiplier: 2.0, label: 'TRIPLE ELIXIR' },
  ],
};

export const MATCH = {
  /** Tournament ruleset from the full doc: 7-minute games. */
  DURATION_SECONDS: 7 * 60,
  STOCKS: 3,
  /** Frames of "Ready / GO" before inputs unlock. */
  INTRO_FRAMES: 90,
  /** Freeze on a KO so the hit reads. */
  KO_FREEZE_FRAMES: 24,
  /** A hit this recent counts as having caused the KO that follows it. */
  KO_CREDIT_FRAMES: 300,
  RESPAWN_FRAMES: 70,
  /** Invincibility on the respawn platform, and how long you may sit on it. */
  RESPAWN_INVINCIBILITY: 120,
  RESPAWN_PLATFORM_TIMEOUT: 180,
  RESPAWN_HEIGHT: 300,
  /** Sudden-death-free timeout resolution: most stocks, then least damage. */
  GAME_OVER_FREEZE: 120,
};

export const PHYSICS = {
  /**
   * Frames between pressing jump and leaving the ground — universal, not a
   * per-fighter attribute. It is the window every jump-cancel, short hop and
   * out-of-shield option is timed against, so a heavy having a longer one
   * makes them feel unresponsive rather than heavy. Weight belongs in gravity,
   * fall speed and air control instead.
   */
  JUMP_SQUAT_FRAMES: 3,
  /** Terminal velocity ceiling applied on top of per-fighter fall speed. */
  ABSOLUTE_MAX_FALL: 22,
  /** Horizontal speed cap for launched fighters. */
  ABSOLUTE_MAX_SPEED: 40,
  /** Stick magnitude past which a horizontal input counts as a run rather than a walk. */
  WALK_RUN_THRESHOLD: 0.68,
  /** Deadzone applied to analogue sticks. */
  STICK_DEADZONE: 0.22,
  /** Magnitude required to register a tilt attack direction. */
  TILT_THRESHOLD: 0.35,
  /** Magnitude + speed required for a smash input (flick). */
  /**
   * Magnitude + speed required for a smash input (flick).
   *
   * Deliberately strict. A smash coming out when a tilt was wanted costs the
   * player 40-odd frames of recovery they did not ask for, so the input has to
   * be one you can only make on purpose: the stick has to travel from
   * near-neutral to past the threshold inside SMASH_WINDOW_FRAMES.
   */
  SMASH_THRESHOLD: 0.84,
  SMASH_WINDOW_FRAMES: 2,
  /**
   * The same motion read for a *dash*, which wants the opposite treatment —
   * it is how you move, and dash-dancing throws the stick back and forth all
   * game. Kept loose on purpose; see PlayerInput._updateFlicks.
   */
  DASH_WINDOW_FRAMES: 5,
  /** Down-flick speed required to fast fall. */
  FASTFALL_THRESHOLD: 0.7,
  /** Frames a soft platform is ignored after dropping through it. */
  PLATFORM_DROP_FRAMES: 12,
  /** Crouch shrinks the hurtbox by this factor. */
  CROUCH_HEIGHT_MUL: 0.62,
};

export const SMASH_CHARGE = {
  /** Frames a smash attack can be held. */
  MAX_FRAMES: 60,
  /** Damage/knockback multiplier at full charge. */
  MAX_MULTIPLIER: 1.4,
  /** Charge is entered on frame 1 and released on button release or timeout. */
  MIN_FRAMES: 2,
};

export const INPUT = {
  /** Frames an action press stays queued — the difference between "responsive" and "sloppy". */
  BUFFER_FRAMES: 8,
  /**
   * Frames a direction is remembered for a smash input after the flick.
   *
   * This is the other half of "a tilt came out as a smash": flick the stick to
   * move, press attack a few frames later, and the stale flick was still armed.
   * Short enough now that the attack has to be part of the same motion.
   */
  DIRECTION_MEMORY: 3,
  /** Frames within which two taps count as a double-tap dash. */
  DOUBLE_TAP_FRAMES: 11,
};

export const STALE = {
  /** Move staling queue, Ultimate style: repeated moves lose damage and knockback. */
  ENABLED: true,
  QUEUE_SIZE: 9,
  /** Multiplier by number of occurrences in the queue (index 0 = fresh). */
  MULTIPLIERS: [1.0, 0.92, 0.87, 0.83, 0.79, 0.76, 0.73, 0.71, 0.69, 0.67],
  /** Freshness bonus for a move not in the queue at all. */
  FRESH_BONUS: 1.05,
};

export const CAMERA = {
  MIN_ZOOM: 0.52,
  /**
   * Upper bound on how close the camera pushes in. At 1.7 the stage roughly
   * fills the frame at neutral (about six character-heights of vertical view),
   * which is the framing Smash uses; lower values leave the fighters looking
   * like specks on a large slab.
   */
  MAX_ZOOM: 1.7,
  /** Padding around the tracked bounding box, in world px. */
  PADDING_X: 340,
  PADDING_Y: 250,
  /** Exponential smoothing per frame (0..1, higher = snappier). */
  LERP: 0.11,
  ZOOM_LERP: 0.07,
  SHAKE_DECAY: 0.86,
  SHAKE_PER_KB: 0.045,
  SHAKE_MAX: 26,
};

export const DEBUG = {
  /** Hitbox/hurtbox overlay. This is a gameplay-validation build, so it starts on. */
  SHOW_BOXES: true,
  SHOW_STATE: true,
  SHOW_FRAME_DATA: false,
};
