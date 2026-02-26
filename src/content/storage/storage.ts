export const ROOT_ID = "fc-helper-root" as const;
export const STORAGE_KEY_UI_MODE = "fc_helper_ui_mode" as const; // "min" | "half"

type StorageGetResult<T extends string> = Record<T, unknown>;

export const storageGet = <T extends string>(keys: readonly T[]) =>
  new Promise<StorageGetResult<T>>((resolve) =>
    chrome.storage.local.get(keys as string[], resolve),
  );

export const storageSet = (data: Record<string, unknown>) =>
  new Promise<void>((resolve) => chrome.storage.local.set(data, () => resolve()));
