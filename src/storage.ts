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

/** Reads saved data, falling back to the starting setup if storage is empty, blocked or corrupt. */
export function load(storage: Storage | null = browserStorage()): Data {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? parseData(JSON.parse(raw)) : defaults();
  } catch {
    return defaults();
  }
}

/** Saves everything. Returns false if the browser refused (blocked, or out of space). */
export function save(data: Data, storage: Storage | null = browserStorage()): boolean {
  if (!storage) return false;
  try {
    storage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}
