/**
 * Fighter states.
 *
 * Anything with authored frame data — attacks, dodges, rolls, throws, ledge
 * options, getups — runs through the single ACTION state driving a move
 * definition. That keeps the state machine small and makes every timed
 * behaviour in the game data rather than code.
 */
export const S = {
  IDLE: 'idle',
  WALK: 'walk',
  DASH: 'dash',
  RUN: 'run',
  RUN_BRAKE: 'runBrake',
  TURN: 'turn',
  CROUCH: 'crouch',
  JUMPSQUAT: 'jumpsquat',
  AIR: 'air',
  LANDING: 'landing',
  HELPLESS: 'helpless',

  ACTION: 'action',

  SHIELD: 'shield',
  SHIELD_STUN: 'shieldStun',
  SHIELD_DROP: 'shieldDrop',
  SHIELD_BREAK: 'shieldBreak',
  DIZZY: 'dizzy',

  HITSTUN: 'hitstun',
  TUMBLE: 'tumble',
  DOWNED: 'downed',

  GRABBING: 'grabbing',
  GRABBED: 'grabbed',

  LEDGE_HANG: 'ledgeHang',

  RESPAWN: 'respawn',
  DEAD: 'dead',
};

/** States in which the fighter is standing on a surface. */
export const GROUNDED_STATES = new Set([
  S.IDLE, S.WALK, S.DASH, S.RUN, S.RUN_BRAKE, S.TURN, S.CROUCH,
  S.JUMPSQUAT, S.LANDING, S.SHIELD, S.SHIELD_STUN, S.SHIELD_DROP,
  S.SHIELD_BREAK, S.DIZZY, S.DOWNED, S.GRABBING,
]);

/** States that accept fresh movement/attack input. */
export const ACTIONABLE_STATES = new Set([
  S.IDLE, S.WALK, S.DASH, S.RUN, S.RUN_BRAKE, S.TURN, S.CROUCH, S.AIR,
]);

/** States where the fighter cannot be hit out of a scripted sequence. */
export const BUSY_STATES = new Set([
  S.ACTION, S.HITSTUN, S.TUMBLE, S.GRABBED, S.SHIELD_BREAK, S.DIZZY,
  S.RESPAWN, S.DEAD, S.HELPLESS,
]);
