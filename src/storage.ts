import { defaults, parseData, type Data } from "./logic/records";

export const KEY = "scale-reader:v1";

/** The browser's storage, or null when the browser blocks it (reading `localStorage` itself can throw). */
export function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Reads saved data, or null when there's nothing saved or it can't be read. */
function read(storage: Storage | null): Data | null {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? parseData(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

/** Reads saved data, falling back to the starting setup if storage is empty, blocked or corrupt. */
export function load(storage: Storage | null = browserStorage()): Data {
  return read(storage) ?? defaults();
}

export interface Store {
  /** This page's copy of the data. Re-read on every change and when another tab saves. */
  readonly data: Data;
  /**
   * Makes a change. The change is applied to the latest saved data (another
   * tab or the installed app may have saved since this page loaded), never to
   * this page's older copy, so nothing saved or deleted elsewhere is undone.
   * Returns false if the browser wouldn't save it (it's still kept for this page).
   */
  update(change: (d: Data) => void): boolean;
  /** Re-reads saved data, e.g. after another tab saved. */
  refresh(): void;
}

export function createStore(storage: Storage | null = browserStorage()): Store {
  let data = load(storage);
  return {
    get data() {
      return data;
    },
    update(change) {
      // Read, change and write in one go (localStorage is synchronous, so no
      // other script on this page can run in between).
      const latest = read(storage) ?? structuredClone(data);
      change(latest);
      data = latest;
      if (!storage) return false;
      try {
        storage.setItem(KEY, JSON.stringify(latest));
        return true;
      } catch {
        return false;
      }
    },
    refresh() {
      data = read(storage) ?? data;
    },
  };
}
