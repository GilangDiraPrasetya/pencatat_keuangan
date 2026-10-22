# 🎤 FLOW PROSES — Bot Pencatat Keuangan AI
*Bahan presentasi: dari input sampai output, disusun dari perilaku bot yang sebenarnya berjalan.*

---

## 1) Versi Sederhana — 5 Langkah (untuk pembukaan presentasi)

```
   KAMU                          BOT                              HASIL
┌─────────────┐          ┌───────────────────┐          ┌────────────────────────┐
│ 1. TULIS DI │   ───▶   │ 2. AI MEMBACA &   │   ───▶   │ 4. PAPAN CATATAN       │
│  DM BOT     │          │    MENAFSIRKAN    │          │    (Google Sheets)     │
│ "bayar      │          │ 3. RAPIKAN: jenis,│          │                        │
│ parkir 2    │          │    jumlah,        │          │ 5. BOT MEMBALAS        │
│ ribu"       │          │    kategori       │          │  "✅ + posisi terkini"  │
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
                │                     │   │  • di DM (selalu lolos) │
                │  !help !rekap       │   │  • di server: channel   │
                │  !hapus !kategori   │   │     keuangan / mention  │
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
| 1 | **Input** | User menulis bebas di DM bot (privat) | `bayar parkir 2 ribu` |
| 2 | **Router** | DM → selalu diteruskan; di server: channel keuangan/mention | — |
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

## 7b) Alur F — Saldo Awal & Posisi Terkini (C9 ✅)

> Masalah yang diselesaikan: ketika mulai memakai bot, kondisi awal **tidak nol** —
> misal sudah punya **tabungan Rp2.500.000** dan **sisa kas Rp1.500.000**.
> Tanpa baseline, semua rekap hanya menghitung transaksi sejak mulai dipakai.

```
 KAMU MENGISI POSISI AWAL (1x saja, atau saat posisi berubah di dunia nyata)

 !saldo awal kas 1.500.000 tabungan 2.500.000
        │
        ▼
 ┌───────────────────────────────┐
 │ TAB "Balances" di Sheets      │   ← 1 baris per user:
 │ user_id | cash | savings      │      baseline = milik kamu sendiri
 └───────────────┬───────────────┘
                 ▼
     SETIAP TRANSAKSI SETELAHNYA
                 │
                 ▼
 ┌───────────────────────────────────────────────────────┐
 │ POSISI TERKINI (dihitung kode, selalu akurat)          │
 │                                                        │
 │  kas sekarang      = kas awal + pendapatan             │
 │                      − pengeluaran − setor tabungan    │
 │                                                        │
 │  tabungan sekarang = tabungan awal + setor bersih      │
 └───────────────────────────────────────────────────────┘
                 ▼
 Tampilan: embed transaksi, !saldo, !rekap, dan jawaban AI
 ("berapa saldo saya", "berapa sisa uangku") semuanya memakai
 Posisi Terkini — bukan lagi hanya pergerakan angka sejak bot dipakai saja.
