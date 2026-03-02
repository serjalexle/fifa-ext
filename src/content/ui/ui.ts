import { ensureRoot } from "../dom/root";
import { subscribeActiveSiteTab } from "../dom/siteNav";
import {
  ensureSbcBridgeReady,
  fetchSbcChallenges,
  fetchSbcSets,
  hasCapturedSbcAuthHeaders,
  waitForCapturedSbcAuthHeaders,
  type SbcCategory,
  type SbcChallenge,
  type SbcAward,
  type SbcSet,
} from "../api/sbcSets";
import { goToTab } from "../storage/tabsNav";
import type { SiteTab } from "../dom/siteNav";
import type { FCTab } from "../storage/tabs";

// @ts-expect-error - TypeScript doesn't know about chrome.runtime.getURL
const WIDGET_ICON_URL = chrome.runtime.getURL("icons/icon-32.png");

type WidgetMode = "half" | "full" | "min";
type WidgetView = "home" | "detail";
type SyncState = "outdated" | "pending" | "synced";

type SyncCardMeta = {
  id: string;
  title: string;
  defaultExtra: string;
  openTab?: FCTab;
};

type SyncCard = {
  id: string;
  title: string;
  state: SyncState;
  stateLabel: string;
  lastUpdate: string;
  changes: number;
  extra: string;
  openTab?: FCTab;
};

type SyncCacheEntry = {
  state: SyncState;
  lastSuccessAt?: number;
  lastAttemptAt?: number;
  changes?: number;
  note?: string;
};

type SyncCacheStore = Partial<Record<string, SyncCacheEntry>>;

const SITE_TAB_LABELS: Record<SiteTab, string> = {
  home: "Home",
  squad: "Squad",
  transfers: "Transfers",
  store: "Store",
  club: "Club",
  sbc: "SBC",
  evo: "Evolutions",
  settings: "Settings",
  unknown: "Loading...",
};

const SYNC_CACHE_KEY = "fc-helper-sync-cache-v1";
const SYNC_STALE_AFTER_MS = 10 * 60 * 1000;
const SYNC_PENDING_STALE_AFTER_MS = 2 * 60 * 1000;

const SYNC_TIME_FORMATTER = new Intl.DateTimeFormat("uk-UA", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  day: "2-digit",
  month: "2-digit",
});

const SYNC_CARDS_META: SyncCardMeta[] = [
  {
    id: "all-players",
    title: "All Players Pool",
    defaultExtra: "Catalog index awaiting first sync",
    openTab: "transfers",
  },
  {
    id: "club-players",
    title: "My Club Players",
    defaultExtra: "Club roster snapshot missing",
  },
  {
    id: "nations-teams",
    title: "Nations & Teams",
    defaultExtra: "Metadata package not synced",
  },
  {
    id: "sbc-data",
    title: "SBC Data",
    defaultExtra: "No SBC sync session yet",
    openTab: "sbc",
  },
  {
    id: "store-data",
    title: "Store Data",
    defaultExtra: "Store sync not started",
    openTab: "store",
  },
  {
    id: "evolutions-data",
    title: "Evolutions",
    defaultExtra: "Evolution data not synced",
    openTab: "evo",
  },
];

