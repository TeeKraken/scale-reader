import { describe, expect, it } from "vitest";
import { checkValue, clampBox, defaults, fieldProblems, label, layout, parseData, table, toCSV, toTSV, type Field, type SavedSet } from "./records";

const fields: Field[] = [
  { id: "a", name: "Weight", unit: "kg" },
  { id: "b", name: "BMI", unit: "" },
  { id: "c", name: "Body fat", unit: "%" },
];

const sets: SavedSet[] = [
  {
    id: "2",
    at: "2026-11-04T07:30",
    readings: [
      { name: "Weight", unit: "kg", value: "72.4" },
      { name: "BMI", unit: "", value: "23.1" },
      { name: "Body fat", unit: "%", value: "" },
    ],
  },
  {
    id: "1",
    at: "2026-11-03T07:10",
    readings: [
      { name: "Weight", unit: "kg", value: "72.9" },
      { name: "Water", unit: "%", value: "55.2" },
    ],
  },
];

describe("checkValue", () => {
  it("accepts plain numbers and tidies commas and spaces", () => {
    expect(checkValue("72.4")).toEqual({ ok: true, value: "72.4" });
    expect(checkValue(" 72,4 ")).toEqual({ ok: true, value: "72.4" });
    expect(checkValue("105")).toEqual({ ok: true, value: "105" });
    expect(checkValue("")).toEqual({ ok: true, value: "" });
  });
  it("rejects anything that isn't a number", () => {
    expect(checkValue("72.4kg").ok).toBe(false);
    expect(checkValue("7?.4").ok).toBe(false);
    expect(checkValue("=1+1").ok).toBe(false);
    expect(checkValue("1.2.3").ok).toBe(false);
  });
});

describe("label", () => {
  it("adds the unit in brackets when there is one", () => {
    expect(label({ name: "Body fat", unit: "%" })).toBe("Body fat (%)");
    expect(label({ name: "BMI", unit: "" })).toBe("BMI");
    expect(label({ name: " ", unit: "" })).toBe("Reading");
  });
});

describe("table and exports", () => {
  it("puts current readings first, then older ones still in saved rows", () => {
    expect(layout(fields, sets).columns.map((c) => c.heading)).toEqual(["Weight (kg)", "BMI", "Body fat (%)", "Water (%)"]);
  });
  it("lists rows oldest first with blanks for missing readings", () => {
    expect(table(fields, sets)).toEqual([
      ["Date", "Weight (kg)", "BMI", "Body fat (%)", "Water (%)"],
      ["2026-11-03 07:10", "72.9", "", "", "55.2"],
      ["2026-11-04 07:30", "72.4", "23.1", "", ""],
    ]);
  });
  it("makes tab-separated text for pasting", () => {
    expect(toTSV(table(fields, sets, { header: false }))).toBe("2026-11-03 07:10\t72.9\t\t\t55.2\n2026-11-04 07:30\t72.4\t23.1\t\t");
  });
  it("makes CSV with quoting, and defuses formula-like names", () => {
    const csv = toCSV([["Date", 'Fat, "body"', "=cmd"], ["2026-11-04 07:30", "-1.5", "3"]]);
    expect(csv).toBe('Date,"Fat, ""body""",\'=cmd\r\n2026-11-04 07:30,-1.5,3\r\n');
  });
});

describe("parseData", () => {
  it("falls back to defaults for junk", () => {
    expect(parseData(null).fields.length).toBe(defaults().fields.length);
    expect(parseData("nope").sets).toEqual([]);
  });
  it("keeps good rows and drops bad ones", () => {
    const d = parseData({
      fields: [{ id: "a", name: "Weight", unit: "kg" }, 5],
      sets: [
        { id: "x", at: "2026-11-04T07:30", readings: [{ name: "Weight", unit: "kg", value: "72.4" }, { name: "BMI", value: "bad" }] },
        { id: "y", at: "yesterday", readings: [{ name: "Weight", unit: "kg", value: "70" }] },
        { id: "z", at: "2026-11-04T07:30", readings: [{ name: "Weight", unit: "kg", value: "" }] },
      ],
      polarity: "light",
      box: { x: 0.9, y: -1, w: 0.5, h: 0.2 },
    });
    expect(d.fields).toEqual([{ id: "a", name: "Weight", unit: "kg" }]);
    expect(d.sets).toHaveLength(1);
    expect(d.sets[0].readings[1].value).toBe("");
    expect(d.polarity).toBe("light");
    expect(d.box).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.2 });
  });
});

