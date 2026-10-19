# 🎤 FLOW PROSES — Bot Pencatat Keuangan AI
*Bahan presentasi: dari input sampai output, disusun dari perilaku bot yang sebenarnya berjalan.*

---

## 1) Versi Sederhana — 5 Langkah (untuk pembukaan presentasi)

```
   KAMU                          BOT                              HASIL
┌─────────────┐          ┌───────────────────┐          ┌────────────────────────┐
│ 1. TULIS DI │   ───▶   │ 2. AI MEMBACA &   │   ───▶   │ 4. PAPAN CATATAN       │
│    DISCORD  │          │    MENafsirkan    │          │    (Google Sheets)     │
│ "bayar      │          │ 3. RAPIKAN: jenis,│          │                        │
│ parkir 2    │          │    jumlah,        │          │ 5. BOT MEMBALAS        │
│ ribu"       │          │    kategori       │          │    "+ saldo terkini"   │
└─────────────┘          └───────────────────┘          └────────────────────────┘
```

**Analogi:** kamu punya *sekretaris pribadi AI* (Gemini) yang mendengarkan, menulis rapi di
*papan catatan bersama* (Google Sheets), dan setiap kali kamu bertanya, dia **menghitung sendiri
angkanya dari papan catatan** — bukan menebak.

---

## 2) Diagram Utama — Input → Output (lengkap)

```
                       ┌──────────────────────────────────────────┐
                       │            USER DI DISCORD               │
                       └────────────────────┬─────────────────────┘
                                            │  (1) pesan masuk
                                            ▼
                             ┌──────────────────────────────┐
                             │      ROUTER (src/index.js)   │
                             │  Cek: bot? kosong?           │
                             └───┬──────────────┬───────────┘
              mulai dengan "!"   │              │  chat biasa
                                 ▼              ▼
                ┌─────────────────────┐   ┌─────────────────────────┐
                │  PERINTAH LOKAL     │   │  GATING (hemat kuota AI)│
                │  src/commands.js    │   │  Hanya jika:            │
                │                     │   │  • di channel keuangan, │
                │  !help !rekap       │   │  • ATAU bot di-mention, │
                │  !hapus !kategori   │   │  • ATAU lewat DM        │
                │  (TANPA AI — gratis)│   └──────────┬──────────────┘
                └─────────┬───────────┘              │  lolos
                          │                          ▼
                          │           ┌─────────────────────────────┐
                          │           │  GEMINI AI (src/parser.js)  │
                          │           │  Klasifikasi 1 x panggil:   │
                          │           │   A. TRANSACTION            │
                          │           │   B. QUESTION               │
                          │           │   C. OTHER (obrolan biasa)  │
                          │           └───────┬──────────┬──────────┘
                          │      A ▼          │      B   ▼         ▼ C
                          │  ┌────────────┐   │  ┌────────────────┐ ┌──────────────┐
                          │  │ normalisasi│   │  │ ambil data user│ │ balas contoh │
                          │  │ & validasi │   │  │ dari Sheets    │ │ format       │
                          │  └─────┬──────┘   │  └───────┬────────┘ └──────────────┘
                          │        ▼          │          ▼
                          │  ┌────────────┐   │  ┌─────────────────────┐
                          │  │ SIMPAN ke  │   │  │ ANGKA DIHITUNG KODE │
                          │  │ Sheets     │   │  │ (bukan AI - akurat) │
                          │  └─────┬──────┘   │  └───────┬─────────────┘
                          │        ▼          │          ▼
                          │  ┌────────────┐   │  ┌─────────────────────┐
                          └─▶│ embedding  │◀──┼──│ AI MENYUSUN JAWABAN │
                             │ keluar     │   │  │ dari angka fix itu  │
                             └─────┬──────┘   │  └─────────────────────┘
                                   ▼          │
                       ┌──────────────────────▼───────────────────────┐
                       │      DUA POT DI SAMA → DIBALAS DI DISCORD     │
                       │  ✅ embed "tercatat + saldo bulan ini"        │
                       │  💬 jawaban tanya-jawab (angka pasti)          │
                       └──────────────────────────────────────────────┘
```

---

## 3) Alur A — Catat Transaksi Biasa *("bayar parkir 2 ribu")*

Tahap demi tahap, dengan **nilai asli** di tiap langkah:

