/**
 * Draws fake seven-segment displays for the reader's tests: digits as segment
 * polygons, with slant, rotation, faint unlit "ghost" segments, uneven light and
 * noise. Only used by tests.
 */
import type { Gray } from "./segments";

export interface SynthOptions {
  /** Digit height in pixels. */
  digitH: number;
  /** Segment thickness as a fraction of digit height. */
  thickness: number;
  /** Gap between neighbouring segments, as a fraction of digit height. */
  gap: number;
  /** Italic slant: horizontal shift per unit of height (0.15 ≈ 8.5°). */
  slant: number;
  /** Rotation of the whole display in degrees. */
  rotate: number;
  /** Standard deviation of pixel noise (0–255 scale). */
  noise: number;
  /** "dark" digits on a light screen (most LCD scales) or "light" on dark (LED). */
  polarity: "dark" | "light";
  /** How visible unlit segments are, 0 (invisible) to 1 (as dark as lit ones). */
  ghost: number;
  /** Brightness change from left to right edge (0–255 scale). */
  gradient: number;
  /** Lit-to-background contrast (0–255 scale). */
  contrast: number;
  /** Box blur radius in pixels, like a slightly out-of-focus photo. */
  blur: number;
  /** Space around the digits, as a fraction of digit height. */
  margin: number;
  /** Digit width as a fraction of its height. */
  aspect: number;
  /** Space between digits, as a fraction of digit height. */
  spacing: number;
  /** Draw a "kg" style label block to the right, smaller than the digits. */
  label: boolean;
  /** Pixels of dark scale bezel caught around the edge of the crop (0 = none). */
  bezel: number;
  /** Which edges the bezel is on. */
  bezelSides: "all" | "top-left";
}

export const DEFAULTS: SynthOptions = {
  digitH: 60,
  thickness: 0.12,
  gap: 0.015,
  slant: 0,
  rotate: 0,
  noise: 0,
  polarity: "dark",
  ghost: 0,
  gradient: 0,
  contrast: 150,
  blur: 0,
  margin: 0.3,
  aspect: 0.55,
  spacing: 0.25,
  label: false,
  bezel: 0,
  bezelSides: "all",
};

const SEGS: Record<string, string> = {
  "0": "abcdef",
  "1": "bc",
  "2": "abdeg",
  "3": "abcdg",
  "4": "bcfg",
  "5": "acdfg",
  "6": "acdefg",
  "7": "abc",
  "8": "abcdefg",
  "9": "abcdfg",
  "-": "g",
};

type Pt = [number, number];

/** A small seeded random number generator (mulberry32), so tests are repeatable. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexH(x0: number, x1: number, y: number, t: number): Pt[] {
  const h = t / 2;
  return [
    [x0, y],
    [x0 + h, y - h],
    [x1 - h, y - h],
    [x1, y],
    [x1 - h, y + h],
    [x0 + h, y + h],
  ];
}

function hexV(x: number, y0: number, y1: number, t: number): Pt[] {
  const h = t / 2;
  return [
    [x, y0],
    [x + h, y0 + h],
    [x + h, y1 - h],
    [x, y1],
    [x - h, y1 - h],
    [x - h, y0 + h],
  ];
}

/** Segment polygons for one digit cell of height H and width W, with its top-left at (ox, 0). */
function segmentPolys(ox: number, H: number, W: number, t: number, g: number): Record<string, Pt[]> {
  const L = ox + t / 2;
  const R = ox + W - t / 2;
  const T = t / 2;
  const M = H / 2;
  const B = H - t / 2;
  return {
    a: hexH(L + g, R - g, T, t),
    g: hexH(L + g, R - g, M, t),
    d: hexH(L + g, R - g, B, t),
    f: hexV(L, T + g, M - g, t),
    e: hexV(L, M + g, B - g, t),
    b: hexV(R, T + g, M - g, t),
    c: hexV(R, M + g, B - g, t),
  };
}

/** Adds a polygon's coverage (0..1) into a supersampled buffer. Scanline fill. */
function fill(buf: Float32Array, w: number, h: number, poly: Pt[], value: number) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of poly) {
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(h - 1, Math.ceil(maxY)); y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      if ((y1 <= cy && y2 > cy) || (y2 <= cy && y1 > cy)) xs.push(x1 + ((cy - y1) * (x2 - x1)) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(w - 1, Math.floor(xs[k + 1] - 0.5)); x++) {
        const i = y * w + x;
        buf[i] = Math.max(buf[i], value);
      }
    }
  }
}

