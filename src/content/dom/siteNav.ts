export type SiteTab =
  | "home"
  | "squad"
  | "transfers"
  | "store"
  | "club"
  | "sbc"
  | "evo"
  | "settings"
  | "unknown";

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
  const hit = TAB_CLASS_MAP.find((item) => el.classList.contains(item.className));
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

  const observer = new MutationObserver(() => {
    scheduleEmit();
  });

  observer.observe(document.body ?? document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  return () => observer.disconnect();
};

