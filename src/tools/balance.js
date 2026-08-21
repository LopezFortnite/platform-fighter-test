/**
 * Balance harness.
 *
 * Drives the live simulation headlessly to answer the questions a balance pass
 * actually asks: at what percent does this move KO from centre stage, does
 * every hitbox connect at realistic spacings, and how much does DI change the
 * outcome.
 *
 * Run from the browser console:  CR.balance()          full report
 *                                CR.balance('kills')   kill percents only
 *                                CR.balance('reach')   hitbox coverage only
 *
 * It mutates the running match, so start a fresh one afterwards (CR.start()).
 */

const KILL_SWEEP_MAX = 280;
const KILL_SWEEP_STEP = 5;

/** Neutralises an input object so scripted trials are not disturbed by a device. */
function silence(inp) {
  inp.poll = function poll() { this.smashXAge++; this.smashYAge++; };
  inp.x = 0; inp.y = 0; inp.mag = 0; inp.cx = 0; inp.cy = 0; inp.cmag = 0;
  inp.smashX = 0; inp.smashY = 0; inp.dashPressed = 0; inp.fastFallFlick = false;
  for (const k in inp.held) { inp.held[k] = false; inp.pressed[k] = false; inp.buffer[k] = 0; }
}

/**
 * Returns both fighters and the match to a known, isolated state.
 * Character gimmicks that absorb hits are disabled so trials measure raw
 * knockback rather than a combo breaker.
 */
function resetWorld(match, attacker, victim) {
  match.freezeFrames = 0;
  match.over = false;
  match.result = null;
  match.timerFrames = match.rules.durationSeconds * 60;
  match.projectiles.length = 0;
  match.effects.length = 0;
  match.announcements.length = 0;

  for (const f of match.fighters) {
    f.alive = true;
    f.stocks = 99;
    f.respawnQueue = null;
    f.hitstun = 0;
    f.hitlag = 0;
    f.pendingHit = null;
    f.damage = 0;
    f.stale.clear();
    f.elixir.value = f.elixir.max;
    f.cooldowns.clear();
    f.custom = {};
    if (f.def.onCreate) f.def.onCreate(f);
    if (f.custom.fireShield) f.custom.fireShield.active = false;
    f.custom.fireShieldUsed = true;
  }

  attacker.spawnAt(0, 0, 1);
  victim.spawnAt(55, 0, -1);
  for (const inp of match.fighters.map((f) => f.input)) if (inp) silence(inp);
}

/**
 * Where a move's hitboxes actually live. Measuring a back air against a dummy
 * standing in front would report "never kills", which is worse than no data.
 */
const PLACEMENT = {
  bair: { dx: -55, dy: 0 },
  uair: { dx: 14, dy: -100 },
  utilt: { dx: 14, dy: -70 },
  usmash: { dx: 30, dy: -70 },
  dair: { dx: 14, dy: 44 },
};
const DEFAULT_PLACEMENT = { dx: 55, dy: 0 };

/**
 * Runs one attack and reports which blast zone (if any) the victim crossed.
 * The victim is held at its start position until the hit connects, so the
 * measurement is of the move's knockback rather than of the dummy falling.
 * @returns {'top'|'bottom'|'side'|null}
 */
function trial(match, attackerIndex, moveId, percent, { charge = 0, di = null } = {}) {
  const attacker = match.fighters[attackerIndex];
  const victim = match.fighters[1 - attackerIndex];
  const place = PLACEMENT[moveId] || DEFAULT_PLACEMENT;

  resetWorld(match, attacker, victim);
  victim.spawnAt(place.dx, place.dy, -1);
  victim.damage = percent;

  match.step();
  const move = attacker.moves[moveId];
  if (!move) return null;
  attacker.startAction(move, { noCharge: true });
  if (charge) attacker.chargeFrames = charge;

  const vi = victim.input;
  if (di && vi) { vi.x = di.x; vi.y = di.y; vi.mag = 1; }

  const startPercent = victim.damage;
  let connected = false;   // the hitbox touched — may still be in hitlag
  let launched = false;    // hitstun has actually begun
  for (let i = 0; i < 420; i++) {
    // Hold an airborne dummy in place until the move actually connects.
    if (place.dy !== 0 && !connected) {
      victim.y = place.dy; victim.vy = 0; victim.prevY = place.dy; victim.grounded = false;
    }
    match.step();
    if (victim.damage > startPercent) connected = true;
    if (victim.hitstun > 0) launched = true;
    if (!victim.alive) {
      const y = victim.y - victim.def.height * 0.5;
      const b = match.stage.blastZones;
      if (y < b.top) return 'top';
      if (y > b.bottom) return 'bottom';
      return 'side';
    }
    // Only conclude once hitstun has begun and then ended on the ground —
    // breaking during hitlag would report every move as harmless.
    if (launched && victim.grounded && victim.hitstun <= 0 && victim.hitlag <= 0) break;
  }
  return null;
}

