const cron = require('node-cron');
const { fetchAll } = require('./fpl-api');
const { scoreAllPlayers } = require('./scoring');
const { saveSnapshot, getPreviousSnapshot, getWatchlist } = require('./database');
const fmt = require('./format');

function startScheduler(bot, chatId) {
  if (!chatId) {
    console.log('⚠️ CHAT_ID tidak di-set, scheduler dinonaktifkan.');
    return;
  }

  const send = (text) => {
    if (text) bot.telegram.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch(console.error);
  };

  // Cek perubahan harga & status — setiap hari jam 08:00 WIB (01:00 UTC)
  cron.schedule('0 1 * * *', async () => {
    console.log('[Cron] Checking price & status changes...');
    try {
      const data = await fetchAll();
      const today = new Date().toISOString().slice(0, 10);

      // Simpan snapshot hari ini
      saveSnapshot(data.players, today);

      // Bandingkan dengan snapshot sebelumnya
      const prev = getPreviousSnapshot(today);
      if (prev.length === 0) {
        console.log('[Cron] No previous snapshot for comparison.');
        return;
      }

      const prevMap = {};
      for (const s of prev) prevMap[s.player_id] = s;

      const priceChanges = [];
      const statusChanges = [];

      // Track new players added to watchlist
      const watchIds = new Set(getWatchlist().map(w => w.player_id));

      for (const p of data.players) {
        const old = prevMap[p.id];
        if (!old) {
          // New player — only notify if watched
          if (watchIds.has(p.id) && p.status !== 'a') {
            statusChanges.push({
              name: p.web_name,
              oldStatus: 'a',
              newStatus: p.status,
              chance: p.chance_of_playing_next_round,
            });
          }
          continue;
        }

        // Price change
        if (p.now_cost !== old.now_cost) {
          priceChanges.push({
            name: p.web_name,
            oldPrice: old.now_cost,
            newPrice: p.now_cost,
            diff: p.now_cost - old.now_cost,
          });
        }

        // Status change
        if (p.status !== old.status) {
          statusChanges.push({
            name: p.web_name,
            oldStatus: old.status,
            newStatus: p.status,
            chance: p.chance_of_playing_next_round,
          });
        }
      }

      // Filter: kirim hanya perubahan pemain di watchlist + pemain populer
      const relevantPrice = priceChanges.filter(c => {
        const pl = data.players.find(p => p.web_name === c.name);
        return pl && (watchIds.has(pl.id) || parseFloat(pl.selected_by_percent) > 5);
      });
      const relevantStatus = statusChanges.filter(c => {
        const pl = data.players.find(p => p.web_name === c.name);
        return pl && (watchIds.has(pl.id) || parseFloat(pl.selected_by_percent) > 5);
      });

      send(fmt.priceChangeNotif(relevantPrice));
      send(fmt.statusChangeNotif(relevantStatus));

    } catch (err) {
      console.error('[Cron] Error:', err.message);
    }
  });

  // Ringkasan differential — Jumat jam 18:00 WIB (11:00 UTC), menjelang deadline
  cron.schedule('0 11 * * 5', async () => {
    console.log('[Cron] Sending differential summary...');
    try {
      const data = await fetchAll();
      const scored = scoreAllPlayers(data.players);
      const diffs = scored
        .filter(p => p.scoring.label === 'DIFFERENTIAL' && p.minutes > 0 && p.scoring.minutesSafe)
        .sort((a, b) => b.scoring.differentialScore - a.scoring.differentialScore);

      const msg = fmt.rankingList(diffs, '💎 Differential Picks Minggu Ini', 15);
      send(msg);
    } catch (err) {
      console.error('[Cron] Error differential summary:', err.message);
    }
  });

  // Watchlist update — setiap hari jam 09:00 WIB (02:00 UTC)
  cron.schedule('0 2 * * *', async () => {
    const watchlist = getWatchlist();
    if (watchlist.length === 0) return;

    console.log('[Cron] Sending watchlist update...');
    try {
      const data = await fetchAll();
      const scored = scoreAllPlayers(data.players);

      const lines = ['<b>👁 Watchlist Daily Update</b>\n'];
      for (const w of watchlist) {
        const p = scored.find(s => s.id === w.player_id);
        if (!p) continue;
        const s = p.scoring;
        lines.push(
          `• <b>${p.web_name}</b> Q:${s.qualityScore} D:${s.differentialScore} | ` +
          `Form:${p.form} | ${fmt.priceStr(p.now_cost)} | ${s.label}` +
          (s.regression ? ` | ${s.regression}` : '')
        );
      }
      send(lines.join('\n'));
    } catch (err) {
      console.error('[Cron] Error watchlist update:', err.message);
    }
  });

  console.log('✅ Scheduler started (UTC timezone)');
  console.log('   - Price/status check: daily 01:00 UTC (08:00 WIB)');
  console.log('   - Differential summary: Friday 11:00 UTC (18:00 WIB)');
  console.log('   - Watchlist update: daily 02:00 UTC (09:00 WIB)');
}

module.exports = { startScheduler };
