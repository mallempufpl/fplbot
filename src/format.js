const { POSITION_NAMES, POSITION_EMOJI } = require('./config');

function posLabel(elementType) {
  return `${POSITION_EMOJI[elementType] || ''} ${POSITION_NAMES[elementType] || '?'}`;
}

function priceStr(nowCost) {
  return `£${(nowCost / 10).toFixed(1)}m`;
}

function colorIcon(value, thresholds = [70, 40]) {
  if (value >= thresholds[0]) return '🟢';
  if (value >= thresholds[1]) return '🟡';
  return '🔴';
}

function bar(value, max = 1, len = 10) {
  const filled = Math.round((value / max) * len);
  return '█'.repeat(filled) + '░'.repeat(len - filled);
}

function playerCard(p) {
  const s = p.scoring;
  const fix = (p.nextFixtures || []).slice(0, 4).map(f =>
    `${f.isHome ? '(H)' : '(A)'} ${p.teamData ? '' : ''}GW${f.gw} FDR${f.fdr}`
  ).join(', ');

  const lines = [
    `<b>${p.web_name}</b> — ${posLabel(p.element_type)}`,
    `${p.teamData?.name || 'Unknown'} | ${priceStr(p.now_cost)} | EO: ${p.selected_by_percent}%`,
    ``,
    `📊 <b>Quality Score: ${s.qualityScore}/100</b>`,
    `🎯 <b>Differential Score: ${s.differentialScore}/100</b>`,
    `🏷 Label: <b>${s.label}</b>`,
    ``,
    `<b>Komponen:</b>`,
    `  xGI/90  ${bar(s.components.xgi)} ${(s.components.xgi * 100).toFixed(0)}%`,
    `  Form    ${bar(s.components.form)} ${(s.components.form * 100).toFixed(0)}%`,
    `  Fixture ${bar(s.components.fixture)} ${(s.components.fixture * 100).toFixed(0)}%`,
    `  Minutes ${bar(s.components.minutes)} ${(s.components.minutes * 100).toFixed(0)}%`,
    `  Value   ${bar(s.components.value)} ${(s.components.value * 100).toFixed(0)}%`,
  ];

  if (s.components.def > 0) {
    lines.push(`  Defense ${bar(s.components.def)} ${(s.components.def * 100).toFixed(0)}%`);
  }

  lines.push('');
  lines.push(`📈 Form: ${p.form} | PPG: ${p.points_per_game} | Pts: ${p.total_points}`);
  lines.push(`⏱ Menit: ${p.minutes} | Start: ${p.starts || 0}`);

  if (s.regression) {
    const emoji = s.regression === 'OVERPERFORMING' ? '⚠️' : '💎';
    lines.push(`${emoji} ${s.regression} (Goals - xG: ${s.regressionDiff > 0 ? '+' : ''}${s.regressionDiff})`);
  }

  if (!s.minutesSafe) {
    lines.push(`🚨 <b>RISIKO ROTASI/CEDERA</b> — keamanan menit rendah`);
  }

  if (p.minutes < 270) {
    lines.push(`⚠️ <i>Sample size kecil (${p.minutes} menit) — data belum stabil</i>`);
  }

  if (fix) {
    lines.push(`\n📅 Fixture: ${fix}`);
  }

  return lines.join('\n');
}