describe("clampBox", () => {
  it("keeps the box inside the picture with a usable size", () => {
    expect(clampBox({ x: -0.1, y: 0.95, w: 0.01, h: 0.01 })).toEqual({ x: 0, y: 0.92, w: 0.12, h: 0.08 });
  });
});

describe("readings with the same or no name", () => {
  it("keeps every value, in separate columns, for two blank readings", () => {
    const f: Field[] = [
      { id: "w", name: "Weight", unit: "kg" },
      { id: "x", name: "", unit: "" },
      { id: "y", name: "", unit: "" },
    ];
    const s: SavedSet[] = [
      {
        id: "1",
        at: "2026-11-04T07:30",
        readings: [
          { fieldId: "w", name: "Weight", unit: "kg", value: "72.4" },
          { fieldId: "x", name: "", unit: "", value: "70" },
          { fieldId: "y", name: "", unit: "", value: "23" },
        ],
      },
    ];
    expect(table(f, s)).toEqual([
      ["Date", "Weight (kg)", "Reading", "Reading (2)"],
      ["2026-11-04 07:30", "72.4", "70", "23"],
    ]);
  });

  it("keeps duplicate name and unit readings apart, including old data saved without ids", () => {
    const f: Field[] = [{ id: "w", name: "Weight", unit: "kg" }];
    const s: SavedSet[] = [
      {
        id: "1",
        at: "2026-11-01T07:00",
        readings: [
          { name: "Weight", unit: "kg", value: "72.4" },
          { name: "Fat", unit: "%", value: "20" },
          { name: "Fat", unit: "%", value: "21" },
        ],
      },
      {
        id: "2",
        at: "2026-11-02T07:00",
        readings: [
          { fieldId: "w", name: "Weight", unit: "kg", value: "72.1" },
          { fieldId: "a", name: "Fat", unit: "%", value: "19" },
          { fieldId: "b", name: "Fat", unit: "%", value: "18" },
        ],
      },
    ];
    const rows = table(f, s);
    expect(rows[0]).toEqual(["Date", "Weight (kg)", "Fat (%)", "Fat (%) (2)", "Fat (%) (3)", "Fat (%) (4)"]);
    // Every saved number appears exactly once.
    const values = rows.slice(1).flatMap((r) => r.slice(1)).filter(Boolean).sort();
    expect(values).toEqual(["18", "19", "20", "21", "72.1", "72.4"]);
    // The old reading without an id goes under the current Weight column.
    expect(rows[1].slice(0, 2)).toEqual(["2026-11-01 07:00", "72.4"]);
  });

  it("flags blank names and duplicate name and unit in setup", () => {
    const p = fieldProblems([
      { id: "a", name: "Weight", unit: "kg" },
      { id: "b", name: " weight ", unit: "KG" },
      { id: "c", name: "", unit: "%" },
      { id: "d", name: "Weight", unit: "lb" },
    ]);
    expect([...p.keys()]).toEqual(["a", "b", "c"]);
    expect(p.get("c")).toMatch(/name/);
    expect(p.get("a")).toMatch(/same name and unit/);
  });
});

describe("copying one row", () => {
  // Current setup: just Weight. One older set had Water, another Body fat.
  const f: Field[] = [{ id: "w", name: "Weight", unit: "kg" }];
  const s: SavedSet[] = [
    {
      id: "old1",
      at: "2026-11-01T08:00",
      readings: [
        { fieldId: "w", name: "Weight", unit: "kg", value: "70" },
        { fieldId: "water", name: "Water", unit: "%", value: "60" },
      ],
    },
    {
      id: "old2",
      at: "2026-11-02T08:00",
      readings: [
        { fieldId: "w", name: "Weight", unit: "kg", value: "71" },
        { fieldId: "fat", name: "Body fat", unit: "%", value: "20" },
      ],
    },
  ];

  it("uses the same columns as Copy all, so it lines up under that heading", () => {
    const all = table(f, s);
    const one = table(f, s, { header: false, only: ["old1"] });
    expect(one).toEqual([all[1]]);
    const heading = all[0];
    const row = table(f, s, { header: false, only: ["old2"] })[0];
    expect(row[heading.indexOf("Body fat (%)")]).toBe("20");
    expect(row[heading.indexOf("Water (%)")]).toBe("");
    expect(toTSV([row])).toBe(toTSV([all[2]]));
  });

  it("puts a renamed reading's old values under its current name", () => {
    const renamed: Field[] = [{ id: "w", name: "Body weight", unit: "kg" }];
    const all = table(renamed, s);
    expect(all[0][1]).toBe("Body weight (kg)");
    expect(table(renamed, s, { header: false, only: ["old2"] })[0][1]).toBe("71");
  });
});
