/**
 * A reader for seven-segment digits, the blocky numbers on basic scales, clocks
 * and meters. General text recognition reads these badly, so this does the
 * simple, specific thing instead:
 *
 *  1. Turn the cropped picture grey and scale it to a fixed height.
 *  2. Adaptive threshold: a pixel is "lit" if it's closer to the nearby digit
 *     colour than to the nearby screen colour. That copes with shadows and
 *     uneven light, and with faint unlit segments some screens show.
 *  3. Drop specks, find the band of rows the digits sit in, and undo any slant
 *     (italic digits, or a phone held at a slight angle).
 *  4. Find decimal points (small dots at the bottom between digits), then split
 *     the band into digit cells by the empty columns between them.
 *  5. In each cell, look at the seven places a segment can be and decode the
 *     pattern of lit segments into a digit.
 *
 * Pure functions on plain arrays; no DOM. Tested against generated images in
 * segments.test.ts.
 */

export type Polarity = "auto" | "dark" | "light";

/** A greyscale picture, one byte per pixel, row by row. */
export interface Gray {
  width: number;
  height: number;
  data: Uint8Array | Uint8ClampedArray;
}

export interface DigitRead {
  /** "0"–"9", "-", or "?" when the segments don't make a digit. */
  char: string;
  /** Lit segments, in the order a b c d e f g. */
  segments: boolean[];
  /** True when the pattern was one segment away from a digit and we guessed. */
  guessed: boolean;
}

export interface ReadResult {
  /** What was read, like "72.4". Empty when nothing was found. */
  text: string;
  /** The number, or null if the text isn't a clean number. */
  value: number | null;
  digits: DigitRead[];
  /** True when nothing was found, or some digit was a guess or unreadable. */
  unsure: boolean;
  /** Which way round the digits were: dark on light, or light on dark. */
  polarity: "dark" | "light";
  /** The lit/unlit picture the reader worked from (1 = lit), for showing the user. */
  mask: { width: number; height: number; data: Uint8Array };
}

/** The height every crop is scaled to before reading. */
export const WORK_HEIGHT = 96;

// Segment order: a (top), b (top right), c (bottom right), d (bottom), e (bottom left), f (top left), g (middle).
const PATTERNS: Record<string, string[]> = {
  "0": ["1111110"],
  "1": ["0110000"],
  "2": ["1101101"],
  "3": ["1111001"],
  "4": ["0110011"],
  "5": ["1011011"],
  "6": ["1011111", "0011111"],
  "7": ["1110000", "1110010"],
  "8": ["1111111"],
  "9": ["1111011", "1110011"],
  "-": ["0000001"],
};

const LOOKUP = new Map<string, string>();
for (const [ch, list] of Object.entries(PATTERNS)) for (const p of list) LOOKUP.set(p, ch);

const flags = (p: string) => p.split("").map((v) => v === "1");

/** Decodes seven lit/unlit flags (a–g) into a character. A digit one segment off is guessed. */
export function decodeSegments(seg: boolean[]): { char: string; guessed: boolean } {
  const key = seg.map((s) => (s ? "1" : "0")).join("");
  const exact = LOOKUP.get(key);
  if (exact) return { char: exact, guessed: false };
  const near = new Set<string>();
  for (const [p, ch] of LOOKUP) {
    if (ch === "-") continue;
    let d = 0;
    for (let i = 0; i < 7; i++) if (p[i] !== key[i]) d++;
    if (d === 1) near.add(ch);
  }
  return near.size === 1 ? { char: [...near][0], guessed: true } : { char: "?", guessed: false };
}

