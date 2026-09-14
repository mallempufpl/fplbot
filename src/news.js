const axios = require('axios');

// =====================
// PARSE AKUN DARI ENV
// =====================
// Format di .env: "username1,username2,username3"
function parseAccounts(envValue, defaults) {
  if (!envValue) return defaults;
  return envValue.split(',')
    .map(u => u.trim())
    .filter(Boolean)
    .map(username => ({ username, label: username }));
}

const DEFAULT_X = [
  { username: 'OfficialFPL', label: 'FPL Official' },
  { username: 'FPLStatus', label: 'FPL Status (Harga & Cedera)' },
  { username: 'BenCrellin', label: 'Ben Crellin (DGW/BGW)' },
  { username: 'FFScout', label: 'FF Scout' },
  { username: 'FPL_Rockstar', label: 'FPL Rockstar' },
];

const DEFAULT_IG = [
  { username: 'officialfpl', label: 'FPL Official' },
  { username: 'premierleague', label: 'Premier League' },
  { username: 'fantasyfootballscout', label: 'FF Scout' },
  { username: 'faborefpl', label: 'Fabore FPL' },
  { username: 'fpl.focal', label: 'FPL Focal' },
];

const FPL_ACCOUNTS_X = parseAccounts(process.env.X_ACCOUNTS, DEFAULT_X);
const FPL_ACCOUNTS_IG = parseAccounts(process.env.IG_ACCOUNTS, DEFAULT_IG);

// =====================
// X / TWITTER
// =====================
async function fetchTweets(username, count = 5) {
  try {
    const { data } = await axios.get(`https://api.fxtwitter.com/${username}`, {
      timeout: 10000,
      headers: { 'User-Agent': 'FPLBot/1.0' },
    });

    if (!data?.tweets) return [];

    return data.tweets.slice(0, count).map(t => ({
      text: t.text || '',
      date: t.created_at || '',
      likes: t.likes || 0,
      retweets: t.retweets || 0,
      url: t.url || `https://x.com/${username}/status/${t.id}`,
    }));
  } catch {
    return [];
  }
}

// =====================
// INSTAGRAM
// =====================

// Metode 1: Via RSSHub (publik, gratis)
async function fetchInstagramViaRSS(username, count = 3) {
  const endpoints = [
    `https://rsshub.app/instagram/user/${username}`,
    `https://rsshub.rssforever.com/instagram/user/${username}`,
  ];

  for (const url of endpoints) {
    try {
      const { data } = await axios.get(url, {
        timeout: 12000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml',
        },
      });

      // Parse XML sederhana (tanpa dependency tambahan)
      const items = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      while ((match = itemRegex.exec(data)) && items.length < count) {
        const itemXml = match[1];
        const title = extractTag(itemXml, 'title');
        const link = extractTag(itemXml, 'link');
        const pubDate = extractTag(itemXml, 'pubDate');
        const desc = extractTag(itemXml, 'description');

        // Bersihkan HTML dari description
        const cleanDesc = desc
          .replace(/<br\s*\/?>/gi, ' ')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#\d+;/g, '')
          .trim();

        items.push({
          text: cleanDesc || title || '(tanpa caption)',
          date: pubDate || '',
          url: link || `https://instagram.com/${username}`,
        });
      }

      if (items.length > 0) return items;
    } catch {
      continue;
    }
  }

  return [];
}

// Metode 2: Via embed page scraping (fallback)
async function fetchInstagramViaEmbed(username, count = 3) {
  try {
    const { data } = await axios.get(`https://www.instagram.com/${username}/`, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(process.env.IG_SESSION_ID ? { 'Cookie': `sessionid=${process.env.IG_SESSION_ID}` } : {}),
      },
    });

    // Coba extract shared data dari HTML
    const sharedDataMatch = data.match(/window\._sharedData\s*=\s*({.+?});<\/script>/);
    if (sharedDataMatch) {
      const sharedData = JSON.parse(sharedDataMatch[1]);
      const edges = sharedData?.entry_data?.ProfilePage?.[0]?.graphql?.user?.edge_owner_to_timeline_media?.edges || [];

      return edges.slice(0, count).map(edge => {
        const node = edge.node;
        return {
          text: node.edge_media_to_caption?.edges?.[0]?.node?.text || '(tanpa caption)',
          date: node.taken_at_timestamp ? new Date(node.taken_at_timestamp * 1000).toISOString() : '',
          url: `https://instagram.com/p/${node.shortcode}/`,
        };
      });
    }

    // Coba extract dari format baru (additional data)
    const additionalMatch = data.match(/"xdt_api__v1__feed__user_timeline_graphql_connection":\s*({.+?})\s*}/);
    if (additionalMatch) {
      // Format baru lebih kompleks, skip jika tidak bisa parse
    }

    return [];
  } catch {
    return [];
  }
}

