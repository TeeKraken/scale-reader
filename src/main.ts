import "./style.css";
import { createCamera } from "./camera";
import {
  checkValue,
  clampBox,
  fieldProblems,
  friendlyDate,
  label,
  localStamp,
  newId,
  sortedSets,
  table,
  toCSV,
  toTSV,
  type Box,
  type Data,
  type SavedSet,
} from "./logic/records";
import { readSevenSegment, toGray, type Polarity, type ReadResult } from "./logic/segments";
import { createStore, KEY } from "./storage";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const store = createStore();
/** This page's copy of the saved data. Read from it; change it only through `change()`. */
let data: Data = store.data;
/** The reading box while it's being dragged (saved when the drag ends). */
let box: Box = { ...data.box };

/** A number in the weigh-in being filled in, with the reading it was entered for as it was then. */
interface DraftValue {
  fieldId: string;
  name: string;
  unit: string;
  value: string;
}
// The weigh-in being filled in, by field id. Not saved until "Save this weigh-in".
let draft: Record<string, DraftValue> = {};
/** Numbers whose reading another window removed or changed. Kept as entered, saved with their old name and unit. */
let kept: DraftValue[] = [];

function setDraft(f: { id: string; name: string; unit: string }, value: string) {
  draft[f.id] = { fieldId: f.id, name: f.name.trim(), unit: f.unit.trim(), value };
}
const draftValue = (id: string) => draft[id]?.value ?? "";
const draftStarted = () => Object.values(draft).some((d) => d.value.trim()) || kept.some((d) => d.value.trim());
let active = 0;
let whenEdited = false;
/** Readings just added in setup: their "needs a name" note waits until you've left the box. */
const freshFields = new Set<string>();

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
  setupSummary: $("setup-summary"),
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

/**
 * Applies a change to the latest saved data (another tab may have saved since
 * this page loaded) and saves it. Changes refer to things by id, never by
 * position, so they land on the right item in the latest data.
 */
function change(fn: (d: Data) => void) {
  const ok = store.update(fn);
  data = store.data;
  if (active >= data.fields.length) active = Math.max(0, data.fields.length - 1);
  els.saveWarning.hidden = ok;
  if (!ok) {
    els.saveWarning.textContent =
      "This phone's browser isn't letting the app save (it may be in private browsing, or out of space). Anything new will be lost when you close the page. Use \"Copy all for a spreadsheet\" to keep a copy.";
  }
}

// Another tab or the installed app saved: show its changes, keeping this page's unsaved weigh-in.
window.addEventListener("storage", (e) => {
  if (e.key !== KEY && e.key !== null) return;
  if (store.memoryOnly) return; // this page's copy is the only complete one now
  const focusedId = document.activeElement?.id;
  store.refresh();
  data = store.data;
  keepChangedDraft();
  if (!drag) box = { ...data.box };
  if (active >= data.fields.length) active = Math.max(0, data.fields.length - 1);
  renderFields();
  renderReadings();
  renderHistory();
  syncPolarity();
  applyBox();
  if (focusedId) document.getElementById(focusedId)?.focus();
});

/**
 * After another window changed the setup: a number typed for a reading that
 * was removed there, or whose name or unit changed, is moved to "kept" rather
 * than dropped or quietly relabelled.
 */
function keepChangedDraft() {
  const moved: DraftValue[] = [];
  for (const [id, d] of Object.entries(draft)) {
    if (!d.value.trim()) continue;
    const f = data.fields.find((x) => x.id === id);
    if (f && f.name.trim() === d.name && f.unit.trim() === d.unit) continue;
    moved.push(d);
    delete draft[id];
  }
  if (!moved.length) return;
  kept.push(...moved);
  say(
    `Your readings were changed in another window. ${moved.map((d) => `${label(d)} ${d.value}`).join(", ")} ${moved.length === 1 ? "is" : "are"} kept in this weigh-in under the old name, and will be saved like that. Clear a number to leave it out.`,
  );
}

