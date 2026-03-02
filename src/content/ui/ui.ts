import { ensureRoot } from "../dom/root";
import { subscribeActiveSiteTab } from "../dom/siteNav";
import {
  buildTeamChemLinksMap,
  ensureSbcBridgeReady,
  fetchChemistryProfiles,
  fetchAllClubPlayers,
  fetchKeyAttributes,
  fetchPlayerIcons,
  fetchPlayersMeta,
  fetchPlayersMetaMap,
  fetchSbcChallenges,
  putSbcChallengeSquad,
  fetchSbcSets,
  fetchStoragePile,
  fetchTeamChemLinks,
  fetchTeamConfig,
  fetchUserMassInfo,
  hasCapturedSbcAuthHeaders,
  waitForCapturedSbcAuthHeaders,
  type ChemistryProfilesResponse,
  type ClubPlayerItem,
  type KeyAttributesResponse,
  type PlayerIconEntry,
  type PlayerMeta,
  type PlayersMetaResponse,
  type SbcCategory,
  type SbcChallenge,
  type SbcChallengeSquadSlot,
  type SbcAward,
  type SbcSet,
  type StoragePileItem,
  type TeamConfigResponse,
  type UserMassInfoResponse,
} from "../api/sbcSets";
import { solveEconomySbcPlayers } from "../sbc/solver";
import type { SiteTab } from "../dom/siteNav";

// @ts-expect-error - TypeScript doesn't know about chrome.runtime.getURL
const WIDGET_ICON_URL = chrome.runtime.getURL("icons/icon-32.png");

type WidgetMode = "half" | "full" | "min";
type WidgetView = "home" | "detail";
type SyncState = "outdated" | "pending" | "synced";

type SyncCardMeta = {
  id: string;
  title: string;
  defaultExtra: string;
};

type SyncCard = {
  id: string;
  title: string;
  state: SyncState;
  stateLabel: string;
  lastUpdate: string;
  changes: number;
  extra: string;
};

type SyncCacheEntry = {
  state: SyncState;
  lastSuccessAt?: number;
  lastAttemptAt?: number;
  changes?: number;
  note?: string;
};

type SyncCacheStore = Partial<Record<string, SyncCacheEntry>>;
type SbcFilterKind = "all" | "favorites" | "category";

type SbcUiFilter = {
  key: string;
  label: string;
  kind: SbcFilterKind;
  categoryId?: number;
};

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
  },
  {
    id: "store-data",
    title: "Store Data",
    defaultExtra: "Store sync not started",
  },
  {
    id: "evolutions-data",
    title: "Evolutions",
    defaultExtra: "Evolution data not synced",
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
  };
};

const buildSyncCards = (cache: SyncCacheStore, nowMs = Date.now()): SyncCard[] =>
  SYNC_CARDS_META.map((meta) => resolveSyncCard(meta, cache[meta.id], nowMs));

const getCardById = (id: string | undefined, cards: SyncCard[]) =>
  cards.find((item) => item.id === id) ?? cards[0];

const getSyncStateClass = (state: SyncState) => `fc-helper-update-value--${state}`;

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
const SBC_FILTER_ALL_KEY = "all";
const SBC_FILTER_FAVORITES_KEY = "favorites";
const SBC_SQUAD_SLOT_COUNT = 23;
const SBC_FORCE_RELOAD_DELAY_MS = 350;
const EA_SBC_SET_IMAGE_BASE_URL =
  "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fut/sbc/companion/sets/images/";
const EA_PLAYER_PORTRAIT_BASE_URL =
  "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fut/items/images/mobile/portraits/";
const CLUB_ATTRIBUTE_LABELS = ["PAC", "SHO", "PAS", "DRI", "DEF", "PHY"];
const CLUB_GK_ATTRIBUTE_LABELS = ["DIV", "HAN", "KIC", "REF", "SPD", "POS"];

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

const resolveClubPlayerImageUrl = (player: ClubPlayerItem) => {
  const assetId = Number(player.assetId);
  if (Number.isFinite(assetId) && assetId > 0) {
    return `${EA_PLAYER_PORTRAIT_BASE_URL}${Math.trunc(assetId)}.png`;
  }
  if (player.guidAssetId && player.guidAssetId.trim().length > 0) {
    return `${EA_PLAYER_PORTRAIT_BASE_URL}${encodeURIComponent(player.guidAssetId)}.png`;
  }
  return "";
};

