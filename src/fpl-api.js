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
let fplLoginDebug = null; // stores last login attempt debug info

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

    // Step 3: Pass bot protection screen (submit empty protectsdk)
    const botResp = await axios.post(
      `${base}/davinci/connections/${flowResp.data.connectionId}/capabilities/${flowResp.data.capabilityName}`,
      {
        id: flowResp.data.id,
        eventName: 'continue',
        parameters: { eventType: 'submit', data: { actionKey: 'continue', formData: { protectsdk: '' } } },
      },
      { headers: { ...hdr, interactionid: interactionId }, validateStatus: () => true, timeout: 15000 }
    );

    // Log bot protection response to discover expected form fields
    console.log('DaVinci step3 (bot protection) response keys:', JSON.stringify({
      status: botResp.status,
      connectionId: botResp.data.connectionId,
      capabilityName: botResp.data.capabilityName,
      formFields: botResp.data.form?.fields,
      screen: botResp.data.screen,
      formKeys: botResp.data.form ? Object.keys(botResp.data.form) : null,
      topKeys: Object.keys(botResp.data || {}),
    }).substring(0, 1000));

    // Detect form field names from DaVinci response
    const formFields = botResp.data.form?.fields || [];
    const fieldNames = formFields.map(f => f.key || f.name || f.propertyName).filter(Boolean);
    console.log('DaVinci expected login field names:', fieldNames);
    fplLoginDebug.steps.push({
      step: 3, name: 'bot-protection', status: botResp.status,
      hasConnectionId: !!botResp.data.connectionId,
      screenName: botResp.data.screen?.name || null,
      detectedFields: fieldNames,
      topKeys: Object.keys(botResp.data || {}),
    });

    // Build login parameters using detected field names or fallback to common PingOne names
    const loginParams = {};
    const emailFieldName = fieldNames.find(f => /email|username|identifier|signonidentifier/i.test(f)) || 'username';
    const passFieldName = fieldNames.find(f => /password|signonpassword/i.test(f)) || 'password';
    loginParams[emailFieldName] = email;
    loginParams[passFieldName] = password;
    // Add button/submit value
    const btnFieldName = fieldNames.find(f => /button|submit|action/i.test(f)) || 'buttonValue';
    loginParams[btnFieldName] = 'SIGNON';

    console.log(`DaVinci login fields: email="${emailFieldName}", pass="${passFieldName}", btn="${btnFieldName}"`);

    // Step 4: Submit login credentials
    const loginResp = await axios.post(
      `${base}/davinci/connections/${botResp.data.connectionId}/capabilities/${botResp.data.capabilityName}`,
      {
        id: botResp.data.id,
        eventName: 'continue',
        parameters: loginParams,
      },
      { headers: { ...hdr, interactionid: interactionId }, validateStatus: () => true, timeout: 15000 }
    );

    console.log(`FPL PingOne login: status=${loginResp.status}, respKeys=${Object.keys(loginResp.data || {}).join(',')}`);
    fplLoginDebug.steps.push({
      step: 4, name: 'login-submit', status: loginResp.status,
      usedFields: { email: emailFieldName, pass: passFieldName, btn: btnFieldName },
      hasAuthCode: !!loginResp.data.authorizeResponse?.code,
      errorCode: loginResp.data.code || null,
      errorReason: loginResp.data.error_reason || null,
      screenName: loginResp.data.screen?.name || null,
      respSnippet: JSON.stringify(loginResp.data).substring(0, 300),
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
    // Session expired — coba login ulang sekali
    if (err.response?.status === 401 || err.response?.status === 403) {
      fplSession = null;
      await fplLogin();
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
  fetchMyTeam, fplLogin, getFplLoginError, getFplLoginDebug,
};
