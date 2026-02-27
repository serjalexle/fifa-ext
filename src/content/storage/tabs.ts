export type FCTab = "home" | "transfers" | "store" | "evo" | "sbc";

export const TAB_SELECTORS: Record<FCTab, readonly string[]> = {
  home: [
    ".ut-tab-bar-item.icon-home",
    "button.ut-tab-bar-item.icon-home",
    "[class~='ut-tab-bar-item'][class*='icon-home']",
    ".icon-home",
  ],
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
