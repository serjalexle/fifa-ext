import { clickBySelectors } from "../dom/click";
import { FCTab, TAB_SELECTORS } from "./tabs";

export const goToTab = async (tab: FCTab) => {
  return clickBySelectors(TAB_SELECTORS[tab], { timeoutMs: 7000 });
};
