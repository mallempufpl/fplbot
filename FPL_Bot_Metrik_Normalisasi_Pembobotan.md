# FPL Bot — Rumus Normalisasi & Pembobotan Metrik Analisa Pemain

Dokumen acuan untuk mesin skoring pemain FPL. Tujuannya: mengubah banyak
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
6. **Sadar tren jangka panjang.** Data 3 musim terakhir digunakan untuk mendeteksi pola IMPROVING, CONSISTENT, atau DECLINING.

---

## 2. Daftar Metrik, Field API, dan Arah

Arah = apakah nilai lebih besar itu lebih baik (+) atau lebih kecil lebih baik (-).

| Metrik | Field API / Sumber | Arah | Kategori |
|---|---|---|---|
| xGI per 90 | `expected_goal_involvements`, `minutes` | + | Underlying |
| Form | `form` | + | Momentum |
| Value (form per juta) | `form`, `now_cost` | + | Efisiensi |
| Kemudahan fixture (proyeksi) | dihitung dari FDR fixtures | + | Konteks |
| Keamanan menit | `minutes`, `starts`, `chance_of_playing_next_round`, `status` | + | Risiko |
| xGC per 90 (GK/DEF) | `expected_goals_conceded`, `minutes` | - | Defensif |
| Clean sheet potential (GK/DEF) | dari kekuatan bertahan tim + fixture | + | Defensif |
| **Trend (historis 3 musim)** | GitHub CSV: PP90, xGI/90, minutes, ICT | + | Tren jangka panjang |
| Ownership | `selected_by_percent` | n/a | Label strategi (bukan komponen skor) |

`now_cost` bersatuan 0,1 juta -> harga juta = `now_cost / 10`.

---

## 3. Normalisasi (menyamakan skala ke 0-1)

Tiap metrik punya skala berbeda. Sebelum digabung, semua harus dibawa ke rentang **0-1**.

### 3a. Percentile Rank (metode utama)

Pakai **peringkat relatif** pemain dalam populasi seposisi. Hasilnya selalu 0-1, tidak terganggu outlier.

```
n(x) = (jumlah pemain dengan nilai < x) / (total pemain - 1)
```

Untuk arah - (mis. xGC), gunakan `1 - percentile_rank`.

### 3b. Min-Max (untuk metrik terbatas)

Untuk metrik yang sudah terbatas skalanya (form, chance_of_playing):

```
n(x) = (x - min) / (max - min)     // arah +
n(x) = (max - x) / (max - min)     // arah -
```

`min` dan `max` diambil dari populasi pemain seposisi. Nilai di-clamp ke [0, 1].

---

## 4. Normalisasi Per Posisi

Bandingkan pemain hanya dengan yang **seposisi**:
1. Kelompokkan pemain berdasarkan `element_type` (1=GK, 2=DEF, 3=MID, 4=FWD).
2. Untuk tiap grup, hitung statistik populasi (sorted array untuk percentile, min/max untuk min-max).
3. Normalisasi tiap pemain terhadap statistik grupnya sendiri.

Skor 0.9 pada seorang bek berarti "bek yang sangat bagus relatif terhadap bek lain".

---

## 5. Penyesuaian Sample Size (Shrinkage)

Di awal musim, xGI/90 bisa menyesatkan. Tarik nilai pemain ke rata-rata posisinya:

```
w = min(minutes / 450, 1)           // 0 = belum kredibel, 1 = kredibel penuh
nilai_disesuaikan = w * nilai_pemain + (1 - w) * rata_rata_posisi
```

Terapkan terutama pada metrik per-90 (xGI/90, xGC/90).

---

## 6. Proyeksi Kemudahan Fixture

FDR bernilai 1 (mudah) sampai 5 (sulit). Ubah jadi skor kemudahan 0-1:

```
ease = (6 - FDR) / 5               // FDR 1 -> 1.0 ; FDR 5 -> 0.2
ease_adj = ease * (kandang ? 1.05 : 0.95)
```

Proyeksi tertimbang untuk N=4 gameweek, bobot menurun:

```
bobot = [0.40, 0.30, 0.20, 0.10]
fixture_score = sum(ease_adj[i] * bobot[i]) untuk i = 0..3
```

Penanganan khusus:
- **Double gameweek** (2 laga dalam 1 GW): skor lebih tinggi.
- **Blank gameweek** (tidak ada laga): ease = 0 untuk GW itu.

---

## 7. Skor Keamanan Menit

Gabungkan tiga sinyal jadi satu nilai 0-1:

```
p_main    = (chance_of_playing_next_round ?? 100) / 100
rasio_start = starts / laga_tim
tersedia  = status == 'a' ? 1 : status == 'd' ? 0.5 : 0

minutes_security = 0.5 * p_main + 0.3 * rasio_start + 0.2 * tersedia
```

Pemain dengan `minutes_security < 0.25` diberi label "risiko rotasi/cedera".

---

## 8. Trend Score (Historis 3 Musim)

### 8.1 Sumber Data

Data diambil dari GitHub repo `vaastav/Fantasy-Premier-League` (CSV) untuk 3 musim:
- 2022-23
- 2023-24
- 2024-25

Pemain di-match antar musim menggunakan key `first_name|second_name`.

### 8.2 Metrik per Musim

