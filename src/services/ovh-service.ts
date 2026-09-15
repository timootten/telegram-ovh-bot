import { OVH_DATACENTERS, getDatacenterLocation } from "../datacenters.js";
import type { RawOvhDatacenterAvailabilityItem } from "../types.js";

const OVH_API_BASE = "https://eu.api.ovh.com/1.0";

export interface CountryInfo {
  code: string;
  name: string;
  flag: string;
  datacenters: string[];
}

export interface CachedServerItem {
  id: string;
  planId: string;
  name: string;
  cpu: string;
  brand: "kimsufi" | "soyoustart" | "ovh";
  memory: string;
  ramCode?: string;
  ramPattern?: string;
  disk: string;
  storageCode?: string;
  storagePattern?: string;
  price: string;
  rawPrice: number;
  currency: string;
  supportedDatacenters: string[];
  supportedCountries: string[];
}

interface RawCatalogPricing {
  capacities: string[];
  commitment: number;
  description: string;
  interval: number;
  intervalUnit: string;
  mode: string;
  price: number;
  tax?: number;
  formattedPrice?: string;
  type: string;
}

interface RawCatalogPlan {
  planCode: string;
  invoiceName: string;
  product: string;
  pricings: RawCatalogPricing[];
  addonFamilies: Array<{
    name: string;
    exclusive: boolean;
    mandatory: boolean;
    default?: string;
    addons: string[];
  }>;
  configurations: Array<{
    name: string;
    values: string[];
  }>;
  blobs?: {
    commercial?: {
      name?: string;
    };
    technical?: {
      cpu?: {
        brand?: string;
        model?: string;
      };
    };
  };
}

interface RawCatalogAddon {
  planCode: string;
  invoiceName: string;
  pricings?: RawCatalogPricing[];
}

interface RawCatalogResponse {
  locale: {
    currencyCode: string;
    subsidiary: string;
  };
  plans: RawCatalogPlan[];
  addons: RawCatalogAddon[];
}

/**
 * In-memory global OVH data cache
 */
class OvhService {
  private countriesCache = new Map<string, CountryInfo>();
  private datacenterToCountry = new Map<string, string>();
  private serversCache = new Map<string, CachedServerItem>();
  private latestAvailabilities: RawOvhDatacenterAvailabilityItem[] = [];
  private lastAvailabilitiesFetch = 0;
  private lastCatalogRefresh = 0;
  private refreshIntervalMs = 30 * 60 * 1000; // 30 minutes
  private isRefreshing = false;

  /**
   * Determine the brand ("kimsufi" | "soyoustart" | "ovh") from plan metadata
   */
  public getBrandForPlan(
    planCode: string,
    commercialName?: string,
    invoiceName?: string,
  ): "kimsufi" | "soyoustart" | "ovh" {
    const code = (planCode || "").toLowerCase();
    const name = (commercialName || "").toUpperCase();
    const inv = (invoiceName || "").toUpperCase();

    if (
      name.startsWith("KS") ||
      code.includes("sk") ||
      inv.startsWith("KS-") ||
      inv.includes("KIMSUFI")
    ) {
      return "kimsufi";
    }
    if (
      name.startsWith("SYS") ||
      code.includes("sys") ||
      inv.startsWith("SYS-") ||
      inv.includes("SOYOUSTART")
    ) {
      return "soyoustart";
    }
    return "ovh";
  }

