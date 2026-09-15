#!/usr/bin/env bun
/**
 * OVH Dedicated Servers Categories & Availability Fetcher
 *
 * Designed for Bun and modern TypeScript.
 * Uses native async fetch to query OVH Public API endpoints.
 */

export * from "./src/types.js";
export * from "./src/datacenters.js";
export * from "./src/ovh-api.js";

import {
  fetchDedicatedServerCategories,
  getAvailableServers,
  getServerCategory,
} from "./src/ovh-api.js";
import { getDatacenterLocation } from "./src/datacenters.js";
import type {
  DedicatedServer,
  DedicatedServerCategory,
  ServerCategoryId,
} from "./src/types.js";

// ANSI color helpers for terminal output
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  bgBlue: "\x1b[44m",
};

function printBanner(): void {
  console.log("");
  console.log(
    `${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`,
  );
  console.log(
    `  ${colors.bold}${colors.white}🚀 OVH DEDICATED SERVERS CATEGORIES & LIVE AVAILABILITY${colors.reset}`,
  );
  console.log(
    `  ${colors.dim}Powered by Bun + Native fetch | Public OVH APIs (No API keys required)${colors.reset}`,
  );
  console.log(
    `${colors.bold}${colors.cyan}════════════════════════════════════════════════════════════════════════════════${colors.reset}`,
  );
  console.log("");
}

function printCategoryCard(cat: DedicatedServerCategory): void {
  const brandBadge =
    cat.brand === "Eco"
      ? `${colors.yellow}[Eco Range]${colors.reset}`
      : `${colors.blue}[Bare Metal]${colors.reset}`;

  const stockBadge =
    cat.availableServersCount > 0
      ? `${colors.green}● ${cat.availableServersCount} in stock${colors.reset}`
      : `${colors.dim}��� 0 in stock${colors.reset}`;

  console.log(
    ` ${colors.bold}${colors.white}${cat.name.padEnd(16)}${colors.reset} ${brandBadge.padEnd(20)} ${stockBadge.padEnd(22)} ${colors.cyan}from ${cat.formattedMinPrice}/mo${colors.reset}`,
  );
  console.log(`   ${colors.dim}${cat.tagline}${colors.reset}`);

  if (cat.inStockDatacenters.length > 0) {
    const dcTags = cat.inStockDatacenters
      .map((dc) => {
        const loc = getDatacenterLocation(dc);
        return `${loc.flag} ${dc.toUpperCase()}`;
      })
      .join("  ");
    console.log(`   ${colors.gray}Datacenters:${colors.reset} ${dcTags}`);
  } else {
    console.log(
      `   ${colors.gray}Datacenters:${colors.reset} ${colors.dim}No stock at the moment${colors.reset}`,
    );
  }
  console.log("");
}

function printServerList(title: string, servers: DedicatedServer[]): void {
  console.log(
    `${colors.bold}${colors.yellow}┌── ${title.toUpperCase()} (${servers.length} models) ──────────────────────────────${colors.reset}`,
  );

  if (servers.length === 0) {
    console.log(
      `│ ${colors.dim}No servers found matching criteria.${colors.reset}`,
    );
    console.log(
      `${colors.yellow}└────────────────────────────────────────────���────────────────────────────────${colors.reset}\n`,
    );
    return;
  }

  for (const server of servers) {
    const statusTag = server.isAvailable
      ? `${colors.green}${colors.bold}✔ IN STOCK${colors.reset}`
      : `${colors.gray}✖ OUT OF STOCK${colors.reset}`;

    console.log(
      `│ ${colors.bold}${colors.white}${server.commercialName.padEnd(12)}${colors.reset} ${colors.dim}(${server.planCode})${colors.reset} ${statusTag.padStart(25)} ${colors.cyan}${colors.bold}${server.pricing.formattedMonthly}/mo${colors.reset}`,
    );
    console.log(
      `│   ${colors.gray}CPU:${colors.reset}     ${server.specs.cpu}`,
    );
    console.log(
      `│   ${colors.gray}Specs:${colors.reset}   RAM: ${colors.white}${server.specs.memory}${colors.reset} | Storage: ${colors.white}${server.specs.storage}${colors.reset}`,
    );
    if (server.region) {
      console.log(`│   ${colors.gray}Region:${colors.reset}  ${server.region}`);
    }

    if (server.isAvailable) {
      const activeDcs = server.datacenterAvailabilities
        .filter((dc) => dc.isAvailable)
        .map((dc) => {
          const loc = dc.location || getDatacenterLocation(dc.datacenter);
          return `${loc.flag} ${loc.city || loc.name} (${dc.availabilityLabel})`;
        })
        .join(", ");

      console.log(
        `│   ${colors.gray}Stock in:${colors.reset} ${colors.green}${activeDcs}${colors.reset}`,
      );
    }

    console.log(`│   ${colors.dim}${"─".repeat(70)}${colors.reset}`);
  }

  console.log(
    `${colors.yellow}└─────────────────────────────────────────────────────────────────────────────${colors.reset}\n`,
  );
}

