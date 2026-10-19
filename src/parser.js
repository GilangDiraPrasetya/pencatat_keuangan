'use strict';
// Jembatan chat AI: klasifikasi (TRANSACTION / QUESTION / OTHER) via Gemini.
// Mendukung MULTI-TRANSAKSI dalam satu chat (items: [...], max 6).
// Daftar kategori dinamis dari tab "Categories" (via !kategori), dengan 3 kelompok.

const { EmbedBuilder } = require('discord.js');
const ai = require('./ai');
const sheets = require('./sheets');

const fmt = (v) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(Math.round(v || 0));

const SETUP_AI = '⚠️ AI (Gemini) belum dikonfigurasi. Isi `GEMINI_API_KEY` di `.env` lalu restart bot. Langkah ada di `README.md` bagian Setup.';
const FALLBACK_OTHER = '✏️ Aku belum paham maksudmu 🤔 Contoh: "bayar parkir 2 ribu", "menabung 100rb", "gajian 3 juta", atau dua sekaligus: "gaji 3.500.000 kemudian ditabung 500.000". Bisa juga tanya: "berapa pengeluaran bulan ini"';

const MAX_ITEMS = 6;

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
    return `- ${sheets.GROUP_LABEL[g]} (${g}): ${names.length ? names.join(', ') : '(kosong)'}`;
  }).join('\n');

  return `Kamu adalah modul parser keuangan untuk bot Discord berbahasa Indonesia.
Analisis pesan user, lalu jawab HANYA JSON valid.

SKEMA KELUARAN:
{"intent":"TRANSACTION|QUESTION|OTHER","items":[<item>,...]}
- QUESTION/OTHER: items = null, field lain null.
- TRANSACTION: setiap item berbentuk:
  {"transaction_type":"EXPENSE|INCOME","group":"INCOME|EXPENSE|SAVINGS","amount":0,"category":"","description":""}

Aturan:
1. transaction_type = arus kas: EXPENSE (uang keluar: bayar, beli, belanja, isi, top up, makan, jajan, menabung/setor tabungan) atau INCOME (uang masuk: gajian, terima, dibayari, bonus, THR, penjualan, jual, tarik/ambil tabungan).
2. group = kelompok kategori: INCOME (pendapatan), EXPENSE (pengeluaran barang/jasa), SAVINGS (uang dipindah ke/ditarik dari tabungan atau investasi).
   - "menabung 100rb" → EXPENSE + SAVINGS. "tarik tabungan 50rb" → INCOME + SAVINGS. "gajian 3 juta" → INCOME + INCOME. "bayar parkir 2 ribu" → EXPENSE + EXPENSE.
3. category WAJIB salah satu dari daftar di bawah, dan HARUS milik group yang dipilih.
4. Konversi nominal: "2 ribu"/"2rb"/"2k" = 2000; "15k" = 15000; "300rb" = 300000; "2,5 ribu"/"2.5k" = 2500; "2 juta"/"2jt" = 2000000; "3,5 jt" = 3500000; "3.500.000" = 3500000. 1 ribu selalu 1000.
5. MULTI-TRANSAKSI: jika pesan berisi lebih dari SATU pergerakan uang (kata penghubung "kemudian", "lalu", "dan", "… buat …"), pecah jadi beberapa item pada "items" (maksimal 6). Nominal yang sama pada "… buat …" berlaku juga untuk pergerakan berikutnya.
   - "gaji 3.500.000 kemudian ditabung 500.000" → items: [INCOME/INCOME "Gajian" 3500000, EXPENSE/SAVINGS "Menabung" 500000]
   - "ambil tabungan 500.000 buat beli sepatu" → items: [INCOME/SAVINGS "Tarik tabungan" 500000, EXPENSE/EXPENSE "Beli sepatu" 500000]
   - Satu transaksi pun tetap boleh dalam "items" (panjang 1).
6. intent QUESTION = pertanyaan tentang data keuangan user: berapa total pengeluaran/pendapatan/tabungan/kas, saldo, margin/selisih, rekap, riwayat, "apa saja yang saya beli pada tanggal X", dsb.
7. intent OTHER = sapaan/ngobrol biasa, atau instruksi lain yang bukan transaksi/pertanyaan data.
8. description = label singkat maksimal 5 kata (nama item/kegiatan). Field tak relevan = null. Jangan tambahkan teks di luar JSON.

LIST KATEGORI TERKINI (milik user, update via !kategori — WAJIB dari sini):
${perGroup}

Contoh QUESTION/OTHER:
- "berapa pengeluaran bulan ini" → {"intent":"QUESTION","items":null}
- "halo" → {"intent":"OTHER","items":null}`;
}

// ---------- Normalisasi 1 item transaksi ----------
function normalizeItem(raw, cats, fallbackFlow) {
  const list = Array.isArray(cats) && cats.length
    ? cats
    : sheets.DEFAULT_CATEGORIES.map(([name, group]) => ({ name, group }));

  let flow = String((raw && raw.transaction_type) || '').toUpperCase();
  if (!['EXPENSE', 'INCOME'].includes(flow)) flow = fallbackFlow || 'EXPENSE';

  let group = sheets.parseGroup(raw && raw.group);
  if (!group) group = flow === 'INCOME' ? 'INCOME' : 'EXPENSE';

  const wanted = String((raw && raw.category) || '').trim();
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
    transaction_type: flow,
    group,
    amount: Math.round(Number(raw && raw.amount) || 0),
    category,
    description: String((raw && raw.description) || 'Transaksi').slice(0, 60),
  };
}

