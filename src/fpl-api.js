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

// =====================
// FPL LOGIN & MY-TEAM (live squad sebelum deadline)
// =====================

let fplSession = null;
let fplLoginError = null;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Referer': 'https://fantasy.premierleague.com/',
  'Origin': 'https://fantasy.premierleague.com',
};

async function fplLogin() {
  const email = process.env.FPL_EMAIL;
  const password = process.env.FPL_PASSWORD;
  if (!email || !password) {
    fplLoginError = 'FPL_EMAIL atau FPL_PASSWORD belum di-set';
    return null;
  }

  try {
    // Step 1: Login ke FPL
    const loginResp = await axios.post(
      'https://users.premierleague.com/accounts/login/',
      new URLSearchParams({
        login: email,
        password: password,
        redirect_uri: 'https://fantasy.premierleague.com/',
        app: 'plfpl-web',
      }).toString(),
      {
        headers: {
          ...BROWSER_HEADERS,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        maxRedirects: 0,
        validateStatus: () => true, // accept semua status code
        timeout: 15000,
      }
    );

    const status = loginResp.status;
    const cookies = loginResp.headers['set-cookie'];

    console.log(`FPL login response: status=${status}, has-cookies=${!!cookies}, location=${loginResp.headers.location || 'none'}`);

    // Login sukses biasanya 302 redirect dengan set-cookie
    if (cookies && cookies.length > 0) {
      const cookieStr = cookies.map(c => c.split(';')[0]).join('; ');

      // Cek apakah ada cookie session yang valid (bukan hanya tracking cookies)
      const hasSessionCookie = cookies.some(c =>
        c.includes('sessionid') || c.includes('pl_profile') || c.includes('csrftoken')
      );

      if (hasSessionCookie || status === 302) {
        fplSession = cookieStr;
        fplLoginError = null;
        console.log('✅ FPL login berhasil');
        return cookieStr;
      }
    }

    // Login gagal — coba extract alasan
    if (status === 200) {
      // Status 200 biasanya berarti login gagal (halaman login ditampilkan kembali)
      const body = typeof loginResp.data === 'string' ? loginResp.data : '';
      if (body.includes('Incorrect email or password')) {
        fplLoginError = 'Email atau password salah';
      } else if (body.includes('Please verify your email')) {
        fplLoginError = 'Akun belum verifikasi email';
      } else if (body.includes('Too many attempts')) {
        fplLoginError = 'Terlalu banyak percobaan login, coba lagi nanti';
      } else if (body.includes('recaptcha') || body.includes('captcha')) {
        fplLoginError = 'FPL membutuhkan CAPTCHA — tidak bisa login otomatis dari server';
      } else {
        fplLoginError = `Login gagal (status ${status}), kemungkinan CAPTCHA atau rate limit`;
      }
    } else if (status >= 400) {
      fplLoginError = `Login gagal dengan HTTP ${status}`;
    } else {
      fplLoginError = `Login response tanpa session cookie (status ${status})`;
    }

    console.error('❌ FPL login gagal:', fplLoginError);
    return null;
  } catch (err) {
    fplLoginError = err.message;
    console.error('❌ FPL login error:', err.message);
    return null;
  }
}

function getFplLoginError() {
  return fplLoginError;
}

async function fetchMyTeam(managerId) {
  if (!fplSession) {
    await fplLogin();
  }
  if (!fplSession) return null;

  const headers = { ...BROWSER_HEADERS, Cookie: fplSession };

  try {
    const { data } = await axios.get(`${BASE}/my-team/${managerId}/`, {
      headers,
      timeout: 15000,
    });
    return data;
  } catch (err) {
    // Session expired — coba login ulang sekali
    if (err.response?.status === 401 || err.response?.status === 403) {
      fplSession = null;
      await fplLogin();
      if (!fplSession) return null;
      try {
        const { data } = await axios.get(`${BASE}/my-team/${managerId}/`, {
          headers: { ...BROWSER_HEADERS, Cookie: fplSession },
          timeout: 15000,
        });
        return data;
      } catch { return null; }
    }
    return null;
  }
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
  fetchMyTeam, fplLogin, getFplLoginError,
};
