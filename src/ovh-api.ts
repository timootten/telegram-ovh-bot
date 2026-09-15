import {
  OVH_DATACENTERS,
  getAvailabilityLabel,
  getDatacenterLocation,
  isStatusAvailable,
} from "./datacenters.js";
import type {
  AvailabilityStatus,
  DedicatedServer,
  DedicatedServerCategoriesResult,
  DedicatedServerCategory,
  FetchOptions,
  RawOvhCatalog,
  RawOvhCatalogPlan,
  RawOvhDatacenterAvailabilityItem,
  ServerBrand,
  ServerCategoryId,
  ServerDatacenterAvailability,
  ServerHardwareVariant,
  ServerPricing,
  ServerSpecs,
} from "./types.js";

const OVH_API_BASE = "https://eu.api.ovh.com/1.0";

/**
 * Metadata definition for each dedicated server category
 */
interface CategoryMeta {
  id: ServerCategoryId;
  name: string;
  brand: ServerBrand;
  tagline: string;
  description: string;
  priority: number;
}

const CATEGORY_DEFINITIONS: Record<ServerCategoryId, CategoryMeta> = {
  kimsufi: {
    id: "kimsufi",
    name: "Kimsufi",
    brand: "Eco",
    tagline: "Essential budget-friendly dedicated servers",
    description:
      "Ultra-affordable entry-level dedicated servers designed for personal projects, test environments, learning, self-hosting, and light web hosting.",
    priority: 1,
  },
  soyoustart: {
    id: "soyoustart",
    name: "So you Start",
    brand: "Eco",
    tagline: "Reliable & versatile servers for SMBs and developers",
    description:
      "Cost-effective, powerful dedicated servers suited for small businesses, development environments, multi-site web hosting, and community game servers.",
    priority: 2,
  },
  rise: {
    id: "rise",
    name: "Rise",
    brand: "Eco",
    tagline: "Versatile, modern enterprise-grade servers",
    description:
      "Powered by modern AMD Ryzen and Intel Xeon processors, delivering versatile performance for business workloads, virtualization, and storage.",
    priority: 3,
  },
  advance: {
    id: "advance",
    name: "Advance",
    brand: "Bare Metal",
    tagline: "Next-gen compute & high-speed NVMe storage",
    description:
      "High-performance bare metal servers designed for business-critical applications, high-traffic e-commerce, databases, and containerization.",
    priority: 4,
  },
  scale: {
    id: "scale",
    name: "Scale",
    brand: "Bare Metal",
    tagline: "High-resilience, high-core compute with vRack",
    description:
      "Enterprise bare metal servers engineered for demanding computing, high-density virtualization, big data, and software-defined architectures.",
    priority: 5,
  },
  highgrade: {
    id: "highgrade",
    name: "High Grade",
    brand: "Bare Metal",
    tagline: "Flagship HCI, SDS, SAP HANA & AI powerhouses",
    description:
      "Top-tier dual and quad-socket enterprise infrastructure engineered for SAP HANA, private cloud, Nutanix, SDS, and large AI/ML workloads.",
    priority: 6,
  },
  game: {
    id: "game",
    name: "Game",
    brand: "Bare Metal",
    tagline: "Ultra-high CPU frequencies & Game Anti-DDoS",
    description:
      "Servers engineered specifically for video game hosting, esports, live streaming, and voice servers with high single-core frequencies and water cooling.",
    priority: 7,
  },
  other: {
    id: "other",
    name: "Other Dedicated Servers",
    brand: "Bare Metal",
    tagline: "Specialized bare metal servers",
    description: "Other bare metal server models from OVHcloud.",
    priority: 8,
  },
};

/**
 * Status priority for determining the best availability when combining variants
 */
const STATUS_PRIORITY: Record<string, number> = {
  "1H-high": 6,
  "1H-low": 5,
  "72H": 4,
  comingSoon: 3,
  unknown: 2,
  unavailable: 1,
};

/**
 * Generic HTTP fetch helper with timeout and error checking
 */
async function fetchJson<T>(url: string, timeoutMs = 15000): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "OVH-Telegram-Bot-Client/1.0 (+https://github.com)",
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(
        `OVH API request failed [${response.status} ${response.statusText}] for ${url}: ${errorText}`,
      );
    }

    return (await response.json()) as T;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `OVH API request timed out after ${timeoutMs}ms for ${url}`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch a public OVH product catalog
 */
