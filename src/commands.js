'use strict';
// Perintah gratis-kuota-AI: !help, !rekap, !hapus, !kategori.

const { EmbedBuilder } = require('discord.js');
const sheets = require('./sheets');

const MONTHS = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const fmt = (v) => new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
}).format(v || 0);

const HELP_TEXT = [
  '🤖 **Cara pakai bot pencatat keuangan**',
  '',
  '📝 **Catat otomatis** — tulis gaya biasa di channel keuangan (atau mention bot):',
  '   "bayar parkir 2 ribu" • "makan siang 15k" • "gajian 3 juta" • "menabung 100rb"',
  '   Bisa beberapa sekaligus: "gaji 3.500.000 kemudian ditabung 500.000"',
  '',
  '❓ **Tanya data** — tanya apa saja soal keuanganmu:',
  '   "berapa pengeluaran bulan ini" • "berapa margin" • "apa saja yang saya beli tanggal 3"',
  '',
  '⚙️ **Perintah**',
  '   `!rekap` — rekap bulan ini',
  '   `!rekap hari` / `!rekap 8` / `!rekap lalu` / `!rekap all` — variasi rentang',
  '   `!hapus <id>` — batalkan transaksi (ID ada di footer reply bot)',
  '   `!saldo` — saldo awal + posisi terkini (kas & tabungan)',
  '   `!saldo awal kas 1500000 tabungan 2500000` — isi posisi awal keuanganmu',
  '   `!kategori` — lihat daftar kategori (3 kelompok: Pendapatan/Pengeluaran/Tabungan)',
  '   `!kategori tambah <grup> <nama>` — contoh: `!kategori tambah tabungan Dana Kuliah`',
  '   `!kategori hapus <nama>` • `!kategori pindah <grup> <nama>` • `!kategori reset`',
  '   `!help` — menu bantuan ini',
  '',
  '🔒 Data tiap user terpisah; hanya kamu yang bisa melihat datamu.',
  '🔒 Privasi: chat di server dibalas lewat DM (ditandai 🔒) — transaksimu tidak terbaca anggota lain.',
  '🔒 Chat di server terbaca orang — pakai **DM bot** langsung (tampilkan !help di DM-ku), di server bot hanya memberi arahan.',
].join('\n');

const SETUP_SHEETS = [
  '⚠️ Google Sheets belum dikonfigurasi.',
  'Isi di `.env`: `SPREADSHEET_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`,',
  'dan simpan file key JSON ke `SERVICE_ACCOUNT_KEY_FILE` (atau env `SERVICE_ACCOUNT_JSON`).',
  'Langkah lengkap ada di `README.md` bagian Setup.',
].join(' ');

async function cmdHelp(message) {
  return message.reply(HELP_TEXT);
}

