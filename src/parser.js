'use strict';
// Jembatan chat AI: klasifikasi (TRANSACTION / QUESTION / OTHER) via Gemini,
// lalu simpan transaksi ke Sheets (dengan kelompok kategori) atau jawab pertanyaan
// dari data user. Daftar kategori yang dipakai berasal dari tab "Categories"

const { EmbedBuilder } = require('discord.js');
const ai = require('./ai');
const sheets = require('./sheets');

const fmt = (v) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(Math.round(v || 0));

const SETUP_AI = '⚠️ AI (Gemini) belum dikonfigurasi. Isi `GEMINI_API_KEY` di `.env` lalu restart bot. Langkah ada di `README.md` bagian Setup.';
const FALLBACK_OTHER = '✏️ Aku belum paham maksudmu 🤔 Contoh pencatatan: "bayar parkir 2 ribu", "menabung 100rb", "gajian 3 juta". Atau tanya: "berapa pengeluaran bulan ini"';

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
function buildParsePrompt(categoryList = []) {
  const list = Array.isArray(categoryList) && categoryList.length
    ? categoryList
    : sheets.DEFAULT_CATEGORIES.map(([name, group]) => ({ name, group }));

  const perGroup = sheets.GROUP_KEYS.map((g) => {
    const names = list.filter((c) => c.group === g).map((c) => c.name);
    return `- ${sheets.GROUP_LABEL[g]}: ${names.length ? names.join(', ') : '(kosong)'}`;
  }).join('\n');

  return `Kamu adalah modul parser keuangan untuk bot Discord berbahasa Indonesia.
Analisis pesan user, lalu jawab HANYA JSON valid dengan skema berikut:
{"intent":"TRANSACTION|QUESTION|OTHER","transaction_type":"EXPENSE|INCOME","group":"INCOME|EXPENSE|SAVINGS","amount":0,"category":"","description":""}

Aturan:
1. intent TRANSACTION = pesan mencatat pergerakan uang.
   - transaction_type = arus kas: EXPENSE (uang keluar: bayar, beli, belanja, isi, top up, makan, jajan, menabung/setor tabungan) atau INCOME (uang masuk: gajian, terima, dibayari, bonus, THR, penjualan, jual, tarik tabungan/ambil tabungan).
   - group = kelompok kategori: INCOME (pendapatan), EXPENSE (pengeluaran barang/jasa), SAVINGS (uang dipindah ke/ditarik dari tabungan, seperti menabung, setor/tabungan, investasi rutin, tarik tabungan).
   - flow vs group: "menabung 100rb" → transaction_type=EXPENSE, group=SAVINGS. "tarik tabungan 50rb" → transaction_type=INCOME, group=SAVINGS. "gajian 3 juta" → transaction_type=INCOME, group=INCOME. "bayar parkir 2 ribu" → transaction_type=EXPENSE, group=EXPENSE.
   - category WAJIB salah satu dari daftar di bawah, dan HARUS milik group yang kamu pilih.
   - Konversi nominal: "2 ribu"/"2rb"/"2k" = 2000; "15k" = 15000; "300rb" = 300000; "2,5 ribu"/"2.5k" = 2500; "2 juta"/"2jt" = 2000000; "3,5 jt" = 3500000. 1 ribu selalu 1000.
   - Jika ada beberapa angka, pilih yang paling mungkin sebagai total transaksi (harga item, bukan tanggal/kuantitas seperti "2 orang").
   - description = label singkat maksimal 5 kata (nama item/kegiatan, tanpa kata "bayar").
2. intent QUESTION = pertanyaan tentang data keuangan user: berapa total pengeluaran/pendapatan/tabungan, saldo, margin/selisih, rekap, riwayat, "apa saja yang saya beli pada tanggal X", dsb.
3. intent OTHER = sapaan/ngobrol biasa, atau instruksi lain yang bukan transaksi maupun pertanyaan data.
4. Isi field yang tidak relevan dengan null. Jangan tambahkan teks apa pun di luar JSON.

LIST KATEGORI TERKINI (milik user, update via !kategori — WAJIB dari sini):
${perGroup}

Contoh:
- "bayar parkir 2 ribu" → {"intent":"TRANSACTION","transaction_type":"EXPENSE","group":"EXPENSE","amount":2000,"category":"Transportasi","description":"Parkir"}
- "makan siang 15k" → {"intent":"TRANSACTION","transaction_type":"EXPENSE","group":"EXPENSE","amount":15000,"category":"Makanan","description":"Makan siang"}
- "gajian 3 juta" → {"intent":"TRANSACTION","transaction_type":"INCOME","group":"INCOME","amount":3000000,"category":"Gaji","description":"Gajian"}
- "menabung 100 rb" → {"intent":"TRANSACTION","transaction_type":"EXPENSE","group":"SAVINGS","amount":100000,"category":"Tabungan","description":"Menabung"}
- "tarik tabungan 50rb" → {"intent":"TRANSACTION","transaction_type":"INCOME","group":"SAVINGS","amount":50000,"category":"Tabungan","description":"Tarik tabungan"}
- "berapa pengeluaran bulan ini" → {"intent":"QUESTION","transaction_type":null,"group":null,"amount":null,"category":null,"description":null}
- "halo" → {"intent":"OTHER","transaction_type":null,"group":null,"amount":null,"category":null,"description":null}`;
}

