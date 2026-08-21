import { GROUND, BLAST, SPAWNS } from './common.js';

/**
 * TRAINING CAMP — the training mode stage.
 *
 * The tutorial arena from Clash Royale: a bright grass yard with split-rail
 * fencing, a stream running through it, small trees and a red-and-white archery
 * butt. Sunnier and plainer than any of the battle stages, which is the point —
 * it should read instantly as "not a match".
 *
 * Deliberately flat, with no soft platforms, so launch trajectories and
 * recoveries can be read without platforms interfering. Its main platform and
 * blast zones are the shared ones, so anything measured here transfers straight
 * to a real match; the distance markers along the floor make that measurement
 * possible by eye.
 */
export const trainingCamp = {
  id: 'trainingCamp',
  name: 'Training Camp',
  thumbnail: 'assets/stages/Training_Camp.webp',

  theme: {
    /** The brightest and flattest light in the game — a practice yard at noon,
     * where reading the fighters matters more than atmosphere. */
    light: {
      sky: '#dcf0ff', bounce: '#587a44', ambient: 1.3,
      key: '#fffaea', keyIntensity: 1.55, rim: '#a8cff0', rimIntensity: 0.4,
    },
    sky: '#57a8dd',
    skyLow: '#bde6f2',
    ground: '#5d8f42',
    groundTop: '#8fc95f',
    platform: '#7a5a33',
    platformTop: '#a8814a',
    accent: '#d9b45a',
    /** Distance markers every N units, so a launch can be read off the floor. */
    markers: 100,

    props: [
      // The stream, running behind the yard.
      // The stream, along the plateau lip.
      { type: 'water', on: 'terrain', x: -160, y: 4, z: -760, w: 1600, d: 260, color: '#5fc8d8' },
      // Split-rail fencing round the field.
      { type: 'fence', on: 'terrain', x: -800, y: -10, z: -930, count: 6, scale: 1.7 },
      { type: 'fence', on: 'terrain', x: -350, y: -10, z: -930, count: 5, scale: 1.7 },
      { type: 'fence', on: 'terrain', x: 720, y: -10, z: -930, count: 6, scale: 1.7 },
      // The archery butts — the thing that makes it read as a training ground.
      { type: 'target', on: 'terrain', x: 320, y: -10, z: -890, scale: 2.4 },
      { type: 'target', on: 'terrain', x: 540, y: -10, z: -1080, scale: 1.8 },
      { type: 'tree', on: 'terrain', x: -960, y: -10, z: -1060, color: '#4f9a3a', scale: 2.2 },
      { type: 'tree', on: 'terrain', x: 980, y: -10, z: -1140, color: '#58a542', scale: 1.9 },
    ],
  },

  platforms: [
    { type: 'solid', ...GROUND },
  ],

  blastZones: BLAST,
  spawns: SPAWNS,
  respawnX: 0,
};
