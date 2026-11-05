// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const html = readFileSync(`${process.cwd()}/index.html`, "utf8");
const body = html.slice(html.indexOf("<body>") + 6, html.indexOf("</body>")).replace(/<script[\s\S]*?<\/script>/g, "");

async function openApp() {
  document.body.innerHTML = body;
  vi.resetModules();
  await import("./main");
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const readingInputs = () => [...document.querySelectorAll<HTMLInputElement>(".reading input")];
function type(input: HTMLInputElement, value: string) {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const saved = () => JSON.parse(localStorage.getItem("scale-reader:v1") ?? "{}");
const save = () => $<HTMLFormElement>("#set-form").dispatchEvent(new Event("submit", { cancelable: true }));

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

describe("the weigh-in date", () => {
  it("catches up when the first number is typed after the page was left open overnight", async () => {
    vi.setSystemTime(new Date(2026, 10, 4, 8, 0));
    await openApp();
    expect($<HTMLInputElement>("#when").value).toBe("2026-11-04T08:00");
    vi.setSystemTime(new Date(2026, 10, 5, 7, 45));
    type(readingInputs()[0], "72.4");
    expect($<HTMLInputElement>("#when").value).toBe("2026-11-05T07:45");
    // Later numbers in the same weigh-in don't move it again.
    vi.setSystemTime(new Date(2026, 10, 5, 7, 50));
    type(readingInputs()[1], "23.1");
    save();
    expect(saved().sets[0].at).toBe("2026-11-05T07:45");
  });

  it("keeps a date you chose yourself", async () => {
    vi.setSystemTime(new Date(2026, 10, 4, 8, 0));
    await openApp();
    const when = $<HTMLInputElement>("#when");
    when.value = "2026-10-30T07:00";
    when.dispatchEvent(new Event("input", { bubbles: true }));
    vi.setSystemTime(new Date(2026, 10, 5, 8, 0));
    type(readingInputs()[0], "72.4");
    save();
    expect(saved().sets[0].at).toBe("2026-10-30T07:00");
  });
});

describe("setup", () => {
  it("won't save while two readings can't be told apart, and says why", async () => {
    vi.setSystemTime(new Date(2026, 10, 4, 8, 0));
    await openApp();
    $<HTMLButtonElement>("#add-field").click();
    $<HTMLButtonElement>("#add-field").click();
    const inputs = readingInputs();
    type(inputs[5], "70");
    type(inputs[6], "23");
    save();
    expect(saved().sets).toHaveLength(0);
    expect($("#form-error").textContent).toMatch(/need a name/);
    expect(document.querySelectorAll('.field [aria-invalid="true"]').length).toBeGreaterThan(0);

    // Name them the same: still blocked.
    const names = [...document.querySelectorAll<HTMLInputElement>(".field-name input")];
    type(names[5], "Bone");
    type(names[6], "Bone");
    save();
    expect(saved().sets).toHaveLength(0);
    expect(document.getElementById(`f-err-${saved().fields[6].id}`)!.textContent).toMatch(/same name and unit/);

    // Give one a different unit: saves, and both values are kept with their field ids.
    const units = [...document.querySelectorAll<HTMLInputElement>(".field-unit input")];
    type(units[6], "%");
    save();
    const set = saved().sets[0];
    expect(set.readings.slice(5).map((r: { value: string }) => r.value)).toEqual(["70", "23"]);
    expect(set.readings.every((r: { fieldId?: string }) => typeof r.fieldId === "string")).toBe(true);
  });
});

describe("another window saving while a weigh-in is half done", () => {
  const otherWindowWrites = (change: (d: Record<string, any>) => void) => {
    const d = JSON.parse(localStorage.getItem("scale-reader:v1") ?? "null") ?? {
      fields: [
        { id: "weight", name: "Weight", unit: "kg" },
        { id: "bmi", name: "BMI", unit: "" },
        { id: "body-fat", name: "Body fat", unit: "%" },
        { id: "water", name: "Water", unit: "%" },
        { id: "muscle", name: "Muscle", unit: "%" },
      ],
      sets: [],
      polarity: "auto",
      box: { x: 0.2, y: 0.35, w: 0.6, h: 0.3 },
    };
    change(d);
    localStorage.setItem("scale-reader:v1", JSON.stringify(d));
    window.dispatchEvent(new StorageEvent("storage", { key: "scale-reader:v1" }));
  };

  it("keeps a typed number when another fresh tab saves its first weigh-in", async () => {
    vi.setSystemTime(new Date(2026, 10, 4, 8, 0));
    await openApp(); // nothing saved yet in either window
    type(readingInputs()[0], "72.4");
    otherWindowWrites((d) => d.sets.push({ id: "a1", at: "2026-11-04T07:50", readings: [{ fieldId: "weight", name: "Weight", unit: "kg", value: "73.0" }] }));
    expect(readingInputs()[0].value).toBe("72.4");
    expect(document.querySelectorAll(".entry")).toHaveLength(1);
    save();
    expect(saved().sets.map((s: { readings: { value: string }[] }) => s.readings[0].value)).toEqual(["73.0", "72.4"]);
  });

  it("keeps a number whose reading another window removed, says so, and saves it as it was", async () => {
    vi.setSystemTime(new Date(2026, 10, 4, 8, 0));
    await openApp();
    type(readingInputs()[0], "72.4");
    type(readingInputs()[1], "23.1");
    otherWindowWrites((d) => {
      d.fields = d.fields.filter((f: { id: string }) => f.id !== "weight");
      d.fields.find((f: { id: string }) => f.id === "bmi").unit = "kg/m²";
    });
    const kept = document.querySelectorAll<HTMLInputElement>(".reading.kept input");
    expect([...kept].map((i) => i.value)).toEqual(["72.4", "23.1"]);
    await new Promise((r) => requestAnimationFrame(r));
    expect($("#status").textContent).toMatch(/changed in another window/);
    save();
    const set = saved().sets[0];
    expect(set.readings.filter((r: { value: string }) => r.value)).toEqual([
      { fieldId: "weight", name: "Weight", unit: "kg", value: "72.4" },
      { fieldId: "bmi", name: "BMI", unit: "", value: "23.1" },
    ]);
  });
});
