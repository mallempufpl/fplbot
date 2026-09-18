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

    CREATE TABLE IF NOT EXISTS users (
      chat_id TEXT PRIMARY KEY,
      fpl_id INTEGER,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      language_code TEXT,
      registered_at TEXT DEFAULT (datetime('now')),
      last_seen TEXT DEFAULT (datetime('now')),
      command_count INTEGER DEFAULT 0,
      last_command TEXT
    );

    CREATE TABLE IF NOT EXISTS user_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id TEXT,
      command TEXT,
      args TEXT,
      timestamp TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrasi: tambah kolom baru jika belum ada (untuk DB yang sudah ada)
  const userCols = db.pragma('table_info(users)').map(c => c.name);
  const addCol = (col, type) => {
    if (!userCols.includes(col)) {
      db.exec(`ALTER TABLE users ADD COLUMN ${col} ${type}`);
    }
  };
  addCol('last_name', 'TEXT');
  addCol('language_code', 'TEXT');
  addCol('last_seen', "TEXT DEFAULT (datetime('now'))");
  addCol('command_count', 'INTEGER DEFAULT 0');
  addCol('last_command', 'TEXT');

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

// Users
function registerUser(chatId, fplId, ctx) {
  const from = ctx?.from || {};
  getDb().prepare(`
    INSERT INTO users (chat_id, fpl_id, username, first_name, last_name, language_code)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(chat_id) DO UPDATE SET
      fpl_id = COALESCE(excluded.fpl_id, fpl_id),
      username = COALESCE(excluded.username, username),
      first_name = COALESCE(excluded.first_name, first_name),
      last_name = COALESCE(excluded.last_name, last_name),
      language_code = COALESCE(excluded.language_code, language_code),
      last_seen = datetime('now')
  `).run(
    String(chatId), fplId || null,
    from.username || null,
    from.first_name || null,
    from.last_name || null,
    from.language_code || null
  );
}

function getUser(chatId) {
  return getDb().prepare('SELECT * FROM users WHERE chat_id = ?').get(String(chatId));
}

function updateUserActivity(chatId, command, args) {
  const db = getDb();
  db.prepare(`
    UPDATE users SET last_seen = datetime('now'), command_count = command_count + 1, last_command = ?
    WHERE chat_id = ?
  `).run(command, String(chatId));

  db.prepare(`
    INSERT INTO user_activity (chat_id, command, args) VALUES (?, ?, ?)
  `).run(String(chatId), command, args || null);
}

function getUserActivity(chatId, limit = 20) {
  return getDb().prepare(
    'SELECT * FROM user_activity WHERE chat_id = ? ORDER BY timestamp DESC LIMIT ?'
  ).all(String(chatId), limit);
}

function getUserStats() {
  const db = getDb();
  const totalUsers = db.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt;
  const activeToday = db.prepare(
    "SELECT COUNT(*) as cnt FROM users WHERE last_seen >= datetime('now', '-1 day')"
  ).get().cnt;
  const activeWeek = db.prepare(
    "SELECT COUNT(*) as cnt FROM users WHERE last_seen >= datetime('now', '-7 days')"
  ).get().cnt;
  const totalCommands = db.prepare(
    'SELECT COALESCE(SUM(command_count), 0) as cnt FROM users'
  ).get().cnt;
  const topCommands = db.prepare(`
    SELECT command, COUNT(*) as cnt FROM user_activity
    GROUP BY command ORDER BY cnt DESC LIMIT 10
  `).all();
  return { totalUsers, activeToday, activeWeek, totalCommands, topCommands };
}

function deleteUser(chatId) {
  const db = getDb();
  db.prepare('DELETE FROM user_activity WHERE chat_id = ?').run(String(chatId));
  db.prepare('DELETE FROM users WHERE chat_id = ?').run(String(chatId));
}

function getAllUsers(limit = 50, offset = 0) {
  return getDb().prepare('SELECT * FROM users ORDER BY last_seen DESC LIMIT ? OFFSET ?').all(limit, offset);
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
  registerUser,
  getUser,
  updateUserActivity,
  getUserActivity,
  getUserStats,
  deleteUser,
  getAllUsers,
};
