'use strict';
// Semua akses Google Sheets memakai Service Account (gratis).
// Tab yang dipakai: "Transactions" (dibuat otomatis + header bila belum ada).

const fs = require('fs');
const { google } = require('googleapis');

const SHEET_NAME = 'Transactions';
const HEADER = [
  'timestamp', 'date', 'user_id', 'username', 'type', 'category',
  'description', 'amount', 'currency', 'msg_id', 'status',
];

// ---------- Konfigurasi ----------
// Dua mode: (1) file JSON key lokal via SERVICE_ACCOUNT_KEY_FILE (paling aman),
//           (2) isi JSON service account utuh di env SERVICE_ACCOUNT_JSON (untuk deploy Render, file tak ter-commit)
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
    throw new Error('Google Sheets belum dikonfigurasi (SPREADSHEET_ID / GOOGLE_SERVICE_ACCOUNT_EMAIL / SERVICE_ACCOUNT_KEY_FILE).');
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

// ---------- Inisialisasi tab & header ----------
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
      range: `${SHEET_NAME}!A1:K1`,
    });
    if (!(head.data.values || []).length) await writeHeader({ sheets, cfg });
  }
  sheetReady = true;
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
  };
}

// ---------- Operasi data ----------
async function appendTransaction({ user, txn, msgId }) {
  await ensureSheet();
  const { sheets, cfg } = await getClient();
  const type = txn.transaction_type === 'INCOME' ? 'INCOME' : 'EXPENSE';
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
  ]];

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: cfg.spreadsheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: { values },
  });

  // Ambil nomor baris sebagai ID transaksi (mis. "Transactions!A42:K42" → 42)
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
    range: `${SHEET_NAME}!A2:K`,
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
    range: `${SHEET_NAME}!A${rowId}:K${rowId}`,
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

// ---------- Agregasi (dihitung di kode, bukan AI — angka selalu akurat) ----------
function summarize(rows) {
  let income = 0;
  let expense = 0;
  const byCat = { expense: {}, income: {} };
  for (const r of rows) {
    if (r.type === 'INCOME') {
      income += r.amount;
      const c = r.category || 'Gaji';
      byCat.income[c] = (byCat.income[c] || 0) + r.amount;
    } else if (r.type === 'EXPENSE') {
      expense += r.amount;
      const c = r.category || 'Lainnya';
      byCat.expense[c] = (byCat.expense[c] || 0) + r.amount;
    }
  }
  return { count: rows.length, income, expense, net: income - expense, byCat };
}

module.exports = {
  isConfigured,
  appendTransaction,
  getAllForUser,
  deleteTransaction,
  summarize,
  localDateStr,
  monthPrefix,
};
