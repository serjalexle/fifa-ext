export type FCTab = "transfers" | "store" | "evo" | "sbc";
export type SiteTab = "home" | "squad" | "transfers" | "store" | "club" | "sbc" | "evo" | "settings" | "unknown";

export const TAB_SELECTORS: Record<FCTab, readonly string[]> = {
  transfers: [
    ".ut-tab-bar-item.icon-transfer",
    "button.ut-tab-bar-item.icon-transfer",
    "[class~='ut-tab-bar-item'][class*='icon-transfer']",
    ".icon-transfer",
  ],
  store: [
    ".ut-tab-bar-item.icon-store",
    "button.ut-tab-bar-item.icon-store",
    "[class~='ut-tab-bar-item'][class*='icon-store']",
    ".icon-store",
  ],
  evo: [
    ".ut-tab-bar-item.icon-evolution",
    "button.ut-tab-bar-item.icon-evolution",
    "[class~='ut-tab-bar-item'][class*='icon-evolution']",
    ".icon-evolution",
  ],
  sbc: [
    ".ut-tab-bar-item.icon-sbc",
    "button.ut-tab-bar-item.icon-sbc",
    "[class~='ut-tab-bar-item'][class*='icon-sbc']",
    ".icon-sbc",
  ],
} as const;

export const SITE_TAB_LABELS: Record<SiteTab, string> = {
  home: "Home",
  squad: "Squads",
  transfers: "Transfers",
  store: "Store",
  club: "Club",
  sbc: "SBC",
  evo: "Evolutions",
  settings: "Settings",
  unknown: "Unknown",
} as const;
