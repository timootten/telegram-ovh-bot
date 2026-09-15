import { eq } from "drizzle-orm";
import { InlineKeyboard, type Bot } from "grammy";
import { isStatusAvailable } from "../datacenters.js";
import { db } from "../db/client.js";
import { subscriptions, telegramUser } from "../db/schema.js";
import { ovhService } from "../services/ovh-service.js";
import type { RawOvhDatacenterAvailabilityItem } from "../types.js";

const NOTIFICATION_COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes cooldown between alerts
let pollerInterval: ReturnType<typeof setInterval> | null = null;
let isPollInProgress = false;

/**
 * Execute a single availability check cycle
 */
export async function runPollingCycle(bot: Bot): Promise<void> {
  if (isPollInProgress) return;
  isPollInProgress = true;

  try {
    // 1. Load all active subscriptions joined with users who have notifications enabled
    const activeSubs = await db
      .select({
        id: subscriptions.id,
        telegramUserId: subscriptions.telegramUserId,
        country: subscriptions.country,
        brand: subscriptions.brand,
        planId: subscriptions.planId,
        memory: subscriptions.memory,
        disk: subscriptions.disk,
        price: subscriptions.price,
        lastNotifiedAt: subscriptions.lastNotifiedAt,
        chatId: telegramUser.chatId,
      })
      .from(subscriptions)
      .innerJoin(
        telegramUser,
        eq(subscriptions.telegramUserId, telegramUser.id),
      )
      .where(eq(telegramUser.notificationsEnabled, true));

    if (activeSubs.length === 0) {
      return;
    }

    // 2. Fetch live availabilities using Promise.allSettled
    const results = await Promise.allSettled([
      ovhService.fetchLiveAvailabilities(12000),
    ]);

    const availabilityResult = results[0];
    if (availabilityResult.status === "rejected") {
      console.warn(
        "[BackgroundPoller] Failed to fetch OVH availability:",
        availabilityResult.reason,
      );
      return;
    }

    const rawAvailabilities: RawOvhDatacenterAvailabilityItem[] =
      availabilityResult.value || [];

    // Group availability items by planCode and server for fast O(1) matching
    const availabilitiesByCode = new Map<
      string,
      RawOvhDatacenterAvailabilityItem[]
    >();
    for (const item of rawAvailabilities) {
      if (item.planCode) {
        if (!availabilitiesByCode.has(item.planCode)) {
          availabilitiesByCode.set(item.planCode, []);
        }
        availabilitiesByCode.get(item.planCode)!.push(item);
      }
      if (item.server && item.server !== item.planCode) {
        if (!availabilitiesByCode.has(item.server)) {
          availabilitiesByCode.set(item.server, []);
        }
        availabilitiesByCode.get(item.server)!.push(item);
      }
    }

    // 3. Check each active subscription against cached live availability
    for (const sub of activeSubs) {
      // Check 10-minute cooldown so user is not spammed while server stays available
      if (sub.lastNotifiedAt) {
        const elapsed = Date.now() - new Date(sub.lastNotifiedAt).getTime();
        if (elapsed < NOTIFICATION_COOLDOWN_MS) {
          continue; // Still within cooldown period
        }
      }

      const items =
        availabilitiesByCode.get(sub.planId) ||
        availabilitiesByCode.get(sub.planId.split("-")[0] || "");

      if (!items || items.length === 0) continue;

      // Find any datacenter in this subscription's country with stock
      const matchedDatacenters: string[] = [];

      // Extract RAM pattern from sub.memory (e.g. 64GB -> 64g, 32GB -> 32g)
      const mLower = sub.memory.toLowerCase();
      let ramPattern = "";
      if (mLower.includes("64gb") || mLower.includes("64g")) ramPattern = "64g";
      else if (mLower.includes("32gb") || mLower.includes("32g"))
        ramPattern = "32g";
      else if (mLower.includes("16gb") || mLower.includes("16g"))
        ramPattern = "16g";
      else if (mLower.includes("128gb") || mLower.includes("128g"))
        ramPattern = "128g";

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

      for (const item of items) {
        if (ramPattern && !item.memory.toLowerCase().includes(ramPattern)) {
          continue;
        }

        if (
          storagePattern &&
          !item.storage.toLowerCase().includes(storagePattern)
        ) {
          continue;
        }

        for (const dc of item.datacenters) {
          const dcCountry = ovhService.getCountryForDatacenter(dc.datacenter);
          if (dcCountry === sub.country && isStatusAvailable(dc.availability)) {
            matchedDatacenters.push(dc.datacenter);
          }
        }
      }

      if (matchedDatacenters.length > 0) {
        const uniqueDcs = Array.from(new Set(matchedDatacenters));
        const serverMeta = ovhService.getServer(sub.planId);
        const serverName = serverMeta?.name || sub.planId;
        const countryInfo = ovhService.getCountry(sub.country);
        const countryFlag = countryInfo?.flag || "🌍";
        const countryName = countryInfo?.name || sub.country;
        const orderUrl = ovhService.getOrderUrl(sub.planId, sub.country);

        const alertMessage =
          `🚨 <b>SERVER JETZT VERFÜGBAR!</b>\n\n` +
          `<b>Modell:</b> ${serverName} (${sub.brand.toUpperCase()})\n` +
          `<b>Land:</b> ${countryFlag} ${countryName} (${uniqueDcs.map((d) => d.toUpperCase()).join(", ")})\n` +
          `<b>CPU:</b> ${serverMeta?.cpu || "Siehe Angebot"}\n` +
          `<b>RAM:</b> ${sub.memory}\n` +
          `<b>Speicher:</b> ${sub.disk}\n` +
          `<b>Preis:</b> ${sub.price}/ Monat\n\n` +
          `🔗 <a href="${orderUrl}"><b>Hier direkt bei OVH mieten / bestellen</b></a>\n\n` +
          `<i>💡 Dein Alarm bleibt aktiv (10 Min. Cooldown). Du kannst ihn unten jederzeit beenden.</i>`;

        const alertKeyboard = new InlineKeyboard()
          .url("🛒 Jetzt bei OVH mieten", orderUrl)
          .row()
          .text("🗑️ Nachricht schließen", "dismiss_msg")
          .row()
          .text("🚫 Alarm beenden (Subscription löschen)", `unsub:${sub.id}`);

        try {
          await bot.api.sendMessage(sub.chatId, alertMessage, {
            parse_mode: "HTML",
            reply_markup: alertKeyboard,
            link_preview_options: { is_disabled: false },
          });
          console.log(
            `[BackgroundPoller] Sent hit notification for ${sub.planId} in ${sub.country} to chat ${sub.chatId}`,
          );

          // 4. Update lastNotifiedAt to start the 10-minute cooldown (do NOT delete subscription!)
          await db
            .update(subscriptions)
            .set({ lastNotifiedAt: new Date() })
            .where(eq(subscriptions.id, sub.id));
        } catch (sendError) {
          console.error(
            `[BackgroundPoller] Failed to send message to chat ${sub.chatId}:`,
            sendError,
          );
        }
      }
    }
  } catch (error) {
    console.error("[BackgroundPoller] Error during polling cycle:", error);
  } finally {
    isPollInProgress = false;
  }
}

/**
 * Start the background polling loop (every 10 seconds)
 */
export function startBackgroundPoller(bot: Bot, intervalMs = 10000): void {
  if (pollerInterval) return;

  console.log(
    `[BackgroundPoller] Started background polling loop (interval: ${intervalMs}ms)...`,
  );

  // Initial immediate run
  setTimeout(() => {
    runPollingCycle(bot).catch((err) => {
      console.error("[BackgroundPoller] Initial cycle error:", err);
    });
  }, 1000);

  // Regular 10-second interval
  pollerInterval = setInterval(() => {
    runPollingCycle(bot).catch((err) => {
      console.error("[BackgroundPoller] Poller interval error:", err);
    });
  }, intervalMs);
}

/**
 * Stop background poller
 */
export function stopBackgroundPoller(): void {
  if (pollerInterval) {
    clearInterval(pollerInterval);
    pollerInterval = null;
    console.log("[BackgroundPoller] Poller stopped.");
  }
}
