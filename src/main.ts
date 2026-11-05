import "./style.css";
import {
  checkValue,
  clampBox,
  friendlyDate,
  label,
  localStamp,
  newId,
  sortedSets,
  table,
  toCSV,
  toTSV,
  type Box,
  type SavedSet,
} from "./logic/records";
import { readSevenSegment, toGray, type Polarity, type ReadResult } from "./logic/segments";
import { load, save } from "./storage";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const data = load();

// The weigh-in being filled in. Not saved until "Save this weigh-in".
let draft: Record<string, string> = {};
let active = 0;
let whenEdited = false;

const els = {
  viewport: $("viewport"),
  video: $<HTMLVideoElement>("video"),
  photo: $<HTMLCanvasElement>("photo"),
  box: $("box"),
  handle: $("handle"),
  cameraHint: $("camera-hint"),
  start: $<HTMLButtonElement>("start-camera"),
  stop: $<HTMLButtonElement>("stop-camera"),
  photoBtn: $<HTMLButtonElement>("photo-btn"),
  photoInput: $<HTMLInputElement>("photo-input"),
  cameraError: $("camera-error"),
  capture: $("capture"),
  readBtn: $<HTMLButtonElement>("read-btn"),
  saw: $("saw"),
  mask: $<HTMLCanvasElement>("mask"),
  status: $("status"),
  form: $<HTMLFormElement>("set-form"),
  readings: $("readings"),
  when: $<HTMLInputElement>("when"),
  formError: $("form-error"),
  clearDraft: $<HTMLButtonElement>("clear-draft"),
  history: $("history"),
  historyEmpty: $("history-empty"),
  historyActions: $("history-actions"),
  copyHint: $("copy-hint"),
  historyStatus: $("history-status"),
  copyAll: $<HTMLButtonElement>("copy-all"),
  downloadCsv: $<HTMLButtonElement>("download-csv"),
  clearAll: $<HTMLButtonElement>("clear-all"),
  fields: $("fields"),
  addField: $<HTMLButtonElement>("add-field"),
  setup: $<HTMLDetailsElement>("setup"),
  saveWarning: $("save-warning"),
  copyDialog: $<HTMLDialogElement>("copy-dialog"),
  copyText: $<HTMLTextAreaElement>("copy-text"),
};

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) if (c != null) el.append(c);
  return el;
}

// ---------- Saving ----------

function persist() {
  const ok = save(data);
  els.saveWarning.hidden = ok;
  if (!ok) {
    els.saveWarning.textContent =
      "This phone's browser isn't letting the app save (it may be in private browsing, or out of space). Anything new will be lost when you close the page. Use \"Copy all for a spreadsheet\" to keep a copy.";
  }
}

// ---------- The weigh-in form ----------

function renderReadings() {
  els.readings.replaceChildren(
    ...data.fields.map((f, i) => {
      const id = `r-${f.id}`;
      const input = h("input", {
        id,
        type: "text",
        inputmode: "decimal",
        autocomplete: "off",
        spellcheck: "false",
        enterkeyhint: "next",
        "aria-describedby": `${id}-err`,
      });
      input.value = draft[f.id] ?? "";
      const err = h("span", { class: "field-error", id: `${id}-err` });
      input.addEventListener("input", () => {
        draft[f.id] = input.value;
        err.textContent = "";
        input.removeAttribute("aria-invalid");
      });
      input.addEventListener("blur", () => showValueError(input, err));
      input.addEventListener("focus", () => setActive(i, false));
      const pick = h("button", { type: "button", class: "btn btn-quiet btn-small", "aria-label": `Read ${label(f)} next` }, "Read this next");
      pick.addEventListener("click", () => {
        setActive(i, true);
        if (!els.capture.hidden) els.readBtn.focus();
      });
      return h(
        "li",
        { class: "reading", "data-active": i === active ? "true" : undefined },
        h("label", { for: id }, h("span", { class: "num", "aria-hidden": "true" }, String(i + 1)), label(f)),
        h("div", { class: "reading-row" }, input, pick),
        err,
      );
    }),
  );
  updateReadButton();
}

function showValueError(input: HTMLInputElement, err: HTMLElement): boolean {
  const c = checkValue(input.value);
  if (c.ok) {
    err.textContent = "";
    input.removeAttribute("aria-invalid");
    return true;
  }
  err.textContent = c.message;
  input.setAttribute("aria-invalid", "true");
  return false;
}

