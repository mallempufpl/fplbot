// Bobot scoring per posisi (element_type: 1=GK, 2=DEF, 3=MID, 4=FWD)
const POSITION_WEIGHTS = {
  1: { xgi: 0.05, form: 0.20, fixture: 0.20, minutes: 0.20, value: 0.10, def: 0.25 },
  2: { xgi: 0.15, form: 0.18, fixture: 0.20, minutes: 0.15, value: 0.12, def: 0.20 },
  3: { xgi: 0.32, form: 0.18, fixture: 0.18, minutes: 0.15, value: 0.15, def: 0.00 },
  4: { xgi: 0.38, form: 0.18, fixture: 0.16, minutes: 0.15, value: 0.13, def: 0.00 },
};

const POSITION_NAMES = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const POSITION_EMOJI = { 1: '🧤', 2: '🛡', 3: '🎯', 4: '⚽' };

// Differential config
const DIFFERENTIAL = {
  ownershipThreshold: 12,   // % max untuk label differential
  qualityPercentile: 0.40,  // min quality percentile
  blendBase: 0.6,           // base factor untuk differential score
  blendBonus: 0.4,          // bonus factor dari low ownership
};

// Fixture projection
const FIXTURE_LOOKAHEAD = 4;
const FIXTURE_WEIGHTS = [0.40, 0.30, 0.20, 0.10];

// Shrinkage threshold (menit)
const SHRINKAGE_MINUTES = 450;

// Minutes security gate
const MINUTES_SECURITY_GATE = 0.25;

module.exports = {
  POSITION_WEIGHTS,
  POSITION_NAMES,
  POSITION_EMOJI,
  DIFFERENTIAL,
  FIXTURE_LOOKAHEAD,
  FIXTURE_WEIGHTS,
  SHRINKAGE_MINUTES,
  MINUTES_SECURITY_GATE,
};
