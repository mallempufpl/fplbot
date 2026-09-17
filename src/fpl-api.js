const axios = require('axios');
const crypto = require('crypto');

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
let fplLoginDebug = null; // stores last login attempt debug info
let fplRefreshToken = null;

// =====================
// FPL LOGIN via PingOne DaVinci SSO
// FPL migrated from users.premierleague.com to PingOne SSO (account.premierleague.com)
// Flow: authorize → DaVinci policy start → bot protection → login form → auth code → token → cookies
// =====================

const PINGONE_ENV_ID = '68340de1-dfb9-412e-937c-20172986d129';
const PINGONE_CLIENT_ID = '1f243d70-a140-4035-8c41-341f5af5aa12';
const PINGONE_AUTH_ROOT = 'https://auth.pingone.eu';

function extractSkProps(html) {
  const start = html.indexOf('var skProps = ') + 14;
  if (start < 14) return null;
  const fromStart = html.substring(start);
  let depth = 0, end = 0;
  for (let i = 0; i < fromStart.length; i++) {
    if (fromStart[i] === '{') depth++;
    if (fromStart[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  try { return JSON.parse(fromStart.substring(0, end)); } catch { return null; }
}

async function fplLogin() {
  const email = process.env.FPL_EMAIL;
  const password = process.env.FPL_PASSWORD;
  if (!email || !password) {
    fplLoginError = 'FPL_EMAIL atau FPL_PASSWORD belum di-set';
    fplLoginDebug = null;
    return null;
  }

  fplLoginDebug = { steps: [] };

  try {
    // Step 1: Start OAuth authorize — get DaVinci flow config
    const authResp = await axios.get(
      `${PINGONE_AUTH_ROOT}/${PINGONE_ENV_ID}/as/authorize`,
      {
        params: {
          client_id: PINGONE_CLIENT_ID,
          response_type: 'code',
          redirect_uri: 'https://www.premierleague.com/',
          scope: 'openid',
        },
        validateStatus: () => true,
        timeout: 15000,
      }
    );

    const skProps = extractSkProps(authResp.data);
    fplLoginDebug.steps.push({ step: 1, name: 'authorize', status: authResp.status, hasSkProps: !!skProps });
    if (!skProps?.accessToken || !skProps?.policyId) {
      fplLoginError = 'Gagal mendapatkan DaVinci flow config dari FPL';
      console.error('❌ FPL login: skProps not found in authorize response');
      return null;
    }

    const hdr = { 'Authorization': 'Bearer ' + skProps.accessToken, 'Content-Type': 'application/json' };
    const base = `${skProps.apiRoot}/${skProps.companyId}`;

    // Step 2: Start DaVinci flow
    const flowResp = await axios.post(
      `${base}/davinci/policy/${skProps.policyId}/start`,
      {},
      { headers: hdr, validateStatus: () => true, timeout: 15000 }
    );
    const interactionId = flowResp.data.interactionId;
    fplLoginDebug.steps.push({ step: 2, name: 'flow-start', status: flowResp.status, hasInteraction: !!interactionId });
    if (!interactionId) {
      fplLoginError = 'Gagal memulai DaVinci login flow';
      return null;
    }

    // Step 3: Submit bot protection (protectsdk) — flat parameters
    console.log('DaVinci step3: submitting bot protection (flat)');
    const botResp = await axios.post(
      `${base}/davinci/connections/${flowResp.data.connectionId}/capabilities/${flowResp.data.capabilityName}`,
      {
        id: flowResp.data.id,
        eventName: 'continue',
        parameters: { protectsdk: '' },
      },
      { headers: { ...hdr, interactionid: interactionId }, validateStatus: () => true, timeout: 15000 }
    );

    console.log(`DaVinci step3 response: status=${botResp.status}, screen=${botResp.data.screen?.name}, connId=${botResp.data.connectionId}`);
    fplLoginDebug.steps.push({
      step: 3, name: 'bot-protection', status: botResp.status,
      screenName: botResp.data.screen?.name || null,
      hasConnectionId: !!botResp.data.connectionId,
    });

    // Step 4: Submit login credentials to the login form screen
    const loginConnId = botResp.data.connectionId || flowResp.data.connectionId;
    const loginCapName = botResp.data.capabilityName || flowResp.data.capabilityName;
    const loginId = botResp.data.id || flowResp.data.id;

    console.log(`DaVinci step4: submitting credentials to conn=${loginConnId}, cap=${loginCapName}`);
    const loginResp = await axios.post(
      `${base}/davinci/connections/${loginConnId}/capabilities/${loginCapName}`,
      {
        id: loginId,
        eventName: 'continue',
        parameters: {
          username: email,
          password: password,
          buttonValue: 'SIGNON',
        },
      },
      { headers: { ...hdr, interactionid: interactionId }, validateStatus: () => true, timeout: 15000 }
    );

    console.log(`FPL PingOne login: status=${loginResp.status}, respKeys=${Object.keys(loginResp.data || {}).join(',')}`);
    fplLoginDebug.steps.push({
      step: 4, name: 'login-submit', status: loginResp.status,
      hasAuthCode: !!loginResp.data.authorizeResponse?.code,
      errorCode: loginResp.data.code || null,
      errorReason: loginResp.data.error_reason || loginResp.data.description || null,
      screenName: loginResp.data.screen?.name || null,
      respSnippet: JSON.stringify(loginResp.data).substring(0, 400),
    });

    // Check for auth code in response
    if (loginResp.data.authorizeResponse?.code) {
      const authCode = loginResp.data.authorizeResponse.code;
      console.log('✅ FPL login: got auth code');

      // Step 5: Exchange auth code for session token via PingOne token endpoint
      const tokenResp = await axios.post(
        `${PINGONE_AUTH_ROOT}/${PINGONE_ENV_ID}/as/token`,
        new URLSearchParams({
          grant_type: 'authorization_code',
          code: authCode,
          client_id: PINGONE_CLIENT_ID,
          redirect_uri: 'https://www.premierleague.com/',
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: () => true,
          timeout: 15000,
        }
      );

      if (tokenResp.data.access_token) {
        // Use the access token as Bearer for FPL API
        fplSession = `Bearer ${tokenResp.data.access_token}`;
        fplLoginError = null;
        console.log('✅ FPL login berhasil via PingOne SSO');
        return fplSession;
      } else {
        fplLoginError = `Token exchange gagal: ${tokenResp.data.error || 'unknown'}`;
        console.error('❌ FPL token exchange failed:', JSON.stringify(tokenResp.data).substring(0, 200));
      }
    } else if (loginResp.status === 400) {
      // Login failed — extract reason
      const errMsg = loginResp.data.code || loginResp.data.error_reason || loginResp.data.description || '';
      if (errMsg.includes('Invalid username') || errMsg.includes('password')) {
        fplLoginError = 'Email atau password salah';
      } else if (errMsg.includes('locked') || errMsg.includes('blocked')) {
        fplLoginError = 'Akun terkunci. Coba reset password di premierleague.com';
      } else {
        fplLoginError = errMsg || 'Login gagal (400)';
      }
    } else if (loginResp.data.screen) {
      // Another screen appeared (e.g., 2FA, consent)
      fplLoginError = `Login butuh langkah tambahan: ${loginResp.data.screen.name || 'unknown screen'}`;
    } else {
      fplLoginError = `Login response tidak dikenali (status ${loginResp.status})`;
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

function getFplLoginDebug() {
  return fplLoginDebug;
}

function setFplSession(token) {
  if (!token) {
    fplSession = null;
    return;
  }
  // Auto-detect format: Bearer token or cookie
  if (token.startsWith('Bearer ')) {
    fplSession = token;
  } else if (token.startsWith('ey')) {
    // JWT token — wrap as Bearer
    fplSession = `Bearer ${token}`;
  } else {
    // Assume cookie value (pl_profile=...)
    fplSession = token.includes('=') ? token : `pl_profile=${token}`;
  }
  fplLoginError = null;
}

// =====================
// Authorization Code + PKCE Flow
// User logs in via browser, copies redirect URL, bot exchanges code for token
// =====================

let pendingPkce = null; // { codeVerifier, state }

function generatePkce() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  const state = crypto.randomBytes(16).toString('hex');
  return { codeVerifier, codeChallenge, state };
}

function startAuthCodeFlow() {
  const pkce = generatePkce();
  pendingPkce = { codeVerifier: pkce.codeVerifier, state: pkce.state };

  const params = new URLSearchParams({
    client_id: PINGONE_CLIENT_ID,
    response_type: 'code',
    redirect_uri: 'https://www.premierleague.com/',
    scope: 'openid',
    code_challenge: pkce.codeChallenge,
    code_challenge_method: 'S256',
    state: pkce.state,
  });

  return `${PINGONE_AUTH_ROOT}/${PINGONE_ENV_ID}/as/authorize?${params.toString()}`;
}

async function exchangeAuthCode(redirectUrl) {
  if (!pendingPkce) {
    return { success: false, error: 'Tidak ada login yang sedang berlangsung. Jalankan /fpllogin dulu.' };
  }

  // Extract code from redirect URL
  let code;
  try {
    const url = new URL(redirectUrl);
    code = url.searchParams.get('code');
  } catch {
    // Maybe user pasted just the code
    code = redirectUrl.trim();
  }

  if (!code) {
    return { success: false, error: 'Tidak menemukan kode otorisasi di URL. Pastikan copy URL lengkap.' };
  }

  try {
    const { data } = await axios.post(
      `${PINGONE_AUTH_ROOT}/${PINGONE_ENV_ID}/as/token`,
      new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        client_id: PINGONE_CLIENT_ID,
        redirect_uri: 'https://www.premierleague.com/',
        code_verifier: pendingPkce.codeVerifier,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
        timeout: 15000,
      }
    );

    pendingPkce = null;

    if (data.access_token) {
      fplSession = `Bearer ${data.access_token}`;
      fplRefreshToken = data.refresh_token || null;
      fplLoginError = null;
      console.log('✅ FPL auth code login berhasil');
      return { success: true };
    }

    return { success: false, error: data.error_description || data.error || 'Token exchange gagal' };
  } catch (err) {
    pendingPkce = null;
    return { success: false, error: err.message };
  }
}

// =====================
// Device Code Flow — user authorizes in browser, bot gets token
// =====================

async function startDeviceCodeFlow() {
  try {
    const { data } = await axios.post(
      `${PINGONE_AUTH_ROOT}/${PINGONE_ENV_ID}/as/device_authorization`,
      new URLSearchParams({
        client_id: PINGONE_CLIENT_ID,
        scope: 'openid',
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 15000,
      }
    );
    return data; // { device_code, user_code, verification_uri, verification_uri_complete, expires_in, interval }
  } catch (err) {
    console.error('Device code flow start failed:', err.response?.data || err.message);
    return null;
  }
}

async function pollDeviceCodeToken(deviceCode, interval = 5, expiresIn = 600) {
  const deadline = Date.now() + expiresIn * 1000;

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, interval * 1000));

    try {
      const { data } = await axios.post(
        `${PINGONE_AUTH_ROOT}/${PINGONE_ENV_ID}/as/token`,
        new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code: deviceCode,
          client_id: PINGONE_CLIENT_ID,
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          validateStatus: () => true,
          timeout: 15000,
        }
      );

      if (data.access_token) {
        fplSession = `Bearer ${data.access_token}`;
        fplRefreshToken = data.refresh_token || null;
        fplLoginError = null;
        console.log('✅ FPL device code login berhasil');
        return { success: true, access_token: data.access_token };
      }

      if (data.error === 'authorization_pending') {
        continue; // user hasn't authorized yet
      }
      if (data.error === 'slow_down') {
        interval += 5; // back off
        continue;
      }

      // Other errors (expired_token, access_denied)
      return { success: false, error: data.error_description || data.error || 'Unknown error' };
    } catch (err) {
      // Network error — retry
      console.warn('Device code poll error:', err.message);
    }
  }

  return { success: false, error: 'Timeout — kamu tidak menyelesaikan login dalam waktu yang ditentukan' };
}

async function refreshFplToken() {
  if (!fplRefreshToken) return false;
  try {
    const { data } = await axios.post(
      `${PINGONE_AUTH_ROOT}/${PINGONE_ENV_ID}/as/token`,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: fplRefreshToken,
        client_id: PINGONE_CLIENT_ID,
      }).toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        validateStatus: () => true,
        timeout: 15000,
      }
    );
    if (data.access_token) {
      fplSession = `Bearer ${data.access_token}`;
      if (data.refresh_token) fplRefreshToken = data.refresh_token;
      console.log('✅ FPL token refreshed');
      return true;
    }
    console.error('FPL token refresh failed:', data.error);
    fplRefreshToken = null;
    return false;
  } catch (err) {
    console.error('FPL token refresh error:', err.message);
    return false;
  }
}

