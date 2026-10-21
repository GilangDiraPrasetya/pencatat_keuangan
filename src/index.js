'use strict';
// Entry point: koneksi ke Discord + routing pesan.
// - Pesan mulai "!"  -> perintah lokal (commands.js), tanpa AI
// - Chat biasa       -> parser AI (parser.js), hanya di channel keuangan / saat di-mention

require('dotenv').config();

const { Client, GatewayIntentBits, Events, Message } = require('discord.js');
const commands = require('./commands');
const parser = require('./parser');

// ---------- Mode privat: balasan bot lewat DM ----------
// Masalah: chat di channel server terbaca semua anggota — isi keuangan jadi terbuka.
// Solusi: PRIVACY_MODE=dm (default) membuat SEMUA balasan bot untuk pesan di
// server dikirim via DM. Penanda: bot merespons dengan reaksi 🔒 di chat user
// ("jawaban ada di DM-mu"). Bila DM user terblokir, bot fallback membalas di
// channel (ketersediaan menang). Set PRIVACY_MODE=open untuk perilaku lama.
// PRIVACY_DELETE=1: chat user di server dihapus bot setelah dibaca (butuh izin
// Manajemen Pesan) — user DM jadi satu-satunya jejak.
const PRIVACY_DM = (process.env.PRIVACY_MODE || 'dm').toLowerCase() === 'dm';
const PRIVACY_DELETE = process.env.PRIVACY_DELETE === '1'; // opsional: hapus chat user di server

const origReply = Message.prototype.reply;
Message.prototype.reply = async function (rawOptions) {
  if (!this.guild || !PRIVACY_DM) return origReply.call(this, rawOptions);
  // Di server: jangan tulis balasan ke channel — kirim DM saja.
  try {
    await this.react('🔒'); // tanda "jawaban ada di DM-mu"  (bila chat dihapus: reaksi gagal, abaikan)
  } catch (_) {}
  try {
    const dm = await this.author.createDM();
    return await dm.send(rawOptions);
  } catch (err) {
    console.error('[index] DM gagal dibuka, fallback balas di channel:', err.message);
    return origReply.call(this, rawOptions);
  }
};

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // perlu "MESSAGE CONTENT INTENT" di Discord Developers
    GatewayIntentBits.DirectMessages,
  ],
});

client.once(Events.ClientReady, (c) => {
  console.log(`✅ Login berhasil sebagai ${c.user.tag}`);
  console.log('🤖 Bot merespons:');
  console.log('   • perintah "!" di semua channel: !help, !rekap, !hapus');
  console.log('   • chat AI hanya di channel MONEY_CHANNEL_ID (jika diisi) atau saat bot di-mention, atau di DM');
  console.log(`   • mode DM-only: ${DM_ONLY ? 'AKTIF — di server hanya arahan DM, layanan penuh di DM' : 'mati'}`);
});

function isMentionedBot(message) {
  return Boolean(client.user && message.mentions?.has?.(client.user));
}

// ---------- Mode DM-only ----------
const DM_ONLY_GUIDE = [
  '🔒 Mode privat: bot ini dipakai lewat **DM** supaya chat keuanganmu tidak terbaca anggota lain.',
  'Buka profil bot di server → **Message** → kirim ke DM, misal:',
  '"bayar parkir 2 ribu" · "gajian 3 juta" · "!saldo" · "!rekap" · "!help"',
  'Datamu tetap milikmu sendiri (per user_id) — tidak ada yang bisa melihat.',
].join('\n');

// DM_ONLY=1 → di server bot hanya menjawab PENGARAHAN singkat (via DM, tersembunyi
// dari channel); seluruh layanan hanya aktif di DM. Chat lain di server didiamkan.
const DM_ONLY = process.env.DM_ONLY === '1';

async function handleMessage(message) {
  if (message.author.bot) return;
  const content = (message.content || '').trim();
  if (!content) return;

  const moneyChannel = (process.env.MONEY_CHANNEL_ID || '').trim();
  const isMoneyChannel = Boolean(moneyChannel) && message.channel.id === moneyChannel;

  if (DM_ONLY && message.guild) {
    // Di guild: cukup beri arahan bila user tampaknya INGIN pakai bot
    // (perintah "!", di channel keuangan, atau mention bot).
    if (content.startsWith('!') || isMentionedBot(message) || isMoneyChannel) {
      return message.reply(DM_ONLY_GUIDE); // dipatch reply → masuk DM (tidak muncul di channel)
    }
    return; // sisanya: chat biasa non-keuangan → diabaikan
  }

  // hapusChatUser: PRIVACY_DELETE=1 → chat user dihapus setelah bot membacanya
  // (bot butuh izin "Manage Messages"; gagal = biarkan, jangan kejar).
  const hapusChatUser = () => {
    if (!PRIVACY_DELETE || !message.guild) return;
    message.delete().catch((err) => console.error('[index] gagal menghapus chat user:', err.message));
  };

  // 1) Perintah dengan prefix "!" selalu diproses (hemat kuota AI)
  if (content.startsWith('!')) {
    hapusChatUser();
    await commands.handleCommand(message);
    return;
  }

  // 2) Chat AI: hanya di channel keuangan / saat di-mention / di DM
  if (moneyChannel) {
    if (message.channel.id !== moneyChannel && !isMentionedBot(message)) return;
  } else if (message.guild && !isMentionedBot(message)) {
    return;
  }

  hapusChatUser();
  await parser.handleChat(message);
}

client.on(Events.MessageCreate, async (message) => {
  try {
    await handleMessage(message);
  } catch (err) {
    console.error('[index] gagal memproses pesan:', err);
  }
});

client.on(Events.Error, (err) => console.error('[discord] koneksi error:', err.message));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));

// ---------- Server HTTP kecil untuk keep-alive & health check (anti-sleep Render) ----------
const http = require('http');

function startKeepAliveServer() {
  const port = Number(process.env.PORT || 3000);
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (url === '/ping' || url === '/') {
      const alive = Boolean(client.user && client.ws && client.ws.status === 0);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, bot: client.user?.tag || null, connected: alive }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false }));
    }
  });
  server.listen(port, () => console.log(`🌐 server keep-alive aktif di port ${port} (GET /ping)`));
}

startKeepAliveServer();

const token = (process.env.DISCORD_TOKEN || '').trim();
if (!token) {
  console.error('❌ DISCORD_TOKEN belum diisi.');
  console.error('   Salin .env.example menjadi .env lalu isi token dari Discord Developers.');
  process.exit(1);
}

client.login(token).catch((err) => {
  console.error('❌ Gagal login:', err.message);
  if (/token/i.test(err.message)) {
    console.error('   → Periksa DISCORD_TOKEN di .env (tombol "Reset Token" di halaman Bot).');
  }
  if (/disallowed intents/i.test(err.message)) {
    console.error('   → Aktifkan "MESSAGE CONTENT INTENT" di Discord Developers > Bot > Privileged Gateway Intents.');
  }
  process.exit(1);
});
