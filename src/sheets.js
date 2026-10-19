'use strict';
// Semua akses Google Sheets memakai Service Account (gratis).
// Tab yang dipakai:
//   - "Transactions": data transaksi (dibuat otomatis + header bila belum ada)
//   - "Categories": daftar kategori dinamis (name, group) — dikelola via !kategori

const fs = require('fs');
const { google } = require('googleapis');

const SHEET_NAME = 'Transactions';
const HEADER = [
  'timestamp', 'date', 'user_id', 'username', 'type', 'category',
  'description', 'amount', 'currency', 'msg_id', 'status', 'group',
];

const CAT_SHEET_NAME = 'Categories';
const CAT_HEADER = ['name', 'group'];

// Kelompok kategori: pendapatan (INCOME) / pengeluaran (EXPENSE) / tabungan (SAVINGS)
const GROUP_KEYS = ['INCOME', 'EXPENSE', 'SAVINGS'];
const GROUP_LABEL = { INCOME: 'Pendapatan', EXPENSE: 'Pengeluaran', SAVINGS: 'Tabungan' };

const DEFAULT_CATEGORIES = [
  ['Gaji', 'INCOME'], ['Bonus', 'INCOME'], ['Penjualan', 'INCOME'], ['Hadiah', 'INCOME'],
  ['Lainnya', 'INCOME'],
  ['Makanan', 'EXPENSE'], ['Transportasi', 'EXPENSE'], ['Belanja', 'EXPENSE'],
  ['Tagihan', 'EXPENSE'], ['Hiburan', 'EXPENSE'], ['Kesehatan', 'EXPENSE'],
  ['Pendidikan', 'EXPENSE'], ['Lainnya', 'EXPENSE'],
  ['Tabungan', 'SAVINGS'], ['Investasi', 'SAVINGS'], ['Dana Darurat', 'SAVINGS'],
];

// Terjemahkan sebutan grup dari user ke key kanonik
function parseGroup(input) {
  const s = String(input || '').trim().toLowerCase();
  const map = {
    pendapatan: 'INCOME', income: 'INCOME', pemasukan: 'INCOME', gaji: 'INCOME',
    pengeluaran: 'EXPENSE', expense: 'EXPENSE', biaya: 'EXPENSE', belanja: 'EXPENSE',
    tabungan: 'SAVINGS', savings: 'SAVINGS', saving: 'SAVINGS', investasi: 'SAVINGS',
  };
  return map[s] || null;
}

// ---------- Konfigurasi ----------
// Dua mode: (1) file JSON key lokal via SERVICE_ACCOUNT_KEY_FILE (paling aman),
//           (2) isi JSON service account utuh di env SERVICE_ACCOUNT_JSON (untuk deploy, file tak ter-commit)
let cachedConfig = false;
function getConfig() {
  if (cachedConfig !== false) return cachedConfig;
  const spreadsheetId = (process.env.SPREADSHEET_ID || '').trim();
  if (!spreadsheetId) return false;

  const keyFile = (process.env.SERVICE_ACCOUNT_KEY_FILE || '').trim();
  if (keyFile && fs.existsSync(keyFile)) {
    const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    if (!email) return false;
    cachedConfig = { spreadsheetId, email, keyFile };
    return cachedConfig;
  }

  const inline = (process.env.SERVICE_ACCOUNT_JSON || '').trim();
  if (inline) {
    try {
      const sa = JSON.parse(inline);
      if (!sa.private_key || !sa.client_email) {
        console.error('[sheets] SERVICE_ACCOUNT_JSON tidak berisi private_key/client_email');
        return false;
      }
      cachedConfig = { spreadsheetId, email: sa.client_email, key: sa.private_key };
      return cachedConfig;
    } catch (e) {
      console.error('[sheets] SERVICE_ACCOUNT_JSON bukan JSON valid:', e.message.slice(0, 120));
      return false;
    }
  }

  return false;
}

function isConfigured() {
  return Boolean(getConfig());
}

