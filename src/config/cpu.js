/**
 * CPU difficulty profiles.
 *
 * Every field is a knob on the *same* AI — no difficulty gets extra abilities
 * or privileged information. Higher levels react sooner, choose better moves,
 * commit to combos, edgeguard, survive with DI and tech, and space more
 * precisely. Lower levels are not "handicapped", they are simply slower to
 * read the situation and looser about what they throw out.
 *
 * The CPU drives a normal PlayerInput, so it is bound by the same buffers,
 * frame data and cooldowns a human is.
 */
export const CPU_LEVELS = {
  easy: {
    label: 'EASY',
    /** Frames of lag before it perceives the opponent's current state. */
    reaction: 24,
    /** Frames between decisions — how twitchy it is. */
    decide: 12,
    /**
     * How often it chooses to close distance rather than mill about.
     * Kept high enough that Easy still fights — it should be beatable, not
     * passive, which is a much worse opponent to practise against.
     */
    aggression: 0.52,
    /** Chance to shield/dodge a threatening move. */
    defense: 0.08,
    /** Chance to chase a landed hit into a follow-up. */
    combo: 0.05,
    /** Chance to contest an opponent who is offstage. */
    edgeguard: 0.05,
    /** How reliably it switches to kill moves at high percent. */
    killAware: 0.0,
    /** Chance to spend Elixir on a special when one fits. */
    useSpecials: 0.12,
    /** Survival DI quality, 0..1. */
    di: 0,
    /** Chance to tech a knockdown. */
    tech: 0.05,
    /** Random spacing error in pixels — bigger means sloppier positioning. */
    spacing: 70,
    /** Chance to use aerials / short-hop approaches rather than only grounded. */
    aerial: 0.10,
    /** Chance to dash-dance or retreat rather than walk straight in. */
    footsies: 0.0,
    /** Chance to short hop out of a landed hit to juggle. */
    juggle: 0.0,
    killPercent: 999,
  },

  normal: {
    label: 'NORMAL',
    reaction: 18,
    decide: 10,
    aggression: 0.55,
    defense: 0.22,
    combo: 0.28,
    edgeguard: 0.18,
    killAware: 0.40,
    useSpecials: 0.30,
    di: 0.35,
    tech: 0.30,
    spacing: 42,
    aerial: 0.35,
    footsies: 0.12,
    juggle: 0.20,
    killPercent: 100,
  },

  hard: {
    label: 'HARD',
    reaction: 11,
    decide: 6,
    aggression: 0.82,
    // Deliberately below Expert's: shielding and retreating too often
    // suppresses its own offence and it stops converting openings.
    defense: 0.38,
    combo: 0.62,
    edgeguard: 0.50,
    killAware: 0.80,
    useSpecials: 0.55,
    di: 0.82,
    tech: 0.70,
    spacing: 22,
    aerial: 0.65,
    footsies: 0.22,
    juggle: 0.55,
    killPercent: 90,
  },

  expert: {
    label: 'EXPERT',
    reaction: 4,
    decide: 3,
    aggression: 0.92,
    // Still the most defensive tier, but not so much that it stops attacking.
    defense: 0.48,
    combo: 0.90,
    edgeguard: 0.80,
    killAware: 1.0,
    useSpecials: 0.80,
    di: 1.0,
    tech: 0.90,
    spacing: 10,
    aerial: 0.90,
    footsies: 0.38,
    juggle: 0.85,
    killPercent: 80,
  },
};

export const CPU_ORDER = ['easy', 'normal', 'hard', 'expert'];