/** Lowest percent at which `moveId` KOs through the given blast zone. */
export function killPercent(match, attackerIndex, moveId, zone, opts = {}) {
  for (let p = 0; p <= KILL_SWEEP_MAX; p += KILL_SWEEP_STEP) {
    if (trial(match, attackerIndex, moveId, p, opts) === zone) return p;
  }
  return null;
}

/** Which spacings a move can actually reach. Catches un-hittable hitboxes. */
export function reachReport(match, attackerIndex, moveId) {
  const positions = [
    ['close', 52, 0], ['mid', 80, 0], ['far', 110, 0],
    ['above', 20, -95], ['below', 18, -40], ['behind', -60, 0],
  ];
  const attacker = match.fighters[attackerIndex];
  const victim = match.fighters[1 - attackerIndex];
  const hits = [];

  for (const [name, dx, dy] of positions) {
    resetWorld(match, attacker, victim);
    victim.spawnAt(dx, dy, -1);
    match.step();
    const move = attacker.moves[moveId];
    if (!move) return [];
    attacker.startAction(move, { noCharge: true });

    let hit = false;
    for (let i = 0; i < 90; i++) {
      if (dy !== 0) { victim.y = dy; victim.vy = 0; victim.grounded = false; victim.prevY = dy; }
      match.step();
      if (victim.damage > 0 || victim.hitlag > 0) { hit = true; break; }
    }
    if (hit) hits.push(name);
  }
  return hits;
}

const KILL_MOVES = ['fsmash', 'usmash', 'dsmash', 'fair', 'bair', 'uair', 'dair', 'neutralB', 'sideB'];
const ALL_MOVES = [
  'jab', 'ftilt', 'utilt', 'dtilt', 'dashAttack',
  'fsmash', 'usmash', 'dsmash',
  'nair', 'fair', 'bair', 'uair', 'dair',
  'neutralB', 'sideB', 'upB', 'downB',
];

const pct = (v) => (v === null ? '  —  ' : `${String(v).padStart(3)}% `);

/** Full report. Returns a printable string. */
export function report(match, section = 'all') {
  const lines = [];
  const names = match.fighters.map((f) => f.def.name);

  if (section === 'all' || section === 'kills') {
    lines.push('=== KILL PERCENTS (centre stage, no DI, fresh move) ===');
    lines.push('fighter  move        side    top     charged-side');
    for (let i = 0; i < match.fighters.length; i++) {
      for (const id of KILL_MOVES) {
        if (!match.fighters[i].moves[id]) continue;
        const side = killPercent(match, i, id, 'side');
        const top = killPercent(match, i, id, 'top');
        const charged = match.fighters[i].moves[id].charge
          ? killPercent(match, i, id, 'side', { charge: 60 })
          : null;
        lines.push(`${names[i].padEnd(8)} ${id.padEnd(11)} ${pct(side)} ${pct(top)} ${pct(charged)}`);
      }
    }
    lines.push('');
    lines.push('=== DI VALUE (survival DI vs none) ===');
    for (let i = 0; i < match.fighters.length; i++) {
      const none = killPercent(match, i, 'fsmash', 'side');
      const di = killPercent(match, i, 'fsmash', 'side', { di: { x: 0.05, y: -0.99 } });
      lines.push(`${names[i].padEnd(8)} fsmash: no DI ${pct(none)} -> DI up/away ${pct(di)}`);
    }
    lines.push('');
  }

  if (section === 'all' || section === 'reach') {
    lines.push('=== HITBOX REACH (spacings each move can connect at) ===');
    for (let i = 0; i < match.fighters.length; i++) {
      for (const id of ALL_MOVES) {
        if (!match.fighters[i].moves[id]) continue;
        const hits = reachReport(match, i, id);
        const flag = hits.length ? hits.join(',') : '*** CONNECTS NOWHERE ***';
        lines.push(`${names[i].padEnd(8)} ${id.padEnd(11)} ${flag}`);
      }
    }
  }

  return lines.join('\n');
}
