const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'fpl.db');

let db;

function getDb() {
  if (db) return db;

  const fs = require('fs');
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS snapshots (
      player_id INTEGER,
      date TEXT,
      now_cost INTEGER,
      status TEXT,
      chance_of_playing INTEGER,
      form REAL,
      selected_by_percent REAL,
      PRIMARY KEY (player_id, date)
    );

    CREATE TABLE IF NOT EXISTS watchlist (
      player_id INTEGER PRIMARY KEY,
      player_name TEXT,
      added_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cache_meta (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  return db;
}

// Snapshot: simpan data harian untuk deteksi perubahan
function saveSnapshot(players, date) {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT OR REPLACE INTO snapshots (player_id, date, now_cost, status, chance_of_playing, form, selected_by_percent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const tx = d.transaction(() => {
    for (const p of players) {
      stmt.run(
        p.id, date, p.now_cost, p.status,
        p.chance_of_playing_next_round ?? null,
        parseFloat(p.form) || 0,
        parseFloat(p.selected_by_percent) || 0
      );
    }
  });
  tx();
}

function getSnapshot(date) {
  return getDb().prepare('SELECT * FROM snapshots WHERE date = ?').all(date);
}

function getPreviousSnapshot(beforeDate) {
  const row = getDb().prepare(
    'SELECT DISTINCT date FROM snapshots WHERE date < ? ORDER BY date DESC LIMIT 1'
  ).get(beforeDate);
  if (!row) return [];
  return getSnapshot(row.date);
}

// Watchlist
function addToWatchlist(playerId, playerName) {
  getDb().prepare(
    'INSERT OR REPLACE INTO watchlist (player_id, player_name) VALUES (?, ?)'
  ).run(playerId, playerName);
}

function removeFromWatchlist(playerId) {
  getDb().prepare('DELETE FROM watchlist WHERE player_id = ?').run(playerId);
}

function getWatchlist() {
  return getDb().prepare('SELECT * FROM watchlist ORDER BY added_at').all();
}

function isWatched(playerId) {
  return !!getDb().prepare('SELECT 1 FROM watchlist WHERE player_id = ?').get(playerId);
}

module.exports = {
  getDb,
  saveSnapshot,
  getSnapshot,
  getPreviousSnapshot,
  addToWatchlist,
  removeFromWatchlist,
  getWatchlist,
  isWatched,
};
