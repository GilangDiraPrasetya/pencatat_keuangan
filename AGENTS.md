# AGENTS.md

Panduan untuk AI agent (dan manusia) yang bekerja di repo ini.

## 1. Ikhtisar Proyek

Bot Discord **pencatat keuangan** berbahasa Indonesia: chat natural → Gemini klasifikasi →
simpan ke Google Sheets. Multi-user, semuanya pakai layanan gratis.

- **Runtime:** Node.js ≥ 18 (CommonJS, tanpa build step)
- **Dep:** `discord.js` (bot), `googleapis` (Sheets), `dotenv`
- **AI:** Gemini REST API (`generativelanguage.googleapis.com/v1beta`) — tanpa SDK
- **Rincian produk:** lihat `PRD.md` · **Daftar tugas:** lihat `TASKS.md`

## 2. Struktur

```
src/index.js      # entry: koneksi Discord + routing pesan (!perintah vs chat AI)
src/commands.js   # !help, !rekap, !hapus (tanpa AI)
src/parser.js     # jembatan chat AI: parse transaksi & jalur Q&A
src/ai.js         # wrapper REST Gemini (generateJSON / generateText)
src/sheets.js     # append/read/update/delete Google Sheets + agregasi
```

Aturan struktur: jangan tambah layer/file baru tanpa alasan; satu tanggung jawab per file.

## 3. Konvensi Kode

- CommonJS (`require`), `'use strict'` di tiap file.
- Komentar & log **bahasa Indonesia**, konsisten dengan tone proyek.
- `console.error('[paket] pesan')` untuk error; hindari console.log berlebihan.
- Semua akses env lewat `process.env.X`, baca dengan fallback aman.
- Format rupiah: `new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })`.
- Tanggal lokal selalu **timezone `BOT_TIMEZONE`** (default Asia/Jakarta), bukan UTC.

## 4. Environment & Secret

| Var | Wajib? | Fungsi |
|---|---|---|
| `DISCORD_TOKEN` | ✅ | Token bot Discord |
| `MONEY_CHANNEL_ID` | — | Batasi chat AI di 1 channel (kosong = hanya mention) |
| `SPREADSHEET_ID` | ✅ (M2) | ID spreadsheet Google Sheets |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | ✅ (M2) | Email service account |
| `SERVICE_ACCOUNT_KEY_FILE` | ✅ (M2) | Path file JSON key (default `./service-account.json`) |
| `GEMINI_API_KEY` | ✅ (M3) | API key Gemini (AI Studio) |
| `GEMINI_MODEL` | — | Default `gemini-2.5-flash` |
| `AI_RATE_LIMIT_PER_MINUTE` | — | Default 8 |
| `BOT_TIMEZONE` | — | Default `Asia/Jakarta` |

**Jangan pernah** commit `.env` atau `service-account.json` (sudah ada di `.gitignore`).

## 5. Menjalankan & Menguji

```bash
npm install
npm start          # bot jalan, log "✅ Login berhasil sebagai ..."
```

Tes manual per milestone di `TASKS.md`. Tidak ada test otomatis di MVP; jangan buat
framework test baru tanpa diminta.

## 6. Kontrak Perilaku Bot

- Perintah `!` **tidak boleh** memanggil AI.
- Chat AI hanya di channel keuangan / saat di-mention. Selain itu **diam**.
- Semua reply embed/teks menyebut ID transaksi pada footer untuk `!hapus`.
- Error dijaga supaya **bot tidak crash**: try/catch di tiap handler; balas pesan ramah
  bukan silent fail.
- Sheets: idempotent penting — tab `Transactions` + header dibuat otomatis jika belum ada.

## 7. Prompt AI (parser) — aturan perubahan

Prompt parsing ada di `src/parser.js` (const `PARSE_SYSTEM_PROMPT`).
Jangan ubah tanpa alasan kuat; uji kasus bawaan ini setelah tiap perubahan:

1. `bayar parkir 2 ribu` → EXPENSE 2000, Transportasi
2. `makan siang 15k` → EXPENSE 15000, Makanan
3. `gajian 3 juta` → INCOME 3000000, Gaji
4. `berapa pengeluaran bulan ini` → QUESTION
5. `halo` → OTHER

## 8. Workflow Agent

- Kerjakan **satu milestone** dari `TASKS.md`, verifikasi DoD-nya, lalu centang checklist.
- Jangan campur perubahan 2 milestone dalam 1 commit.
- Jika gagal konfigurasi eksternal (token/API key), berhenti, jelaskan langkah remedial,
  jangan mengarang-mengarang nilai credential.
- Keamanan: jangan pernah log isi token/key; jangan tampilkan JSON service account.
