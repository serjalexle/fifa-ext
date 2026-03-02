const EA_SBC_SETS_URL = "https://utas.mob.v5.prd.futc-ext.gcp.ea.com/ut/game/fc26/sbs/sets";
const EA_SBC_CHALLENGES_URL = (setId: number) =>
  `https://utas.mob.v5.prd.futc-ext.gcp.ea.com/ut/game/fc26/sbs/setId/${setId}/challenges`;
const BRIDGE_SCRIPT_ID = "fc-helper-sbc-bridge";
const BRIDGE_SCRIPT_FILE = "sbcBridge.js";
const REQUEST_SOURCE = "fc-helper-sbc-request";
const RESPONSE_SOURCE = "fc-helper-sbc-response";
const STATUS_REQUEST_SOURCE = "fc-helper-sbc-status-request";
const STATUS_RESPONSE_SOURCE = "fc-helper-sbc-status-response";
const REQUEST_TIMEOUT_MS = 15_000;
const STATUS_TIMEOUT_MS = 3_000;

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

export type SbcSetsResponse = {
  categories: SbcCategory[];
};

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

const fetchViaBridge = async (url: string) => {
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
    window.postMessage(
      {
        source: REQUEST_SOURCE,
        key,
        url,
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