function compareCard(a, b) {
  const sa = a.scoring, sb = b.scoring;
  const better = (va, vb) => va > vb ? '✅' : va < vb ? '❌' : '➖';

  return [
    `<b>${a.web_name}</b> vs <b>${b.web_name}</b>`,
    `${posLabel(a.element_type)} | ${posLabel(b.element_type)}`,
    ``,
    `<pre>`,
    `Metrik         ${a.web_name.padEnd(12)} ${b.web_name.padEnd(12)}`,
    `─────────────────────────────────────`,
    `Quality     ${better(sa.qualityScore, sb.qualityScore)} ${String(sa.qualityScore).padEnd(12)} ${better(sb.qualityScore, sa.qualityScore)} ${sb.qualityScore}`,
    `Diff Score  ${better(sa.differentialScore, sb.differentialScore)} ${String(sa.differentialScore).padEnd(12)} ${better(sb.differentialScore, sa.differentialScore)} ${sb.differentialScore}`,
    `Form           ${String(a.form).padEnd(12)} ${b.form}`,
    `Price          ${priceStr(a.now_cost).padEnd(12)} ${priceStr(b.now_cost)}`,
    `EO             ${(a.selected_by_percent + '%').padEnd(12)} ${b.selected_by_percent}%`,
    `xGI/90         ${(sa.components.xgi * 100).toFixed(0).padEnd(12)} ${(sb.components.xgi * 100).toFixed(0)}`,
    `Minutes        ${String(a.minutes).padEnd(12)} ${b.minutes}`,
    `</pre>`,
    ``,
    `🏷 ${a.web_name}: ${sa.label} | ${b.web_name}: ${sb.label}`,
  ].join('\n');
}