// ---------- !rekap ----------
async function cmdRekap(message, args) {
  if (!sheets.isConfigured()) return message.reply(SETUP_SHEETS);

  const a = (args[0] || 'bulan').toLowerCase();
  const today = sheets.localDateStr();
  const thisMonth = sheets.monthPrefix(0);
  const year = Number(thisMonth.slice(0, 4));

  const allRows = await sheets.getAllForUser(message.author.id);
  let rows = allRows;
  let title;

  if (a === 'hari' || a === 'today') {
    rows = rows.filter((r) => r.date === today);
    title = `Rekap Hari Ini (${today})`;
  } else if (a === 'all' || a === 'semua') {
    title = 'Rekap Semua Transaksi';
  } else if (a === 'lalu') {
    const mp = sheets.monthPrefix(-1);
    rows = rows.filter((r) => (r.date || '').startsWith(mp));
    title = `Rekap Bulan Lalu (${mp})`;
  } else if (/^\d{1,2}$/.test(a)) {
    const n = Number(a);
    if (n < 1 || n > 12) {
      return message.reply('Pakai: `!rekap`, `!rekap hari`, `!rekap <angka 1-12>`, `!rekap lalu`, atau `!rekap all`.');
    }
    const mp = `${year}-${String(n).padStart(2, '0')}`;
    rows = rows.filter((r) => (r.date || '').startsWith(mp));
    title = `Rekap ${MONTHS[n - 1]} ${year}`;
  } else {
    rows = rows.filter((r) => (r.date || '').startsWith(thisMonth));
    title = 'Rekap Bulan Ini';
  }

  const s = sheets.summarize(rows);
  if (!s.count) {
    return message.reply(`📭 Belum ada transaksi untuk **${title}**. Coba catat dulu, misal: "bayar makan 20rb".`);
  }

  const top = Object.entries(s.byCat.expense)
    .sort((x, y) => y[1] - x[1])
    .slice(0, 3)
    .map(([c, v]) => `• ${c}: ${fmt(v)}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`📊 ${title}`);

  // Bila user mengisi saldo awal, tampilkan posisi terkini di atas rekap rentang
  try {
    const base = await sheets.getBalance(message.author.id);
    if (base) {
      const pos = sheets.applyBaseline(sheets.summarize(allRows), base);
      embed.addFields(
        { name: '💰 Kas sekarang', value: fmt(pos.cash), inline: true },
        { name: '🏦 Tabungan sekarang', value: fmt(pos.savings), inline: true },
        { name: 'Baseline awal', value: `kas ${fmt(base.cash)} • tabungan ${fmt(base.savings)}`, inline: false }
      );
    }
  } catch (e) {
    console.error('[commands] gagal ambil baseline:', e.message);
  }

  embed.addFields(
    { name: '💰 Pendapatan', value: fmt(s.income), inline: true },
    { name: '🛒 Pengeluaran', value: fmt(s.expense), inline: true },
    { name: '🏦 Tabungan (setor bersih)', value: fmt(s.savingsNet), inline: true },
    { name: '📈 Kas tersisa (margin)', value: fmt(s.net), inline: true },
    { name: 'Jumlah transaksi', value: String(s.count), inline: true },
    { name: 'Top kategori pengeluaran', value: top || '—', inline: false }
  );
  embed.setFooter({ text: `User: ${message.author.username}` });

  return message.reply({ embeds: [embed] });
}

// ---------- !hapus ----------
async function cmdHapus(message, args) {
  if (!sheets.isConfigured()) return message.reply(SETUP_SHEETS);

  const id = Number(args[0]);
  if (!Number.isInteger(id) || id < 2) {
    return message.reply('Format: `!hapus <id>`. ID transaksi ada di footer reply bot (contoh: `!hapus 12`).');
  }

  const res = await sheets.deleteTransaction(message.author.id, id);
  if (res.ok) {
    const label = sheets.GROUP_LABEL[res.row.group] || '';
    const desc = res.row.type === 'INCOME' ? 'pemasukan' : 'pengeluaran';
    return message.reply(`✅ Transaksi #${id} dibatalkan (${label ? label.toLowerCase() : desc}: ${res.row.description || '-'}).`);
  }
  const alasan = {
    not_found: 'Transaksi tidak ditemukan.',
    forbidden: 'Itu bukan transaksimu 🚫',
    deleted: 'Transaksi itu sudah dihapus sebelumnya.',
  };
  return message.reply(`❌ ${alasan[res.reason] || 'Gagal menghapus.'}`);
}

// ---------- !saldo ----------
/** Parser angka uang Indonesia: "1.500.000", "2,5 juta", "500ribu", "2.5k", "25rb" → angka int */
function toInt(x) {
  let raw = String(x || '').trim().toLowerCase();
  if (!raw || !/\d/.test(raw)) return null;
  const usedDecimal = /[.,]/.test(raw);

  let mult = 1;
  if (/juta|jt\b/.test(raw)) {
    mult = 1000000;
    raw = raw.replace(/juta/g, '').replace(/jt\b/g, '');
  } else if (/ribu|rbu\b|rb\b|(\d)k(\s|$)/.test(raw)) {
    mult = 1000;
    raw = raw.replace(/ribu/g, '').replace(/rbu/g, 'rb').replace(/rb\b/g, '').replace(/(\d)k(\s|$)/g, '$1');
  }

  raw = raw.replace(/\s+/g, '').replace(/[^0-9.,\-]/g, '');
  if (!/\d/.test(raw)) return null;

  // "1.500.000" / "1500,000" → ribuan (semua grup pas 3 digit) → buang pemisah
  const thousands = /^-?\d{1,3}(\.\d{3})+$/.test(raw) || /^-?\d{1,3}(,\d{3})+$/.test(raw);
  if (thousands) {
    raw = raw.replace(/[.,]/g, '');
  } else {
    raw = raw.replace(/,/g, '.'); // "2,5" → 2.5
  }

  // desimal tanpa satuan ("2,5" / "1,5") dalam kontekst keuangan = pecahan ribu
  if (mult === 1 && usedDecimal && !thousands) {
    const n0 = Number(raw);
    if (Number.isFinite(n0) && n0 > 0 && n0 < 10) return Math.round(n0 * 1000);
  }

  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * mult);
}