async function getClient() {
  const cfg = getConfig();
  if (!cfg) {
    throw new Error('Google Sheets belum dikonfigurasi (SPREADSHEET_ID / SERVICE_ACCOUNT).');
  }
  const auth = new google.auth.JWT({
    email: cfg.email,
    key: cfg.key,          // dipakai pada mode env SERVICE_ACCOUNT_JSON
    keyFile: cfg.keyFile,  // dipakai pada mode file JSON lokal
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return { sheets: google.sheets({ version: 'v4', auth }), cfg };
}

// ---------- Waktu & tanggal (timezone-aware) ----------
const TZ = () => process.env.BOT_TIMEZONE || 'Asia/Jakarta';

function partsOf(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ(),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  if (p.hour === '24') p.hour = '00';
  return p;
}

function localDateStr(date = new Date()) {
  const p = partsOf(date);
  return `${p.year}-${p.month}-${p.day}`;
}

function localTimestamp(date = new Date()) {
  const p = partsOf(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

function monthPrefix(offsetMonths = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offsetMonths);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: TZ(), year: 'numeric', month: '2-digit' })
      .formatToParts(d).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}`;
}

// ---------- Inisialisasi tab Transactions ----------
let sheetReady = false;

async function writeHeader({ sheets, cfg }) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: cfg.spreadsheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    resource: { values: [HEADER] },
  });
}

// Pastikan tab "Transactions" + header ada (idempotent, di-cache sekali jalan).
async function ensureSheet() {
  if (sheetReady) return;
  const { sheets, cfg } = await getClient();

  const meta = await sheets.spreadsheets.get({ spreadsheetId: cfg.spreadsheetId });
  const exists = (meta.data.sheets || []).some((s) => s.properties?.title === SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: cfg.spreadsheetId,
      resource: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
    });
    await writeHeader({ sheets, cfg });
  } else {
    const head = await sheets.spreadsheets.values.get({
      spreadsheetId: cfg.spreadsheetId,
      range: `${SHEET_NAME}!A1:L1`,
    });
    const values = head.data.values || [];
    if (!values.length) {
      await writeHeader({ sheets, cfg });
    } else if (values[0].length < HEADER.length) {
      // Header lama (11 kolom) → perbarui agar kolom "group" ikut ada (data lama tetap valid)
      await writeHeader({ sheets, cfg });
    }
  }
  sheetReady = true;
}

// ---------- Inisialisasi tab Categories ----------
let catReady = false;

async function writeCatHeader({ sheets, cfg }) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: cfg.spreadsheetId,
    range: `${CAT_SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    resource: { values: [CAT_HEADER] },
  });
}

async function ensureCatSheet() {
  if (catReady) return;
  const { sheets, cfg } = await getClient();

  const meta = await sheets.spreadsheets.get({ spreadsheetId: cfg.spreadsheetId });
  const exists = (meta.data.sheets || []).some((s) => s.properties?.title === CAT_SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: cfg.spreadsheetId,
      resource: { requests: [{ addSheet: { properties: { title: CAT_SHEET_NAME } } }] },
    });
    await writeCatHeader({ sheets, cfg });
  } else {
    const head = await sheets.spreadsheets.values.get({
      spreadsheetId: cfg.spreadsheetId,
      range: `${CAT_SHEET_NAME}!A1:B1`,
    });
    if (!(head.data.values || []).length) await writeCatHeader({ sheets, cfg });
  }

  // Seed default bila masih kosong
  const body = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range: `${CAT_SHEET_NAME}!A2:B`,
  });
  if (!(body.data.values || []).length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: cfg.spreadsheetId,
      range: `${CAT_SHEET_NAME}!A2`,
      valueInputOption: 'RAW',
      resource: { values: DEFAULT_CATEGORIES },
    });
  }
  catReady = true;
}

// ---------- Mapping baris ----------
function mapRow(values, index) {
  const v = values || [];
  return {
    rowIndex: index + 2, // +2: header di baris 1, index array mulai 0 → baris Sheets
    timestamp: v[0] || '',
    date: v[1] || '',
    userId: String(v[2] || '').trim(),
    username: v[3] || '',
    type: String(v[4] || '').toUpperCase(),
    category: v[5] || '',
    description: v[6] || '',
    amount: Number(String(v[7] ?? '0').replace(/[^0-9.-]/g, '')) || 0,
    currency: v[8] || 'IDR',
    msgId: v[9] || '',
    status: String(v[10] || 'OK').toUpperCase(),
    group: String(v[11] || '').toUpperCase(), // kosong utk data lama → derive saat agregasi
  };
}

