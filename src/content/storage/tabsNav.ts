import { clickBySelectors } from "../dom/click";
import { FCTab, TAB_SELECTORS } from "./tabs";
import { processTransfersTiles } from "./transfersTiles";

export const goToTab = async (tab: FCTab) => {
  const opened = await clickBySelectors(TAB_SELECTORS[tab], { timeoutMs: 7000 });
  if (!opened) return false;

  if (tab === "transfers") {
    await processTransfersTiles();
  }

  return true;
};
