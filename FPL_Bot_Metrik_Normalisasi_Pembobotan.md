# FPL Bot — Rumus Normalisasi & Pembobotan Metrik Analisa Pemain

Dokumen acuan untuk membangun mesin skoring pemain FPL. Tujuannya: mengubah banyak
metrik mentah dengan skala berbeda menjadi **satu skor komposit 0–100** yang bisa
diranking secara adil, terutama untuk keputusan gameweek berikutnya (forward-looking).

> Catatan: nama field API (mis. `expected_goal_involvements`) mengacu pada struktur
> `bootstrap-static` FPL dan perlu diverifikasi langsung saat implementasi, karena bisa berubah.

---

## 1. Prinsip Dasar

1. **Prediktif > historis.** Bobot terbesar pada *underlying stats* (xGI) dan form, bukan total poin musim.
2. **Adil antar pemain.** Semua metrik "per 90 menit" agar tidak bias ke pemain bermenit banyak.
3. **Bandingkan seposisi.** Normalisasi dilakukan **per posisi** (GK/DEF/MID/FWD), bukan lintas posisi.
4. **Sadar risiko.** Menit main tidak aman menurunkan skor, sebagus apa pun statistiknya.
5. **Sadar sample size.** Di awal musim, statistik ditarik ke rata-rata (shrinkage) agar tidak menyesatkan.

---

## 2. Daftar Metrik, Field API, dan Arah

Arah = apakah nilai lebih besar itu lebih baik (↑) atau lebih kecil lebih baik (↓).

| Metrik | Field API (perkiraan) | Arah | Kategori |
|---|---|---|---|
| xGI per 90 | `expected_goal_involvements`, `minutes` | ↑ | Underlying |
| Form | `form` | ↑ | Momentum |
| Points per game | `points_per_game` | ↑ | Performa |
| Value (form per juta) | `form`, `now_cost` | ↑ | Efisiensi |
| Kemudahan fixture (proyeksi) | dihitung dari FDR fixtures | ↑ | Konteks |
| Keamanan menit | `minutes`, `starts`, `chance_of_playing_next_round`, `status` | ↑ | Risiko |
| xGC per 90 (khusus GK/DEF) | `expected_goals_conceded`, `minutes` | ↓ | Defensif |
| Clean sheet potential (GK/DEF) | dari kekuatan bertahan tim + fixture | ↑ | Defensif |
| Ownership | `selected_by_percent` | — | Label strategi |

`now_cost` bersatuan 0,1 juta → harga juta = `now_cost / 10`.

---

## 3. Normalisasi (menyamakan skala ke 0–1)

Tiap metrik punya skala berbeda (form 0–15, harga 4.0–15.0, xGI/90 0–1.5). Sebelum
digabung, semua harus dibawa ke rentang **0–1**. Ada dua metode; pilih salah satu
(atau sediakan keduanya sebagai opsi).

### 3a. Min-Max (sederhana, intuitif)

Untuk metrik **↑ (lebih besar lebih baik):**

```
n(x) = (x - min) / (max - min)
```

Untuk metrik **↓ (lebih kecil lebih baik)** — dibalik:

```
n(x) = (max - x) / (max - min)
```

`min` dan `max` diambil dari **populasi pemain seposisi** (lihat bagian 4).

**Masalah:** sensitif terhadap outlier. Contoh: xGI Haaland yang ekstrem membuat `max`
melonjak, sehingga pemain lain terlihat kecil semua. Solusinya **winsorize/clamp**:
potong nilai ekstrem ke persentil 5 dan 95 sebelum normalisasi.

```
lo = persentil_5(populasi)
hi = persentil_95(populasi)
x_clamped = clamp(x, lo, hi)
n(x) = (x_clamped - lo) / (hi - lo)      // untuk arah ↑
```

### 3b. Percentile Rank (lebih tahan outlier — direkomendasikan)

