# TASKS — Bot Pencatat Keuangan (Discord × Gemini × Google Sheets)

> Cara pakai: kerjakan atas ke bawah, **satu checkpoint = satu sesi**.
> Centang `[x]` hanya setelah Definition of Done (DoD) checkpoint terpenuhi.

---

## ✅ C0 — Scaffold proyek (tanpa credential)
- [x] `package.json`, `.gitignore`, `.env.example` dibuat
- [x] `src/index.js`, `src/ai.js`, `src/sheets.js`, `src/parser.js`, `src/commands.js` dibuat
- [x] `npm install` sukses tanpa error
- [x] `.env` dibuat dari `.env.example`
- **DoD:** `npm start` menampilkan pesan jelas jika token kosong (tidak crash aneh).

---

## ✅ C1 — Koneksi bot Discord
**Yang kamu lakukan (± 5 menit):**
1. Buka https://discord.com/developers/applications → **New Application** → beri nama (mis. `Pencatat Keuangan`).
2. Tab **Bot** → **Reset Token** → **Copy Token**.
3. Di tab Bot yang sama, aktifkan **MESSAGE CONTENT INTENT** (Privileged Gateway Intents).
4. Tab **OAuth2 → URL Generator**: centang scope `bot`, permissions: `View Channels`, `Send Messages`, `Embed Links`, `Read Message History` → buka URL → invite ke server Discord kamu.
5. Isi token: `nano .env` → `DISCORD_TOKEN=<token>`. (Optional: isi juga `MONEY_CHANNEL_ID`.)
6. Jalankan `npm start`.

Checklist:
- [x] Console menampilkan `✅ Login berhasil sebagai ...`
- [x] `!help` di Discord dibalas bot
- **DoD:** bot online & `!help` terjawab. [LOLOS 2026-10-19]

---

