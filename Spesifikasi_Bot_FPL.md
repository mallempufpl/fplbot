# Spesifikasi Bot Telegram Analisa Pemain FPL

Dokumen acuan untuk pembangunan bot. Fokus: **analisa pemain untuk konsumsi pribadi**, dengan **gaya differential** (berani ambil pemain ber-ownership rendah). Stack: **Node.js**.

---

## 1. Tujuan & Ruang Lingkup

- Bot pribadi (single user) untuk **catatan, tracking, dan pengambilan keputusan** tiap gameweek.
- Menghasilkan **peringkat pemain berbasis skor**, bukan sekadar menampilkan data mentah.
- Condong ke **differential**: ownership rendah + potensi bagus jadi prioritas.
- Dua mode operasi:
  - **On-demand** — bot menjawab perintah (`/player`, `/differentials`, dst).
  - **Terjadwal** — notif otomatis (perubahan harga, status cedera, ringkasan differential) via cron.

Karena pribadi: tidak perlu multi-user, auth, atau manajemen subscriber. Chat ID tujuan cukup di-hardcode dari environment.

---

## 2. Sumber Data

### Dipakai
- **FPL API resmi (publik)** — sumber utama. Gratis, stabil, tanpa API key. Sudah mencakup harga, poin, form, status, ownership, fixtures, dan **underlying stats (xG/xA/xGI)**.
  - Endpoint inti: `bootstrap-static/` (semua pemain + tim + posisi), `fixtures/`, `element-summary/{id}/` (histori per pemain).

### Dipakai dengan hati-hati (opsional)
- **Understat (scraping)** — bila butuh underlying lebih dalam. Relatif lebih toleran dari FBref, tapi tetap: gunakan **cache agresif** (tarik maksimal 1×/hari), rapuh terhadap perubahan struktur situs.

### Dihindari
- **FBref / Opta** — pembatasan rate ketat, mudah kena blokir, ada isu ToS.
- **Fantasy Football Hub & FFScout** — layanan berbayar; menarik data mereka otomatis melanggar ToS. Boleh dibaca manual sebagai referensi manusia, **bukan** sumber otomatis bot.

> Prinsip: bangun di atas FPL API resmi. Karena traffic pribadi rendah, cache harian sudah lebih dari cukup dan menghindari masalah rate-limit.

---

## 3. Metrik Analisa

### 3.1 Kategori metrik

| Metrik | Field API (verifikasi) | Arah | Kegunaan |
|---|---|---|---|
| xGI per 90 | `expected_goal_involvements`, `minutes` | tinggi = baik | Prediktor serangan terkuat |
| Form | `form` | tinggi = baik | Momentum terkini |
| Fixture ease (N GW) | dari `fixtures` + FDR | mudah = baik | Konteks lawan ke depan |
| Keamanan menit | `minutes`, `starts`, `status`, `chance_of_playing_next_round` | tinggi = baik | Penyaring risiko |
| Value | `form` ÷ (`now_cost`/10) | tinggi = baik | Efisiensi budget |
| Ownership (EO) | `selected_by_percent` | **rendah = baik** (differential) | Faktor pembeda |

Tambahan per posisi (lihat 3.5): clean sheet potential & xGC tim untuk GK/DEF.

### 3.2 Normalisasi (min-max, per posisi)

Semua metrik dinormalkan ke skala **0–1** agar bisa digabung. Normalisasi dihitung **relatif terhadap populasi pemain seposisi** (bukan lintas posisi), supaya adil.

Untuk metrik "tinggi = baik":

```
n(x) = (x - min_pos) / (max_pos - min_pos)
```

Untuk metrik "rendah = baik" (mis. ownership pada mode differential, atau FDR):

```
n_inv(x) = 1 - n(x)
```

Selalu **clamp** hasilnya ke rentang [0, 1] untuk menghindari nilai di luar batas akibat outlier.