function intentOf(result) {
  let intent = String((result && result.intent) || 'OTHER').toUpperCase();
  if (!['TRANSACTION', 'QUESTION', 'OTHER'].includes(intent)) intent = 'OTHER';
  return intent;
}

/**
 * Normalisasi keluaran Gemini:
 * legacy (field tunggal) maupun items[] → selalu { intent, items: [...] }
 */
function normalizeParse(result, cats) {
  const intent = intentOf(result);
  if (intent !== 'TRANSACTION') return { intent, items: [] };

  let rawItems = Array.isArray(result && result.items) ? result.items : null;
  if (!rawItems && result && (result.amount || result.category)) {
    rawItems = [result]; // fallback field tunggal (legacy)
  }
  let items = (rawItems || []).slice(0, MAX_ITEMS).map((it) => normalizeItem(it, cats));
  // Baris pertama menentukan fallback flow untuk item berikutnya
  if (items.length > 1) {
    items = items.map((it, i) => (i === 0 ? it : normalizeItem(rawItems[i], cats, items[0].transaction_type)));
  }
  return { intent, items };
}

// ---------- Handler transaksi (tunggal & multi) ----------
function saldoBulanIni(rows) {
  const mp = sheets.monthPrefix(0);
  const s = sheets.summarize(rows.filter((r) => (r.date || '').startsWith(mp)));
  return {
    text: `Bulan ini: pendapatan ${fmt(s.income)} • pengeluaran ${fmt(s.expense)} • tabungan ${fmt(s.savingsNet)} • kas tersisa (margin) ${fmt(s.net)}`,
    raw: s,
  };
}

function badge(t) {
  if (t.group === 'SAVINGS') return '🏦';
  return t.transaction_type === 'INCOME' ? '💰' : '🛒';
}

async function handleTransaction(message, sent, items) {
  if (!sheets.isConfigured()) {
    return sent.edit('⚠️ Transaksi dikenali, tapi Google Sheets belum dikonfigurasi — belum tersimpan. Cek README.md bagian Setup.');
  }

  const ids = [];
  for (const t of items) {
    // eslint-disable-next-line no-await-in-loop — simpan berurutan agar ID baris kronologis
    const { rowIndex } = await sheets.appendTransaction({
      user: message.author,
      txn: t,
      msgId: message.id,
    });
    ids.push(rowIndex);
  }

  const single = items.length === 1;
  if (single) {
    const t = items[0];
    const id = ids[0];
    let saldo = '';
    try {
      const rows = await sheets.getAllForUser(message.author.id);
      saldo = saldoBulanIni(rows).text;
    } catch (e) {
      console.error('[parser] gagal hitung saldo:', e.message);
    }
    const label = sheets.GROUP_LABEL[t.group] || 'Pengeluaran';
    const embed = new EmbedBuilder()
      .setColor(t.group === 'SAVINGS' ? 0xfee75c : (t.transaction_type === 'INCOME' ? 0x57f287 : 0xed4245))
      .setTitle(`${badge(t)} ${label} tercatat`)
      .setDescription(`**${t.description} — ${fmt(t.amount)}**${saldo ? `\n\n${saldo}` : ''}`)
      .addFields({ name: 'Kategori', value: t.category, inline: true })
      .setFooter({ text: `ID #${id} • ketik !hapus ${id} untuk membatalkan` });
    return sent.edit({ content: '✅ Done!', embeds: [embed] });
  }

  // Multi: satu embed, daftar semua
  const lines = items.map((t, i) => {
    const label = sheets.GROUP_LABEL[t.group] || 'Pengeluaran';
    return `#${ids[i]} ${badge(t)} **${label}** · ${t.description} — ${fmt(t.amount)}`;
  }).join('\n');
  const footer = ids.filter(Boolean).map((id) => `!hapus ${id}`).join(' · ');

  let saldo = '';
  try {
    const rows = await sheets.getAllForUser(message.author.id);
    saldo = saldoBulanIni(rows).text;
  } catch (e) {
    console.error('[parser] gagal hitung saldo:', e.message);
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`✅ ${items.length} transaksi tercatat`)
    .setDescription(`${lines}\n\n${saldo}`)
    .setFooter({ text: `Batal: ${footer} (per nomor)` });
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
    'Istilah: pengeluaran = konsumsi barang/jasa; tabungan = uang dipindah ke/dari tabungan (bukan biaya); margin/kas tersisa = pendapatan − pengeluaran − setor tabungan bersih (uang yang benar-benar tersisa di kas).',
    '',
    'RINGKASAN TERHITUNG KODE (angka ini pasti benar, pakai untuk jawaban):',
    `- Bulan ini: pendapatan ${fmt(bulanIni.income)}, pengeluaran ${fmt(bulanIni.expense)}, tabungan (setor bersih) ${fmt(bulanIni.savingsNet)}, margin/kas tersisa ${fmt(bulanIni.net)}${marginPct}, jumlah ${bulanIni.count} transaksi`,
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
      const valid = parsed.items.filter((t) => t.amount > 0);
      if (!valid.length) {
        return sent.edit(`${FALLBACK_OTHER}\n\n(Transaksi terdeteksi tapi nominal tidak jelas.)`);
      }
      await handleTransaction(message, sent, valid);
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

module.exports = { handleChat, buildParsePrompt, normalizeParse, normalizeItem };
