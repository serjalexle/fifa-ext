const EA_SBC_SETS_URL = "https://utas.mob.v5.prd.futc-ext.gcp.ea.com/ut/game/fc26/sbs/sets";
const EA_SBC_CHALLENGES_URL = (setId: number) =>
  `https://utas.mob.v5.prd.futc-ext.gcp.ea.com/ut/game/fc26/sbs/setId/${setId}/challenges`;
const EA_SBC_CHALLENGE_SQUAD_URL = (challengeId: number) =>
  `https://utas.mob.v5.prd.futc-ext.gcp.ea.com/ut/game/fc26/sbs/challenge/${challengeId}/squad`;
const EA_CLUB_PLAYERS_URL = "https://utas.mob.v5.prd.futc-ext.gcp.ea.com/ut/game/fc26/club";
const EA_TEAM_CHEM_LINKS_URL = "https://utas.mob.v5.prd.futc-ext.gcp.ea.com/ut/game/fc26/chemistry/teamlinks";
const EA_CHEM_PROFILES_URL = "https://utas.mob.v5.prd.futc-ext.gcp.ea.com/ut/game/fc26/chemistry/profiles";
const EA_USER_MASS_INFO_URL = "https://utas.mob.v5.prd.futc-ext.gcp.ea.com/ut/game/fc26/usermassinfo";
const EA_STORAGE_PILE_URL = "https://utas.mob.v5.prd.futc-ext.gcp.ea.com/ut/game/fc26/storagepile?skuMode=FUT";
const EA_TEAM_CONFIG_URL = () =>
  `https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fut/config/companion/teamconfig.json?_=${Date.now()}`;
const EA_PLAYERS_META_URL = () =>
  `https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fut/items/web/players_meta.json?_=${Date.now()}`;
const EA_KEY_ATTRIBUTES_URL =
  "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fut/items/keyAttributes.json";
const EA_PLAYER_ICONS_URL = () =>
  `https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fut/items/web/players_icons.json?_=${Date.now()}`;
const EA_PLAYERS_METADATA_URL =
  "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/26E4D4D6-8DBB-4A9A-BD99-9C47D3AA341D/2026/fut/items/web/players.json";
const BRIDGE_SCRIPT_ID = "fc-helper-sbc-bridge";
const BRIDGE_SCRIPT_FILE = "sbcBridge.js";
const REQUEST_SOURCE = "fc-helper-sbc-request";
const RESPONSE_SOURCE = "fc-helper-sbc-response";
const STATUS_REQUEST_SOURCE = "fc-helper-sbc-status-request";
const STATUS_RESPONSE_SOURCE = "fc-helper-sbc-status-response";
const REQUEST_TIMEOUT_MS = 15_000;
const STATUS_TIMEOUT_MS = 3_000;
const CLUB_PAGE_SIZE = 91;
const CLUB_MAX_PAGES = 30;
const CLUB_PAGE_DELAY_MS = 5_000;
type BridgeRequestMethod = "GET" | "POST" | "PUT";

type BridgeSuccessMessage = {
  source: typeof RESPONSE_SOURCE;
  key: string;
  ok: true;
  status: number;
  payload: unknown;
};

type BridgeErrorMessage = {
  source: typeof RESPONSE_SOURCE;
  key: string;
  ok: false;
  status?: number;
  error: string;
};

type BridgeResponseMessage = BridgeSuccessMessage | BridgeErrorMessage;

type BridgeStatusResponseMessage = {
  source: typeof STATUS_RESPONSE_SOURCE;
  key: string;
  captured: boolean;
};

export type SbcAward = {
  value?: number;
  type?: string;
  halId?: number;
  count?: number;
  isUntradeable?: boolean;
  loan?: number;
  loanType?: string;
  itemData?: {
    assetId?: number;
    guidAssetId?: string;
  };
};

export type SbcSet = {
  setId: number;
  name: string;
  priority: number;
  categoryId: number;
  description?: string;
  challengesCount: number;
  hidden: boolean;
  tagged: number;
  endTime?: number;
  repeatable: boolean;
  repeatabilityMode?: string;
  repeats?: number;
  challengesCompletedCount?: number;
  awards?: SbcAward[];
  tutorial?: boolean;
  timesCompleted?: number;
  taggedByProduction?: boolean;
  taggedByUser?: boolean;
  setImageId?: string;
  releaseTime?: number;
};

export type SbcCategory = {
  categoryId: number;
  name: string;
  priority?: number;
  sets: SbcSet[];
};

