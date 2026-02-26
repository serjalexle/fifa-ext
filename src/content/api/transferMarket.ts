const EA_TRANSFER_MARKET_URL = "https://utas.mob.v5.prd.futc-ext.gcp.ea.com/ut/game/fc26/transfermarket";
const EA_CLUB_URL = "https://utas.mob.v5.prd.futc-ext.gcp.ea.com/ut/game/fc26/club";
const EA_USER_MASS_INFO_URL = "https://utas.mob.v5.prd.futc-ext.gcp.ea.com/ut/game/fc26/usermassinfo";
const EA_PLAYERS_CATALOG_FALLBACK_URL =
  "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fut/items/web/players.json";
const POST_MESSAGE_SOURCE = "fc-helper-transfer-market";
const REQUEST_MESSAGE_SOURCE = "fc-helper-transfer-market-request";
const BRIDGE_SCRIPT_ID = "fc-helper-transfer-market-bridge";
const BRIDGE_SCRIPT_FILE = "transferMarketBridge.js";
const DEFAULT_PAGE_SIZE = 21;
const MAX_RETRIES_PER_PAGE = 3;
const CLUB_PAGE_SIZE = 100;
const CLUB_REQUEST_DELAY_MS = 250;
const CLUB_DEFAULT_MAX_PAGES = 20;
export const TRANSFER_MARKET_EVENT = "fc-helper:transfer-market-data";

export type TransferMarketRequestParams = {
  num?: number;
  start?: number;
  type?: string;
  lev?: string | number;
};

export type TransferMarketAuction = {
  tradeId?: number;
  buyNowPrice?: number;
  currentBid?: number;
  expires?: number;
  itemData?: {
    assetId?: number;
    rating?: number;
    preferredPosition?: string;
    resourceId?: number;
    firstName?: string;
    lastName?: string;
    commonName?: string;
    name?: string;
  };
};

export type ClubPlayerItem = {
  id?: number;
  assetId?: number;
  resourceId?: number;
  rating?: number;
  preferredPosition?: string;
  itemType?: string;
  rareflag?: number;
  teamid?: number;
  leagueId?: number;
  nation?: number;
  firstName?: string;
  lastName?: string;
  commonName?: string;
  name?: string;
};

type PlayersCatalogEntry = {
  id?: number;
  f?: string;
  l?: string;
  r?: number;
};

export type ClubPlayerResolved = ClubPlayerItem & {
  displayName: string;
  catalogRating?: number;
};

export type UserMassInfoResponse = Record<string, unknown>;

type PageFetchOkMessage = {
  source: typeof POST_MESSAGE_SOURCE;
  key: string;
  ok: true;
  status: number;
  payload: unknown;
};

type PageFetchErrorMessage = {
  source: typeof POST_MESSAGE_SOURCE;
  key: string;
  ok: false;
  status?: number;
  error: string;
};

type PageFetchMessage = PageFetchOkMessage | PageFetchErrorMessage;

let bridgeLoadPromise: Promise<void> | null = null;
let consecutiveBridgeFailures = 0;
let bridgeCooldownUntil = 0;
let playersCatalogCache: Map<number, PlayersCatalogEntry> | null = null;
let playersCatalogPromise: Promise<Map<number, PlayersCatalogEntry>> | null = null;

const makeRequestKey = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const buildPlayersCatalogUrl = () => {
  const path = window.location.pathname;
  const match = path.match(/\/content\/([^/]+)\/(\d{4})\//);
  if (!match) return EA_PLAYERS_CATALOG_FALLBACK_URL;

  const [, contentHash, season] = match;
  return `https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/${contentHash}/${season}/fut/items/web/players.json`;
};

const buildTransferMarketUrl = (params: TransferMarketRequestParams) => {
  const url = new URL(EA_TRANSFER_MARKET_URL);

  if (typeof params.num === "number") url.searchParams.set("num", String(params.num));
  if (typeof params.start === "number") url.searchParams.set("start", String(params.start));
  if (typeof params.type === "string" && params.type.length > 0) url.searchParams.set("type", params.type);
  if (params.lev !== undefined && params.lev !== null && String(params.lev).length > 0) {
    url.searchParams.set("lev", String(params.lev));
  }

  return url.toString();
};

const buildClubPlayersUrl = (start: number, count: number) => {
  const url = new URL(EA_CLUB_URL);
  url.searchParams.set("start", String(start));
  url.searchParams.set("count", String(count));
  url.searchParams.set("type", "player");
  return url.toString();
};

const ensureBridgeScriptInjected = () => {
  if (document.getElementById(BRIDGE_SCRIPT_ID)) return Promise.resolve();
  if (bridgeLoadPromise) return bridgeLoadPromise;

  bridgeLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = BRIDGE_SCRIPT_ID;
    script.type = "text/javascript";
    script.async = false;
    script.src = chrome.runtime.getURL(BRIDGE_SCRIPT_FILE);
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("[FC Helper] failed to load transfer market bridge script"));

    (document.documentElement || document.head || document.body).appendChild(script);
  });

  return bridgeLoadPromise;
};