/** RGBA pixels (from a canvas) to grey. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Gray {
  const data = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    data[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  }
  return { width, height, data };
}

/** Resizes to the given height (keeping the shape), averaging when shrinking. */
export function resizeToHeight(img: Gray, height: number): Gray {
  const width = Math.max(1, Math.round((img.width * height) / img.height));
  const out = new Uint8Array(width * height);
  const sx = img.width / width;
  const sy = img.height / height;
  for (let y = 0; y < height; y++) {
    const ya = Math.min(img.height - 1, Math.floor(y * sy));
    const yb = Math.max(ya + 1, Math.min(img.height, Math.floor((y + 1) * sy)));
    for (let x = 0; x < width; x++) {
      const xa = Math.min(img.width - 1, Math.floor(x * sx));
      const xb = Math.max(xa + 1, Math.min(img.width, Math.floor((x + 1) * sx)));
      let sum = 0;
      for (let yy = ya; yy < yb; yy++) for (let xx = xa; xx < xb; xx++) sum += img.data[yy * img.width + xx];
      out[y * width + x] = Math.round(sum / ((yb - ya) * (xb - xa)));
    }
  }
  return { width, height, data: out };
}

function histogram(data: ArrayLike<number>): Uint32Array {
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;
  return hist;
}

function percentile(hist: Uint32Array, total: number, p: number): number {
  const target = p * total;
  let acc = 0;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= target) return v;
  }
  return 255;
}

/** Otsu's threshold: the grey level that best splits the picture into two groups. */
export function otsu(hist: Uint32Array, total: number): number {
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * hist[v];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  return best;
}

/** Dark digits if the crop's border is lighter than the middle of its brightness range. */
export function guessPolarity(img: Gray): "dark" | "light" {
  const { width: w, height: h, data } = img;
  const border: number[] = [];
  for (let x = 0; x < w; x++) border.push(data[x], data[(h - 1) * w + x]);
  for (let y = 0; y < h; y++) border.push(data[y * w], data[y * w + w - 1]);
  border.sort((p, q) => p - q);
  const hist = histogram(data);
  const mid = (percentile(hist, data.length, 0.02) + percentile(hist, data.length, 0.98)) / 2;
  return border[Math.floor(border.length / 2)] >= mid ? "dark" : "light";
}

/**
 * Lit pixels. The picture is first split into "digit-ish" and "screen-ish"
 * pixels (Otsu). Then each pixel is compared with the average of each group in a
 * large neighbourhood, and counts as lit when it's nearer the digit colour.
 */
export function adaptiveThreshold(img: Gray, polarity: "dark" | "light"): Uint8Array {
  const { width: w, height: h, data } = img;
  const out = new Uint8Array(w * h);
  const hist = histogram(data);
  const lo = percentile(hist, data.length, 0.01);
  const hi = percentile(hist, data.length, 0.99);
  if (hi - lo < 20) return out; // a flat picture: nothing to read
  const t = otsu(hist, data.length);

  // Integral images: sum and count of digit-side pixels, sum and count of screen-side pixels.
  const W1 = w + 1;
  const fgSum = new Float64Array(W1 * (h + 1));
  const fgN = new Float64Array(W1 * (h + 1));
  const bgSum = new Float64Array(W1 * (h + 1));
  const bgN = new Float64Array(W1 * (h + 1));
  let fgAll = 0;
  let fgAllN = 0;
  let bgAll = 0;
  let bgAllN = 0;
  for (let y = 0; y < h; y++) {
    let fs = 0;
    let fn = 0;
    let bs = 0;
    let bn = 0;
    for (let x = 0; x < w; x++) {
      const v = data[y * w + x];
      const isFg = polarity === "dark" ? v <= t : v > t;
      if (isFg) {
        fs += v;
        fn++;
      } else {
        bs += v;
        bn++;
      }
      const i = (y + 1) * W1 + x + 1;
      const above = y * W1 + x + 1;
      fgSum[i] = fgSum[above] + fs;
      fgN[i] = fgN[above] + fn;
      bgSum[i] = bgSum[above] + bs;
      bgN[i] = bgN[above] + bn;
    }
    fgAll += fs;
    fgAllN += fn;
    bgAll += bs;
    bgAllN += bn;
  }
  if (!fgAllN || !bgAllN) return out;
  const fgGlobal = fgAll / fgAllN;
  const bgGlobal = bgAll / bgAllN;
  const minContrast = Math.max(14, (hi - lo) * 0.2);

  const r = Math.max(6, Math.round(h * 0.5));
  const box = (a: Float64Array, xa: number, ya: number, xb: number, yb: number) =>
    a[yb * W1 + xb] - a[ya * W1 + xb] - a[yb * W1 + xa] + a[ya * W1 + xa];
  const k = 20; // blend toward the global level when a neighbourhood has few pixels of a group
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r);
    const yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r);
      const xb = Math.min(w, x + r + 1);
      const fn = box(fgN, xa, ya, xb, yb);
      const bn = box(bgN, xa, ya, xb, yb);
      const fg = (box(fgSum, xa, ya, xb, yb) + fgGlobal * k) / (fn + k);
      const bg = (box(bgSum, xa, ya, xb, yb) + bgGlobal * k) / (bn + k);
      if (Math.abs(bg - fg) < minContrast) continue;
      const v = data[y * w + x];
      out[y * w + x] = Math.abs(v - fg) < Math.abs(v - bg) ? 1 : 0;
    }
  }
  return out;
}