function setActive(i: number, render: boolean) {
  if (i === active) return;
  active = Math.max(0, Math.min(data.fields.length - 1, i));
  if (render) renderReadings();
  else {
    els.readings.querySelectorAll<HTMLElement>(".reading").forEach((li, n) => {
      if (n === active) li.dataset.active = "true";
      else delete li.dataset.active;
    });
    updateReadButton();
  }
}

function updateReadButton() {
  const f = data.fields[active];
  els.readBtn.textContent = f ? `Read ${label(f)}` : "Read the number";
}

function resetDraft() {
  draft = {};
  active = 0;
  whenEdited = false;
  els.when.value = localStamp(new Date());
  els.formError.textContent = "";
  renderReadings();
}

els.when.addEventListener("input", () => {
  whenEdited = true;
});

els.clearDraft.addEventListener("click", () => {
  resetDraft();
  say("Cleared. Ready for a new weigh-in.");
});

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  els.formError.textContent = "";
  let firstBad: HTMLInputElement | null = null;
  const readings = data.fields.map((f) => {
    const input = $<HTMLInputElement>(`r-${f.id}`);
    const ok = showValueError(input, $(`r-${f.id}-err`));
    if (!ok && !firstBad) firstBad = input;
    const c = checkValue(input.value);
    return { name: f.name.trim() || "Reading", unit: f.unit.trim(), value: c.ok ? c.value : "" };
  });
  if (firstBad) {
    els.formError.textContent = "Some readings aren't numbers. Fix the ones marked, or clear them to leave them out.";
    (firstBad as HTMLInputElement).focus();
    return;
  }
  if (!readings.some((r) => r.value !== "")) {
    els.formError.textContent = "Read or type at least one number before saving.";
    $<HTMLInputElement>(`r-${data.fields[0].id}`)?.focus();
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(els.when.value)) {
    els.formError.textContent = "Choose the date and time of this weigh-in.";
    els.when.focus();
    return;
  }
  const set: SavedSet = { id: newId(), at: els.when.value, readings };
  data.sets.push(set);
  persist();
  stopCamera();
  resetDraft();
  renderHistory();
  say(`Saved your weigh-in for ${friendlyDate(set.at)}. You can copy it for your spreadsheet under "Saved weigh-ins".`);
});

function say(text: string) {
  els.status.textContent = "";
  // A fresh write makes screen readers announce it even when the text repeats.
  requestAnimationFrame(() => {
    els.status.textContent = text;
  });
}

// ---------- Setup: the scale's readings ----------

function renderFields() {
  els.fields.replaceChildren(
    ...data.fields.map((f, i) => {
      const nameId = `f-name-${f.id}`;
      const unitId = `f-unit-${f.id}`;
      const name = h("input", { id: nameId, type: "text", maxlength: "40", autocomplete: "off", spellcheck: "false" });
      name.value = f.name;
      const unit = h("input", { id: unitId, type: "text", maxlength: "12", autocomplete: "off", spellcheck: "false", placeholder: "none" });
      unit.value = f.unit;
      const changed = () => {
        persist();
        renderReadings();
        $("setup-summary").textContent = data.fields.map(label).join(" · ");
      };
      name.addEventListener("input", () => {
        f.name = name.value;
        changed();
      });
      unit.addEventListener("input", () => {
        f.unit = unit.value;
        changed();
      });
      const who = label(f);
      const up = h("button", { type: "button", class: "btn btn-quiet btn-small", "aria-label": `Move ${who} up`, disabled: i === 0 }, "Up");
      const down = h(
        "button",
        { type: "button", class: "btn btn-quiet btn-small", "aria-label": `Move ${who} down`, disabled: i === data.fields.length - 1 },
        "Down",
      );
      const remove = h(
        "button",
        { type: "button", class: "btn btn-quiet btn-small btn-danger", "aria-label": `Remove ${who}`, disabled: data.fields.length === 1 },
        "Remove",
      );
      const move = (to: number, focus: "up" | "down") => {
        const [item] = data.fields.splice(i, 1);
        data.fields.splice(to, 0, item);
        persist();
        renderFields();
        renderReadings();
        const btn = els.fields.querySelectorAll<HTMLButtonElement>(`.field`)[to]?.querySelector<HTMLButtonElement>(`[data-move="${focus}"]`);
        (btn && !btn.disabled ? btn : els.fields.querySelectorAll<HTMLInputElement>("input")[to * 2])?.focus();
      };
      up.dataset.move = "up";
      down.dataset.move = "down";
      up.addEventListener("click", () => move(i - 1, "up"));
      down.addEventListener("click", () => move(i + 1, "down"));
      remove.addEventListener("click", () => {
        data.fields.splice(i, 1);
        delete draft[f.id];
        if (active >= data.fields.length) active = data.fields.length - 1;
        persist();
        renderFields();
        renderReadings();
        els.addField.focus();
      });
      return h(
        "li",
        { class: "field" },
        h("span", { class: "num", "aria-hidden": "true" }, String(i + 1)),
        h("label", { class: "field-name" }, h("span", {}, "Name"), name),
        h("label", { class: "field-unit" }, h("span", {}, "Unit"), unit),
        h("div", { class: "field-buttons" }, up, down, remove),
      );
    }),
  );
  els.addField.disabled = data.fields.length >= 20;
  $("setup-summary").textContent = data.fields.map(label).join(" · ");
}

