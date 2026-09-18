require('dotenv').config();

const { Telegraf } = require('telegraf');
const crypto = require('crypto');
const http = require('http');
const { registerCommands } = require('./commands');
const { registerAdminCommands } = require('./admin');
const { startScheduler } = require('./scheduler');
const { restoreSessions } = require('./fpl-api');
const { getAllFplTokens } = require('./database');

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const PORT = process.env.PORT || 3000;
const WEBHOOK_DOMAIN = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RENDER_EXTERNAL_HOSTNAME || process.env.WEBHOOK_DOMAIN;

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
    ctx.reply('❓ Perintah tidak dikenal. Ketik /help untuk panduan.');
  }
});

// Error handling
const { trackError, getMetrics } = require('./monitor');
bot.catch((err, ctx) => {
  console.error(`❌ Bot error for ${ctx.updateType}:`, err.message);
  trackError(`bot:${ctx.updateType}`, err);
});

// Start
async function main() {
  try {
    if (WEBHOOK_DOMAIN) {
      // === WEBHOOK MODE (Railway/Render/Production) ===
      const webhookSecret = crypto.randomBytes(32).toString('hex');
      const webhookPath = `/webhook/${BOT_TOKEN.split(':')[0]}`;
      const webhookUrl = `https://${WEBHOOK_DOMAIN}${webhookPath}`;

      // HTTP server dengan webhook handler
      const server = http.createServer((req, res) => {
        if (req.url === '/health' || req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          const m = getMetrics();
          res.end(JSON.stringify({ status: 'ok', uptime: m.uptime, memory_mb: m.memoryMB, commands: m.commands.total }));
        } else if (req.url === webhookPath && req.method === 'POST') {
          // Verify webhook secret token from Telegram
          const token = req.headers['x-telegram-bot-api-secret-token'];
          if (token !== webhookSecret) {
            res.writeHead(403);
            res.end();
            return;
          }

          const MAX_BODY = 1024 * 1024; // 1MB limit
          let body = '';
          let exceeded = false;
          req.on('data', chunk => {
            body += chunk;
            if (body.length > MAX_BODY) {
              exceeded = true;
              req.destroy();
            }
          });
          req.on('end', () => {
            if (exceeded) {
              res.writeHead(413);
              res.end();
              return;
            }
            try {
              bot.handleUpdate(JSON.parse(body), res);
            } catch (e) {
              console.error('Webhook error:', e.message);
              res.writeHead(400);
              res.end();
            }
          });
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      server.listen(PORT, () => {
        console.log(`🌐 Server on port ${PORT}`);
      });

      await bot.telegram.setWebhook(webhookUrl, { secret_token: webhookSecret });
      console.log(`🔗 Webhook mode: ${webhookUrl}`);

    } else {
      // === POLLING MODE (Lokal/Development) ===
      const server = http.createServer((req, res) => {
        if (req.url === '/health' || req.url === '/') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          const m = getMetrics();
          res.end(JSON.stringify({ status: 'ok', uptime: m.uptime, memory_mb: m.memoryMB, commands: m.commands.total }));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      server.listen(PORT, () => {
        console.log(`🌐 Health check server on port ${PORT}`);
      });

      await bot.telegram.deleteWebhook({ drop_pending_updates: false });
      await bot.launch();
      console.log('🔗 Polling mode');
    }

    // Restore FPL sessions from DB
    try {
      const tokens = getAllFplTokens();
      if (tokens.length > 0) restoreSessions(tokens);
    } catch (err) {
      console.error('FPL session restore warning:', err.message);
    }

    startScheduler(bot, CHAT_ID);
    console.log('🤖 FPL Differential Bot is running! (v7)');
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
    process.exit(1);
  }
}

main();

process.once('SIGINT', () => { bot.stop('SIGINT'); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); });
