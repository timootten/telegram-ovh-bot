import type { AvailabilityStatus, DatacenterLocation } from "./types.js";

/**
 * OVH Datacenters metadata dictionary
 */
export const OVH_DATACENTERS: Record<string, DatacenterLocation> = {
  gra: {
    code: "gra",
    name: "Gravelines",
    city: "Gravelines",
    country: "France",
    countryCode: "FR",
    region: "Europe",
    flag: "🇫🇷",
  },
  rbx: {
    code: "rbx",
    name: "Roubaix",
    city: "Roubaix",
    country: "France",
    countryCode: "FR",
    region: "Europe",
    flag: "🇫🇷",
  },
  sbg: {
    code: "sbg",
    name: "Strasbourg",
    city: "Strasbourg",
    country: "France",
    countryCode: "FR",
    region: "Europe",
    flag: "🇫🇷",
  },
  par: {
    code: "par",
    name: "Paris",
    city: "Paris",
    country: "France",
    countryCode: "FR",
    region: "Europe",
    flag: "🇫🇷",
  },
  bhs: {
    code: "bhs",
    name: "Beauharnois",
    city: "Montreal",
    country: "Canada",
    countryCode: "CA",
    region: "North America",
    flag: "🇨🇦",
  },
  fra: {
    code: "fra",
    name: "Frankfurt",
    city: "Frankfurt",
    country: "Germany",
    countryCode: "DE",
    region: "Europe",
    flag: "🇩🇪",
  },
  lim: {
    code: "lim",
    name: "Limburg",
    city: "Limburg",
    country: "Germany",
    countryCode: "DE",
    region: "Europe",
    flag: "🇩🇪",
  },
  erf: {
    code: "erf",
    name: "Erfurt",
    city: "Erfurt",
    country: "Germany",
    countryCode: "DE",
    region: "Europe",
    flag: "🇩🇪",
  },
  lon: {
    code: "lon",
    name: "London",
    city: "London",
    country: "United Kingdom",
    countryCode: "GB",
    region: "Europe",
    flag: "🇬🇧",
  },
  waw: {
    code: "waw",
    name: "Warsaw",
    city: "Warsaw",
    country: "Poland",
    countryCode: "PL",
    region: "Europe",
    flag: "🇵🇱",
  },
  syd: {
    code: "syd",
    name: "Sydney",
    city: "Sydney",
    country: "Australia",
    countryCode: "AU",
    region: "Asia-Pacific",
    flag: "🇦🇺",
  },
  sgp: {
    code: "sgp",
    name: "Singapore",
    city: "Singapore",
    country: "Singapore",
    countryCode: "SG",
    region: "Asia-Pacific",
    flag: "🇸🇬",
  },
  mum: {
    code: "mum",
    name: "Mumbai",
    city: "Mumbai",
    country: "India",
    countryCode: "IN",
    region: "Asia-Pacific",
    flag: "🇮🇳",
  },
  ynm: {
    code: "ynm",
    name: "Mumbai (2)",
    city: "Mumbai",
    country: "India",
    countryCode: "IN",
    region: "Asia-Pacific",
    flag: "🇮🇳",
  },
  hil: {
    code: "hil",
    name: "Hillsboro",
    city: "Hillsboro (Oregon)",
    country: "United States",
    countryCode: "US",
    region: "North America",
    flag: "🇺🇸",
  },
  vin: {
    code: "vin",
    name: "Vint Hill",
    city: "Vint Hill (Virginia)",
    country: "United States",
    countryCode: "US",
    region: "North America",
    flag: "🇺🇸",
  },
};

/**
 * Get Datacenter location info from its code (e.g. "gra" -> Gravelines, France)
 */
export function getDatacenterLocation(code: string): DatacenterLocation {
  const normalized = code.toLowerCase().trim();
  if (OVH_DATACENTERS[normalized]) {
    return OVH_DATACENTERS[normalized];
  }
  if (normalized.startsWith("eu-west-par")) {
    return {
      code: normalized,
      name: "Paris",
      city: "Paris",
      country: "France",
      countryCode: "FR",
      region: "Europe",
      flag: "🇫🇷",
    };
  }
  if (normalized.startsWith("ca-east-tor")) {
    return {
      code: normalized,
      name: "Toronto",
      city: "Toronto",
      country: "Canada",
      countryCode: "CA",
      region: "North America",
      flag: "🇨🇦",
    };
  }
  return {
    code: normalized,
    name: normalized.toUpperCase(),
    city: normalized.toUpperCase(),
    country: "Unknown",
    countryCode: "XX",
    region: "Other",
    flag: "🌐",
  };
}

/**
 * Human-readable label for availability status
 */
export function getAvailabilityLabel(status: AvailabilityStatus): string {
  switch (status) {
    case "1H-high":
      return "In stock (~1h, High)";
    case "1H-low":
      return "In stock (~1h, Low)";
    case "72H":
      return "Available in 72h";
    case "comingSoon":
      return "Coming Soon";
    case "unavailable":
      return "Out of Stock";
    default:
      return "Unknown";
  }
}

/**
 * Check if a status represents available stock
 */
export function isStatusAvailable(status: string): boolean {
  return status === "1H-high" || status === "1H-low" || status === "72H";
}