export type SbcChallenge = {
  name?: string;
  description?: string;
  challengeId?: number;
  status?: string;
  setId?: number;
  endTime?: number;
  repeatable?: boolean;
  formation?: string;
  timesCompleted?: number;
  elgReq?: Array<Record<string, unknown>>;
  elgDesc?: Array<Record<string, unknown>>;
  awards?: SbcAward[];
  elgOperation?: string;
  tutorial?: number;
  type?: string;
  challengeImageId?: string;
};

export type SbcChallengeSquadSlot = {
  index: number;
  itemData: {
    id: number;
    dream: boolean;
  };
};

export type SbcSetsResponse = {
  categories: SbcCategory[];
};

export type ClubPlayerItem = {
  id: number;
  assetId?: number;
  guidAssetId?: string;
  resourceId?: number;
  rating?: number;
  itemType?: string;
  itemState?: string;
  cardsubtypeid?: number;
  rareflag?: number;
  groups?: number[];
  marketAverage?: number;
  marketDataMinPrice?: number;
  preferredPosition?: string;
  possiblePositions?: string[];
  attributeArray?: number[];
  teamid?: number;
  leagueId?: number;
  nation?: number;
  pile?: number;
  untradeable?: boolean;
};

export type ClubPlayersResponse = {
  itemData: ClubPlayerItem[];
};

export type PlayerMeta = {
  id: number;
  f?: string;
  l?: string;
  c?: string;
  r?: number;
};

export type TeamChemLink = {
  teamId: number;
  linkedTeams: number[];
};

export type TeamChemLinksResponse = {
  teamChemLinks: TeamChemLink[];
};

export type TeamConfigLeague = {
  LeagueId: number;
  NationId: number;
};

export type TeamConfigTeam = {
  TeamId: number;
  LeagueId: number;
};

export type TeamConfigYear = {
  Year: string;
  Nations: number[];
  Leagues: TeamConfigLeague[];
  Teams: TeamConfigTeam[];
  ClubItemTeams?: TeamConfigTeam[];
  LegendsTeams?: TeamConfigTeam[];
  InternationalTeams?: TeamConfigTeam[];
};

export type TeamConfigResponse = {
  Years: TeamConfigYear[];
};

export type PlayerMetaDetail = {
  a?: number[];
  b?: number;
  f?: number;
  h?: number;
  l?: Record<string, unknown>;
  s?: number;
  w?: number;
};

export type PlayersMetaResponse = {
  attrKeys: number[];
  players: Record<string, PlayerMetaDetail>;
};

export type KeyAttributesEntry = {
  guid: string;
  keyAttributes: number[];
};

export type KeyAttributesResponse = {
  playerList: KeyAttributesEntry[];
};

export type PlayerIconEntry = {
  iconId: number;
  playerId: number;
};

export type ChemistryProfileRule = {
  parameterType: string;
  calculationType: string;
  value: number;
};

export type ChemistryProfile = {
  id: number;
  fullChemistryOnPreferredPosition?: boolean;
  baseOverride?: boolean;
  iconOverride?: boolean;
  heroOverride?: boolean;
  rules?: ChemistryProfileRule[];
};

export type ChemistryProfilesResponse = {
  version?: number;
  profiles: ChemistryProfile[];
};

export type UserMassInfoResponse = {
  errors?: Record<string, unknown>;
  settings?: {
    configs?: Array<{
      value?: number | string | boolean;
      type?: string;
    }>;
  };
};

export type StoragePileItem = {
  id: number;
  itemType?: string;
  itemState?: string;
  rating?: number;
  assetId?: number;
  guidAssetId?: string;
  resourceId?: number;
  cardsubtypeid?: number;
  rareflag?: number;
  groups?: number[];
  marketAverage?: number;
  marketDataMinPrice?: number;
  pile?: number;
  teamid?: number;
  leagueId?: number;
  nation?: number;
  untradeable?: boolean;
};

export type StoragePileResponse = {
  itemData: StoragePileItem[];
};

let playersMetaMapPromise: Promise<Map<number, PlayerMeta>> | null = null;

let bridgeLoadPromise: Promise<void> | null = null;

const makeRequestKey = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

