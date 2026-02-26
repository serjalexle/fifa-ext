const REQUEST_SOURCE = "fc-helper-transfer-market-request";
const RESPONSE_SOURCE = "fc-helper-transfer-market";
const UTAS_PATH_FRAGMENT = "/ut/game/fc26/";
const HEADER_ALLOWLIST = new Set([
  "x-ut-sid",
  "authorization",
  "x-phishing-token",
  "x-requested-with",
  "accept-language",
  "accept",
]);

type TransferMarketBridgeRequest = {
  source: typeof REQUEST_SOURCE;
  key: string;
  url: string;
};

type XhrTracked = XMLHttpRequest & {
  __fcHelperTracked?: {
    url: string;
    headers: Record<string, string>;
  };
};

let capturedAuthHeaders: Record<string, string> = {};

const isUtasRequest = (url: string) => {
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.pathname.includes(UTAS_PATH_FRAGMENT);
  } catch {
    return false;
  }
};

const normalizeHeaderName = (name: string) => name.trim().toLowerCase();

const mergeAllowedHeaders = (headers: Record<string, string>) => {
  const next = { ...capturedAuthHeaders };

  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = normalizeHeaderName(rawName);
    if (!HEADER_ALLOWLIST.has(name)) continue;
    const value = String(rawValue ?? "").trim();
    if (!value) continue;
    next[name] = value;
  }

  capturedAuthHeaders = next;
};

const headersToRecord = (headers: HeadersInit | undefined): Record<string, string> => {
  if (!headers) return {};

  if (headers instanceof Headers) {
    const out: Record<string, string> = {};
    headers.forEach((value, key) => {
      out[key] = value;
    });
    return out;
  }

  if (Array.isArray(headers)) {
    const out: Record<string, string> = {};
    for (const [key, value] of headers) out[key] = value;
    return out;
  }

  return { ...headers };
};

const installFetchCapture = () => {
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const inputUrl = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    if (isUtasRequest(inputUrl)) {
      const requestHeaders =
        input instanceof Request ? headersToRecord(input.headers) : {};
      const initHeaders = headersToRecord(init?.headers);
      mergeAllowedHeaders({ ...requestHeaders, ...initHeaders });
    }

    return originalFetch(input, init);
  };
};

const installXhrCapture = () => {
  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (...args: Parameters<typeof originalOpen>) {
    const [, url] = args;
    const tracked = this as XhrTracked;
    tracked.__fcHelperTracked = {
      url: String(url ?? ""),
      headers: {},
    };
    return originalOpen.apply(this, args);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (
    ...args: Parameters<typeof originalSetRequestHeader>
  ) {
    const [header, value] = args;
    const tracked = this as XhrTracked;
    if (tracked.__fcHelperTracked) {
      tracked.__fcHelperTracked.headers[String(header)] = String(value);
    }
    return originalSetRequestHeader.apply(this, args);
  };

  XMLHttpRequest.prototype.send = function (...args: Parameters<typeof originalSend>) {
    const tracked = this as XhrTracked;
    if (tracked.__fcHelperTracked && isUtasRequest(tracked.__fcHelperTracked.url)) {
      mergeAllowedHeaders(tracked.__fcHelperTracked.headers);
    }
    return originalSend.apply(this, args);
  };
};

installFetchCapture();
installXhrCapture();

const postError = (key: string, status: number | undefined, error: string) => {
  window.postMessage(
    {
      source: RESPONSE_SOURCE,
      key,
      ok: false,
      status,
      error,
    },
    window.origin,
  );
};

window.addEventListener("message", async (event: MessageEvent) => {
  if (event.source !== window) return;

  const data = event.data as TransferMarketBridgeRequest | undefined;
  if (!data || data.source !== REQUEST_SOURCE || typeof data.key !== "string" || typeof data.url !== "string") {
    return;
  }

  if (Object.keys(capturedAuthHeaders).length === 0) {
    postError(
      data.key,
      undefined,
      "EA auth headers are not captured yet. Open a market/search action manually, then retry.",
    );
    return;
  }

  try {
    const response = await fetch(data.url, {
      method: "GET",
      credentials: "omit",
      mode: "cors",
      headers: capturedAuthHeaders,
    });

    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const reason =
        payload && typeof payload === "object" && "reason" in payload
          ? String((payload as { reason: unknown }).reason)
          : "HTTP error";
      postError(data.key, response.status, reason);
      return;
    }

    window.postMessage(
      {
        source: RESPONSE_SOURCE,
        key: data.key,
        ok: true,
        status: response.status,
        payload,
      },
      window.origin,
    );
  } catch (error) {
    postError(data.key, undefined, error instanceof Error ? error.message : String(error));
  }
});
