'use strict';
// Wrapper sederhana Gemini API lewat REST (tanpa SDK tambahan).

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

// Proteksi supaya bot tidak diam selamanya bila API/network menggantung
const REQUEST_TIMEOUT_MS = 30000;

// gemini-2.5-* sudah tidak tersedia untuk akun baru (Okt 2026);
// default memakai 3.5-flash-lite karena cepat & ringan untuk parsing chat kecil.
const DEFAULT_MODEL = 'gemini-3.5-flash-lite';

function model() {
  return (process.env.GEMINI_MODEL || '').trim() || DEFAULT_MODEL;
}

function isConfigured() {
  return Boolean((process.env.GEMINI_API_KEY || '').trim());
}

function cleanJSON(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/, '')
    .trim();
}

async function callGeminiOnce(body) {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('GEMINI_API_KEY belum diisi di .env');

  const res = await fetch(`${BASE_URL}/${model()}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: body.prompt }] }], generationConfig: body.generationConfig }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Gemini HTTP ${res.status}: ${detail.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const text = (candidate?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) {
    const reason = candidate?.finishReason || data?.promptFeedback?.blockReason || 'tidak diketahui';
    throw new Error(`Gemini tidak mengembalikan teks (finishReason: ${reason})`);
  }
  return text;
}

async function callGemini(prompt, { asJSON = false } = {}) {
  const generationConfig = {
    temperature: asJSON ? 0 : 0.4,
    maxOutputTokens: asJSON ? 1024 : 2048,
  };
  if (asJSON) generationConfig.responseMimeType = 'application/json';

  // 2 percobaan: hang/timeout sesekali terjadi, 1 ulang biasanya langsung sukses
  let lastErr;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await callGeminiOnce({ prompt, generationConfig });
    } catch (err) {
      lastErr = err;
      // Error permanen (key salah / model hilang) tidak perlu diulang
      if (err.status && err.status !== 429 && err.status < 500) throw err;
      if (attempt === 1) {
        console.error('[ai] percobaan 1 gagal, ulangi:', err.message.slice(0, 120));
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  }
  throw lastErr;
}

/** Panggil Gemini dan hasilnya harus JSON valid. */
async function generateJSON(prompt) {
  return JSON.parse(cleanJSON(await callGemini(prompt, { asJSON: true })));
}

/** Panggil Gemini menghasilkan teks bebas (untuk jawaban Q&A). */
async function generateText(prompt) {
  return (await callGemini(prompt)).trim();
}

module.exports = { isConfigured, generateJSON, generateText };