Untuk setiap pemain per musim, dihitung:
- **PP90** — Points per 90 minutes
- **xGI/90** — Expected Goal Involvement per 90
- **Minutes** — Total menit bermain
- **ICT** — Influence + Creativity + Threat index

### 8.3 Trend Analysis (Linear Regression)

Untuk setiap metrik, dilakukan linear regression sederhana terhadap urutan musim:

```
slope = trend direction (naik/turun)
trend_score per metrik = berdasarkan slope (0-100)
```

Gabungan trend score dari semua metrik menjadi skor trend keseluruhan (0-100):
- **65+** = `IMPROVING` — performa naik signifikan
- **35-65** = `CONSISTENT` — stabil
- **< 35** = `DECLINING` — performa menurun

### 8.4 Consistency Score

Menggunakan **Coefficient of Variation (CV)** pada metrik lintas musim:
```
CV = standard_deviation / mean
consistency = (1 - CV) * 100    // semakin rendah CV = semakin konsisten
```

### 8.5 Integrasi ke Quality Score

Trend score dinormalisasi via percentile rank per posisi, kemudian masuk sebagai komponen skor komposit dengan bobot yang berbeda per posisi (lihat bagian 9).

---

## 9. Pembobotan Per Posisi

Setelah semua komponen dinormalisasi ke 0-1, gabungkan dengan bobot berbeda per posisi:

| Komponen (0-1) | GK | DEF | MID | FWD |
|---|---|---|---|---|
| xGI per 90 | 5% | 15% | 30% | 35% |
| Form | 18% | 16% | 15% | 15% |
| Fixture (proyeksi) | 18% | 18% | 16% | 14% |
| Keamanan menit | 18% | 13% | 13% | 13% |
| Value (form/juta) | 8% | 10% | 13% | 11% |
| Defensif (xGC + CS) | 20% | 15% | — | — |
| **Trend (historis)** | **13%** | **15%** | **17%** | **16%** |
| **Total** | **100%** | **~100%** | **~100%** | **~100%** |

Bobot bisa dikustomisasi oleh owner via `/metrics weight <metric> <GK> <DEF> <MID> <FWD>`.
Konfigurasi disimpan di env `METRICS_WEIGHTS` dan `METRICS_ACTIVE`.

---

## 10. Skor Komposit Akhir

### Quality Score (0-100)

```
skor_0_1 = sum(komponen_i * bobot_i)
quality_score = round(skor_0_1 * 100)
```

### Differential Score

Ownership tidak menambah "kualitas", tapi digunakan sebagai pengali strategi:

```
eo_factor = 1 - percentile_rank(ownership)     // inverse: rendah = tinggi
differential_score = quality_score * (0.6 + 0.4 * eo_factor)
```

Pemain berkualitas tetap mempertahankan mayoritas skornya, tapi yang ber-EO rendah dapat dorongan.

---

## 11. Label Pemain

### Label Strategi

```
ownership < 10% DAN quality_score >= top 40% seposisi  -> "DIFFERENTIAL"
ownership > 40%                                         -> "TEMPLATE"
lainnya                                                 -> "REGULAR"
```

### Label Regresi xG

Bandingkan gol aktual vs xG:

```
selisih > 2   -> "OVERPERFORMING" (waspada regresi turun)
selisih < -2  -> "UNDERPERFORMING" (potensi regresi naik)
```

Dengan data historis 3 musim, ditambah label enhanced:

```
overperform multi-musim -> "CLINICAL_FINISHER" (genuinely good finisher)
underperform kronis     -> "POOR_FINISHER" (conversion issue persisten)
```

### Label Trend

```
trend_score >= 65 -> "IMPROVING"
trend_score 35-65 -> "CONSISTENT"
trend_score < 35  -> "DECLINING"
```

---

## 12. Transfer Suggestions (/suggest)

Algoritma untuk merekomendasikan transfer:

1. Ambil squad user via FPL API (picks + transfer history).
2. Identifikasi 5 pemain terlemah di starting XI berdasarkan quality score.
3. Untuk setiap pemain lemah, cari pengganti terbaik yang:
   - Posisi sama
   - Belum di squad
   - Masuk budget (selling price + bank)
   - Pernah main + aman menit
   - Max 3 pemain per tim
   - Quality score lebih tinggi
4. Sort candidates: quality score + bonus trend (IMPROVING +5, DECLINING -5).
5. Filter: minimal peningkatan 5 poin quality score.
6. Generate alasan: fixture, form, differential, regresi, trend historis, konsistensi.
7. Tambahkan berita terkait pemain dari X/Instagram.
8. Tampilkan top 3 saran transfer.

---

## 13. Catatan Tuning & Validasi

- **Verifikasi field API** saat implementasi — struktur bisa berubah.
- **Awal musim (GW < 5):** shrinkage membantu, tapi pertimbangkan juga naikkan bobot `form` & `fixture`.
- **Cache** statistik populasi per posisi — tidak perlu dihitung ulang tiap request (TTL 10 menit).
- **Validasi** dengan membandingkan ranking skor bot vs poin aktual beberapa GW berikutnya.
- **Konfigurasi** bobot, ambang label, dan metrik aktif bisa diubah via `/metrics` tanpa edit kode.
- Data historis di-refresh otomatis weekly dan bisa di-force via `/refreshhistory`.
- Skor ini alat bantu — selalu tampilkan komponen mentahnya juga agar pengguna bisa menilai sendiri.
