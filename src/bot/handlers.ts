import { eq } from "drizzle-orm";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import { isStatusAvailable } from "../datacenters.js";
import { db } from "../db/client.js";
import { subscriptions, telegramUser } from "../db/schema.js";
import { ovhService } from "../services/ovh-service.js";
import type { RawOvhDatacenterAvailabilityItem } from "../types.js";
import {
  buildBackToMenuKeyboard,
  buildBrandsKeyboard,
  buildCountriesKeyboard,
  buildDeleteSubscriptionKeyboard,
  buildServersKeyboard,
  buildStartKeyboard,
  buildSummaryKeyboard,
} from "./keyboards.js";
import {
  clearDraft,
  getOrCreateDraft,
  resetDraft,
  type DraftServerMeta,
} from "./state.js";

const PAGE_SIZE = 15;

/**
 * Ensure telegram_user exists in database via upsert
 */
async function ensureTelegramUser(chatId: number) {
  await db
    .insert(telegramUser)
    .values({
      chatId,
      notificationsEnabled: true,
    })
    .onConflictDoNothing({ target: telegramUser.chatId });

  const user = await db.query.telegramUser.findFirst({
    where: eq(telegramUser.chatId, chatId),
  });

  return user;
}

/**
 * Render Step 1: Countries
 */
async function renderStep1(ctx: Context, chatId: number, edit = true) {
  const draft = getOrCreateDraft(chatId);
  draft.step = "countries";

  const allCountries = ovhService.getCountries();
  const selectedText =
    draft.countries.size > 0 ? Array.from(draft.countries).join(", ") : "Keine";

  const text = `Ausgewählte Länder: ${selectedText}\nWähle ein oder mehrere Länder aus:`;
  const keyboard = buildCountriesKeyboard(allCountries, draft.countries);

  try {
    if (edit) {
      await ctx.editMessageText(text, { reply_markup: keyboard });
    } else {
      await ctx.reply(text, { reply_markup: keyboard });
    }
  } catch (err: any) {
    if (!err.message?.includes("message is not modified")) {
      await ctx.reply(text, { reply_markup: keyboard });
    }
  }
}

/**
 * Render Step 2: Brands
 */
async function renderStep2(ctx: Context, chatId: number) {
  const draft = getOrCreateDraft(chatId);
  draft.step = "brands";

  const brandNamesMap: Record<string, string> = {
    kimsufi: "Kimsufi",
    soyoustart: "So You Start",
    ovh: "OVH",
  };

  const selectedText =
    draft.brands.size > 0
      ? Array.from(draft.brands)
          .map((b) => brandNamesMap[b] || b)
          .join(", ")
      : "Keine";

  const text = `Ausgewählte Kategorien: ${selectedText}\nWas möchtest du beobachten?`;
  const keyboard = buildBrandsKeyboard(draft.brands);

  try {
    await ctx.editMessageText(text, { reply_markup: keyboard });
  } catch (err: any) {
    if (!err.message?.includes("message is not modified")) {
      await ctx.reply(text, { reply_markup: keyboard });
    }
  }
}

/**
 * Render Step 3: Server Selection
 */
