import { GROUND, BLAST, SPAWNS } from './common.js';

/**
 * BONE PIT — Final Destination layout, no platforms.
 *
 * Arena 2. The card is a sand pit walled in dark stone, with two enormous
 * ivory tusks arching over it, skulls set along the rim and a blue and a red
 * banner facing each other across the sand.
 *
 * A flat stage is the honest home for it: nothing to break up the pit floor, so
 * every exchange is neutral, spacing and edgeguards. It is also the stage that
 * tells you the most about two fighters, which is why it is worth having with
 * only two on the roster.
 */
export const bonePit = {
  id: 'bonePit',
  name: 'Bone Pit',
  thumbnail: 'assets/stages/Bone_Pit.webp',

  theme: {
    /** Low sun over the desert pit: warm key, dusty bounce off the sand. */
    light: {
      sky: '#f0d8b0', bounce: '#6b5236', ambient: 1.0,
      key: '#ffe3b4', keyIntensity: 1.7, rim: '#c8916a', rimIntensity: 0.45,
    },
    // Deep burnt orange rather than another tan: the pit floor is already sand,
    // and a sky at the same value erased the horizon entirely.
    // Desert dusk: a cool violet zenith burning down to terracotta. A warm sky
    // over warm sand made one flat brown wash with no horizon in it.
    sky: '#3f2f4a',
    skyLow: '#b06a44',
    ground: '#8a6f42',
    groundTop: '#e3c489',
    platform: '#584a3e',
    platformTop: '#8a7a66',
    accent: '#e8e2d0',

    props: [
      // The tusks, arching in from either side. They are the stage's silhouette,
      // so they are built big — at the scale the other props use they shrank to
      // pale specks on the rim and the pit read as a plain sand box.
      { type: 'tusk', on: 'terrain', x: -640, y: -10, z: -820, scale: 4.0 },
      { type: 'tusk', on: 'terrain', x: 640, y: -10, z: -820, scale: 4.0, flip: true },
      { type: 'tusk', on: 'terrain', x: -400, y: -10, z: -1140, scale: 2.8 },
      { type: 'tusk', on: 'terrain', x: 400, y: -10, z: -1140, scale: 2.8, flip: true },
      // Skulls along the rim of the pit.
      { type: 'skull', on: 'terrain', x: -900, y: -10, z: -790, scale: 2.4 },
      { type: 'skull', on: 'terrain', x: 900, y: -10, z: -790, scale: 2.4 },
      { type: 'skull', on: 'terrain', x: 0, y: -10, z: -900, scale: 2.8 },
      // The two banners, blue against red.
      { type: 'banner', on: 'terrain', x: -250, y: -10, z: -1080, h: 210, mast: 540, color: '#2f6fd0', pole: '#4a4038', scale: 1.3 },
      { type: 'banner', on: 'terrain', x: 250, y: -10, z: -1080, h: 210, mast: 540, color: '#c0392b', pole: '#4a4038', scale: 1.3 },
    ],
  },

  platforms: [
    { type: 'solid', ...GROUND },
  ],

  blastZones: BLAST,
  spawns: SPAWNS,
  respawnX: 0,
};
