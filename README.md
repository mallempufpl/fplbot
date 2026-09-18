# FPL Differential Bot

Bot Telegram untuk analisa pemain Fantasy Premier League (FPL) dengan fokus pada differential picks, transfer suggestions, dan data historis 3 musim.

## Fitur Utama

### Analisa Pemain
- **Quality Score** (0-100) — Skor komposit berdasarkan xGI/90, form, fixture difficulty, minutes, value, dan defensive stats
- **Differential Score** — Identifikasi pemain berkualitas dengan ownership rendah (<12%)
- **Regression Analysis** — Deteksi pemain overperforming/underperforming vs xG
- **Data Historis 3 Musim** — Tren performa, konsistensi, dan prediksi
- **Perbandingan** — Bandingkan 2 pemain side-by-side

### Squad & Transfer
- Lihat squad lengkap dengan quality score per pemain
- **Best Starting XI** — Rekomendasi formasi dan lineup optimal
- Saran transfer otomatis berdasarkan analisa kelemahan squad
- Integrasi berita dari X/Twitter & Instagram untuk validasi saran

### Berita & Info
- Agregasi berita dari akun X/Twitter dan Instagram (configurable)
- Instagram posts ditampilkan dengan gambar
- Fixture difficulty rating (FDR) per tim

### Notifikasi Otomatis (Scheduler)
| Jadwal | Waktu (WIB) | Isi |
|--------|-------------|-----|
| Harian | 08:00 | Perubahan harga & status pemain |
| Harian | 09:00 | Update watchlist |
| Jumat | 18:00 | Ringkasan differential picks |

### Watchlist (Per-User)
- Watchlist personal per user (limit berdasarkan tier)
- Notifikasi harian tentang perubahan harga & status
- Alert real-time ketika pemain di watchlist berubah

### Multi-User & Monetisasi
- **Freemium Tier System** — FREE / PRO / TEAM dengan fitur berbeda
- **Multi-language** — Bahasa Indonesia & English
- **Privacy Compliance** — Self-service data export & account deletion
- **Monitoring** — Health dashboard, API metrics, error tracking

## Daftar Perintah

### Analisa Pemain
| Perintah | Tier | Fungsi |
|----------|------|--------|
| `/player <nama>` | Free | Detail pemain lengkap |
| `/best <GK\|DEF\|MID\|FWD>` | Free | Top 15 per posisi |
| `/analyze <nama>` | Pro | Analisa mendalam pemain |
| `/history <nama>` | Pro | Data historis 3 musim |
| `/compare <A> vs <B>` | Pro | Bandingkan 2 pemain |
| `/differentials [posisi]` | Pro | Top differential picks |
| `/regression` | Pro | Pemain over/underperform vs xG |

### Squad & Transfer
| Perintah | Tier | Fungsi |
|----------|------|--------|
| `/squad [FPL ID]` | Free | Lihat squad |
| `/trending [in\|out]` | Free | Transfer in/out terpopuler |
| `/nettransfer` | Free | Net transfer (gainers vs losers) |
| `/best11 [FPL ID]` | Pro | Starting XI terbaik dari squad |
| `/suggest [FPL ID]` | Pro | Saran transfer + info berita |
| `/fixtures <tim>` | Free | Jadwal & FDR |

### Berita
| Perintah | Fungsi |
|----------|--------|
| `/news` | Semua berita (X + Instagram) |
| `/news x` | Berita dari X/Twitter |
| `/news ig` | Berita dari Instagram |
| `/news <username>` | Berita dari akun tertentu |
| `/newslist` | Daftar akun sumber berita |

### Watchlist
| Perintah | Fungsi |
|----------|--------|
| `/watch <nama>` | Tambah ke watchlist |
| `/unwatch <nama>` | Hapus dari watchlist |
| `/watchlist` | Lihat watchlist |

### Pengaturan
| Perintah | Fungsi |
|----------|--------|
| `/start <FPL ID>` | Registrasi / ubah FPL ID |
| `/help` | Panduan interaktif |
| `/settings` | Pengaturan notifikasi |
| `/lang <id\|en>` | Ubah bahasa (Indonesia/English) |
| `/pricing` | Lihat paket langganan |
| `/metrics` | Konfigurasi metrik scoring |
| `/refresh` | Refresh data dari FPL API |
| `/export_data` | Export semua data kamu (JSON) |
| `/delete_account` | Hapus akun & semua data |

### Admin (Owner Only)
| Perintah | Fungsi |
|----------|--------|
| `/stats` | Bot health & monitoring dashboard |
| `/users [chat_id]` | Dashboard user / detail user |
| `/settier <chat_id> <tier>` | Set tier user (free/pro/team) |
| `/removeuser <chat_id>` | Hapus user |
| `/xadd` · `/xdel` | Kelola akun X |
| `/igadd` · `/igdel` | Kelola akun IG |
| `/fplstatus` | Status FPL login & data |
| `/fpllogin` | Login FPL via browser (PKCE) |
| `/fpltoken` | Set token FPL manual |
| `/setenv` · `/getenv` · `/delenv` | Kelola environment variables |
| `/restart` | Restart bot |
| `/refreshhistory` | Refresh data historis 3 musim |

## Paket Langganan (Tiers)

