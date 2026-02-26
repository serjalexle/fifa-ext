import { clickBySelectors } from "../dom/click";
import { loadTransferMarketBatch, TRANSFER_MARKET_EVENT } from "../api/transferMarket";

type TransferTile = "market" | "list" | "targets";

const TRANSFER_TILE_SELECTORS: Record<TransferTile, readonly string[]> = {
  market: [
    ".tile.col-1-1.ut-tile-transfer-market",
    ".ut-tile-transfer-market",
  ],
  list: [
    ".tile.col-1-2.ut-tile-transfer-list.ut-tile-transfers",
    ".ut-tile-transfer-list.ut-tile-transfers",
    ".ut-tile-transfer-list",
  ],
  targets: [
    ".tile.col-1-2.ut-tile-transfer-targets.ut-tile-transfers",
    ".ut-tile-transfer-targets.ut-tile-transfers",
    ".ut-tile-transfer-targets",
  ],
} as const;

const waitForAnyTransferTile = async (timeoutMs: number) => {
  const start = Date.now();

  return new Promise<boolean>((resolve) => {
    const tick = () => {
      const found = Object.values(TRANSFER_TILE_SELECTORS).some((selectors) =>
        selectors.some((selector) => document.querySelector(selector)),
      );

      if (found) return resolve(true);
      if (Date.now() - start >= timeoutMs) return resolve(false);
      requestAnimationFrame(tick);
    };

    tick();
  });
};

export const processTransfersTiles = async () => {
  const ready = await waitForAnyTransferTile(7000);
  if (!ready) {
    console.warn("[FC Helper] Transfers tiles not found");
    return false;
  }

  const foundMarket = TRANSFER_TILE_SELECTORS.market.some((s) => !!document.querySelector(s));
  const foundList = TRANSFER_TILE_SELECTORS.list.some((s) => !!document.querySelector(s));
  const foundTargets = TRANSFER_TILE_SELECTORS.targets.some((s) => !!document.querySelector(s));

  console.info("[FC Helper] Transfers tiles:", {
    market: foundMarket,
    list: foundList,
    targets: foundTargets,
  });

  // Default flow: open Transfer Market after entering Transfers section.
  const opened = await clickBySelectors(TRANSFER_TILE_SELECTORS.market, { timeoutMs: 4000 });
  if (!opened) return false;

  try {
    window.dispatchEvent(
      new CustomEvent(TRANSFER_MARKET_EVENT, {
        detail: { status: "loading" },
      }),
    );

    const batch = await loadTransferMarketBatch(21);
    window.dispatchEvent(
      new CustomEvent(TRANSFER_MARKET_EVENT, {
        detail: { status: "success", total: batch.total, items: batch.items },
      }),
    );
    console.info("[FC Helper] Transfer Market loaded:", batch.total);
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent(TRANSFER_MARKET_EVENT, {
        detail: { status: "error", message: error instanceof Error ? error.message : String(error) },
      }),
    );
    console.warn("[FC Helper] Transfer Market fetch failed:", error);
  }

  return true;
};
