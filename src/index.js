'use strict';
// Entry point: koneksi ke Discord + routing pesan.
// - Pesan mulai "!"  -> perintah lokal (commands.js), tanpa AI
// - Chat biasa       -> parser AI (parser.js), hanya di channel keuangan / saat di-mention

require('dotenv').config();

const { Client, GatewayIntentBits, Events } = require('discord.js');
const commands = require('./commands');
const parser = require('./parser');

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
});

function isMentionedBot(message) {
  return Boolean(client.user && message.mentions?.has?.(client.user));
}

async function handleMessage(message) {
  if (message.author.bot) return;
  const content = (message.content || '').trim();
  if (!content) return;

  // 1) Perintah dengan prefix "!" selalu diproses (hemat kuota AI)
  if (content.startsWith('!')) {
    await commands.handleCommand(message);
    return;
  }

  // 2) Chat AI: hanya di channel keuangan / saat di-mention / di DM
  const moneyChannel = (process.env.MONEY_CHANNEL_ID || '').trim();
  if (moneyChannel) {
    if (message.channel.id !== moneyChannel && !isMentionedBot(message)) return;
  } else if (message.guild && !isMentionedBot(message)) {
    return;
  }

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