| Fitur | 🆓 Free | ⭐ Pro | 👑 Team |
|-------|---------|--------|---------|
| Info pemain dasar | ✅ | ✅ | ✅ |
| Top pemain per posisi | ✅ | ✅ | ✅ |
| Transfer trending | ✅ | ✅ | ✅ |
| Berita FPL | ✅ | ✅ | ✅ |
| Analisis mendalam | ❌ | ✅ | ✅ |
| Data historis 3 musim | ❌ | ✅ | ✅ |
| Perbandingan pemain | ❌ | ✅ | ✅ |
| Best XI & saran transfer | ❌ | ✅ | ✅ |
| Watchlist limit | 5 | 20 | 50 |
| Perintah per hari | 50 | 500 | ∞ |

## Konfigurasi (.env)

```env
# Wajib
BOT_TOKEN=token_dari_botfather
CHAT_ID=telegram_chat_id_kamu

# Opsional
OWNER_ID=chat_id_owner           # Fallback ke CHAT_ID jika kosong
FPL_ID=123456                    # FPL ID default untuk /squad dan /suggest
PORT=3000                        # Port server (default: 3000)

# FPL Login (untuk live squad sebelum deadline)
FPL_EMAIL=your@email.com
FPL_PASSWORD=your_password

# Akun sumber berita (username tanpa @, pisahkan dengan koma)
X_ACCOUNTS=OfficialFPL,FPLStatus,BenCrellin,FFScout,FPL_Rockstar
IG_ACCOUNTS=officialfpl,premierleague,fantasyfootballscout
```

Semua konfigurasi bisa diubah via bot menggunakan `/setenv` tanpa perlu restart (kecuali `BOT_TOKEN`).

## Cara Cari FPL ID

1. Buka https://fantasy.premierleague.com
2. Login, klik **My Team** atau **Points**
3. Lihat URL: `https://fantasy.premierleague.com/entry/XXXXX/event/...`
4. Angka `XXXXX` adalah FPL ID kamu

## Sistem Scoring

### Quality Score
Skor komposit per posisi dengan bobot berbeda:

| Komponen | GK | DEF | MID | FWD |
|----------|-----|-----|-----|-----|
| xGI/90 | 5% | 15% | 32% | 38% |
| Form | 20% | 18% | 18% | 18% |
| Fixture | 20% | 20% | 18% | 16% |
| Minutes | 20% | 15% | 15% | 15% |
| Value | 10% | 12% | 15% | 13% |
| Defense | 25% | 20% | 0% | 0% |

### Differential Label
- **DIFFERENTIAL** — Ownership <12% + Quality >40th percentile
- **TEMPLATE** — Ownership >40%
- **REGULAR** — Sisanya

### Indikator Warna
- Quality (Q): 🟢 >=70 | 🟡 >=40 | 🔴 <40
- Form (F): 🟢 >=6.0 | 🟡 >=3.0 | 🔴 <3.0

## Deploy

### Railway (Recommended)
1. Push repo ke GitHub
2. Buka [railway.app](https://railway.app) → Login dengan GitHub
3. **New Project** → **Deploy from GitHub Repo** → pilih repo
4. Tambah environment variables di tab **Variables**
5. Generate domain di **Settings** → **Networking** (untuk webhook mode)
6. Deploy

Bot otomatis detect `RAILWAY_PUBLIC_DOMAIN` dan menggunakan **webhook mode** dengan secret token verification.

### Render
1. Push repo ke GitHub
2. Buka [render.com](https://render.com) → Login dengan GitHub
3. **New Web Service** → pilih repo (auto-detect `render.yaml`)
4. Set environment variables
5. Deploy

### Lokal
```bash
npm install
cp .env.example .env
# Edit .env dengan token dan chat ID kamu
npm start
# Atau development mode:
npm run dev
```

## Tech Stack

- **Runtime:** Node.js 20+
- **Bot Framework:** Telegraf 4
- **Database:** SQLite (better-sqlite3, WAL mode)
- **HTTP Client:** Axios + axios-retry (exponential backoff)
- **Scheduler:** node-cron
- **Deployment:** Docker / Railway / Render

## Keamanan

- Webhook dilindungi dengan secret token verification
- Rate limiting per user (20 req/min, owner exempt)
- HTML escaping untuk semua input di Telegram messages
- Atomic file writes untuk .env updates
- Sensitive values (token, password) di-mask di output
- Body size limit (1MB) pada webhook endpoint
- Non-root user di Docker

## Sumber Data

| Sumber | API/Method |
|--------|-----------|
| FPL Data | Official FPL API (`fantasy.premierleague.com/api`) |
| X/Twitter | Twitter Syndication API |
| Instagram | RSS-Bridge → RSSHub (fallback) |

## Struktur File

```
├── src/
│   ├── index.js       # Entry point, webhook/polling setup
│   ├── commands.js     # Command handlers + middleware
│   ├── admin.js        # Admin commands (/setenv, /restart, dll)
│   ├── config.js       # Scoring weights & constants
│   ├── scoring.js      # Quality & differential scoring engine
│   ├── fpl-api.js      # FPL API client + retry logic
│   ├── news.js         # X/Twitter & Instagram aggregation
│   ├── format.js       # Telegram message formatting
│   ├── scheduler.js    # Cron jobs (price, status, watchlist)
│   ├── database.js     # SQLite (snapshots, watchlist, users, prefs)
│   ├── historical.js   # 3-season historical data & trends
│   ├── i18n.js         # Multi-language strings (ID/EN)
│   ├── monitor.js      # Health metrics & error tracking
│   └── tiers.js        # Freemium tier system (FREE/PRO/TEAM)
├── data/               # SQLite database (auto-created)
├── Dockerfile
├── render.yaml
├── package.json
└── .env.example
```