async function renderStep3(ctx: Context, chatId: number) {
  const draft = getOrCreateDraft(chatId);
  draft.step = "servers";

  // Check if user already has active subscriptions for these servers in chosen countries
  const userWithSubs = await db.query.telegramUser.findFirst({
    where: eq(telegramUser.chatId, chatId),
    with: {
      subscriptions: true,
    },
  });
  const existingSubs = userWithSubs?.subscriptions || [];

  // Get all servers matching chosen brands (both in-stock and out-of-stock)
  const matchingServers = ovhService.getServersFor(draft.brands);

  // Store in draft catalog if not already populated
  if (draft.serverCatalog.size === 0) {
    for (let i = 0; i < matchingServers.length; i++) {
      const s = matchingServers[i]!;
      const idx = i + 1;
      draft.serverCatalog.set(idx, {
        id: s.id,
        planId: s.planId,
        name: s.name,
        cpu: s.cpu,
        brand: s.brand,
        memory: s.memory,
        ramCode: s.ramCode,
        ramPattern: s.ramPattern,
        disk: s.disk,
        storageCode: s.storageCode,
        storagePattern: s.storagePattern,
        price: s.price,
      });

      // Pre-select servers that already have an active subscription for the chosen countries
      const isAlreadySubscribed = existingSubs.some((sub) => {
        if (sub.planId !== s.planId) return false;
        if (!draft.countries.has(sub.country)) return false;
        const subDisk = sub.disk.toLowerCase().replace(/\s+/g, "");
        const serverDisk = s.disk.toLowerCase().replace(/\s+/g, "");
        const diskMatch =
          subDisk.includes(serverDisk) ||
          serverDisk.includes(subDisk) ||
          (s.storagePattern &&
            subDisk.includes(s.storagePattern.toLowerCase()));

        const subMem = sub.memory.toLowerCase();
        const serverMem = s.memory.toLowerCase();
        const memMatch =
          (s.ramPattern && subMem.includes(s.ramPattern)) ||
          subMem.includes(serverMem) ||
          serverMem.includes(subMem);

        return diskMatch && memMatch;
      });

      if (isAlreadySubscribed) {
        draft.serverIndices.add(idx);
      }
    }
  }

  if (draft.serverCatalog.size === 0) {
    const text =
      "⚠️ Keine Server für die ausgewählten Kategorien gefunden.\n\nBitte passe deine Auswahl an.";
    const keyboard = buildBrandsKeyboard(draft.brands);
    await ctx.editMessageText(text, { reply_markup: keyboard });
    return;
  }

  // Fetch or get cached live availabilities for real-time stock badges
  const rawAv = await ovhService.getLiveAvailabilities();
  const avMap = new Map<string, RawOvhDatacenterAvailabilityItem[]>();
  for (const a of rawAv) {
    if (a.planCode) {
      if (!avMap.has(a.planCode)) avMap.set(a.planCode, []);
      avMap.get(a.planCode)!.push(a);
    }
    if (a.server && a.server !== a.planCode) {
      if (!avMap.has(a.server)) avMap.set(a.server, []);
      avMap.get(a.server)!.push(a);
    }
  }

  const allIndices = Array.from(draft.serverCatalog.keys());
  const totalPages = Math.ceil(allIndices.length / PAGE_SIZE);
  const currentPage = Math.min(draft.serverPage || 0, totalPages - 1);
  draft.serverPage = currentPage;

  const pageIndices = allIndices.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );

  const selectedCount = draft.serverIndices.size;
  const selectedTag =
    selectedCount > 0 ? ` — <b>${selectedCount} ausgewählt</b>` : "";

  let text = "";
  if (totalPages > 1) {
    text = `Wähle die gewünschten Server aus (Seite ${currentPage + 1}/${totalPages}, ${allIndices.length} Modelle gesamt${selectedTag}):\n\n`;
  } else {
    text = `Wähle die gewünschten Server aus (${allIndices.length} Modelle gesamt${selectedTag}):\n\n`;
  }

  for (const idx of pageIndices) {
    const server = draft.serverCatalog.get(idx)!;

    // Determine live stock status specifically for this server hardware variant
    const items =
      avMap.get(server.planId) || avMap.get(server.planId.split("-")[0] || "");

    const availableInChosen: string[] = [];
    const availableOther: string[] = [];

    if (items) {
      for (const it of items) {
        // If variant has ramPattern (e.g. ram-64g, ram-32g), match it specifically!
        if (
          server.ramPattern &&
          !it.memory.toLowerCase().includes(server.ramPattern.toLowerCase())
        ) {
          continue;
        }

        // If variant has storagePattern (e.g. softraid-2x450nvme), match it specifically!
        if (
          server.storagePattern &&
          !it.storage
            .toLowerCase()
            .includes(server.storagePattern.toLowerCase())
        ) {
          continue;
        }

        for (const d of it.datacenters) {
          if (isStatusAvailable(d.availability)) {
            const c =
              ovhService.getCountryForDatacenter(d.datacenter) ||
              d.datacenter.toUpperCase();
            if (draft.countries.has(c)) {
              availableInChosen.push(c);
            } else {
              availableOther.push(c);
            }
          }
        }
      }
    }

    const uniqueChosen = Array.from(new Set(availableInChosen));
    const uniqueOther = Array.from(new Set(availableOther));

    let statusBadge = "🔴 Ausverkauft";
    if (uniqueChosen.length > 0) {
      statusBadge = `🟢 Verfügbar (${uniqueChosen.join(", ")})`;
    } else if (uniqueOther.length > 0) {
      statusBadge = `🟡 Nur in ${uniqueOther.join(", ")}`;
    }

    const cleanDisk = server.disk
      .replace(/Enterprise Class|Datacenter Class/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const cleanRam = server.memory
      .replace(/Enterprise Class|Datacenter Class/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    const isSelected = draft.serverIndices.has(idx);

    // Check if this server is already in active subscriptions
    const isAlreadySubscribed = existingSubs.some((sub) => {
      if (sub.planId !== server.planId) return false;
      if (!draft.countries.has(sub.country)) return false;
      const subDisk = sub.disk.toLowerCase().replace(/\s+/g, "");
      const serverDisk = server.disk.toLowerCase().replace(/\s+/g, "");
      const diskMatch =
        subDisk.includes(serverDisk) ||
        serverDisk.includes(subDisk) ||
        (server.storagePattern &&
          subDisk.includes(server.storagePattern.toLowerCase()));

      const subMem = sub.memory.toLowerCase();
      const serverMem = server.memory.toLowerCase();
      const memMatch =
        (server.ramPattern && subMem.includes(server.ramPattern)) ||
        subMem.includes(serverMem) ||
        serverMem.includes(subMem);

      return diskMatch && memMatch;
    });

    const activeAlertTag = isAlreadySubscribed
      ? " 🔔 <i>[Alarm aktiv]</i>"
      : "";

    if (isSelected) {
      text += `✅ <b>[${idx}] ${server.name}</b> — ${statusBadge} <b>(Ausgewählt)</b>${activeAlertTag}\n`;
      text += `    <b>CPU:</b> ${server.cpu}\n`;
      text += `    <b>RAM:</b> ${cleanRam} | <b>Disk:</b> ${cleanDisk} | <b>${server.price}</b>\n\n`;
    } else {
      text += `[${idx}] ${server.name} — ${statusBadge}${activeAlertTag}\n`;
      text += `    CPU: ${server.cpu}\n`;
      text += `    RAM: ${cleanRam} | Disk: ${cleanDisk} | ${server.price}\n\n`;
    }
  }

  const keyboard = buildServersKeyboard(
    pageIndices,
    draft.serverIndices,
    currentPage,
    totalPages,
  );

  try {
    await ctx.editMessageText(text.trimEnd(), {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  } catch (err: any) {
    if (!err.message?.includes("message is not modified")) {
      await ctx.reply(text.trimEnd(), {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    }
  }
}

/**
 * Render Step 4: Summary & Submit
 */
async function renderStep4(ctx: Context, chatId: number) {
  const draft = getOrCreateDraft(chatId);
  draft.step = "summary";

  const brandNamesMap: Record<string, string> = {
    kimsufi: "Kimsufi",
    soyoustart: "So You Start",
    ovh: "OVH",
  };

  const countriesText = Array.from(draft.countries).join(", ");
  const brandsText = Array.from(draft.brands)
    .map((b) => brandNamesMap[b] || b)
    .join(", ");

  const selectedServers = Array.from(draft.serverIndices)
    .map((idx) => draft.serverCatalog.get(idx)?.name)
    .filter(Boolean);

  const serversText = selectedServers.join(", ");

  const text =
    `Zusammenfassung deiner Notification:\n` +
    `Länder: ${countriesText}\n` +
    `Kategorien: ${brandsText}\n` +
    `Server: ${serversText}\n\n` +
    `Du wirst benachrichtigt, sobald einer davon verfügbar ist.`;

  const keyboard = buildSummaryKeyboard();

  try {
    await ctx.editMessageText(text, { reply_markup: keyboard });
  } catch (err: any) {
    if (!err.message?.includes("message is not modified")) {
      await ctx.reply(text, { reply_markup: keyboard });
    }
  }
}

/**
 * Register all bot commands and callback handlers
 */
export function registerBotHandlers(bot: Bot) {
  // Command: /start
  bot.command("start", async (ctx) => {
    const chatId = ctx.chat.id;
    await ensureTelegramUser(chatId);
    clearDraft(chatId);

    const text =
      `👋 <b>Willkommen beim OVH/Kimsufi Verfügbarkeits-Notifier!</b>\n\n` +
      `Ich überwache für dich rund um die Uhr dedizierte Server von <b>Kimsufi</b>, <b>So You Start</b> und <b>OVH</b>.\n` +
      `Sobald dein Wunschserver in deinem gewählten Land verfügbar ist, erhältst du sofort eine Benachrichtigung mit Direktlink zum Shop.\n\n` +
      `Was möchtest du tun?`;

    await ctx.reply(text, {
      parse_mode: "HTML",
      reply_markup: buildStartKeyboard(),
    });
  });

  // Start a new notification flow
  bot.callbackQuery("nav:new", async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    resetDraft(chatId);
    await renderStep1(ctx, chatId, true);
  });

  // Cancel flow
  bot.callbackQuery("nav:cancel", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Abgebrochen" });
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    clearDraft(chatId);
    await ctx.editMessageText("Vorgang abgebrochen. Was möchtest du tun?", {
      reply_markup: buildStartKeyboard(),
    });
  });

  // Back to main menu
  bot.callbackQuery("nav:menu", async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    clearDraft(chatId);
    await ctx.editMessageText("Hauptmenü:\nWas möchtest du tun?", {
      reply_markup: buildStartKeyboard(),
    });
  });

  // Navigation between steps
  bot.callbackQuery("nav:step1", async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    if (chatId) await renderStep1(ctx, chatId);
  });

  bot.callbackQuery("nav:step2", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const draft = getOrCreateDraft(chatId);

    if (draft.countries.size === 0) {
      await ctx.answerCallbackQuery({
        text: "Bitte wähle mindestens ein Land aus!",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();
    await renderStep2(ctx, chatId);
  });

  bot.callbackQuery("nav:step3", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const draft = getOrCreateDraft(chatId);

    if (draft.brands.size === 0) {
      await ctx.answerCallbackQuery({
        text: "Bitte wähle mindestens eine Kategorie aus!",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();
    await renderStep3(ctx, chatId);
  });

  bot.callbackQuery("nav:step4", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    const draft = getOrCreateDraft(chatId);

    if (draft.serverIndices.size === 0) {
      await ctx.answerCallbackQuery({
        text: "Bitte wähle mindestens einen Server aus!",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery();
    await renderStep4(ctx, chatId);
  });

  // Step 1: Country toggle
  bot.callbackQuery(/^country:([A-Za-z0-9]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const countryCode = ctx.match[1]!.toUpperCase();
    const draft = getOrCreateDraft(chatId);

    if (draft.countries.has(countryCode)) {
      draft.countries.delete(countryCode);
    } else {
      draft.countries.add(countryCode);
    }

    await renderStep1(ctx, chatId);
  });

  // Step 2: Brand toggle
  bot.callbackQuery(/^brand:([a-z0-9_-]+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const brand = ctx.match[1]!;
    const draft = getOrCreateDraft(chatId);

    if (draft.brands.has(brand)) {
      draft.brands.delete(brand);
    } else {
      draft.brands.add(brand);
    }

    // Invalidate cached servers so Step 3 reloads with the updated brand selection
    draft.serverCatalog.clear();
    draft.serverIndices.clear();
    draft.serverPage = 0;

    await renderStep2(ctx, chatId);
  });

  // Step 3: Server number toggle
  bot.callbackQuery(/^server:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const serverIndex = parseInt(ctx.match[1]!, 10);
    const draft = getOrCreateDraft(chatId);

    if (draft.serverIndices.has(serverIndex)) {
      draft.serverIndices.delete(serverIndex);
    } else {
      draft.serverIndices.add(serverIndex);
    }

    await renderStep3(ctx, chatId);
  });

  // Step 3: Pagination
  bot.callbackQuery(/^page:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const page = parseInt(ctx.match[1]!, 10);
    const draft = getOrCreateDraft(chatId);
    draft.serverPage = page;

    await renderStep3(ctx, chatId);
  });

  bot.callbackQuery("noop", async (ctx) => {
    await ctx.answerCallbackQuery();
  });

  // Step 4: Submit Notification
  bot.callbackQuery("submit_notification", async (ctx) => {
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const draft = getOrCreateDraft(chatId);
    if (draft.countries.size === 0 || draft.serverIndices.size === 0) {
      await ctx.answerCallbackQuery({
        text: "Ungültige Auswahl. Bitte starte von vorne.",
        show_alert: true,
      });
      return;
    }

    await ctx.answerCallbackQuery({ text: "Wird gespeichert..." });

    try {
      const user = await ensureTelegramUser(chatId);
      if (!user) {
        throw new Error("Could not find or create telegram user in database.");
      }

      // Build subscription rows for each (country × server) combination
      const rowsToInsert: Array<{
        telegramUserId: number;
        country: string;
        brand: string;
        planId: string;
        memory: string;
        disk: string;
        price: string;
      }> = [];

      for (const country of draft.countries) {
        for (const idx of draft.serverIndices) {
          const server = draft.serverCatalog.get(idx);
          if (!server) continue;

          rowsToInsert.push({
            telegramUserId: user.id,
            country: country.toUpperCase(),
            brand: server.brand,
            planId: server.planId,
            memory: server.memory,
            disk: server.disk,
            price: server.price,
          });
        }
      }

      if (rowsToInsert.length > 0) {
        await db
          .insert(subscriptions)
          .values(rowsToInsert)
          .onConflictDoNothing();
      }

      clearDraft(chatId);

      const confirmText =
        `🎉 <b>Benachrichtigung erfolgreich eingerichtet!</b>\n\n` +
        `Es wurden <b>${rowsToInsert.length}</b> Server-Kombinationen hinterlegt.\n` +
        `Sobald ein Server in einem deiner gewählten Länder verfügbar ist, erhältst du umgehend eine Nachricht mit Direktlink.`;

      await ctx.editMessageText(confirmText, {
        parse_mode: "HTML",
        reply_markup: buildBackToMenuKeyboard(),
      });
    } catch (error) {
      console.error("[Bot] Failed to save subscriptions:", error);
      await ctx.reply(
        "❌ Fehler beim Speichern der Benachrichtigung in die Datenbank. Bitte versuche es später erneut.",
      );
    }
  });

  // View my active notifications
  bot.callbackQuery("nav:list", async (ctx) => {
    await ctx.answerCallbackQuery();
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    try {
      const userWithSubs = await db.query.telegramUser.findFirst({
        where: eq(telegramUser.chatId, chatId),
        with: {
          subscriptions: true,
        },
      });

      await renderNotificationsList(ctx, chatId);
    } catch (error) {
      console.error("[Bot] Failed to list subscriptions:", error);
      await ctx.reply("❌ Fehler beim Abrufen der Benachrichtigungen.");
    }
  });

  // Delete a subscription from the list
  bot.callbackQuery(/^delete:(\d+)$/, async (ctx) => {
    const subId = parseInt(ctx.match[1]!, 10);
    const chatId = ctx.chat?.id;
    if (!chatId) return;
    await ctx.answerCallbackQuery({ text: "Wird gelöscht..." });

    try {
      await db.delete(subscriptions).where(eq(subscriptions.id, subId));
      await renderNotificationsList(ctx, chatId);
    } catch (error) {
      console.error("[Bot] Failed to delete subscription:", error);
      await ctx.reply("❌ Fehler beim Löschen der Benachrichtigung.");
    }
  });

  // Dismiss notification alert message (keeps subscription active)
  bot.callbackQuery("dismiss_msg", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Nachricht geschlossen" });
    await ctx.deleteMessage().catch(() => {});
  });

  // Unsubscribe from alert (deletes subscription and deletes the message)
  bot.callbackQuery(/^unsub:(\d+)$/, async (ctx) => {
    const subId = parseInt(ctx.match[1]!, 10);

    try {
      await db.delete(subscriptions).where(eq(subscriptions.id, subId));
      await ctx.answerCallbackQuery({
        text: "🗑️ Alarm beendet & Subscription gelöscht.",
      });
      // The message simply disappears completely
      await ctx.deleteMessage().catch(() => {});
    } catch (err) {
      console.error("[Bot] Failed to unsub from alert:", err);
      await ctx.answerCallbackQuery({
        text: "❌ Fehler beim Beenden des Alarms.",
      });
    }
  });
}

/**
 * Render all active notifications in ONE single message (in-place edit)
 */
async function renderNotificationsList(ctx: Context, chatId: number) {
  const userWithSubs = await db.query.telegramUser.findFirst({
    where: eq(telegramUser.chatId, chatId),
    with: {
      subscriptions: true,
    },
  });

  const userSubs = userWithSubs?.subscriptions || [];

  if (userSubs.length === 0) {
    await ctx.editMessageText(
      "📋 <b>Deine Notifications</b>\n\nDu hast aktuell keine aktiven Benachrichtigungen eingerichtet.",
      {
        parse_mode: "HTML",
        reply_markup: buildBackToMenuKeyboard(),
      },
    );
    return;
  }

  // Fetch live availabilities to show live status and direct order links right in the list!
  const rawAv = await ovhService.getLiveAvailabilities();
  const avMap = new Map<string, RawOvhDatacenterAvailabilityItem[]>();
  for (const a of rawAv) {
    if (a.planCode) {
      if (!avMap.has(a.planCode)) avMap.set(a.planCode, []);
      avMap.get(a.planCode)!.push(a);
    }
    if (a.server && a.server !== a.planCode) {
      if (!avMap.has(a.server)) avMap.set(a.server, []);
      avMap.get(a.server)!.push(a);
    }
  }

  let text = `📋 <b>Deine aktiven Notifications (${userSubs.length}):</b>\n\n`;
  const keyboard = new InlineKeyboard();

  for (let i = 0; i < userSubs.length; i++) {
    const sub = userSubs[i]!;
    const num = i + 1;
    const server = ovhService.getServer(sub.planId);
    const serverName = server?.name || sub.planId;
    const orderUrl = ovhService.getOrderUrl(serverName || sub.planId);

    // Check current live stock status specifically for this server and disk variant
    const items =
      avMap.get(sub.planId) || avMap.get(sub.planId.split("-")[0] || "");
    const inStockInCountry: string[] = [];
    const inStockOther: string[] = [];

    // Extract storage pattern from sub.disk (e.g. 2x 450Gb SSD NVMe -> 2x450nvme)
    const dLower = sub.disk.toLowerCase();
    let storagePattern = "";
    if (dLower.includes("450") && dLower.includes("nvme"))
      storagePattern = "2x450nvme";
    else if (dLower.includes("1.2tb") || dLower.includes("1200"))
      storagePattern = "2x1200nvme";
    else if (dLower.includes("2tb") && !dLower.includes("4tb"))
      storagePattern = "2x2000sa";
    else if (dLower.includes("4tb")) storagePattern = "4000sa";
    else if (dLower.includes("960") && dLower.includes("ssd"))
      storagePattern = "960ssd";
    else if (dLower.includes("960") && dLower.includes("nvme"))
      storagePattern = "960nvme";

    if (items) {
      for (const it of items) {
        if (
          storagePattern &&
          !it.storage.toLowerCase().includes(storagePattern)
        ) {
          continue;
        }

        for (const d of it.datacenters) {
          if (isStatusAvailable(d.availability)) {
            const c = ovhService.getCountryForDatacenter(d.datacenter);
            if (c === sub.country) {
              inStockInCountry.push(d.datacenter.toUpperCase());
            } else {
              inStockOther.push(c);
            }
          }
        }
      }
    }

    let liveStatus = `🔴 In ${sub.country} ausverkauft`;
    if (inStockInCountry.length > 0) {
      liveStatus = `🟢 <b>Jetzt verfügbar in ${sub.country} (${inStockInCountry.join(", ")})!</b>`;
    } else if (inStockOther.length > 0) {
      const otherDcs = Array.from(new Set(inStockOther)).join(", ");
      liveStatus = `🟡 In ${sub.country} ausverkauft (Verfügbar in: ${otherDcs})`;
    }

    const cleanDisk = sub.disk
      .replace(/Enterprise Class|Datacenter Class/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    const cleanRam = sub.memory
      .replace(/Enterprise Class|Datacenter Class/gi, "")
      .replace(/\s+/g, " ")
      .trim();

    text += `[${num}] <b>${serverName}</b> (${sub.brand.toUpperCase()}) — Land: <b>${sub.country}</b>\n`;
    text += `    CPU: ${server?.cpu || "Standard"}\n`;
    text += `    RAM: ${cleanRam} | Disk: ${cleanDisk} | ${sub.price}\n`;
    text += `    Status: ${liveStatus}\n`;
    text += `    🔗 <a href="${orderUrl}">Direkt zum OVH Shop</a>\n\n`;

    // Buttons for each subscription item:
    keyboard
      .text(
        `🗑️ [${num}] ${serverName} (${sub.country}) löschen`,
        `delete:${sub.id}`,
      )
      .row();
    keyboard.url(`🛒 [${num}] ${serverName} bei OVH öffnen`, orderUrl).row();
  }

  keyboard.text("➕ Neue Notification", "nav:new").row();
  keyboard.text("⬅️ Hauptmenü", "nav:menu");

  await ctx.editMessageText(text.trimEnd(), {
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
    reply_markup: keyboard,
  });
}