function normalizeParse(result, cats) {
  const list = Array.isArray(cats) && cats.length
    ? cats
    : sheets.DEFAULT_CATEGORIES.map(([name, group]) => ({ name, group }));

  let intent = String((result && result.intent) || 'OTHER').toUpperCase();
  if (!['TRANSACTION', 'QUESTION', 'OTHER'].includes(intent)) intent = 'OTHER';

  let flow = String((result && result.transaction_type) || '').toUpperCase();
  if (!['EXPENSE', 'INCOME'].includes(flow)) flow = 'EXPENSE';

  let group = sheets.parseGroup(result && result.group);
  if (!group) group = flow === 'INCOME' ? 'INCOME' : 'EXPENSE';

  const wanted = String((result && result.category) || '').trim();
  const found = list.find((c) => c.name.toLowerCase() === wanted.toLowerCase());
  let category;
  if (found) {
    category = found.name;
    group = found.group; // grup selalu ikut grup kategorinya
  } else {
    const prefGroup = group === 'SAVINGS' ? 'SAVINGS' : (flow === 'INCOME' ? 'INCOME' : 'EXPENSE');
    const prefName = prefGroup === 'SAVINGS' ? 'Tabungan' : 'Lainnya';
    const cand = list.find((c) => c.group === prefGroup && c.name.toLowerCase() === prefName.toLowerCase())
      || list.find((c) => c.group === prefGroup)
      || list.find((c) => c.name.toLowerCase() === 'lainnya');
    category = cand ? cand.name : 'Lainnya';
  }

  return {
    intent,
    transaction_type: flow,
    group,
    amount: Math.round(Number(result && result.amount) || 0),
    category,
    description: String((result && result.description) || 'Transaksi').slice(0, 60),
  };
}

// ---------- Handler transaksi ----------
async function handleTransaction(message, sent, parsed) {
  if (!sheets.isConfigured()) {
    return sent.edit('⚠️ Transaksi dikenali, tapi Google Sheets belum dikonfigurasi — belum tersimpan. Cek README.md bagian Setup.');
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
    saldo = `Bulan ini: pendapatan ${fmt(s.income)} • pengeluaran ${fmt(s.expense)} • tabungan ${fmt(s.savingsNet)}`;
  } catch (e) {
    console.error('[parser] gagal hitung saldo:', e.message);
  }

  const label = sheets.GROUP_LABEL[parsed.group] || 'Pengeluaran';
  const emoji = parsed.group === 'SAVINGS' ? '🏦' : (parsed.transaction_type === 'INCOME' ? '💰' : '🛒');
  const embed = new EmbedBuilder()
    .setColor(parsed.group === 'SAVINGS' ? 0xfee75c : (parsed.transaction_type === 'INCOME' ? 0x57f287 : 0xed4245))
    .setTitle(`${emoji} ${label} tercatat`)
    .setDescription(`**${parsed.description} — ${fmt(parsed.amount)}**${saldo ? `\n\n${saldo}` : ''}`)
    .addFields({ name: 'Kategori', value: parsed.category, inline: true })
    .setFooter({ text: `ID #${rowIndex} • ketik !hapus ${rowIndex} untuk membatalkan` });

  return sent.edit({ content: '✅ Done!', embeds: [embed] });
}

