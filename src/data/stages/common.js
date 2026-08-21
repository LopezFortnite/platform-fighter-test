/**
 * Shared stage metrics.
 *
 * Every battle stage uses the same main platform and the same blast zones, so
 * they differ **only** in their floating platforms. That is deliberate: kill
 * percents, recovery distance and edgeguard reward were all tuned against these
 * numbers, and letting each stage pick its own would mean a fighter that reads
 * completely differently depending on where the match happens to be.
 *
 * Platform heights are the other fixed quantity, because they are tied to jump
 * height rather than to art:
 *
 *   LOW  — inside a full hop (~172px peak) with room to act on landing
 *   HIGH — out of reach of a full hop, so it costs a double jump
 *
 * Measured, not guessed: a full hop peaks at 172px and a full hop plus air jump
 * at 306px. Moving these means re-checking both.
 */
/**
 * The main platform is a **plate**, not a column.
 *
 * `h` is the depth of the solid body hanging under the standable surface, and it
 * is the whole reason a stage plays like a Smash stage rather than a box. At 700
 * the body reached almost to the bottom blast zone, so the space under the stage
 * did not exist: an offstage fighter could only ever come back to the ledge it
 * fell from. At 170 the body is a keel and everything below it is open air, so
 * dropping off one ledge and crossing underneath to the other is a real option —
 * and a real risk, because the bottom blast zone is down there.
 *
 * The exact depth was measured, not chosen for looks. A fighter is 92 tall, so
 * the corridor its feet can occupy runs from `h + 92` down to the blast zone at
 * 540. Flying the full 1012 across takes drift, one air jump and a couple of
 * side specials, and how far that gets you depends entirely on how long you can
 * stay airborne:
 *
 *   h = 170 → 278 of corridor → crosses 852 of 1012, and dies short
 *   h = 130 → 318 of corridor → clears the far ledge
 *   h = 120 → 328 of corridor → clears it with a little margin
 *
 * So 170 looked right and was not: it left the space under the stage as a
 * dead end you could enter but never leave. 120 is the shallowest the keel can
 * be drawn and still read as an island, and the deepest that leaves the
 * crossing open.
 *
 * Thin plates can be tunnelled through if anything moves further than the plate
 * is deep in a single frame. Nothing does: the hardest launch measured is 94px
 * per frame at 400%, against the 120 + 92 = 212 a fighter would have to cover to
 * skip the plate entirely.
 */
export const GROUND = { x: -506, y: 0, w: 1012, h: 120 };

/**
 * Blast zones.
 *
 * The sides and the floor were widened by 30% (1076 -> 1399, 540 -> 702), which
 * on a stage spanning +/-506 takes the horizontal margin beyond the ledge from
 * 570 out to 893. The ceiling is deliberately left where it was: raising it
 * with the rest would have made vertical kills disproportionately harder than
 * horizontal ones, and the up-and-out moves are where most of the roster's
 * finishers live.
 */
export const BLAST = { left: -1399, right: 1399, top: -900, bottom: 702 };

export const PLATFORM_Y = { LOW: -150, HIGH: -290 };

/** Standard spawn pairs for a stage with no platform to start on. */
export const SPAWNS = [
  { x: -242, y: 0, facing: 1 },
  { x: 242, y: 0, facing: -1 },
  { x: -92, y: 0, facing: 1 },
  { x: 92, y: 0, facing: -1 },
];

/** A soft platform centred on `cx` at height `y`. */
export function soft(cx, y, w) {
  return { type: 'soft', x: cx - w / 2, y, w, h: 16 };
}