// Gabungan: coba RSSHub dulu, fallback ke embed
async function fetchInstagramPosts(username, count = 3) {
  let posts = await fetchInstagramViaRSS(username, count);
  if (posts.length === 0) {
    posts = await fetchInstagramViaEmbed(username, count);
  }
  return posts;
}

// =====================
// AGGREGATOR
// =====================

async function fetchAllFplNews() {
  const results = [];

  const fetches = FPL_ACCOUNTS_X.map(async (acc) => {
    const tweets = await fetchTweets(acc.username, 3);
    if (tweets.length > 0) {
      results.push({ platform: 'X', account: acc, posts: tweets });
    }
  });

  await Promise.all(fetches);
  return results;
}

async function fetchAllInstagramNews() {
  const results = [];

  // Fetch sequentially untuk IG (hindari rate limit)
  for (const acc of FPL_ACCOUNTS_IG) {
    const posts = await fetchInstagramPosts(acc.username, 3);
    if (posts.length > 0) {
      results.push({ platform: 'IG', account: acc, posts });
    }
  }

  return results;
}

async function fetchAllNews() {
  const [xResults, igResults] = await Promise.all([
    fetchAllFplNews(),
    fetchAllInstagramNews(),
  ]);
  return [...xResults, ...igResults];
}

async function fetchAccountNews(query, platform = null) {
  const q = query.toLowerCase();

  // Cari di X
  if (!platform || platform === 'x') {
    const xAcc = FPL_ACCOUNTS_X.find(a =>
      a.username.toLowerCase().includes(q) || a.label.toLowerCase().includes(q)
    );
    if (xAcc) {
      const posts = await fetchTweets(xAcc.username, 5);
      return { platform: 'X', account: xAcc, posts };
    }
  }

  // Cari di IG
  if (!platform || platform === 'ig') {
    const igAcc = FPL_ACCOUNTS_IG.find(a =>
      a.username.toLowerCase().includes(q) || a.label.toLowerCase().includes(q)
    );
    if (igAcc) {
      const posts = await fetchInstagramPosts(igAcc.username, 5);
      return { platform: 'IG', account: igAcc, posts };
    }
  }

  // Coba sebagai username langsung
  if (platform === 'ig') {
    const posts = await fetchInstagramPosts(query, 5);
    return { platform: 'IG', account: { username: query, label: query }, posts };
  }

  const posts = await fetchTweets(query, 5);
  return { platform: 'X', account: { username: query, label: query }, posts };
}

// =====================
// FORMATTER
// =====================

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatNews(newsResults) {
  if (newsResults.length === 0) {
    return '❌ Tidak bisa mengambil berita saat ini. Coba lagi nanti.';
  }

  const lines = [];

  // Kelompokkan per platform
  const xResults = newsResults.filter(r => r.platform === 'X');
  const igResults = newsResults.filter(r => r.platform === 'IG');

  if (xResults.length > 0) {
    lines.push('<b>🐦 Berita dari X/Twitter</b>\n');
    for (const { account, posts } of xResults) {
      lines.push(`<b>@${account.username}</b> — ${account.label}`);
      lines.push('─────────────────');
      formatPosts(lines, posts, 'x');
    }
  }

  if (igResults.length > 0) {
    if (xResults.length > 0) lines.push('\n');
    lines.push('<b>📸 Berita dari Instagram</b>\n');
    for (const { account, posts } of igResults) {
      lines.push(`<b>@${account.username}</b> — ${account.label}`);
      lines.push('─────────────────');
      formatPosts(lines, posts, 'ig');
    }
  }

  return lines.join('\n');
}

function formatPosts(lines, posts, platform) {
  if (posts.length === 0) {
    lines.push('<i>  Tidak ada post terbaru</i>\n');
    return;
  }

  for (const p of posts) {
    let text = p.text.replace(/<[^>]+>/g, '').replace(/\n+/g, ' ');
    if (text.length > 200) text = text.substring(0, 197) + '...';
    text = escapeHtml(text);

    const time = p.date ? new Date(p.date).toLocaleString('id-ID', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }) : '';

    const icon = platform === 'x' ? '💬' : '📷';
    lines.push(`  ${icon} ${text}`);

    const meta = [];
    if (time) meta.push(time);
    if (p.likes) meta.push(`❤️ ${p.likes}`);
    if (p.retweets) meta.push(`🔁 ${p.retweets}`);
    if (meta.length > 0) lines.push(`     <i>${meta.join(' | ')}</i>`);

    const linkLabel = platform === 'x' ? 'Buka di X' : 'Buka di Instagram';
    lines.push(`     <a href="${p.url}">${linkLabel}</a>`);
    lines.push('');
  }
}