els.addField.addEventListener("click", () => {
  data.fields.push({ id: newId(), name: "", unit: "" });
  persist();
  renderFields();
  renderReadings();
  const inputs = els.fields.querySelectorAll<HTMLInputElement>(".field-name input");
  inputs[inputs.length - 1]?.focus();
});

// ---------- Saved weigh-ins ----------

function renderHistory() {
  const sets = sortedSets(data.sets);
  els.historyEmpty.hidden = sets.length > 0;
  els.historyActions.hidden = sets.length === 0;
  els.copyHint.hidden = sets.length === 0;
  els.history.replaceChildren(
    ...sets.map((s) => {
      const copy = h("button", { type: "button", class: "btn btn-quiet btn-small", "aria-label": `Copy the row for ${friendlyDate(s.at)}` }, "Copy row");
      const del = h(
        "button",
        { type: "button", class: "btn btn-quiet btn-small btn-danger", "aria-label": `Delete the weigh-in for ${friendlyDate(s.at)}` },
        "Delete",
      );
      copy.addEventListener("click", () => copyText(toTSV(table(data.fields, [s], false)), "Copied that row. Paste it into the next empty row of your spreadsheet."));
      del.addEventListener("click", () => {
        if (!confirm(`Delete the weigh-in for ${friendlyDate(s.at)}? This can't be undone.`)) return;
        data.sets = data.sets.filter((x) => x.id !== s.id);
        persist();
        renderHistory();
        els.historyStatus.textContent = "Deleted.";
        (els.history.querySelector<HTMLButtonElement>("button") ?? els.historyEmpty).focus?.();
      });
      return h(
        "li",
        { class: "entry" },
        h("p", { class: "entry-date" }, friendlyDate(s.at)),
        h(
          "ul",
          { class: "entry-values" },
          ...s.readings
            .filter((r) => r.value !== "")
            .map((r) => h("li", {}, h("span", { class: "k" }, r.name), " ", h("span", { class: "v" }, r.value + (r.unit ? ` ${r.unit}` : "")))),
        ),
        h("div", { class: "entry-buttons" }, copy, del),
      );
    }),
  );
}

async function copyText(text: string, done: string) {
  try {
    await navigator.clipboard.writeText(text);
    els.historyStatus.textContent = done;
  } catch {
    els.copyText.value = text;
    els.copyDialog.showModal();
    els.copyText.focus();
    els.copyText.select();
  }
}

els.copyAll.addEventListener("click", () => {
  const n = data.sets.length;
  copyText(toTSV(table(data.fields, data.sets)), `Copied ${n} ${n === 1 ? "weigh-in" : "weigh-ins"} with a heading row. Paste into an empty spreadsheet.`);
});