## ✅ C2 — Integrasi Google Sheets
**Yang kamu lakukan (± 10 menit):**
1. Buat spreadsheet baru di https://sheets.new → copy **SPREADSHEET_ID** dari URL.
2. https://console.cloud.google.com → buat project → aktifkan **Google Sheets API**.
3. **IAM & Admin → Service Accounts → Create** → nama `pencatat-keuangan` → tab **Keys → Add Key → JSON** → simpan file sebagai `service-account.json` di folder proyek.
4. Share spreadsheet ke email service account (akhiran `@...iam.gserviceaccount.com`) sebagai **Editor**.
5. Isi `.env`: `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `SERVICE_ACCOUNT_KEY_FILE=./service-account.json`. Restart `npm start`.

Checklist:
- [x] `!rekap` dibalas "belum ada transaksi" (tanpa error 403)
- [x] Tab `Transactions` + header dibuat otomatis
- **DoD:** `!rekap` sukses. Tes cepat: lakukan C3 kasus 1 lalu cek baris baru muncul. [LOLOS 2026-10-19]

---

## ✅ C3 — Parsing AI (Gemini)

> 📌 Catatan implementasi (2026-10-19): model default diganti `gemini-3.5-flash-lite`
> (2.5.x tidak lagi tersedia untuk akun baru; 3.8-flash lambat untuk chat kecil),
> plus timeout 30s + retry 1x di `src/ai.js`.
**Yang kamu lakukan (± 2 menit):**
1. https://aistudio.google.com/apikey → **Create API key** → isi `GEMINI_API_KEY` di `.env`. Restart.

Checklist (kasus uji wajib, di channel keuangan / mention bot):
- [x] `bayar parkir 2 ribu` → embed ✅ Pengeluaran Rp2.000, kategori Transportasi, ada ID footer
- [x] `makan siang 15k` → ✅ Pengeluaran Rp15.000, Makanan
- [x] `gajian 3 juta` → 💰 Pemasukan Rp3.000.000, Gaji
- [x] `halo` → bot minta format contoh (OTHER), tidak menyimpan
- **DoD:** 4 kasus di atas lolos & baris muncul di Sheets. [LOLOS 2026-10-19]

---

## ✅ C4 — Perintah `!rekap` & `!hapus`
Checklist:
- [x] `!rekap` → rekap bulan ini (income/expense/selisih, cocok dengan Sheets)
- [x] `!rekap hari`, `!rekap 8`, `!rekap lalu`, `!rekap all` berfungsi
- [x] `!hapus <id>` menghapus transaksi sendiri (status DELETED, rekap berubah)
- [x] `!hapus <id milik user lain>` ditolak
- **DoD:** angka rekap = hitungan manual di Sheets. [LOLOS 2026-10-19]

---

## ✅ C5 — Tanya Jawab AI (Q&A)
Checklist:
- [x] `berapa pengeluaran bulan ini` → jawaban & angkanya benar
- [x] `berapa margin bulan ini` → selisih income − expense benar
- [x] `apa saja yang saya beli tanggal 3` → daftar dari data user
- [x] User B tidak bisa melihat/menanyakan data User A
- **DoD:** 3 pertanyaan pertama terjawab akurat. [LOLOS 2026-10-19]

---

## ✅ C6 — Deploy gratis (GitHub Actions, tanpa kartu kredit)
**Yang dilakukan:**
1. ~~`git init` + push ke GitHub~~ ✅ (repo public: GilangDiraPrasetya/pencatat_keuangan)
2. ~~Render~~ **diganti GitHub Actions** — Render free tetap minta kartu kredit.
3. Workflow `.github/workflows/bot.yml`: schedule tiap 6 jam + auto-restart 5s +	concurrency 1 instance; secret via GitHub Secrets (5 secret).
4. README.md final (login via VS Code Publish to GitHub).

Checklist:
- [x] Bot online 24/7 tanpa kartu kredit (job Actions: `✅ Login berhasil` 2026-10-19)
- [x] Restart otomatis schedule 6 jam + loop crash-recovery
- [x] README.md siap
- **DoD:** deploy sukses, dokumentasi lengkap. [LOLOS 2026-10-19]

---

## ✅ C7 — Kelompok kategori (pendapatan/pengeluaran/tabungan) + `!kategori` dari Discord
Rancangan:
- Tab baru `Categories` (kolom `name`, `group`) — dibuat otomatis + seed default; sumber daftar kategori parser & `!kategori`.
- Kolom baru `group` (INCOME/EXPENSE/SAVINGS) di tab `Transactions` (kolom L, tambahan di akhir agar data lama tetap valid).
- Semantik: `type` = arus kas (masuk/keluar); `group` = kelompok kategori. Menabung = type EXPENSE + group SAVINGS. Margin = pendapatan − pengeluaran (tabungan dihitung terpisah).
Checklist:
- [x] Tab `Categories` + seed default otomatis (terverifikasi via script: 16 kategori)
- [x] Kolom `group` di `Transactions` (coverage: sheets.js append/mapRow/header perpanjangan)
- [x] `!kategori` (list), `tambah`, `hapus`, `pindah`, `reset`
- [x] Parser gemini memilih kategori dari daftar dinamis + grup (tes 7/7 kasus)
- [x] `!rekap` menampilkan Pendapatan / Pengeluaran / Tabungan + margin
- [x] Q&A menyertakan total 3 kelompok
DoD (uji di Discord — tinggal verifikasi kamu):
- `!kategori` menampilkan 3 grup; `menabung 50rb` → grup Tabungan; `gajian 3 juta` → Pendapatan; `bayar parkir 2 ribu` → Pengeluaran; `!rekap` menampilkan 3 jalur + margin benar; `!kategori tambah tabungan Dana Kuliah` lalu `menabung 20rb` → masuk Dana Kuliah.
Status: [x] selesai — LOLOS verifikasi user 2026-10-19

---

## ✅ C8 — Multi-transaksi dalam 1 chat
Rancangan:
- Parser Gemini mendukung `items: []` (max 6 per pesan) — kata penghubung "kemudian/lalu/… buat …/dan" dipecah jadi beberapa transaksi.
- Semantik margin diperjelas: **margin = kas tersisa = pendapatan − pengeluaran (konsumsi) − tabungan (setor bersih)**.
  - "gaji 3.5jt kemudian ditabung 500rb" → pendapatan 3.5jt, tabungan +500rb, margin 3.0jt (pendapatan berkurang 500rb ✓)
  - "ambil tabungan 500rb buat beli sepatu" → tabungan −500rb, pengeluaran +500rb, margin 0 ✓
- Reply embed multi: 1 embed berisi daftar semua transaksi + ID masing-masing.
Checklist:
- [x] Parser: multi-item (contoh user jadi few-shot di prompt) — tes 6/6 kasus
- [x] `summarize()`: margin = pend − peng − tabunganBersih (unit test ✓)
- [x] Embed multi: daftar + saldo bulan ini + footer IDs
- [x] `!rekap` & Q&A memakai istilah "kas tersisa"
DoD (uji di Discord):
- "gaji 3.500.000 kemudian ditabung 500.000" → 2 transaksi: Pendapatan 3.5jt + Tabungan 500rb; `!rekap` margin = 3.000.000.
- "ambil tabungan 500.000 buat beli sepatu" → 2 transaksi: Tabungan −500rb (tarik) + Pengeluaran 500rb (sepatu); `!rekap` margin 0.
- 1 chat biasa ("menabung 100rb") tetap bekerja.
Status: [x] selesai — LOLOS verifikasi user 2026-10-19

---

## ⭐ C9 — Saldo Awal (baseline kas & tabungan) per-user  ← *Kita di sini* — DESAIN, menunggu Go
Kebutuhan user:
- Saat mulai memakai bot, posisi keuangan tidak nol. Contoh: sudah punya **tabungan Rp2.500.000** dan **sisa kas Rp1.500.000**.
- Semua angka "kas tersisa" & "tabungan sekarang" harus dihitung dari baseline ini + transaksi yang tercatat.

Rancangan:
- Tab baru `Balances` (dibuat otomatis): kolom `user_id | username | cash | savings | updated_at` — **satu baris per user** (upsert saat update).
- Perintah baru (tanpa AI):
  - `!saldo` → tampilkan saldo awal + **posisi terkini**: kas sekarang & tabungan sekarang.
  - `!saldo awal kas 1500000` → set/pdate kas awal
  - `!saldo awal tabungan 2500000` → set/update tabungan awal
  - `!saldo awal kas 1500000 tabungan 2500000` → set keduanya sekaligus
  - `!saldo reset` → hapus baseline (hitungan kembali dari 0)
- Rumus baru (kalau baseline ada; kalau tidak, perilaku lama):
  - **kas sekarang** = kas awal + pendapatan − pengeluaran(konsumsi) − tabungan(setor bersih)
  - **tabungan sekarang** = tabungan awal + setor bersih
- Dampak tampilan:
  - embed transaksi & `!rekap` menampilkan **posisi terkini** (kas & tabungan) saat baseline tersedia;
  - Q&A ("berapa saldo saya", "berapa sisa uangku") memakai posisi terkini; facts AI ditambah baseline.
Checklist:
- [x] Tab `Balances` otomatis + upsert per-user (roundtrip test riil ✓)
- [x] `!saldo` (lihat), `!saldo awal kas N tabungan M` (parsial ok), `!saldo reset`
- [x] Agregasi baseline: kas = baseline + s.net; tabungan = baseline + s.savingsNet (unit test ✓)
- [x] Embed transaksi/`!saldo`/`!rekap` menampilkan	posisi terkini saat baseline ada
- [x] Q&A facts memuat SALDO AWAL + POSISI TERKINI (buildFacts(rows, base))
- [x] README diperbarui (FLOW.md Alur F sudah dibuat saat desain)
- [x] fix bug `!saldo awal` singkatan uang: `500ribu`/`2.5juta`/`1,5jt`/`2,5` kini benar (17/17 uji ✓)
- [x] fix bug `!rekap` (variabel `rows` tersisa tanpa deklarasi → ReferenceError saat strict mode)
Status: ✅ LOLOS (2026-10-21) — verifikasi user: `!saldo` aktif & posisi terkini terlihat di embed (kas 5.755.000 • tabungan 3.000.000 sesuai baseline user)
DoD (uji di Discord):
- `!saldo awal kas 1500000 tabungan 2500000` → tersimpan; `!saldo` → kas 1.5jt & tabungan 2.5jt;
- `menabung 100rb` → kas 1.4jt, tabungan 2.6jt; `gajian 1jt` → kas 2.4jt; `!rekap` cocok; `berapa saldo saya` → jawaban pakai posisi terkini; user lain tidak terpengaruh.

## 🔧 C10 — Perbaikan stabilitas Actions + privasi DM (2026-10-21)

Problem 1: run Actions dibatalkan & tidak ada pengganti + cron GitHub telat 2–5 jam → bot mati berjam-jam.
Problem 2: chat di channel server terbaca anggota lain → solusi balasan bot via DM.

Checklist:
- [x] Workflow self-chain: run menjalankan bot 5,5 jam → mengantre run berikutnya sendiri via workflow_dispatch (GITHUB_TOKEN, `permissions: actions: write`), retry 3x
- [x] Cron 6 jam tetap sebagai jaring pengaman; push ke main tetap deploy instan
- [x] Guard crash-loop (5x crash <10 detik → jeda 5 menit, job tetap hidup sampai giliran)
- [x] Mode privat: semua balasan bot di server lewat DM + reaksi 🔒 (`Message.prototype.reply` patch); fallback ke channel bila DM terkunci
- [x] `PRIVACY_MODE` = `dm` (default) / `open`; `PRIVACY_DELETE=1` opsional (hapus chat user di server; hanya pesan yang diproses)
- [x] Mode **`DM_ONLY=1`** (aktif di workflow): di server bot tidak melayani apapun — chat di channel keuangan/`!`/mention dapat arahan singkat via DM; seluruh layanan aktif di DM (privasi 100%, isi chat user tidak di-channel)
- [x] README: panduan pakai via DM + cara mengajak user lain (FTUE: masuk server → DM bot)
- [x] README (deploy + privasi), `!help` mendapat penjelasan DM
Checklist:
- [x] fix bug gating DM: chat di DM SELALU diproses — tidak lagi disaring `MONEY_CHANNEL_ID` (penyebab DM diabaikan kemarin)
- [x] fallback channel jadi notice netral (`🔒 Gagal mengirim DM...`) — tanpa bocor data
Status: ✅ LOLOS (2026-10-22) — verifikasi user: `gajian 3,5juta` di DM tercatat + posisi terkini benar; di server `!rekap` hanya arahan DM-only
DoD: bot tetap online melewati pergantian run (gap < ~5 menit); chat di channel dibalas via DM; layanan penuh di DM
DoD: bot tetap online melewati pergantian run (gap < ~5 menit); chat di channel dibalas di DM dengan 🔒.

---

## 🏁 PROYEK MVP SELESAI
Semua checkpoint C0–C6 lolos pada 2026-10-19.

---

## 📝 Log Progres
| Tanggal | Checkpoint | Hasil |
|---|---|---|
| 2026-10-19 | C0 | Scaffold + install ✅ |
| 2026-10-19 | C1 | Bot online + `!help` ✅ |
| 2026-10-19 | C2 | Sheets terhubung; key JSON salah folder → diperbaiki; `!rekap` OK ✅ |
| 2026-10-19 | C3 | Parsing AI lolos 4/4 kasus; model → 3.5-flash-lite; timeout+retry ditambah ✅ |
| 2026-10-19 | C4 | `!rekap` 5 varian + `!hapus` lolos; angka cocok Sheets ✅ |
| 2026-10-19 | C5 | Q&A AI akurat (angka = hitungan kode) + uji jujur data kosong ✅ |
| 2026-10-19 | C6 | Deploy 24/7 via GitHub Actions (Render = minta kartu → dihapus); VS Code publish; Secrets 5 item ✅ **MVP SELESAI** |
| 2026-10-19 | C7 | !kategori + 3 kelompok (pendapatan/pengeluaran/tabungan) + kolom group — LOLOS ✅ |
| 2026-10-19 | C8 | Multi-transaksi 1 chat (items, max 6) + margin = kas tersisa — LOLOS ✅ |
| 2026-10-21 | C9 | Saldo awal + posisi terkini (Balances/!saldo) + fix int singkatan — LOLOS ✅ (embed pakai posisi live) |
| 2026-10-21 | C10 | Fix stabilitas Actions (self-chain + guard crash) + privasi DM + fix DM gating & fallback — LOLOS ✅ (2026-10-22, uji DM user) |
| 2026-10-22 | — | Mode `DM_ONLY=1` + perbaikan DM: chat DM selalu diproses; fallback channel = notice netral tanpa bocor — LOLOS ✅ |
