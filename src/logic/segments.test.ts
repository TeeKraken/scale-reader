import { describe, expect, it } from "vitest";
import { decodeSegments, readSevenSegment, resizeToHeight, toGray } from "./segments";
import { randomReading, render, rng, type SynthOptions } from "./synth";

const bits = (s: string) => s.split("").map((c) => c === "1");

describe("decodeSegments", () => {
  it("decodes every digit", () => {
    expect(decodeSegments(bits("1111110")).char).toBe("0");
    expect(decodeSegments(bits("0110000")).char).toBe("1");
    expect(decodeSegments(bits("1101101")).char).toBe("2");
    expect(decodeSegments(bits("1111001")).char).toBe("3");
    expect(decodeSegments(bits("0110011")).char).toBe("4");
    expect(decodeSegments(bits("1011011")).char).toBe("5");
    expect(decodeSegments(bits("1011111")).char).toBe("6");
    expect(decodeSegments(bits("1110000")).char).toBe("7");
    expect(decodeSegments(bits("1111111")).char).toBe("8");
    expect(decodeSegments(bits("1111011")).char).toBe("9");
    expect(decodeSegments(bits("0000001")).char).toBe("-");
  });
  it("accepts the common 6, 7 and 9 variants", () => {
    expect(decodeSegments(bits("0011111")).char).toBe("6");
    expect(decodeSegments(bits("1110010")).char).toBe("7");
    expect(decodeSegments(bits("1110011")).char).toBe("9");
  });
  it("guesses only when one segment away from a single digit", () => {
    // 0 with the bottom segment missing: only 0 is one away? (also 7 variant "1110010" is 2 away)
    const r = decodeSegments(bits("1111100"));
    expect(r.guessed).toBe(true);
    expect(r.char).toBe("0");
    expect(decodeSegments(bits("0000000")).char).toBe("?");
  });
});

describe("toGray and resize", () => {
  it("converts RGBA to grey", () => {
    const g = toGray(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1);
    expect(g.data[0]).toBeGreaterThan(250);
    expect(g.data[1]).toBe(0);
  });
  it("resizes to a height, keeping the shape", () => {
    const img = { width: 200, height: 100, data: new Uint8Array(200 * 100).fill(100) };
    const r = resizeToHeight(img, 50);
    expect(r.width).toBe(100);
    expect(r.data.every((v) => v === 100)).toBe(true);
  });
});

describe("readSevenSegment on clean displays", () => {
  for (const text of ["0123456789", "72.4", "8.8", "105.8", "23.15", "1", "11.1", "8-8"]) {
    it(`reads ${text}`, () => {
      expect(readSevenSegment(render(text)).text).toBe(text);
    });
  }
  it("reads light digits on a dark screen", () => {
    expect(readSevenSegment(render("68.2", { polarity: "light" })).text).toBe("68.2");
  });
  it("honours a forced polarity", () => {
    const r = readSevenSegment(render("68.2", { polarity: "light" }), { polarity: "light" });
    expect(r.text).toBe("68.2");
    expect(r.polarity).toBe("light");
  });
  it("returns nothing for a blank picture", () => {
    const r = readSevenSegment({ width: 120, height: 60, data: new Uint8Array(120 * 60).fill(180) });
    expect(r.text).toBe("");
    expect(r.value).toBeNull();
    expect(r.unsure).toBe(true);
  });
  it("gives the number when the text is clean", () => {
    expect(readSevenSegment(render("72.4")).value).toBe(72.4);
  });
});

/**
 * Accuracy across generated displays. Each group varies one thing; "hard"
 * combines several. A reading counts only when every character matches.
 */
type Group = { name: string; vary: (r: () => number) => Partial<SynthOptions>; min: number };

const pick = <T,>(r: () => number, list: T[]) => list[Math.floor(r() * list.length)];

