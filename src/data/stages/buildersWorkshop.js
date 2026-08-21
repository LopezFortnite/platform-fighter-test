import { GROUND, BLAST, PLATFORM_Y, SPAWNS, soft } from './common.js';

/**
 * BUILDER'S WORKSHOP — Town and City layout: one central platform, plus a high
 * one on each side that a full hop cannot reach.
 *
 * Arena 7 (Builder's Workshop). The card is a yard of grey flagstone and steel
 * with timber scaffolding, a jib crane, a circular saw blade and one stubborn
 * green tree. The coolest palette of the five, which is what sets it apart from
 * the two grass stages.
 *
 * The layout is the interesting one. The centre platform sits at the usual
 * `LOW` height and the outer pair at `HIGH`, which is above a full hop's 172px
 * peak — reaching them costs a double jump, so a fighter who goes up there has
 * spent their air movement and can be punished for it. That is the whole
 * tension of Town and City's tiered platforms, and it is why `HIGH` is defined
 * against measured jump heights rather than picked to look right.
 */
export const buildersWorkshop = {
  id: 'buildersWorkshop',
  name: "Builder's Workshop",
  thumbnail: "assets/stages/Builder's_Workshop.webp",

  theme: {
    /** Overcast working day: flat, cool, no strong sun. */
    light: {
      sky: '#d4e6f2', bounce: '#4a505a', ambient: 1.2,
      key: '#fff4e4', keyIntensity: 1.25, rim: '#9fc0e0', rimIntensity: 0.5,
    },
    sky: '#5c7f9c',
    skyLow: '#aec4d2',
    ground: '#5a6470',
    groundTop: '#8e9aa8',
    platform: '#8a6a3c',
    platformTop: '#b08b52',
    accent: '#c98a2e',

    props: [
      // Scaffold cranes at either end, jibs pointing inward. Steel, not timber:
      // in wood they were the same colour and height as the high platforms and
      // the eye could not tell scenery from a surface you can stand on.
      { type: 'crane', on: 'terrain', x: -700, y: -10, z: -900, h: 520, scale: 1.7, color: '#78818e', load: '#c98a2e' },
      { type: 'crane', on: 'terrain', x: 700, y: -10, z: -900, h: 470, scale: 1.7, rotY: Math.PI, color: '#6e7783', load: '#c98a2e' },
      // Saw blades stood up on the yard floor.
      { type: 'sawblade', on: 'terrain', x: -350, y: -10, z: -820, scale: 2.2, color: '#9aa2ad' },
      { type: 'sawblade', on: 'terrain', x: 440, y: -10, z: -850, scale: 1.8, color: '#8b939e' },
      // Stacked timber, pushed out to the flanks and darkened. Centred it sat
      // directly behind the middle platform in the same wood tone, and a
      // horizontal brown rail behind a horizontal brown platform is unreadable.
      { type: 'fence', on: 'terrain', x: -560, y: -10, z: -790, count: 4, scale: 1.7, color: '#6b5230' },
      { type: 'fence', on: 'terrain', x: 580, y: -10, z: -790, count: 3, scale: 1.7, color: '#5f4a2c' },
      // The one tree in the yard.
      { type: 'tree', on: 'terrain', x: 960, y: -10, z: -1000, color: '#4f8f3a', scale: 2.2 },
    ],
  },

  platforms: [
    { type: 'solid', ...GROUND },
    soft(0, PLATFORM_Y.LOW, 300),
    // Inset from the ledges rather than flush with them: hanging off the edge
    // under an overhanging platform makes recovery and edgeguarding fiddly, and
    // Town and City's outer platforms sit inboard for the same reason.
    soft(-335, PLATFORM_Y.HIGH, 230),
    soft(335, PLATFORM_Y.HIGH, 230),
  ],

  blastZones: BLAST,
  spawns: SPAWNS,
  respawnX: 0,
};