function renderKept() {
  return kept.map((d, i) => {
    const id = `k-${i}`;
    const input = h("input", { id, type: "text", inputmode: "decimal", autocomplete: "off", spellcheck: "false", "aria-describedby": `${id}-note ${id}-err` });
    input.value = d.value;
    const err = h("span", { class: "field-error", id: `${id}-err` });
    input.addEventListener("input", () => {
      d.value = input.value;
      err.textContent = "";
      input.removeAttribute("aria-invalid");
    });
    input.addEventListener("blur", () => showValueError(input, err));
    const drop = h("button", { type: "button", class: "btn btn-quiet btn-small btn-danger", "aria-label": `Leave ${label(d)} out of this weigh-in` }, "Leave out");
    drop.addEventListener("click", () => {
      kept.splice(i, 1);
      renderReadings();
      say(`Left ${label(d)} out of this weigh-in.`);
    });
    return h(
      "li",
      { class: "reading kept" },
      h("label", { for: id }, label(d)),
      h("p", { class: "hint", id: `${id}-note` }, "Changed or removed in another window. Kept with its old name and unit."),
      h("div", { class: "reading-row" }, input, drop),
      err,
    );
  });
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
      input.value = draftValue(f.id);
      const err = h("span", { class: "field-error", id: `${id}-err` });
      input.addEventListener("input", () => {
        if (input.value.trim()) freshenWhen();
        setDraft(f, input.value);
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
    ...renderKept(),
  );
  updateReadButton();
}

/**
 * The date starts as "now" when the page opens. If the page has been left open
 * (overnight, say), bring it up to date when the first number of a new
 * weigh-in goes in, unless you chose a date yourself.
 */
function freshenWhen() {
  if (whenEdited) return;
  if (draftStarted()) return;
  els.when.value = localStamp(new Date());
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
  kept = [];
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
  const problems = fieldProblems(data.fields);
  if (problems.size) {
    for (const id of problems.keys()) freshFields.delete(id);
    els.setup.open = true;
    renderFields();
    els.formError.textContent =
      "Some readings in \"Your scale's readings\" need a name, or have the same name and unit as another. Fix those first.";
    els.fields.querySelector<HTMLInputElement>('[aria-invalid="true"]')?.focus();
    return;
  }
  let firstBad: HTMLInputElement | null = null;
  const readings = data.fields.map((f) => {
    const input = $<HTMLInputElement>(`r-${f.id}`);
    const ok = showValueError(input, $(`r-${f.id}-err`));
    if (!ok && !firstBad) firstBad = input;
    const c = checkValue(input.value);
    return { fieldId: f.id, name: f.name.trim(), unit: f.unit.trim(), value: c.ok ? c.value : "" };
  });
  kept.forEach((d, i) => {
    const input = $<HTMLInputElement>(`k-${i}`);
    const ok = showValueError(input, $(`k-${i}-err`));
    if (!ok && !firstBad) firstBad = input;
    const c = checkValue(d.value);
    if (c.ok && c.value) readings.push({ fieldId: d.fieldId, name: d.name, unit: d.unit, value: c.value });
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
  change((d) => d.sets.push(set));
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

/** Shows or clears each setup row's problem (no name, or the same name and unit as another). */
function checkFields() {
  const problems = fieldProblems(data.fields);
  for (const f of data.fields) {
    const err = document.getElementById(`f-err-${f.id}`);
    if (!err) continue;
    const problem = problems.get(f.id);
    const show = problem && !(freshFields.has(f.id) && !f.name.trim()) ? problem : "";
    err.textContent = show;
    for (const el of [$(`f-name-${f.id}`), $(`f-unit-${f.id}`)]) {
      if (show) el.setAttribute("aria-invalid", "true");
      else el.removeAttribute("aria-invalid");
    }
  }
}

function renderFields() {
  els.fields.replaceChildren(
    ...data.fields.map((f, i) => {
      const fid = f.id;
      const name = h("input", { id: `f-name-${fid}`, type: "text", maxlength: "40", autocomplete: "off", spellcheck: "false", "aria-describedby": `f-err-${fid}` });
      name.value = f.name;
      const unit = h("input", {
        id: `f-unit-${fid}`,
        type: "text",
        maxlength: "12",
        autocomplete: "off",
        spellcheck: "false",
        placeholder: "none",
        "aria-describedby": `f-err-${fid}`,
      });
      unit.value = f.unit;
      const err = h("p", { class: "field-error", id: `f-err-${fid}` });
      const edited = () => {
        renderReadings();
        els.setupSummary.textContent = data.fields.map(label).join(" · ");
        checkFields();
      };
      name.addEventListener("input", () => {
        change((d) => {
          const g = d.fields.find((x) => x.id === fid);
          if (g) g.name = name.value;
        });
        if (draft[fid]) draft[fid].name = name.value.trim();
        edited();
      });
      unit.addEventListener("input", () => {
        change((d) => {
          const g = d.fields.find((x) => x.id === fid);
          if (g) g.unit = unit.value;
        });
        if (draft[fid]) draft[fid].unit = unit.value.trim();
        edited();
      });
      name.addEventListener("input", () => {
        // Once it has had a name, an empty name is worth pointing out.
        if (name.value.trim()) freshFields.delete(fid);
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
      const move = (by: number, focus: "up" | "down") => {
        change((d) => {
          const from = d.fields.findIndex((x) => x.id === fid);
          const to = from + by;
          if (from < 0 || to < 0 || to >= d.fields.length) return;
          const [item] = d.fields.splice(from, 1);
          d.fields.splice(to, 0, item);
        });
        renderFields();
        renderReadings();
        const btn = document.getElementById(`f-name-${fid}`)?.closest(".field")?.querySelector<HTMLButtonElement>(`[data-move="${focus}"]`);
        (btn && !btn.disabled ? btn : document.getElementById(`f-name-${fid}`))?.focus();
      };
      up.dataset.move = "up";
      down.dataset.move = "down";
      up.addEventListener("click", () => move(-1, "up"));
      down.addEventListener("click", () => move(1, "down"));
      remove.addEventListener("click", () => {
        change((d) => {
          if (d.fields.length > 1) d.fields = d.fields.filter((x) => x.id !== fid);
        });
        delete draft[fid];
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
        err,
        h("div", { class: "field-buttons" }, up, down, remove),
      );
    }),
  );
  checkFields();
  els.addField.disabled = data.fields.length >= 20;
  els.setupSummary.textContent = data.fields.map(label).join(" · ");
}

els.addField.addEventListener("click", () => {
  const id = newId();
  freshFields.add(id);
  change((d) => {
    if (d.fields.length < 20) d.fields.push({ id, name: "", unit: "" });
  });
  renderFields();
  renderReadings();
  document.getElementById(`f-name-${id}`)?.focus();
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
      copy.addEventListener("click", () =>
        // Same columns as "Copy all" (worked out from every saved weigh-in), so the row lines up under that heading.
        copyText(
          toTSV(table(data.fields, data.sets, { header: false, only: [s.id] })),
          "Copied that row, in the same columns as \"Copy all\". Paste it into the next empty row of your spreadsheet. If you've changed your readings since you last copied all, copy all again for an up-to-date heading.",
        ),
      );
      del.addEventListener("click", () => {
        if (!confirm(`Delete the weigh-in for ${friendlyDate(s.at)}? This can't be undone.`)) return;
        change((d) => (d.sets = d.sets.filter((x) => x.id !== s.id)));
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
            .map((r) =>
              h("li", {}, h("span", { class: "k" }, r.name || "Reading"), " ", h("span", { class: "v" }, r.value + (r.unit ? ` ${r.unit}` : ""))),
            ),
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
  change((d) => (d.sets = []));
  renderHistory();
  els.historyStatus.textContent = "Deleted all saved weigh-ins.";
  els.historyEmpty.focus();
});

// ---------- Camera and photo ----------

let source: "video" | "photo" | null = null;

const IDLE_HINT =
  "Start the camera, then drag the box over the numbers on the scale's screen. Your camera picture stays on your phone. It's never saved or sent anywhere.";

const camera = createCamera({
  getUserMedia: () =>
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    }),
  attach: async (stream, signal) => {
    els.video.srcObject = stream;
    await new Promise<void>((resolve, reject) => {
      if (els.video.readyState >= 1) return resolve();
      const done = (fn: () => void) => () => {
        clearTimeout(timer);
        els.video.removeEventListener("loadedmetadata", onMeta);
        els.video.removeEventListener("error", onError);
        signal.removeEventListener("abort", onAbort);
        fn();
      };
      const onMeta = done(resolve);
      const onError = done(() => reject(new Error("The video failed")));
      const onAbort = done(() => reject(new DOMException("Cancelled", "AbortError")));
      const timer = setTimeout(done(() => reject(new Error("The camera sent no picture"))), 15_000);
      els.video.addEventListener("loadedmetadata", onMeta);
      els.video.addEventListener("error", onError);
      signal.addEventListener("abort", onAbort);
    });
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    await els.video.play();
  },
  detach: () => {
    els.video.srcObject = null;
  },
});

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

function hideViewport() {
  source = null;
  els.viewport.hidden = true;
  els.capture.hidden = true;
  els.saw.hidden = true;
  els.cameraHint.textContent = IDLE_HINT;
}

/** Start while idle; "Starting camera…" (off) while waiting, with Cancel; Stop while running. */
function showCameraButtons() {
  els.start.hidden = camera.running;
  els.start.disabled = camera.pending;
  els.start.textContent = camera.pending ? "Starting camera…" : "Start camera";
  els.stop.hidden = !camera.running && !camera.pending;
  els.stop.textContent = camera.pending ? "Cancel" : "Stop camera";
}

async function startCamera() {
  if (camera.pending || camera.running) return;
  els.cameraError.textContent = "";
  if (!navigator.mediaDevices?.getUserMedia) {
    els.cameraError.textContent = "This browser can't use the camera here. Use a photo instead, or type the numbers.";
    return;
  }
  // Only one start at a time: the button stays off until this one finishes or is cancelled.
  const pendingStart = camera.start();
  showCameraButtons();
  const result = await pendingStart;
  if (result === "busy" || result === "cancelled") return;
  if (result !== "started") {
    const name = result.stage === "permission" ? (result.error as DOMException)?.name : "";
    els.cameraError.textContent =
      name === "NotAllowedError"
        ? "The camera wasn't allowed. To use it, allow camera access for this site in your browser settings. You can also use a photo, or type the numbers."
        : name === "NotFoundError"
          ? "No camera was found. Use a photo instead, or type the numbers."
          : "The camera couldn't start. Close other apps using it and try again, or use a photo, or type the numbers.";
    if (source === "video") hideViewport();
    showCameraButtons();
    return;
  }
  showViewport("video", els.video.videoWidth || 16, els.video.videoHeight || 9);
  showCameraButtons();
  els.readBtn.focus();
}

/** Stops the camera, and cancels a start that's still waiting for permission. */
function stopCamera() {
  camera.stop();
  if (source === "video") hideViewport();
  showCameraButtons();
}

els.start.addEventListener("click", () => void startCamera());
els.stop.addEventListener("click", () => {
  stopCamera();
  els.start.focus();
});
// Don't keep the camera on (or let a waiting start turn it on) in the background.
document.addEventListener("visibilitychange", () => {
  if (document.hidden && (camera.running || camera.pending)) stopCamera();
});

els.photoBtn.addEventListener("click", () => els.photoInput.click());
els.photoInput.addEventListener("change", async () => {
  const file = els.photoInput.files?.[0];
  els.photoInput.value = "";
  if (!file) return;
  els.cameraError.textContent = "";
  stopCamera();
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
  stopCamera(); // in case Start was pressed while the photo was opening
  showViewport("photo", els.photo.width, els.photo.height);
  els.readBtn.focus();
});

// ---------- The reading box ----------

function applyBox() {
  Object.assign(els.box.style, { left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.w * 100}%`, height: `${box.h * 100}%` });
}

function saveBox() {
  const b = { ...box };
  change((d) => (d.box = b));
}

let drag: { mode: "move" | "resize"; startX: number; startY: number; start: Box; id: number } | null = null;

els.box.addEventListener("pointerdown", (e) => {
  const mode = e.target === els.handle ? "resize" : "move";
  drag = { mode, startX: e.clientX, startY: e.clientY, start: { ...box }, id: e.pointerId };
  els.box.setPointerCapture(e.pointerId);
  e.preventDefault();
});
els.box.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const r = els.viewport.getBoundingClientRect();
  const dx = (e.clientX - drag.startX) / r.width;
  const dy = (e.clientY - drag.startY) / r.height;
  const s = drag.start;
  box =
    drag.mode === "move"
      ? clampBox({ ...s, x: s.x + dx, y: s.y + dy })
      : clampBox({ ...s, w: Math.min(1 - s.x, s.w + dx), h: Math.min(1 - s.y, s.h + dy) });
  applyBox();
});
const endDrag = (e: PointerEvent) => {
  if (!drag || e.pointerId !== drag.id) return;
  drag = null;
  saveBox();
};
els.box.addEventListener("pointerup", endDrag);
els.box.addEventListener("pointercancel", endDrag);

els.box.addEventListener("keydown", (e) => {
  const step = 0.02;
  const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
  if (!d) return;
  e.preventDefault();
  const b = box;
  box = e.shiftKey
    ? clampBox({ ...b, w: Math.min(1 - b.x, b.w + d[0]), h: Math.min(1 - b.y, b.h + d[1]) })
    : clampBox({ ...b, x: b.x + d[0], y: b.y + d[1] });
  applyBox();
  saveBox();
});

// ---------- Reading a number ----------

const polarityInputs = document.querySelectorAll<HTMLInputElement>('input[name="polarity"]');
function syncPolarity() {
  polarityInputs.forEach((input) => {
    input.checked = input.value === data.polarity;
  });
}
polarityInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    const p = input.value as Polarity;
    change((d) => (d.polarity = p));
  });
});

/** The part of the picture inside the box, in grey, at most 200 pixels tall. Never stored. */
function cropGray() {
  const el = source === "video" ? els.video : els.photo;
  const sw = source === "video" ? els.video.videoWidth : els.photo.width;
  const sh = source === "video" ? els.video.videoHeight : els.photo.height;
  if (!sw || !sh) return null;
  const cx = Math.round(box.x * sw);
  const cy = Math.round(box.y * sh);
  const cw = Math.max(1, Math.round(box.w * sw));
  const ch = Math.max(1, Math.round(box.h * sh));
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
  freshenWhen();
  setDraft(f, r.text);
  input.value = r.text;
  showValueError(input, $(`r-${f.id}-err`));
  if (r.value === null || r.unsure) {
    say(`${label(f)}: read "${r.text}", but some of it was hard to make out. Check it against the scale and fix it if needed, or read it again.`);
    renderReadings();
    return;
  }
  const next = data.fields.findIndex((x, i) => i > active && !draftValue(x.id).trim());
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

const firstVisit = (() => {
  try {
    return !window.localStorage.getItem(KEY);
  } catch {
    return false;
  }
})();
els.when.value = localStamp(new Date());
renderReadings();
renderFields();
renderHistory();
syncPolarity();
applyBox();
if (firstVisit) els.setup.open = true;

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* offline support is a bonus; the app works without it */
    });
  });
}