export async function fetchCatalog(
  catalog: "eco" | "baremetalServers",
  subsidiary = "FR",
  timeoutMs = 15000,
): Promise<RawOvhCatalog> {
  const url = `${OVH_API_BASE}/order/catalog/public/${catalog}?ovhSubsidiary=${encodeURIComponent(subsidiary)}`;
  return fetchJson<RawOvhCatalog>(url, timeoutMs);
}

/**
 * Fetch live dedicated server datacenter availabilities
 */
export async function fetchDatacenterAvailabilities(
  timeoutMs = 15000,
): Promise<RawOvhDatacenterAvailabilityItem[]> {
  const url = `${OVH_API_BASE}/dedicated/server/datacenter/availabilities`;
  return fetchJson<RawOvhDatacenterAvailabilityItem[]>(url, timeoutMs);
}

/**
 * Categorize a server plan into one of the dedicated server categories
 */
export function categorizeServer(
  planCode: string,
  commercialName?: string,
  invoiceName?: string,
): ServerCategoryId {
  const code = (planCode || "").toLowerCase();
  const comm = (commercialName || "").toUpperCase();
  const inv = (invoiceName || "").toUpperCase();

  // Kimsufi range
  if (
    comm.startsWith("KS") ||
    code.includes("sk") ||
    inv.startsWith("KS-") ||
    inv.includes("KIMSUFI")
  ) {
    return "kimsufi";
  }

  // So you Start range
  if (
    comm.startsWith("SYS") ||
    code.includes("sys") ||
    inv.startsWith("SYS-") ||
    inv.includes("SOYOUSTART")
  ) {
    return "soyoustart";
  }

  // Rise range
  if (
    comm.startsWith("RISE") ||
    code.includes("rise") ||
    inv.startsWith("RISE-")
  ) {
    return "rise";
  }

  // Advance range
  if (
    comm.startsWith("ADVANCE") ||
    code.includes("adv") ||
    inv.startsWith("ADVANCE-")
  ) {
    return "advance";
  }

  // Scale range
  if (
    comm.startsWith("SCALE") ||
    code.includes("scale") ||
    inv.startsWith("SCALE-")
  ) {
    return "scale";
  }

  // High Grade range (SAP, HCI, SDS, Storage flagships)
  if (
    comm.startsWith("HGR") ||
    comm.startsWith("HCI") ||
    code.includes("hgr") ||
    code.includes("hci") ||
    code.includes("sds") ||
    inv.startsWith("HGR-") ||
    inv.includes("HIGH GRADE")
  ) {
    return "highgrade";
  }

  // Dedicated Game range
  if (
    comm.startsWith("GAME") ||
    code.includes("game") ||
    inv.startsWith("GAME-")
  ) {
    return "game";
  }

  return "other";
}

/**
 * Extract clean pricing information from a catalog plan
 */
function extractPricing(
  plan: RawOvhCatalogPlan,
  defaultCurrency = "EUR",
  taxRate = 20,
): ServerPricing {
  const renewPricing =
    plan.pricings.find(
      (pr) =>
        pr.capacities.includes("renew") &&
        pr.intervalUnit === "month" &&
        pr.commitment === 0,
    ) ||
    plan.pricings.find(
      (pr) => pr.capacities.includes("renew") && pr.intervalUnit === "month",
    ) ||
    plan.pricings[0];

  const installPricing = plan.pricings.find(
    (pr) => pr.capacities.includes("installation") && pr.commitment === 0,
  );

  const monthlyPrice = renewPricing
    ? (renewPricing.price + (renewPricing.tax || 0)) / 100_000_000
    : 0;
  const setupPrice = installPricing
    ? (installPricing.price + (installPricing.tax || 0)) / 100_000_000
    : 0;

  const formattedMonthly = `${monthlyPrice.toFixed(2)} ${defaultCurrency}`;
  const formattedSetup = `${setupPrice.toFixed(2)} ${defaultCurrency}`;

  return {
    monthly: Math.round(monthlyPrice * 100) / 100,
    formattedMonthly,
    setup: Math.round(setupPrice * 100) / 100,
    formattedSetup,
    currency: defaultCurrency,
    taxRate,
  };
}

/**
 * Extract clean hardware specifications from a catalog plan and addon lookup map
 */