// format: !saldo awal [kas N] [tabungan N] — urutan bebas, boleh salah satu saja,
// bentuk angka bebas: 1500000 / 1.500.000 / 1,5jt / 1,5 juta / 500ribu / 2.5jt
function parseAwalArgs(args) {
  // bridge: "kas=500ribu" atau kode sama-sama → pisah "=" jadi spasi
  const args2 = args.map((a) => a.replace(/=/g, ' ').split(/\s+/)).flat();
  let cash = null;
  let savings = null;
  for (let i = 0; i < args2.length; i++) {
    const k = String(args2[i]).toLowerCase();
    if (k === 'kas' || k === 'cash') {
      const v = toInt(args2[i + 1]);
      if (v != null) cash = v;
      i++;
    } else if (['savings', 'saving', 'tabungan'].includes(k)) {
      const v = toInt(args2[i + 1]);
      if (v != null) savings = v;
      i++;
    }
  }
  return { cash, savings, hasAny: cash != null || savings != null };
}

async function cmdSaldo(message, args) {
  if (!sheets.isConfigured()) return message.reply(SETUP_SHEETS);

  const sub = (args[0] || '').toLowerCase();

  if (sub === 'awal' || sub === 'set') {
    const pairs = parseAwalArgs(args.slice(1));
    if (!pairs.hasAny) {
      return message.reply('Format: `!saldo awal kas <jumlah> tabungan <jumlah>` — boleh salah satu saja.\nContoh: `!saldo awal kas 1.500.000 tabungan 2.500.000`');
    }
    const base = await sheets.setBalance(message.author, { cash: pairs.cash, savings: pairs.savings });
    return message.reply(`✅ Saldo awal tersimpan: kas ${fmt(base.cash)} • tabungan ${fmt(base.savings)}\n(Angka ini jadi titik tolak semua hitungan posisi terkini.)`);
  }

  if (sub === 'reset') {
    const removed = await sheets.resetBalance(message.author.id);
    return message.reply(removed
      ? '♻️ Saldo awal dihapus. Posisi dihitung kembali hanya dari transaksi yang tercatat.'
      : 'Belum ada saldo awal yang tersimpan — tidak ada yang direset.');
  }

  // default: tampilkan baseline + posisi terkini
  const [base, allRows] = await Promise.all([
    sheets.getBalance(message.author.id),
    sheets.getAllForUser(message.author.id),
  ]);

  if (!base && !allRows.length) {
    return message.reply(
      '📭 Belum ada apa-apa. Mulai dengan isi posisi awalmu:\n`!saldo awal kas 1.500.000 tabungan 2.500.000`\natau langsung catat: "bayar makan 20rb"'
    );
  }

  const sAll = sheets.summarize(allRows);
  const pos = sheets.applyBaseline(sAll, base);
  const mp = sheets.monthPrefix(0);
  const sMonth = sheets.summarize(allRows.filter((r) => (r.date || '').startsWith(mp)));

  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('💼 Posisi Keuangan')
    .addFields(
      { name: '💰 Kas sekarang', value: fmt(pos.cash), inline: true },
      { name: '🏦 Tabungan sekarang', value: fmt(pos.savings), inline: true },
      { name: 'Baseline (saldo awal)', value: base ? `kas ${fmt(base.cash)} • tabungan ${fmt(base.savings)}` : 'belum diisi — set: `!saldo awal kas ... tabungan ...`', inline: false },
      { name: 'Bulan ini', value: `pendapatan ${fmt(sMonth.income)} • pengeluaran ${fmt(sMonth.expense)} • tabungan ${fmt(sMonth.savingsNet)}`, inline: false }
    )
    .setFooter({ text: `User: ${message.author.username}` });

  return message.reply({ embeds: [embed] });
}

