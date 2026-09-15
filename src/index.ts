import { Bot } from "grammy";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db, sql } from "./db/client.js";
import { ovhService } from "./services/ovh-service.js";
import { registerBotHandlers } from "./bot/handlers.js";
import {
  startBackgroundPoller,
  stopBackgroundPoller,
} from "./poller/background-poller.js";

const token = process.env.TELEGRAM_BOT_TOKEN;
const subsidiary = process.env.OVH_SUBSIDIARY || "DE";

async function main() {
  console.log(
    "══════════════════════════════════════════════════════════════════",
  );
  console.log("  🚀 OVH / Kimsufi / SoYouStart Telegram Availability Notifier");
  console.log("  Powered by Bun + grammY + Drizzle ORM + PostgreSQL");
  console.log(
    "══════════════════════════════════════════════════════════════════\n",
  );

  // 1. Run database migrations automatically on startup
  try {
    console.log(
      "[Database] Checking and running pending migrations from ./drizzle...",
    );
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("[Database] Migrations applied successfully!\n");
  } catch (dbError: any) {
    console.error("[Database] ⚠️ Failed to run migrations:", dbError.message);
    console.error(
      "[Database] 💡 Make sure PostgreSQL is running: `docker compose up -d`\n",
    );
  }

  // 2. Pre-fetch and cache OVH catalogs and datacenters dynamically
  try {
    console.log(
      `[OVH] Initializing catalog and country cache (subsidiary=${subsidiary})...`,
    );
    await ovhService.refreshCache(subsidiary, true);
    console.log("[OVH] Cache ready!\n");

    // Periodic 30-minute refresh
    setInterval(
      () => {
        ovhService.refreshCache(subsidiary).catch((err) => {
          console.error("[OVH] Periodic cache refresh failed:", err);
        });
      },
      30 * 60 * 1000,
    );
  } catch (cacheError) {
    console.error("[OVH] Warning: Initial cache refresh failed:", cacheError);
  }

  // 3. Initialize Telegram bot
  if (!token) {
    console.error(
      "❌ TELEGRAM_BOT_TOKEN is not defined in environment variables or .env file!",
    );
    console.error(
      "👉 Please set TELEGRAM_BOT_TOKEN in your .env file and restart the bot.",
    );
    console.log(
      "\n💡 Background poller and bot startup paused until token is configured.",
    );
    return;
  }

  const bot = new Bot(token);

  // Global error handler for grammY
  bot.catch((err) => {
    console.error("[Bot Error]", err);
  });

  // Authorization middleware: restrict access if ALLOWED_CHAT_IDS is configured
  const allowedChatIdsRaw = process.env.ALLOWED_CHAT_IDS;
  if (allowedChatIdsRaw) {
    const allowedChatIds = new Set(
      allowedChatIdsRaw
        .split(",")
        .map((id) => parseInt(id.trim(), 10))
        .filter((id) => !isNaN(id)),
    );

    console.log(
      `[Security] Private bot mode active. Allowed chat IDs: [${Array.from(allowedChatIds).join(", ")}]\n`,
    );

    bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id;
      if (!chatId || !allowedChatIds.has(chatId)) {
        console.warn(
          `[Security] Unauthorized access attempt from chat ID: ${chatId}`,
        );
        if (ctx.callbackQuery) {
          await ctx.answerCallbackQuery({
            text: "⛔ Zugriff verweigert. Dieser Bot ist privat.",
            show_alert: true,
          });
        } else if (ctx.message) {
          await ctx.reply(
            "⛔ <b>Zugriff verweigert.</b>\nDieser Bot ist privat und nur für autorisierte Nutzer freigeschaltet.",
            { parse_mode: "HTML" },
          );
        }
        return;
      }
      await next();
    });
  }

  // Register all bot handlers and conversation states
  registerBotHandlers(bot);

  // 4. Start the 10-second background poller
  startBackgroundPoller(bot, 10_000);

  // 5. Start Telegram bot long-polling
  console.log("[Bot] Starting Telegram bot listener...");
  bot.start({
    onStart: (botInfo) => {
      console.log(`\n🎉 Bot is ONLINE and listening as @${botInfo.username}!`);
      console.log("Press Ctrl+C to stop.\n");
    },
  });

  // Graceful shutdown handling
  const shutdown = async () => {
    console.log("\n[Shutdown] Stopping bot and services...");
    stopBackgroundPoller();
    bot.stop();
    await sql.end({ timeout: 5 });
    console.log("[Shutdown] Done. Exiting.");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error during startup:", err);
  process.exit(1);
});