Sketsa Node.js:
```javascript
function normalize(value, min, max) {
  if (max === min) return 0.5;            // hindari bagi nol
  const n = (value - min) / (max - min);
  return Math.max(0, Math.min(1, n));      // clamp 0..1
}
function normalizeInverse(value, min, max) {
  return 1 - normalize(value, min, max);
}
// min/max dihitung per posisi dari populasi pemain di posisi itu
```

### 3.3 Fixture ease (proyeksi N gameweek)

FDR (Fixture Difficulty Rating) makin rendah makin mudah. Ubah jadi "ease" lalu rata-ratakan beberapa GW ke depan (mis. N = 4):

```
ease_per_gw = 6 - FDR          // FDR 1..5  ->  ease 5..1
fixture_ease = rata-rata(ease_per_gw) untuk N GW ke depan
```

Pertimbangkan bobot menurun (GW terdekat lebih penting) dan tangani double/blank gameweek (jumlah pertandingan berbeda).

### 3.4 Skor komposit — dua lapis

**Lapis 1 — Quality Score** (kualitas murni pemain, 0–1):

| Komponen | Bobot |
|---|---|
| xGI per 90 | 0.30 |
| Form | 0.20 |
| Fixture ease | 0.20 |
| Keamanan menit | 0.15 |
| Value (form/price) | 0.15 |

```
quality_score =
  0.30 * n(xgi_per90) +
  0.20 * n(form) +
  0.20 * n(fixture_ease) +
  0.15 * n(minutes_security) +
  0.15 * n(value)
```

**Lapis 2 — Differential Score** (melapisi ownership di atas quality):

```
eo_factor = n_inv(ownership)                       // 0 = sangat dimiliki, 1 = nyaris tak dimiliki
differential_score = quality_score * (0.6 + 0.4 * eo_factor)
```

Artinya: pemain berkualitas tetap mempertahankan mayoritas skornya, tapi yang ber-EO rendah dapat dorongan, yang ber-EO tinggi kena sedikit penalti. Angka `0.6 / 0.4` bisa kamu tune sesuai selera risiko.

**Filter label "differential pick":** hanya beri label bila
```
ownership < AMBANG_EO (mis. 12%)  DAN  quality_score >= persentil tertentu (mis. top 40% seposisi)
```
Supaya yang muncul bukan sekadar "jarang dimiliki", tapi "jarang dimiliki TAPI bagus".

### 3.5 Penyesuaian per posisi

Skor dihitung **relatif per posisi**, dan bobotnya sedikit berbeda:

| Posisi | Penekanan |
|---|---|
| FWD | xGI/90 bobot lebih besar; clean sheet tidak relevan |
| MID | seimbang xGI/90 + form; sebagian dapat poin clean sheet |
| DEF | tambahkan **clean sheet potential** & **xGC tim**; xGI/90 tetap dihitung (bek nyerang) |
| GK | dominan **clean sheet potential**, **saves**, & xGC tim; abaikan xGI |

Untuk GK/DEF, tambahkan komponen defensif (mis. bobot 0.20) yang diambil dari kekuatan bertahan tim + kemudahan fixture, dan kurangi proporsional dari komponen lain.

### 3.6 Catatan penting metrik
- **Sample size:** di awal musim (pertandingan sedikit), xG belum stabil. Beri penyesuaian/peringatan saat menit main total masih rendah (mis. tampilkan disclaimer bila `minutes < 270`).
- **Aktual vs xG:** hitung selisih `gol_aktual - xG` sebagai sinyal regresi (overperform = waspada turun; underperform = potensi naik). Tampilkan sebagai insight tambahan, bukan bagian skor.
- **Nama field API wajib diverifikasi** langsung dari `bootstrap-static` saat implementasi — struktur bisa berubah.

---

## 4. Fitur Notifikasi Otomatis (dengan tingkat kelayakan)

Model: **cron** menarik data, membandingkan dengan snapshot sebelumnya, mengirim notif saat ada perubahan.