function extractSpecs(
  plan: RawOvhCatalogPlan,
  addonMap: Map<string, string>,
): ServerSpecs {
  // Extract CPU
  let cpu = "Unknown CPU";
  if (plan.invoiceName?.includes("|")) {
    cpu = plan.invoiceName.split("|").slice(1).join("|").trim();
  } else if (plan.blobs?.technical?.cpu?.model) {
    const brand = plan.blobs.technical.cpu.brand || "";
    const model = plan.blobs.technical.cpu.model;
    cpu = `${brand} ${model}`.trim();
  }

  // Extract Memory
  const memoryFamily = plan.addonFamilies.find((f) => f.name === "memory");
  const memoryAddon = memoryFamily?.default || memoryFamily?.addons?.[0];
  const memory = memoryAddon ? addonMap.get(memoryAddon) || memoryAddon : "N/A";

  // Extract Storage
  const storageFamily = plan.addonFamilies.find((f) => f.name === "storage");
  const storageAddon = storageFamily?.default || storageFamily?.addons?.[0];
  const storage = storageAddon
    ? addonMap.get(storageAddon) || storageAddon
    : "N/A";

  // Extract Bandwidth
  const bwFamily = plan.addonFamilies.find((f) => f.name === "bandwidth");
  const bwAddon = bwFamily?.default || bwFamily?.addons?.[0];
  const bandwidth = bwAddon ? addonMap.get(bwAddon) || bwAddon : undefined;

  // Extract vRack
  const vrackFamily = plan.addonFamilies.find((f) => f.name === "vrack");
  const vrackAddon = vrackFamily?.default || vrackFamily?.addons?.[0];
  const vrack = vrackAddon ? addonMap.get(vrackAddon) || vrackAddon : undefined;

  return {
    cpu,
    memory,
    storage,
    bandwidth,
    vrack,
  };
}

/**
 * Process datacenter availability items for a specific plan
 */
function processAvailability(
  planCode: string,
  serverName: string,
  availabilityMap: Map<string, RawOvhDatacenterAvailabilityItem[]>,
  addonMap: Map<string, string>,
): {
  isAvailable: boolean;
  inStockDatacenters: string[];
  datacenterAvailabilities: ServerDatacenterAvailability[];
  availableVariants: ServerHardwareVariant[];
  totalVariantsCount: number;
  availableVariantsCount: number;
} {
  // Try exact planCode match first, fallback to serverName
  const items =
    availabilityMap.get(planCode) || availabilityMap.get(serverName) || [];

  const bestStatusByDc = new Map<string, AvailabilityStatus>();
  const availableVariants: ServerHardwareVariant[] = [];

  for (const item of items) {
    const itemInStockDcs: string[] = [];
    const itemDatacenters: Array<{
      datacenter: string;
      availability: AvailabilityStatus;
    }> = [];

    for (const dc of item.datacenters) {
      const status = (dc.availability || "unavailable") as AvailabilityStatus;
      itemDatacenters.push({
        datacenter: dc.datacenter,
        availability: status,
      });

      if (isStatusAvailable(status)) {
        itemInStockDcs.push(dc.datacenter);
      }

      // Update the best status for this datacenter across all variants
      const currentBest = bestStatusByDc.get(dc.datacenter);
      const currentPrio = currentBest ? STATUS_PRIORITY[currentBest] || 0 : 0;
      const newPrio = STATUS_PRIORITY[status] || 0;

      if (newPrio > currentPrio) {
        bestStatusByDc.set(dc.datacenter, status);
      }
    }

    if (itemInStockDcs.length > 0) {
      availableVariants.push({
        fqn: item.fqn,
        memory: addonMap.get(item.memory) || item.memory,
        storage: addonMap.get(item.storage) || item.storage,
        systemStorage: item.systemStorage
          ? addonMap.get(item.systemStorage) || item.systemStorage
          : undefined,
        inStockDatacenters: itemInStockDcs,
        datacenters: itemDatacenters,
      });
    }
  }

  const datacenterAvailabilities: ServerDatacenterAvailability[] = [];
  const inStockDatacenters: string[] = [];

  for (const [dcCode, status] of bestStatusByDc.entries()) {
    const available = isStatusAvailable(status);
    if (available) {
      inStockDatacenters.push(dcCode);
    }

    datacenterAvailabilities.push({
      datacenter: dcCode,
      location: getDatacenterLocation(dcCode),
      availability: status,
      isAvailable: available,
      availabilityLabel: getAvailabilityLabel(status),
    });
  }

  // Sort datacenters: available first, then by code
  datacenterAvailabilities.sort((a, b) => {
    if (a.isAvailable && !b.isAvailable) return -1;
    if (!a.isAvailable && b.isAvailable) return 1;
    return a.datacenter.localeCompare(b.datacenter);
  });

  return {
    isAvailable: inStockDatacenters.length > 0,
    inStockDatacenters,
    datacenterAvailabilities,
    availableVariants,
    totalVariantsCount: items.length,
    availableVariantsCount: availableVariants.length,
  };
}

/**
 * Determine the primary region for a plan based on its code and configuration
 */