```

Perintah baru untuk kelola saldo awal:

| Perintah | Efek |
|---|---|
| `!saldo` | lihat saldo awal + **posisi terkini** (kas & tabungan) |
| `!saldo awal kas 1500000` | set / perbarui kas awal |
| `!saldo awal tabungan 2500000` | set / perbarui tabungan awal |
| `!saldo awal kas 1500000 tabungan 2500000` | set keduanya sekali perintah |
| `!saldo reset` | hapus baseline — hitungan kembali seperti sebelum C9 |

Contoh hitung dengan baseline kamu (kas 1.5jt, tabungan 2.5jt):

```
!saldo                                →  kas 1.500.000 · tabungan 2.500.000
menabung 100rb                        →  kas 1.400.000 · tabungan 2.600.000
gajian 1jt                            →  kas 2.400.000 · tabungan 2.600.000
bayar belanja 250rb                   →  kas 2.150.000 · tabungan 2.600.000
```

*Status: ✅ TERPASANG & LOLOS uji Discord — `!saldo`, posisi terkini di embed transaksi/`!rekap`, dan tanya-jawab AI memakai baseline. Format angka bebas: `500ribu`, `2.5juta`, `1,5jt`, `3.500.000`.*

---

## 7c) Alur G — Privasi: DM-ONLY & Balasan Terkunci 🔒 (C10)

> Masalah yang diselesaikan: channel Discord = ruang publik — partner/anggota lain bisa membaca isi
> chat keuanganmu. Discord tidak bisa menyembunyikan pesan asli user, tapi bisa mengarahkan
> seluruh layanan ke **DM** (percakapan yang hanya bisa dibaca 2 pihak: kamu & bot).

```
  DI SERVER (channel publik)              DI DM BOT (ruang privat)
 ──────────────────────────              ──────────────────────────────
 "gajian 3,5 juta" ─┐
 "!rekap" ──────────┼──▶ bot balas 🔒     "bayar parkir 2 ribu" → ✅ embed lengkap
 "@bot ..." ────────┘    arahan singkat    "gajian 3,5juta"      → ✅ + posisi terkini
                         "pakai DM saya"   "!saldo"/"!rekap"/... → ✅ embed lengkap
                                │
                                └──────▶ user pindah ke DM → layanan penuh
```

- `DM_ONLY=1` (aktif): di server bot **tidak melayani transaksi sama sekali** — chat keuangan di
  channel/`!`/mention hanya mendapat arahan singkat (dikirim via DM, tidak muncul di channel).
  Chat di DM: semua fitur normal.
- `PRIVACY_MODE=dm` (default): semua balasan bot untuk pesan server dikirim via DM + reaksi 🔒.
- `PRIVACY_DELETE=1` (opsional, mati): jika dipakai mode channel, chat user dihapus bot setelah
  dibaca (butuh izin *Manage Messages*).
- **Per-user tetap**: kunci data adalah `user_id` Discord — DM atau channel pun sama-sama terisolasi.
- **Ajak user lain tanpa setup**: masuk server → buka profil bot → **Message** → `!help`.

---

## 8) Infrastruktur 24/7 (tanpa kartu kredit)

```
  Kamu (siapa pun, kapan pun)          GitHub Cloud (server gratis)            Google Cloud
────────────────────────         ─────────────────────────────────       ────────────────────
   Chat Discord  ◀──────────────▶  [Bot Node.js di GitHub Actions]  ◀────▶  Sheets (data)
        ⓘ                Discord Gateway                 Gemini API + Sheets API
```

- Job GitHub Actions hidup ±5,5 jam; saat giliran habis, run **menantai penggantinya sendiri** (self-chain via workflow_dispatch, downtime ±1–2 menit) — cron 6 jam hanya jaring pengaman. Auto-restart 5 detik bila crash.
- Push baru ke `main` = deploy instan (run lama digantikan otomatis).
- Laptop **boleh mati** — bot tetap jalan. Semua secret via GitHub Secrets, tidak ada di repositori.
- Semua komponen gratis: Discord · Gemini API · Google Sheets · GitHub Actions.

---

## 9) Lembar Uji — contoh nyata untuk demo live

| Input di DM bot | Yang dibalas bot |
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
6. **Slide multi-user & privasi** — semua chat dilakukan di **DM bot** (tidak ada isi keuangan yang tampil di channel server; `DM_ONLY`), data per-`user_id` tak tercampur antar-pengguna, data tempat kamu sendiri punya Google Sheet milikmu.
   • Alur G: di server bot hanya memberi arahan singkat → user dipandu ke DM → layanan penuh privat di DM.
7. **Slide roadmap** — ide berikutnya: catat mundur (` tanggal`) & budget/%, laporan mingguan berulang, ekspor.
```