  /**
   * Safe fetch helper with timeout
   */
  private async fetchJson<T>(url: string, timeoutMs = 15000): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "OVH-Availability-Bot/1.0",
        },
      });
      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText} from ${url}`,
        );
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fetch real-time availability from OVH
   */
  public async fetchLiveAvailabilities(
    timeoutMs = 15000,
  ): Promise<RawOvhDatacenterAvailabilityItem[]> {
    const url = `${OVH_API_BASE}/dedicated/server/datacenter/availabilities`;
    const data = await this.fetchJson<RawOvhDatacenterAvailabilityItem[]>(
      url,
      timeoutMs,
    );
    this.latestAvailabilities = data;
    this.lastAvailabilitiesFetch = Date.now();
    return data;
  }

  /**
   * Get cached live availabilities, fetching fresh data if older than maxAgeMs
   */
  public async getLiveAvailabilities(
    maxAgeMs = 15000,
  ): Promise<RawOvhDatacenterAvailabilityItem[]> {
    const now = Date.now();
    if (
      this.latestAvailabilities.length > 0 &&
      now - this.lastAvailabilitiesFetch < maxAgeMs
    ) {
      return this.latestAvailabilities;
    }
    try {
      return await this.fetchLiveAvailabilities(12000);
    } catch (err) {
      console.warn(
        "[OvhService] Failed to fetch fresh live availability for UI:",
        err,
      );
      return this.latestAvailabilities;
    }
  }

  /**
   * Update latest availabilities from external callers (e.g. background poller)
   */
  public updateLatestAvailabilities(
    data: RawOvhDatacenterAvailabilityItem[],
  ): void {
    this.latestAvailabilities = data;
    this.lastAvailabilitiesFetch = Date.now();
  }

  /**
   * Initialize or refresh the cache
   */
  public async refreshCache(subsidiary = "DE", force = false): Promise<void> {
    const now = Date.now();
    if (
      !force &&
      now - this.lastCatalogRefresh < this.refreshIntervalMs &&
      this.serversCache.size > 0
    ) {
      return;
    }
    if (this.isRefreshing) return;

    this.isRefreshing = true;
    try {
      console.log(
        `[OvhService] Refreshing OVH catalogs and datacenter list (subsidiary=${subsidiary})...`,
      );

      // 1. Fetch live availabilities to discover active datacenters and countries dynamically
      const availabilities = await this.fetchLiveAvailabilities(20000);

      const discoveredDcs = new Set<string>();
      for (const a of availabilities) {
        for (const dc of a.datacenters) {
          discoveredDcs.add(dc.datacenter.toLowerCase());
        }
      }

      // Map discovered datacenters to countries
      const newCountries = new Map<string, CountryInfo>();
      const newDcToCountry = new Map<string, string>();

      for (const dcCode of discoveredDcs) {
        const loc = getDatacenterLocation(dcCode);
        const countryCode = loc.countryCode;
        newDcToCountry.set(dcCode, countryCode);

        if (!newCountries.has(countryCode)) {
          newCountries.set(countryCode, {
            code: countryCode,
            name: loc.country,
            flag: loc.flag,
            datacenters: [dcCode],
          });
        } else {
          const c = newCountries.get(countryCode)!;
          if (!c.datacenters.includes(dcCode)) {
            c.datacenters.push(dcCode);
          }
        }
      }

      this.datacenterToCountry = newDcToCountry;
      this.countriesCache = newCountries;

      // 2. Fetch catalogs (eco and baremetal)
      const [ecoCatalog, bmCatalog] = await Promise.all([
        this.fetchJson<RawCatalogResponse>(
          `${OVH_API_BASE}/order/catalog/public/eco?ovhSubsidiary=${subsidiary}`,
          20000,
        ).catch((err) => {
          console.warn("[OvhService] Failed to fetch eco catalog:", err);
          return null;
        }),
        this.fetchJson<RawCatalogResponse>(
          `${OVH_API_BASE}/order/catalog/public/baremetalServers?ovhSubsidiary=${subsidiary}`,
          20000,
        ).catch((err) => {
          console.warn("[OvhService] Failed to fetch baremetal catalog:", err);
          return null;
        }),
      ]);

      const addonMap = new Map<string, RawCatalogAddon>();
      for (const addon of [
        ...(ecoCatalog?.addons || []),
        ...(bmCatalog?.addons || []),
      ]) {
        if (addon.planCode && addon.invoiceName) {
          addonMap.set(addon.planCode, addon);
        }
      }

      const allPlans: RawCatalogPlan[] = [
        ...(ecoCatalog?.plans || []),
        ...(bmCatalog?.plans || []),
      ];

      const newServersCache = new Map<string, CachedServerItem>();

      for (const plan of allPlans) {
        const commercialName =
          plan.blobs?.commercial?.name ||
          (plan.invoiceName?.includes("|")
            ? plan.invoiceName.split("|")[0]?.trim() || plan.planCode
            : plan.planCode);

        const brand = this.getBrandForPlan(
          plan.planCode,
          commercialName,
          plan.invoiceName,
        );

        // Extract CPU
        let cpu = "Standard CPU";
        if (plan.invoiceName?.includes("|")) {
          cpu = plan.invoiceName.split("|").slice(1).join("|").trim();
        } else if (plan.blobs?.technical?.cpu?.model) {
          const brandName = plan.blobs.technical.cpu.brand || "";
          cpu = `${brandName} ${plan.blobs.technical.cpu.model}`.trim();
        }

        // Extract base pricing (including tax / MwSt.)
        const renewPricing =
          plan.pricings.find(
            (pr) =>
              pr.capacities.includes("renew") &&
              pr.intervalUnit === "month" &&
              pr.commitment === 0,
          ) ||
          plan.pricings.find(
            (pr) =>
              pr.capacities.includes("renew") && pr.intervalUnit === "month",
          );

        const baseRawPrice = renewPricing
          ? (renewPricing.price + (renewPricing.tax || 0)) / 100_000_000
          : 0;

        // Supported datacenters & countries
        const supportedDcs =
          plan.configurations.find((c) => c.name === "dedicated_datacenter")
            ?.values || [];

        const supportedCountries = new Set<string>();
        for (const dc of supportedDcs) {
          const country = this.datacenterToCountry.get(dc.toLowerCase());
          if (country) {
            supportedCountries.add(country);
          }
        }

        // If no explicit datacenters restricted in catalog, mark available in all discovered countries
        const finalSupportedCountries =
          supportedCountries.size > 0
            ? Array.from(supportedCountries)
            : Array.from(newCountries.keys());

        // Extract ALL distinct RAM options for this plan
        const ramFamily = plan.addonFamilies.find((f) => f.name === "memory");
        const ramList: string[] = ramFamily?.addons?.length
          ? ramFamily.addons
          : [ramFamily?.default].filter((r): r is string => Boolean(r));

        if (ramList.length === 0) {
          ramList.push("Standard RAM");
        }

        // Extract ALL distinct storage options for this plan
        const storageFamily = plan.addonFamilies.find(
          (f) => f.name === "storage",
        );
        const diskList: string[] = storageFamily?.addons?.length
          ? storageFamily.addons
          : [storageFamily?.default].filter((d): d is string => Boolean(d));

        if (diskList.length === 0) {
          diskList.push("Standard Storage");
        }

        for (const ramCode of ramList) {
          const ramAddon = addonMap.get(ramCode);
          const memory = ramAddon?.invoiceName || ramCode;
          const ramRenew = ramAddon?.pricings?.find(
            (pr) =>
              pr.capacities.includes("renew") &&
              pr.intervalUnit === "month" &&
              pr.commitment === 0,
          );
          const ramPrice = ramRenew
            ? (ramRenew.price + (ramRenew.tax || 0)) / 100_000_000
            : 0;
          const ramPattern = ramCode
            .replace(/-\d\d[a-z]+.*$/, "")
            .replace(/-v\d+.*$/, "");

          for (const diskCode of diskList) {
            const diskAddon = addonMap.get(diskCode);
            const disk = diskAddon?.invoiceName || diskCode;

            const diskRenew = diskAddon?.pricings?.find(
              (pr) =>
                pr.capacities.includes("renew") &&
                pr.intervalUnit === "month" &&
                pr.commitment === 0,
            );
            const diskPrice = diskRenew
              ? (diskRenew.price + (diskRenew.tax || 0)) / 100_000_000
              : 0;
            const totalRawPrice =
              Math.round((baseRawPrice + ramPrice + diskPrice) * 100) / 100;
            const price = `${totalRawPrice.toFixed(2)} €`;

            // Pattern to match against availability API (e.g. "softraid-2x450nvme", "softraid-2x2000sa")
            const storagePattern = diskCode
              .replace(/-24sk\d+.*$/, "")
              .replace(/-25sk\d+.*$/, "")
              .replace(/-26sk\d+.*$/, "")
              .replace(/-24sys\d+.*$/, "")
              .replace(/-24adv\d+.*$/, "");

            const uniqueKey = `${commercialName}__${memory}__${disk}`;

            if (!newServersCache.has(uniqueKey)) {
              newServersCache.set(uniqueKey, {
                id: uniqueKey,
                planId: plan.planCode,
                name: commercialName,
                cpu,
                brand,
                memory,
                ramCode,
                ramPattern,
                disk,
                storageCode: diskCode,
                storagePattern,
                price,
                rawPrice: totalRawPrice,
                currency: ecoCatalog?.locale?.currencyCode || "EUR",
                supportedDatacenters: supportedDcs,
                supportedCountries: finalSupportedCountries,
              });
            }
          }
        }
      }

      this.serversCache = newServersCache;
      this.lastCatalogRefresh = now;
      console.log(
        `[OvhService] Cache refreshed successfully! Discovered ${this.countriesCache.size} countries and cached ${this.serversCache.size} server plans.`,
      );
    } catch (error) {
      console.error("[OvhService] Error during cache refresh:", error);
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * Get all dynamically cached countries
   */
  public getCountries(): CountryInfo[] {
    return Array.from(this.countriesCache.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }

  /**
   * Get a country by code
   */
  public getCountry(code: string): CountryInfo | undefined {
    return this.countriesCache.get(code.toUpperCase());
  }

  /**
   * Map a datacenter code to its country code
   */
  public getCountryForDatacenter(dc: string): string {
    const code = dc.toLowerCase().trim();
    const cached = this.datacenterToCountry.get(code);
    if (cached) return cached;
    return getDatacenterLocation(code).countryCode;
  }

  /**
   * Get all servers for user selected brands (both in-stock and out-of-stock)
   * Sorted naturally by model name, then by price
   */
  public getServersFor(
    brands: Set<string>,
    _countries?: Set<string>,
  ): CachedServerItem[] {
    const matched: CachedServerItem[] = [];
    const seenIds = new Set<string>();

    for (const server of this.serversCache.values()) {
      if (!brands.has(server.brand)) continue;

      if (!seenIds.has(server.id)) {
        seenIds.add(server.id);
        matched.push(server);
      }
    }

    // Natural sort: group by model name naturally (e.g. KS-1, KS-2... KS-5...), then by price
    return matched.sort((a, b) => {
      const comp = a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (comp !== 0) return comp;
      return a.rawPrice - b.rawPrice;
    });
  }

  /**
   * Get a cached server by planId, commercial name or unique key
   */
  public getServer(planIdOrName: string): CachedServerItem | undefined {
    if (!planIdOrName) return undefined;
    if (this.serversCache.has(planIdOrName)) {
      return this.serversCache.get(planIdOrName);
    }
    const query = planIdOrName.toUpperCase().trim();
    for (const server of this.serversCache.values()) {
      if (
        server.planId.toUpperCase() === query ||
        server.name.toUpperCase() === query ||
        server.id.toUpperCase() === query
      ) {
        return server;
      }
    }
    for (const server of this.serversCache.values()) {
      if (
        server.planId.toUpperCase().startsWith(query) ||
        query.startsWith(server.planId.toUpperCase())
      ) {
        return server;
      }
    }
    return undefined;
  }

  /**
   * Build direct shop / order link for a server on OVH (always German /de/)
   */
  public getOrderUrl(planCodeOrName: string, _subsidiary = "DE"): string {
    const lang = "de";
    const server = this.getServer(planCodeOrName);
    let name = (server?.name || planCodeOrName).toLowerCase().trim();
    const brand = server?.brand || this.getBrandForPlan(planCodeOrName, name);

    // If name does not yet have a clean model prefix, infer it from planCode
    const code = planCodeOrName.toLowerCase();
    if (
      !name.startsWith("ks-") &&
      !name.startsWith("sys-") &&
      !name.startsWith("rise-")
    ) {
      if (code.includes("sk50a")) name = "ks-5-a";
      else if (code.includes("sk50b")) name = "ks-5-b";
      else if (code.includes("sk50")) name = "ks-5";
      else if (code.includes("sk40")) name = "ks-4";
      else if (code.includes("sk30")) name = "ks-3";
      else if (code.includes("sk20")) name = "ks-2";
      else if (code.includes("sk10b")) name = "ks-1-b";
      else if (code.includes("sk10")) name = "ks-1";
      else if (code.includes("sk602b")) name = "ks-6-b";
      else if (code.includes("sk60")) name = "ks-6";
      else if (code.includes("sk70")) name = "ks-7";
      else if (code.includes("skgame")) name = "ks-game";
      else if (code.includes("skstor")) name = "ks-stor";
      else if (code.includes("ska")) name = "ks-a";
      else if (code.includes("skb")) name = "ks-b";
      else if (code.includes("skc")) name = "ks-c";
      else if (code.includes("sys01") || code.includes("sys1")) name = "sys-1";
      else if (code.includes("sys02") || code.includes("sys2")) name = "sys-2";
      else if (code.includes("sys03") || code.includes("sys3")) name = "sys-3";
      else if (code.includes("sys04") || code.includes("sys4")) name = "sys-4";
      else if (code.includes("sys05") || code.includes("sys5")) name = "sys-5";
      else if (code.includes("sys06") || code.includes("sys6")) name = "sys-6";
    }

    if (brand === "kimsufi" || name.startsWith("ks")) {
      const model = name.startsWith("ks") ? name : "ks-5";
      return `https://eco.ovhcloud.com/${lang}/kimsufi/${encodeURIComponent(model)}/`;
    }
    if (brand === "soyoustart" || name.startsWith("sys")) {
      const model = name.startsWith("sys") ? name : "sys-1";
      return `https://eco.ovhcloud.com/${lang}/soyoustart/${encodeURIComponent(model)}/`;
    }
    if (name.startsWith("rise")) {
      return `https://eco.ovhcloud.com/${lang}/rise/${encodeURIComponent(name)}/`;
    }
    if (name.startsWith("game")) {
      return `https://www.ovhcloud.com/${lang}/bare-metal/game/`;
    }
    if (name.startsWith("scale")) {
      return `https://www.ovhcloud.com/${lang}/bare-metal/scale/`;
    }
    if (name.startsWith("hgr") || name.startsWith("hci")) {
      return `https://www.ovhcloud.com/${lang}/bare-metal/high-grade/`;
    }
    return `https://www.ovhcloud.com/${lang}/bare-metal/advance/`;
  }
}

export const ovhService = new OvhService();
