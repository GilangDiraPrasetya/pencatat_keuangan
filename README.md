# 🤖 Pencatat Keuangan — Bot Discord + AI (Gratis)

Bot Discord yang mencatat keuangan dari chat bahasa sehari-hari:

> **Kamu:** "bayar parkir 2 ribu"
> **Bot:** 🛒 *Pengeluaran tercatat: Parkir — Rp2.000* → tersimpan otomatis ke Google Sheets

& 100% gratis: Discord (bot) + Gemini API (AI) + Google Sheets (database) + Render (hosting).

---

## ✨ Fitur

| Fitur | Contoh |
|---|---|
| Catat otomatis via chat | `bayar parkir 2 ribu`, `makan siang 15k`, `gajian 3 juta` |
| Depth expense/income | `gajian` → income, `bayar/beli` → expense, hanya angka → expense |
| Pemahaman uang Indonesia | `2 ribu`/`2rb`/`2k` = 2.000 · `300rb` = 300.000 · `2,5 jt` = 2.500.000 |
| Kategori otomatis | Makanan, Transportasi, Belanja, Tagihan, Gaji, dll. |
| Rekap instan | `!rekap`, `!rekap hari`, `!rekap 9`, `!rekap lalu`, `!rekap all` |
| Batalkan salah catat | `!hapus 12` (ID ada di footer reply bot) |
| Tanya-jawab AI | "berapa pengeluaran bulan ini", "berapa margin", "apa saja yang saya beli tanggal 3" |
| Multi-user | Tiap orang Discord punya datanya sendiri (terpisah oleh `user_id`) |

---

## 🚀 Setup dari nol (± 20 menit, semua gratis)

### A. Bot Discord
1. https://discord.com/developers/applications → **New Application** → beri nama.
2. Tab **Bot** → **Reset Token** → salin token (RAHASIA).
3. Tab yang sama → **Privileged Gateway Intents** → aktifkan **MESSAGE CONTENT INTENT** → Save.
4. Tab **OAuth2 → URL Generator** → centang `bot`; permissions: `View Channels`, `Send Messages`, `Embed Links`, `Read Message History` → buka URL → invite ke servermu.

### B. Google Sheets (database)
1. Buat spreadsheet baru: https://sheets.new → salin **ID dari URL** (bagian antara `/d/` dan `/edit`).
2. https://console.cloud.google.com → buat project → **APIs & Services → Library** → aktifkan **Google Sheets API**.
3. **IAM & Admin → Service Accounts → Create** → lalu tab **Keys → Add Key → JSON** → simpan sebagai `service-account.json` di folder proyek ini.
4. Di spreadsheet → **Share** → masukkan **email service account** (dari file JSON, field `client_email`) sebagai **Editor**.

### C. AI Gemini (otak parser)
1. https://aistudio.google.com/apikey → **Create API key** → salin.
2. ⚠️ Jika key-mu berawalan `AQ.` gunakan model `gemini-3.5-flash-lite` (model `gemini-2.x` tidak lagi tersedia untuk akun baru).

### D. Konfigurasi & jalan
```bash
cp -n .env.example .env
```
Isi `.env`:

```ini
DISCORD_TOKEN=token_bot_discord          # C.A2
MONEY_CHANNEL_ID=                        # (opsional, lihat di bawah)
SPREADSHEET_ID=id_spreadsheet            # B.1
GOOGLE_SERVICE_ACCOUNT_EMAIL=...@...iam.gserviceaccount.com  # B.3
SERVICE_ACCOUNT_KEY_FILE=./service-account.json              # B.3
GEMINI_API_KEY=...                        # C.1
GEMINI_MODEL=gemini-3.5-flash-lite        # C.2
```

`MONEY_CHANNEL_ID` (opsional): ID channel keuangan; kalau diisi, bot merespons semua chat di sana. Kosong = bot hanya merespons saat di-mention / di DM. (Aktifkan Developer Mode di Discord untuk bisa *Copy Channel ID*.) Tab `Transactions` di spreadsheet **dibuat otomatis** bot.

```bash
npm install
npm start
```
Konsol harus menampilkan `✅ Login berhasil sebagai ...` lalu tes: `!help`.

---

## 🖥️ Cara pakai

```
bayar parkir 2 ribu          → expense Rp2.000
gajian 3 juta                → income Rp3.000.000
!rekap                       → rekap bulan ini
!rekap hari | 9 | lalu | all → variasi rentang
!hapus 12                    → batalkan transaksi #12
berapa pengeluaran bulan ini → jawaban AI dari datamu
berapa margin                → pendapatan − pengeluaran
```

---

## ☁️ Deploy gratis 24/7 (Render + UptimeRobot)

1. Push repo ke GitHub (privat).
2. https://render.com → **New Web Service** → connect repo GitHub-nya.
3. Setting: Build `npm install`, Start `npm start`, instance **Free**.
4. **Environment** → isi semua variabel Bootstrap `.env` **kecuali** `SERVICE_ACCOUNT_KEY_FILE` → ganti ke:
   - `SERVICE_ACCOUNT_JSON` (isi: seluruh isi file `service-account.json`, GitHub tak pasang file). Bot imprimir fallback baca env ini bila file tak ketemu.
   *(Kode `src/sheets.js` memeriksa: file `SERVICE_ACCOUNT_KEY_FILE` → `SERVICE_ACCOUNT_JSON` env → default `./service-account.json`.)*
5. Setelah jadi, salin URL `https://<app>.onrender.com/`.
6. https://uptimerobot.com (gratis) → **Add New Monitor** → HTTP(s) → URL `https://<app>.onrender.com/ping` → interval 10 menit. Ini menjaga bot tetap tidur-sleep.

## ⚠️ Catatan kuota/limit (free tier)

| Layanan | Limit yang penting |
|---|---|
| Gemini | ±15 RPM / 1.500 RPD (Flash & Lite). Bot sudah punya rate-limit bawaan 8 chat AI / menit per user |
| Render | Free web service tidur (idle 15 menit) — jangan biarkan tanpa keep-alive |
| Sheets | Tidak ada kekawatiran untuk skala pribadi/komunitas kecil |

## 🔏 Privasi multi-user

- Setiap transaksi & pertanyaan di-filter **per user_id** Discord; seseorang tak bisa lihat/rekap/hapus data orang lain (dicek di `!hapus`).
- Data raw tersimpan di Google Sheets-mu sendiri — bukan di pihak ketiga **selain** Google (hosting data) & Gemini (membaca teks untuk mem-parsing — jangan tulis info sensitif di pesan transaksi).

## 📄 Struktur

```
src/index.js    # entry bot + routing + server /ping
src/commands.js # !help, !rekap, !hapus (tanpa AI)
src/parser.js   # klasifikasi & parsing chat via Gemini + jalur Q&A
src/ai.js       # wrapper REST Gemini (timeout + retry)
src/sheets.js   # CRUD Google Sheets + agregasi
PRD.md          # Kebutuhan produk · TASKS.md # progres · AGENTS.md # panduan agent
```
