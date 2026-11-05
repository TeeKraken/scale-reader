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
  /** This page's copy of the data. */
  readonly data: Data;
  /**
   * True once the browser has refused a save (or blocks storage). From then on
   * this page's copy is the only complete one: it's kept for the rest of the
   * page's life, and nothing read from storage can replace it.
   */
  readonly memoryOnly: boolean;
  /**
   * Makes a change. It's applied to the latest saved data, so changes made one
   * after another in different tabs (or the installed app) are picked up rather
   * than undone. There's no lock across windows, though: editing in two windows
   * at the very same moment can still lose one of the changes.
   * Returns false if the change couldn't be saved (it's still kept for this page).
   */
  update(change: (d: Data) => void): boolean;
  /** Re-reads saved data, e.g. after another tab saved. Does nothing once memory-only. */
  refresh(): void;
}

export function createStore(storage: Storage | null = browserStorage()): Store {
  let data = load(storage);
  let memoryOnly = storage === null;
  return {
    get data() {
      return data;
    },
    get memoryOnly() {
      return memoryOnly;
    },
    update(change) {
      if (memoryOnly) {
        change(data);
        return false;
      }
      const latest = read(storage) ?? structuredClone(data);
      change(latest);
      data = latest;
      try {
        storage!.setItem(KEY, JSON.stringify(latest));
        return true;
      } catch {
        memoryOnly = true;
        return false;
      }
    },
    refresh() {
      if (!memoryOnly) data = read(storage) ?? data;
    },
  };
}