const GROUPS: Group[] = [
  { name: "clean, mixed thickness", vary: (r) => ({ thickness: pick(r, [0.07, 0.1, 0.13, 0.16, 0.19]) }), min: 0.97 },
  { name: "small and large crops", vary: (r) => ({ digitH: pick(r, [24, 32, 48, 90, 160]) }), min: 0.97 },
  { name: "noise", vary: (r) => ({ noise: pick(r, [8, 16, 24]) }), min: 0.97 },
  { name: "italic slant", vary: (r) => ({ slant: pick(r, [-0.1, 0.08, 0.12, 0.18, 0.25]) }), min: 0.97 },
  { name: "slight rotation (±3°)", vary: (r) => ({ rotate: (r() * 2 - 1) * 3 }), min: 0.97 },
  { name: "light on dark", vary: (r) => ({ polarity: "light", thickness: pick(r, [0.08, 0.12, 0.16]) }), min: 0.97 },
  { name: "faint unlit segments", vary: (r) => ({ ghost: pick(r, [0.1, 0.2, 0.3]) }), min: 0.97 },
  { name: "uneven light", vary: (r) => ({ gradient: pick(r, [-90, -60, 60, 90]) }), min: 0.97 },
  { name: "no gaps between segments", vary: () => ({ gap: 0 }), min: 0.97 },
  { name: "low contrast", vary: (r) => ({ contrast: pick(r, [50, 70]), noise: 6 }), min: 0.97 },
  { name: "slightly blurry", vary: (r) => ({ blur: pick(r, [1, 2, 3]), noise: 4 }), min: 0.97 },
  { name: "tight crop", vary: (r) => ({ margin: pick(r, [0.05, 0.1, 0.15]) }), min: 0.97 },
  { name: "narrow and wide digits", vary: (r) => ({ aspect: pick(r, [0.42, 0.5, 0.62, 0.7]) }), min: 0.97 },
  { name: "close together", vary: (r) => ({ spacing: pick(r, [0.1, 0.15]) }), min: 0.97 },
  { name: "unit label beside digits", vary: () => ({ label: true }), min: 0.97 },
  {
    name: "hard: several at once",
    vary: (r) => ({
      thickness: pick(r, [0.08, 0.12, 0.17]),
      noise: pick(r, [6, 12, 18]),
      slant: pick(r, [0, 0.1, 0.18]),
      rotate: (r() * 2 - 1) * 2,
      ghost: pick(r, [0, 0.15, 0.25]),
      gradient: pick(r, [-50, 0, 50]),
      polarity: pick(r, ["dark", "light"] as const),
      digitH: pick(r, [36, 60, 100]),
      blur: pick(r, [0, 1, 2]),
      margin: pick(r, [0.1, 0.3]),
    }),
    min: 0.88,
  },
  // Past what the reader is built for. Reported with no bar, so the limits are on record.
  ...(
    [
      ["very thin segments (5%)", { thickness: 0.05 }],
      ["very thick segments (24%)", { thickness: 0.24 }],
      ["heavy noise", { noise: 32 }],
      ["rotated 6°", { rotate: 6 }],
      ["strong unlit segments (45%)", { ghost: 0.45 }],
      ["very low contrast", { contrast: 40, noise: 6 }],
      ["quite blurry", { blur: 4 }],
      ["tiny (16 px digits)", { digitH: 16 }],
      ["digits nearly touching", { spacing: 0.06 }],
      ["strong slant (0.35)", { slant: 0.35 }],
    ] as [string, Partial<SynthOptions>][]
  ).map(([name, o]): Group => ({ name: `stress: ${name}`, vary: () => o, min: 0 })),
];

const PER_GROUP = 120;

describe("readSevenSegment accuracy on generated displays", () => {
  const results: { group: string; right: number; total: number; misses: string[] }[] = [];

  for (const group of GROUPS) {
    it(group.min ? `${group.name}: at least ${Math.round(group.min * 100)}% read exactly` : `${group.name} (reported only)`, () => {
      const r = rng(group.name.length * 7919 + 13);
      let right = 0;
      const misses: string[] = [];
      for (let i = 0; i < PER_GROUP; i++) {
        const text = randomReading(r);
        const opts = group.vary(r);
        const got = readSevenSegment(render(text, opts, r)).text;
        if (got === text) right++;
        else if (misses.length < 6) misses.push(`${text}→${got || "(nothing)"}`);
      }
      results.push({ group: group.name, right, total: PER_GROUP, misses });
      expect(right / PER_GROUP, misses.join(", ")).toBeGreaterThanOrEqual(group.min);
    });
  }

  it("reports the accuracy table", () => {
    let right = 0;
    let total = 0;
    const lines = results.map((x) => {
      if (!x.group.startsWith("stress")) {
        right += x.right;
        total += x.total;
      }
      return `${x.group.padEnd(34)} ${String(x.right).padStart(3)}/${x.total}  ${((100 * x.right) / x.total).toFixed(1)}%${x.misses.length ? "  e.g. " + x.misses.join(", ") : ""}`;
    });
    lines.push(`${"all except stress".padEnd(34)} ${right}/${total}  ${((100 * right) / total).toFixed(1)}%`);
    console.log("\nSeven-segment reader accuracy (exact match):\n" + lines.join("\n"));
    expect(results).toHaveLength(GROUPS.length);
  });
});