| # | Tahap | Apa yang terjadi | Contoh nilai |
|---|---|---|---|
| 1 | **Input** | User menulis bebas di Discord | `bayar parkir 2 ribu` |
| 2 | **Router** | Bukan perintah `!`, ada di channel keuangan → diteruskan | — |
| 3 | **Rate-limit** | Batas 8 chat AI / menit per user | OK |
| 4 | **AI klasifikasi (Gemini)** | 1 panggilan REST, respons JSON | `{"intent":"TRANSACTION", "transaction_type":"EXPENSE", "group":"EXPENSE", "amount":2000, "category":"Transportasi", "description":"Parkir"}` |
| 5 | **Validasi kode** | kategori HARUS ada di daftar kategori dinamis (tab `Categories`); grup mengikuti kategori; nominal ≥ 0 | gagal → fallback `Lainnya` |
| 6 | **Simpan (Sheets)** | tambah baris di tab `Transactions` (12 kolom) | `baris #52` |
| 7 | **Agregasi kode** | hitung total bulan berjalan: pendapatan−pengeluaran−tabungan = kas tersisa | `margin: −Rp350.000` |
| 8 | **Output embed** | bot mengedit balasannya | 🛒 **Pengeluaran tercatat** · Parkir — Rp2.000 · footer `ID #52` |

**Format uang yang dipahami AI:** `2 ribu`=2.000 · `15k`=15.000 · `300rb`=300.000 · `2,5 jt`=2.500.000 · `3.500.000` langsung.

---

## 4) Alur B — Multi-Transaksi dalam 1 Chat

Satu pesan → beberapa baris. AI memecah berdasarkan penghubung "kemudian / lalu / dan / … buat …" (maks. 6 item).

```
 "gaji 3.500.000 kemudian ditabung 500.000"
        │
        ▼  AI → items[2]
 ┌─────────────────────────────┐    ┌─────────────────────────────┐
 │ item 1: INCOME / INCOME     │    │ item 2: EXPENSE / SAVINGS   │
 │ Gaji — Rp3.500.000          │    │ Menabung — Rp500.000        │
 └──────────────┬──────────────┘    └──────────────┬──────────────┘
                ▼                                  ▼
        baris #48 (gaji)                   baris #49 (menabung)
                └───────► 1 embed gabungan ◄──────┘
                          "✅ 2 transaksi tercatat"
                          footer: Batal: !hapus 48 · !hapus 49
```

**Semantik margin = kas tersisa** (bukan sekadar pendapatan − pengeluaran):

```
kas tersisa = pendapatan − pengeluaran(konsumsi) − tabungan(setor bersih)

Contoh 1: gaji 3.5jt lalu ditabung 500rb → pendapatan 3.5jt, tabungan +500rb, KAS TERSISA = 3.0jt   (pendapatan "berkurang" 500rb ✓)
Contoh 2: ambil tabungan 500rb buat sepatu → tabungan −500rb, pengeluaran 500rb, KAS TERSISA = 0   ✓
```

---

## 5) Alur C — Tanya-Jawab Data *("berapa pengeluaran bulan ini?")*

```
 Pertanyaan user
      │
      ▼  Gemini bilang: intent = QUESTION
 ┌─────────────────────────────────────────────────┐
 │ AMBIL DATA USER (Sheets, filter user_id sendiri) │
 └──────────────────┬──────────────────────────────┘
                    ▼
 ┌─────────────────────────────────────────────────┐
 │ HITSUNG SENDIRI DI KODE (paling penting!):      │
 │  • pendapatan / pengeluaran / tabungan / margin │
 │  • per kategori, hari ini, bulan lalu           │
 │  • max 150 transaksi terakhir                   │
 └──────────────────┬──────────────────────────────┘
                    ▼
 ┌─────────────────────────────────────────────────┐
 │ GEMINI: "susun jawaban santai dari angka ini"   │
 │ (AI hanya berbicara, tidak menimbang angka)     │
 └──────────────────┬──────────────────────────────┘
                    ▼
 💬 jawaban di Discord (≤10 kalimat, format Rp)
```

> **Poin presentasi:** semua angka dihitung program; AI **dilarang** menimbang —
> sehingga jawaban tidak ada peluang salah hitung. Kalau data tidak ada, AI diperintah **jujur bilang tidak ada**.

---

## 6) Alur D — Perintah Gratis-AI (`!`)

Perintah **tidak pernah menyentuh Gemini** → tetap berfungsi walau kuota AI habis.

| Perintah | Alur singkat |
|---|---|
| `!rekap` | baca baris user dari Sheets → agregasi kode → embed (pendapatan / pengeluaran / tabungan / kas tersisa / top kategori) · variasi: `hari`, `1-12` bulan, `lalu`, `all` |
| `!hapus 52` | cek pemilik baris & status → ubah `status` jadi `DELETED` (soft delete, jejak tetap) → rekap otomatis ikut |
| `!kategori` | list 3 kelompok dari tab `Categories` |
| `!kategori tambah tabungan Dana Kuliah` | tulis baris baru ke tab `Categories` → parser AI **langsung ikut** memakai kategori baru |
| `!kategori hapus / pindah / reset` | kelola daftar — semua tersimpan di Sheets, bukan di dalam bot |