const ensureBridgeScriptInjected = async () => {
  if (document.getElementById(BRIDGE_SCRIPT_ID)) return;
  if (bridgeLoadPromise) return bridgeLoadPromise;

  bridgeLoadPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = BRIDGE_SCRIPT_ID;
    script.type = "text/javascript";
    script.async = false;
    // @ts-expect-error - TypeScript doesn't know about chrome.runtime.getURL
    script.src = chrome.runtime.getURL(BRIDGE_SCRIPT_FILE);
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("[FC Helper] Failed to load SBC bridge script"));
    (document.documentElement || document.head || document.body).appendChild(script);
  });

  await bridgeLoadPromise;
};

const queryCapturedHeadersStatus = async () => {
  await ensureBridgeScriptInjected();

  return new Promise<boolean>((resolve, reject) => {
    const key = makeRequestKey();
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("[FC Helper] SBC bridge status timeout"));
    }, STATUS_TIMEOUT_MS);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;

      const data = event.data as BridgeStatusResponseMessage | undefined;
      if (!data || data.source !== STATUS_RESPONSE_SOURCE || data.key !== key) return;

      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve(Boolean(data.captured));
    };

    window.addEventListener("message", onMessage);
    window.postMessage(
      {
        source: STATUS_REQUEST_SOURCE,
        key,
      },
      window.origin,
    );
  });
};

export const ensureSbcBridgeReady = async () => {
  await ensureBridgeScriptInjected();
};

export const hasCapturedSbcAuthHeaders = async () => {
  return queryCapturedHeadersStatus();
};

export const waitForCapturedSbcAuthHeaders = async (attempts = 12, intervalMs = 500) => {
  for (let idx = 0; idx < attempts; idx += 1) {
    const captured = await queryCapturedHeadersStatus();
    if (captured) return true;
    if (idx < attempts - 1) {
      await sleep(intervalMs);
    }
  }

  return false;
};

const fetchViaBridge = async (
  url: string,
  options?: {
    method?: BridgeRequestMethod;
    body?: unknown;
  },
) => {
  await ensureBridgeScriptInjected();

  return new Promise<unknown>((resolve, reject) => {
    const key = makeRequestKey();
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", onMessage);
      reject(new Error("[FC Helper] SBC request timeout"));
    }, REQUEST_TIMEOUT_MS);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;

      const data = event.data as BridgeResponseMessage | undefined;
      if (!data || data.source !== RESPONSE_SOURCE || data.key !== key) return;

      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);

      if (!data.ok) {
        reject(new Error(data.error || "[FC Helper] SBC request failed"));
        return;
      }

      resolve(data.payload);
    };

    window.addEventListener("message", onMessage);
    const method = options?.method ?? "GET";
    window.postMessage(
      {
        source: REQUEST_SOURCE,
        key,
        url,
        method,
        body: options?.body,
      },
      window.origin,
    );
  });
};

export const fetchSbcSets = async (): Promise<SbcSetsResponse> => {
  // This endpoint returns SBC "sets" grouped under `categories`.
  // We execute it through the injected bridge because EA UTAS requests rely
  // on auth headers (x-ut-sid, authorization, etc.) that live in page context.
  const payload = await fetchViaBridge(EA_SBC_SETS_URL);

  if (!payload || typeof payload !== "object") {
    throw new Error("[FC Helper] SBC payload is invalid");
  }

  const bag = payload as Record<string, unknown>;
  const categories = bag.categories;
  if (!Array.isArray(categories)) {
    throw new Error("[FC Helper] SBC payload does not contain categories[]");
  }

  for (const category of categories) {
    if (!category || typeof category !== "object") {
      throw new Error("[FC Helper] SBC category is invalid");
    }
    const sets = (category as Record<string, unknown>).sets;
    if (!Array.isArray(sets)) {
      throw new Error("[FC Helper] SBC category does not contain sets[]");
    }
  }

  return {
    categories: categories as SbcCategory[],
  };
};

export const fetchSbcChallenges = async (setId: number): Promise<SbcChallenge[]> => {
  const payload = await fetchViaBridge(EA_SBC_CHALLENGES_URL(setId));

  if (Array.isArray(payload)) {
    return payload as SbcChallenge[];
  }

  if (payload && typeof payload === "object") {
    const bag = payload as Record<string, unknown>;
    const challenges = bag.challenges;
    if (Array.isArray(challenges)) {
      return challenges as SbcChallenge[];
    }
  }

  throw new Error("[FC Helper] SBC challenges payload is invalid");
};

