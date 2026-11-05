/**
 * The app's saved data and the spreadsheet exports. Pure functions; storage.ts
 * reads and writes it to the browser.
 */
import type { Polarity } from "./segments";

/** One reading the scale shows, like "Body fat" in "%". */
export interface Field {
  id: string;
  name: string;
  unit: string;
}

/**
 * One saved number. `value` is "" when that reading was skipped. `fieldId` ties
 * it to the setup entry it came from (absent in data saved before ids were kept).
 */
export interface Reading {
  fieldId?: string;
  name: string;
  unit: string;
  value: string;
}

/** One weigh-in: a dated row. `at` is local time, "YYYY-MM-DDTHH:mm". */
export interface SavedSet {
  id: string;
  at: string;
  readings: Reading[];
}

/** Where the reading box sits over the camera picture, as fractions (0–1). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Data {
  fields: Field[];
  sets: SavedSet[];
  polarity: Polarity;
  box: Box;
}

export const DEFAULT_BOX: Box = { x: 0.2, y: 0.35, w: 0.6, h: 0.3 };

let counter = 0;
export function newId(): string {
  counter = (counter + 1) % 1000;
  return `${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** The starting setup. Fixed ids, so two tabs opened before anything was saved agree on them. */
export function defaultFields(): Field[] {
  return [
    { id: "weight", name: "Weight", unit: "kg" },
    { id: "bmi", name: "BMI", unit: "" },
    { id: "body-fat", name: "Body fat", unit: "%" },
    { id: "water", name: "Water", unit: "%" },
    { id: "muscle", name: "Muscle", unit: "%" },
  ];
}

export function defaults(): Data {
  return { fields: defaultFields(), sets: [], polarity: "auto", box: { ...DEFAULT_BOX } };
}

/** "Body fat (%)", or just "BMI" when there's no unit. */
export function label(f: { name: string; unit: string }): string {
  const name = f.name.trim() || "Reading";
  const unit = f.unit.trim();
  return unit ? `${name} (${unit})` : name;
}

export type ValueCheck = { ok: true; value: string } | { ok: false; message: string };

/**
 * Tidies a typed or read number. Accepts "72.4", "72,4", " 72.4 " and empty
 * (skipped). A comma becomes a dot so every saved number looks the same.
 */
export function checkValue(text: string): ValueCheck {
  const t = text.trim().replace(/\s+/g, "").replace(",", ".");
  if (t === "") return { ok: true, value: "" };
  if (/^-?\d{1,6}(\.\d{1,4})?$/.test(t)) return { ok: true, value: t };
  return { ok: false, message: "Use numbers only, like 72.4" };
}

/** Local time as "YYYY-MM-DDTHH:mm", the format of a datetime-local input. */
export function localStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** "2026-11-04 07:30": a date spreadsheets recognise. */
export function sheetDate(at: string): string {
  return at.replace("T", " ");
}

/** A friendly date for the history list, like "Wed 4 Nov 2026, 07:30". */
export function friendlyDate(at: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(at);
  if (!m) return at;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return `${day}, ${m[4]}:${m[5]}`;
}