// ---------- !kategori ----------
async function cmdKategoriList(message) {
  const cats = await sheets.getCategories();
  const fields = sheets.GROUP_KEYS.map((g) => {
    const names = cats.filter((c) => c.group === g).map((c) => c.name);
    return { name: `${sheets.GROUP_LABEL[g]} (${names.length})`, value: names.length ? names.join(', ') : '—', inline: false };
  });
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🏷️ Daftar Kategori (3 kelompok)')
    .addFields(...fields)
    .setFooter({ text: 'Kelola: !kategori tambah <grup> <nama> • hapus <nama> • pindah <grup> <nama> • reset' });
  return message.reply({ embeds: [embed] });
}

async function cmdKategoriTambah(message, args) {
  // format: tambah <grup> <nama>
  const group = args[0];
  const name = args.slice(1).join(' ');
  if (!name) {
    return message.reply('Format: `!kategori tambah <grup> <nama>` — grup: `pendapatan` / `pengeluaran` / `tabungan`.\nContoh: `!kategori tambah tabungan Dana Kuliah`');
  }
  const cat = await sheets.addCategory(name, group);
  return message.reply(`✅ Kategori **${cat.name}** ditambahkan ke kelompok **${sheets.GROUP_LABEL[cat.group]}**.`);
}

async function cmdKategoriHapus(message, args) {
  const name = args.join(' ');
  if (!name) return message.reply('Format: `!kategori hapus <nama>`\nContoh: `!kategori hapus Dana Kuliah`');
  const cat = await sheets.removeCategory(name);
  if (!cat) return message.reply(`❌ Kategori **"${name}"** tidak ditemukan. Cek daftar dengan \`!kategori\`.`);
  return message.reply(`🗑️ Kategori **${cat.name}** (${sheets.GROUP_LABEL[cat.group] || cat.group}) dihapus.`);
}

async function cmdKategoriPindah(message, args) {
  // format: pindah <grup> <nama>
  const group = args[0];
  const name = args.slice(1).join(' ');
  if (!name) {
    return message.reply('Format: `!kategori pindah <grup> <nama>` — contoh: `!kategori pindah tabungan Investasi`');
  }
  const cat = await sheets.moveCategory(name, group);
  if (!cat) return message.reply(`❌ Kategori **"${name}"** tidak ditemukan.`);
  return message.reply(`🔀 Kategori **${cat.name}** dipindahkan ke kelompok **${sheets.GROUP_LABEL[cat.group]}**.`);
}

async function cmdKategori(message, args) {
  if (!sheets.isConfigured()) return message.reply(SETUP_SHEETS);

  const sub = (args[0] || '').toLowerCase();
  const rest = args.slice(1);

  try {
    switch (sub) {
      case '':
      case 'list':
      case 'lihat':
        return await cmdKategoriList(message);
      case 'tambah':
      case 'add':
        return await cmdKategoriTambah(message, rest);
      case 'hapus':
      case 'delete':
        return await cmdKategoriHapus(message, rest);
      case 'pindah':
      case 'move':
        return await cmdKategoriPindah(message, rest);
      case 'reset':
        await sheets.resetCategories();
        return message.reply('♻️ Daftar kategori dikembalikan ke default. Cek: `!kategori`');
      default:
        return message.reply('Sub-perintah `!kategori`:\n• `!kategori` — lihat daftar\n• `!kategori tambah <grup> <nama>`\n• `!kategori hapus <nama>`\n• `!kategori pindah <grup> <nama>`\n• `!kategori reset`');
    }
  } catch (err) {
    return message.reply(`❌ ${err.message.slice(0, 200)}`);
  }
}

async function handleCommand(message) {
  const parts = message.content.trim().split(/\s+/);
  const cmd = (parts.shift() || '').toLowerCase();
  const args = parts;

  switch (cmd) {
    case '!help':
    case '!bantuan':
      return cmdHelp(message);
    case '!rekap':
      return cmdRekap(message, args);
    case '!hapus':
      return cmdHapus(message, args);
    case '!saldo':
      return cmdSaldo(message, args);
    case '!kategori':
      return cmdKategori(message, args);
    default:
      return message.reply(`Perintah \`${cmd}\` tidak dikenal 🤔 Ketik \`!help\` untuk daftar perintah.`);
  }
}

module.exports = { handleCommand };