els.downloadCsv.addEventListener("click", () => {
  const blob = new Blob([toCSV(table(data.fields, data.sets))], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: `scale-readings-${localStamp(new Date()).slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  els.historyStatus.textContent = "Downloaded a CSV file. It opens in any spreadsheet app.";
});

els.clearAll.addEventListener("click", () => {
  const n = data.sets.length;
  if (!confirm(`Delete all ${n} saved ${n === 1 ? "weigh-in" : "weigh-ins"} from this phone? This can't be undone. Copy or download them first if you want to keep them.`)) return;
  data.sets = [];
  persist();
  renderHistory();
  els.historyStatus.textContent = "Deleted all saved weigh-ins.";
  els.historyEmpty.focus();
});

// ---------- Camera and photo ----------

let stream: MediaStream | null = null;
let source: "video" | "photo" | null = null;

function showViewport(kind: "video" | "photo", width: number, height: number) {
  source = kind;
  els.viewport.hidden = false;
  els.viewport.style.aspectRatio = `${width} / ${height}`;
  els.video.hidden = kind !== "video";
  els.photo.hidden = kind !== "photo";
  els.capture.hidden = false;
  els.cameraHint.textContent =
    kind === "video"
      ? "Drag the box over the numbers on the scale's screen (drag the corner to resize). When a number shows, tap the button. Your camera picture stays on your phone."
      : "Drag the box over the numbers in your photo (drag the corner to resize), then tap the button. The photo stays on your phone and is forgotten when you leave.";
  applyBox();
}

async function startCamera() {
  els.cameraError.textContent = "";
  if (!navigator.mediaDevices?.getUserMedia) {
    els.cameraError.textContent = "This browser can't use the camera here. Use a photo instead, or type the numbers.";
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
  } catch (err) {
    const name = (err as DOMException)?.name;
    els.cameraError.textContent =
      name === "NotAllowedError"
        ? "The camera wasn't allowed. To use it, allow camera access for this site in your browser settings. You can also use a photo, or type the numbers."
        : name === "NotFoundError"
          ? "No camera was found. Use a photo instead, or type the numbers."
          : "The camera couldn't start. Close other apps using it and try again, or type the numbers.";
    return;
  }
  els.video.srcObject = stream;
  await new Promise<void>((resolve) => {
    if (els.video.readyState >= 1) resolve();
    else els.video.addEventListener("loadedmetadata", () => resolve(), { once: true });
  });
  await els.video.play().catch(() => undefined);
  showViewport("video", els.video.videoWidth || 16, els.video.videoHeight || 9);
  els.start.hidden = true;
  els.stop.hidden = false;
  els.readBtn.focus();
}

function stopCamera() {
  if (stream) for (const t of stream.getTracks()) t.stop();
  stream = null;
  els.video.srcObject = null;
  els.start.hidden = false;
  els.stop.hidden = true;
  if (source === "video") {
    source = null;
    els.viewport.hidden = true;
    els.capture.hidden = true;
    els.saw.hidden = true;
    els.cameraHint.textContent =
      "Start the camera, then drag the box over the numbers on the scale's screen. Your camera picture stays on your phone. It's never saved or sent anywhere.";
  }
}

els.start.addEventListener("click", () => void startCamera());
els.stop.addEventListener("click", () => {
  stopCamera();
  els.start.focus();
});
// Don't keep the camera on in the background.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && stream) stopCamera();
});

els.photoBtn.addEventListener("click", () => els.photoInput.click());
els.photoInput.addEventListener("change", async () => {
  const file = els.photoInput.files?.[0];
  els.photoInput.value = "";
  if (!file) return;
  els.cameraError.textContent = "";
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    els.photo.width = Math.round(bitmap.width * scale);
    els.photo.height = Math.round(bitmap.height * scale);
    els.photo.getContext("2d")!.drawImage(bitmap, 0, 0, els.photo.width, els.photo.height);
    bitmap.close();
  } catch {
    els.cameraError.textContent = "That photo couldn't be opened. Try another one, or type the numbers.";
    return;
  }
  stopCamera();
  showViewport("photo", els.photo.width, els.photo.height);
  els.readBtn.focus();
});

// ---------- The reading box ----------

function applyBox() {
  const b = data.box;
  Object.assign(els.box.style, { left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });
}

let drag: { mode: "move" | "resize"; startX: number; startY: number; start: Box; id: number } | null = null;

els.box.addEventListener("pointerdown", (e) => {
  const mode = e.target === els.handle ? "resize" : "move";
  drag = { mode, startX: e.clientX, startY: e.clientY, start: { ...data.box }, id: e.pointerId };
  els.box.setPointerCapture(e.pointerId);
  e.preventDefault();
});
els.box.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const r = els.viewport.getBoundingClientRect();
  const dx = (e.clientX - drag.startX) / r.width;
  const dy = (e.clientY - drag.startY) / r.height;
  const s = drag.start;
  data.box = drag.mode === "move" ? clampBox({ ...s, x: s.x + dx, y: s.y + dy }) : clampBox({ ...s, w: Math.min(1 - s.x, s.w + dx), h: Math.min(1 - s.y, s.h + dy) });
  applyBox();
});
const endDrag = (e: PointerEvent) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag = null;
  persist();
};
els.box.addEventListener("pointerup", endDrag);
els.box.addEventListener("pointercancel", endDrag);

