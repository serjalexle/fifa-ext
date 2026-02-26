import { ensureRoot } from "../dom/root";
import { subscribeActiveSiteTab } from "../dom/siteNav";
import { fetchUserMassInfo, loadAllClubPlayers } from "../api/transferMarket";
import { storageGet, storageSet, STORAGE_KEY_UI_MODE } from "../storage/storage";
import { goToTab } from "../storage/tabsNav";
import { SITE_TAB_LABELS } from "../storage/tabs";
import type { FCTab, SiteTab } from "../storage/tabs";

export type UIMode = "min" | "half";
let unsubscribeSiteNav: (() => void) | null = null;
let myPlayersLoading = false;
let myPlayersCooldownUntil = 0;
let userMassInfoLoading = false;

const applyModeClass = (root: HTMLElement, mode: UIMode) => {
  root.classList.remove("fc-helper--min", "fc-helper--half");
  root.classList.add(mode === "half" ? "fc-helper--half" : "fc-helper--min");
};

export const renderUI = async () => {
  const root = ensureRoot() as HTMLElement;

  const data = await storageGet([STORAGE_KEY_UI_MODE] as const);
  const mode = (data[STORAGE_KEY_UI_MODE] as UIMode) ?? "half";

  applyModeClass(root, mode);

  root.innerHTML = `
    <div class="fc-helper-card">
      <div class="fc-helper-header">
        <div class="fc-helper-title">FC Helper</div>
        <div class="fc-helper-header-actions">
          <button class="fc-helper-icon-btn" id="fc-helper-min" title="Minimize">—</button>
          <button class="fc-helper-icon-btn" id="fc-helper-half" title="Half">▢</button>
          <button class="fc-helper-icon-btn" id="fc-helper-hide" title="Hide">✕</button>
        </div>
      </div>

      <div class="fc-helper-body">
        <div class="fc-helper-top-actions">
          <button class="fc-helper-pill" id="fc-helper-my-players">My players</button>
          <span class="fc-helper-pill-status" id="fc-helper-my-players-status">Not loaded</span>
        </div>
        <div class="fc-helper-top-actions">
          <button class="fc-helper-pill" id="fc-helper-user-massinfo">Load account</button>
          <span class="fc-helper-pill-status" id="fc-helper-user-massinfo-status">Not loaded</span>
        </div>
        <div class="fc-helper-status">
          Active page: <span id="fc-helper-active-page">Unknown</span>
        </div>
        <div class="fc-helper-tabs">
          <button class="fc-helper-tab" data-tab="transfers">Buy Player</button>
          <button class="fc-helper-tab" data-tab="store">Store</button>
          <button class="fc-helper-tab" data-tab="evo">Evolutions</button>
          <button class="fc-helper-tab" data-tab="sbc">SBC</button>
        </div>
        <div class="fc-helper-data-box">
          <div class="fc-helper-data-title">Account data</div>
          <div class="fc-helper-data-summary" id="fc-helper-user-massinfo-summary">No data loaded</div>
          <pre class="fc-helper-data-json" id="fc-helper-user-massinfo-json"></pre>
        </div>
      </div>
    </div>
  `;

  const setMode = async (nextMode: UIMode) => {
    applyModeClass(root, nextMode);
    await storageSet({ [STORAGE_KEY_UI_MODE]: nextMode });
  };

  root.querySelector("#fc-helper-min")?.addEventListener("click", () => void setMode("min"));
  root.querySelector("#fc-helper-half")?.addEventListener("click", () => void setMode("half"));
  root.querySelector("#fc-helper-hide")?.addEventListener("click", () => {
    unsubscribeSiteNav?.();
    unsubscribeSiteNav = null;
    root.remove();
  });

  root.querySelector(".fc-helper-header")?.addEventListener("dblclick", async () => {
    const current = ((await storageGet([STORAGE_KEY_UI_MODE] as const))[STORAGE_KEY_UI_MODE] as UIMode) ?? "half";
    await setMode(current === "half" ? "min" : "half");
  });

  root.querySelectorAll<HTMLButtonElement>(".fc-helper-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab as FCTab | undefined;
      if (!tab) return;
      void goToTab(tab);
    });
  });

  root.querySelector("#fc-helper-my-players")?.addEventListener("click", async () => {
    const now = Date.now();
    if (myPlayersLoading) return;
    if (now < myPlayersCooldownUntil) return;

    myPlayersLoading = true;
    const statusNode = root.querySelector<HTMLElement>("#fc-helper-my-players-status");
    const buttonNode = root.querySelector<HTMLButtonElement>("#fc-helper-my-players");
    if (buttonNode) buttonNode.disabled = true;
    if (statusNode) statusNode.textContent = "Loading...";

    try {
      const result = await loadAllClubPlayers({ enrich: true, maxPages: 20 });
      if (statusNode) statusNode.textContent = `Loaded ${result.total}`;
      console.info("[FC Helper] Club players loaded:", result.total, result.players);
    } catch (error) {
      if (statusNode) statusNode.textContent = "Load failed";
      myPlayersCooldownUntil = Date.now() + 30_000;
      console.warn("[FC Helper] Failed to load club players:", error);
    } finally {
      myPlayersLoading = false;
      if (buttonNode) buttonNode.disabled = false;
    }
  });

  root.querySelector("#fc-helper-user-massinfo")?.addEventListener("click", async () => {
    if (userMassInfoLoading) return;
    userMassInfoLoading = true;

    const buttonNode = root.querySelector<HTMLButtonElement>("#fc-helper-user-massinfo");
    const statusNode = root.querySelector<HTMLElement>("#fc-helper-user-massinfo-status");
    const summaryNode = root.querySelector<HTMLElement>("#fc-helper-user-massinfo-summary");
    const jsonNode = root.querySelector<HTMLElement>("#fc-helper-user-massinfo-json");

    if (buttonNode) buttonNode.disabled = true;
    if (statusNode) statusNode.textContent = "Loading...";

    try {
      const payload = await fetchUserMassInfo();
      const userInfo = (payload.userInfo ?? {}) as Record<string, unknown>;
      const clubName = String(userInfo.clubName ?? "-");
      const personaName = String(userInfo.personaName ?? "-");
      const credits = Number(userInfo.credits ?? 0);
      const won = Number(userInfo.won ?? 0);
      const draw = Number(userInfo.draw ?? 0);
      const loss = Number(userInfo.loss ?? 0);

      if (summaryNode) {
        summaryNode.textContent = `Club: ${clubName} | Persona: ${personaName} | Coins: ${credits.toLocaleString(
          "en-US",
        )} | W-D-L: ${won}-${draw}-${loss}`;
      }
      if (jsonNode) jsonNode.textContent = JSON.stringify(payload, null, 2);
      if (statusNode) statusNode.textContent = "Loaded";
    } catch (error) {
      if (statusNode) statusNode.textContent = "Load failed";
      if (summaryNode) summaryNode.textContent = "Failed to load usermassinfo";
      console.warn("[FC Helper] Failed to load usermassinfo:", error);
    } finally {
      userMassInfoLoading = false;
      if (buttonNode) buttonNode.disabled = false;
    }
  });

  
  const applyActiveSiteTab = (tab: SiteTab) => {
    const label = SITE_TAB_LABELS[tab] ?? SITE_TAB_LABELS.unknown;
    const activeNode = root.querySelector<HTMLElement>("#fc-helper-active-page");
    if (activeNode) activeNode.textContent = label;

    root.querySelectorAll<HTMLButtonElement>(".fc-helper-tab").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.tab === tab);
    });
  };

  unsubscribeSiteNav?.();
  unsubscribeSiteNav = subscribeActiveSiteTab(applyActiveSiteTab);
};
