const { fetchAll, fetchManagerInfo, fetchManagerPicks } = require('./fpl-api');
const { scoreAllPlayers } = require('./scoring');
const { addToWatchlist, removeFromWatchlist, getWatchlist } = require('./database');
const { POSITION_NAMES } = require('./config');
const fmt = require('./format');
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

function registerCommands(bot) {

  // /start
  bot.command('start', ctx => {
    ctx.replyWithHTML([
      '<b>⚽ FPL Differential Bot</b>',
      '',
      'Bot analisa pemain FPL dengan fokus differential pick.',
      '',
      '<b>📊 Analisa Pemain:</b>',
      '/player &lt;nama&gt; — Detail pemain',
      '/compare &lt;A&gt; vs &lt;B&gt; — Bandingkan 2 pemain',
      '/best &lt;posisi&gt; — Top pemain per posisi',
      '/differentials [posisi] — Top differential picks',
      '/regression — Pemain over/underperform vs xG',
      '',
      '<b>👤 Squad & Transfer:</b>',
      '/squad &lt;FPL ID&gt; — Lihat squad lengkap',
      '/suggest &lt;FPL ID&gt; — Saran transfer terbaik',
      '/trending — Transfer in/out terpopuler',
      '/nettransfer — Net transfer (gainers vs losers)',
      '',
      '<b>📰 Info & Berita:</b>',
      '/news — Semua berita (X + IG)',
      '/news x — Semua berita dari X',
      '/news ig — Semua berita dari Instagram',
      '/news x &lt;username&gt; — Berita akun X tertentu',
      '/news ig &lt;username&gt; — Berita akun IG tertentu',
      '/newslist — Daftar akun sumber berita',
      '/fixtures &lt;tim&gt; — Jadwal & FDR',
      '',
      '<i>Contoh: /news x OfficialFPL</i>',
      '<i>Contoh: /news ig premierleague</i>',
      '<i>Username tanpa @, cukup nama akunnya saja</i>',
      '',
      '<b>📋 Watchlist:</b>',
      '/watch &lt;nama&gt; — Tambah ke watchlist',
      '/unwatch &lt;nama&gt; — Hapus dari watchlist',
      '/watchlist — Lihat watchlist',
      '',
      '<b>⚙️ Admin:</b>',
      '/setenv &lt;KEY&gt; &lt;VALUE&gt; — Update config',
      '/getenv — Lihat config saat ini',
      '/delenv &lt;KEY&gt; — Hapus config',
      '/restart — Restart bot',
      '/myid — Lihat Chat ID kamu',
      '/refresh — Refresh data dari API',
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

  // /trending — Transfer in/out terpopuler
  bot.command('trending', async ctx => {
    try {
      const { scored, currentGw } = await getScoredPlayers();

      const transfersIn = [...scored]
        .filter(p => p.transfers_in_event > 0)
        .sort((a, b) => b.transfers_in_event - a.transfers_in_event);

      const transfersOut = [...scored]
        .filter(p => p.transfers_out_event > 0)
        .sort((a, b) => b.transfers_out_event - a.transfers_out_event);

      ctx.replyWithHTML(fmt.trendingCard(transfersIn, transfersOut, currentGw));
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
    const managerId = parseInt(input) || parseInt(process.env.FPL_ID);
    if (!managerId || isNaN(managerId)) {
      return ctx.replyWithHTML(
        'Gunakan: /squad &lt;FPL ID&gt;\n\n' +
        'Atau set default: <code>/setenv FPL_ID 1234567</code>\n\n' +
        '<b>Cara cari FPL ID:</b>\n' +
        '1. Buka fantasy.premierleague.com\n' +
        '2. Klik "My Team" atau "Points"\n' +
        '3. Lihat angka di URL: /entry/<b>XXXXX</b>/event/...'
      );
    }

    try {
      ctx.reply('⏳ Mengambil data squad...');
      const [manager, { scored, teams, currentGw }] = await Promise.all([
        fetchManagerInfo(managerId),
        getScoredPlayers(),
      ]);

      // Coba ambil picks GW terkini, fallback ke GW sebelumnya
      let picks;
      try {
        picks = await fetchManagerPicks(managerId, currentGw);
      } catch {
        if (currentGw > 1) {
          picks = await fetchManagerPicks(managerId, currentGw - 1);
        } else {
          return ctx.reply('❌ Belum ada data squad untuk musim ini.');
        }
      }

      ctx.replyWithHTML(fmt.squadCard(manager, picks, scored, teams, currentGw));
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
    const managerId = parseInt(input) || parseInt(process.env.FPL_ID);
    if (!managerId || isNaN(managerId)) {
      return ctx.replyWithHTML(
        'Gunakan: /suggest &lt;FPL ID&gt;\n\n' +
        'Atau set default: <code>/setenv FPL_ID 1234567</code>\n\n' +
        'Bot akan analisa squad kamu dan sarankan transfer terbaik.'
      );
    }

    try {
      ctx.reply('⏳ Menganalisa squad & mencari transfer terbaik...');
      const [manager, { scored, teams, currentGw }] = await Promise.all([
        fetchManagerInfo(managerId),
        getScoredPlayers(),
      ]);

      let picks;
      try {
        picks = await fetchManagerPicks(managerId, currentGw);
      } catch {
        if (currentGw > 1) {
          picks = await fetchManagerPicks(managerId, currentGw - 1);
        } else {
          return ctx.reply('❌ Belum ada data squad.');
        }
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

        candidates.sort((a, b) => b.scoring.qualityScore - a.scoring.qualityScore);
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
        if (out.scoring.regression === 'OVERPERFORMING') {
          reasons.push(`${out.web_name} overperforming`);
        }
        if (best.scoring.regression === 'UNDERPERFORMING') {
          reasons.push(`${best.web_name} potensi regresi naik`);
        }

        suggestions.push({
          out: {
            web_name: out.web_name,
            teamShort: out.teamData?.short_name || '?',
            qualityScore: out.scoring.qualityScore,
            nowCost: out.now_cost,
          },
          in: {
            web_name: best.web_name,
            teamShort: best.teamData?.short_name || '?',
            qualityScore: best.scoring.qualityScore,
            nowCost: best.now_cost,
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
  bot.command('newslist', ctx => {
    const lines = ['<b>📰 Daftar Akun Sumber Berita</b>\n'];

    lines.push('<b>🐦 X/Twitter:</b>');
    if (getAccountsX().length === 0) {
      lines.push('  <i>Belum ada akun</i>');
    } else {
      getAccountsX().forEach(a => lines.push(`  • ${a.username}`));
    }

    lines.push('\n<b>📸 Instagram:</b>');
    if (getAccountsIG().length === 0) {
      lines.push('  <i>Belum ada akun</i>');
    } else {
      getAccountsIG().forEach(a => lines.push(`  • ${a.username}`));
    }

    lines.push('\n<b>Cara edit akun:</b>');
    lines.push('<code>/setenv X_ACCOUNTS OfficialFPL,FPLStatus,BenCrellin</code>');
    lines.push('<code>/setenv IG_ACCOUNTS officialfpl,premierleague</code>');
    lines.push('\n<i>Username tanpa @, pisahkan dengan koma</i>');

    ctx.replyWithHTML(lines.join('\n'));
  });

  // /refresh
  bot.command('refresh', async ctx => {
    try {
      cachedScored = null;
      cacheTs = 0;
      require('./fpl-api').clearCache();
      await getScoredPlayers();
      ctx.reply('✅ Data di-refresh dari FPL API.');
    } catch (err) {
      console.error('Error /refresh:', err.message);
      ctx.reply('❌ Gagal refresh data.');
    }
  });
}

module.exports = { registerCommands, getScoredPlayers };
