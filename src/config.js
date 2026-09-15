const POSITION_NAMES = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
const POSITION_EMOJI = { 1: '🧤', 2: '🛡', 3: '🎯', 4: '⚽' };

// =====================
// DEFAULT WEIGHTS
// =====================
const DEFAULT_WEIGHTS = {
  1: { xgi: 0.05, form: 0.20, fixture: 0.20, minutes: 0.20, value: 0.10, def: 0.25 },
  2: { xgi: 0.15, form: 0.18, fixture: 0.20, minutes: 0.15, value: 0.12, def: 0.20 },
  3: { xgi: 0.32, form: 0.18, fixture: 0.18, minutes: 0.15, value: 0.15, def: 0.00 },
  4: { xgi: 0.38, form: 0.18, fixture: 0.16, minutes: 0.15, value: 0.13, def: 0.00 },
};

const ALL_METRICS = ['xgi', 'form', 'fixture', 'minutes', 'value', 'def'];

const METRIC_LABELS = {
  xgi: 'xGI/90 (Expected Goal Involvement)',
  form: 'Form (Rata-rata poin)',
  fixture: 'Fixture (Tingkat kesulitan lawan)',
  minutes: 'Minutes (Keamanan menit bermain)',
  value: 'Value (Form per harga)',
  def: 'Defense (xGC untuk GK/DEF)',
};

// =====================
// DYNAMIC CONFIG — baca dari env
// =====================

// Format env METRICS_ACTIVE: "xgi,form,fixture,minutes,value,def"
function getActiveMetrics() {
  const env = process.env.METRICS_ACTIVE;
  if (!env) return [...ALL_METRICS];
  return env.split(',').map(m => m.trim().toLowerCase()).filter(m => ALL_METRICS.includes(m));
}

// Format env METRICS_WEIGHTS: "xgi:5:15:32:38,form:20:18:18:18,..."
// Tiap metrik = nama:GK:DEF:MID:FWD (nilai dalam persen 0-100, akan di-convert ke 0-1)
function getPositionWeights() {
  const active = getActiveMetrics();
  const env = process.env.METRICS_WEIGHTS;

  // Start dengan default
  const weights = JSON.parse(JSON.stringify(DEFAULT_WEIGHTS));

  // Override dari env jika ada
  if (env) {
    const parts = env.split(',');
    for (const part of parts) {
      const [name, ...vals] = part.trim().split(':');
      const metric = name.trim().toLowerCase();
      if (!ALL_METRICS.includes(metric) || vals.length < 4) continue;
      const [gk, def, mid, fwd] = vals.map(v => parseInt(v) / 100);
      weights[1][metric] = gk;
      weights[2][metric] = def;
      weights[3][metric] = mid;
      weights[4][metric] = fwd;
    }
  }

  // Set bobot 0 untuk metrik yang dinonaktifkan
  for (const pos of [1, 2, 3, 4]) {
    for (const metric of ALL_METRICS) {
      if (!active.includes(metric)) {
        weights[pos][metric] = 0;
      }
    }
    // Re-normalize agar total = 1
    const total = ALL_METRICS.reduce((sum, m) => sum + weights[pos][m], 0);
    if (total > 0 && Math.abs(total - 1) > 0.01) {
      for (const m of ALL_METRICS) {
        weights[pos][m] = weights[pos][m] / total;
      }
    }
  }

  return weights;
}

// Differential config
const DIFFERENTIAL = {
  ownershipThreshold: 12,
  qualityPercentile: 0.40,
  blendBase: 0.6,
  blendBonus: 0.4,
};

// Fixture projection
const FIXTURE_LOOKAHEAD = 4;
const FIXTURE_WEIGHTS = [0.40, 0.30, 0.20, 0.10];

// Shrinkage threshold (menit)
const SHRINKAGE_MINUTES = 450;

// Minutes security gate
const MINUTES_SECURITY_GATE = 0.25;

module.exports = {
  POSITION_WEIGHTS: DEFAULT_WEIGHTS, // backward compat
  getPositionWeights,
  getActiveMetrics,
  ALL_METRICS,
  METRIC_LABELS,
  DEFAULT_WEIGHTS,
  POSITION_NAMES,
  POSITION_EMOJI,
  DIFFERENTIAL,
  FIXTURE_LOOKAHEAD,
  FIXTURE_WEIGHTS,
  SHRINKAGE_MINUTES,
  MINUTES_SECURITY_GATE,
};