function rankingList(players, title, limit = 10) {
  const lines = [`<b>${title}</b>\n`];
  players.slice(0, limit).forEach((p, i) => {
    const s = p.scoring;
    const medal = i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`;
    lines.push(
      `${medal} <b>${p.web_name}</b> (${p.teamData?.short_name || '?'}) — ` +
      `Q:${s.qualityScore} D:${s.differentialScore} | ` +
      `${priceStr(p.now_cost)} | EO:${p.selected_by_percent}% | ${s.label}`
    );
  });
  return lines.join('\n');
}

function fixtureTable(teamName, fixtures, teams) {
  const lines = [`<b>📅 Fixture ${teamName}</b>\n`];
  fixtures.slice(0, 8).forEach(f => {
    const opp = teams[f.opponent];
    const oppName = opp?.short_name || `Team${f.opponent}`;
    const fdrEmojis = ['🟢', '🟡', '🟠', '🔴', '🔴'];
    const fdrEmoji = fdrEmojis[f.fdr - 1] || '⚪';
    lines.push(
      `GW${f.gw}: ${f.isHome ? '🏠' : '✈️'} ${oppName} (FDR ${f.fdr} ${fdrEmoji})`
    );
  });
  return lines.join('\n');
}

function priceChangeNotif(changes) {
  if (changes.length === 0) return null;
  const lines = ['<b>💰 Perubahan Harga</b>\n'];
  for (const c of changes) {
    const arrow = c.diff > 0 ? '📈' : '📉';
    lines.push(`${arrow} <b>${c.name}</b>: ${priceStr(c.oldPrice)} → ${priceStr(c.newPrice)} (${c.diff > 0 ? '+' : ''}${priceStr(c.diff)})`);
  }
  return lines.join('\n');
}

function statusChangeNotif(changes) {
  if (changes.length === 0) return null;
  const statusEmoji = { a: '✅', d: '⚠️', i: '🏥', s: '❌', u: '❓' };
  const statusLabel = { a: 'Available', d: 'Doubtful', i: 'Injured', s: 'Suspended', u: 'Unknown' };
  const lines = ['<b>🏥 Perubahan Status Pemain</b>\n'];
  for (const c of changes) {
    lines.push(
      `${statusEmoji[c.newStatus] || '❓'} <b>${c.name}</b>: ` +
      `${statusLabel[c.oldStatus] || c.oldStatus} → ${statusLabel[c.newStatus] || c.newStatus}` +
      (c.chance != null ? ` (${c.chance}% chance)` : '')
    );
  }
  return lines.join('\n');
}

function squadCard(manager, picks, scoredPlayers, teams, currentGw) {
  const lines = [
    `<b>👤 ${manager.player_first_name} ${manager.player_last_name}</b>`,
    `📋 ${manager.name}`,
    `🏆 Overall Rank: ${manager.summary_overall_rank?.toLocaleString() || 'N/A'} | Points: ${manager.summary_overall_points || 0}`,
    `💰 Bank: £${((picks.entry_history?.bank || 0) / 10).toFixed(1)}m | Value: £${((picks.entry_history?.value || 0) / 10).toFixed(1)}m`,
    `📅 GW${currentGw} Points: ${picks.entry_history?.points || 0} | 🪑 Bench Pts: ${picks.entry_history?.points_on_bench || 0}`,
    ``,
  ];

  // Grup per posisi
  const posGroups = { 1: [], 2: [], 3: [], 4: [] };
  const benchIds = new Set();

  for (const pick of picks.picks) {
    const p = scoredPlayers.find(sp => sp.id === pick.element);
    if (!p) continue;

    const entry = {
      ...p,
      isCaptain: pick.is_captain,
      isViceCaptain: pick.is_vice_captain,
      multiplier: pick.multiplier,
      position: pick.position,
    };

    if (pick.position > 11) {
      benchIds.add(pick.element);
    }

    posGroups[p.element_type].push(entry);
  }

  // Starting XI
  lines.push('<b>⚽ Starting XI</b>');
  for (const pos of [1, 2, 3, 4]) {
    const group = posGroups[pos]
      .filter(p => !benchIds.has(p.id))
      .sort((a, b) => a.position - b.position);

    if (group.length === 0) continue;

    for (const p of group) {
      const badge = p.isCaptain ? ' ©️' : p.isViceCaptain ? ' (VC)' : '';
      const statusIcon = p.status !== 'a' ? ` ${p.status === 'd' ? '⚠️' : '🏥'}` : '';
      lines.push(
        `  ${posLabel(pos)} <b>${p.web_name}</b>${badge}${statusIcon} — ` +
        `${colorIcon(p.scoring.qualityScore)}Q:${p.scoring.qualityScore} | ${priceStr(p.now_cost)} | ${colorIcon(parseFloat(p.form), [6, 3])}F:${p.form}`
      );
    }
  }

  // Bench
  lines.push('\n<b>🪑 Bench</b>');
  const bench = picks.picks
    .filter(pk => pk.position > 11)
    .sort((a, b) => a.position - b.position);

  for (const pick of bench) {
    const p = scoredPlayers.find(sp => sp.id === pick.element);
    if (!p) continue;
    lines.push(
      `  ${posLabel(p.element_type)} ${p.web_name} — ${colorIcon(p.scoring.qualityScore)}Q:${p.scoring.qualityScore} | ${priceStr(p.now_cost)}`
    );
  }

  // Active chip
  if (picks.active_chip) {
    lines.push(`\n🃏 Chip aktif: <b>${picks.active_chip.toUpperCase()}</b>`);
  }

  return lines.join('\n');
}

function transferSuggestions(suggestions) {
  if (suggestions.length === 0) {
    return '<b>🔄 Transfer Suggestions</b>\n\nTidak ada saran transfer — squad sudah optimal!';
  }

  const lines = ['<b>🔄 Transfer Suggestions GW Berikutnya</b>\n'];

  suggestions.forEach((s, i) => {
    const priority = i === 0 ? '🔥' : i === 1 ? '⭐' : '💡';
    lines.push(
      `${priority} <b>Prioritas ${i + 1}</b>`,
      `  ❌ OUT: <b>${s.out.web_name}</b> (${s.out.teamShort}) — Q:${s.out.qualityScore} | ${priceStr(s.out.nowCost)}`,
      `  ✅ IN:  <b>${s.in.web_name}</b> (${s.in.teamShort}) — Q:${s.in.qualityScore} | ${priceStr(s.in.nowCost)}`,
      `  📈 Skor naik: +${s.scoreDiff} | 💰 ${s.costDiff >= 0 ? 'Hemat' : 'Tambah'}: ${priceStr(Math.abs(s.costDiff))}`,
      `  💬 ${s.reason}`,
      '',
    );
  });

  lines.push('<i>⚠️ Saran berdasarkan quality score & fixture. Pertimbangkan juga konteks tim kamu.</i>');
  return lines.join('\n');
}

function trendingCard(transfersIn, transfersOut, currentGw) {
  const lines = [`<b>🔥 Trending Transfers — GW${currentGw}</b>\n`];

  // Transfer IN
  lines.push('<b>📈 Most Transferred IN (Hype)</b>');
  lines.push('─────────────────');
  transfersIn.slice(0, 15).forEach((p, i) => {
    const medal = i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`;
    const qIcon = p.scoring.qualityScore >= 70 ? '🟢' : p.scoring.qualityScore >= 40 ? '🟡' : '🔴';
    lines.push(
      `${medal} <b>${p.web_name}</b> (${p.teamData?.short_name || '?'}) — ` +
      `+${p.transfers_in_event.toLocaleString()}`
    );
    lines.push(
      `     ${qIcon}Q:${p.scoring.qualityScore} | ${priceStr(p.now_cost)} | ` +
      `EO:${p.selected_by_percent}% | ${p.scoring.label}`
    );
  });

  lines.push('');

  // Transfer OUT
  lines.push('<b>📉 Most Transferred OUT (Ditinggalkan)</b>');
  lines.push('─────────────────');
  transfersOut.slice(0, 15).forEach((p, i) => {
    const medal = i < 3 ? ['🥇', '🥈', '🥉'][i] : `${i + 1}.`;
    const reasons = [];
    if (p.status !== 'a') reasons.push(p.status === 'i' ? '🏥 Cedera' : p.status === 's' ? '❌ Suspended' : '⚠️ Doubtful');
    if (p.scoring.regression === 'OVERPERFORMING') reasons.push('📉 Overperform');
    const reasonStr = reasons.length > 0 ? ` [${reasons.join(', ')}]` : '';

    lines.push(
      `${medal} <b>${p.web_name}</b> (${p.teamData?.short_name || '?'}) — ` +
      `-${p.transfers_out_event.toLocaleString()}${reasonStr}`
    );
    lines.push(
      `     Q:${p.scoring.qualityScore} | ${priceStr(p.now_cost)} | ` +
      `EO:${p.selected_by_percent}%`
    );
  });

  lines.push('\n<i>💡 Transfer banyak ≠ selalu bagus. Cek quality score & fixture sebelum ikut-ikutan.</i>');
  return lines.join('\n');
}

