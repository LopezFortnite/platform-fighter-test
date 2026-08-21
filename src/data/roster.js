import { bandit } from './fighters/bandit.js';
import { wizard } from './fighters/wizard.js';
import { goblin } from './fighters/goblin.js';
import { barbarian } from './fighters/barbarian.js';
import { megaknight } from './fighters/megaknight.js';

/**
 * The full Clash Rumble cast.
 *
 * "Clash Rumble would feature 61 playable fighters (64 if you separate the tag
 * teams)" — the design document lists them grouped by archetype, and that
 * grouping is preserved here so the character select reads as one row per
 * archetype.
 *
 * Only the fighters that actually have a data file are playable; the rest are
 * locked slots on the select screen, named so the intended roster is legible.
 */

/** Fighters that are implemented, keyed by their normalised roster name. */
const IMPLEMENTED = {
  goblin,
  bandit,
  wizard,
  barbarian,
  megaknight,
};

const key = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function slot(name) {
  return { name, id: key(name), def: IMPLEMENTED[key(name)] || null, archetype: null };
}

/**
 * The cast grouped by archetype, in the document's own order. The character
 * select flattens this into one grid, but the grouping is kept because it is
 * how the document defines the roster and it tags each fighter's archetype.
 */
export const ROSTER_ROWS = [
  {
    archetype: 'Brawlers',
    blurb: 'Limited range, hand-to-hand, combo-oriented.',
    slots: [
      'Goblin', 'Goblin Brawler', 'Berserker', 'Ice Golem', 'Elixir Golem',
      'Mini P.E.K.K.A.', 'Miner', 'Bandit', 'Fisherman', 'Lumberjack',
      'Boss Bandit', 'Monk', 'Electro Wizard',
    ].map(slot),
  },
  {
    archetype: 'Zoners',
    blurb: 'Built around a projectile; struggle up close.',
    slots: [
      'Archer', 'Firecracker', 'Musketeer', 'Furnace', 'Goblin Demolisher',
      'Wizard', 'Hunter', 'Witch', 'Executioner', 'Princess',
      'Ice Wizard', 'Magic Archer', 'Archer Queen',
    ].map(slot),
  },
  {
    archetype: 'Swordies',
    blurb: 'Melee weapon range; excel in neutral.',
    slots: [
      'Larry', 'Knight', 'Barbarian', 'Royal Recruit', 'Valkyrie',
      'Battle Healer', 'Royal Ghost', 'Night Witch', 'Ronin', 'Golden Knight',
    ].map(slot),
  },
  {
    archetype: 'Heavies',
    blurb: 'Bigger, heavier, slower, hardest hitting.',
    slots: [
      'Giant', 'P.E.K.K.A.', 'Rune Giant', 'Bowler', 'Giant Skeleton',
      'Goblin Giant', 'Electro Giant', 'Golem', 'Mega Knight',
      'Goblin Machine', 'Skeleton King', 'Mighty Miner',
    ].map(slot),
  },
  {
    archetype: 'Floaties',
    blurb: 'Live in the air: multiple jumps, some glide.',
    slots: [
      'Minion', 'Mega Minion', 'Baby Dragon', 'Electro Dragon', 'Lava Hound',
    ].map(slot),
  },
  {
    archetype: 'Riders',
    blurb: 'Different move sets mounted and dismounted.',
    slots: [
      'Hog Rider', 'Prince', 'Dark Prince', 'Ram Rider', 'Spirit Empress',
    ].map(slot),
  },
  {
    archetype: 'Tag Teams',
    blurb: 'Swap between a light fighter and a heavy one.',
    slots: [
      'Rascals', 'Little Prince', 'Goblinstein',
    ].map(slot),
  },
];

// Tag every slot with its archetype, then flatten. The select screen shows one
// continuous grid; the archetype rides along on each fighter for the info bar.
// The group name is kept as the document writes it — naive singularisation
// turns "Heavies" into "Heavie".
for (const row of ROSTER_ROWS) {
  for (const s of row.slots) s.archetype = row.archetype;
}

/** All 61 fighters in document order, as one flat list for the roster grid. */
export const ROSTER_FLAT = ROSTER_ROWS.flatMap((r) => r.slots);

export const TOTAL_SLOTS = ROSTER_FLAT.length;
export const PLAYABLE_SLOTS = ROSTER_FLAT.filter((s) => s.def !== null);

/** Index of a fighter in the flat grid, used to place the default cursor. */
export function findSlot(id) {
  const i = ROSTER_FLAT.findIndex((s) => s.id === id);
  return i >= 0 ? i : 0;
}