const loadSyncCache = (): SyncCacheStore => {
  try {
    const raw = window.localStorage.getItem(SYNC_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as SyncCacheStore;
  } catch {
    return {};
  }
};

const saveSyncCache = (cache: SyncCacheStore) => {
  try {
    window.localStorage.setItem(SYNC_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage failures (private mode / blocked storage).
  }
};

const getCardMetaById = (id: string | undefined) =>
  SYNC_CARDS_META.find((item) => item.id === id) ?? SYNC_CARDS_META[0];

const formatSyncTime = (timestampMs: number | undefined) => {
  if (!timestampMs) return "Not synced yet";
  return SYNC_TIME_FORMATTER.format(new Date(timestampMs));
};

const resolveSyncCard = (meta: SyncCardMeta, cacheEntry: SyncCacheEntry | undefined, nowMs: number): SyncCard => {
  const lastSuccessAt = cacheEntry?.lastSuccessAt;
  const lastAttemptAt = cacheEntry?.lastAttemptAt;
  const changes = cacheEntry?.changes ?? 0;
  const staleSynced = Boolean(lastSuccessAt && nowMs - lastSuccessAt > SYNC_STALE_AFTER_MS);
  const stalePending = Boolean(lastAttemptAt && nowMs - lastAttemptAt > SYNC_PENDING_STALE_AFTER_MS);
  const effectiveState =
    cacheEntry?.state === "pending" && stalePending
      ? "outdated"
      : cacheEntry?.state === "synced" && staleSynced
        ? "outdated"
        : (cacheEntry?.state ?? "outdated");

  const stateLabel =
    effectiveState === "pending"
      ? "Syncing..."
      : effectiveState === "synced"
        ? "Synced"
        : "Outdated";

  const lastUpdate =
    effectiveState === "pending" && !lastSuccessAt
      ? "Sync in progress"
      : formatSyncTime(lastSuccessAt);

  const extra =
    effectiveState === "pending"
      ? "Synchronization in progress..."
      : cacheEntry?.note ?? meta.defaultExtra;

  return {
    id: meta.id,
    title: meta.title,
    state: effectiveState,
    stateLabel,
    lastUpdate,
    changes,
    extra,
    openTab: meta.openTab,
  };
};

const buildSyncCards = (cache: SyncCacheStore, nowMs = Date.now()): SyncCard[] =>
  SYNC_CARDS_META.map((meta) => resolveSyncCard(meta, cache[meta.id], nowMs));

const getCardById = (id: string | undefined, cards: SyncCard[]) =>
  cards.find((item) => item.id === id) ?? cards[0];

const getSyncStateClass = (state: SyncState) => `fc-helper-update-value--${state}`;
const getCardIdForSiteTab = (tab: SiteTab): string | null => {
  if (tab === "transfers") return "all-players";
  if (tab === "store") return "store-data";
  if (tab === "evo") return "evolutions-data";
  if (tab === "sbc") return "sbc-data";
  if (tab === "club") return "club-players";
  return null;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const normalizeSbcCategories = (categories: SbcCategory[]) =>
  categories
    .map((category) => ({
      ...category,
      sets: [...(category.sets ?? [])].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)),
    }))
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

const AUTH_WARMUP_ATTEMPTS = 14;
const AUTH_WARMUP_INTERVAL_MS = 500;
const SBC_SYNC_DELAY_MS = 2_000;
const EA_SBC_SET_IMAGE_BASE_URL =
  "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fut/sbc/companion/sets/images/";
const EA_PLAYER_PORTRAIT_BASE_URL =
  "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fut/items/images/mobile/portraits/";

const END_DATETIME_FORMATTER = new Intl.DateTimeFormat("uk-UA", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const resolveEndDateTime = (rawEndTime: number | undefined) => {
  if (!Number.isFinite(rawEndTime)) return "Unknown";
  const endTime = Number(rawEndTime);
  // EA payload can provide either absolute unix time or relative seconds left.
  const endTimestampMs = endTime > 2_000_000_000 ? endTime * 1000 : Date.now() + endTime * 1000;
  return END_DATETIME_FORMATTER.format(new Date(endTimestampMs));
};

const resolveRepeatableLabel = (set: SbcSet) => {
  if (!set.repeatable) return "Single";
  const timesCompleted = Math.max(0, set.timesCompleted ?? 0);
  if (set.repeatabilityMode === "UNLIMITED") return "Repeatable (left: infinite)";
  if (!Number.isFinite(set.repeats)) return "Repeatable (left: ?)";
  const repeats = Math.max(0, set.repeats ?? 0);
  const left = Math.max(0, repeats - timesCompleted);
  return `Repeatable (left: ${left})`;
};

const resolveSetImageUrl = (setImageId: string | undefined) => {
  if (!setImageId) return "";
  return `${EA_SBC_SET_IMAGE_BASE_URL}sbc_set_image_${encodeURIComponent(setImageId)}.png`;
};

const resolveRewardImageUrl = (set: SbcSet) => {
  const assetId = set.awards?.[0]?.itemData?.assetId;
  if (Number.isFinite(assetId) && Number(assetId) > 0) {
    return `${EA_PLAYER_PORTRAIT_BASE_URL}${Math.trunc(Number(assetId))}.png`;
  }
  const guidAssetId = set.awards?.[0]?.itemData?.guidAssetId;
  if (!guidAssetId) return "";
  return `${EA_PLAYER_PORTRAIT_BASE_URL}${encodeURIComponent(guidAssetId)}.png`;
};

type SbcTaskCard = {
  title: string;
  description?: string;
  endTime?: string;
  rewards?: string[];
  reqTooltip?: string;
  challengeId?: number;
  isStatus?: boolean;
};

const formatSbcAward = (award: SbcAward) => {
  const type = String(award.type ?? "reward");
  const value = Number.isFinite(award.value) ? ` ${award.value}` : "";
  const count = Number.isFinite(award.count) ? ` x${award.count}` : "";
  const untradeable = award.isUntradeable ? " (UT)" : "";
  return `${type}${value}${count}${untradeable}`.trim();
};

const formatSbcChallengeRewards = (awards?: SbcAward[]) => {
  if (!Array.isArray(awards) || awards.length === 0) return [];
  return awards.map((award) => formatSbcAward(award)).filter((text) => text.length > 0);
};

const formatSbcRequirementsTooltip = (
  elgReq?: Array<Record<string, unknown>>,
  elgOperation?: string,
) => {
  if (!Array.isArray(elgReq) || elgReq.length === 0) return "";
  const grouped = new Map<string, string[]>();
  for (const [idx, req] of elgReq.entries()) {
    const bag = req as Record<string, unknown>;
    const type = String(bag.type ?? `REQ ${idx + 1}`);
    const slotRaw = bag.eligibilitySlot;
    const slot = Number.isFinite(slotRaw) ? `Slot ${Number(slotRaw)}` : "General";
    const key = bag.eligibilityKey;
    const value = bag.eligibilityValue;
    const parts: string[] = [];
    if (key !== undefined) parts.push(`key ${key}`);
    if (value !== undefined) parts.push(`value ${value}`);
    const line = `${type}${parts.length > 0 ? ` (${parts.join(", ")})` : ""}`;
    const bucket = grouped.get(slot) ?? [];
    bucket.push(line);
    grouped.set(slot, bucket);
  }

  const lines: string[] = [];
  if (elgOperation) {
    lines.push(`Operation: ${elgOperation}`);
    lines.push("");
  }

  for (const [slot, items] of grouped.entries()) {
    lines.push(`${slot}:`);
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines.join("\n");
};

const buildSbcTaskCards = (
  set: SbcSet,
  challenges: SbcChallenge[] | undefined,
  isLoading: boolean,
  errorText?: string,
): SbcTaskCard[] => {
  if (isLoading) return [{ title: "Loading tasks...", isStatus: true }];
  if (errorText) return [{ title: `Failed to load tasks: ${errorText}`, isStatus: true }];
  if (challenges && challenges.length > 0) {
    return challenges.map((challenge, idx) => {
      const titleRaw = challenge.name ?? challenge.description ?? `Task ${idx + 1}`;
      const title = typeof titleRaw === "string" && titleRaw.trim().length > 0 ? titleRaw.trim() : `Task ${idx + 1}`;
      const description =
        typeof challenge.description === "string" && challenge.description.trim().length > 0
          ? challenge.description.trim()
          : undefined;
      const endTime = resolveEndDateTime(challenge.endTime);
      return {
        title,
        description,
        endTime,
        rewards: formatSbcChallengeRewards(challenge.awards),
        reqTooltip: formatSbcRequirementsTooltip(challenge.elgReq, challenge.elgOperation),
        challengeId: challenge.challengeId,
      };
    });
  }

  const count = Math.max(0, set.challengesCount ?? 0);
  return Array.from({ length: count }, (_, idx) => ({
    title: `Task ${idx + 1}`,
  }));
};

export const renderUI = () => {
  const root = ensureRoot() as HTMLElement;
  let syncCache = loadSyncCache();
  let currentMode: WidgetMode = "half";
  let widgetView: WidgetView = "home";
  let currentSiteTab: SiteTab = "unknown";
  let selectedCardId = "sbc-data";
  let sbcCategories: SbcCategory[] = [];
  let sbcSelectedCategoryId: number | null = null;
  let flippedSbcSetIds = new Set<number>();
  let sbcChallengesBySetId = new Map<number, SbcChallenge[]>();
  let sbcChallengesLoading = new Set<number>();
  let sbcChallengesErrors = new Map<number, string>();
  let warmupStarted = false;
  let isAuthWarmupInProgress = false;
  let isSbcSyncInProgress = false;
  let isRefreshInProgress = false;
  let hasInitialRefreshTriggered = false;
  let wasReady = false;

  const applyMode = (nextMode: WidgetMode) => {
    currentMode = nextMode;
    root.classList.toggle("fc-helper--minimized", nextMode === "min");
    root.classList.toggle("fc-helper--full", nextMode === "full");
  };

  const getSyncCardsSnapshot = () => buildSyncCards(syncCache);
  const persistSyncCache = () => saveSyncCache(syncCache);
  const setCardPending = (cardId: string, note: string) => {
    const previous = syncCache[cardId] ?? { state: "outdated" as const };
    syncCache = {
      ...syncCache,
      [cardId]: {
        ...previous,
        state: "pending",
        lastAttemptAt: Date.now(),
        note,
      },
    };
    persistSyncCache();
    applyView();
  };
  const setCardSynced = (cardId: string, changes: number, note: string) => {
    const previous = syncCache[cardId] ?? { state: "outdated" as const };
    syncCache = {
      ...syncCache,
      [cardId]: {
        ...previous,
        state: "synced",
        lastSuccessAt: Date.now(),
        lastAttemptAt: Date.now(),
        changes,
        note,
      },
    };
    persistSyncCache();
    applyView();
  };
  const setCardOutdated = (cardId: string, note: string) => {
    const previous = syncCache[cardId] ?? { state: "outdated" as const };
    syncCache = {
      ...syncCache,
      [cardId]: {
        ...previous,
        state: "outdated",
        lastAttemptAt: Date.now(),
        note,
      },
    };
    persistSyncCache();
    applyView();
  };

  const initialSyncCards = getSyncCardsSnapshot();

  root.innerHTML = `
    <div class="fc-helper-body">
      <div class="fc-helper-header">
        <div class="fc-helper-brand">
          <div class="fc-helper-brand-icon-wrap">
            <img class="fc-helper-brand-icon" src="${WIDGET_ICON_URL}" alt="FC Helper icon" />
          </div>
          <span class="fc-helper-brand-text" id="fc-helper-header-title">FC HELPER | HOME</span>
        </div>
        <div class="fc-helper-controls is-hidden" id="fc-helper-controls">
          <button class="fc-helper-control-btn" type="button" data-action="minimize" data-tooltip="Minimize" aria-label="Minimize" disabled>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 9h10" /></svg>
          </button>
          <button class="fc-helper-control-btn" type="button" data-action="half" data-tooltip="Half" aria-label="Half" disabled>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5h9v9h-9z" /></svg>
          </button>
          <button class="fc-helper-control-btn" type="button" data-action="full" data-tooltip="Full screen" aria-label="Full screen" disabled>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 3.5H3.5V6" />
              <path d="M10 3.5h2.5V6" />
              <path d="M6 12.5H3.5V10" />
              <path d="M10 12.5h2.5V10" />
            </svg>
          </button>
          <button class="fc-helper-control-btn" type="button" data-action="reload" data-tooltip="Reload data" aria-label="Reload data" disabled>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.5 6V3.5H10" /><path d="M12.5 3.5A5 5 0 1 0 13.2 9" /></svg>
          </button>
        </div>
      </div>
      <div class="fc-helper-content" id="fc-helper-content">
        <div class="fc-helper-loading" id="fc-helper-loading">
          <span class="fc-helper-spinner" aria-hidden="true"></span>
          <span class="fc-helper-loading-text">Loading page, please wait</span>
        </div>
        <div class="fc-helper-subnav is-hidden" id="fc-helper-subnav">
          <button class="fc-helper-back-link is-disabled" type="button" id="fc-helper-back-home">
            <svg class="fc-helper-back-link-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M9.5 3.5L5 8l4.5 4.5" />
            </svg>
            <span>Back to home</span>
          </button>
          <div class="fc-helper-subnav-update" id="fc-helper-detail-last-update">
            <svg class="fc-helper-subnav-update-icon" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M8 4.5V8l2.5 1.5" />
              <circle cx="8" cy="8" r="5.5" />
            </svg>
            <span class="fc-helper-subnav-update-content">
              <span class="fc-helper-update-label">Last update:</span>
              <span class="fc-helper-update-value fc-helper-update-value--outdated" id="fc-helper-detail-last-update-value">Not synced yet</span>
            </span>
          </div>
        </div>
        <div class="fc-helper-home-view is-hidden" id="fc-helper-home-view">
          <div class="fc-helper-sync" id="fc-helper-sync">
            ${initialSyncCards.map((item) => `
              <button
                type="button"
                class="fc-helper-sync-card fc-helper-sync-card--button"
                data-sync-id="${item.id}"
                data-sync-tab="${item.openTab ?? ""}"
              >
                <div class="fc-helper-sync-top">
                  <div class="fc-helper-sync-title">${item.title}</div>
                  <span class="fc-helper-sync-badge ${item.changes > 0 ? "" : "is-hidden"}" data-sync-role="badge" title="${item.changes} updates">${item.changes}</span>
                </div>
                <div class="fc-helper-sync-state fc-helper-sync-state--${item.state}" data-sync-role="state">
                  <span class="fc-helper-sync-dot" aria-hidden="true"></span>
                  <span data-sync-role="state-label">${item.stateLabel}</span>
                </div>
                <div class="fc-helper-sync-time">
                  <span class="fc-helper-update-label">Last update:</span>
                  <span class="fc-helper-update-value ${getSyncStateClass(item.state)}" data-sync-role="last-update">${item.lastUpdate}</span>
                </div>
                <div class="fc-helper-sync-extra" data-sync-role="extra">${item.extra}</div>
              </button>
            `).join("")}
          </div>
        </div>
        <div class="fc-helper-detail-view is-hidden" id="fc-helper-detail-view">
          <div class="fc-helper-detail-title" id="fc-helper-detail-title">Detail</div>
          <div class="fc-helper-detail-state fc-helper-sync-state fc-helper-sync-state--outdated" id="fc-helper-detail-state">
            <span class="fc-helper-sync-dot" aria-hidden="true"></span>
            Outdated
          </div>
          <div class="fc-helper-detail-time" id="fc-helper-detail-time">
            <span class="fc-helper-update-label">Last update:</span>
            <span class="fc-helper-update-value fc-helper-update-value--outdated" id="fc-helper-detail-time-value">Not synced yet</span>
          </div>
          <div class="fc-helper-detail-extra" id="fc-helper-detail-extra">No details yet</div>
          <div class="fc-helper-sbc-loading is-hidden" id="fc-helper-sbc-loading">
            <span class="fc-helper-spinner" aria-hidden="true"></span>
            <span class="fc-helper-loading-text">Updating SBC data...</span>
          </div>
          <div class="fc-helper-sbc-browser is-hidden" id="fc-helper-sbc-browser">
            <div class="fc-helper-sbc-tabs" id="fc-helper-sbc-tabs"></div>
            <div class="fc-helper-sbc-sets" id="fc-helper-sbc-sets"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  const controlsNode = root.querySelector<HTMLElement>("#fc-helper-controls");
  const headerNode = root.querySelector<HTMLElement>(".fc-helper-header");
  const controlButtons = root.querySelectorAll<HTMLButtonElement>(".fc-helper-control-btn");
  const loadingNode = root.querySelector<HTMLElement>("#fc-helper-loading");
  const subnavNode = root.querySelector<HTMLElement>("#fc-helper-subnav");
  const headerTitleNode = root.querySelector<HTMLElement>("#fc-helper-header-title");
  const homeViewNode = root.querySelector<HTMLElement>("#fc-helper-home-view");
  const detailViewNode = root.querySelector<HTMLElement>("#fc-helper-detail-view");
  const backHomeButton = root.querySelector<HTMLButtonElement>("#fc-helper-back-home");
  const detailUpdateValueNode = root.querySelector<HTMLElement>("#fc-helper-detail-last-update-value");
  const detailTitleNode = root.querySelector<HTMLElement>("#fc-helper-detail-title");
  const detailStateNode = root.querySelector<HTMLElement>("#fc-helper-detail-state");
  const detailTimeValueNode = root.querySelector<HTMLElement>("#fc-helper-detail-time-value");
  const detailExtraNode = root.querySelector<HTMLElement>("#fc-helper-detail-extra");
  const sbcLoadingNode = root.querySelector<HTMLElement>("#fc-helper-sbc-loading");
  const sbcBrowserNode = root.querySelector<HTMLElement>("#fc-helper-sbc-browser");
  const sbcTabsNode = root.querySelector<HTMLElement>("#fc-helper-sbc-tabs");
  const sbcSetsNode = root.querySelector<HTMLElement>("#fc-helper-sbc-sets");

  const renderSbcBrowser = () => {
    if (!sbcBrowserNode || !sbcTabsNode || !sbcSetsNode) return;

    if (sbcCategories.length === 0) {
      sbcBrowserNode.classList.add("is-hidden");
      sbcTabsNode.innerHTML = "";
      sbcSetsNode.innerHTML = "";
      flippedSbcSetIds = new Set<number>();
      return;
    }

    if (sbcSelectedCategoryId === null || !sbcCategories.some((cat) => cat.categoryId === sbcSelectedCategoryId)) {
      sbcSelectedCategoryId = sbcCategories[0].categoryId;
    }

    sbcTabsNode.innerHTML = sbcCategories
      .map((category) => {
        const activeClass = category.categoryId === sbcSelectedCategoryId ? " is-active" : "";
        return `
          <button
            type="button"
            class="fc-helper-sbc-tab${activeClass}"
            data-sbc-category-id="${category.categoryId}"
          >
            ${escapeHtml(category.name)}
          </button>
        `;
      })
      .join("");

    const activeCategory = sbcCategories.find((cat) => cat.categoryId === sbcSelectedCategoryId) ?? sbcCategories[0];
    const sets = activeCategory.sets ?? [];

    if (sets.length === 0) {
      sbcSetsNode.innerHTML = `<div class="fc-helper-sbc-empty">No SBC sets in this category.</div>`;
    } else {
      sbcSetsNode.innerHTML = sets
        .map((set: SbcSet) => {
          const isFlipped = flippedSbcSetIds.has(set.setId);
          const completed = Math.max(0, set.challengesCompletedCount ?? 0);
          const totalChallenges = Math.max(0, set.challengesCount ?? 0);
          const challenges = sbcChallengesBySetId.get(set.setId);
          const isChallengesLoading = sbcChallengesLoading.has(set.setId);
          const challengesError = sbcChallengesErrors.get(set.setId);
          const totalTasksLabel = challenges?.length ?? totalChallenges;
          const safeTotal = Math.max(1, totalTasksLabel);
          const progressPct = clampNumber(Math.round((completed / safeTotal) * 100), 0, 100);
          const repeatable = resolveRepeatableLabel(set);
          const timesCompleted = Math.max(0, set.timesCompleted ?? 0);
          const endDateTime = resolveEndDateTime(set.endTime);
          const description = set.description ? escapeHtml(set.description) : "No description";
          const setImageUrl = resolveSetImageUrl(set.setImageId);
          const rewardImageUrl = resolveRewardImageUrl(set);
          const rewardType = String(set.awards?.[0]?.type ?? "reward").slice(0, 3).toUpperCase();
          const taskCards = buildSbcTaskCards(set, challenges, isChallengesLoading, challengesError);
          const showTaskCompletion = !isChallengesLoading && !challengesError;
          const taskItems = taskCards
            .map((task, idx) => {
              const done = showTaskCompletion && idx < completed && !task.isStatus;
              const cardClass = `fc-helper-sbc-task-card${done ? " is-done" : ""}${task.isStatus ? " is-status" : ""}`;
              const description = task.description
                ? `<div class="fc-helper-sbc-task-desc">${escapeHtml(task.description)}</div>`
                : "";
              const endTime = task.endTime ? `<span>Ends: ${escapeHtml(task.endTime)}</span>` : "";
              const rewards =
                task.rewards && task.rewards.length > 0
                  ? `<span>Reward: ${escapeHtml(task.rewards.join(", "))}</span>`
                  : "";
              const meta =
                endTime || rewards
                  ? `<div class="fc-helper-sbc-task-meta">${endTime}${endTime && rewards ? " " : ""}${rewards}</div>`
                  : "";
              const reqTooltip = task.reqTooltip
                ? `<span class="fc-helper-sbc-task-req" role="img" aria-label="Requirements" data-tooltip="${escapeHtml(task.reqTooltip)}">i</span>`
                : "";
              const fillIcon =
                !task.isStatus && Number.isFinite(task.challengeId)
                  ? `<span class="fc-helper-sbc-task-fill" role="img" aria-label="Fill challenge" data-action="fill-challenge" data-set-id="${set.setId}" data-challenge-id="${task.challengeId}">+</span>`
                  : "";
              const actions =
                reqTooltip || fillIcon
                  ? `<div class="fc-helper-sbc-task-actions">${reqTooltip}${fillIcon}</div>`
                  : "";
              return `
                <li class="${cardClass}">
                  <div class="fc-helper-sbc-task-header">
                    <div class="fc-helper-sbc-task-name">${escapeHtml(task.title)}</div>
                    ${actions}
                  </div>
                  ${description}
                  ${meta}
                </li>
              `;
            })
            .join("");

          return `
            <article class="fc-helper-sbc-set-card${isFlipped ? " is-flipped" : ""}" data-set-id="${set.setId}">
              <div class="fc-helper-sbc-set-card-inner">
                <div class="fc-helper-sbc-set-face fc-helper-sbc-set-face--front">
                  <div class="fc-helper-sbc-set-header">
                    <div class="fc-helper-sbc-set-images">
                      <div
                        class="fc-helper-sbc-set-image"
                        role="img"
                        aria-label="${escapeHtml(set.name)}"
                        style="background-image:url('${setImageUrl}')"
                      ></div>
                      <div
                        class="fc-helper-sbc-reward-image${rewardImageUrl ? "" : " is-fallback"}"
                        role="img"
                        aria-label="Reward image"
                        ${rewardImageUrl ? `style="background-image:url('${rewardImageUrl}')"` : ""}
                      >
                        ${rewardImageUrl ? "" : `<span>${escapeHtml(rewardType)}</span>`}
                      </div>
                    </div>
                    <div class="fc-helper-sbc-set-heading">
                      <div class="fc-helper-sbc-set-name">${escapeHtml(set.name)}</div>
                      <div class="fc-helper-sbc-set-meta">${repeatable}</div>
                    </div>
                  </div>
                  <div class="fc-helper-sbc-set-stats">
                    <span>Times completed: ${timesCompleted}</span>
                    <span>End datetime: ${endDateTime}</span>
                  </div>
                  <div class="fc-helper-sbc-set-desc">${description}</div>
                  <button class="fc-helper-sbc-flip-btn" type="button" data-action="show-tasks" data-set-id="${set.setId}">
                    Show tasks
                  </button>
                  <div class="fc-helper-sbc-progress-block">
                    <div class="fc-helper-sbc-progress-meta">
                      <span>Challenges progress</span>
                      <span>${completed}/${totalTasksLabel}</span>
                    </div>
                    <div class="fc-helper-sbc-progress" aria-hidden="true">
                      <span style="width:${progressPct}%"></span>
                    </div>
                  </div>
                </div>
                <div class="fc-helper-sbc-set-face fc-helper-sbc-set-face--back">
                  <div class="fc-helper-sbc-task-title">Tasks (${totalTasksLabel})</div>
                  <ul class="fc-helper-sbc-task-list">
                    ${taskItems || '<li class="fc-helper-sbc-task-item"><span class="fc-helper-sbc-task-dot"></span><span>No tasks found</span></li>'}
                  </ul>
                  <button class="fc-helper-sbc-flip-btn is-back" type="button" data-action="hide-tasks" data-set-id="${set.setId}">
                    Back
                  </button>
                </div>
              </div>
            </article>
          `;
        })
        .join("");
    }

    sbcBrowserNode.classList.remove("is-hidden");
  };

  const runAuthWarmupDuringLoading = async () => {
    isAuthWarmupInProgress = true;
    applyView();

    try {
      await ensureSbcBridgeReady();
      const alreadyCaptured = await hasCapturedSbcAuthHeaders();

      if (!alreadyCaptured) {
        await goToTab("evo");
        const captured = await waitForCapturedSbcAuthHeaders(AUTH_WARMUP_ATTEMPTS, AUTH_WARMUP_INTERVAL_MS);
        if (!captured) {
          console.warn("[FC Helper] EA auth headers are still not captured after warmup attempt.");
        }
        await goToTab("home");
      }
    } catch (error) {
      console.warn("[FC Helper] Failed to run auth warmup flow:", error);
    } finally {
      isAuthWarmupInProgress = false;
      applyView();
    }
  };

  const maybeStartAuthWarmup = () => {
    if (warmupStarted || currentSiteTab !== "unknown") return;
    warmupStarted = true;
    void runAuthWarmupDuringLoading();
  };

  const runSbcSync = async () => {
    if (isSbcSyncInProgress) return;
    isSbcSyncInProgress = true;
    sbcCategories = [];
    sbcSelectedCategoryId = null;
    sbcChallengesBySetId = new Map<number, SbcChallenge[]>();
    sbcChallengesLoading = new Set<number>();
    sbcChallengesErrors = new Map<number, string>();
    setCardPending("sbc-data", "Synchronization in progress...");
    applyView();

    try {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, SBC_SYNC_DELAY_MS);
      });
      const payload = await fetchSbcSets();
      sbcCategories = normalizeSbcCategories(payload.categories);
      sbcSelectedCategoryId = sbcCategories[0]?.categoryId ?? null;

      const totalSets = sbcCategories.reduce((sum, category) => sum + (category.sets?.length ?? 0), 0);
      setCardSynced(
        "sbc-data",
        totalSets,
        `Loaded ${sbcCategories.length} categories and ${totalSets} sets`,
      );
      applyView();
      console.info("[FC Helper] SBC sets payload:", payload);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      setCardOutdated("sbc-data", `Sync failed: ${errorText.slice(0, 80)}`);
      console.warn("[FC Helper] SBC sets request failed:", error);
    } finally {
      isSbcSyncInProgress = false;
      applyView();
    }
  };

  const getRefreshTasks = () => [
    {
      id: "sbc-data",
      run: runSbcSync,
    },
  ];

  const runRefreshQueue = async (source: "initial" | "manual") => {
    if (isRefreshInProgress) return;
    isRefreshInProgress = true;
    try {
      const tasks = getRefreshTasks();
      for (const task of tasks) {
        await task.run();
      }
    } finally {
      isRefreshInProgress = false;
      if (source === "initial") {
        hasInitialRefreshTriggered = true;
      }
    }
  };

  const applyView = () => {
    const isKnown = currentSiteTab !== "unknown";
    const isReady = isKnown && !isAuthWarmupInProgress;
    const isDetailView = isReady && widgetView === "detail";
    const syncCards = getSyncCardsSnapshot();
    const cardById = new Map(syncCards.map((item) => [item.id, item]));
    const activeCard = getCardById(selectedCardId, syncCards);
    root.classList.toggle("fc-helper--ready", isReady);

    if (loadingNode) loadingNode.classList.toggle("is-hidden", isReady);
    if (subnavNode) subnavNode.classList.toggle("is-hidden", !isDetailView);
    if (homeViewNode) homeViewNode.classList.toggle("is-hidden", !isReady || isDetailView);
    if (detailViewNode) detailViewNode.classList.toggle("is-hidden", !isDetailView);

    if (controlsNode) controlsNode.classList.toggle("is-hidden", !isReady);
    controlButtons.forEach((btn) => {
      btn.disabled = !isReady;
    });

    if (backHomeButton) {
      const disableBack = !isDetailView;
      backHomeButton.disabled = disableBack;
      backHomeButton.classList.toggle("is-disabled", disableBack);
    }

    if (headerTitleNode) {
      const pageName =
        isReady && isDetailView
          ? activeCard.title.toUpperCase()
          : (SITE_TAB_LABELS[currentSiteTab] ?? "Loading...").toUpperCase();
      headerTitleNode.textContent = `FC HELPER | ${pageName}`;
    }

    if (detailUpdateValueNode) {
      detailUpdateValueNode.textContent = activeCard.lastUpdate;
      detailUpdateValueNode.className = `fc-helper-update-value ${getSyncStateClass(activeCard.state)}`;
    }
    if (detailTitleNode) detailTitleNode.textContent = activeCard.title;
    if (detailStateNode) {
      detailStateNode.className = `fc-helper-detail-state fc-helper-sync-state fc-helper-sync-state--${activeCard.state}`;
      detailStateNode.innerHTML = `<span class="fc-helper-sync-dot" aria-hidden="true"></span> ${activeCard.stateLabel}`;
    }
    if (detailTimeValueNode) {
      detailTimeValueNode.textContent = activeCard.lastUpdate;
      detailTimeValueNode.className = `fc-helper-update-value ${getSyncStateClass(activeCard.state)}`;
    }
    if (detailExtraNode) detailExtraNode.textContent = activeCard.extra;
    const isSbcCard = activeCard.id === "sbc-data";
    if (sbcLoadingNode) sbcLoadingNode.classList.toggle("is-hidden", !(isDetailView && isSbcCard && isSbcSyncInProgress));
    if (sbcBrowserNode) {
      sbcBrowserNode.classList.toggle(
        "is-hidden",
        !(isDetailView && isSbcCard && !isSbcSyncInProgress && sbcCategories.length > 0),
      );
    }
    if (isDetailView && isSbcCard && !isSbcSyncInProgress && sbcCategories.length > 0) {
      renderSbcBrowser();
    }

    const siteCardId = getCardIdForSiteTab(currentSiteTab);
    const highlightedCardId = widgetView === "detail" ? selectedCardId : siteCardId;
    root.querySelectorAll<HTMLButtonElement>(".fc-helper-sync-card--button").forEach((cardButton) => {
      const cardId = cardButton.dataset.syncId ?? "";
      const card = cardById.get(cardId);
      if (card) {
        const stateNode = cardButton.querySelector<HTMLElement>("[data-sync-role='state']");
        const stateLabelNode = cardButton.querySelector<HTMLElement>("[data-sync-role='state-label']");
        const lastUpdateNode = cardButton.querySelector<HTMLElement>("[data-sync-role='last-update']");
        const extraNode = cardButton.querySelector<HTMLElement>("[data-sync-role='extra']");
        const badgeNode = cardButton.querySelector<HTMLElement>("[data-sync-role='badge']");

        if (stateNode) {
          stateNode.className = `fc-helper-sync-state fc-helper-sync-state--${card.state}`;
        }
        if (stateLabelNode) {
          stateLabelNode.textContent = card.stateLabel;
        }
        if (lastUpdateNode) {
          lastUpdateNode.textContent = card.lastUpdate;
          lastUpdateNode.className = `fc-helper-update-value ${getSyncStateClass(card.state)}`;
        }
        if (extraNode) {
          extraNode.textContent = card.extra;
        }
        if (badgeNode) {
          badgeNode.textContent = String(card.changes);
          badgeNode.classList.toggle("is-hidden", card.changes <= 0);
          badgeNode.title = `${card.changes} updates`;
        }
      }

      cardButton.classList.toggle(
        "is-active",
        highlightedCardId !== null && cardButton.dataset.syncId === highlightedCardId,
      );
    });

    if (isReady && !wasReady && !hasInitialRefreshTriggered) {
      void runRefreshQueue("initial");
    }
    wasReady = isReady;
  };

  applyMode("half");
  applyView();
  maybeStartAuthWarmup();
  const staleStatusTimer = window.setInterval(() => {
    if (!root.isConnected) {
      window.clearInterval(staleStatusTimer);
      return;
    }
    applyView();
  }, 30_000);

  root.querySelectorAll<HTMLButtonElement>(".fc-helper-control-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "minimize") {
        applyMode("min");
        return;
      }
      if (action === "half") {
        applyMode("half");
        return;
      }
      if (action === "full") {
        applyMode("full");
        return;
      }
      if (action === "reload") {
        void runRefreshQueue("manual");
      }
    });
  });

  if (headerNode) {
    headerNode.addEventListener("dblclick", () => {
      applyMode(currentMode === "min" ? "full" : "min");
    });
  }

  root.querySelectorAll<HTMLButtonElement>(".fc-helper-sync-card--button").forEach((cardButton) => {
    cardButton.addEventListener("click", () => {
      const cardId = cardButton.dataset.syncId;
      const card = getCardById(cardId, getSyncCardsSnapshot());
      selectedCardId = card.id;
      widgetView = "detail";
      applyView();

      if (card.openTab) {
        void goToTab(card.openTab);
      }
    });
  });

  if (sbcTabsNode) {
    sbcTabsNode.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>(".fc-helper-sbc-tab");
      if (!button) return;

      const rawId = button.dataset.sbcCategoryId;
      if (!rawId) return;
      const categoryId = Number.parseInt(rawId, 10);
      if (!Number.isFinite(categoryId)) return;

      sbcSelectedCategoryId = categoryId;
      renderSbcBrowser();
    });
  }

  if (sbcSetsNode) {
    sbcSetsNode.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>(".fc-helper-sbc-flip-btn");
      if (!button) return;
      const cardNode = button.closest<HTMLElement>(".fc-helper-sbc-set-card");
      if (!cardNode) return;

      const rawSetId = button.dataset.setId;
      if (!rawSetId) return;
      const setId = Number.parseInt(rawSetId, 10);
      if (!Number.isFinite(setId)) return;

      const action = button.dataset.action;
      if (action === "show-tasks") {
        flippedSbcSetIds.add(setId);
        cardNode.classList.add("is-flipped");
        if (!sbcChallengesBySetId.has(setId) && !sbcChallengesLoading.has(setId)) {
          sbcChallengesLoading.add(setId);
          sbcChallengesErrors.delete(setId);
          applyView();
          void (async () => {
            try {
              const challenges = await fetchSbcChallenges(setId);
              sbcChallengesBySetId.set(setId, challenges);
            } catch (error) {
              const errorText = error instanceof Error ? error.message : String(error);
              sbcChallengesErrors.set(setId, errorText.slice(0, 80));
            } finally {
              sbcChallengesLoading.delete(setId);
              applyView();
            }
          })();
        }
        return;
      }
      if (action === "hide-tasks") {
        flippedSbcSetIds.delete(setId);
        cardNode.classList.remove("is-flipped");
      }
    });
  }

  if (backHomeButton) {
    backHomeButton.addEventListener("click", () => {
      if (backHomeButton.disabled) return;
      widgetView = "home";
      applyView();
    });
  }

  subscribeActiveSiteTab((siteTab) => {
    currentSiteTab = siteTab;
    maybeStartAuthWarmup();
    applyView();
  });
};