function determinePlanRegion(plan: RawOvhCatalogPlan): string {
  const code = plan.planCode.toLowerCase();
  if (code.endsWith("-sgp")) return "Asia-Pacific (Singapore)";
  if (code.endsWith("-syd")) return "Asia-Pacific (Sydney)";
  if (code.endsWith("-mum") || code.endsWith("-ynm"))
    return "Asia-Pacific (Mumbai)";

  const dcs =
    plan.configurations.find((c) => c.name === "dedicated_datacenter")
      ?.values || [];
  if (dcs.length === 1 && dcs[0]) {
    const loc = getDatacenterLocation(dcs[0]);
    return `${loc.region} (${loc.name})`;
  }
  return "Europe & North America";
}

/**
 * Main function: Fetch all dedicated server categories and their live availability
 */
export async function fetchDedicatedServerCategories(
  options: FetchOptions = {},
): Promise<DedicatedServerCategoriesResult> {
  const subsidiary = options.subsidiary || "FR";
  const timeoutMs = options.timeoutMs || 15000;

  // Fetch Eco catalog, Bare Metal catalog, and datacenter availability concurrently
  const [ecoCatalog, bmCatalog, rawAvailabilities] = await Promise.all([
    fetchCatalog("eco", subsidiary, timeoutMs),
    fetchCatalog("baremetalServers", subsidiary, timeoutMs),
    fetchDatacenterAvailabilities(timeoutMs),
  ]);

  const currency = ecoCatalog.locale?.currencyCode || "EUR";
  const taxRate = ecoCatalog.locale?.taxRate || 20;

  // Build a lookup map for addon invoice names (RAM, Storage, etc.)
  const addonMap = new Map<string, string>();
  for (const addon of [
    ...(ecoCatalog.addons || []),
    ...(bmCatalog.addons || []),
  ]) {
    if (addon.planCode && addon.invoiceName) {
      addonMap.set(addon.planCode, addon.invoiceName);
    }
  }

  // Pre-index raw availability items by planCode and server for O(1) lookups
  const availabilityMap = new Map<string, RawOvhDatacenterAvailabilityItem[]>();
  for (const item of rawAvailabilities) {
    if (item.planCode) {
      if (!availabilityMap.has(item.planCode)) {
        availabilityMap.set(item.planCode, []);
      }
      availabilityMap.get(item.planCode)!.push(item);
    }
    if (item.server && item.server !== item.planCode) {
      if (!availabilityMap.has(item.server)) {
        availabilityMap.set(item.server, []);
      }
      availabilityMap.get(item.server)!.push(item);
    }
  }

  // Combine plans, avoiding duplicates if any planCode appears in both catalogs
  const seenPlanCodes = new Set<string>();
  const combinedPlans: Array<{
    plan: RawOvhCatalogPlan;
    catalogType: "eco" | "baremetal";
  }> = [];

  for (const plan of ecoCatalog.plans || []) {
    if (!seenPlanCodes.has(plan.planCode)) {
      seenPlanCodes.add(plan.planCode);
      combinedPlans.push({ plan, catalogType: "eco" });
    }
  }

  for (const plan of bmCatalog.plans || []) {
    if (!seenPlanCodes.has(plan.planCode)) {
      seenPlanCodes.add(plan.planCode);
      combinedPlans.push({ plan, catalogType: "baremetal" });
    }
  }

  // Map each plan to a rich DedicatedServer object
  const allServers: DedicatedServer[] = combinedPlans.map(
    ({ plan, catalogType }) => {
      const commercialName =
        plan.blobs?.commercial?.name ||
        (plan.invoiceName?.includes("|")
          ? plan.invoiceName.split("|")[0]?.trim() || plan.planCode
          : plan.planCode);

      const category = categorizeServer(
        plan.planCode,
        commercialName,
        plan.invoiceName,
      );
      const categoryMeta = CATEGORY_DEFINITIONS[category];
      const brand =
        categoryMeta?.brand || (catalogType === "eco" ? "Eco" : "Bare Metal");

      const pricing = extractPricing(plan, currency, taxRate);
      const specs = extractSpecs(plan, addonMap);
      const availability = processAvailability(
        plan.planCode,
        plan.product,
        availabilityMap,
        addonMap,
      );

      const supportedDatacenters =
        plan.configurations.find((c) => c.name === "dedicated_datacenter")
          ?.values || [];

      const region = determinePlanRegion(plan);

      return {
        planCode: plan.planCode,
        product: plan.product,
        commercialName,
        invoiceName: plan.invoiceName,
        category,
        brand,
        region,
        supportedDatacenters,
        specs,
        pricing,
        isAvailable: availability.isAvailable,
        inStockDatacenters: availability.inStockDatacenters,
        datacenterAvailabilities: availability.datacenterAvailabilities,
        availableVariants: availability.availableVariants,
        totalVariantsCount: availability.totalVariantsCount,
        availableVariantsCount: availability.availableVariantsCount,
      };
    },
  );

  // Filter if options specify onlyAvailable or a specific datacenter
  let filteredServers = allServers;
  if (options.onlyAvailable) {
    filteredServers = filteredServers.filter((s) => s.isAvailable);
  }
  if (options.datacenter) {
    const dc = options.datacenter.toLowerCase();
    filteredServers = filteredServers.filter((s) =>
      s.inStockDatacenters.includes(dc),
    );
  }

  // Group servers by category
  const serversByCategory = new Map<ServerCategoryId, DedicatedServer[]>();
  for (const server of filteredServers) {
    if (!serversByCategory.has(server.category)) {
      serversByCategory.set(server.category, []);
    }
    serversByCategory.get(server.category)!.push(server);
  }

  // Build the rich category list
  const categoryIds: ServerCategoryId[] = [
    "kimsufi",
    "soyoustart",
    "rise",
    "advance",
    "scale",
    "highgrade",
    "game",
    "other",
  ];

  const categories: DedicatedServerCategory[] = categoryIds
    .map((id) => {
      const meta = CATEGORY_DEFINITIONS[id];
      const servers = serversByCategory.get(id) || [];

      // Sort servers inside each category: available first, then by monthly price ascending
      servers.sort((a, b) => {
        if (a.isAvailable && !b.isAvailable) return -1;
        if (!a.isAvailable && b.isAvailable) return 1;
        return a.pricing.monthly - b.pricing.monthly;
      });

      const inStockDcs = new Set<string>();
      let availableCount = 0;
      let minPrice = Infinity;

      for (const s of servers) {
        if (s.isAvailable) {
          availableCount++;
          s.inStockDatacenters.forEach((dc) => inStockDcs.add(dc));
        }
        if (s.pricing.monthly > 0 && s.pricing.monthly < minPrice) {
          minPrice = s.pricing.monthly;
        }
      }

      const effectiveMinPrice = minPrice === Infinity ? 0 : minPrice;
      const formattedMinPrice =
        effectiveMinPrice > 0
          ? `${effectiveMinPrice.toFixed(2)} ${currency}`
          : "N/A";

      return {
        id,
        name: meta.name,
        brand: meta.brand,
        tagline: meta.tagline,
        description: meta.description,
        totalServersCount: servers.length,
        availableServersCount: availableCount,
        minPrice: effectiveMinPrice,
        formattedMinPrice,
        currency,
        inStockDatacenters: Array.from(inStockDcs),
        servers,
      };
    })
    .filter((cat) => cat.totalServersCount > 0); // Exclude empty categories

  const totalAvailableServers = categories.reduce(
    (sum, cat) => sum + cat.availableServersCount,
    0,
  );
  const totalServers = categories.reduce(
    (sum, cat) => sum + cat.totalServersCount,
    0,
  );

  return {
    subsidiary,
    fetchedAt: new Date(),
    totalCategories: categories.length,
    totalServers,
    totalAvailableServers,
    categories,
    getCategory: (id: ServerCategoryId) => categories.find((c) => c.id === id),
    getAvailableServers: (categoryId?: ServerCategoryId) => {
      if (categoryId) {
        const cat = categories.find((c) => c.id === categoryId);
        return cat ? cat.servers.filter((s) => s.isAvailable) : [];
      }
      return categories.flatMap((c) => c.servers.filter((s) => s.isAvailable));
    },
  };
}

/**
 * Quick helper: Get all currently available servers, optionally filtered by category
 */
export async function getAvailableServers(
  options: {
    category?: ServerCategoryId;
    datacenter?: string;
    subsidiary?: string;
    timeoutMs?: number;
  } = {},
): Promise<DedicatedServer[]> {
  const result = await fetchDedicatedServerCategories({
    subsidiary: options.subsidiary,
    timeoutMs: options.timeoutMs,
    datacenter: options.datacenter,
    onlyAvailable: true,
  });

  if (options.category) {
    return result.getAvailableServers(options.category);
  }
  return result.getAvailableServers();
}

/**
 * Quick helper: Get a single category with its servers and live availability
 */
export async function getServerCategory(
  categoryId: ServerCategoryId,
  options: FetchOptions = {},
): Promise<DedicatedServerCategory | undefined> {
  const result = await fetchDedicatedServerCategories(options);
  return result.getCategory(categoryId);
}