// ---------- Operasi transaksi ----------
async function appendTransaction({ user, txn, msgId }) {
  await ensureSheet();
  const { sheets, cfg } = await getClient();
  const type = txn.transaction_type === 'INCOME' ? 'INCOME' : 'EXPENSE';
  const group = GROUP_KEYS.includes(String(txn.group || '').toUpperCase())
    ? String(txn.group).toUpperCase()
    : (type === 'INCOME' ? 'INCOME' : 'EXPENSE');
  const now = new Date();
  const values = [[
    localTimestamp(now),
    localDateStr(now),
    String(user.id),
    user.username || user.globalName || 'user',
    type,
    txn.category || 'Lainnya',
    String(txn.description || 'Transaksi').slice(0, 60),
    Math.round(Number(txn.amount) || 0),
    'IDR',
    msgId || '',
    'OK',
    group,
  ]];

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: cfg.spreadsheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: { values },
  });

  // Ambil nomor baris sebagai ID transaksi (mis. "Transactions!A42:L42" → 42)
  const updatedRange = res.data.updates?.updatedRange || '';
  const m = updatedRange.match(/(\d+)$/);
  return { rowIndex: m ? Number(m[1]) : null };
}

// Semua transaksi aktif (bukan DELETED) milik satu user — basis rekap & Q&A.
async function getAllForUser(userId) {
  await ensureSheet();
  const { sheets, cfg } = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range: `${SHEET_NAME}!A2:L`,
  });
  return (res.data.values || [])
    .map(mapRow)
    .filter((r) => r.userId === String(userId) && r.status !== 'DELETED');
}

// Tandai baris sebagai DELETED (soft delete, tetap ada jejak audit).
async function deleteTransaction(userId, rowId) {
  await ensureSheet();
  const { sheets, cfg } = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range: `${SHEET_NAME}!A${rowId}:L${rowId}`,
  });
  const rows = res.data.values || [];
  if (!rows.length) return { ok: false, reason: 'not_found' };

  const row = mapRow(rows[0], rowId - 2);
  if (row.userId !== String(userId)) return { ok: false, reason: 'forbidden' };
  if (row.status === 'DELETED') return { ok: false, reason: 'deleted' };

  await sheets.spreadsheets.values.update({
    spreadsheetId: cfg.spreadsheetId,
    range: `${SHEET_NAME}!K${rowId}`,
    valueInputOption: 'RAW',
    resource: { values: [['DELETED']] },
  });
  return { ok: true, row };
}

// ---------- Kategori dinamis ----------
let catCache = null;

function invalidateCats() {
  catCache = null;
}

// Daftar kategori terkini dari tab Categories (cache 60 detik)
async function getCategories() {
  await ensureCatSheet();
  if (catCache && Date.now() - catCache.t < 60000) return catCache.list;
  const { sheets, cfg } = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range: `${CAT_SHEET_NAME}!A2:B`,
  });
  catCache = {
    t: Date.now(),
    list: (res.data.values || [])
      .map((v) => ({ name: String(v[0] || '').trim(), group: parseGroup(v[1]) || 'EXPENSE' }))
      .filter((c) => c.name),
  };
  return catCache.list;
}