// CLI Execution handler (runs only when executed directly via bun)
if (import.meta.main) {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
OVH Dedicated Servers Categories & Stock CLI

Usage:
  bun run index.ts                     Show categories overview + Kimsufi & So you Start in-stock models
  bun run index.ts --all               Show all categories with all in-stock servers
  bun run index.ts --category <name>   Show specific category (kimsufi, soyoustart, rise, advance, scale, highgrade, game)
  bun run index.ts --dc <code>         Filter by datacenter (e.g. gra, rbx, fra, bhs, waw, lon, syd, sgp)
  bun run index.ts --json              Output raw result as JSON
  bun run index.ts --subsidiary <code> Use custom subsidiary (default: FR, or DE, GB, US, CA, etc.)

Examples:
  bun run index.ts --category kimsufi
  bun run index.ts --category soyoustart
  bun run index.ts --dc gra
`);
    process.exit(0);
  }

  const categoryArgIndex = args.indexOf("--category");
  const specificCategory =
    categoryArgIndex !== -1
      ? (args[categoryArgIndex + 1]?.toLowerCase() as ServerCategoryId)
      : null;

  const dcArgIndex = args.indexOf("--dc");
  const specificDc =
    dcArgIndex !== -1 ? args[dcArgIndex + 1]?.toLowerCase() : undefined;

  const subsidiaryArgIndex = args.indexOf("--subsidiary");
  const subsidiary =
    subsidiaryArgIndex !== -1
      ? args[subsidiaryArgIndex + 1]?.toUpperCase()
      : "FR";

  const showAll = args.includes("--all");
  const asJson = args.includes("--json");

  try {
    if (!asJson) {
      printBanner();
      process.stdout.write(
        `${colors.dim}Fetching catalogs and live availability from OVH...${colors.reset}`,
      );
    }

    const t0 = performance.now();
    const result = await fetchDedicatedServerCategories({
      subsidiary,
      datacenter: specificDc,
    });
    const elapsed = Math.round(performance.now() - t0);

    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    }

    // Clear loading line
    process.stdout.write(`\r${" ".repeat(60)}\r`);

    console.log(
      `${colors.green}✔ Data fetched in ${elapsed}ms!${colors.reset} ${colors.gray}(Subsidiary: ${subsidiary})${colors.reset}`,
    );
    console.log(
      `${colors.bold}Total Categories:${colors.reset} ${result.totalCategories}  |  ` +
        `${colors.bold}Total Servers:${colors.reset} ${result.totalServers}  |  ` +
        `${colors.bold}Available in Stock:${colors.reset} ${colors.green}${colors.bold}${result.totalAvailableServers}${colors.reset}\n`,
    );

    // If specific category requested
    if (specificCategory) {
      const cat = result.getCategory(specificCategory);
      if (!cat) {
        console.error(
          `${colors.yellow}Category "${specificCategory}" not found.${colors.reset} Available categories: ${result.categories.map((c) => c.id).join(", ")}`,
        );
        process.exit(1);
      }

      printCategoryCard(cat);
      const inStock = cat.servers.filter((s) => s.isAvailable);
      printServerList(`${cat.name} Available Servers`, inStock);
      process.exit(0);
    }

    // Print all category overview cards
    console.log(
      `${colors.bold}${colors.white}CATEGORY OVERVIEW:${colors.reset}\n`,
    );
    for (const cat of result.categories) {
      printCategoryCard(cat);
    }

    if (showAll) {
      // Print detailed server list for every category
      for (const cat of result.categories) {
        const inStock = cat.servers.filter((s) => s.isAvailable);
        if (inStock.length > 0) {
          printServerList(`${cat.name} In-Stock Servers`, inStock);
        }
      }
    } else {
      // By default, highlight the user's requested ranges: Kimsufi and So you Start!
      const kimsufi = result.getCategory("kimsufi");
      if (kimsufi) {
        const inStockKs = kimsufi.servers.filter((s) => s.isAvailable);
        printServerList("Kimsufi In-Stock Servers", inStockKs);
      }

      const soyoustart = result.getCategory("soyoustart");
      if (soyoustart) {
        const inStockSys = soyoustart.servers.filter((s) => s.isAvailable);
        printServerList("So you Start In-Stock Servers", inStockSys);
      }

      console.log(
        `${colors.dim}💡 Tip: Run \`bun run index.ts --all\` to see available servers across all categories,`,
      );
      console.log(
        `   or \`bun run index.ts --category <name>\` (e.g. kimsufi, soyoustart, rise, advance, scale, game).${colors.reset}\n`,
      );
    }
  } catch (error) {
    console.error(
      `\n${colors.bold}\x1b[31mError fetching OVH server data:\x1b[0m`,
      error,
    );
    process.exit(1);
  }
}