/** Newest first. */
export function sortedSets(sets: SavedSet[]): SavedSet[] {
  return [...sets].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

export interface Column {
  /** Which readings belong here: a field id, or for older data its label and position. */
  key: string;
  /** The heading, made unique ("Reading", "Reading (2)"). */
  heading: string;
}

/** The column a saved reading belongs in. Readings without a field id go by label, and repeats of a label in one set get their own columns. */
function readingKeys(set: SavedSet): string[] {
  const seen = new Map<string, number>();
  return set.readings.map((r) => {
    // A unit change is a different measurement, so it gets its own column; a name change alone doesn't.
    const base = r.fieldId ? fieldKey(r.fieldId, r.unit) : `label:${label(r)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  });
}

function fieldKey(id: string, unit: string): string {
  return `id:${id}|${unit.trim()}`;
}

/**
 * Spreadsheet columns, from the whole history: the current readings first,
 * then any older ones that were renamed or removed since, so no saved number is
 * left out. Every export (all rows or one) uses this same layout, so a copied
 * row lines up under a copied heading. Returns the columns and a lookup from a
 * reading's key to its column.
 */
export function layout(fields: Field[], sets: SavedSet[]): { columns: Column[]; find: (key: string) => number } {
  const labels: string[] = [];
  const keys: string[] = [];
  const pos = new Map<string, number>();
  const add = (key: string, l: string) => {
    if (pos.has(key)) return;
    pos.set(key, labels.length);
    keys.push(key);
    labels.push(l);
  };
  for (const f of fields) add(`${fieldKey(f.id, f.unit)}#1`, label(f));
  // Older readings saved without an id go under the current field with the same label (so the same unit), if there's exactly one.
  for (const f of fields) {
    const l = label(f);
    if (fields.filter((g) => label(g) === l).length === 1) pos.set(`label:${l}#1`, pos.get(`${fieldKey(f.id, f.unit)}#1`)!);
  }
  // Newest first, so a removed field is headed by its most recent name.
  for (const s of sortedSets(sets)) {
    const ks = readingKeys(s);
    s.readings.forEach((r, i) => {
      if (r.value !== "") add(ks[i], label(r));
    });
  }
  // Unique headings: each label keeps its own text the first time; repeats get the
  // lowest "(n)" not already taken by any heading (real or numbered), or by "Date".
  const taken = new Set<string>(["Date", ...labels]);
  const emitted = new Set<string>(["Date"]);
  const columns = labels.map((base, i) => {
    let heading = base;
    if (emitted.has(heading)) {
      let n = 2;
      while (taken.has(`${base} (${n})`)) n++;
      heading = `${base} (${n})`;
      taken.add(heading);
    }
    emitted.add(heading);
    return { key: keys[i], heading };
  });
  return { columns, find: (key) => pos.get(key) ?? -1 };
}

/** Rows for a spreadsheet, oldest first: a heading row, then one row per set in `only` (default: all). */
export function table(fields: Field[], sets: SavedSet[], options: { header?: boolean; only?: string[] } = {}): string[][] {
  const { header = true, only } = options;
  const { columns, find } = layout(fields, sets);
  const rows = sortedSets(sets)
    .reverse()
    .filter((s) => !only || only.includes(s.id))
    .map((s) => {
      const cells = columns.map(() => "");
      const ks = readingKeys(s);
      s.readings.forEach((r, i) => {
        const at = find(ks[i]);
        if (r.value !== "" && at >= 0) cells[at] = r.value;
      });
      return [sheetDate(s.at), ...cells];
    });
  return header ? [["Date", ...columns.map((c) => c.heading)], ...rows] : rows;
}

/**
 * Problems with the setup list, by field id: a reading needs a name, and two
 * readings can't share the same name and unit (they'd be impossible to tell apart).
 */
export function fieldProblems(fields: Field[]): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Map<string, number>();
  for (const f of fields) {
    const k = `${f.name.trim().toLowerCase()}|${f.unit.trim().toLowerCase()}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const f of fields) {
    if (!f.name.trim()) out.set(f.id, "Give this reading a name, like Weight.");
    else if ((seen.get(`${f.name.trim().toLowerCase()}|${f.unit.trim().toLowerCase()}`) ?? 0) > 1)
      out.set(f.id, "Another reading has the same name and unit. Change one of them so they can be told apart.");
  }
  return out;
}

/** Stops a name like "=SUM(...)" being run as a formula when pasted or opened. */
function safeCell(v: string): string {
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** Tab-separated text: pastes straight into spreadsheet cells. */
export function toTSV(rows: string[][]): string {
  return rows.map((r) => r.map((c) => safeCell(c).replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}

export function toCSV(rows: string[][]): string {
  const cell = (c: string) => {
    const v = safeCell(c);
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** Reads saved data defensively; anything malformed is dropped or replaced with defaults. */
export function parseData(raw: unknown): Data {
  const d = defaults();
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;

  if (Array.isArray(o.fields)) {
    const fields = o.fields
      .filter((f): f is Record<string, unknown> => !!f && typeof f === "object")
      .map((f) => ({ id: str(f.id, 40) || newId(), name: str(f.name, 40), unit: str(f.unit, 12) }))
      .slice(0, 20);
    const ids = new Set<string>();
    for (const f of fields) {
      if (ids.has(f.id)) f.id = newId();
      ids.add(f.id);
    }
    if (fields.length) d.fields = fields;
  }

  if (Array.isArray(o.sets)) {
    d.sets = o.sets
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({
        id: str(s.id, 40) || newId(),
        at: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str(s.at, 16)) ? str(s.at, 16) : "",
        readings: Array.isArray(s.readings)
          ? s.readings
              .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
              .map((r) => {
                const c = checkValue(str(r.value, 20));
                const reading: Reading = { name: str(r.name, 40), unit: str(r.unit, 12), value: c.ok ? c.value : "" };
                const fieldId = str(r.fieldId, 40);
                if (fieldId) reading.fieldId = fieldId;
                return reading;
              })
              .slice(0, 20)
          : [],
      }))
      .filter((s) => s.at && s.readings.some((r) => r.value !== ""));
  }

  if (o.polarity === "dark" || o.polarity === "light" || o.polarity === "auto") d.polarity = o.polarity;

  const b = o.box as Record<string, unknown> | undefined;
  if (b && [b.x, b.y, b.w, b.h].every((n) => typeof n === "number" && Number.isFinite(n))) {
    d.box = clampBox({ x: b.x as number, y: b.y as number, w: b.w as number, h: b.h as number });
  }
  return d;
}

/** Keeps the box inside the picture and not too small to hold. */
export function clampBox(b: Box): Box {
  const w = Math.min(1, Math.max(0.12, b.w));
  const h = Math.min(1, Math.max(0.08, b.h));
  return { w, h, x: Math.min(1 - w, Math.max(0, b.x)), y: Math.min(1 - h, Math.max(0, b.y)) };
}