async function addCategory(name, groupRaw) {
  const group = parseGroup(groupRaw);
  if (!group) throw new Error('Grup tidak dikenal. Pakai: pendapatan | pengeluaran | tabungan.');
  const clean = String(name || '').trim().slice(0, 40);
  if (!clean) throw new Error('Nama kategori tidak boleh kosong.');
  await ensureCatSheet();
  const { sheets, cfg } = await getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: cfg.spreadsheetId,
    range: `${CAT_SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: [[clean, group]] },
  });
  invalidateCats();
  return { name: clean, group };
}

async function removeCategory(name) {
  await ensureCatSheet();
  const { sheets, cfg } = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range: `${CAT_SHEET_NAME}!A2:B`,
  });
  const rows = (res.data.values || []).map((v) => ({ name: String(v[0] || '').trim(), group: String(v[1] || '') }));
  const idx = rows.findIndex((r) => r.name.toLowerCase() === String(name || '').trim().toLowerCase());
  if (idx < 0) return null;

  const keep = rows.filter((_, i) => i !== idx).map((r) => [r.name, r.group]);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: cfg.spreadsheetId,
    range: `${CAT_SHEET_NAME}!A2:B`,
  });
  if (keep.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: cfg.spreadsheetId,
      range: `${CAT_SHEET_NAME}!A2`,
      valueInputOption: 'RAW',
      resource: { values: keep },
    });
  }
  invalidateCats();
  return { name: rows[idx].name, group: parseGroup(rows[idx].group) };
}

async function moveCategory(name, groupRaw) {
  const group = parseGroup(groupRaw);
  if (!group) throw new Error('Grup tidak dikenal. Pakai: pendapatan | pengeluaran | tabungan.');
  await ensureCatSheet();
  const { sheets, cfg } = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range: `${CAT_SHEET_NAME}!A2:B`,
  });
  const rows = (res.data.values || []);
  const idx = rows.findIndex((v) => String(v[0] || '').trim().toLowerCase() === String(name || '').trim().toLowerCase());
  if (idx < 0) return null;
  await sheets.spreadsheets.values.update({
    spreadsheetId: cfg.spreadsheetId,
    range: `${CAT_SHEET_NAME}!B${idx + 2}`,
    valueInputOption: 'RAW',
    resource: { values: [[group]] },
  });
  invalidateCats();
  return { name: String(rows[idx][0] || '').trim(), group };
}

async function resetCategories() {
  await ensureCatSheet();
  const { sheets, cfg } = await getClient();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: cfg.spreadsheetId,
    range: `${CAT_SHEET_NAME}!A2:B`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: cfg.spreadsheetId,
    range: `${CAT_SHEET_NAME}!A2`,
    valueInputOption: 'RAW',
    resource: { values: DEFAULT_CATEGORIES },
  });
  invalidateCats();
}

// ---------- Saldo awal (baseline per-user, tab "Balances") ----------
const BAL_SHEET_NAME = 'Balances';
const BAL_HEADER = ['user_id', 'username', 'cash', 'savings', 'updated_at'];

let balReady = false;

async function ensureBalSheet() {
  if (balReady) return;
  const { sheets, cfg } = await getClient();

  const meta = await sheets.spreadsheets.get({ spreadsheetId: cfg.spreadsheetId });
  const exists = (meta.data.sheets || []).some((s) => s.properties?.title === BAL_SHEET_NAME);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: cfg.spreadsheetId,
      resource: { requests: [{ addSheet: { properties: { title: BAL_SHEET_NAME } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId: cfg.spreadsheetId,
      range: `${BAL_SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      resource: { values: [BAL_HEADER] },
    });
  } else {
    const head = await sheets.spreadsheets.values.get({
      spreadsheetId: cfg.spreadsheetId,
      range: `${BAL_SHEET_NAME}!A1:E1`,
    });
    if (!(head.data.values || []).length) {
      await sheets.spreadsheets.values.update({
        spreadsheetId: cfg.spreadsheetId,
        range: `${BAL_SHEET_NAME}!A1`,
        valueInputOption: 'RAW',
        resource: { values: [BAL_HEADER] },
      });
    }
  }
  balReady = true;
}

async function readBalanceRows() {
  await ensureBalSheet();
  const { sheets, cfg } = await getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: cfg.spreadsheetId,
    range: `${BAL_SHEET_NAME}!A2:E`,
  });
  return (res.data.values || []).map((v) => ({
    userId: String(v[0] || '').trim(),
    username: String(v[1] || ''),
    cash: Number(String(v[2] ?? '0').replace(/[^0-9.\-]/g, '')) || 0,
    savings: Number(String(v[3] ?? '0').replace(/[^0-9.\-]/g, '')) || 0,
    updatedAt: String(v[4] || ''),
  }));
}

// Baseline user ini (null bila belum pernah diisi).
async function getBalance(userId) {
  const rows = await readBalanceRows();
  return rows.find((x) => x.userId === String(userId)) || null;
}

