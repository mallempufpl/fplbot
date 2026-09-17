# Spesifikasi Bot Telegram Analisa Pemain FPL

Dokumen acuan untuk bot FPL Differential. Stack: **Node.js** + **Telegraf** + **SQLite (better-sqlite3)**.

---

## 1. Tujuan & Ruang Lingkup

- Bot **multi-user** untuk **analisa pemain, tracking squad, dan pengambilan keputusan** tiap gameweek.
- Menghasilkan **peringkat pemain berbasis skor komposit**, bukan sekadar menampilkan data mentah.
- Condong ke **differential**: ownership rendah + potensi bagus jadi prioritas.
- Didukung **data historis 3 musim** untuk deteksi tren dan konsistensi pemain.
- Dua mode operasi:
  - **On-demand** — bot menjawab perintah (`/player`, `/differentials`, `/squad`, dst).
  - **Terjadwal** — notif otomatis (perubahan harga, status cedera, ringkasan differential) via cron.

### Multi-User & Ownership

- **Owner** (hardcoded: `@Abulkhaer`, ID `123305470`) memiliki akses penuh ke semua fitur admin dan pengaturan.
- **User biasa** harus mendaftar via `/start <FPL_ID>` sebelum bisa menggunakan bot.
- Setiap user menggunakan FPL ID mereka sendiri untuk fitur squad & suggest.
- Owner bisa monitor semua user, melihat aktivitas, dan menghapus user.

---

## 2. Sumber Data

### Dipakai
- **FPL API resmi (publik)** — sumber utama. Gratis, stabil, tanpa API key.
  - `bootstrap-static/` — semua pemain + tim + posisi + events.
  - `fixtures/` — jadwal dan FDR.
  - `element-summary/{id}/` — histori per pemain.
  - `entry/{id}/` — info manager.
  - `entry/{id}/event/{gw}/picks/` — squad per GW.
  - `entry/{id}/transfers/` — histori transfer manager.
  - `my-team/{id}/` — live squad (butuh autentikasi, hanya untuk owner).

- **GitHub vaastav/Fantasy-Premier-League** — data historis 3 musim (CSV).
  - Season: 2022-23, 2023-24, 2024-25.
  - Digunakan untuk analisa tren (PP90, xGI/90, minutes, ICT) dan konsistensi.

- **X/Twitter & Instagram scraping** — berita FPL dari akun-akun pilihan (dikelola owner via CRUD commands).

### Dihindari
- **FBref / Opta** — pembatasan rate ketat, mudah kena blokir.
- **Fantasy Football Hub & FFScout** — layanan berbayar, melanggar ToS.

---

## 3. Metrik Analisa

### 3.1 Metrik dasar

| Metrik | Field API | Arah | Kegunaan |
|---|---|---|---|
| xGI per 90 | `expected_goal_involvements`, `minutes` | tinggi = baik | Prediktor serangan terkuat |
| Form | `form` | tinggi = baik | Momentum terkini |
| Fixture ease (N GW) | dari `fixtures` + FDR | mudah = baik | Konteks lawan ke depan |
| Keamanan menit | `minutes`, `starts`, `status`, `chance_of_playing_next_round` | tinggi = baik | Penyaring risiko |
| Value | `form` / (`now_cost`/10) | tinggi = baik | Efisiensi budget |
| Defensif (GK/DEF) | `expected_goals_conceded`, clean sheet potential | rendah xGC = baik | Kualitas bertahan |
| **Trend (historis)** | data 3 musim dari GitHub CSV | tinggi = baik | Pola performa jangka panjang |

### 3.2 Metrik historis (3 musim)

Data historis diambil dari GitHub repo `vaastav/Fantasy-Premier-League` untuk musim 2022-23, 2023-24, 2024-25.

**Metrik yang dianalisa per musim:**
- PP90 (Points Per 90 minutes)
- xGI/90 (Expected Goal Involvement per 90)
- Minutes played
- ICT Index

