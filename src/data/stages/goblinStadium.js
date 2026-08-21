import { GROUND, BLAST, PLATFORM_Y, SPAWNS, soft } from './common.js';

/**
 * GOBLIN STADIUM — Battlefield layout, three platforms.
 *
 * Arena 1. The card art is a grass pitch ringed by a spiked wooden palisade,
 * with a turquoise moat running round it, a rickety timber watchtower and a red
 * pennant. Palette and props are taken from that: grass green underfoot, warm
 * scaffolding brown, and the moat as a band of bright turquoise behind the
 * stage so the green reads against something.
 *
 * The three-platform variant is the one a first prototype most needs, because
 * it exercises platform movement, juggling and ledge play at once.
 */
export const goblinStadium = {
  id: 'goblinStadium',
  name: 'Goblin Stadium',
  thumbnail: 'assets/stages/Goblin_Stadium.webp',

  theme: {
    /** Clear midday over the goblin camp — the brightest of the battle stages. */
    light: {
      sky: '#cfe8ff', bounce: '#4a6b3a', ambient: 1.05,
      key: '#fff6e0', keyIntensity: 1.6, rim: '#8fc6ff', rimIntensity: 0.4,
    },
    sky: '#3d84c6',
    skyLow: '#9ed3e8',
    ground: '#4a7a3f',
    groundTop: '#79b45c',
    platform: '#7a5a33',
    platformTop: '#a8814a',
    accent: '#c0392b',

    props: [
      // The moat, right at the plateau lip — the turquoise ring from the card.
      { type: 'water', on: 'terrain', x: 0, y: 4, z: -760, w: 3000, d: 300, color: '#2f9fb0' },
      // Palisade along the far bank, the spiked wall the arena sits inside.
      { type: 'palisade', on: 'terrain', x: -760, y: -10, z: -940, count: 7, scale: 1.7 },
      { type: 'palisade', on: 'terrain', x: -300, y: -10, z: -940, count: 6, scale: 1.7 },
      { type: 'palisade', on: 'terrain', x: 300, y: -10, z: -940, count: 6, scale: 1.7 },
      { type: 'palisade', on: 'terrain', x: 760, y: -10, z: -940, count: 7, scale: 1.7 },
      // Timber watchtower with the red pennant.
      { type: 'crane', on: 'terrain', x: -60, y: -10, z: -1180, h: 620, color: '#54402a', load: '#6b5230', scale: 1.5 },
      { type: 'banner', on: 'terrain', x: 420, y: -10, z: -1140, h: 200, mast: 560, color: '#c0392b', pole: '#6b4a2a', scale: 1.3 },
      // Jungle either side.
      { type: 'tree', on: 'terrain', x: -960, y: -10, z: -1080, color: '#3f7a34', scale: 2.4 },
      { type: 'tree', on: 'terrain', x: 1000, y: -10, z: -1140, color: '#488a3c', scale: 2.1 },
    ],
  },

  platforms: [
    { type: 'solid', ...GROUND },
    soft(-254, PLATFORM_Y.LOW, 265),
    soft(254, PLATFORM_Y.LOW, 265),
    soft(0, -280, 230),
  ],

  blastZones: BLAST,
  spawns: [
    { x: -242, y: 0, facing: 1 },
    { x: 242, y: 0, facing: -1 },
    { x: -92, y: PLATFORM_Y.LOW, facing: 1 },
    { x: 92, y: PLATFORM_Y.LOW, facing: -1 },
  ],
  respawnX: 0,
};