const fetchViaBridge = async (url: string) => {
  if (Date.now() < bridgeCooldownUntil) {
    throw new Error("[FC Helper] bridge cooldown is active after repeated failures");
  }

  await ensureBridgeScriptInjected();

  return new Promise<unknown>((resolve, reject) => {
    const key = makeRequestKey();

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;

      const data = event.data as PageFetchMessage | undefined;
      if (!data || data.source !== POST_MESSAGE_SOURCE || data.key !== key) return;

      window.removeEventListener("message", onMessage);

      if (!data.ok) {
        consecutiveBridgeFailures += 1;
        if (consecutiveBridgeFailures >= 3) {
          bridgeCooldownUntil = Date.now() + 60_000;
          consecutiveBridgeFailures = 0;
        }
        reject(
          new Error(
            `[FC Helper] transfer market request failed (${data.status ?? "network"}): ${data.error}`,
          ),
        );
        return;
      }

      consecutiveBridgeFailures = 0;
      resolve(data.payload);
    };

    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        source: REQUEST_MESSAGE_SOURCE,
        key,
        url,
      },
      window.origin,
    );
  });
};

export const fetchTransferMarket = async (params: TransferMarketRequestParams = {}) =>
  fetchViaBridge(buildTransferMarketUrl(params));

export const fetchUserMassInfo = async (): Promise<UserMassInfoResponse> => {
  for (let attempt = 1; attempt <= MAX_RETRIES_PER_PAGE; attempt += 1) {
    try {
      const payload = await fetchViaBridge(EA_USER_MASS_INFO_URL);
      if (!payload || typeof payload !== "object") {
        throw new Error("[FC Helper] usermassinfo payload is invalid");
      }
      return payload as UserMassInfoResponse;
    } catch (error) {
      if (attempt >= MAX_RETRIES_PER_PAGE) throw error;
    }
  }

  throw new Error("[FC Helper] usermassinfo request failed");
};

const extractTransferItems = (payload: unknown): TransferMarketAuction[] => {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const bag = payload as Record<string, unknown>;

  if (Array.isArray(bag.auctionInfo)) return bag.auctionInfo as TransferMarketAuction[];
  if (Array.isArray(bag.items)) return bag.items as TransferMarketAuction[];
  if (Array.isArray(bag.result)) return bag.result as TransferMarketAuction[];

  return [];
};

const fetchTransferMarketPageWithRetry = async (
  params: TransferMarketRequestParams,
  attempt = 1,
): Promise<unknown> => {
  try {
    return await fetchTransferMarket(params);
  } catch (error) {
    if (attempt >= MAX_RETRIES_PER_PAGE) throw error;
    return fetchTransferMarketPageWithRetry(params, attempt + 1);
  }
};

export const loadTransferMarketBatch = async (
  totalCount: number,
  baseParams: Omit<TransferMarketRequestParams, "start" | "num"> = {},
) => {
  const targetCount = Math.max(0, totalCount || DEFAULT_PAGE_SIZE);
  const items: TransferMarketAuction[] = [];

  let start = 0;
  while (items.length < targetCount) {
    const pageSize = Math.min(DEFAULT_PAGE_SIZE, targetCount - items.length);
    const payload = await fetchTransferMarketPageWithRetry({
      ...baseParams,
      start,
      num: pageSize,
    });
    const pageItems = extractTransferItems(payload);

    if (pageItems.length === 0) break;

    items.push(...pageItems);
    start += DEFAULT_PAGE_SIZE;
  }

  return {
    total: items.length,
    items,
  };
};

