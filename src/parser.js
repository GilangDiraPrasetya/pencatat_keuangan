'use strict';
// Jembatan chat AI: klasifikasi (TRANSACTION / QUESTION / OTHER) via Gemini,
// lalu simpan transaksi ke Sheets atau jawab pertanyaan dari data user.

const { EmbedBuilder } = require('discord.js');
const ai = require('./ai');
const sheets = require('./sheets');

const KATEGORI = [
  'Makanan', 'Transportasi', 'Belanja', 'Tagihan', 'Hiburan', 'Kesehatan',
  'Pendidikan', 'Gaji', 'Bonus', 'Penjualan', 'Hadiah', 'Investasi', 'Donasi', 'Lainnya',
];

const fmt = (v) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(Math.round(v || 0));

const SETUP_AI = '⚠️ AI (Gemini) belum dikonfigurasi. Isi `GEMINI_API_KEY` di `.env` lalu restart bot. Langkah ada di `TASKS.md` bagian C3.';
const FALLBACK_OTHER = '✏️ Aku belum paham maksudmu 🤔 Contoh pencatatan: "bayar parkir 2 ribu", "gajian 3 juta". Atau tanya: "berapa pengeluaran bulan ini"';

// ---------- Rate limit per user (lindungi kuota AI gratis) ----------
const hits = new Map();
function rateLimited(userId) {
  const limit = Number(process.env.AI_RATE_LIMIT_PER_MINUTE || 8);
  const now = Date.now();
  const arr = (hits.get(userId) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(userId, arr);
  return arr.length > limit;
}

// ---------- Prompt klasifikasi/parsing ----------
const PARSE_SYSTEM_PROMPT = `Kamu adalah modul parser keuangan untuk bot Discord berbahasa Indonesia.
Analisis pesan user, lalu jawab HANYA JSON valid dengan skema:
{"intent":"TRANSACTION|QUESTION|OTHER","transaction_type":"EXPENSE|INCOME","amount":0,"category":"","description":""}

Aturan:
1. intent TRANSACTION = pesan mencatat uang keluar/masuk.
   - EXPENSE: bayar, beli, belanja, isi, top up, naik ojol, makan, jajan, cicil, dsb. Default jika pesan hanya menyebut nominal tanpa konteks pemasukan.
   - INCOME: gajian, gaji, terima, dibayari, bonus, THR, penjualan/laku, jual, dapat, transferan masuk.
   - Konversi nominal: "2 ribu"/"2rb"/"2k" = 2000; "15k" = 15000; "300rb" = 300000; "2,5 ribu"/"2.5k" = 2500; "2 juta"/"2jt" = 2000000; "3,5 jt" = 3500000. 1 ribu selalu 1000.
   - Jika ada beberapa angka, pilih yang paling mungkin sebagai total transaksi (harga item, bukan tanggal/kombi/kuantitas seperti "2 orang").
   - description = label singkat maksimal 5 kata (nama item/kegiatan, tanpa kata "bayar").
   - category WAJIB salah satu dari: ${KATEGORI.join(', ')}.
2. intent QUESTION = pertanyaan tentang data keuangan user: berapa total pengeluaran/pendapatan, saldo, margin/selisih, rekap, riwayat, "apa saja yang saya beli/bayar pada tanggal X", dsb.
3. intent OTHER = sapaan/ngobrol biasa, atau instruksi lain yang bukan transaksi maupun pertanyaan data.
4. Isi field yang tidak relevan dengan null. Jangan tambahkan teks apa pun di luar JSON.

Contoh:
- "bayar parkir 2 ribu" → {"intent":"TRANSACTION","transaction_type":"EXPENSE","amount":2000,"category":"Transportasi","description":"Parkir"}
- "makan siang 15k" → {"intent":"TRANSACTION","transaction_type":"EXPENSE","amount":15000,"category":"Makanan","description":"Makan siang"}
- "gajian 3 juta" → {"intent":"TRANSACTION","transaction_type":"INCOME","amount":3000000,"category":"Gaji","description":"Gajian"}
- "top up e-money 50.000" → {"intent":"TRANSACTION","transaction_type":"EXPENSE","amount":50000,"category":"Transportasi","description":"Top up e-money"}
- "berapa pengeluaran bulan ini" → {"intent":"QUESTION","transaction_type":null,"amount":null,"category":null,"description":null}
- "halo" → {"intent":"OTHER","transaction_type":null,"amount":null,"category":null,"description":null}`;

function normalizeParse(result) {
  const out = {
    intent: String((result && result.intent) || 'OTHER').toUpperCase(),
    transaction_type: String((result && result.transaction_type) || 'EXPENSE').toUpperCase(),
    amount: Math.round(Number(result && result.amount) || 0),
    category: KATEGORI.includes(result && result.category) ? result.category : 'Lainnya',
    description: String((result && result.description) || 'Transaksi').slice(0, 60),
  };
  if (!['TRANSACTION', 'QUESTION', 'OTHER'].includes(out.intent)) out.intent = 'OTHER';
  if (!['EXPENSE', 'INCOME'].includes(out.transaction_type)) out.transaction_type = 'EXPENSE';
  return out;
}

// ---------- Handler transaksi ----------
async function handleTransaction(message, sent, parsed) {
  if (!sheets.isConfigured()) {
    return sent.edit('⚠️ Transaksi dikenali, tapi Google Sheets belum dikonfigurasi — belum tersimpan. Cek `TASKS.md` bagian C2.');
  }

  const { rowIndex } = await sheets.appendTransaction({
    user: message.author,
    txn: parsed,
    msgId: message.id,
  });

  // Saldo bulan ini (sudah termasuk transaksi barusan)
  let saldo = '';
  try {
    const rows = await sheets.getAllForUser(message.author.id);
    const mp = sheets.monthPrefix(0);
    const s = sheets.summarize(rows.filter((r) => (r.date || '').startsWith(mp)));
    saldo = `Saldo bulan ini: pemasukan ${fmt(s.income)} • pengeluaran ${fmt(s.expense)}`;
  } catch (e) {
    console.error('[parser] gagal hitung saldo:', e.message);
  }

  const isIncome = parsed.transaction_type === 'INCOME';
  const embed = new EmbedBuilder()
    .setColor(isIncome ? 0x57f287 : 0xed4245)
    .setTitle(`${isIncome ? '💰 Pemasukan' : '🛒 Pengeluaran'} tercatat`)
    .setDescription(`**${parsed.description} — ${fmt(parsed.amount)}**${saldo ? `\n\n${saldo}` : ''}`)
    .addFields({ name: 'Kategori', value: parsed.category, inline: true })
    .setFooter({ text: `ID #${rowIndex} • ketik !hapus ${rowIndex} untuk membatalkan` });

  return sent.edit({ content: '✅ Done!', embeds: [embed] });
}

// ---------- Handler pertanyaan (Q&A) ----------
function buildFacts(rows, question) {
  const today = sheets.localDateStr();
  const mp = sheets.monthPrefix(0);
  const mpLalu = sheets.monthPrefix(-1);

  const bulanIni = sheets.summarize(rows.filter((r) => (r.date || '').startsWith(mp)));
  const bulanLalu = sheets.summarize(rows.filter((r) => (r.date || '').startsWith(mpLalu)));
  const hariIni = sheets.summarize(rows.filter((r) => r.date === today));

  const perKategori = Object.entries(bulanIni.byCat.expense)
    .sort((a, b) => b[1] - a[1])
    .map(([c, v]) => `${c}: ${fmt(v)}`)
    .join(', ');

  const marginPct = bulanIni.income > 0
    ? ` (margin ${(bulanIni.net / bulanIni.income * 100).toFixed(1)}%)`
    : '';

  const lines = rows
    .slice(-150)
    .map((r) => `#${r.rowIndex} | ${r.date} | ${r.type} | ${r.category} | ${r.description} | ${fmt(r.amount)}`)
    .join('\n');

  return [
    `Tanggal hari ini: ${today}. Bulan berjalan: ${mp}. Bulan lalu: ${mpLalu}.`,
    '',
    'RINGKASAN TERHITUNG KODE (angka ini pasti benar, pakai untuk jawaban):',
    `- Bulan ini: pemasukan ${fmt(bulanIni.income)}, pengeluaran ${fmt(bulanIni.expense)}, selisih/margin ${fmt(bulanIni.net)}${marginPct}, jumlah ${bulanIni.count} transaksi`,
    `- Bulan lalu: pemasukan ${fmt(bulanLalu.income)}, pengeluaran ${fmt(bulanLalu.expense)}, selisih ${fmt(bulanLalu.net)}`,
    `- Hari ini: pemasukan ${fmt(hariIni.income)}, pengeluaran ${fmt(hariIni.expense)}`,
    `- Pengeluaran bulan ini per kategori: ${perKategori || 'belum ada'}`,
    '',
    'DATA TRANSAKSI (terbaru di bawah):',
    lines || '(kosong)',
  ].join('\n');
}

async function handleQuestion(message, sent, question, rows) {
  if (!rows.length) {
    return sent.edit('📭 Belum ada transaksi tercatat untukmu. Coba catat dulu, misal: "bayar kopi 25rb"');
  }
  const facts = buildFacts(rows, question);
  const prompt = [
    `Kamu asisten keuangan user Discord "${message.author.username}".`,
    'Jawab pertanyaan user memakai HANYA data pada bagian "RINGKASAN TERHITUNG KODE" dan "DATA TRANSAKSI" berikut.',
    'Aturan: bahasa Indonesia santai dan singkat (maksimal 10 kalimat), angka pakai format Rupiah.',
    'Jangan mengarang transaksi yang tidak ada di data. Jika data tidak cukup menjawab, akui jujur dan sampaikan apa yang tersedia.',
    '',
    facts,
    '',
    `PERTANYAAN USER: """${question}"""`,
    'Langsung jawab tanpa basa-basi.',
  ].join('\n');

  const answer = await ai.generateText(prompt);
  const text = answer.length > 1900 ? `${answer.slice(0, 1900)}…` : answer;
  return sent.edit(text);
}

// ---------- Entry chat AI ----------
async function handleChat(message) {
  const content = message.content.replace(/<@!?\d+>/g, '').trim();
  if (content.length < 2) return message.reply('Hi 👋 tulis transaksimu, misal: "bayar parkir 2 ribu". Ketik !help untuk panduan.');

  if (!ai.isConfigured()) return message.reply(SETUP_AI);
  if (rateLimited(message.author.id)) {
    return message.reply('⏳ Pelan-pelan ya — batas 8 chat AI per menit 😄');
  }

  const sent = await message.reply('⏳ …');
  try {
    const raw = await ai.generateJSON(`${PARSE_SYSTEM_PROMPT}\n\nPESAN USER: """${content}"""`);
    const parsed = normalizeParse(raw);

    if (parsed.intent === 'TRANSACTION') {
      // amount 0 = parser gagal menangkap nominal
      if (!parsed.amount) {
        return sent.edit(`${FALLBACK_OTHER}\n\n(Transaksi terdeteksi tapi nominal tidak jelas.)`);
      }
      await handleTransaction(message, sent, parsed);
    } else if (parsed.intent === 'QUESTION') {
      if (!sheets.isConfigured()) return sent.edit('⚠️ Sheets belum dikonfigurasi — belum ada data untuk ditanya. Cek `TASKS.md` bagian C2.');
      const rows = await sheets.getAllForUser(message.author.id);
      await handleQuestion(message, sent, content, rows);
    } else {
      await sent.edit(FALLBACK_OTHER);
    }
  } catch (err) {
    console.error('[parser] gagal memproses chat:', err.message);
    const hint = err.status === 429
      ? ' (kuota Gemini sedang penuh, coba lagi sebentar)'
      : '';
    await sent.edit(`❌ Ups, gagal memproses: ${err.message.slice(0, 300)}${hint}`);
  }
}

module.exports = { handleChat, PARSE_SYSTEM_PROMPT, normalizeParse };