const resolveClubPlayerName = (player: ClubPlayerItem, playerMetaByAssetId: Map<number, PlayerMeta>) => {
  const assetId = Number(player.assetId);
  if (Number.isFinite(assetId) && assetId > 0) {
    const meta = playerMetaByAssetId.get(Math.trunc(assetId));
    if (meta) {
      const firstName = String(meta.f ?? "").trim();
      const lastName = String(meta.l ?? "").trim();
      const commonName = String(meta.c ?? "").trim();
      const fullName = `${firstName} ${lastName}`.trim();
      if (fullName.length > 0) return fullName;
      if (commonName.length > 0) return commonName;
    }
    return `Player ${Math.trunc(assetId)}`;
  }
  return "Unknown player";
};

const resolveClubAttributeLabels = (player: ClubPlayerItem) =>
  player.preferredPosition === "GK" ? CLUB_GK_ATTRIBUTE_LABELS : CLUB_ATTRIBUTE_LABELS;

const toSbcCategoryFilterKey = (categoryId: number) => `cat:${categoryId}`;

const normalizeFilterLabel = (value: string | undefined | null) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const isFavoriteSbcSet = (set: SbcSet) => Boolean(set.taggedByUser || ((set.tagged ?? 0) > 0));

const buildSbcUiFilters = (categories: SbcCategory[]): SbcUiFilter[] => [
  { key: SBC_FILTER_ALL_KEY, label: "Все", kind: "all" },
  { key: SBC_FILTER_FAVORITES_KEY, label: "Избранное", kind: "favorites" },
  ...categories.map((category) => ({
    key: toSbcCategoryFilterKey(category.categoryId),
    label: category.name,
    kind: "category" as const,
    categoryId: category.categoryId,
  })),
];

const flattenSbcSets = (categories: SbcCategory[]) =>
  categories.flatMap((category) => category.sets ?? []);

