export type TransferStats = {
  list: number | null;
  targets: number | null;
};

const LIST_COUNT_SELECTOR = ".ut-tile-transfer-list .total-transfers-data .value";
const TARGETS_COUNT_SELECTOR = ".ut-tile-transfer-targets .total-transfers-data .value";

const parseCount = (text: string | null | undefined) => {
  if (!text) return null;
  const numeric = text.replace(/[^\d]/g, "");
  if (!numeric) return null;
  const value = Number.parseInt(numeric, 10);
  return Number.isFinite(value) ? value : null;
};

export const getTransferStats = (): TransferStats => {
  const listText = document.querySelector(LIST_COUNT_SELECTOR)?.textContent;
  const targetsText = document.querySelector(TARGETS_COUNT_SELECTOR)?.textContent;

  return {
    list: parseCount(listText),
    targets: parseCount(targetsText),
  };
};

export const subscribeTransferStats = (onChange: (stats: TransferStats) => void) => {
  let current = getTransferStats();
  onChange(current);

  let scheduled = false;
  const emitIfChanged = () => {
    scheduled = false;
    const next = getTransferStats();
    if (next.list === current.list && next.targets === current.targets) return;
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
      if (mutation.type === "characterData") {
        const parent = mutation.target.parentElement;
        if (parent?.matches(".total-transfers-data .value")) {
          scheduleEmit();
          return;
        }
      }

      if (mutation.type === "childList" || mutation.type === "attributes") {
        const target = mutation.target as Element;
        if (
          target.matches(".ut-tile-transfer-list, .ut-tile-transfer-targets, .total-transfers-data, .value") ||
          target.closest(".ut-tile-transfer-list, .ut-tile-transfer-targets")
        ) {
          scheduleEmit();
          return;
        }
      }
    }
  });

  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  return () => observer.disconnect();
};