export const putSbcChallengeSquad = async (
  challengeId: number,
  squad: SbcChallengeSquadSlot[],
): Promise<unknown> => {
  const normalizedChallengeId = Math.trunc(Number(challengeId));
  if (!Number.isFinite(normalizedChallengeId) || normalizedChallengeId <= 0) {
    throw new Error("[FC Helper] Invalid challengeId for squad placement");
  }

  if (!Array.isArray(squad) || squad.length === 0) {
    throw new Error("[FC Helper] Squad payload must be a non-empty array");
  }

  // PUT /sbs/challenge/{challengeId}/squad updates the SBC grid slots.
  // We only place players; challenge submit/confirm stays manual on EA UI.
  return fetchViaBridge(EA_SBC_CHALLENGE_SQUAD_URL(normalizedChallengeId), {
    method: "PUT",
    body: {
      players: squad,
    },
  });
};

export const fetchTeamChemLinks = async (): Promise<TeamChemLinksResponse> => {
  const payload = await fetchViaBridge(EA_TEAM_CHEM_LINKS_URL);
  if (!payload || typeof payload !== "object") {
    throw new Error("[FC Helper] Team chem links payload is invalid");
  }

  const bag = payload as Record<string, unknown>;
  if (!Array.isArray(bag.teamChemLinks)) {
    throw new Error("[FC Helper] Team chem links payload does not contain teamChemLinks[]");
  }

  return {
    teamChemLinks: bag.teamChemLinks as TeamChemLink[],
  };
};

export const fetchTeamConfig = async (): Promise<TeamConfigResponse> => {
  const payload = await fetchViaBridge(EA_TEAM_CONFIG_URL());
  if (!payload || typeof payload !== "object") {
    throw new Error("[FC Helper] Team config payload is invalid");
  }

  const bag = payload as Record<string, unknown>;
  if (!Array.isArray(bag.Years)) {
    throw new Error("[FC Helper] Team config payload does not contain Years[]");
  }

  return {
    Years: bag.Years as TeamConfigYear[],
  };
};

export const fetchPlayersMeta = async (): Promise<PlayersMetaResponse> => {
  const payload = await fetchViaBridge(EA_PLAYERS_META_URL());
  if (!payload || typeof payload !== "object") {
    throw new Error("[FC Helper] Players meta payload is invalid");
  }

  const bag = payload as Record<string, unknown>;
  if (!Array.isArray(bag.attrKeys)) {
    throw new Error("[FC Helper] Players meta payload does not contain attrKeys[]");
  }
  if (!bag.players || typeof bag.players !== "object") {
    throw new Error("[FC Helper] Players meta payload does not contain players{}");
  }

  return {
    attrKeys: bag.attrKeys as number[],
    players: bag.players as Record<string, PlayerMetaDetail>,
  };
};

export const fetchKeyAttributes = async (): Promise<KeyAttributesResponse> => {
  const payload = await fetchViaBridge(EA_KEY_ATTRIBUTES_URL);
  if (!payload || typeof payload !== "object") {
    throw new Error("[FC Helper] Key attributes payload is invalid");
  }

  const bag = payload as Record<string, unknown>;
  if (!Array.isArray(bag.playerList)) {
    throw new Error("[FC Helper] Key attributes payload does not contain playerList[]");
  }

  return {
    playerList: bag.playerList as KeyAttributesEntry[],
  };
};

export const fetchPlayerIcons = async (): Promise<PlayerIconEntry[]> => {
  const payload = await fetchViaBridge(EA_PLAYER_ICONS_URL());
  if (!Array.isArray(payload)) {
    throw new Error("[FC Helper] Player icons payload is invalid");
  }

  return payload as PlayerIconEntry[];
};

export const fetchChemistryProfiles = async (): Promise<ChemistryProfilesResponse> => {
  const payload = await fetchViaBridge(EA_CHEM_PROFILES_URL);
  if (!payload || typeof payload !== "object") {
    throw new Error("[FC Helper] Chemistry profiles payload is invalid");
  }

  const bag = payload as Record<string, unknown>;
  if (!Array.isArray(bag.profiles)) {
    throw new Error("[FC Helper] Chemistry profiles payload does not contain profiles[]");
  }
  const rawVersion = Number(bag.version);

  return {
    version: Number.isFinite(rawVersion) ? rawVersion : undefined,
    profiles: bag.profiles as ChemistryProfile[],
  };
};

export const fetchUserMassInfo = async (): Promise<UserMassInfoResponse> => {
  const payload = await fetchViaBridge(EA_USER_MASS_INFO_URL);
  if (!payload || typeof payload !== "object") {
    throw new Error("[FC Helper] User mass info payload is invalid");
  }

  return payload as UserMassInfoResponse;
};

