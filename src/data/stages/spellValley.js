import { GROUND, BLAST, PLATFORM_Y, SPAWNS, soft } from './common.js';

/**
 * SPELL VALLEY — Pokémon Stadium 2 layout, two platforms.
 *
 * Arena 6. The card is a violet crystal field: magenta shards pushing out of
 * grey rock, cracked flagstones, and a gold-rimmed pot of glowing cyan brew on
 * a stone plinth. The palette is the loudest of the five and the stage leans
 * into it — purple ground, cyan light, gold trim.
 *
 * Two symmetric platforms, set wider apart than Goblin Stadium's and with no
 * top platform. That leaves the centre of the stage open above head height,
 * which is what makes the layout feel airy rather than boxed in.
 */
export const spellValley = {
  id: 'spellValley',
  name: 'Spell Valley',
  thumbnail: 'assets/stages/Spell_Valley.webp',

  theme: {
    /**
     * The one stage that stays dark on purpose. Its light is the crystals and
     * the pot, so the key is dimmed and the rim turned up in cyan — the arena
     * should look lit from within rather than from above.
     */
    light: {
      sky: '#b98cf0', bounce: '#3a2a52', ambient: 1.0,
      key: '#e8d8ff', keyIntensity: 1.2, rim: '#49e0e8', rimIntensity: 0.9,
    },
    sky: '#42246e',
    skyLow: '#8a5fbe',
    // Everything here is violet, so the platforms are the one thing allowed to
    // be grey stone: a purple platform over a purple floor under a purple sky
    // was invisible, and platform edges are information a player needs.
    ground: '#3e3252',
    groundTop: '#6a5490',
    platform: '#6d6a7a',
    platformTop: '#c9c2d8',
    accent: '#49e0e8',

    props: [
      // Crystal clusters pushing up out of the plateau around the arena.
      { type: 'crystal', on: 'terrain', x: -820, y: -10, z: -790, count: 4, scale: 2.2, color: '#b34fd6' },
      { type: 'crystal', on: 'terrain', x: 840, y: -10, z: -810, count: 3, scale: 2.5, color: '#9b45c4' },
      { type: 'crystal', on: 'terrain', x: -400, y: -10, z: -980, count: 3, scale: 1.6, color: '#c96ae0' },
      { type: 'crystal', on: 'terrain', x: 440, y: -10, z: -1010, count: 4, scale: 1.7, color: '#a855c9' },
      { type: 'crystal', on: 'terrain', x: -110, y: -10, z: -1260, count: 5, scale: 2.0, color: '#8d3fb8' },
      // The brewing pot, the one warm light in the valley. Centred in the gap
      // between the two platforms rather than behind one of them: the layout is
      // symmetric, and so is the thing framing it.
      { type: 'cauldron', on: 'terrain', x: 0, y: -10, z: -880, scale: 2.8, stone: '#6d6a72', color: '#c9a227', glow: '#49e0e8' },
    ],
  },

  platforms: [
    { type: 'solid', ...GROUND },
    soft(-300, PLATFORM_Y.LOW, 280),
    soft(300, PLATFORM_Y.LOW, 280),
  ],

  blastZones: BLAST,
  spawns: SPAWNS,
  respawnX: 0,
};
