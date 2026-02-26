import "./ui/styles.css";
import { renderUI } from "./ui/ui";
import { fetchTransferMarket, fetchUserMassInfo, loadAllClubPlayers, loadTransferMarketBatch } from "./api/transferMarket";

declare global {
  interface Window {
    fcHelperApi?: {
      fetchTransferMarket: typeof fetchTransferMarket;
      fetchUserMassInfo: typeof fetchUserMassInfo;
      loadTransferMarketBatch: typeof loadTransferMarketBatch;
      loadAllClubPlayers: typeof loadAllClubPlayers;
    };
  }
}

const boot = () => {
  window.fcHelperApi = {
    fetchTransferMarket,
    fetchUserMassInfo,
    loadTransferMarketBatch,
    loadAllClubPlayers,
  };

  void renderUI();
};

boot();