interface Blob {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  area: number;
  pixels: number[];
}

/** Groups touching lit pixels (8-connected). */
function components(mask: Uint8Array, w: number, h: number): Blob[] {
  const seen = new Uint8Array(w * h);
  const blobs: Blob[] = [];
  const stack: number[] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const blob: Blob = { x0: w, y0: h, x1: -1, y1: -1, area: 0, pixels: [] };
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % w;
      const y = (p - x) / w;
      blob.pixels.push(p);
      blob.area++;
      if (x < blob.x0) blob.x0 = x;
      if (x > blob.x1) blob.x1 = x;
      if (y < blob.y0) blob.y0 = y;
      if (y > blob.y1) blob.y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const q = ny * w + nx;
          if (mask[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    blobs.push(blob);
  }
  return blobs;
}

/** Runs of true values, merging runs separated by gaps of at most `gap`. */
function runs(on: boolean[], gap: number): [number, number][] {
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= on.length; i++) {
    if (i < on.length && on[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      const last = out[out.length - 1];
      if (last && start - last[1] - 1 <= gap) last[1] = i - 1;
      else out.push([start, i - 1]);
      start = -1;
    }
  }
  return out;
}

/** Reads the digits in a cropped picture of a seven-segment display. */
export function readSevenSegment(input: Gray, options: { polarity?: Polarity } = {}): ReadResult {
  const img = input.height === WORK_HEIGHT ? input : resizeToHeight(input, WORK_HEIGHT);
  const polarity = options.polarity ?? "auto";
  if (polarity !== "auto") return readWith(img, polarity);
  const first = guessPolarity(img);
  const a = readWith(img, first);
  if (!a.unsure) return a;
  const b = readWith(img, first === "dark" ? "light" : "dark");
  return !b.unsure && b.digits.length >= a.digits.length ? b : a;
}

function readWith(img: Gray, polarity: "dark" | "light"): ReadResult {
  const { width: w, height: h } = img;
  const raw = adaptiveThreshold(img, polarity);

  // Drop specks.
  const minArea = Math.max(6, Math.round(h * h * 0.0009));
  const mask = new Uint8Array(w * h);
  for (const b of components(raw, w, h)) {
    if (b.area >= minArea) for (const p of b.pixels) mask[p] = 1;
  }

  const result = (text: string, digits: DigitRead[]): ReadResult => ({
    text,
    value: /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : null,
    digits,
    unsure: digits.length === 0 || digits.some((d) => d.char === "?" || d.guessed),
    polarity,
    mask: { width: w, height: h, data: mask },
  });

  // The band of rows the digits sit in: the tallest run of rows with lit pixels.
  const rowHas: boolean[] = [];
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = 0; x < w; x++) n += mask[y * w + x];
    rowHas.push(n > 0);
  }
  const rowRuns = runs(rowHas, Math.round(h * 0.08));
  if (!rowRuns.length) return result("", []);
  const [top, bottom] = rowRuns.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
  const H = bottom - top + 1;
  if (H < h * 0.25) return result("", []);

  // Undo slant: try shears and rank them by how well columns line up (the sum of
  // squared column counts peaks when vertical segments are upright). Some digit
  // pairs (like 2 and 5) also line up at a wrong slant, so the best few are
  // decoded and the first one that reads cleanly wins.
  const yc = (top + bottom) / 2;
  const pad = Math.ceil(0.45 * H);
  const W2 = w + 2 * pad;
  const scores: { s: number; sc: number }[] = [];
  for (let i = -20; i <= 20; i++) {
    const s = i * 0.02;
    const cols = new Float64Array(W2);
    for (let y = top; y <= bottom; y++) {
      // Only rows where vertical segments are, away from the horizontal ones.
      const f = (y - top) / H;
      if (f < 0.15 || (f > 0.4 && f < 0.6) || f > 0.85) continue;
      const shift = Math.round(s * (y - yc)) + pad;
      for (let x = 0; x < w; x++) if (mask[y * w + x]) cols[x + shift]++;
    }
    let sc = 0;
    for (let j = 0; j < W2; j++) sc += cols[j] * cols[j];
    scores.push({ s, sc: sc * (1 - Math.abs(s) * 0.05) }); // prefer upright on a near tie
  }
  const peaks = scores
    .filter((p, i) => (i === 0 || p.sc >= scores[i - 1].sc) && (i === scores.length - 1 || p.sc >= scores[i + 1].sc))
    .sort((a, b) => b.sc - a.sc)
    .map((p) => p.s);
  const candidates = [...new Set([peaks[0], ...peaks.slice(1, 3), 0])];
  // A wrong slant tends to merge a dot into a digit, so among clean readings the
  // one that found the most (digits and dot) wins; ties go to the better line-up.
  const reads = candidates.map((s) => decodeBand(mask, w, top, bottom, s, pad, result));
  const clean = reads.filter((r) => !r.unsure);
  if (!clean.length) return reads[0];
  return clean.reduce((best, r) => (r.text.length > best.text.length ? r : best));
}

