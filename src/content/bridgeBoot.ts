const BRIDGE_SCRIPT_ID = "fc-helper-transfer-market-bridge";
const BRIDGE_SCRIPT_FILE = "transferMarketBridge.js";

const ensureBridgeScriptInjected = () => {
  if (document.getElementById(BRIDGE_SCRIPT_ID)) return;

  const script = document.createElement("script");
  script.id = BRIDGE_SCRIPT_ID;
  script.type = "text/javascript";
  script.async = false;
  script.src = chrome.runtime.getURL(BRIDGE_SCRIPT_FILE);

  (document.documentElement || document.head || document.body).appendChild(script);
};

ensureBridgeScriptInjected();