**Analisa trend:**
- **Linear regression** pada metrik per musim untuk mendeteksi arah tren.
- **Coefficient of Variation (CV)** untuk mengukur konsistensi.
- Label tren:
  - `IMPROVING` (skor >= 65) — performa naik signifikan.
  - `CONSISTENT` (skor 35-65) — stabil dari musim ke musim.
  - `DECLINING` (skor < 35) — performa menurun.

**Analisa regresi xG (enhanced):**
- `OVERPERFORMING` — gol aktual > xG (waspada regresi turun).
- `UNDERPERFORMING` — gol aktual < xG (potensi regresi naik).
- `CLINICAL_FINISHER` — overperform multi-musim (genuinely clinical).
- `POOR_FINISHER` — underperform kronis multi-musim.

### 3.3 Normalisasi

Semua metrik dinormalkan ke skala 0-1 menggunakan **percentile rank** per posisi. Untuk metrik "rendah = baik" dibalik (`1 - percentile_rank`).

### 3.4 Pembobotan per posisi

Bobot default (konfigurabel via `/metrics weight`):

| Komponen | GK | DEF | MID | FWD |
|---|---|---|---|---|
| xGI per 90 | 5% | 15% | 30% | 35% |
| Form | 18% | 16% | 15% | 15% |
| Fixture | 18% | 18% | 16% | 14% |
| Keamanan menit | 18% | 13% | 13% | 13% |
| Value | 8% | 10% | 13% | 11% |
| Defensif | 20% | 15% | — | — |
| **Trend** | 13% | 15% | 17% | 16% |
| **Total** | 100% | 100% | ~100% | ~100% |

### 3.5 Skor komposit

- **Quality Score (0-100):** gabungan semua komponen ternormalisasi x bobot.
- **Differential Score:** quality_score x (0.6 + 0.4 x ownership_inverse). Pemain ber-EO rendah dapat dorongan.

### 3.6 Label pemain

| Label | Kriteria |
|---|---|
| `DIFFERENTIAL` | ownership < 12% DAN quality_score >= persentil atas seposisi |
| `TEMPLATE` | ownership > 40% |
| `REGULAR` | lainnya |

---

## 4. Arsitektur Multi-User

### 4.1 Registrasi & Autentikasi

```
User baru → /start → Pesan selamat datang, minta FPL ID
User → /start <FPL_ID> → Validasi via FPL API → Simpan di SQLite → Akses penuh
```

- FPL ID divalidasi dengan memanggil `fetchManagerInfo(fplId)`. Jika 404, ID ditolak.
- Data user disimpan di tabel `users`: chat_id, fpl_id, username, first_name, last_name, language_code, registered_at, last_seen, command_count, last_command.
- Aktivitas user dilacak di tabel `user_activity`.

### 4.2 Middleware

Setiap pesan masuk melewati middleware yang:
1. Mengizinkan perintah publik (`/start`, `/myid`) tanpa registrasi.
2. Mengizinkan owner tanpa batasan.
3. Mengecek registrasi user — jika belum terdaftar, arahkan ke `/start`.
4. Mencatat aktivitas user (command, args, timestamp).

### 4.3 Hak Akses

| Perintah | Akses |
|---|---|
| `/start`, `/myid` | Semua (publik, tanpa registrasi) |
| `/player`, `/compare`, `/best`, `/differentials`, `/fixtures`, `/regression`, `/trending`, `/nettransfer`, `/news`, `/newslist`, `/analyze`, `/history` | Semua user terdaftar |
| `/squad`, `/suggest` | User terdaftar (menggunakan FPL ID masing-masing) |
| `/watch`, `/unwatch`, `/watchlist` | User terdaftar (watchlist global/bersama) |
| `/refresh` | User terdaftar |
| `/metrics` (lihat) | User terdaftar |
| `/metrics` (on/off/weight/reset) | Owner only |
| `/users`, `/removeuser` | Owner only |
| `/xadd`, `/xdel`, `/igadd`, `/igdel` | Owner only |
| `/refreshhistory` | Owner only |
| `/setenv`, `/getenv`, `/delenv`, `/restart` | Owner only |