export const fetchStoragePile = async (): Promise<StoragePileResponse> => {
  const payload = await fetchViaBridge(EA_STORAGE_PILE_URL);
  if (!payload || typeof payload !== "object") {
    throw new Error("[FC Helper] Storage pile payload is invalid");
  }

  const bag = payload as Record<string, unknown>;
  if (!Array.isArray(bag.itemData)) {
    throw new Error("[FC Helper] Storage pile payload does not contain itemData[]");
  }

  return {
    itemData: bag.itemData as StoragePileItem[],
  };
};

export const buildTeamChemLinksMap = (links: TeamChemLink[]) => {
  const map = new Map<number, Set<number>>();

  for (const entry of links) {
    const teamId = Number(entry.teamId);
    if (!Number.isFinite(teamId)) continue;

    const current = map.get(teamId) ?? new Set<number>();
    const linkedTeams = Array.isArray(entry.linkedTeams) ? entry.linkedTeams : [];
    for (const linkedTeamIdRaw of linkedTeams) {
      const linkedTeamId = Number(linkedTeamIdRaw);
      if (!Number.isFinite(linkedTeamId)) continue;
      current.add(linkedTeamId);

      const reverse = map.get(linkedTeamId) ?? new Set<number>();
      reverse.add(teamId);
      map.set(linkedTeamId, reverse);
    }
    map.set(teamId, current);
  }

  return map;
};

export const areTeamsChemLinked = (
  teamA: number,
  teamB: number,
  linksMap: Map<number, Set<number>>,
) => {
  if (!Number.isFinite(teamA) || !Number.isFinite(teamB)) return false;
  const normalizedA = Math.trunc(teamA);
  const normalizedB = Math.trunc(teamB);
  if (normalizedA === normalizedB) return true;
  return linksMap.get(normalizedA)?.has(normalizedB) ?? false;
};

const fetchClubPlayersPage = async (start: number, count = CLUB_PAGE_SIZE): Promise<ClubPlayerItem[]> => {
  // EA club endpoint expects POST with pagination offset (`start`) and page size (`count`).
  // We keep the same payload shape as the web app:
  // - sort by OVR desc
  // - include alternate positions
  // - request only player items.
  const payload = await fetchViaBridge(EA_CLUB_PLAYERS_URL, {
    method: "POST",
    body: {
      count,
      ovrMax: 99,
      ovrMin: 45,
      searchAltPositions: true,
      sort: "desc",
      sortBy: "ovr",
      start,
      type: "player",
    },
  });

  if (!payload || typeof payload !== "object") {
    throw new Error("[FC Helper] Club players payload is invalid");
  }

  const bag = payload as Record<string, unknown>;
  const itemData = bag.itemData;
  if (!Array.isArray(itemData)) {
    throw new Error("[FC Helper] Club players payload does not contain itemData[]");
  }

  return itemData as ClubPlayerItem[];
};

export const fetchAllClubPlayers = async () => {
  const all: ClubPlayerItem[] = [];
  const seenIds = new Set<number>();

  for (let page = 0; page < CLUB_MAX_PAGES; page += 1) {
    const start = page * CLUB_PAGE_SIZE;
    const chunk = await fetchClubPlayersPage(start, CLUB_PAGE_SIZE);
    for (const item of chunk) {
      if (item.itemType && item.itemType !== "player") continue;
      const id = Number(item.id);
      if (Number.isFinite(id) && seenIds.has(id)) continue;
      if (Number.isFinite(id)) seenIds.add(id);
      all.push(item);
    }
    if (chunk.length < CLUB_PAGE_SIZE) break;
    // Small throttle to reduce EA rate-limit pressure between paginated club calls.
    await sleep(CLUB_PAGE_DELAY_MS);
  }

  return all;
};

export const fetchPlayersMetaMap = async () => {
  if (playersMetaMapPromise) return playersMetaMapPromise;

  playersMetaMapPromise = (async () => {
    const payload = await fetchViaBridge(EA_PLAYERS_METADATA_URL);
    if (!payload || typeof payload !== "object") {
      throw new Error("[FC Helper] Players metadata payload is invalid");
    }

    const bag = payload as Record<string, unknown>;
    const map = new Map<number, PlayerMeta>();
    for (const value of Object.values(bag)) {
      if (!Array.isArray(value)) continue;
      for (const raw of value) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        const id = Number(item.id);
        if (!Number.isFinite(id)) continue;
        map.set(id, item as PlayerMeta);
      }
    }

    return map;
  })();

  return playersMetaMapPromise;
};