// ---------- Handler pertanyaan (Q&A) ----------
function buildFacts(rows) {
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
  const perTabungan = Object.entries(bulanIni.byCat.savings)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([c, v]) => `${c}: ${fmt(v)}`)
    .join(', ');

  const marginPct = bulanIni.income > 0
    ? ` (margin ${(bulanIni.net / bulanIni.income * 100).toFixed(1)}%)`
    : '';

  const lines = rows
    .slice(-150)
    .map((r) => `#${r.rowIndex} | ${r.date} | ${r.type} | ${r.group || '-'} | ${r.category} | ${r.description} | ${fmt(r.amount)}`)
    .join('\n');

  return [
    `Tanggal hari ini: ${today}. Bulan berjalan: ${mp}. Bulan lalu: ${mpLalu}.`,
    'Interpretasi: margin/ selisih = pendapatan − pengeluaran. Tabungan = uang dipindah ke/dari tabungan (masuk kas bukan biaya).',
    '',
    'RINGKASAN TERHITUNG KODE (angka ini pasti benar, pakai untuk jawaban):',
    `- Bulan ini: pendapatan ${fmt(bulanIni.income)}, pengeluaran ${fmt(bulanIni.expense)}, setor tabungan (bersih) ${fmt(bulanIni.savingsNet)}, margin ${fmt(bulanIni.net)}${marginPct}, jumlah ${bulanIni.count} transaksi`,
    `- Bulan lalu: pendapatan ${fmt(bulanLalu.income)}, pengeluaran ${fmt(bulanLalu.expense)}, tabungan ${fmt(bulanLalu.savingsNet)}, margin ${fmt(bulanLalu.net)}`,
    `- Hari ini: pendapatan ${fmt(hariIni.income)}, pengeluaran ${fmt(hariIni.expense)}`,
    `- Pengeluaran bulan ini per kategori: ${perKategori || 'belum ada'}`,
    `- Pergerakan tabungan bulan ini per kategori: ${perTabungan || 'belum ada'}`,
    '',
    'DATA TRANSAKSI (terbaru di bawah):',
    lines || '(kosong)',
  ].join('\n');
}

async function handleQuestion(message, sent, question, rows) {
  if (!rows.length) {
    return sent.edit('📭 Belum ada transaksi tercatat untukmu. Coba catat dulu, misal: "bayar kopi 25rb"');
  }
  const facts = buildFacts(rows);
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

  let categoryList = [];
  try {
    categoryList = await sheets.getCategories();
  } catch (e) {
    console.error('[parser] gagal ambil kategori, pakai default:', e.message);
  }

  const sent = await message.reply('⏳ …');
  try {
    const raw = await ai.generateJSON(`${buildParsePrompt(categoryList)}\n\nPESAN USER: """${content}"""`);
    const parsed = normalizeParse(raw, categoryList);

    if (parsed.intent === 'TRANSACTION') {
      // amount 0 = parser gagal menangkap nominal
      if (!parsed.amount) {
        return sent.edit(`${FALLBACK_OTHER}\n\n(Transaksi terdeteksi tapi nominal tidak jelas.)`);
      }
      await handleTransaction(message, sent, parsed);
    } else if (parsed.intent === 'QUESTION') {
      if (!sheets.isConfigured()) return sent.edit('⚠️ Sheets belum dikonfigurasi — belum ada data untuk ditanya. Cek README.md bagian Setup.');
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

module.exports = { handleChat, buildParsePrompt, normalizeParse };