### 4.4 Squad & Suggest — Multi-User

- Setiap user menggunakan FPL ID yang terdaftar via `/start`.
- `/squad` dan `/suggest` mengambil data manager berdasarkan FPL ID user.
- `fetchManagerTransfers` dibuat **non-fatal** — jika gagal, default ke array kosong. Ini mencegah crash ketika API transfer bermasalah untuk akun tertentu.
- Mencoba mengambil picks dari beberapa GW: nextGw, currentGw, hingga 3 GW sebelumnya.
- Khusus owner: bisa mengakses live squad via FPL login (`my-team` endpoint) untuk melihat perubahan lineup/kapten sebelum deadline.

---

## 5. Perintah Lengkap

### Analisa Pemain
| Perintah | Fungsi |
|---|---|
| `/player <nama>` | Detail pemain: harga, form, xGI/90, ownership, status, fixture, quality & differential score |
| `/analyze <nama>` | Analisa mendalam: breakdown komponen skor, regresi, tren historis, verdict |
| `/history <nama>` | Data historis 3 musim: PP90, xGI/90, minutes, ICT per musim + tren & konsistensi |
| `/compare <A> vs <B>` | Bandingkan dua pemain berdampingan |
| `/best <posisi>` | Top pemain per posisi berdasarkan quality score |
| `/differentials [posisi]` | Top differential picks (EO rendah + skor tinggi) |
| `/regression` | Pemain overperform/underperform vs xG (termasuk label multi-musim) |

### Squad & Transfer
| Perintah | Fungsi |
|---|---|
| `/squad` | Lihat squad user (FPL ID terdaftar), dengan starting XI, bench, kapten |
| `/suggest` | Saran transfer terbaik berdasarkan quality score + tren + regresi + berita |
| `/trending [in\|out]` | Transfer in/out terpopuler GW ini |
| `/nettransfer` | Net transfer: pemain paling banyak masuk vs keluar |

### Berita & Info
| Perintah | Fungsi |
|---|---|
| `/news [platform] [akun]` | Berita FPL dari X dan Instagram |
| `/newslist` | Daftar akun sumber berita |
| `/fixtures <tim>` | Jadwal & FDR beberapa GW ke depan |

### Watchlist
| Perintah | Fungsi |
|---|---|
| `/watch <nama>` | Tambah ke watchlist |
| `/unwatch <nama>` | Hapus dari watchlist |
| `/watchlist` | Lihat watchlist beserta skor terkini |

### Pengaturan (User)
| Perintah | Fungsi |
|---|---|
| `/start <FPL ID>` | Registrasi atau update FPL ID |
| `/myid` | Lihat info akun Telegram sendiri |
| `/metrics` | Lihat konfigurasi metrik scoring |
| `/refresh` | Refresh data dari FPL API |

### Admin (Owner Only)
| Perintah | Fungsi |
|---|---|
| `/users` | Dashboard: total user, statistik, daftar user |
| `/users <chat_id>` | Detail lengkap user tertentu + riwayat aktivitas |
| `/removeuser <chat_id>` | Hapus user dan data aktivitasnya |
| `/xadd <username>` | Tambah akun X sebagai sumber berita |
| `/xdel <username>` | Hapus akun X dari sumber berita |
| `/igadd <username>` | Tambah akun Instagram sebagai sumber berita |
| `/igdel <username>` | Hapus akun Instagram dari sumber berita |
| `/metrics on/off/weight/reset` | Kelola konfigurasi metrik scoring |
| `/refreshhistory` | Force refresh data historis 3 musim |
| `/setenv <KEY> <VALUE>` | Update variabel environment |
| `/getenv` | Lihat semua config (nilai sensitif di-mask) |
| `/delenv <KEY>` | Hapus variabel environment |
| `/restart` | Restart bot |

---

## 6. Arsitektur Teknis

### 6.1 Stack