function buildAuthHeaders() {
  if (!fplSession) return null;
  // Support both Bearer token (PingOne) and Cookie (legacy)
  if (fplSession.startsWith('Bearer ')) {
    return { Authorization: fplSession };
  }
  return { Cookie: fplSession };
}

async function fetchMyTeam(managerId) {
  if (!fplSession) {
    await fplLogin();
  }
  if (!fplSession) return null;

  const authHeaders = buildAuthHeaders();

  try {
    const { data } = await axios.get(`${BASE}/my-team/${managerId}/`, {
      headers: authHeaders,
      timeout: 15000,
    });
    return data;
  } catch (err) {
    // Session expired — coba refresh token dulu, lalu login ulang
    if (err.response?.status === 401 || err.response?.status === 403) {
      const refreshed = await refreshFplToken();
      if (!refreshed) {
        fplSession = null;
        await fplLogin();
      }
      if (!fplSession) return null;
      try {
        const { data } = await axios.get(`${BASE}/my-team/${managerId}/`, {
          headers: buildAuthHeaders(),
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
  fetchMyTeam, fplLogin, getFplLoginError, getFplLoginDebug, setFplSession,
  startDeviceCodeFlow, pollDeviceCodeToken, refreshFplToken,
  startAuthCodeFlow, exchangeAuthCode,
};
