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
  console.error(`❌ Bot error for ${ctx.updateType}:`, err.message);
});

// Health check HTTP server
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
    server.listen(PORT, () => {
      console.log(`🌐 Health check server on port ${PORT}`);
    });

    startScheduler(bot, CHAT_ID);

    // Bersihkan webhook/session lama
    await bot.telegram.deleteWebhook({ drop_pending_updates: false });
    await new Promise(r => setTimeout(r, 3000));

    // Start polling — HARUS di-await
    await bot.launch();
    console.log('🤖 FPL Differential Bot is running! (v6)');
    console.log(`📋 Admin CHAT_ID: ${CHAT_ID || '(not set)'}`);

    // Kirim notifikasi ke admin
    if (CHAT_ID) {
      try {
        await bot.telegram.sendMessage(CHAT_ID,
          '✅ <b>Bot sudah online!</b>\n\n' +
          `⏱ ${new Date().toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })}\n\n` +
          'Ketik /start untuk lihat daftar perintah.',
          { parse_mode: 'HTML' }
        );
      } catch (e) {
        console.error('❌ Notification error:', e.message);
      }
    }
  } catch (err) {
    console.error('❌ Failed to start:', err.message);
    // Retry setelah 5 detik (untuk handle 409 Conflict)
    console.log('🔁 Retrying in 5 seconds...');
    await new Promise(r => setTimeout(r, 5000));
    try {
      await bot.launch();
      console.log('🤖 Bot started on retry! (v6)');
      if (CHAT_ID) {
        await bot.telegram.sendMessage(CHAT_ID,
          '✅ <b>Bot sudah online!</b> (retry)\n\nKetik /start untuk lihat daftar perintah.',
          { parse_mode: 'HTML' }
        ).catch(() => {});
      }
    } catch (retryErr) {
      console.error('❌ Retry failed:', retryErr.message);
      process.exit(1);
    }
  }
}

main();

process.once('SIGINT', () => { bot.stop('SIGINT'); server.close(); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); server.close(); });
