import { describe, expect, it } from "vitest";
import { createStore, KEY } from "./storage";

/** One browser's localStorage, shared by two windows. */
function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const weighIn = (id: string, value: string) => ({ id, at: "2026-11-04T07:30", readings: [{ name: "Weight", unit: "kg", value }] });

describe("two windows on one phone", () => {
  it("a setup change in an older window keeps a weigh-in saved in the other", () => {
    const storage = memoryStorage();
    const a = createStore(storage);
    const b = createStore(storage); // loaded before A saved
    a.update((d) => d.sets.push(weighIn("1", "72.4")));
    b.update((d) => d.fields.push({ id: "new", name: "Bone", unit: "kg" }));
    const saved = JSON.parse(storage.getItem(KEY)!);
    expect(saved.sets.map((s: { id: string }) => s.id)).toEqual(["1"]);
    expect(saved.fields.at(-1).name).toBe("Bone");
    expect(b.data.sets).toHaveLength(1);
  });

  it("a weigh-in deleted in one window isn't brought back by a write in the other", () => {
    const storage = memoryStorage();
    const a = createStore(storage);
    a.update((d) => d.sets.push(weighIn("1", "72.4"), weighIn("2", "72.9")));
    const b = createStore(storage); // still shows both
    a.update((d) => (d.sets = d.sets.filter((s) => s.id !== "1")));
    b.update((d) => (d.polarity = "light"));
    b.update((d) => d.sets.push(weighIn("3", "73.0")));
    const saved = JSON.parse(storage.getItem(KEY)!);
    expect(saved.sets.map((s: { id: string }) => s.id)).toEqual(["2", "3"]);
    expect(saved.polarity).toBe("light");
  });

  it("delete all in one window sticks", () => {
    const storage = memoryStorage();
    const a = createStore(storage);
    a.update((d) => d.sets.push(weighIn("1", "72.4")));
    const b = createStore(storage);
    a.update((d) => (d.sets = []));
    b.update((d) => (d.box = { x: 0.1, y: 0.1, w: 0.5, h: 0.3 }));
    expect(JSON.parse(storage.getItem(KEY)!).sets).toEqual([]);
  });

  it("refresh picks up the other window's changes", () => {
    const storage = memoryStorage();
    const a = createStore(storage);
    const b = createStore(storage);
    a.update((d) => d.sets.push(weighIn("1", "72.4")));
    expect(b.data.sets).toHaveLength(0);
    b.refresh();
    expect(b.data.sets).toHaveLength(1);
  });

  it("keeps working for this page when the browser blocks storage", () => {
    const s = createStore(null);
    expect(s.update((d) => d.sets.push(weighIn("1", "72.4")))).toBe(false);
    expect(s.data.sets).toHaveLength(1);
    expect(s.update((d) => d.sets.push(weighIn("2", "70")))).toBe(false);
    expect(s.data.sets).toHaveLength(2);
  });
});