const extractClubPlayers = (payload: unknown): ClubPlayerItem[] => {
  if (!payload || typeof payload !== "object") return [];
  const bag = payload as Record<string, unknown>;

  if (Array.isArray(bag.itemData)) return bag.itemData as ClubPlayerItem[];
  if (Array.isArray(bag.items)) return bag.items as ClubPlayerItem[];
  if (Array.isArray(bag.result)) return bag.result as ClubPlayerItem[];
  if (Array.isArray(payload)) return payload as ClubPlayerItem[];

  return [];
};

const fetchClubPlayersPageWithRetry = async (start: number, count: number, attempt = 1): Promise<unknown> => {
  try {
    return await fetchViaBridge(buildClubPlayersUrl(start, count));
  } catch (error) {
    if (attempt >= MAX_RETRIES_PER_PAGE) throw error;
    return fetchClubPlayersPageWithRetry(start, count, attempt + 1);
  }
};

const loadPlayersCatalog = async () => {
  if (playersCatalogCache) return playersCatalogCache;
  if (playersCatalogPromise) return playersCatalogPromise;

  playersCatalogPromise = (async () => {
    const url = `${buildPlayersCatalogUrl()}?_=${Date.now()}`;
    const response = await fetch(url, { method: "GET", credentials: "include" });
    if (!response.ok) {
      throw new Error(`[FC Helper] players catalog request failed (${response.status})`);
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) {
      throw new Error("[FC Helper] players catalog payload is not an array");
    }

    const map = new Map<number, PlayersCatalogEntry>();
    for (const row of payload) {
      if (!row || typeof row !== "object") continue;
      const entry = row as PlayersCatalogEntry;
      if (typeof entry.id !== "number") continue;
      map.set(entry.id, entry);
    }

    playersCatalogCache = map;
    return map;
  })();

  try {
    return await playersCatalogPromise;
  } finally {
    playersCatalogPromise = null;
  }
};

const pickDisplayName = (player: ClubPlayerItem, catalogEntry?: PlayersCatalogEntry) => {
  const localName = player.name?.trim() || player.commonName?.trim();
  if (localName) return localName;

  const localFull = `${player.firstName ?? ""} ${player.lastName ?? ""}`.trim();
  if (localFull) return localFull;

  const catalogFull = `${catalogEntry?.f ?? ""} ${catalogEntry?.l ?? ""}`.trim();
  if (catalogFull) return catalogFull;

  return `Player #${player.resourceId ?? player.assetId ?? "?"}`;
};

const enrichClubPlayers = async (players: ClubPlayerItem[]) => {
  const catalog = await loadPlayersCatalog();

  const resolved: ClubPlayerResolved[] = players.map((player) => {
    const playerKey = player.resourceId ?? player.assetId;
    const catalogEntry = typeof playerKey === "number" ? catalog.get(playerKey) : undefined;

    return {
      ...player,
      displayName: pickDisplayName(player, catalogEntry),
      catalogRating: catalogEntry?.r,
    };
  });

  return resolved;
};

export const loadAllClubPlayers = async (options: { enrich?: boolean; maxPages?: number } = {}) => {
  const enrich = options.enrich ?? true;
  const maxPages = Math.max(1, options.maxPages ?? CLUB_DEFAULT_MAX_PAGES);
  const players: ClubPlayerItem[] = [];
  let start = 0;
  let page = 0;

  for (;;) {
    if (page >= maxPages) break;
    const payload = await fetchClubPlayersPageWithRetry(start, CLUB_PAGE_SIZE);
    const pagePlayers = extractClubPlayers(payload).filter((p) => p.itemType === "player" || !p.itemType);
    if (pagePlayers.length === 0) break;

    players.push(...pagePlayers);
    if (pagePlayers.length < CLUB_PAGE_SIZE) break;
    start += CLUB_PAGE_SIZE;
    page += 1;
    await sleep(CLUB_REQUEST_DELAY_MS);
  }

  if (!enrich) {
    return {
      total: players.length,
      players,
    };
  }

  const resolved = await enrichClubPlayers(players);
  return {
    total: resolved.length,
    players: resolved,
  };
};