/** Upsert saldo awal. cash/savings null berarti "biarkan nilai lama". */
async function setBalance(user, { cash, savings }) {
  await ensureBalSheet();
  const { sheets, cfg } = await getClient();
  const rows = await readBalanceRows();
  const idx = rows.findIndex((x) => x.userId === String(user.id));
  const merged = {
    cash: cash != null ? Math.round(cash) : (idx >= 0 ? rows[idx].cash : 0),
    savings: savings != null ? Math.round(savings) : (idx >= 0 ? rows[idx].savings : 0),
  };
  const values = [[
    String(user.id),
    user.username || user.globalName || 'user',
    merged.cash,
    merged.savings,
    localTimestamp(),
  ]];
  if (idx >= 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: cfg.spreadsheetId,
      range: `${BAL_SHEET_NAME}!A${idx + 2}`,
      valueInputOption: 'RAW',
      resource: { values },
    });
  } else {
    await sheets.spreadsheets.values.append({
      spreadsheetId: cfg.spreadsheetId,
      range: `${BAL_SHEET_NAME}!A1`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values },
    });
  }
  return merged;
}

/** Hapus baseline user (kembali ke mode tanpa saldo awal). */
async function resetBalance(userId) {
  await ensureBalSheet();
  const { sheets, cfg } = await getClient();
  const rows = await readBalanceRows();
  const idx = rows.findIndex((x) => x.userId === String(userId));
  if (idx < 0) return false;
  const keep = rows.filter((_, i) => i !== idx).map((r) => [r.userId, r.username, r.cash, r.savings, r.updatedAt]);
  await sheets.spreadsheets.values.clear({
    spreadsheetId: cfg.spreadsheetId,
    range: `${BAL_SHEET_NAME}!A2:E`,
  });
  if (keep.length) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: cfg.spreadsheetId,
      range: `${BAL_SHEET_NAME}!A2`,
      valueInputOption: 'RAW',
      resource: { values: keep },
    });
  }
  return true;
}

/**
 * Posisi terkini = baseline + seluruh pergerakan user (semua transaksi OK,
 * bukan hanya bulan berjalan). s.net sudah = pendapatan − pengeluaran − setor bersih.
 */
function applyBaseline(s, base) {
  return {
    cash: (base ? base.cash : 0) + s.net,
    savings: (base ? base.savings : 0) + s.savingsNet,
    hasBaseline: Boolean(base),
  };
}

// ---------- Agregasi (dihitung di kode, bukan AI — angka selalu akurat) ----------
// type = arus kas (INCOME masuk / EXPENSE keluar), group = kelompok kategori.
// Tabungan: uang dipindah ke / ditarik dari tabungan — dihitung bersih (setor − tarik),
// TIDAK masuk pengeluaran → margin tetap = pendapatan − pengeluaran.
function summarize(rows) {
  let income = 0;
  let expense = 0;
  let savingsIn = 0;
  let savingsOut = 0;
  const byCat = { income: {}, expense: {}, savings: {} };

  for (const r of rows) {
    const cat = r.category || 'Lainnya';
    const isSavings = GROUP_KEYS.includes(String(r.group || '').toUpperCase())
      ? String(r.group).toUpperCase() === 'SAVINGS'
      : false; // data lama tanpa group: masuk pendapatan/pengeluaran saja
    if (r.type === 'INCOME') {
      if (isSavings) {
        savingsIn += r.amount;
        byCat.savings[cat] = (byCat.savings[cat] || 0) - r.amount;
      } else {
        income += r.amount;
        byCat.income[cat] = (byCat.income[cat] || 0) + r.amount;
      }
    } else if (r.type === 'EXPENSE') {
      if (isSavings) {
        savingsOut += r.amount;
        byCat.savings[cat] = (byCat.savings[cat] || 0) + r.amount;
      } else {
        expense += r.amount;
        byCat.expense[cat] = (byCat.expense[cat] || 0) + r.amount;
      }
    }
  }

  return {
    count: rows.length,
    income,
    expense,
    savingsNet: savingsOut - savingsIn,
    // margin = kas tersisa: pendapatan − pengeluaran (konsumsi) − setor tabungan bersih
    net: income - expense - (savingsOut - savingsIn),
    byCat,
  };
}

module.exports = {
  isConfigured,
  appendTransaction,
  getAllForUser,
  deleteTransaction,
  summarize,
  localDateStr,
  monthPrefix,
  // kategori
  getCategories,
  addCategory,
  removeCategory,
  moveCategory,
  resetCategories,
  // saldo awal
  getBalance,
  setBalance,
  resetBalance,
  applyBaseline,
  DEFAULT_CATEGORIES,
  GROUP_KEYS,
  GROUP_LABEL,
  parseGroup,
};