function formatSingleAccount(result) {
  if (!result || result.posts.length === 0) {
    return `❌ Tidak ada post dari @${result?.account?.username || '?'} (${result?.platform || '?'})`;
  }
  return formatNews([result]);
}

// =====================
// HELPERS
// =====================

function extractTag(xml, tag) {
  const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
  const match = xml.match(regex);
  return match ? (match[1] || match[2] || '').trim() : '';
}

// =====================
// NEWS INTEL (scan berita untuk pemain tertentu)
// =====================

const NEGATIVE_KEYWORDS = [
  'injured', 'injury', 'out', 'doubt', 'doubtful', 'ruled out', 'miss',
  'missed', 'sidelined', 'setback', 'surgery', 'operation', 'scan',
  'hamstring', 'knee', 'ankle', 'muscle', 'groin', 'calf', 'thigh',
  'suspended', 'suspension', 'red card', 'ban', 'banned',
  'dropped', 'benched', 'rotation', 'rotated', 'rested',
  'price drop', 'falling', 'flagged',
  'cedera', 'absen', 'tidak main', 'diragukan', 'kartu merah', 'diskors',
];

const POSITIVE_KEYWORDS = [
  'back', 'returned', 'fit', 'available', 'starts', 'starting',
  'goal', 'assist', 'brace', 'hat-trick', 'hatrick', 'hattrick',
  'form', 'inform', 'in-form', 'essential', 'must-have', 'must have',
  'price rise', 'rising',
  'kembali', 'pulih', 'siap main', 'starter', 'gol',
];

async function fetchNewsIntel(playerNames) {
  const intel = {};

  // Fetch semua tweet dari akun X yang dikonfigurasi
  const allTweets = [];
  const fetches = FPL_ACCOUNTS_X.map(async (acc) => {
    const tweets = await fetchTweets(acc.username, 10);
    for (const t of tweets) {
      allTweets.push({ ...t, source: acc.username });
    }
  });
  await Promise.all(fetches);

  // Fetch semua post IG
  const allIgPosts = [];
  for (const acc of FPL_ACCOUNTS_IG) {
    const posts = await fetchInstagramPosts(acc.username, 5);
    for (const p of posts) {
      allIgPosts.push({ ...p, source: acc.username });
    }
  }

  const allPosts = [...allTweets, ...allIgPosts];

  for (const name of playerNames) {
    const nameLower = name.toLowerCase();
    // Juga cek nama belakang saja (misal "Salah" dari "M. Salah")
    const parts = name.split(/[\s.]+/).filter(p => p.length > 2);

    const mentions = allPosts.filter(post => {
      const text = post.text.toLowerCase();
      if (text.includes(nameLower)) return true;
      // Cek per bagian nama (minimal 3 huruf untuk hindari false positive)
      return parts.some(part => {
        const partLower = part.toLowerCase();
        // Pastikan match sebagai kata utuh
        const regex = new RegExp(`\\b${partLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        return regex.test(post.text);
      });
    });

    if (mentions.length === 0) continue;

    const alerts = [];
    for (const m of mentions) {
      const textLower = m.text.toLowerCase();
      const negHits = NEGATIVE_KEYWORDS.filter(kw => textLower.includes(kw));
      const posHits = POSITIVE_KEYWORDS.filter(kw => textLower.includes(kw));

      if (negHits.length > 0 || posHits.length > 0) {
        alerts.push({
          type: negHits.length >= posHits.length ? 'negative' : 'positive',
          text: m.text.length > 150 ? m.text.substring(0, 147) + '...' : m.text,
          source: m.source,
          url: m.url,
          negKeywords: negHits,
          posKeywords: posHits,
        });
      }
    }

    if (alerts.length > 0) {
      intel[name] = alerts;
    }
  }

  return intel;
}

function formatNewsIntel(intel) {
  if (Object.keys(intel).length === 0) return '';

  const lines = ['\n<b>📰 Info dari Berita (X & Instagram)</b>\n'];

  for (const [name, alerts] of Object.entries(intel)) {
    for (const alert of alerts.slice(0, 2)) {
      const icon = alert.type === 'negative' ? '🚨' : '✅';
      const cleanText = alert.text.replace(/<[^>]+>/g, '').replace(/\n+/g, ' ');
      lines.push(`${icon} <b>${name}</b> — @${alert.source}`);
      lines.push(`   <i>${cleanText}</i>`);
      if (alert.url) lines.push(`   <a href="${alert.url}">Buka</a>`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

module.exports = {
  fetchAllFplNews, fetchAllInstagramNews, fetchAllNews,
  fetchAccountNews, formatNews, formatSingleAccount,
  fetchNewsIntel, formatNewsIntel,
  FPL_ACCOUNTS_X, FPL_ACCOUNTS_IG,
};