els.box.addEventListener("keydown", (e) => {
  const step = 0.02;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!d) return;
  e.preventDefault();
  const b = data.box;
  data.box = e.shiftKey ? clampBox({ ...b, w: Math.min(1 - b.x, b.w + d[0]), h: Math.min(1 - b.y, b.h + d[1]) }) : clampBox({ ...b, x: b.x + d[0], y: b.y + d[1] });
  applyBox();
  persist();
});

// ---------- Reading a number ----------

const polarityInputs = document.querySelectorAll<HTMLInputElement>('input[name="polarity"]');
polarityInputs.forEach((input) => {
  input.checked = input.value === data.polarity;
  input.addEventListener("change", () => {
    if (!input.checked) return;
    data.polarity = input.value as Polarity;
    persist();
  });
});

/** The part of the picture inside the box, in grey, at most 200 pixels tall. Never stored. */
function cropGray() {
  const el = source === "video" ? els.video : els.photo;
  const sw = source === "video" ? els.video.videoWidth : els.photo.width;
  const sh = source === "video" ? els.video.videoHeight : els.photo.height;
  if (!sw || !sh) return null;
  const b = data.box;
  const cx = Math.round(b.x * sw);
  const cy = Math.round(b.y * sh);
  const cw = Math.max(1, Math.round(b.w * sw));
  const ch = Math.max(1, Math.round(b.h * sh));
  const scale = Math.min(1, 200 / ch);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(cw * scale));
  canvas.height = Math.max(1, Math.round(ch * scale));
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(el, cx, cy, cw, ch, 0, 0, canvas.width, canvas.height);
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return toGray(img.data, img.width, img.height);
}

function showMask(r: ReadResult) {
  const { width, height, data: m } = r.mask;
  els.mask.width = width;
  els.mask.height = height;
  const ctx = els.mask.getContext("2d")!;
  const img = ctx.createImageData(width, height);
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  const [on, off] = dark ? [[240, 244, 238], [34, 41, 37]] : [[24, 32, 28], [250, 251, 249]];
  for (let i = 0; i < m.length; i++) {
    const c = m[i] ? on : off;
    img.data.set([c[0], c[1], c[2], 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  els.saw.hidden = false;
}

els.readBtn.addEventListener("click", () => {
  const f = data.fields[active];
  if (!f) return;
  const gray = cropGray();
  if (!gray) {
    say("The camera isn't showing a picture yet. Wait a moment and try again.");
    return;
  }
  const r = readSevenSegment(gray, { polarity: data.polarity });
  showMask(r);
  const input = $<HTMLInputElement>(`r-${f.id}`);
  if (!r.text) {
    say(`Couldn't find a number in the box. Move the box so it covers just the numbers, or type ${label(f)} yourself.`);
    return;
  }
  if (!Object.values(draft).some((v) => v.trim()) && !whenEdited) els.when.value = localStamp(new Date());
  draft[f.id] = r.text;
  input.value = r.text;
  showValueError(input, $(`r-${f.id}-err`));
  if (r.value === null || r.unsure) {
    say(`${label(f)}: read "${r.text}", but some of it was hard to make out. Check it against the scale and fix it if needed, or read it again.`);
    renderReadings();
    return;
  }
  const next = data.fields.findIndex((x, i) => i > active && !(draft[x.id] ?? "").trim());
  const msg = `${label(f)}: read ${r.text}. Check it matches the scale.`;
  if (next >= 0) {
    active = next;
    renderReadings();
    say(`${msg} Next: ${label(data.fields[next])}.`);
  } else {
    renderReadings();
    say(`${msg} That's all of them. Save when you're ready.`);
  }
});

// ---------- Start ----------

els.when.value = localStamp(new Date());
renderReadings();
renderFields();
renderHistory();
if (!data.sets.length && !localStorageHasData()) els.setup.open = true;

function localStorageHasData() {
  try {
    return !!window.localStorage.getItem("scale-reader:v1");
  } catch {
    return false;
  }
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is a bonus; the app works without it */
    });
  });
}