| Fitur | Kelayakan | Cara |
|---|---|---|
| **Perubahan harga** | Tinggi (andal) | Simpan harga harian, bandingkan, notif bila berubah. Bisa juga pantau `transfers_in/out` untuk prediksi arah harga |
| **Update status/cedera** | Tinggi (dari API resmi) | Pantau perubahan `status` (a/i/d/s) & `chance_of_playing_next_round`, notif saat berubah |
| **Ringkasan differential** | Tinggi | Jadwalkan (mis. tiap H-1 deadline) daftar differential pick teratas |
| **Lineup resmi** | Sedang | Ambil lineup saat rilis (±1 jam sebelum kickoff) dari sumber yang menyediakannya |
| **Lineup leak (bocoran)** | Rendah / tidak andal | Tidak ada di API mana pun — berasal dari rumor/berita manusia. Kelola ekspektasi: andalkan lineup resmi, bukan "leak" |

Frekuensi cron: **1× harian** untuk harga/status, plus **menjelang deadline** untuk ringkasan differential & pengingat.

---

## 5. Perintah On-Demand

| Perintah | Fungsi |
|---|---|
| `/player <nama>` | Detail pemain: harga, form, xGI/90, ownership, status, fixture berikutnya, quality & differential score |
| `/compare <A> <B>` | Bandingkan dua pemain berdampingan |
| `/best <posisi>` | Top pemain seposisi berdasarkan quality_score |
| `/differentials [posisi]` | Top differential pick (EO rendah + skor tinggi) |
| `/fixtures <tim>` | Jadwal & tingkat kesulitan N GW ke depan |
| `/regression` | Pemain overperform/underperform vs xG (sinyal beli/jual) |
| `/watch <nama>` | Tambahkan pemain ke daftar pantau pribadi untuk notif |

---

## 6. Arsitektur & Stack

```
Cron (harian + menjelang deadline)
   -> tarik FPL API (bootstrap-static, fixtures, element-summary)
   -> (opsional) scrape Understat secukupnya, cache
   -> simpan snapshot ke DB
   -> bandingkan dgn snapshot sebelumnya (deteksi perubahan harga/status)
   -> hitung metrik + quality_score + differential_score (per posisi)
   -> kirim notif ke Telegram pribadi

Handler perintah (on-demand)
   -> baca data terbaru dari DB (bukan tembak API tiap perintah)
   -> format & balas
```

- **Bahasa:** Node.js.
- **Library Telegram:** `telegraf` atau `node-telegram-bot-api`.
- **HTTP client:** `axios` (untuk FPL API).
- **Penyimpanan:** DB ringan (SQLite/PostgreSQL/MySQL) untuk snapshot harian & daftar pantau. Snapshot penting agar bisa mendeteksi *perubahan* (harga/status) dan menghitung tren.
- **Cache:** simpan hasil tarikan harian; perintah on-demand membaca dari DB/cache, bukan menembak API tiap kali.
- **Scheduler:** `node-cron` atau cron OS.
- **Deployment:** container Docker (ringan, mudah dipindah) atau VPS kecil. Bot harus berjalan terus.

---

## 7. Keamanan & Praktik Baik

- **Token bot** (dari @BotFather) & chat ID disimpan di **environment variable**, jangan di-hardcode di kode atau ter-commit ke Git.
- Hormati **rate limit** FPL API — cukup 1 tarikan harian; jangan polling berlebihan.
- Untuk scraping Understat: cache agresif, jeda antar-request, siap dengan penanganan bila struktur berubah.
- Terapkan **error handling** yang benar pada tiap pemanggilan async (jangan biarkan unhandled rejection) — bedakan "data tidak ada" (wajar) dari "gagal koneksi" (perlu retry).

---

## 8. Yang Perlu Diverifikasi Saat Implementasi

1. **Nama field API FPL** yang sebenarnya (terutama `expected_goal_involvements`, `starts`, `chance_of_playing_next_round`) dari respons `bootstrap-static`.
2. **Struktur FDR** di endpoint `fixtures/` dan cara memetakannya ke tiap pemain via tim.
3. **Ambang & bobot** (AMBANG_EO, bobot komposit, faktor 0.6/0.4 differential) — tune setelah melihat data nyata beberapa gameweek.
4. **Legalitas/ToS** sumber scraping bila memutuskan memakai Understat.
