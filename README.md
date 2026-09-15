# FPL Differential Bot

Bot Telegram untuk analisa pemain Fantasy Premier League (FPL) dengan fokus pada differential picks dan transfer suggestions.

## Fitur Utama

### Analisa Pemain
- **Quality Score** (0-100) — Skor komposit berdasarkan xGI/90, form, fixture difficulty, minutes, value, dan defensive stats
- **Differential Score** — Identifikasi pemain berkualitas dengan ownership rendah (<12%)
- **Regression Analysis** — Deteksi pemain overperforming/underperforming vs xG
- **Perbandingan** — Bandingkan 2 pemain side-by-side

### Squad & Transfer
- Lihat squad lengkap dengan quality score per pemain
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

### Watchlist
- Pantau pemain tertentu
- Dapat notifikasi harian tentang perubahan harga & status

## Daftar Perintah

### Analisa Pemain
| Perintah | Fungsi |
|----------|--------|
| `/player <nama>` | Detail pemain lengkap |
| `/compare <A> vs <B>` | Bandingkan 2 pemain |
| `/best <GK\|DEF\|MID\|FWD>` | Top 15 per posisi |
| `/differentials [posisi]` | Top differential picks |
| `/regression` | Pemain over/underperform vs xG |
| `/fixtures <tim>` | Jadwal & FDR |

### Squad & Transfer
| Perintah | Fungsi |
|----------|--------|
| `/squad [FPL ID]` | Lihat squad (pakai FPL_ID default jika kosong) |
| `/suggest [FPL ID]` | Saran transfer + info berita |

### Berita
| Perintah | Fungsi |
|----------|--------|
| `/news` | Semua berita (X + Instagram) |
| `/news x` | Berita dari X/Twitter |
| `/news ig` | Berita dari Instagram |
| `/news x <username>` | Berita dari akun X tertentu |
| `/news ig <username>` | Berita dari akun IG tertentu |
| `/newslist` | Daftar akun sumber berita |

### Watchlist
| Perintah | Fungsi |
|----------|--------|
| `/watch <nama>` | Tambah ke watchlist |
| `/unwatch <nama>` | Hapus dari watchlist |
| `/watchlist` | Lihat watchlist |

### Admin
| Perintah | Fungsi |
|----------|--------|
| `/setenv <KEY> <VALUE>` | Update konfigurasi |
| `/getenv` | Lihat konfigurasi (nilai sensitif di-mask) |
| `/delenv <KEY>` | Hapus konfigurasi |
| `/restart` | Restart bot |
| `/myid` | Lihat Chat ID kamu |
| `/refresh` | Refresh data dari FPL API |

## Konfigurasi (.env)

```env
# Wajib
BOT_TOKEN=token_dari_botfather
CHAT_ID=telegram_chat_id_kamu

# Opsional
FPL_ID=123456                  # FPL ID default untuk /squad dan /suggest
PORT=3000                       # Port server (default: 3000)

# Akun sumber berita (username tanpa @, pisahkan dengan koma)
X_ACCOUNTS=OfficialFPL,FPLStatus,BenCrellin,FFScout,FPL_Rockstar
IG_ACCOUNTS=officialfpl,premierleague,statsmanfpl
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

Bot otomatis detect `RAILWAY_PUBLIC_DOMAIN` dan menggunakan **webhook mode** (lebih stabil dari polling).

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

- **Runtime:** Node.js 20
- **Bot Framework:** Telegraf 4
- **Database:** SQLite (better-sqlite3)
- **Scheduler:** node-cron
- **HTTP Client:** Axios
- **Deployment:** Docker

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
│   ├── commands.js     # Command handlers
│   ├── admin.js        # Admin commands (/setenv, /restart, dll)
│   ├── config.js       # Scoring weights & constants
│   ├── scoring.js      # Quality & differential scoring engine
│   ├── fpl-api.js      # FPL API client & caching
│   ├── news.js         # X/Twitter & Instagram aggregation
│   ├── format.js       # Telegram message formatting
│   ├── scheduler.js    # Cron jobs (price, status, watchlist)
│   └── database.js     # SQLite database (snapshots, watchlist)
├── Dockerfile
├── render.yaml
├── package.json
└── .env.example
```
