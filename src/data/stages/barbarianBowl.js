import { GROUND, BLAST, PLATFORM_Y, SPAWNS, soft } from './common.js';

/**
 * BARBARIAN BOWL — Smashville layout, one long central platform.
 *
 * Arena 3. The card is a grass field with a colossal timber barrel behind it,
 * blue and red barbarian banners with crossed swords, and a stream cutting
 * through the middle.
 *
 * One wide platform overhead is the whole design. It gives just enough
 * structure to juggle under and to land on, without the corridors a
 * three-platform stage creates — which is what makes Smashville's layout the
 * most neutral of the platform stages.
 *
 * The platform is static. Smashville's drifts, and moving geometry is a
 * simulation feature rather than a stage one — the collision resolver assumes
 * platforms hold still — so that is a change to make deliberately, not to
 * smuggle in with a stage.
 */
export const barbarianBowl = {
  id: 'barbarianBowl',
  name: 'Barbarian Bowl',
  thumbnail: 'assets/stages/Barbarian_Bowl.webp',

  theme: {
    /** Open highland daylight — cooler and a touch flatter than the stadium. */
    light: {
      sky: '#c8e4f5', bounce: '#4c6b3c', ambient: 1.1,
      key: '#fff4dc', keyIntensity: 1.5, rim: '#96c2e8', rimIntensity: 0.45,
    },
    sky: '#4a93cc',
    skyLow: '#a9dcee',
    ground: '#4c7d3c',
    groundTop: '#7cb857',
    platform: '#7d5527',
    platformTop: '#c08f45',
    accent: '#c9a227',

    props: [
      // The stream, running along the plateau lip.
      { type: 'water', on: 'terrain', x: 0, y: 4, z: -760, w: 3000, d: 280, color: '#3aa9bd' },
      // The barrel. Centred like the card, but darkened so its silhouette does
      // not merge into the central platform's wood in front of it.
      { type: 'barrel', on: 'terrain', x: 0, y: -10, z: -1200, scale: 3.2, color: '#54381d', band: '#332f29' },
      // Crossed-sword banners either side of it.
      { type: 'banner', on: 'terrain', x: -400, y: -10, z: -1060, h: 200, mast: 560, color: '#2f6fd0', pole: '#5a4630', emblem: '#d8d2c4', scale: 1.3 },
      { type: 'banner', on: 'terrain', x: 400, y: -10, z: -1060, h: 200, mast: 560, color: '#c0392b', pole: '#5a4630', emblem: '#d8d2c4', scale: 1.3 },
      // Field fencing along the far bank.
      { type: 'fence', on: 'terrain', x: -760, y: -10, z: -940, count: 6, scale: 1.7 },
      { type: 'fence', on: 'terrain', x: 760, y: -10, z: -940, count: 6, scale: 1.7 },
      { type: 'tree', on: 'terrain', x: -980, y: -10, z: -1120, color: '#3f7a34', scale: 2.3 },
      { type: 'tree', on: 'terrain', x: 1000, y: -10, z: -1080, color: '#4a8a3c', scale: 2.0 },
    ],
  },

  platforms: [
    { type: 'solid', ...GROUND },
    soft(0, PLATFORM_Y.LOW, 420),
  ],

  blastZones: BLAST,
  spawns: SPAWNS,
  respawnX: 0,
};