| Komponen | Teknologi |
|---|---|
| Runtime | Node.js |
| Telegram | Telegraf |
| HTTP Client | Axios |
| Database | SQLite via better-sqlite3 |
| Scheduler | node-cron |
| Deployment | Railway (auto-restart on failure) |

### 6.2 Struktur File

```
src/
  index.js          — Entry point, bot setup, cron scheduler
  commands.js       — Semua command handler + middleware registrasi
  fpl-api.js        — FPL API client (fetch, cache, login)
  scoring.js        — Mesin scoring: normalisasi, pembobotan, quality/differential score
  format.js         — Formatter output Telegram (HTML)
  config.js         — Konfigurasi metrik, bobot per posisi, label
  database.js       — SQLite schema, CRUD users, snapshots, watchlist, activity
  admin.js          — Admin commands (setenv, getenv, restart), owner check
  historical.js     — Data historis 3 musim, trend analysis, consistency scoring
  news.js           — Scraper berita X/Twitter & Instagram
data/
  fpl.db            — SQLite database (auto-created)
```

### 6.3 Alur Data

```
FPL API (bootstrap-static, fixtures)
  → Cache in-memory (TTL 1 jam)
  → fetchAll() enriches players dengan team data, fixture info

GitHub CSV (3 musim historis)
  → Parse & simpan di SQLite (tabel historical_data)
  → Lazy load, auto-refresh weekly
  → buildTrendMap() → trend score per pemain

Scoring Pipeline:
  ensureHistoricalData()
  → fetchAll() → players enriched
  → buildTrendMap() → trend per pemain
  → buildPositionStats() → statistik populasi per posisi
  → scorePlayer() per pemain → quality score + differential score
  → Cache 10 menit

User Request:
  Middleware (cek registrasi, track aktivitas)
  → Command handler
  → getScoredPlayers() (dari cache atau hitung ulang)
  → Format output → Kirim ke Telegram
```

### 6.4 Database Schema

**Tabel `users`:**
- `chat_id` TEXT PRIMARY KEY
- `fpl_id` INTEGER
- `username`, `first_name`, `last_name`, `language_code` TEXT
- `registered_at`, `last_seen` TEXT (datetime)
- `command_count` INTEGER, `last_command` TEXT

**Tabel `user_activity`:**
- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `chat_id` TEXT, `command` TEXT, `args` TEXT
- `timestamp` TEXT (datetime)

**Tabel `snapshots`:**
- `player_id` INTEGER, `date` TEXT (PRIMARY KEY composite)
- `now_cost`, `status`, `chance_of_playing`, `form`, `selected_by_percent`

**Tabel `watchlist`:**
- `player_id` INTEGER PRIMARY KEY, `player_name` TEXT, `added_at` TEXT

**Tabel `historical_data`** (managed by historical.js):
- Data per pemain per musim untuk trend analysis.

**Tabel `cache_meta`:**
- `key` TEXT PRIMARY KEY, `value` TEXT, `updated_at` TEXT

---

## 7. Keamanan & Praktik Baik

- **Token bot** & kredensial FPL disimpan di **environment variable**.
- Key sensitif (`BOT_TOKEN`, `FPL_PASSWORD`, `ADMIN_SECRET`, `IG_SESSION_ID`) di-mask saat ditampilkan.
- Key kritis (`BOT_TOKEN`, `CHAT_ID`, `FPL_EMAIL`, `FPL_PASSWORD`, `ADMIN_SECRET`) hanya bisa diubah owner.
- Owner diidentifikasi via **hardcoded Telegram ID** (bukan env variable) — tidak bisa di-bypass.
- `fetchManagerTransfers` dibuat non-fatal agar kegagalan API tidak meng-crash seluruh command.
- Cache agresif: FPL API 1 jam, scored players 10 menit, data historis weekly.
- Error handling per async call — bedakan "data tidak ada" dari "gagal koneksi".
- Rate limit FPL API dihormati — cache harian sudah cukup.
