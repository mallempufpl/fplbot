const { fetchAll, fetchManagerInfo, fetchManagerPicks, fetchMyTeam } = require('./fpl-api');
const { scoreAllPlayers } = require('./scoring');
const {
  addToWatchlist, removeFromWatchlist, getWatchlist,
  registerUser, getUser, getAllUsers, updateUserActivity, getUserActivity, getUserStats,
} = require('./database');
const {
  POSITION_NAMES, POSITION_EMOJI, ALL_METRICS, METRIC_LABELS,
  getActiveMetrics, getPositionWeights, DEFAULT_WEIGHTS,
} = require('./config');
const { isOwner, OWNER_ID } = require('./admin');
const fmt = require('./format');
const {
  ensureHistoricalData, refreshHistoricalData, makePlayerKey,
  analyzePlayerTrend, hasHistoricalData, SEASONS,
} = require('./historical');
const {
  fetchAllNews, fetchAllFplNews, fetchAllInstagramNews,
  fetchAccountNews, formatNews, formatSingleAccount,
  sendIgPostsWithImages,
  fetchNewsIntel, formatNewsIntel,
  getAccountsX, getAccountsIG,
} = require('./news');

// Cache scored players (refresh setiap fetch baru)
let cachedScored = null;
let cacheTs = 0;
const CACHE_TTL = 600_000; // 10 menit

async function getScoredPlayers() {
  const now = Date.now();
  if (cachedScored && now - cacheTs < CACHE_TTL) return cachedScored;

  // Pastikan data historis sudah ada (lazy load, auto-refresh weekly)
  try {
    await ensureHistoricalData();
  } catch (err) {
    console.error('Historical data load warning:', err.message);
  }

  const data = await fetchAll();
  const scored = scoreAllPlayers(data.players);
  cachedScored = { scored, teams: data.teams, currentGw: data.currentGw };
  cacheTs = now;
  return cachedScored;
}

function findPlayer(scored, query) {
  const q = query.toLowerCase().trim();
  // Exact match first
  let found = scored.find(p => p.web_name.toLowerCase() === q);
  if (found) return found;
  // Partial match
  const matches = scored.filter(p =>
    p.web_name.toLowerCase().includes(q) ||
    (`${p.first_name} ${p.second_name}`).toLowerCase().includes(q)
  );
  return matches.length === 1 ? matches[0] : matches.length > 1 ? matches : null;
}

function posIdFromStr(str) {
  const s = str?.toUpperCase().trim();
  for (const [id, name] of Object.entries(POSITION_NAMES)) {
    if (name === s) return parseInt(id);
  }
  // Alias
  const alias = { GOALKEEPER: 1, KEEPER: 1, DEFENDER: 2, MIDFIELDER: 3, FORWARD: 4, STRIKER: 4, ATT: 4, MF: 3, DF: 2 };
  return alias[s] || null;
}

// Perintah yang bisa diakses tanpa registrasi
const PUBLIC_COMMANDS = ['start', 'myid'];

// Ambil FPL ID user: dari registered user atau fallback ke env (owner)
function getUserFplId(ctx) {
  const user = getUser(ctx.from.id);
  if (user?.fpl_id) return user.fpl_id;
  if (isOwner(ctx) && process.env.FPL_ID) return parseInt(process.env.FPL_ID);
  return null;
}

