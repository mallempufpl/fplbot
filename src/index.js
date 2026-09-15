require('dotenv').config();

const { Telegraf } = require('telegraf');
const http = require('http');
const { registerCommands } = require('./commands');
const { registerAdminCommands } = require('./admin');
const { startScheduler } = require('./scheduler');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN environment variable is required.');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// Register all commands
registerCommands(bot);
registerAdminCommands(bot);

// Handle unknown commands
bot.on('text', ctx => {
  if (ctx.message.text.startsWith('/')) {
    ctx.reply('❓ Perintah tidak dikenal. Ketik /start untuk melihat daftar perintah.');
  }
});

// Error handling
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err.message);
});

// Health check HTTP server (keeps Render/Railway alive)
const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Start
async function main() {
  try {
    // Start health check server
    server.listen(PORT, () => {
      console.log(`🌐 Health check server on port ${PORT}`);
    });

    // Start scheduled jobs
    startScheduler(bot, CHAT_ID);

    // Tunggu sebentar agar polling session lama expired (hindari 409 Conflict)
    console.log('⏳ Waiting 3s for old session to expire...');
    await new Promise(r => setTimeout(r, 3000));

    // Start bot (polling mode — works behind firewalls, no domain needed)
    await bot.launch({ dropPendingUpdates: true });
    console.log('🤖 FPL Differential Bot is running! (v3)');
    console.log(`📋 Admin CHAT_ID: ${CHAT_ID || '(not set)'}`);

    // Kirim notifikasi restart ke admin
    if (CHAT_ID) {
      console.log('📨 Sending startup notification to CHAT_ID:', CHAT_ID);
      try {
        await bot.telegram.sendMessage(CHAT_ID,
          '✅ <b>Bot sudah online!</b>\n\n' +
          `⏱ ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n\n` +
          'Ketik /start untuk lihat daftar perintah.',
          { parse_mode: 'HTML' }
        );
        console.log('✅ Startup notification sent');
      } catch (e) {
        console.error('❌ Failed to send startup notification:', e.message);
      }
    } else {
      console.log('⚠️ CHAT_ID not set, skipping startup notification');
    }
  } catch (err) {
    console.error('❌ Failed to start:', err.message);
    process.exit(1);
  }
}

main();

// Graceful shutdown
process.once('SIGINT', () => { bot.stop('SIGINT'); server.close(); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); server.close(); });
