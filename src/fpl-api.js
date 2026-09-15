const axios = require('axios');

const BASE = 'https://fantasy.premierleague.com/api';

let cache = { bootstrap: null, fixtures: null, ts: 0 };
const CACHE_TTL = 3600_000; // 1 jam

async function fetchBootstrap() {
  const now = Date.now();
  if (cache.bootstrap && now - cache.ts < CACHE_TTL) return cache.bootstrap;

  const { data } = await axios.get(`${BASE}/bootstrap-static/`, { timeout: 15000 });
  cache.bootstrap = data;
  cache.ts = now;
  return data;
}

async function fetchFixtures() {
  const now = Date.now();
  if (cache.fixtures && now - cache.ts < CACHE_TTL) return cache.fixtures;

  const { data } = await axios.get(`${BASE}/fixtures/`, { timeout: 15000 });
  cache.fixtures = data;
  return data;
}

async function fetchPlayerHistory(playerId) {
  const { data } = await axios.get(`${BASE}/element-summary/${playerId}/`, { timeout: 15000 });
  return data;
}

// Manager info & squad
async function fetchManagerInfo(managerId) {
  const { data } = await axios.get(`${BASE}/entry/${managerId}/`, { timeout: 15000 });
  return data;
}

async function fetchManagerPicks(managerId, gw) {
  const { data } = await axios.get(`${BASE}/entry/${managerId}/event/${gw}/picks/`, { timeout: 15000 });
  return data;
}

async function fetchManagerTransfers(managerId) {
  const { data } = await axios.get(`${BASE}/entry/${managerId}/transfers/`, { timeout: 15000 });
  return data;
}

function clearCache() {
  cache = { bootstrap: null, fixtures: null, ts: 0 };
}

// Ambil semua data yang dibutuhkan
async function fetchAll() {
  const [bootstrap, fixtures] = await Promise.all([fetchBootstrap(), fetchFixtures()]);

  const teams = {};
  for (const t of bootstrap.teams) {
    teams[t.id] = t;
  }

  // Hitung jumlah laga tim (dari fixtures yang sudah selesai)
  const teamGames = {};
  for (const f of fixtures) {
    if (f.finished) {
      teamGames[f.team_h] = (teamGames[f.team_h] || 0) + 1;
      teamGames[f.team_a] = (teamGames[f.team_a] || 0) + 1;
    }
  }

  // Current gameweek
  const currentGw = bootstrap.events.find(e => e.is_current)?.id
    || bootstrap.events.find(e => e.is_next)?.id
    || 1;

  // Upcoming fixtures per tim (belum selesai, urut GW)
  const upcomingByTeam = {};
  for (const f of fixtures) {
    if (f.finished || !f.event) continue;
    for (const side of ['team_h', 'team_a']) {
      const tid = f[side];
      if (!upcomingByTeam[tid]) upcomingByTeam[tid] = [];
      const oppId = side === 'team_h' ? f.team_a : f.team_h;
      upcomingByTeam[tid].push({
        gw: f.event,
        opponent: oppId,
        opponent_name: teams[oppId]?.short_name || `Team${oppId}`,
        isHome: side === 'team_h',
        fdr: side === 'team_h' ? f.team_h_difficulty : f.team_a_difficulty,
      });
    }
  }
  for (const tid in upcomingByTeam) {
    upcomingByTeam[tid].sort((a, b) => a.gw - b.gw);
  }

  // Enrich players
  const players = bootstrap.elements.map(p => ({
    ...p,
    teamData: teams[p.team],
    teamGames: teamGames[p.team] || 0,
    nextFixtures: (upcomingByTeam[p.team] || []).slice(0, 6),
  }));

  return { players, teams, fixtures, currentGw, events: bootstrap.events };
}

module.exports = {
  fetchAll, fetchBootstrap, fetchFixtures, fetchPlayerHistory,
  fetchManagerInfo, fetchManagerPicks, fetchManagerTransfers, clearCache,
};
