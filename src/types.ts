/**
 * TypeScript definitions for OVH Dedicated Server Categories & Availability API
 */

export type ServerCategoryId =
  | "kimsufi"
  | "soyoustart"
  | "rise"
  | "advance"
  | "scale"
  | "highgrade"
  | "game"
  | "other";

export type ServerBrand = "Eco" | "Bare Metal";

export type AvailabilityStatus =
  | "1H-high"
  | "1H-low"
  | "72H"
  | "comingSoon"
  | "unavailable"
  | "unknown";

export interface DatacenterLocation {
  code: string;
  name: string;
  city: string;
  country: string;
  countryCode: string;
  region: "Europe" | "North America" | "Asia-Pacific" | "Other";
  flag: string;
}

export interface ServerDatacenterAvailability {
  datacenter: string;
  location?: DatacenterLocation;
  availability: AvailabilityStatus;
  isAvailable: boolean;
  availabilityLabel: string;
}

export interface ServerHardwareVariant {
  fqn: string;
  memory: string;
  storage: string;
  systemStorage?: string;
  inStockDatacenters: string[];
  datacenters: Array<{
    datacenter: string;
    availability: AvailabilityStatus;
  }>;
}

export interface ServerPricing {
  monthly: number;
  formattedMonthly: string;
  setup: number;
  formattedSetup: string;
  currency: string;
  taxRate?: number;
}

export interface ServerSpecs {
  cpu: string;
  cores?: string;
  frequency?: string;
  memory: string;
  storage: string;
  bandwidth?: string;
  vrack?: string;
}

export interface DedicatedServer {
  planCode: string;
  product: string;
  commercialName: string;
  invoiceName: string;
  category: ServerCategoryId;
  brand: ServerBrand;
  region?: string;
  supportedDatacenters: string[];
  specs: ServerSpecs;
  pricing: ServerPricing;
  isAvailable: boolean;
  inStockDatacenters: string[];
  datacenterAvailabilities: ServerDatacenterAvailability[];
  availableVariants: ServerHardwareVariant[];
  totalVariantsCount: number;
  availableVariantsCount: number;
}

export interface DedicatedServerCategory {
  id: ServerCategoryId;
  name: string;
  brand: ServerBrand;
  tagline: string;
  description: string;
  totalServersCount: number;
  availableServersCount: number;
  minPrice: number;
  formattedMinPrice: string;
  currency: string;
  inStockDatacenters: string[];
  servers: DedicatedServer[];
}

export interface DedicatedServerCategoriesResult {
  subsidiary: string;
  fetchedAt: Date;
  totalCategories: number;
  totalServers: number;
  totalAvailableServers: number;
  categories: DedicatedServerCategory[];
  getCategory: (id: ServerCategoryId) => DedicatedServerCategory | undefined;
  getAvailableServers: (categoryId?: ServerCategoryId) => DedicatedServer[];
}

export interface FetchOptions {
  /**
   * OVH Subsidiary country code (defaults to "FR").
   * Examples: "FR", "DE", "GB", "US", "CA", "ES", "IT", "PL"
   */
  subsidiary?: string;

  /**
   * Request timeout in milliseconds (defaults to 15000)
   */
  timeoutMs?: number;

  /**
   * Whether to include only servers that are currently in stock
   */
  onlyAvailable?: boolean;

  /**
   * Filter by specific datacenter code (e.g. "gra", "rbx", "fra")
   */
  datacenter?: string;
}

// Raw OVH API Types
export interface RawOvhDatacenterAvailabilityItem {
  fqn: string;
  memory: string;
  planCode: string;
  server: string;
  storage: string;
  systemStorage?: string;
  datacenters: Array<{
    availability: string;
    datacenter: string;
  }>;
}

export interface RawOvhCatalogPricing {
  capacities: string[];
  commitment: number;
  description: string;
  interval: number;
  intervalUnit: string;
  mode: string;
  price: number;
  formattedPrice?: string;
  tax: number;
  type: string;
}

export interface RawOvhCatalogAddonFamily {
  name: string;
  exclusive: boolean;
  mandatory: boolean;
  default?: string;
  addons: string[];
}

export interface RawOvhCatalogPlan {
  planCode: string;
  invoiceName: string;
  product: string;
  pricingType: string;
  pricings: RawOvhCatalogPricing[];
  addonFamilies: RawOvhCatalogAddonFamily[];
  configurations: Array<{
    name: string;
    values: string[];
  }>;
  family: string | null;
  blobs?: {
    commercial?: {
      name?: string;
      features?: Array<{ name: string; value: string }>;
    };
    technical?: {
      name?: string;
      cpu?: {
        brand?: string;
        model?: string;
        cores?: number;
        frequency?: number;
      };
    };
  };
}

export interface RawOvhCatalogAddon {
  planCode: string;
  invoiceName: string;
  product: string;
  pricingType: string;
  pricings: RawOvhCatalogPricing[];
  addonFamilies: RawOvhCatalogAddonFamily[];
}

export interface RawOvhCatalog {
  catalogId: number;
  locale: {
    currencyCode: string;
    subsidiary: string;
    taxRate: number;
  };
  plans: RawOvhCatalogPlan[];
  addons: RawOvhCatalogAddon[];
}