const getSbcSetsForFilter = (categories: SbcCategory[], filterKey: string): SbcSet[] => {
  if (filterKey === SBC_FILTER_ALL_KEY) return flattenSbcSets(categories);
  if (filterKey === SBC_FILTER_FAVORITES_KEY) return flattenSbcSets(categories).filter(isFavoriteSbcSet);
  if (filterKey.startsWith("cat:")) {
    const raw = filterKey.slice(4);
    const categoryId = Number.parseInt(raw, 10);
    if (!Number.isFinite(categoryId)) return [];
    const category = categories.find((item) => item.categoryId === categoryId);
    return category?.sets ?? [];
  }
  return [];
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

type SbcTaskActionState = {
  kind: "success" | "error";
  message: string;
};

const buildChallengeSquadPayload = (playerIds: number[]): SbcChallengeSquadSlot[] =>
  Array.from({ length: SBC_SQUAD_SLOT_COUNT }, (_, index) => ({
    index,
    itemData: {
      id: Number(playerIds[index] ?? 0),
      dream: false,
    },
  }));

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
  let clubPlayers: ClubPlayerItem[] = [];
  let playerMetaByAssetId = new Map<number, PlayerMeta>();
  let playersMetaPayload: PlayersMetaResponse | null = null;
  let keyAttributesPayload: KeyAttributesResponse | null = null;
  let playerIconsPayload: PlayerIconEntry[] = [];
  let teamConfigPayload: TeamConfigResponse | null = null;
  let chemistryProfilesPayload: ChemistryProfilesResponse | null = null;
  let teamChemLinksMap = new Map<number, Set<number>>();
  let userMassInfoPayload: UserMassInfoResponse | null = null;
  let storagePileItems: StoragePileItem[] = [];
  let sbcCategories: SbcCategory[] = [];
  let sbcSelectedFilterKey = SBC_FILTER_ALL_KEY;
  let flippedSbcSetIds = new Set<number>();
  let sbcChallengesBySetId = new Map<number, SbcChallenge[]>();
  let sbcChallengesLoading = new Set<number>();
  let sbcChallengesErrors = new Map<number, string>();
  let sbcChallengeFillPending = new Set<number>();
  let sbcChallengeFillStatus = new Map<number, SbcTaskActionState>();
  let warmupStarted = false;
  let isAuthWarmupInProgress = false;
  let isNationsTeamsSyncInProgress = false;
  let isClubSyncInProgress = false;
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
          <div class="fc-helper-data-browser is-hidden" id="fc-helper-detail-data-browser"></div>
          <div class="fc-helper-club-loading is-hidden" id="fc-helper-club-loading">
            <span class="fc-helper-spinner" aria-hidden="true"></span>
            <span class="fc-helper-loading-text">Updating My Club Players...</span>
          </div>
          <div class="fc-helper-club-browser is-hidden" id="fc-helper-club-browser">
            <div class="fc-helper-club-list" id="fc-helper-club-list"></div>
          </div>
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
  const detailDataBrowserNode = root.querySelector<HTMLElement>("#fc-helper-detail-data-browser");
  const clubLoadingNode = root.querySelector<HTMLElement>("#fc-helper-club-loading");
  const clubBrowserNode = root.querySelector<HTMLElement>("#fc-helper-club-browser");
  const clubListNode = root.querySelector<HTMLElement>("#fc-helper-club-list");
  const sbcLoadingNode = root.querySelector<HTMLElement>("#fc-helper-sbc-loading");
  const sbcBrowserNode = root.querySelector<HTMLElement>("#fc-helper-sbc-browser");
  const sbcTabsNode = root.querySelector<HTMLElement>("#fc-helper-sbc-tabs");
  const sbcSetsNode = root.querySelector<HTMLElement>("#fc-helper-sbc-sets");

  const renderClubPlayersBrowser = () => {
    if (!clubBrowserNode || !clubListNode) return;

    if (clubPlayers.length === 0) {
      clubListNode.innerHTML = `<div class="fc-helper-club-empty">No players loaded yet.</div>`;
      clubBrowserNode.classList.remove("is-hidden");
      return;
    }

    clubListNode.innerHTML = clubPlayers
      .map((player) => {
        const imageUrl = resolveClubPlayerImageUrl(player);
        const playerName = resolveClubPlayerName(player, playerMetaByAssetId);
        const rating = Number.isFinite(player.rating) ? String(Math.trunc(Number(player.rating))) : "--";
        const position = String(player.preferredPosition ?? "--");
        const possiblePositions = Array.isArray(player.possiblePositions)
          ? player.possiblePositions.filter((item) => typeof item === "string" && item.length > 0).join(", ")
          : "";
        const attributeLabels = resolveClubAttributeLabels(player);
        const attributes = Array.isArray(player.attributeArray) ? player.attributeArray : [];
        const attributesHtml = attributeLabels
          .map((label, idx) => {
            const raw = attributes[idx];
            const value = Number.isFinite(raw) ? String(Math.trunc(Number(raw))) : "--";
            return `
              <div class="fc-helper-club-attr">
                <span class="fc-helper-club-attr-label">${label}</span>
                <span class="fc-helper-club-attr-value">${value}</span>
              </div>
            `;
          })
          .join("");

        return `
          <article class="fc-helper-club-player-card">
            <div
              class="fc-helper-club-player-image${imageUrl ? "" : " is-fallback"}"
              role="img"
              aria-label="${escapeHtml(playerName)}"
              ${imageUrl ? `style="background-image:url('${imageUrl}')"` : ""}
            ></div>
            <div class="fc-helper-club-player-content">
              <div class="fc-helper-club-player-head">
                <div class="fc-helper-club-player-name">${escapeHtml(playerName)}</div>
                <div class="fc-helper-club-player-ovr">${escapeHtml(rating)}</div>
              </div>
              <div class="fc-helper-club-player-meta">
                <span>POS: ${escapeHtml(position)}</span>
                <span>ID: ${Number.isFinite(player.assetId) ? Math.trunc(Number(player.assetId)) : "--"}</span>
              </div>
              <div class="fc-helper-club-player-attrs">
                ${attributesHtml}
              </div>
              ${possiblePositions ? `<div class="fc-helper-club-player-positions">Alt: ${escapeHtml(possiblePositions)}</div>` : ""}
            </div>
          </article>
        `;
      })
      .join("");

    clubBrowserNode.classList.remove("is-hidden");
  };

  const renderDetailDataBrowser = (cardId: string) => {
    if (!detailDataBrowserNode) return;

    if (cardId === "all-players") {
      const playersCount = playersMetaPayload ? Object.keys(playersMetaPayload.players).length : 0;
      const attrKeysCount = playersMetaPayload?.attrKeys.length ?? 0;
      const keyAttrsCount = keyAttributesPayload?.playerList.length ?? 0;
      const iconsCount = playerIconsPayload.length;

      const sampleMetaRows = playersMetaPayload
        ? Object.entries(playersMetaPayload.players)
            .slice(0, 8)
            .map(([id, item]) => {
              const attrs = Array.isArray(item.a) ? item.a.slice(0, 6).join("/") : "--";
              const height = Number.isFinite(item.h) ? String(item.h) : "--";
              const weakFoot = Number.isFinite(item.w) ? String(item.w) : "--";
              const skillMoves = Number.isFinite(item.s) ? String(item.s) : "--";
              return `<div class="fc-helper-data-row"><span>#${escapeHtml(id)}</span><span>H ${escapeHtml(height)} | WF ${escapeHtml(weakFoot)} | SM ${escapeHtml(skillMoves)}</span><span>${escapeHtml(attrs)}</span></div>`;
            })
            .join("")
        : "";

      const sampleKeyAttrsRows = keyAttributesPayload
        ? keyAttributesPayload.playerList.slice(0, 8).map((item) => {
            const attrs = Array.isArray(item.keyAttributes) ? item.keyAttributes.join(", ") : "";
            return `<div class="fc-helper-data-row"><span>${escapeHtml(item.guid)}</span><span>${escapeHtml(attrs || "--")}</span></div>`;
          }).join("")
        : "";

      const sampleIconsRows = playerIconsPayload.length > 0
        ? playerIconsPayload.slice(0, 8).map((item) =>
            `<div class="fc-helper-data-row"><span>Player ${escapeHtml(String(item.playerId))}</span><span>Icon ${escapeHtml(String(item.iconId))}</span></div>`,
          ).join("")
        : "";

      if (playersCount === 0 && keyAttrsCount === 0 && iconsCount === 0) {
        detailDataBrowserNode.innerHTML = `<div class="fc-helper-data-empty">No synced data yet.</div>`;
      } else {
        detailDataBrowserNode.innerHTML = `
          <section class="fc-helper-data-section">
            <div class="fc-helper-data-section-title">Overview</div>
            <div class="fc-helper-data-row"><span>Players meta</span><span>${playersCount}</span></div>
            <div class="fc-helper-data-row"><span>Attribute keys</span><span>${attrKeysCount}</span></div>
            <div class="fc-helper-data-row"><span>Key attributes</span><span>${keyAttrsCount}</span></div>
            <div class="fc-helper-data-row"><span>Icon links</span><span>${iconsCount}</span></div>
          </section>
          <section class="fc-helper-data-section">
            <div class="fc-helper-data-section-title">Players Meta Sample</div>
            ${sampleMetaRows || '<div class="fc-helper-data-empty">No players meta sample.</div>'}
          </section>
          <section class="fc-helper-data-section">
            <div class="fc-helper-data-section-title">Key Attributes Sample</div>
            ${sampleKeyAttrsRows || '<div class="fc-helper-data-empty">No key attributes sample.</div>'}
          </section>
          <section class="fc-helper-data-section">
            <div class="fc-helper-data-section-title">Player Icons Sample</div>
            ${sampleIconsRows || '<div class="fc-helper-data-empty">No player icons sample.</div>'}
          </section>
        `;
      }

      detailDataBrowserNode.classList.remove("is-hidden");
      return;
    }

    if (cardId === "nations-teams") {
      const selectedYear = teamConfigPayload?.Years.find((item) => String(item.Year) === "2026") ?? teamConfigPayload?.Years[0];
      const nationsCount = selectedYear?.Nations.length ?? 0;
      const leaguesCount = selectedYear?.Leagues.length ?? 0;
      const teamsCount =
        (selectedYear?.Teams.length ?? 0) +
        (selectedYear?.ClubItemTeams?.length ?? 0) +
        (selectedYear?.LegendsTeams?.length ?? 0) +
        (selectedYear?.InternationalTeams?.length ?? 0);
      const chemLinksCount = teamChemLinksMap.size;
      const profilesCount = chemistryProfilesPayload?.profiles.length ?? 0;

      const leaguesRows = selectedYear
        ? selectedYear.Leagues.slice(0, 10).map((item) =>
            `<div class="fc-helper-data-row"><span>League ${escapeHtml(String(item.LeagueId))}</span><span>Nation ${escapeHtml(String(item.NationId))}</span></div>`,
          ).join("")
        : "";

      const profilesRows = chemistryProfilesPayload
        ? chemistryProfilesPayload.profiles.slice(0, 8).map((item) => {
            const rules = (item.rules ?? [])
              .map((rule) => `${rule.parameterType}:${rule.calculationType}:${rule.value}`)
              .join(" | ");
            return `<div class="fc-helper-data-row"><span>Profile ${escapeHtml(String(item.id))}</span><span>${escapeHtml(rules || "--")}</span></div>`;
          }).join("")
        : "";

      const linksRows = Array.from(teamChemLinksMap.entries()).slice(0, 8).map(([teamId, linked]) => {
        const linksText = Array.from(linked).slice(0, 5).join(", ");
        return `<div class="fc-helper-data-row"><span>Team ${escapeHtml(String(teamId))}</span><span>${escapeHtml(linksText || "--")}</span></div>`;
      }).join("");

      if (!teamConfigPayload && !chemistryProfilesPayload && teamChemLinksMap.size === 0) {
        detailDataBrowserNode.innerHTML = `<div class="fc-helper-data-empty">No synced data yet.</div>`;
      } else {
        detailDataBrowserNode.innerHTML = `
          <section class="fc-helper-data-section">
            <div class="fc-helper-data-section-title">Overview</div>
            <div class="fc-helper-data-row"><span>Nations</span><span>${nationsCount}</span></div>
            <div class="fc-helper-data-row"><span>Leagues</span><span>${leaguesCount}</span></div>
            <div class="fc-helper-data-row"><span>Teams total</span><span>${teamsCount}</span></div>
            <div class="fc-helper-data-row"><span>Team links map</span><span>${chemLinksCount}</span></div>
            <div class="fc-helper-data-row"><span>Chem profiles</span><span>${profilesCount}</span></div>
          </section>
          <section class="fc-helper-data-section">
            <div class="fc-helper-data-section-title">League - Nation Sample</div>
            ${leaguesRows || '<div class="fc-helper-data-empty">No leagues sample.</div>'}
          </section>
          <section class="fc-helper-data-section">
            <div class="fc-helper-data-section-title">Chem Profiles Sample</div>
            ${profilesRows || '<div class="fc-helper-data-empty">No profiles sample.</div>'}
          </section>
          <section class="fc-helper-data-section">
            <div class="fc-helper-data-section-title">Team Links Sample</div>
            ${linksRows || '<div class="fc-helper-data-empty">No links sample.</div>'}
          </section>
        `;
      }

      detailDataBrowserNode.classList.remove("is-hidden");
      return;
    }

    if (cardId === "store-data") {
      const configs = userMassInfoPayload?.settings?.configs ?? [];
      const errorsCount = Object.keys(userMassInfoPayload?.errors ?? {}).length;
      const storagePlayersCount = storagePileItems.filter((item) => item.itemType === "player").length;
      const uniqueItemTypes = new Set(storagePileItems.map((item) => String(item.itemType ?? "unknown")));
      const configRows = configs.slice(0, 20).map((item) => {
        const type = String(item.type ?? "--");
        const value = item.value === undefined ? "--" : String(item.value);
        return `<div class="fc-helper-data-row"><span>${escapeHtml(type)}</span><span>${escapeHtml(value)}</span></div>`;
      }).join("");
      const storageRows = storagePileItems.slice(0, 20).map((item) => {
        const type = String(item.itemType ?? "--");
        const rating = Number.isFinite(item.rating) ? String(Math.trunc(Number(item.rating))) : "--";
        const assetId = Number.isFinite(item.assetId) ? String(Math.trunc(Number(item.assetId))) : "--";
        const pile = Number.isFinite(item.pile) ? String(Math.trunc(Number(item.pile))) : "--";
        const untradeable = item.untradeable ? "UT" : "TR";
        return `<div class="fc-helper-data-row"><span>${escapeHtml(type)} | OVR ${escapeHtml(rating)}</span><span>${escapeHtml(`asset ${assetId} | pile ${pile} | ${untradeable}`)}</span></div>`;
      }).join("");

      if (!userMassInfoPayload && storagePileItems.length === 0) {
        detailDataBrowserNode.innerHTML = `<div class="fc-helper-data-empty">No synced data yet.</div>`;
      } else {
        detailDataBrowserNode.innerHTML = `
          <section class="fc-helper-data-section">
            <div class="fc-helper-data-section-title">Overview</div>
            <div class="fc-helper-data-row"><span>Storage items</span><span>${storagePileItems.length}</span></div>
            <div class="fc-helper-data-row"><span>Storage players</span><span>${storagePlayersCount}</span></div>
            <div class="fc-helper-data-row"><span>Storage item types</span><span>${uniqueItemTypes.size}</span></div>
            <div class="fc-helper-data-row"><span>Configs</span><span>${configs.length}</span></div>
            <div class="fc-helper-data-row"><span>Errors</span><span>${errorsCount}</span></div>
          </section>
          <section class="fc-helper-data-section">
            <div class="fc-helper-data-section-title">Config Sample</div>
            ${configRows || '<div class="fc-helper-data-empty">No config entries.</div>'}
          </section>
          <section class="fc-helper-data-section">
            <div class="fc-helper-data-section-title">Storage Sample</div>
            ${storageRows || '<div class="fc-helper-data-empty">No storage entries.</div>'}
          </section>
        `;
      }

      detailDataBrowserNode.classList.remove("is-hidden");
      return;
    }

    detailDataBrowserNode.innerHTML = "";
    detailDataBrowserNode.classList.add("is-hidden");
  };

  const renderSbcBrowser = () => {
    if (!sbcBrowserNode || !sbcTabsNode || !sbcSetsNode) return;

    if (sbcCategories.length === 0) {
      sbcBrowserNode.classList.add("is-hidden");
      sbcTabsNode.innerHTML = "";
      sbcSetsNode.innerHTML = "";
      flippedSbcSetIds = new Set<number>();
      return;
    }

    const uiFilters = buildSbcUiFilters(sbcCategories);
    if (!uiFilters.some((item) => item.key === sbcSelectedFilterKey)) {
      sbcSelectedFilterKey = SBC_FILTER_ALL_KEY;
    }

    sbcTabsNode.innerHTML = uiFilters
      .map((filter) => {
        const activeClass = filter.key === sbcSelectedFilterKey ? " is-active" : "";
        return `
          <button
            type="button"
            class="fc-helper-sbc-tab${activeClass}"
            data-sbc-filter-key="${escapeHtml(filter.key)}"
          >
            ${escapeHtml(filter.label)}
          </button>
        `;
      })
      .join("");

    const sets = getSbcSetsForFilter(sbcCategories, sbcSelectedFilterKey);

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
              const challengeId = Number(task.challengeId);
              const hasChallengeId = Number.isFinite(challengeId) && challengeId > 0;
              const fillPending = hasChallengeId && sbcChallengeFillPending.has(challengeId);
              const fillState = hasChallengeId ? sbcChallengeFillStatus.get(challengeId) : undefined;
              const fillStateClass =
                fillState?.kind === "success"
                  ? " is-success"
                  : fillState?.kind === "error"
                    ? " is-error"
                    : "";
              const fillLabel = fillPending ? "..." : fillState?.kind === "success" ? "ok" : fillState?.kind === "error" ? "!" : "+";
              const fillTitle = fillPending
                ? "Placing players into SBC grid..."
                : fillState?.message ?? "Place players into SBC grid";
              const fillIcon =
                !task.isStatus && hasChallengeId
                  ? `<button class="fc-helper-sbc-task-fill${fillPending ? " is-loading" : ""}${fillStateClass}" type="button" aria-label="Fill challenge" title="${escapeHtml(fillTitle)}" data-action="fill-challenge" data-set-id="${set.setId}" data-challenge-id="${challengeId}" ${fillPending ? "disabled" : ""}>${fillLabel}</button>`
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
        const captured = await waitForCapturedSbcAuthHeaders(AUTH_WARMUP_ATTEMPTS, AUTH_WARMUP_INTERVAL_MS);
        if (!captured) {
          console.warn("[FC Helper] EA auth headers are still not captured.");
        }
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

  const runAllPlayersPoolSync = async () => {
    setCardPending("all-players", "Synchronization in progress...");
    applyView();

    try {
      const [metaPayload, keyAttrsPayload, iconsPayload] = await Promise.all([
        fetchPlayersMeta(),
        fetchKeyAttributes(),
        fetchPlayerIcons(),
      ]);

      playersMetaPayload = metaPayload;
      keyAttributesPayload = keyAttrsPayload;
      playerIconsPayload = iconsPayload;

      const playersMetaCount = Object.keys(metaPayload.players).length;
      const keyAttributesCount = keyAttrsPayload.playerList.length;
      const iconsCount = iconsPayload.length;
      setCardSynced(
        "all-players",
        playersMetaCount,
        `Players meta: ${playersMetaCount}, Key attrs: ${keyAttributesCount}, Icon links: ${iconsCount}`,
      );
      applyView();
      console.info("[FC Helper] All Players payload:", {
        attrKeys: metaPayload.attrKeys.length,
        playersMeta: playersMetaCount,
        keyAttributes: keyAttributesCount,
        iconLinks: iconsCount,
      });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      setCardOutdated("all-players", `Sync failed: ${errorText.slice(0, 80)}`);
      console.warn("[FC Helper] All Players requests failed:", error);
    }
  };

  const runNationsTeamsSync = async () => {
    if (isNationsTeamsSyncInProgress) return;
    isNationsTeamsSyncInProgress = true;
    setCardPending("nations-teams", "Synchronization in progress...");
    applyView();

    try {
      const [configPayload, teamLinksPayload, profilesPayload] = await Promise.all([
        fetchTeamConfig(),
        fetchTeamChemLinks(),
        fetchChemistryProfiles(),
      ]);
      teamConfigPayload = configPayload;
      teamChemLinksMap = buildTeamChemLinksMap(teamLinksPayload.teamChemLinks);
      chemistryProfilesPayload = profilesPayload;

      const selectedYear = configPayload.Years.find((item) => String(item.Year) === "2026") ?? configPayload.Years[0];
      const nationsCount = selectedYear?.Nations?.length ?? 0;
      const leaguesCount = selectedYear?.Leagues?.length ?? 0;
      const teamsCount =
        (selectedYear?.Teams?.length ?? 0) +
        (selectedYear?.ClubItemTeams?.length ?? 0) +
        (selectedYear?.LegendsTeams?.length ?? 0) +
        (selectedYear?.InternationalTeams?.length ?? 0);
      const chemLinksCount = teamLinksPayload.teamChemLinks.length;
      const profilesCount = profilesPayload.profiles.length;

      setCardSynced(
        "nations-teams",
        chemLinksCount,
        `Nations: ${nationsCount}, Leagues: ${leaguesCount}, Teams: ${teamsCount}, Links: ${chemLinksCount}, Profiles: ${profilesCount}`,
      );
      applyView();
      console.info("[FC Helper] Nations & Teams payload:", {
        years: configPayload.Years.length,
        chemLinks: chemLinksCount,
        profiles: profilesCount,
        linkedTeams: teamChemLinksMap.size,
      });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      setCardOutdated("nations-teams", `Sync failed: ${errorText.slice(0, 80)}`);
      console.warn("[FC Helper] Nations & Teams requests failed:", error);
    } finally {
      isNationsTeamsSyncInProgress = false;
      applyView();
    }
  };

  const runUserMassInfoSync = async () => {
    setCardPending("store-data", "Synchronization in progress...");
    applyView();

    try {
      const [payload, storagePilePayload] = await Promise.all([
        fetchUserMassInfo(),
        fetchStoragePile(),
      ]);
      userMassInfoPayload = payload;
      storagePileItems = storagePilePayload.itemData;

      const configsCount = payload.settings?.configs?.length ?? 0;
      const errorsCount = Object.keys(payload.errors ?? {}).length;
      const storageItemsCount = storagePilePayload.itemData.length;
      setCardSynced(
        "store-data",
        storageItemsCount,
        `Storage items: ${storageItemsCount}, Configs: ${configsCount}, Errors: ${errorsCount}`,
      );
      applyView();
      console.info("[FC Helper] User mass info payload:", {
        configs: configsCount,
        errors: errorsCount,
        storageItems: storageItemsCount,
      });
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      setCardOutdated("store-data", `Sync failed: ${errorText.slice(0, 80)}`);
      console.warn("[FC Helper] User mass info request failed:", error);
    }
  };

  const runClubPlayersSync = async () => {
    if (isClubSyncInProgress) return;
    isClubSyncInProgress = true;
    clubPlayers = [];
    setCardPending("club-players", "Synchronization in progress...");
    applyView();

    try {
      const players = await fetchAllClubPlayers();
      clubPlayers = players;

      try {
        playerMetaByAssetId = await fetchPlayersMetaMap();
      } catch (error) {
        playerMetaByAssetId = new Map<number, PlayerMeta>();
        console.warn("[FC Helper] Players metadata request failed:", error);
      }

      setCardSynced(
        "club-players",
        players.length,
        `Loaded ${players.length} players from club`,
      );
      applyView();
      console.info("[FC Helper] Club players payload:", players);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      setCardOutdated("club-players", `Sync failed: ${errorText.slice(0, 80)}`);
      console.warn("[FC Helper] Club players request failed:", error);
    } finally {
      isClubSyncInProgress = false;
      applyView();
    }
  };

  const runSbcSync = async () => {
    if (isSbcSyncInProgress) return;
    isSbcSyncInProgress = true;
    sbcCategories = [];
    sbcSelectedFilterKey = SBC_FILTER_ALL_KEY;
    sbcChallengesBySetId = new Map<number, SbcChallenge[]>();
    sbcChallengesLoading = new Set<number>();
    sbcChallengesErrors = new Map<number, string>();
    sbcChallengeFillPending = new Set<number>();
    sbcChallengeFillStatus = new Map<number, SbcTaskActionState>();
    setCardPending("sbc-data", "Synchronization in progress...");
    applyView();

    try {
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, SBC_SYNC_DELAY_MS);
      });
      const payload = await fetchSbcSets();
      sbcCategories = normalizeSbcCategories(payload.categories);
      sbcSelectedFilterKey = SBC_FILTER_ALL_KEY;

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

  const placeChallengeSquad = async (challengeId: number, setId?: number) => {
    const normalizedChallengeId = Math.trunc(Number(challengeId));
    if (!Number.isFinite(normalizedChallengeId) || normalizedChallengeId <= 0) return;
    if (sbcChallengeFillPending.has(normalizedChallengeId)) return;

    sbcChallengeFillPending.add(normalizedChallengeId);
    sbcChallengeFillStatus.delete(normalizedChallengeId);
    applyView();

    try {
      if (clubPlayers.length === 0 && storagePileItems.length === 0) {
        throw new Error("No synced players available yet");
      }

      const normalizedSetId = Math.trunc(Number(setId ?? 0));
      const setChallenges = Number.isFinite(normalizedSetId)
        ? (sbcChallengesBySetId.get(normalizedSetId) ?? [])
        : [];
      const challenge = setChallenges.find(
        (item) => Math.trunc(Number(item.challengeId ?? 0)) === normalizedChallengeId,
      );

      const solved = solveEconomySbcPlayers({
        challenge,
        clubPlayers,
        storagePlayers: storagePileItems,
      });
      if (solved.playerIds.length === 0) {
        throw new Error("Could not build any SBC squad from available players");
      }

      const payload = buildChallengeSquadPayload(solved.playerIds);
      await putSbcChallengeSquad(normalizedChallengeId, payload);
      sbcChallengeFillStatus.set(normalizedChallengeId, {
        kind: "success",
        message: `${solved.summary}. Confirm manually on EA side.`,
      });
      window.setTimeout(() => {
        window.location.reload();
      }, SBC_FORCE_RELOAD_DELAY_MS);
    } catch (error) {
      const errorText = error instanceof Error ? error.message : String(error);
      sbcChallengeFillStatus.set(normalizedChallengeId, {
        kind: "error",
        message: `Failed: ${errorText.slice(0, 90)}`,
      });
    } finally {
      sbcChallengeFillPending.delete(normalizedChallengeId);
      applyView();
    }
  };

  const getRefreshTasks = () => [
    {
      id: "sbc-data",
      run: runSbcSync,
    },
    {
      id: "club-players",
      run: runClubPlayersSync,
    },
    {
      id: "all-players",
      run: runAllPlayersPoolSync,
    },
    {
      id: "nations-teams",
      run: runNationsTeamsSync,
    },
    {
      id: "store-data",
      run: runUserMassInfoSync,
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
    const supportsDataBrowser =
      activeCard.id === "all-players" || activeCard.id === "nations-teams" || activeCard.id === "store-data";
    if (isDetailView && supportsDataBrowser) {
      renderDetailDataBrowser(activeCard.id);
    } else if (detailDataBrowserNode) {
      detailDataBrowserNode.classList.add("is-hidden");
      detailDataBrowserNode.innerHTML = "";
    }
    const isClubCard = activeCard.id === "club-players";
    if (clubLoadingNode) {
      clubLoadingNode.classList.toggle("is-hidden", !(isDetailView && isClubCard && isClubSyncInProgress));
    }
    if (clubBrowserNode) {
      clubBrowserNode.classList.toggle(
        "is-hidden",
        !(isDetailView && isClubCard && !isClubSyncInProgress),
      );
    }
    if (isDetailView && isClubCard && !isClubSyncInProgress) {
      renderClubPlayersBrowser();
    }

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

    const highlightedCardId = widgetView === "detail" ? selectedCardId : null;
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
    });
  });

  if (sbcTabsNode) {
    sbcTabsNode.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const button = target.closest<HTMLButtonElement>(".fc-helper-sbc-tab");
      if (!button) return;

      const filterKey = button.dataset.sbcFilterKey;
      if (!filterKey) return;
      sbcSelectedFilterKey = filterKey;
      renderSbcBrowser();
    });
  }

  if (sbcSetsNode) {
    sbcSetsNode.addEventListener("click", (event) => {
      const target = event.target as HTMLElement;
      const fillButton = target.closest<HTMLButtonElement>(".fc-helper-sbc-task-fill");
      if (fillButton) {
        const challengeIdRaw = fillButton.dataset.challengeId;
        const setIdRaw = fillButton.dataset.setId;
        const challengeId = Number.parseInt(String(challengeIdRaw ?? ""), 10);
        const setId = Number.parseInt(String(setIdRaw ?? ""), 10);
        if (Number.isFinite(challengeId)) {
          void placeChallengeSquad(challengeId, Number.isFinite(setId) ? setId : undefined);
        }
        return;
      }

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

