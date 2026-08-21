/**
 * Room registry: pairs two players by a six-digit code and relays between them.
 *
 * The server is a **dumb pipe**. It never simulates, never validates a game
 * state and never arbitrates — both clients run the same deterministic
 * simulation and only exchange raw inputs, so there is nothing here to cheat
 * against that is not equally visible on both machines. That keeps this file
 * small enough to reason about and means the relay costs a few bytes per frame
 * rather than a serialised world.
 *
 * The one thing it does decide is **seating**: the host is always player 1.
 * Somebody has to, and it cannot be negotiated after the fact without a tie
 * break that is more code than the rest of this module.
 */
const CODE_LENGTH = 6;
/** How long a room with nobody in it survives before being reclaimed. */
const EMPTY_ROOM_TTL_MS = 60_000;
/** Ceiling on concurrent rooms, so codes cannot be farmed indefinitely. */
const MAX_ROOMS = 500;

class Rooms {
  constructor() {
    /** @type {Map<string, {code:string, players:Array, createdAt:number, emptyAt:number|null}>} */
    this.rooms = new Map();
    this.sweeper = setInterval(() => this.sweep(), 15_000);
    // Never hold the process open just to expire empty rooms.
    if (this.sweeper.unref) this.sweeper.unref();
  }

  /**
   * A code a person has to read aloud or type from a screenshot, so it avoids
   * being merely random: rejecting codes already in use means no collisions,
   * and rejecting all-same-digit codes keeps `000000` out of circulation.
   */
  newCode() {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) code += Math.floor(Math.random() * 10);
      if (/^(\d)\1+$/.test(code)) continue;
      if (!this.rooms.has(code)) return code;
    }
    return null;
  }

  host(conn) {
    if (this.rooms.size >= MAX_ROOMS) return { error: 'server is full, try again shortly' };
    const code = this.newCode();
    if (!code) return { error: 'could not allocate a code, try again' };
    const room = { code, players: [conn], createdAt: Date.now(), emptyAt: null };
    this.rooms.set(code, room);
    conn.room = room;
    conn.seat = 0;
    return { code, seat: 0 };
  }

  join(conn, rawCode) {
    const code = String(rawCode || '').replace(/\D/g, '');
    if (code.length !== CODE_LENGTH) return { error: 'codes are six digits' };
    const room = this.rooms.get(code);
    if (!room) return { error: 'no match with that code' };
    if (room.players.length >= 2) return { error: 'that match is already full' };
    room.players.push(conn);
    room.emptyAt = null;
    conn.room = room;
    conn.seat = 1;
    return { code, seat: 1 };
  }

  /** Everyone in the room except `conn`. */
  peers(conn) {
    if (!conn.room) return [];
    return conn.room.players.filter((p) => p !== conn && p.open);
  }

  leave(conn) {
    const room = conn.room;
    if (!room) return;
    room.players = room.players.filter((p) => p !== conn);
    conn.room = null;
    // Tell whoever is left, so they surface a disconnect rather than a stall.
    for (const p of room.players) {
      if (p.open) p.send(JSON.stringify({ t: 'peerLeft' }));
    }
    if (room.players.length === 0) room.emptyAt = Date.now();
  }

  sweep() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      room.players = room.players.filter((p) => p.open);
      if (room.players.length === 0) {
        if (room.emptyAt === null) room.emptyAt = now;
        if (now - room.emptyAt > EMPTY_ROOM_TTL_MS) this.rooms.delete(code);
      } else {
        room.emptyAt = null;
      }
    }
  }
}

module.exports = { Rooms, CODE_LENGTH };