function netTransferCard(players, currentGw) {
  const lines = [`<b>⚡ Net Transfers — GW${currentGw}</b>\n`];

  // Hitung net transfer
  const withNet = players
    .filter(p => p.minutes > 0)
    .map(p => ({
      ...p,
      netTransfer: p.transfers_in_event - p.transfers_out_event,
    }));

  // Top gainers
  const gainers = [...withNet].sort((a, b) => b.netTransfer - a.netTransfer).slice(0, 10);
  // Top losers
  const losers = [...withNet].sort((a, b) => a.netTransfer - b.netTransfer).slice(0, 10);

  lines.push('<b>🚀 Top Gainers (Net Transfer +)</b>');
  gainers.forEach((p, i) => {
    const icon = i < 3 ? '🔥' : '📈';
    lines.push(
      `${icon} <b>${p.web_name}</b> (${p.teamData?.short_name || '?'}) — ` +
      `<b>+${p.netTransfer.toLocaleString()}</b> | Q:${p.scoring.qualityScore} | ${priceStr(p.now_cost)}`
    );
  });

  lines.push('');
  lines.push('<b>🧊 Top Losers (Net Transfer -)</b>');
  losers.forEach((p, i) => {
    const icon = i < 3 ? '💀' : '📉';
    lines.push(
      `${icon} <b>${p.web_name}</b> (${p.teamData?.short_name || '?'}) — ` +
      `<b>${p.netTransfer.toLocaleString()}</b> | Q:${p.scoring.qualityScore} | ${priceStr(p.now_cost)}`
    );
  });

  return lines.join('\n');
}

module.exports = {
  playerCard, compareCard, rankingList, fixtureTable,
  priceChangeNotif, statusChangeNotif, squadCard, transferSuggestions,
  trendingCard, netTransferCard,
  posLabel, priceStr,
};