function registerCommands(bot) {

  // =====================
  // MIDDLEWARE: Cek registrasi + tracking aktivitas
  // =====================
  bot.use((ctx, next) => {
    if (!ctx.message?.text) return next();

    const text = ctx.message.text;
    const command = text.startsWith('/') ? text.split(/[\s@]/)[0].substring(1).toLowerCase() : null;

    // Public commands selalu diizinkan
    if (!command || PUBLIC_COMMANDS.includes(command)) return next();

    // Owner selalu bisa akses
    if (isOwner(ctx)) {
      // Track aktivitas owner juga
      if (command) {
        try { updateUserActivity(ctx.from.id, command, text.replace(/^\/\S+\s*/, '').trim() || null); } catch {}
      }
      return next();
    }

    // Cek registrasi
    const user = getUser(ctx.from.id);
    if (!user) {
      return ctx.replyWithHTML(
        `👋 <b>Halo ${ctx.from.first_name || 'Sobat FPL'}!</b>\n\n` +
        `Sebelum menggunakan bot ini, kamu perlu mendaftarkan FPL ID kamu dulu.\n\n` +
        `Ketik /start untuk mulai registrasi.`
      );
    }

    // Track aktivitas user terdaftar
    if (command) {
      try { updateUserActivity(ctx.from.id, command, text.replace(/^\/\S+\s*/, '').trim() || null); } catch {}
    }

    return next();
  });

  // =====================
  // /start — Welcome & Registrasi
  // =====================
  bot.command('start', async ctx => {
    const user = getUser(ctx.from.id);
    const arg = ctx.message.text.replace(/^\/start\s*/i, '').trim();

    // Cek apakah ada FPL ID di argumen (registrasi atau update)
    if (arg) {
      const fplId = parseInt(arg);
      if (!fplId || isNaN(fplId)) {
        return ctx.reply('❌ FPL ID harus berupa angka. Contoh: /start 1234567');
      }

      // Validasi FPL ID
      try {
        const manager = await fetchManagerInfo(fplId);
        registerUser(ctx.from.id, fplId, ctx);

        return ctx.replyWithHTML([
          `✅ <b>Registrasi Berhasil!</b>`,
          ``,
          `👤 <b>${manager.player_first_name} ${manager.player_last_name}</b>`,
          `📋 ${manager.name}`,
          `🏆 Overall Rank: ${manager.summary_overall_rank?.toLocaleString() || 'N/A'}`,
          `📊 Total Points: ${manager.summary_overall_points || 0}`,
          ``,
          `FPL ID kamu (<code>${fplId}</code>) sudah tersimpan.`,
          `Sekarang kamu bisa menggunakan semua fitur bot!`,
          ``,
          `Ketik /start lagi untuk melihat daftar perintah.`,
        ].join('\n'));
      } catch (err) {
        if (err.response?.status === 404) {
          return ctx.reply(`❌ FPL ID ${fplId} tidak ditemukan. Pastikan ID-nya benar.`);
        }
        return ctx.reply('❌ Gagal memverifikasi FPL ID. Coba lagi nanti.');
      }
    }

    // User belum terdaftar & tidak kirim FPL ID → tampilkan welcome
    if (!user && !isOwner(ctx)) {
      return ctx.replyWithHTML([
        `👋 <b>Selamat Datang di FPL Differential Bot!</b>`,
        ``,
        `Halo <b>${ctx.from.first_name || 'Sobat FPL'}</b>! Bot ini akan membantu kamu:`,
        ``,
        `⚽ Analisa pemain dengan metrik canggih + data 3 musim`,
        `📊 Rekomendasi transfer berdasarkan quality score`,
        `💎 Temukan differential picks tersembunyi`,
        `📰 Update berita FPL dari X & Instagram`,
        `📈 Tren transfer in/out terpopuler`,
        ``,
        `<b>Untuk mulai, daftarkan FPL ID kamu:</b>`,
        `<code>/start [FPL ID]</code>`,
        ``,
        `<b>Contoh:</b> <code>/start 1234567</code>`,
        ``,
        `<b>Cara cari FPL ID:</b>`,
        `1. Buka fantasy.premierleague.com`,
        `2. Login → klik "Points" atau "My Team"`,
        `3. Lihat angka di URL: /entry/<b>XXXXX</b>/event/...`,
        ``,
        `💡 FPL ID bukan username, tapi angka di URL halaman tim kamu.`,
      ].join('\n'));
    }

    // User sudah terdaftar atau owner → tampilkan menu
    const userInfo = user ? ` (FPL ID: <code>${user.fpl_id}</code>)` : '';
    ctx.replyWithHTML([
      `<b>⚽ FPL Differential Bot</b>${userInfo}`,
      '',
      '<b>📊 Analisa Pemain:</b>',
      '/player &lt;nama&gt; — Detail pemain',
      '/analyze &lt;nama&gt; — Analisa mendalam pemain',
      '/history &lt;nama&gt; — Data historis 3 musim',
      '/compare &lt;A&gt; vs &lt;B&gt; — Bandingkan 2 pemain',
      '/best &lt;posisi&gt; — Top pemain per posisi',
      '/differentials [posisi] — Top differential picks',
      '/regression — Pemain over/underperform vs xG',
      '',
      '<b>👤 Squad & Transfer:</b>',
      '/squad — Lihat squad kamu',
      '/suggest — Saran transfer terbaik',
      '/trending — Transfer in &amp; out terpopuler',
      '/nettransfer — Net transfer (gainers vs losers)',
      '',
      '<b>📰 Berita & Info:</b>',
      '/news — Berita FPL (X + IG)',
      '/newslist — Daftar akun sumber berita',
      '/fixtures &lt;tim&gt; — Jadwal & FDR',
      '',
      '<b>📋 Watchlist:</b>',
      '/watch &lt;nama&gt; — Tambah ke watchlist',
      '/unwatch &lt;nama&gt; — Hapus dari watchlist',
      '/watchlist — Lihat watchlist',
      '',
      '<b>⚙️ Pengaturan:</b>',
      '/start &lt;FPL ID&gt; — Ubah FPL ID',
      '/metrics — Konfigurasi metrik scoring',
      '/refresh — Refresh data',
      ...(isOwner(ctx) ? [
        '',
        '<b>🔒 Admin (@Abulkhaer):</b>',
        '/users — Dashboard & monitor user',
        '/removeuser &lt;chat_id&gt; — Hapus user',
        '/xadd · /xdel — Kelola akun X',
        '/igadd · /igdel — Kelola akun IG',
        '/setenv · /getenv · /delenv · /restart',
        '/refreshhistory — Refresh data historis',
      ] : []),
    ].join('\n'));
  });

  // /player <nama>
  bot.command('player', async ctx => {
    const query = ctx.message.text.replace(/^\/player\s*/i, '').trim();
    if (!query) return ctx.reply('Gunakan: /player <nama pemain>');

    try {
      const { scored } = await getScoredPlayers();
      const result = findPlayer(scored, query);

      if (!result) return ctx.reply(`❌ Pemain "${query}" tidak ditemukan.`);
      if (Array.isArray(result)) {
        const names = result.slice(0, 10).map(p => `• ${p.web_name} (${p.teamData?.short_name || '?'})`);
        return ctx.replyWithHTML(`Ditemukan ${result.length} pemain:\n${names.join('\n')}\n\nCoba lebih spesifik.`);
      }

      ctx.replyWithHTML(fmt.playerCard(result));
    } catch (err) {
      console.error('Error /player:', err.message);
      ctx.reply('❌ Gagal mengambil data. Coba lagi nanti.');
    }
  });

  // /compare <A> vs <B>
  bot.command('compare', async ctx => {
    const text = ctx.message.text.replace(/^\/compare\s*/i, '').trim();
    const parts = text.split(/\s+vs\s+/i);
    if (parts.length !== 2) return ctx.reply('Gunakan: /compare <pemain A> vs <pemain B>');

    try {
      const { scored } = await getScoredPlayers();
      const a = findPlayer(scored, parts[0]);
      const b = findPlayer(scored, parts[1]);

      if (!a || Array.isArray(a)) return ctx.reply(`❌ Pemain "${parts[0]}" tidak ditemukan atau ambigu.`);
      if (!b || Array.isArray(b)) return ctx.reply(`❌ Pemain "${parts[1]}" tidak ditemukan atau ambigu.`);

      ctx.replyWithHTML(fmt.compareCard(a, b));
    } catch (err) {
      console.error('Error /compare:', err.message);
      ctx.reply('❌ Gagal mengambil data.');
    }
  });

  // /best <posisi>
  bot.command('best', async ctx => {
    const posStr = ctx.message.text.replace(/^\/best\s*/i, '').trim();
    const posId = posIdFromStr(posStr);
    if (!posId) return ctx.reply('Gunakan: /best <GK|DEF|MID|FWD>');

    try {
      const { scored } = await getScoredPlayers();
      const filtered = scored
        .filter(p => p.element_type === posId && p.minutes > 0)
        .sort((a, b) => b.scoring.qualityScore - a.scoring.qualityScore);

      const title = `🏆 Top ${POSITION_NAMES[posId]} — Quality Score`;
      ctx.replyWithHTML(fmt.rankingList(filtered, title, 15));
    } catch (err) {
      console.error('Error /best:', err.message);
      ctx.reply('❌ Gagal mengambil data.');
    }
  });

  // /differentials [posisi]
  bot.command('differentials', async ctx => {
    const posStr = ctx.message.text.replace(/^\/differentials\s*/i, '').trim();
    const posId = posStr ? posIdFromStr(posStr) : null;

    try {
      const { scored } = await getScoredPlayers();
      let filtered = scored.filter(p =>
        p.scoring.label === 'DIFFERENTIAL' && p.minutes > 0 && p.scoring.minutesSafe
      );
      if (posId) filtered = filtered.filter(p => p.element_type === posId);

      filtered.sort((a, b) => b.scoring.differentialScore - a.scoring.differentialScore);

      const posLabel = posId ? ` ${POSITION_NAMES[posId]}` : '';
      const title = `💎 Top Differential Picks${posLabel}`;
      ctx.replyWithHTML(fmt.rankingList(filtered, title, 15));
    } catch (err) {
      console.error('Error /differentials:', err.message);
      ctx.reply('❌ Gagal mengambil data.');
    }
  });

  // /fixtures <tim>
  bot.command('fixtures', async ctx => {
    const query = ctx.message.text.replace(/^\/fixtures\s*/i, '').trim();
    if (!query) return ctx.reply('Gunakan: /fixtures <nama tim>');

    try {
      const { scored, teams } = await getScoredPlayers();
      const q = query.toLowerCase();
      const team = Object.values(teams).find(t =>
        t.name.toLowerCase().includes(q) || t.short_name.toLowerCase() === q
      );
      if (!team) return ctx.reply(`❌ Tim "${query}" tidak ditemukan.`);

      const player = scored.find(p => p.team === team.id);
      if (!player || !player.nextFixtures?.length) {
        return ctx.reply(`Tidak ada fixture upcoming untuk ${team.name}.`);
      }

      ctx.replyWithHTML(fmt.fixtureTable(team.name, player.nextFixtures, teams));
    } catch (err) {
      console.error('Error /fixtures:', err.message);
      ctx.reply('❌ Gagal mengambil data.');
    }
  });

  // /regression
  bot.command('regression', async ctx => {
    try {
      const { scored } = await getScoredPlayers();
      const withRegression = scored
        .filter(p => p.scoring.regression && p.minutes >= 270)
        .sort((a, b) => Math.abs(b.scoring.regressionDiff) - Math.abs(a.scoring.regressionDiff));

      const over = withRegression.filter(p => p.scoring.regression === 'OVERPERFORMING');
      const under = withRegression.filter(p => p.scoring.regression === 'UNDERPERFORMING');

      const lines = ['<b>📊 Analisis Regresi (Goals vs xG)</b>\n'];

      lines.push('<b>⚠️ Overperforming (waspada regresi turun):</b>');
      over.slice(0, 8).forEach(p => {
        lines.push(`  • ${p.web_name}: Goals ${p.goals_scored} vs xG ${(parseFloat(p.expected_goals) || 0).toFixed(1)} (${p.scoring.regressionDiff > 0 ? '+' : ''}${p.scoring.regressionDiff})`);
      });

      lines.push('\n<b>💎 Underperforming (potensi regresi naik — beli murah):</b>');
      under.slice(0, 8).forEach(p => {
        lines.push(`  • ${p.web_name}: Goals ${p.goals_scored} vs xG ${(parseFloat(p.expected_goals) || 0).toFixed(1)} (${p.scoring.regressionDiff > 0 ? '+' : ''}${p.scoring.regressionDiff})`);
      });

      ctx.replyWithHTML(lines.join('\n'));
    } catch (err) {
      console.error('Error /regression:', err.message);
      ctx.reply('❌ Gagal mengambil data.');
    }
  });

  // /trending [in|out] — Transfer in/out terpopuler
  bot.command('trending', async ctx => {
    const arg = ctx.message.text.replace(/^\/trending\s*/i, '').trim().toLowerCase();

    try {
      const { scored, currentGw } = await getScoredPlayers();

      if (arg === 'out') {
        const transfersOut = [...scored]
          .filter(p => p.transfers_out_event > 0)
          .sort((a, b) => b.transfers_out_event - a.transfers_out_event);
        ctx.replyWithHTML(fmt.trendingOutCard(transfersOut, currentGw));
      } else {
        // Default: transfer in
        const transfersIn = [...scored]
          .filter(p => p.transfers_in_event > 0)
          .sort((a, b) => b.transfers_in_event - a.transfers_in_event);
        ctx.replyWithHTML(fmt.trendingCard(transfersIn, currentGw));

        // Jika tanpa argumen, kirim juga transfer out sebagai pesan kedua
        if (!arg) {
          const transfersOut = [...scored]
            .filter(p => p.transfers_out_event > 0)
            .sort((a, b) => b.transfers_out_event - a.transfers_out_event);
          ctx.replyWithHTML(fmt.trendingOutCard(transfersOut, currentGw));
        }
      }
    } catch (err) {
      console.error('Error /trending:', err.message);
      ctx.reply('❌ Gagal mengambil data.');
    }
  });

  // /nettransfer — Net transfer (gainers vs losers)
  bot.command('nettransfer', async ctx => {
    try {
      const { scored, currentGw } = await getScoredPlayers();
      ctx.replyWithHTML(fmt.netTransferCard(scored, currentGw));
    } catch (err) {
      console.error('Error /nettransfer:', err.message);
      ctx.reply('❌ Gagal mengambil data.');
    }
  });

  // /watch <nama>
  bot.command('watch', async ctx => {
    const query = ctx.message.text.replace(/^\/watch\s*/i, '').trim();
    if (!query) return ctx.reply('Gunakan: /watch <nama pemain>');

    try {
      const { scored } = await getScoredPlayers();
      const result = findPlayer(scored, query);

      if (!result || Array.isArray(result)) {
        return ctx.reply(`❌ Pemain "${query}" tidak ditemukan atau ambigu.`);
      }

      addToWatchlist(result.id, result.web_name);
      ctx.reply(`✅ ${result.web_name} ditambahkan ke watchlist.`);
    } catch (err) {
      console.error('Error /watch:', err.message);
      ctx.reply('❌ Gagal menambahkan.');
    }
  });

  // /unwatch <nama>
  bot.command('unwatch', async ctx => {
    const query = ctx.message.text.replace(/^\/unwatch\s*/i, '').trim();
    if (!query) return ctx.reply('Gunakan: /unwatch <nama pemain>');

    try {
      const { scored } = await getScoredPlayers();
      const result = findPlayer(scored, query);

      if (!result || Array.isArray(result)) {
        return ctx.reply(`❌ Pemain "${query}" tidak ditemukan atau ambigu.`);
      }

      removeFromWatchlist(result.id);
      ctx.reply(`✅ ${result.web_name} dihapus dari watchlist.`);
    } catch (err) {
      console.error('Error /unwatch:', err.message);
      ctx.reply('❌ Gagal menghapus.');
    }
  });

  // /watchlist
  bot.command('watchlist', async ctx => {
    try {
      const list = getWatchlist();
      if (list.length === 0) return ctx.reply('📋 Watchlist kosong. Gunakan /watch <nama> untuk menambahkan.');

      const { scored } = await getScoredPlayers();
      const lines = ['<b>📋 Watchlist</b>\n'];
      for (const w of list) {
        const p = scored.find(s => s.id === w.player_id);
        if (p) {
          lines.push(
            `• <b>${p.web_name}</b> (${p.teamData?.short_name || '?'}) — ` +
            `Q:${p.scoring.qualityScore} D:${p.scoring.differentialScore} | ` +
            `${fmt.priceStr(p.now_cost)} | ${p.scoring.label}`
          );
        } else {
          lines.push(`• ${w.player_name} (data tidak tersedia)`);
        }
      }
      ctx.replyWithHTML(lines.join('\n'));
    } catch (err) {
      console.error('Error /watchlist:', err.message);
      ctx.reply('❌ Gagal memuat watchlist.');
    }
  });

  // /squad [FPL ID]
  bot.command('squad', async ctx => {
    const input = ctx.message.text.replace(/^\/squad\s*/i, '').trim();
    const managerId = parseInt(input) || getUserFplId(ctx);
    if (!managerId || isNaN(managerId)) {
      return ctx.replyWithHTML(
        'FPL ID belum terdaftar.\n\n' +
        'Gunakan <code>/start [FPL ID]</code> untuk mendaftar.\n' +
        'Atau: <code>/squad [FPL ID]</code> untuk cek squad orang lain.'
      );
    }

    try {
      ctx.reply('⏳ Mengambil data squad...');
      const [manager, { scored, teams, currentGw }, transfers] = await Promise.all([
        fetchManagerInfo(managerId),
        getScoredPlayers(),
        fetchManagerTransfers(managerId),
      ]);

      // Tentukan GW yang sedang ditampilkan
      const { fetchBootstrap } = require('./fpl-api');
      const bootstrap = await fetchBootstrap();
      const nextGw = bootstrap.events.find(e => e.is_next)?.id || currentGw;

      let picks;
      let displayGw = currentGw;
      let isProjected = false;
      let isLive = false;

      // 1. Coba ambil live squad via my-team (jika ini FPL ID milik owner)
      const ownerFplId = parseInt(process.env.FPL_ID);
      if (managerId === ownerFplId && process.env.FPL_EMAIL) {
        try {
          const myTeam = await fetchMyTeam(managerId);
          if (myTeam?.picks) {
            picks = {
              picks: myTeam.picks,
              entry_history: null, // my-team tidak punya entry_history
            };
            displayGw = nextGw;
            isLive = true;
          }
        } catch (err) {
          console.error('my-team fallback:', err.message);
        }
      }

      // 2. Coba ambil picks: nextGw → currentGw → GW sebelumnya
      const gwsToTry = [];
      if (nextGw > currentGw) gwsToTry.push(nextGw);
      gwsToTry.push(currentGw);
      for (let gw = currentGw - 1; gw >= Math.max(1, currentGw - 3); gw--) {
        gwsToTry.push(gw);
      }

      for (const gw of gwsToTry) {
        if (picks) break;
        try {
          picks = await fetchManagerPicks(managerId, gw);
          displayGw = gw;
        } catch {
          // GW ini tidak tersedia, coba yang berikutnya
        }
      }

      if (!picks) {
        return ctx.reply('❌ Belum ada data squad. Pastikan kamu sudah set squad di aplikasi FPL.');
      }

      // 4. Terapkan transfer pending (jika bukan live data)
      if (!isLive) {
        const pendingTransfers = transfers.filter(t => t.event > displayGw);
        if (pendingTransfers.length > 0 && picks) {
          isProjected = true;
          const updatedPicks = [...picks.picks];
          for (const tr of pendingTransfers) {
            const idx = updatedPicks.findIndex(pk => pk.element === tr.element_out);
            if (idx !== -1) {
              updatedPicks[idx] = { ...updatedPicks[idx], element: tr.element_in };
            }
          }
          picks = { ...picks, picks: updatedPicks };
          displayGw = nextGw;
        }
      }

      let output = fmt.squadCard(manager, picks, scored, teams, displayGw);

      // Tambah info status data
      if (isLive) {
        output += `\n\n✅ <i>Data live — termasuk perubahan lineup & kapten terbaru.</i>`;
      } else if (isProjected) {
        output += `\n\n📌 <i>Squad diproyeksikan dari GW${currentGw} + transfer pending.`;
        output += `\nPerubahan lineup (bench/kapten) belum terlihat.</i>`;
      } else if (nextGw > displayGw) {
        output += `\n\n📌 <i>Menampilkan squad GW${displayGw} (terakhir dikonfirmasi).`;
        output += `\nPerubahan untuk GW${nextGw} terlihat setelah deadline.</i>`;
      }

      ctx.replyWithHTML(output);
    } catch (err) {
      console.error('Error /squad:', err.message);
      if (err.response?.status === 404) {
        return ctx.reply(`❌ FPL ID ${managerId} tidak ditemukan. Pastikan ID-nya benar.`);
      }
      ctx.reply('❌ Gagal mengambil data squad.');
    }
  });

  // /suggest [FPL ID]
  bot.command('suggest', async ctx => {
    const input = ctx.message.text.replace(/^\/suggest\s*/i, '').trim();
    const managerId = parseInt(input) || getUserFplId(ctx);
    if (!managerId || isNaN(managerId)) {
      return ctx.replyWithHTML(
        'FPL ID belum terdaftar.\n\n' +
        'Gunakan <code>/start [FPL ID]</code> untuk mendaftar.\n' +
        'Atau: <code>/suggest [FPL ID]</code>'
      );
    }

    try {
      ctx.reply('⏳ Menganalisa squad & mencari transfer terbaik...');
      const [manager, { scored, teams, currentGw }, transfers] = await Promise.all([
        fetchManagerInfo(managerId),
        getScoredPlayers(),
        fetchManagerTransfers(managerId),
      ]);

      const { fetchBootstrap } = require('./fpl-api');
      const bootstrap = await fetchBootstrap();
      const nextGw = bootstrap.events.find(e => e.is_next)?.id || currentGw;

      let picks;
      const gwsToTry = [];
      if (nextGw > currentGw) gwsToTry.push(nextGw);
      gwsToTry.push(currentGw);
      for (let gw = currentGw - 1; gw >= Math.max(1, currentGw - 3); gw--) {
        gwsToTry.push(gw);
      }
      for (const gw of gwsToTry) {
        if (picks) break;
        try { picks = await fetchManagerPicks(managerId, gw); } catch {}
      }
      if (!picks) {
        return ctx.reply('❌ Belum ada data squad. Pastikan kamu sudah set squad di aplikasi FPL.');
      }

      // Terapkan transfer pending
      const picksGw = picks.entry_history?.event || currentGw;
      const pendingTransfers = transfers.filter(t => t.event > picksGw);
      if (pendingTransfers.length > 0) {
        const updatedPicks = [...picks.picks];
        for (const tr of pendingTransfers) {
          const idx = updatedPicks.findIndex(pk => pk.element === tr.element_out);
          if (idx !== -1) {
            updatedPicks[idx] = { ...updatedPicks[idx], element: tr.element_in };
          }
        }
        picks = { ...picks, picks: updatedPicks };
      }

      const bank = (picks.entry_history?.bank || 0);
      const squadPlayerIds = picks.picks.map(pk => pk.element);
      const squadPlayers = squadPlayerIds.map(id => scored.find(p => p.id === id)).filter(Boolean);

      // Hitung jumlah pemain per tim di squad
      const teamCount = {};
      for (const p of squadPlayers) {
        teamCount[p.team] = (teamCount[p.team] || 0) + 1;
      }

      // Cari pemain terlemah per posisi (dari starting XI)
      const startingIds = new Set(picks.picks.filter(pk => pk.position <= 11).map(pk => pk.element));
      const startingPlayers = squadPlayers.filter(p => startingIds.has(p.id));

      const suggestions = [];

      // Sort starting players by quality score (worst first)
      const weakest = [...startingPlayers].sort((a, b) => a.scoring.qualityScore - b.scoring.qualityScore);

      for (const out of weakest.slice(0, 5)) {
        // Selling price = beli price (simplified, FPL API doesn't expose selling price directly)
        const budget = out.now_cost + bank;

        // Cari pengganti terbaik
        const candidates = scored.filter(p =>
          p.element_type === out.element_type &&   // posisi sama
          p.id !== out.id &&                        // bukan pemain yang sama
          !squadPlayerIds.includes(p.id) &&         // belum di squad
          p.now_cost <= budget &&                   // masuk budget
          p.minutes > 0 &&                          // pernah main
          p.scoring.minutesSafe &&                  // aman menit
          (teamCount[p.team] || 0) < 3 &&           // max 3 per tim
          p.scoring.qualityScore > out.scoring.qualityScore // harus lebih baik
        );

        // Sort: prioritaskan pemain dengan trend bagus + quality score tinggi
        candidates.sort((a, b) => {
          // Bonus skor untuk trend IMPROVING, penalti untuk DECLINING
          const trendBonus = (p) => {
            if (!p.scoring.trendData) return 0;
            if (p.scoring.trendData.trendLabel === 'IMPROVING') return 5;
            if (p.scoring.trendData.trendLabel === 'DECLINING') return -5;
            return 0;
          };
          const aScore = a.scoring.qualityScore + trendBonus(a);
          const bScore = b.scoring.qualityScore + trendBonus(b);
          return bScore - aScore;
        });
        const best = candidates[0];
        if (!best) continue;

        const scoreDiff = best.scoring.qualityScore - out.scoring.qualityScore;
        if (scoreDiff < 5) continue; // minimal peningkatan signifikan

        // Buat alasan
        const reasons = [];
        if (best.scoring.components.fixture > out.scoring.components.fixture + 0.1) {
          reasons.push('fixture lebih mudah');
        }
        if (parseFloat(best.form) > parseFloat(out.form)) {
          reasons.push('form lebih baik');
        }
        if (best.scoring.label === 'DIFFERENTIAL') {
          reasons.push('differential pick');
        }
        if (!out.scoring.minutesSafe) {
          reasons.push(`${out.web_name} risiko rotasi`);
        }
        // Regression — termasuk label historis baru
        if (out.scoring.regression === 'OVERPERFORMING') {
          reasons.push(`${out.web_name} overperforming`);
        }
        if (best.scoring.regression === 'UNDERPERFORMING') {
          reasons.push(`${best.web_name} potensi regresi naik`);
        }
        if (best.scoring.regression === 'CLINICAL_FINISHER') {
          reasons.push(`${best.web_name} clinical finisher (multi-musim)`);
        }
        // Trend historis
        if (best.scoring.trendData?.trendLabel === 'IMPROVING') {
          reasons.push(`${best.web_name} tren naik ${best.scoring.trendData.seasonsCount} musim`);
        }
        if (out.scoring.trendData?.trendLabel === 'DECLINING') {
          reasons.push(`${out.web_name} tren menurun`);
        }
        if (best.scoring.trendData?.consistency >= 80) {
          reasons.push(`${best.web_name} sangat konsisten`);
        }
        if (out.scoring.regression === 'POOR_FINISHER') {
          reasons.push(`${out.web_name} poor finisher (multi-musim)`);
        }

        // Trend info untuk tampilan
        const outTrend = out.scoring.trendData;
        const inTrend = best.scoring.trendData;

        suggestions.push({
          out: {
            web_name: out.web_name,
            teamShort: out.teamData?.short_name || '?',
            qualityScore: out.scoring.qualityScore,
            nowCost: out.now_cost,
            trendLabel: outTrend?.trendLabel || null,
            trendScore: outTrend?.trendScore || null,
            consistency: outTrend?.consistency || null,
          },
          in: {
            web_name: best.web_name,
            teamShort: best.teamData?.short_name || '?',
            qualityScore: best.scoring.qualityScore,
            nowCost: best.now_cost,
            trendLabel: inTrend?.trendLabel || null,
            trendScore: inTrend?.trendScore || null,
            consistency: inTrend?.consistency || null,
          },
          scoreDiff,
          costDiff: out.now_cost - best.now_cost,
          reason: reasons.length > 0 ? reasons.join(', ') : 'quality score jauh lebih tinggi',
        });
      }

      // Sort by score improvement, take top 3
      suggestions.sort((a, b) => b.scoreDiff - a.scoreDiff);
      const top = suggestions.slice(0, 3);

      // Kumpulkan nama pemain yang relevan untuk cek berita
      const relevantNames = [];
      for (const s of top) {
        relevantNames.push(s.out.web_name, s.in.web_name);
      }
      // Tambah semua pemain squad juga
      for (const p of squadPlayers) {
        if (!relevantNames.includes(p.web_name)) {
          relevantNames.push(p.web_name);
        }
      }

      // Fetch berita terkait pemain
      let newsSection = '';
      try {
        const intel = await fetchNewsIntel(relevantNames);
        newsSection = formatNewsIntel(intel);
      } catch (err) {
        console.error('News intel error:', err.message);
      }

      const header = `<b>👤 ${manager.player_first_name} ${manager.player_last_name}</b> — ${manager.name}\n💰 Bank: £${(bank / 10).toFixed(1)}m\n\n`;
      ctx.replyWithHTML(header + fmt.transferSuggestions(top) + newsSection, { disable_web_page_preview: true });
    } catch (err) {
      console.error('Error /suggest:', err.message);
      if (err.response?.status === 404) {
        return ctx.reply(`❌ FPL ID ${managerId} tidak ditemukan.`);
      }
      ctx.reply('❌ Gagal menganalisa squad.');
    }
  });

  // /news [platform] [akun]
  bot.command('news', async ctx => {
    const args = ctx.message.text.replace(/^\/news\s*/i, '').trim();

    try {
      // Parse: /news, /news x, /news ig, /news x FPLStatus, /news ig officialfpl, /news FPLStatus
      const parts = args.split(/\s+/);
      const firstArg = parts[0]?.toLowerCase();
      let platform = null;
      let query = null;

      if (['x', 'twitter'].includes(firstArg)) {
        platform = 'x';
        query = parts.slice(1).join(' ') || null;
      } else if (['ig', 'instagram', 'insta'].includes(firstArg)) {
        platform = 'ig';
        query = parts.slice(1).join(' ') || null;
      } else if (firstArg) {
        query = args;
      }

      ctx.reply(`⏳ Mengambil berita${platform ? ` dari ${platform === 'x' ? 'X' : 'Instagram'}` : ''}...`);

      if (query) {
        const result = await fetchAccountNews(query, platform);
        // IG dengan gambar
        if (result && result.platform === 'IG' && result.posts.length > 0) {
          await sendIgPostsWithImages(ctx, [result]);
        } else {
          ctx.replyWithHTML(formatSingleAccount(result), { disable_web_page_preview: true });
        }
      } else if (platform === 'x') {
        const results = await fetchAllFplNews();
        ctx.replyWithHTML(formatNews(results), { disable_web_page_preview: true });
      } else if (platform === 'ig') {
        const results = await fetchAllInstagramNews();
        if (results.length > 0) {
          await sendIgPostsWithImages(ctx, results);
        } else {
          ctx.reply('❌ Tidak bisa mengambil berita Instagram saat ini.');
        }
      } else {
        // Semua platform — X sebagai text, IG dengan gambar
        const [xResults, igResults] = await Promise.all([
          fetchAllFplNews(),
          fetchAllInstagramNews(),
        ]);
        if (xResults.length > 0) {
          ctx.replyWithHTML(formatNews(xResults), { disable_web_page_preview: true });
        }
        if (igResults.length > 0) {
          await sendIgPostsWithImages(ctx, igResults);
        }
        if (xResults.length === 0 && igResults.length === 0) {
          ctx.reply('❌ Tidak bisa mengambil berita saat ini. Coba lagi nanti.');
        }
      }
    } catch (err) {
      console.error('Error /news:', err.message);
      ctx.reply('❌ Gagal mengambil berita. Coba lagi nanti.');
    }
  });

  // /newslist — Lihat daftar akun sumber berita
  // /newslist — Lihat daftar akun sumber berita (semua user)
  bot.command('newslist', ctx => {
    const xAccounts = getAccountsX();
    const igAccounts = getAccountsIG();

    const lines = ['<b>📰 Daftar Akun Sumber Berita</b>\n'];

    lines.push('<b>🐦 X/Twitter:</b>');
    if (xAccounts.length === 0) {
      lines.push('  <i>Belum ada akun</i>');
    } else {
      xAccounts.forEach((a, i) => lines.push(`  ${i + 1}. ${a.username}`));
    }

    lines.push('\n<b>📸 Instagram:</b>');
    if (igAccounts.length === 0) {
      lines.push('  <i>Belum ada akun</i>');
    } else {
      igAccounts.forEach((a, i) => lines.push(`  ${i + 1}. ${a.username}`));
    }

    if (isOwner(ctx)) {
      lines.push('\n<b>⚙️ Kelola Akun (Owner):</b>');
      lines.push('/xadd &lt;username&gt; — Tambah akun X');
      lines.push('/xdel &lt;username&gt; — Hapus akun X');
      lines.push('/igadd &lt;username&gt; — Tambah akun IG');
      lines.push('/igdel &lt;username&gt; — Hapus akun IG');
    }

    ctx.replyWithHTML(lines.join('\n'));
  });

  // --- Helper: update akun di env & .env file ---
  function updateAccountEnv(key, accounts) {
    const value = accounts.join(',');
    process.env[key] = value;
    // Persist ke .env file
    try {
      const fs = require('fs');
      const path = require('path');
      const envPath = path.join(__dirname, '..', '.env');
      if (fs.existsSync(envPath)) {
        let content = fs.readFileSync(envPath, 'utf-8');
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(content)) {
          content = content.replace(regex, `${key}=${value}`);
        } else {
          content = content.trimEnd() + `\n${key}=${value}\n`;
        }
        fs.writeFileSync(envPath, content, 'utf-8');
      }
    } catch (err) {
      console.error('Error saving .env:', err.message);
    }
  }

  function getCurrentUsernames(envKey, getterFn) {
    return getterFn().map(a => a.username);
  }

  // /xadd <username> — Tambah akun X (owner only)
  bot.command('xadd', ctx => {
    if (!isOwner(ctx)) return ctx.reply('🚫 Hanya pemilik bot.');
    const username = ctx.message.text.replace(/^\/xadd\s*/i, '').trim().replace(/^@/, '');
    if (!username) return ctx.reply('Gunakan: /xadd <username>');

    const current = getCurrentUsernames('X_ACCOUNTS', getAccountsX);
    if (current.map(u => u.toLowerCase()).includes(username.toLowerCase())) {
      return ctx.reply(`⚠️ ${username} sudah ada di daftar X.`);
    }
    current.push(username);
    updateAccountEnv('X_ACCOUNTS', current);
    ctx.replyWithHTML(`✅ <b>${username}</b> ditambahkan ke sumber X.\n\nTotal: ${current.length} akun`);
  });

  // /xdel <username> — Hapus akun X (owner only)
  bot.command('xdel', ctx => {
    if (!isOwner(ctx)) return ctx.reply('🚫 Hanya pemilik bot.');
    const username = ctx.message.text.replace(/^\/xdel\s*/i, '').trim().replace(/^@/, '');
    if (!username) return ctx.reply('Gunakan: /xdel <username>');

    const current = getCurrentUsernames('X_ACCOUNTS', getAccountsX);
    const idx = current.findIndex(u => u.toLowerCase() === username.toLowerCase());
    if (idx === -1) return ctx.reply(`❌ ${username} tidak ada di daftar X.`);

    const removed = current.splice(idx, 1)[0];
    updateAccountEnv('X_ACCOUNTS', current);
    ctx.replyWithHTML(`✅ <b>${removed}</b> dihapus dari sumber X.\n\nSisa: ${current.length} akun`);
  });

  // /igadd <username> — Tambah akun IG (owner only)
  bot.command('igadd', ctx => {
    if (!isOwner(ctx)) return ctx.reply('🚫 Hanya pemilik bot.');
    const username = ctx.message.text.replace(/^\/igadd\s*/i, '').trim().replace(/^@/, '');
    if (!username) return ctx.reply('Gunakan: /igadd <username>');

    const current = getCurrentUsernames('IG_ACCOUNTS', getAccountsIG);
    if (current.map(u => u.toLowerCase()).includes(username.toLowerCase())) {
      return ctx.reply(`⚠️ ${username} sudah ada di daftar IG.`);
    }
    current.push(username);
    updateAccountEnv('IG_ACCOUNTS', current);
    ctx.replyWithHTML(`✅ <b>${username}</b> ditambahkan ke sumber IG.\n\nTotal: ${current.length} akun`);
  });

  // /igdel <username> — Hapus akun IG (owner only)
  bot.command('igdel', ctx => {
    if (!isOwner(ctx)) return ctx.reply('🚫 Hanya pemilik bot.');
    const username = ctx.message.text.replace(/^\/igdel\s*/i, '').trim().replace(/^@/, '');
    if (!username) return ctx.reply('Gunakan: /igdel <username>');

    const current = getCurrentUsernames('IG_ACCOUNTS', getAccountsIG);
    const idx = current.findIndex(u => u.toLowerCase() === username.toLowerCase());
    if (idx === -1) return ctx.reply(`❌ ${username} tidak ada di daftar IG.`);

    const removed = current.splice(idx, 1)[0];
    updateAccountEnv('IG_ACCOUNTS', current);
    ctx.replyWithHTML(`✅ <b>${removed}</b> dihapus dari sumber IG.\n\nSisa: ${current.length} akun`);
  });

  // /metrics — lihat dan kelola metrik scoring
  bot.command('metrics', async ctx => {
    const args = ctx.message.text.replace(/^\/metrics\s*/i, '').trim();
    const parts = args.split(/\s+/);
    const action = parts[0]?.toLowerCase();

    // /metrics — tampilkan konfigurasi saat ini
    if (!action) {
      const active = getActiveMetrics();
      const weights = getPositionWeights();
      const lines = ['<b>⚙️ Konfigurasi Metrik Scoring</b>\n'];

      for (const metric of ALL_METRICS) {
        const isOn = active.includes(metric);
        const icon = isOn ? '✅' : '❌';
        lines.push(`${icon} <b>${metric.toUpperCase()}</b> — ${METRIC_LABELS[metric]}`);
        if (isOn) {
          const w = [1, 2, 3, 4].map(pos =>
            `${POSITION_NAMES[pos]}:${Math.round(weights[pos][metric] * 100)}%`
          ).join(' · ');
          lines.push(`      ${w}`);
        }
        lines.push('');
      }

      lines.push('<b>Perintah:</b>');
      lines.push('<code>/metrics on &lt;metric&gt;</code> — Aktifkan metrik');
      lines.push('<code>/metrics off &lt;metric&gt;</code> — Nonaktifkan metrik');
      lines.push('<code>/metrics weight &lt;metric&gt; &lt;GK&gt; &lt;DEF&gt; &lt;MID&gt; &lt;FWD&gt;</code>');
      lines.push('<code>/metrics reset</code> — Reset ke default');
      lines.push('\n<i>Metrik: xgi, form, fixture, minutes, value, def</i>');

      return ctx.replyWithHTML(lines.join('\n'));
    }

    // /metrics on <metric>
    if (action === 'on') {
      const metric = parts[1]?.toLowerCase();
      if (!metric || !ALL_METRICS.includes(metric)) {
        return ctx.reply(`❌ Metrik tidak valid. Pilih: ${ALL_METRICS.join(', ')}`);
      }
      const active = getActiveMetrics();
      if (active.includes(metric)) return ctx.reply(`✅ ${metric.toUpperCase()} sudah aktif.`);
      active.push(metric);
      process.env.METRICS_ACTIVE = active.join(',');
      cachedScored = null; cacheTs = 0;
      return ctx.reply(`✅ ${metric.toUpperCase()} diaktifkan. Data akan di-recalculate.`);
    }

    // /metrics off <metric>
    if (action === 'off') {
      const metric = parts[1]?.toLowerCase();
      if (!metric || !ALL_METRICS.includes(metric)) {
        return ctx.reply(`❌ Metrik tidak valid. Pilih: ${ALL_METRICS.join(', ')}`);
      }
      const active = getActiveMetrics().filter(m => m !== metric);
      if (active.length === 0) return ctx.reply('❌ Tidak bisa menonaktifkan semua metrik.');
      process.env.METRICS_ACTIVE = active.join(',');
      cachedScored = null; cacheTs = 0;
      return ctx.reply(`❌ ${metric.toUpperCase()} dinonaktifkan. Data akan di-recalculate.`);
    }

    // /metrics weight <metric> <GK> <DEF> <MID> <FWD>
    if (action === 'weight') {
      const metric = parts[1]?.toLowerCase();
      if (!metric || !ALL_METRICS.includes(metric)) {
        return ctx.reply(`❌ Metrik tidak valid. Pilih: ${ALL_METRICS.join(', ')}`);
      }
      if (parts.length < 6) {
        return ctx.replyWithHTML(
          `<b>Format:</b> <code>/metrics weight ${metric} GK DEF MID FWD</code>\n\n` +
          `Contoh: <code>/metrics weight xgi 5 15 32 38</code>\n` +
          `<i>Nilai dalam persen (0-100). Akan di-normalize otomatis.</i>`
        );
      }
      const vals = parts.slice(2, 6).map(Number);
      if (vals.some(isNaN)) return ctx.reply('❌ Semua nilai harus angka.');

      // Update env
      const currentWeights = process.env.METRICS_WEIGHTS || '';
      const entries = currentWeights ? currentWeights.split(',').filter(e => !e.startsWith(metric + ':')) : [];
      entries.push(`${metric}:${vals.join(':')}`);
      process.env.METRICS_WEIGHTS = entries.join(',');
      cachedScored = null; cacheTs = 0;

      return ctx.replyWithHTML(
        `✅ <b>${metric.toUpperCase()}</b> weights updated:\n` +
        `GK:${vals[0]}% · DEF:${vals[1]}% · MID:${vals[2]}% · FWD:${vals[3]}%\n\n` +
        `<i>Data akan di-recalculate otomatis.</i>`
      );
    }

    // /metrics reset
    if (action === 'reset') {
      delete process.env.METRICS_ACTIVE;
      delete process.env.METRICS_WEIGHTS;
      cachedScored = null; cacheTs = 0;
      return ctx.reply('✅ Metrik di-reset ke default. Data akan di-recalculate.');
    }

    ctx.reply('❓ Perintah tidak dikenal. Ketik /metrics untuk lihat opsi.');
  });

  // /analyze <nama> — Analisa mendalam pemain
  bot.command('analyze', async ctx => {
    const query = ctx.message.text.replace(/^\/analyze\s*/i, '').trim();
    if (!query) return ctx.reply('Gunakan: /analyze <nama pemain>');

    try {
      const { scored, teams, currentGw } = await getScoredPlayers();
      const result = findPlayer(scored, query);

      if (!result) return ctx.reply(`❌ Pemain "${query}" tidak ditemukan.`);
      if (Array.isArray(result)) {
        const names = result.slice(0, 10).map(p => `• ${p.web_name} (${p.teamData?.short_name || '?'})`);
        return ctx.replyWithHTML(`Ditemukan ${result.length} pemain:\n${names.join('\n')}\n\nCoba lebih spesifik.`);
      }

      ctx.replyWithHTML(fmt.analyzeCard(result, currentGw));
    } catch (err) {
      console.error('Error /analyze:', err.message);
      ctx.reply('❌ Gagal mengambil data.');
    }
  });

  // /history <nama> — Lihat data historis pemain 3 musim
  bot.command('history', async ctx => {
    const query = ctx.message.text.replace(/^\/history\s*/i, '').trim();
    if (!query) return ctx.reply('Gunakan: /history <nama pemain>');

    try {
      if (!hasHistoricalData()) {
        ctx.reply('⏳ Mengunduh data historis 3 musim... (pertama kali)');
        await refreshHistoricalData();
      }

      const { scored } = await getScoredPlayers();
      const result = findPlayer(scored, query);

      if (!result) return ctx.reply(`❌ Pemain "${query}" tidak ditemukan.`);
      if (Array.isArray(result)) {
        const names = result.slice(0, 10).map(p => `• ${p.web_name} (${p.teamData?.short_name || '?'})`);
        return ctx.replyWithHTML(`Ditemukan ${result.length} pemain:\n${names.join('\n')}\n\nCoba lebih spesifik.`);
      }

      const playerKey = makePlayerKey(result.first_name, result.second_name);
      const trend = analyzePlayerTrend(playerKey);

      ctx.replyWithHTML(fmt.historyCard(result, trend));
    } catch (err) {
      console.error('Error /history:', err.message);
      ctx.reply('❌ Gagal mengambil data historis.');
    }
  });

  // /users — Dashboard user lengkap (owner only)
  bot.command('users', ctx => {
    if (!isOwner(ctx)) return ctx.reply('🚫 Hanya pemilik bot (@Abulkhaer).');

    const args = ctx.message.text.replace(/^\/users\s*/i, '').trim();

    // /users <chat_id> — Detail user tertentu
    if (args) {
      const targetId = args;
      const user = getUser(targetId);
      if (!user) return ctx.reply(`❌ User dengan ID ${targetId} tidak ditemukan.`);

      const activity = getUserActivity(targetId, 20);
      const lines = [
        `<b>👤 Detail User</b>\n`,
        `🆔 Chat ID: <code>${user.chat_id}</code>`,
        `📋 Nama: <b>${user.first_name || '-'}${user.last_name ? ' ' + user.last_name : ''}</b>`,
        `🏷 Username: ${user.username ? '@' + user.username : '(tidak ada)'}`,
        `🌐 Bahasa: ${user.language_code || '-'}`,
        `⚽ FPL ID: <code>${user.fpl_id}</code>`,
        `📅 Terdaftar: ${user.registered_at}`,
        `🕐 Terakhir aktif: ${user.last_seen}`,
        `📊 Total perintah: ${user.command_count}`,
        `🔄 Perintah terakhir: /${user.last_command || '-'}`,
        ``,
      ];

      if (activity.length > 0) {
        lines.push('<b>📜 Aktivitas Terakhir:</b>');
        activity.forEach(a => {
          const time = a.timestamp.split(' ')[1] || a.timestamp;
          const date = a.timestamp.split(' ')[0] || '';
          lines.push(`  ${date} ${time} — /${a.command}${a.args ? ' ' + a.args.substring(0, 30) : ''}`);
        });
      }

      lines.push('\n<b>Aksi:</b>');
      lines.push(`<code>/removeuser ${user.chat_id}</code> — Hapus user ini`);

      return ctx.replyWithHTML(lines.join('\n'));
    }

    // /users — Dashboard overview
    const users = getAllUsers();
    const stats = getUserStats();

    const lines = [
      `<b>👥 DASHBOARD USER</b>`,
      ``,
      `<b>📊 Statistik:</b>`,
      `  Total user: <b>${stats.totalUsers}</b>`,
      `  Aktif hari ini: <b>${stats.activeToday}</b>`,
      `  Aktif 7 hari: <b>${stats.activeWeek}</b>`,
      `  Total perintah: <b>${stats.totalCommands}</b>`,
      ``,
    ];

    if (stats.topCommands.length > 0) {
      lines.push('<b>🔥 Perintah Terpopuler:</b>');
      stats.topCommands.forEach(c => {
        lines.push(`  /${c.command} — ${c.cnt}x`);
      });
      lines.push('');
    }

    if (users.length > 0) {
      lines.push('<b>👤 Daftar User:</b>');
      lines.push('');
      users.forEach((u, i) => {
        const isActive = u.last_seen && new Date(u.last_seen + 'Z') > new Date(Date.now() - 86400000);
        const dot = isActive ? '🟢' : '⚪';
        lines.push(
          `${dot} ${i + 1}. <b>${u.first_name || 'Unknown'}${u.last_name ? ' ' + u.last_name : ''}</b>` +
          `${u.username ? ' (@' + u.username + ')' : ''}`
        );
        lines.push(
          `      FPL: <code>${u.fpl_id}</code> · Cmd: ${u.command_count} · Last: ${u.last_seen?.split(' ')[0] || '-'}`
        );
      });
      lines.push('');
      lines.push('<i>💡 Ketik /users [chat_id] untuk detail user</i>');
    } else {
      lines.push('<i>Belum ada user terdaftar.</i>');
    }

    ctx.replyWithHTML(lines.join('\n'));
  });

  // /removeuser <chat_id> — Hapus user (owner only)
  bot.command('removeuser', ctx => {
    if (!isOwner(ctx)) return ctx.reply('🚫 Hanya pemilik bot.');

    const targetId = ctx.message.text.replace(/^\/removeuser\s*/i, '').trim();
    if (!targetId) return ctx.reply('Gunakan: /removeuser <chat_id>');

    if (targetId === OWNER_ID) return ctx.reply('❌ Tidak bisa menghapus pemilik bot.');

    const user = getUser(targetId);
    if (!user) return ctx.reply(`❌ User ${targetId} tidak ditemukan.`);

    deleteUser(targetId);
    ctx.replyWithHTML(
      `✅ User <b>${user.first_name || 'Unknown'}</b> (${user.chat_id}) berhasil dihapus.\n` +
      `Data aktivitas juga dihapus.`
    );
  });

  // /refreshhistory — Force refresh data historis
  bot.command('refreshhistory', async ctx => {
    try {
      ctx.reply('⏳ Mengunduh ulang data historis 3 musim...');
      const results = await refreshHistoricalData();
      const lines = ['✅ Data historis berhasil diperbarui:\n'];
      for (const [season, count] of Object.entries(results)) {
        lines.push(`  ${season}: ${count} pemain`);
      }
      cachedScored = null; cacheTs = 0;
      lines.push('\n💡 Quality score semua pemain akan di-recalculate.');
      ctx.reply(lines.join('\n'));
    } catch (err) {
      console.error('Error /refreshhistory:', err.message);
      ctx.reply('❌ Gagal refresh data historis.');
    }
  });

  // /refresh
  bot.command('refresh', async ctx => {
    try {
      cachedScored = null;
      cacheTs = 0;
      require('./fpl-api').clearCache();
      await getScoredPlayers();
      ctx.reply('✅ Data di-refresh dari FPL API.\n💡 Untuk refresh data historis: /refreshhistory');
    } catch (err) {
      console.error('Error /refresh:', err.message);
      ctx.reply('❌ Gagal refresh data.');
    }
  });
}

module.exports = { registerCommands, getScoredPlayers };