/** Renders `text` (digits, "-" and ".") as a seven-segment display. */
export function render(text: string, partial: Partial<SynthOptions> = {}, random: () => number = rng(1)): Gray {
  const o = { ...DEFAULTS, ...partial };
  const S = 3; // supersampling
  const H = o.digitH;
  const t = o.thickness * H;
  const g = o.gap * H;
  const W = o.aspect * H;
  const space = o.spacing * H;
  const margin = o.margin * H;

  // Lay out digit cells and dots.
  const chars = text.split("");
  const lit: Pt[][] = [];
  const ghost: Pt[][] = [];
  let x = margin + Math.abs(o.slant) * H;
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === ".") continue;
    const polys = segmentPolys(x, H, W, t, g);
    const on = SEGS[ch] ?? "";
    for (const [name, poly] of Object.entries(polys)) (on.includes(name) ? lit : ghost).push(poly);
    x += W;
    if (chars[i + 1] === ".") {
      const d = Math.min(t * 1.15, space * 0.6); // the dot sits in the gap between digits
      const cx = x + space / 2;
      lit.push([
        [cx - d / 2, H - d],
        [cx + d / 2, H - d],
        [cx + d / 2, H],
        [cx - d / 2, H],
      ]);
    }
    x += space;
  }
  if (o.label) {
    // A small unit label ("kg"), top-aligned, about 40% of the digit height.
    const lw = 0.5 * H;
    const lh = 0.35 * H;
    const k = Math.max(1.5, t * 0.6);
    lit.push(
      [[x, 0], [x + k, 0], [x + k, lh], [x, lh]],
      [[x + k, lh * 0.5], [x + lw * 0.4, 0], [x + lw * 0.4 + k, 0], [x + k * 2, lh * 0.5], [x + lw * 0.4 + k, lh], [x + lw * 0.4, lh]],
      [[x + lw * 0.6, 0], [x + lw, 0], [x + lw, lh], [x + lw * 0.6, lh]],
    );
    x += lw + space;
  }
  const contentW = x - space + margin + Math.abs(o.slant) * H;
  const contentH = H + 2 * margin;

  // Slant (about the digits' baseline), rotate about the centre, then offset into the picture.
  const rad = (o.rotate * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = contentW / 2;
  const cy = contentH / 2;
  const transform = ([px, py]: Pt): Pt => {
    const sx = px + o.slant * (H - py);
    const sy = py + margin;
    const rx = cx + (sx - cx) * cos - (sy - cy) * sin;
    const ry = cy + (sx - cx) * sin + (sy - cy) * cos;
    return [rx * S, ry * S];
  };
  const width = Math.ceil(contentW);
  const height = Math.ceil(contentH);
  const bw = width * S;
  const bh = height * S;
  const cover = new Float32Array(bw * bh);
  for (const p of ghost) if (o.ghost > 0) fill(cover, bw, bh, p.map(transform), o.ghost);
  for (const p of lit) fill(cover, bw, bh, p.map(transform), 1);

  if (o.blur > 0) blurBox(cover, bw, bh, Math.round(o.blur * S));
  const bg = o.polarity === "dark" ? 205 : 25;
  const fg = o.polarity === "dark" ? bg - o.contrast : bg + o.contrast;
  const data = new Uint8Array(width * height);
  for (let yy = 0; yy < height; yy++) {
    for (let xx = 0; xx < width; xx++) {
      let c = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) c += cover[(yy * S + sy) * bw + xx * S + sx];
      c /= S * S;
      let v = bg + (fg - bg) * c + o.gradient * (xx / width - 0.5);
      if (o.noise > 0) {
        // Box–Muller
        const u = Math.max(1e-9, random());
        const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
        v += n * o.noise;
      }
      data[yy * width + xx] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return o.bezel > 0 ? addBezel({ width, height, data }, o.bezel, o.bezelSides) : { width, height, data };
}

function addBezel(img: Gray, px: number, sides: "all" | "top-left"): Gray {
  const right = sides === "all" ? px : 0;
  const width = img.width + px + right;
  const height = img.height + px + right;
  const data = new Uint8Array(width * height).fill(45);
  for (let y = 0; y < img.height; y++) data.set(img.data.subarray(y * img.width, (y + 1) * img.width), (y + px) * width + px);
  return { width, height, data };
}

/** A random reading like a scale shows: "72.4", "23.1", "105.8", "8.8". */
export function randomReading(random: () => number): string {
  const intDigits = 1 + Math.floor(random() * 3);
  let s = "";
  for (let i = 0; i < intDigits; i++) s += String(i === 0 && intDigits > 1 ? 1 + Math.floor(random() * 9) : Math.floor(random() * 10));
  const decimals = random() < 0.75 ? 1 : random() < 0.5 ? 0 : 2;
  if (decimals) {
    s += ".";
    for (let i = 0; i < decimals; i++) s += String(Math.floor(random() * 10));
  }
  return s;
}

/** In-place box blur (horizontal then vertical). */
function blurBox(buf: Float32Array, w: number, h: number, r: number) {
  const tmp = new Float32Array(buf.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let d = -r; d <= r; d++) {
        const xx = x + d;
        if (xx >= 0 && xx < w) {
          s += buf[y * w + xx];
          n++;
        }
      }
      tmp[y * w + x] = s / n;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      let n = 0;
      for (let d = -r; d <= r; d++) {
        const yy = y + d;
        if (yy >= 0 && yy < h) {
          s += tmp[yy * w + x];
          n++;
        }
      }
      buf[y * w + x] = s / n;
    }
  }
}