Alih-alih memakai nilai absolut, pakai **peringkat relatif** pemain dalam populasi
seposisi. Hasilnya selalu 0–1, tidak terganggu outlier, dan mudah dibaca ("pemain ini
di persentil ke-80 untuk xGI").

```
n(x) = (jumlah pemain dengan nilai < x) / (total pemain - 1)
```

Untuk arah ↓ (mis. xGC), gunakan `1 - percentile_rank`.

> **Rekomendasi:** pakai **percentile rank** untuk metrik yang rawan outlier (xGI, value),
> dan min-max ter-clamp untuk metrik yang sudah terbatas (form, chance_of_playing).

---

## 4. Normalisasi Per Posisi

Bandingkan pemain hanya dengan yang **seposisi**. Kiper tidak diadu xGI-nya dengan penyerang.

Langkah:
1. Kelompokkan pemain berdasarkan `element_type` (1=GK, 2=DEF, 3=MID, 4=FWD).
2. Untuk tiap grup, hitung `min`, `max`, `mean`, `std`, atau tabel percentile **per grup**.
3. Normalisasi tiap pemain terhadap statistik grupnya sendiri.

Konsekuensi: skor 0.9 pada seorang bek berarti "bek yang sangat bagus", bukan
dibandingkan dengan penyerang.

---

## 5. Penyesuaian Sample Size (Shrinkage)

Di awal musim (menit sedikit), xGI/90 bisa menyesatkan — satu pertandingan bagus bikin
angka melambung. Solusinya: tarik nilai pemain ke **rata-rata posisinya** sebanding
dengan sedikitnya menit main.

Hitung bobot keyakinan berdasarkan menit (450 menit ≈ 5 laga penuh dianggap "cukup"):

```
w = min(minutes / 450, 1)          // 0 = belum kredibel, 1 = kredibel penuh
```

Lalu blend statistik pemain dengan rata-rata posisinya:

```
nilai_disesuaikan = w * nilai_pemain + (1 - w) * rata_rata_posisi
```

Terapkan terutama pada metrik per-90 (xGI/90, xGC/90). Efeknya: pemain dengan menit
sangat sedikit tidak langsung menduduki peringkat atas hanya karena kebetulan.

---

## 6. Proyeksi Kemudahan Fixture

FDR bernilai 1 (mudah) sampai 5 (sulit). Ubah jadi **skor kemudahan** 0–1, lalu
rata-ratakan beberapa GW ke depan dengan bobot menurun (GW terdekat lebih penting).

Konversi satu fixture:

```
ease = (6 - FDR) / 5          // FDR 1 → 1.0 ; FDR 5 → 0.2
```

Opsional beri bonus kandang / penalti tandang:

```
ease_adj = ease * (kandang ? 1.05 : 0.95)
```

Proyeksi tertimbang untuk N gameweek (mis. N=4), bobot menurun:

```
bobot = [0.40, 0.30, 0.20, 0.10]      // total = 1
fixture_score = Σ (ease_adj[i] * bobot[i])   untuk i = 0..N-1
```

Penanganan khusus:
- **Double gameweek** (2 laga dalam 1 GW): jumlahkan ease kedua laga → skor lebih tinggi.
- **Blank gameweek** (tidak ada laga): ease = 0 untuk GW itu.

`fixture_score` sudah dalam rentang 0–1, siap dimasukkan ke skor komposit.

---

## 7. Skor Keamanan Menit

Gabungkan tiga sinyal jadi satu nilai 0–1:

```
p_main   = (chance_of_playing_next_round ?? 100) / 100      // 0–1
rasio_start = starts / laga_tim_sejauh_ini                  // 0–1
tersedia  = (status == 'a') ? 1 : (status == 'd' ? 0.5 : 0) // a/d/i/s

minutes_security = 0.5 * p_main + 0.3 * rasio_start + 0.2 * tersedia
```

Nilai ini juga bisa dipakai sebagai **gerbang (gate)**: pemain dengan
`minutes_security < 0.25` bisa diberi label "risiko rotasi/cedera" dan dikeluarkan dari
rekomendasi utama, terlepas dari skornya.

---

## 8. Pembobotan Per Posisi

Setelah semua komponen dinormalisasi ke 0–1, gabungkan dengan **bobot yang berbeda per
posisi**. Penyerang/gelandang menekankan serangan; kiper/bek menekankan pertahanan.

| Komponen (0–1) | GK | DEF | MID | FWD |
|---|---|---|---|---|
| xGI per 90 | 0.05 | 0.15 | 0.32 | 0.38 |
| Form | 0.20 | 0.18 | 0.18 | 0.18 |
| Fixture (proyeksi) | 0.20 | 0.20 | 0.18 | 0.16 |
| Keamanan menit | 0.20 | 0.15 | 0.15 | 0.15 |
| Value (form/juta) | 0.10 | 0.12 | 0.15 | 0.13 |
| Defensif (xGC↓ + clean sheet) | 0.25 | 0.20 | — | — |
| **Total** | **1.00** | **1.00** | **1.00** | **1.00** |

Bobot di atas adalah **titik awal** — sesuaikan (tuning) setelah melihat hasil nyata.
Simpan bobot di file konfigurasi terpisah agar mudah diubah tanpa menyentuh kode.

---

## 9. Skor Komposit Akhir

Jumlahkan komponen ternormalisasi × bobot, lalu skala ke 0–100 agar mudah dibaca:

```
skor_0_1 = Σ (komponen_i * bobot_i)
skor_akhir = round(skor_0_1 * 100)
```

Karena semua komponen 0–1 dan bobot berjumlah 1, hasilnya otomatis 0–1 → 0–100.

---

## 10. Ownership — Label, Bukan Bagian Skor

Ownership tidak menambah "kualitas" pemain, jadi **jangan** dimasukkan ke skor. Pakai
sebagai penanda strategi terpisah:

```
own = parseFloat(selected_by_percent)

label =
  own < 10  && skor_akhir >= 70 ? "DIFFERENTIAL"   // bagus tapi jarang dimiliki
  own > 40                        ? "TEMPLATE"       // wajib pertimbangkan
                                    "REGULAR"
```

Tambahan insight overperformance (regresi) — bandingkan gol aktual vs xG:

```
selisih = goals_scored - expected_goals
selisih > 2  → "OVERPERFORMING (waspada regresi turun)"
selisih < -2 → "UNDERPERFORMING (potensi regresi naik / beli murah)"
```

---

## 11. Sketsa Implementasi (Node.js)

```javascript
// --- util normalisasi ---
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

function percentileRank(value, sortedArr) {
  // sortedArr = nilai populasi seposisi, urut menaik
  let count = 0;
  for (const v of sortedArr) if (v < value) count++;
  return sortedArr.length > 1 ? count / (sortedArr.length - 1) : 0;
}

function minMax(x, lo, hi, invert = false) {
  if (hi === lo) return 0;
  const n = (clamp(x, lo, hi) - lo) / (hi - lo);
  return invert ? 1 - n : n;
}

// --- komponen per pemain ---
function per90(stat, minutes) {
  return minutes > 0 ? (stat / minutes) * 90 : 0;
}

function shrink(nilaiPemain, minutes, rataPosisi) {
  const w = Math.min(minutes / 450, 1);
  return w * nilaiPemain + (1 - w) * rataPosisi;
}

function fixtureScore(nextFixtures) {
  const bobot = [0.40, 0.30, 0.20, 0.10];
  let s = 0;
  nextFixtures.slice(0, 4).forEach((f, i) => {
    let ease = (6 - f.fdr) / 5;
    ease *= f.isHome ? 1.05 : 0.95;
    s += ease * (bobot[i] ?? 0);
  });
  return clamp(s, 0, 1);
}

function minutesSecurity(p) {
  const pMain = (p.chance_of_playing_next_round ?? 100) / 100;
  const rasioStart = p.teamGames ? p.starts / p.teamGames : 0;
  const tersedia = p.status === 'a' ? 1 : p.status === 'd' ? 0.5 : 0;
  return 0.5 * pMain + 0.3 * rasioStart + 0.2 * tersedia;
}

// --- skor komposit (dipanggil setelah statistik populasi per posisi dihitung) ---
const BOBOT = {
  1: { xgi:0.05, form:0.20, fixture:0.20, minutes:0.20, value:0.10, def:0.25 }, // GK
  2: { xgi:0.15, form:0.18, fixture:0.20, minutes:0.15, value:0.12, def:0.20 }, // DEF
  3: { xgi:0.32, form:0.18, fixture:0.18, minutes:0.15, value:0.15, def:0.00 }, // MID
  4: { xgi:0.38, form:0.18, fixture:0.16, minutes:0.15, value:0.13, def:0.00 }, // FWD
};

function hitungSkor(p, pop) {
  // pop = statistik populasi seposisi (array nilai untuk percentileRank, dsb.)
  const w = BOBOT[p.element_type];

  const xgi90  = shrink(per90(p.expected_goal_involvements, p.minutes), p.minutes, pop.xgi90Mean);
  const value  = parseFloat(p.form) / (p.now_cost / 10);

  const n = {
    xgi:     percentileRank(xgi90, pop.xgi90Sorted),
    form:    minMax(parseFloat(p.form), pop.formLo, pop.formHi),
    fixture: fixtureScore(p.nextFixtures),
    minutes: minutesSecurity(p),
    value:   percentileRank(value, pop.valueSorted),
    def:     w.def > 0
               ? percentileRank(-per90(p.expected_goals_conceded, p.minutes), pop.xgcNegSorted)
               : 0,
  };

  const skor01 =
    w.xgi*n.xgi + w.form*n.form + w.fixture*n.fixture +
    w.minutes*n.minutes + w.value*n.value + w.def*n.def;

  return { skor: Math.round(skor01 * 100), komponen: n };
}
```

---

## 12. Catatan Tuning & Validasi

- **Verifikasi field API** dulu (nama & satuan) sebelum mengandalkan rumus di atas.
- **Awal musim (GW < 5):** naikkan bobot `form` & `fixture`, turunkan `xgi` karena data masih tipis; shrinkage sudah membantu tapi bobot juga bisa disesuaikan.
- **Cache** statistik populasi per posisi per GW — tidak perlu dihitung ulang tiap request.
- **Validasi** dengan membandingkan ranking skor bot vs poin aktual beberapa GW berikutnya; setel ulang bobot bila perlu.
- **Pisahkan konfigurasi** (bobot, N fixture, ambang label) ke file terpisah agar mudah di-tune tanpa mengubah logika.
- Skor ini alat bantu, bukan kebenaran mutlak — selalu tampilkan komponen mentahnya juga agar pengguna bisa menilai sendiri.
