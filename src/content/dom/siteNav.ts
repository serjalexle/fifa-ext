import type { SiteTab } from "../storage/tabs";

const TAB_BAR_SELECTOR = ".ut-tab-bar";
const TAB_ITEM_SELECTOR = ".ut-tab-bar-item";
const SELECTED_TAB_ITEM_SELECTOR = ".ut-tab-bar-item.selected";

const TAB_CLASS_MAP: Array<{ className: string; tab: SiteTab }> = [
  { className: "icon-home", tab: "home" },
  { className: "icon-squad", tab: "squad" },
  { className: "icon-transfer", tab: "transfers" },
  { className: "icon-store", tab: "store" },
  { className: "icon-club", tab: "club" },
  { className: "icon-sbc", tab: "sbc" },
  { className: "icon-evolution", tab: "evo" },
  { className: "icon-settings", tab: "settings" },
];

const resolveTabFromElement = (el: Element | null): SiteTab => {
  if (!el) return "unknown";

  const hit = TAB_CLASS_MAP.find((m) => el.classList.contains(m.className));
  return hit?.tab ?? "unknown";
};

export const getActiveSiteTab = (): SiteTab => {
  const selected = document.querySelector(SELECTED_TAB_ITEM_SELECTOR);
  return resolveTabFromElement(selected);
};

export const subscribeActiveSiteTab = (onChange: (tab: SiteTab) => void) => {
  let current = getActiveSiteTab();
  onChange(current);

  let scheduled = false;
  const emitIfChanged = () => {
    scheduled = false;
    const next = getActiveSiteTab();
    if (next === current) return;
    current = next;
    onChange(next);
  };

  const scheduleEmit = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(emitIfChanged);
  };

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes") {
        const target = mutation.target as Element;
        if (target.matches(TAB_ITEM_SELECTOR) || target.matches(TAB_BAR_SELECTOR)) {
          scheduleEmit();
          return;
        }
      }

      if (mutation.type === "childList") {
        const target = mutation.target as Element;
        if (target.matches(TAB_BAR_SELECTOR) || target.closest(TAB_BAR_SELECTOR)) {
          scheduleEmit();
          return;
        }
      }
    }
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  return () => observer.disconnect();
};