---

## 7) Alur E — Kelompok Kategori & Struktur Data

```
PENGGUNA MENULIS            AI MEMILIH KATEGORI             TERSIMPAN
─────────────────          (dr daftar dinamis)             BARIS #52
                                              ┌────────────────────────────────┐
"bayar parkir 2 ribu"   ──▶  Transportasi  ──▶ │ ... type=EXPENSE               │
                                              │ category=Transportasi          │
                                              │ group=EXPENSE  amount=2000     │
"menabung 100 rb"       ──▶  Tabungan ──────▶ │ ... type=EXPENSE               │
                                              │ category=Tabungan              │
                                              │ group=SAVINGS  amount=100000   │
"gajian 3 juta"         ──▶  Gaji ──────────▶ │ ... type=INCOME                │
                                              │ category=Gaji                  │
                                              │ group=INCOME   amount=3000000  │
                                              └────────────────────────────────┘
```

Tab `Categories` (dikelola lewat `!kategori`):

| name | group |
|---|---|
| Gaji, Bonus, Penjualan, Hadiah, Lainnya | INCOME (Pendapatan) |
| Makanan, Transportasi, Belanja, Tagihan, Hiburan, Kesehatan, Pendidikan, Lainnya | EXPENSE (Pengeluaran) |
| Tabungan, Investasi, Dana Darurat | SAVINGS (Tabungan) |

---

## 8) Infrastruktur 24/7 (tanpa kartu kredit)

```
  Kamu (siapa pun, kapan pun)          GitHub Cloud (server gratis)            Google Cloud
────────────────────────         ─────────────────────────────────       ────────────────────
   Chat Discord  ◀──────────────▶  [Bot Node.js di GitHub Actions]  ◀────▶  Sheets (data)
        ⓘ                Discord Gateway                 Gemini API + Sheets API
```

- Job GitHub Actions hidup ± 6 jam, lalu **schedule otomatis menjalankan ulang** (07/13/19/01 WIB) + auto-restart 5 detik bila crash.
- Laptop **boleh mati** — bot tetap jalan. Semua secret via GitHub Secrets, tidak ada di repositori.
- Semua komponen gratis: Discord · Gemini API · Google Sheets · GitHub Actions.

---

## 9) Lembar Uji — contoh nyata untuk demo live

| Input di Discord | Yang dibalas bot |
|---|---|
| `bayar parkir 2 ribu` | 🛒 Pengeluaran tercatat · Transportasi · Rp2.000 |
| `makan siang 15k` | 🛒 · Makanan · Rp15.000 |
| `gajian 3 juta` | 💰 Pendapatan · Gaji · Rp3.000.000 |
| `menabung 100rb` | 🏦 Tabungan · Tabungan · Rp100.000 |
| `gaji 3.500.000 kemudian ditabung 500.000` | ✅ 2 transaksi: #A Pendapatan 3.5jt + #B Tabungan 500rb |
| `ambil tabungan 500.000 buat beli sepatu` | ✅ 2 transaksi: Tarik tabungan 500rb + Beli sepatu 500rb |
| `!rekap` | 📊 Pendapatan/Pengeluaran/Tabungan/Kas tersisa + top kategori |
| `!kategori` | 🏷️ daftar 3 kelompok |
| `berapa margin bulan ini` | 💬 angka = hasil hitung kode (bukan tebakan AI) |
| `halo` | ✏️ bot minta contoh format — tidak menyimpan apa-apa |

---

## 10) Skenario Slide Copy Ready (saran alur presentasi)

1. **Slide masalah** — "catat keuangan itu malas... karena harus buka aplikasi & isi form" → demo: cukup menulis dalam bahasa biasa.
2. **Slide 5-langkah** (bagian 1) — tampilkan versi sederhana dulu.
3. **Slide Live Demo** — pakai tabel di bagian 9, mulai jilid input ringan → multi-transaksi → rekap.
4. **Slide "angka pasti, bahasa luwes"** (bagian 5) — menjelaskan mengapa halusinasi angka AI justru dihindari dengan design.
5. **Slide infrastruktur nol-biaya** (bagian 8) — semua komponen gratis + 24/7 tanpa kartu kredit.
6. **Slide multi-user & privasi** — data per-`user_id`, tak tercampur antar-pengguna; data rawak milik tabel Sheet milikmu sendiri.
7. **Slide roadmap** — ide berikutnya: catat mundur (` tanggal`) & budget/%, laporan mingguan berulang, ekspor.
```