/** Shears the digit band upright by `shear`, then finds dots and digits in it. */
function decodeBand(
  mask: Uint8Array,
  w: number,
  top: number,
  bottom: number,
  shear: number,
  pad: number,
  result: (text: string, digits: DigitRead[]) => ReadResult,
): ReadResult {
  const H = bottom - top + 1;
  const yc = (top + bottom) / 2;
  const W2 = w + 2 * pad;
  const band = new Uint8Array(W2 * H);
  for (let y = top; y <= bottom; y++) {
    const shift = Math.round(shear * (y - yc)) + pad;
    for (let x = 0; x < w; x++) if (mask[y * w + x]) band[(y - top) * W2 + x + shift] = 1;
  }

  // Decimal points: small, roundish blobs sitting at the bottom of the band.
  const dots: number[] = [];
  for (const b of components(band, W2, H)) {
    const bw = b.x1 - b.x0 + 1;
    const bh = b.y1 - b.y0 + 1;
    const ratio = bw / bh;
    if (bw > 0.25 * H || bh > 0.25 * H || b.y1 < 0.85 * H || b.y0 < 0.6 * H || ratio < 0.4 || ratio > 2.5) continue;
    // A dot sits in a gap: nothing above it. (A short bottom segment has the rest of its digit above.)
    let above = false;
    for (let y = 0; y < Math.round(0.55 * H) && !above; y++) {
      for (let x = b.x0 + 1; x <= b.x1 - 1 && !above; x++) above = band[y * W2 + x] === 1;
    }
    if (!above) {
      dots.push((b.x0 + b.x1) / 2);
      for (const p of b.pixels) band[p] = 0;
    }
  }

  // Digit cells: runs of columns with lit pixels.
  const colHas: boolean[] = [];
  for (let x = 0; x < W2; x++) {
    let n = 0;
    for (let y = 0; y < H; y++) n += band[y * W2 + x];
    colHas.push(n > 0);
  }
  const cells: { x0: number; x1: number; y0: number; y1: number }[] = [];
  for (const [x0, x1] of runs(colHas, Math.max(1, Math.round(H * 0.03)))) {
    let y0 = H;
    let y1 = -1;
    for (let y = 0; y < H; y++) {
      for (let x = x0; x <= x1; x++) {
        if (band[y * W2 + x]) {
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    cells.push({ x0, x1, y0, y1 });
  }

  const tall = cells.filter((c) => c.y1 - c.y0 + 1 >= 0.6 * H);
  const wide = tall
    .map((c) => c.x1 - c.x0 + 1)
    .filter((cw) => cw > 0.3 * H)
    .sort((a, b) => a - b);
  const digitW = wide.length ? wide[wide.length - 1] : 0.55 * H;

  const items: { x: number; read: DigitRead | null }[] = dots.map((x) => ({ x, read: null }));
  for (const c of cells) {
    const cw = c.x1 - c.x0 + 1;
    const ch = c.y1 - c.y0 + 1;
    const x = (c.x0 + c.x1) / 2;
    if (ch >= 0.6 * H) {
      if (cw < 0.5 * digitW) {
        items.push({ x, read: { char: "1", segments: flags(PATTERNS["1"][0]), guessed: false } });
      } else {
        // A 7 has no left-hand segments, so its cell is narrower than the others:
        // line it up on the right, where its segments are.
        const x0 = cw < 0.9 * digitW ? Math.max(0, Math.round(c.x1 - digitW + 1)) : c.x0;
        const segments = sampleSegments(band, W2, x0, c.x1, H);
        const { char, guessed } = decodeSegments(segments);
        items.push({ x, read: { char, segments, guessed } });
      }
    } else if (c.y0 > 0.3 * H && c.y1 < 0.7 * H && cw >= 0.2 * H) {
      items.push({ x, read: { char: "-", segments: flags(PATTERNS["-"][0]), guessed: false } });
    }
    // Anything else (unit labels, icons, leftovers) is ignored.
  }
  items.sort((a, b) => a.x - b.x);

  // Keep one dot, and only between digits.
  const firstDigit = items.findIndex((i) => i.read);
  let lastDigit = -1;
  items.forEach((i, n) => {
    if (i.read) lastDigit = n;
  });
  let text = "";
  const digits: DigitRead[] = [];
  let dotUsed = false;
  items.forEach((item, n) => {
    if (item.read) {
      digits.push(item.read);
      text += item.read.char;
    } else if (firstDigit >= 0 && n > firstDigit && n < lastDigit && !dotUsed) {
      text += ".";
      dotUsed = true;
    }
  });
  return result(text, digits);
}

/**
 * Which of the seven segments are lit in one digit cell. Each segment is checked
 * with several short scan lines across where it should be; it counts as lit when
 * most of them cross lit pixels. That works for thin and thick digits alike.
 */
function sampleSegments(band: Uint8Array, stride: number, x0: number, x1: number, H: number): boolean[] {
  const w = x1 - x0 + 1;
  const lit = (x: number, y: number) => band[y * stride + x] === 1;

  // Horizontal segment: vertical scan lines through the middle of the cell, within rows [ya, yb).
  const horizontal = (ya: number, yb: number) => {
    const xs = spread(x0 + w * 0.4, x0 + w * 0.6, 5);
    let hits = 0;
    for (const x of xs) {
      let hit = false;
      for (let y = Math.floor(ya * H); y < Math.min(H, Math.ceil(yb * H)) && !hit; y++) hit = lit(x, y);
      if (hit) hits++;
    }
    return hits / xs.length > 0.5;
  };
  // Vertical segment: horizontal scan lines across one side of the cell, within rows [ya, yb].
  const vertical = (left: boolean, ya: number, yb: number) => {
    const ys = spread(ya * H, yb * H, 5);
    const xa = left ? x0 : Math.round(x1 - w * 0.4);
    const xb = left ? Math.round(x0 + w * 0.4) : x1;
    let hits = 0;
    for (const y of ys) {
      let hit = false;
      for (let x = xa; x <= xb && !hit; x++) hit = lit(x, y);
      if (hit) hits++;
    }
    return hits / ys.length > 0.5;
  };

  return [
    horizontal(0, 0.3), // a
    vertical(false, 0.24, 0.38), // b
    vertical(false, 0.62, 0.76), // c
    horizontal(0.7, 1), // d
    vertical(true, 0.62, 0.76), // e
    vertical(true, 0.24, 0.38), // f
    horizontal(0.36, 0.64), // g
  ];
}

function spread(a: number, b: number, n: number): number[] {
  const out = new Set<number>();
  for (let i = 0; i < n; i++) out.add(Math.round(a + ((b - a) * i) / (n - 1)));
  return [...out];
}
