import { goblinStadium } from './goblinStadium.js';
import { bonePit } from './bonePit.js';
import { barbarianBowl } from './barbarianBowl.js';
import { spellValley } from './spellValley.js';
import { buildersWorkshop } from './buildersWorkshop.js';
import { trainingCamp } from './trainingCamp.js';

/**
 * The stage roster, in the order the select screen shows them — Clash arena
 * order, which is also roughly simplest layout to most complex.
 *
 * Training Camp is not in this list: it is not something you pick, it is where
 * training mode happens.
 */
export const STAGES = [
  goblinStadium,
  bonePit,
  barbarianBowl,
  spellValley,
  buildersWorkshop,
];

export { goblinStadium, bonePit, barbarianBowl, spellValley, buildersWorkshop, trainingCamp };

export function stageById(id) {
  return STAGES.find((s) => s.id === id) || STAGES[0];
}
