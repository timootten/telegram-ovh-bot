import { InlineKeyboard } from "grammy";
import type { CountryInfo } from "../services/ovh-service.js";
import type { DraftState } from "./state.js";

/**
 * Main menu keyboard on /start
 */
export function buildStartKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ Neue Notification", "nav:new")
    .row()
    .text("📋 Meine Notifications anzeigen", "nav:list");
}

/**
 * Step 1: Countries selection keyboard
 */
export function buildCountriesKeyboard(
  allCountries: CountryInfo[],
  selectedCountries: Set<string>,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  // Lay out countries in 2 columns
  for (let i = 0; i < allCountries.length; i++) {
    const c = allCountries[i]!;
    const isSelected = selectedCountries.has(c.code);
    const label = `${isSelected ? "✅ " : ""}${c.flag} ${c.code} (${c.name})`;
    keyboard.text(label, `country:${c.code}`);

    if (i % 2 === 1) {
      keyboard.row();
    }
  }

  // Navigation row: Cancel on the LEFT, Weiter on the RIGHT
  keyboard.row();
  keyboard.text("❌ Abbrechen", "nav:cancel");
  if (selectedCountries.size > 0) {
    keyboard.text("➡️ Weiter", "nav:step2");
  }

  return keyboard;
}

/**
 * Step 2: Brands selection keyboard
 */
export function buildBrandsKeyboard(
  selectedBrands: Set<string>,
): InlineKeyboard {
  const brands = [
    { id: "kimsufi", name: "Kimsufi" },
    { id: "soyoustart", name: "So You Start" },
    { id: "ovh", name: "OVH" },
  ];

  const keyboard = new InlineKeyboard();

  for (const b of brands) {
    const isSelected = selectedBrands.has(b.id);
    const label = `${isSelected ? "✅ " : ""}${b.name}`;
    keyboard.text(label, `brand:${b.id}`).row();
  }

  // Navigation row: Zurück on the LEFT, Weiter on the RIGHT
  keyboard.row();
  keyboard.text("⬅️ Zurück", "nav:step1");
  if (selectedBrands.size > 0) {
    keyboard.text("➡️ Weiter", "nav:step3");
  }

  return keyboard;
}

/**
 * Step 3: Server selection keyboard
 * Only numbers (5 per row), with checkmarks on selected ones
 */
export function buildServersKeyboard(
  serverIndices: number[],
  selectedIndices: Set<number>,
  page = 0,
  totalPages = 1,
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  // Grid of 5 numbers per row
  for (let i = 0; i < serverIndices.length; i++) {
    const idx = serverIndices[i]!;
    const isSelected = selectedIndices.has(idx);
    const label = isSelected ? `✅ ${idx}` : `${idx}`;
    keyboard.text(label, `server:${idx}`);

    if (i % 5 === 4 && i !== serverIndices.length - 1) {
      keyboard.row();
    }
  }

  keyboard.row();

  // Pagination if more than 1 page
  if (totalPages > 1) {
    if (page > 0) {
      keyboard.text("◀️ Zurück", `page:${page - 1}`);
    }
    keyboard.text(`📄 ${page + 1}/${totalPages}`, "noop");
    if (page < totalPages - 1) {
      keyboard.text("Vor ▶️", `page:${page + 1}`);
    }
    keyboard.row();
  }

  // Navigation row: Zurück on the LEFT, Weiter on the RIGHT
  keyboard.row();
  keyboard.text("⬅️ Zurück", "nav:step2");
  if (selectedIndices.size > 0) {
    keyboard.text("➡️ Weiter", "nav:step4");
  }

  return keyboard;
}

/**
 * Step 4: Summary & Submit keyboard
 */
export function buildSummaryKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("✅ Bestätigen", "submit_notification")
    .row()
    .text("⬅️ Zurück", "nav:step3")
    .text("❌ Abbrechen", "nav:cancel");
}

/**
 * Subscription item delete keyboard
 */
export function buildDeleteSubscriptionKeyboard(
  subscriptionId: number,
): InlineKeyboard {
  return new InlineKeyboard().text("🗑️ Löschen", `delete:${subscriptionId}`);
}

/**
 * Empty list or back to menu keyboard
 */
export function buildBackToMenuKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ Neue Notification", "nav:new")
    .row()
    .text("⬅️ Hauptmenü", "nav:menu");
}
