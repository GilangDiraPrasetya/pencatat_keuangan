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

## 🚀 C6 — Deploy gratis (GitHub Actions, tanpa kartu kredit) ← *Kita di sini*
**Yang dilakukan:**
1. `git init` + push ke GitHub (repo privat).
2. Render.com → **New Web Service** → connect repo → Build: `npm install`, Start: `npm start` → isi semua env vars dari `.env`.
3. Jalankan workflow manual pertama kali di tab Actions → `Run workflow`.
4. README.md sudah final (deploy section diganti GitHub Actions).

Checklist:
- [ ] Bot online 24/7 (tidak mati saat PC mati)
- [ ] `/ping` endpoint merespons (untuk keep-alive)
- [ ] `README.md` siap
- **DoD:** deploy sukses, dokumentasi lengkap.

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
