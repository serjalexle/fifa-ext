import { ROOT_ID } from "../storage/storage";

export const ensureRoot = () => {
  const existing = document.getElementById(ROOT_ID);
  if (existing) return existing;

  const root = document.createElement("div");
  root.id = ROOT_ID;

  // Content UI should live inside <body> to avoid host-page layout quirks.
  const mountPoint = document.body ?? document.documentElement;
  mountPoint.appendChild(root);
  return root;
};
