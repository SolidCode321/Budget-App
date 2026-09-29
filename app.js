"use strict";

/* ---------- constants ---------- */
const KEY = "budget-app-v1";
const COLORS = ["#ffcd00","#003ca6","#cf009e","#ff7e2e","#6eca97","#fa9aba","#837902","#e19bdf",
                "#b6bd00","#c9910d","#704b1c","#007852","#6ec4e8","#62259d","#d52b1e","#00a3a3"];
const DARK_TEXT = new Set(["#ffcd00","#ff7e2e","#6eca97","#fa9aba","#e19bdf","#b6bd00","#6ec4e8","#c9910d"]);
const fmt = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR" });
const money = n => fmt.format(Math.round((n + Number.EPSILON) * 100) / 100);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const $ = s => document.querySelector(s);

function defaults() {
  const cats = [
    ["Rent", 350], ["Utilities & Internet", 0], ["Groceries", 275], ["Eating out & Cafés", 60],
    ["Transport (Navigo)", 43.7], ["Phone / SIM", 20], ["Insurance", 0], ["Books & Study", 20],
    ["Gym & Fitness", 30], ["Personal care", 15], ["Clothing & Shopping", 30], ["Subscriptions", 25],
    ["Entertainment", 30], ["Travel", 0], ["Miscellaneous", 30]
  ];
  const srcs = [["Family support", 0], ["Part-time job", 0], ["Scholarship", 0], ["Other income", 0]];
  return {
    version: 1,
    categories: cats.map(([name, planned], i) => ({ id: uid() + i, name, planned, color: COLORS[i % COLORS.length] })),
    sources: srcs.map(([name, planned], i) => ({ id: uid() + "s" + i, name, planned })),
    tx: [],
    archive: {},
    deletedTx: [],
    yearStart: "2026-10"
  };
}

/* ---------- storage ---------- */
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const d = JSON.parse(raw);
    if (!valid(d)) return defaults();
    return normalize(d);
  } catch { return defaults(); }
}
/* Saves to this device straight away, then syncs to the server in the background. */
function saveLocal() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode etc. – the server copy still works */ }
}
function save({ force = false } = {}) {
  saveLocal();
  sync.changes++;
  sync.meta.dirty = true;
  if (force) sync.force = true;
  saveMeta();
  schedulePush();
}
function valid(d) {
  return d && Array.isArray(d.categories) && Array.isArray(d.sources) && Array.isArray(d.tx);
}

let state = load();

/* ---------- server sync ---------- */
const META_KEY = "budget-sync-v1";
const sync = { meta: loadMeta(), changes: 0, force: false, timer: null, busy: false, again: false, disabled: false };
function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY));
    if (m && Number.isInteger(m.rev)) return m;
  } catch {}
  // First run with sync: anything already in this browser counts as unsynced so it gets uploaded.
  let hasLocal = false;
  try { hasLocal = !!localStorage.getItem(KEY); } catch {}
  return { rev: 0, dirty: hasLocal };
}
function saveMeta() { try { localStorage.setItem(META_KEY, JSON.stringify(sync.meta)); } catch {} }

function setStatus(kind) {
  const el = document.getElementById("sync-status");
  if (!el) return;
  const text = { ok: "Synced", saving: "Saving…", offline: "Offline – saved on this device", off: "Sync not set up – this device only", error: "Sync problem – retrying" }[kind];
  el.textContent = text; el.dataset.kind = kind; el.title = text;
}
function tombstone(ids) {
  state.deletedTx = [...new Set([...(state.deletedTx || []), ...ids])].slice(-3000);
}
function normalize(d) {
  d.archive ||= {}; d.deletedTx ||= []; d.yearStart ||= "2026-10";
  return d;
}
/* Combine this device's copy with the server's: keep every transaction from both,
   drop any that either side deleted. Plan settings from this device win. */
function merge(local, server) {
  server = normalize(structuredClone(server));
  const dead = new Set([...(local.deletedTx || []), ...server.deletedTx]);
  const byId = new Map();
  for (const t of server.tx) byId.set(t.id, t);
  for (const t of local.tx) byId.set(t.id, t);
  return {
    ...local,
    tx: [...byId.values()].filter(t => !dead.has(t.id)),
    archive: { ...server.archive, ...(local.archive || {}) },
    deletedTx: [...dead].slice(-3000)
  };
}
async function api(method, body) {
  const r = await fetch("/api/data", {
    method, credentials: "same-origin", cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  if (r.status === 401) { location.href = "/login"; throw new Error("auth"); }
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
function schedulePush(delay = 700) {
  if (sync.disabled) return;
  clearTimeout(sync.timer);
  setStatus("saving");
  sync.timer = setTimeout(push, delay);
}
async function push() {
  if (sync.disabled) return;
  if (sync.busy) { sync.again = true; return; }
  sync.busy = true;
  const sent = sync.changes, force = sync.force;
  try {
    const { status, data } = await api("PUT", { baseRev: sync.meta.rev, data: state, force });
    if (status === 200) {
      sync.meta.rev = data.rev; sync.force = force ? false : sync.force;
      if (sync.changes === sent) sync.meta.dirty = false;
      saveMeta();
      setStatus(sync.meta.dirty ? "saving" : "ok");
      if (sync.meta.dirty) sync.again = true;
    } else if (status === 409) {
      state = merge(state, data.data || { categories: [], sources: [], tx: [] });
      sync.meta.rev = data.rev; saveLocal(); saveMeta(); render();
      sync.again = true;
    } else if (status === 503 && data?.error === "storage-not-set-up") {
      sync.disabled = true; setStatus("off");
    } else if (status === 413) {
      setStatus("error"); toast("Your data is too big to sync. Close some old months to shrink it.");
    } else {
      setStatus("error"); setTimeout(() => schedulePush(0), 15000);
    }
  } catch (e) {
    if (e.message !== "auth") setStatus(navigator.onLine ? "error" : "offline");
    if (navigator.onLine) setTimeout(() => schedulePush(0), 15000);
  } finally {
    sync.busy = false;
    if (sync.again) { sync.again = false; schedulePush(0); }
  }
}
async function pull() {
  if (sync.disabled || sync.busy) return;
  try {
    const { status, data } = await api("GET");
    if (status === 503 && data?.error === "storage-not-set-up") { sync.disabled = true; setStatus("off"); return; }
    if (status !== 200) { setStatus("error"); return; }
    if (!data.data) {                       // server empty: upload what this device has
      if (sync.meta.dirty || state.tx.length) { sync.meta.dirty = true; schedulePush(0); } else setStatus("ok");
      return;
    }
    if (sync.meta.dirty) {                  // local edits not yet uploaded: combine, then upload
      state = merge(state, data.data); sync.meta.rev = data.rev;
      saveLocal(); saveMeta(); render(); schedulePush(0);
    } else if (data.rev !== sync.meta.rev) { // another device saved: take its copy
      state = normalize(data.data); sync.meta.rev = data.rev;
      saveLocal(); saveMeta(); render(); setStatus("ok");
    } else setStatus("ok");
  } catch (e) {
    if (e.message !== "auth") setStatus(navigator.onLine ? "error" : "offline");
  }
}
addEventListener("online", () => (sync.meta.dirty ? schedulePush(0) : pull()));
addEventListener("offline", () => setStatus("offline"));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") (sync.meta.dirty ? schedulePush(0) : pull()); });

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, "0");
const ymOf = date => date.slice(0, 7);
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
function addMonths(ym, k) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + k, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function monthName(ym, style = "long") {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: style, year: "numeric" });
}

/* ---------- ui state ---------- */
let ui = { view: "month", month: ymOf(todayISO()), type: "expense", editing: null };

/* ---------- helpers ---------- */
const catById = id => state.categories.find(c => c.id === id);
const srcById = id => state.sources.find(s => s.id === id);
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null) e.setAttribute(k, v);
  }
  for (const k of kids) if (k !== null && k !== undefined) e.append(k instanceof Node ? k : String(k));
  return e;
}
function parseAmount(s) {
  const n = Number(String(s).trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}
let toastTimer;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}
function badge(c) {
  const b = el("span", { class: "badge", "aria-hidden": "true", style: `background:${c.color};color:${DARK_TEXT.has(c.color) ? "#14264f" : "#fff"}` });
  b.textContent = (c.name.trim()[0] || "?").toUpperCase();
  return b;
}

/* ---------- month view ---------- */
function monthTx(ym) { return state.tx.filter(t => ymOf(t.date) === ym); }

/* Combines entries still in the app with totals kept from a closed month. */
function monthData(ym) {
  const arch = state.archive[ym];
  const txs = monthTx(ym);
  const spentBy = { ...(arch ? arch.cats : {}) };
  let income = arch ? arch.income : 0;
  for (const t of txs) {
    if (t.type === "income") income += t.amount;
    else spentBy[t.catId] = (spentBy[t.catId] || 0) + t.amount;
  }
  const spent = Object.values(spentBy).reduce((a, b) => a + b, 0);
  const plannedOf = c => arch ? (arch.planned[c.id] || 0) : (c.planned || 0);
  const planned = state.categories.reduce((a, c) => a + plannedOf(c), 0);
  return { arch, txs, spentBy, spent, income, planned, plannedOf };
}

function renderMonth() {
  renderMonthEnd();
  const ym = ui.month;
  $("#month-title").textContent = monthName(ym);
  $("#today").hidden = ym === ymOf(todayISO());

  const { arch, txs, spentBy, spent, income, planned, plannedOf } = monthData(ym);
  const left = planned - spent;
  const mShort = monthName(ym).split(" ")[0];
  $("#left-label").textContent = left >= 0 ? `Left to spend in ${mShort}` : `Over plan in ${mShort}`;
  const la = $("#left-amt"); la.textContent = money(Math.abs(left)); la.classList.toggle("neg", left < 0);
  const pct = planned > 0 ? spent / planned : 0;
  $("#left-sub").textContent = planned > 0
    ? `${Math.round(pct * 100)}% of your ${money(planned)} plan used`
    : "Set planned amounts in Plan & settings to track what's left.";
  $("#s-spent").textContent = money(spent);
  $("#s-planned").textContent = money(planned);
  $("#s-income").textContent = money(income);
  const saved = income - spent;
  const sv = $("#s-saved"); sv.textContent = money(saved); sv.style.color = saved < 0 ? "var(--bad)" : "";
  const tr = $("#track"); tr.style.width = Math.min(100, pct * 100) + "%"; tr.classList.toggle("over", pct > 1);
  $("#track-label").setAttribute("aria-label", `${Math.round(pct * 100)} percent of planned spending used`);

  // category lines
  const byCat = spentBy;
  const ul = $("#lines"); ul.replaceChildren();
  const rows = state.categories.map(c => ({ c, s: byCat[c.id] || 0, pl: plannedOf(c) }));
  const orphan = Object.entries(byCat).filter(([id]) => !catById(id)).reduce((a, [, v]) => a + v, 0);
  for (const { c, s, pl } of rows) {
    if (!pl && !s) continue;
    const rem = pl - s;
    const p = pl > 0 ? Math.min(1, s / pl) : (s > 0 ? 1 : 0);
    const over = rem < 0;
    ul.append(el("li", {},
      badge(c),
      el("div", { class: "lname" }, c.name),
      el("div", { class: "lnums" },
        `${money(s)} `, el("span", { style: "color:var(--muted)" }, `of ${money(pl)}`),
        el("small", { class: over ? "over" : "" }, over ? `${money(-rem)} over` : `${money(rem)} left`)),
      el("div", { class: "lbar" }, el("i", { style: `width:${p * 100}%;background:${over ? "var(--bad)" : c.color}` }))
    ));
  }
  if (orphan > 0) ul.append(el("li", {}, el("span", { class: "badge", style: "background:var(--line)" }, "?"),
    el("div", { class: "lname" }, "Deleted categories"), el("div", { class: "lnums" }, money(orphan)), el("div")));
  if (!ul.children.length) ul.append(el("li", { class: "empty", style: "display:block" }, "No planned categories yet. Add some in Plan & settings."));

  // transactions
  const list = $("#tx-list"); list.replaceChildren();
  const sorted = [...txs].sort((a, b) => b.date.localeCompare(a.date) || b.created - a.created);
  if (!sorted.length) list.append(el("li", { class: "empty", style: "display:block" },
    arch ? "This month's entries were cleared when you closed it. They're in the Excel report you downloaded."
         : "Nothing logged for this month yet. Add your first expense above."));
  for (const t of sorted) {
    const isInc = t.type === "income";
    const who = isInc ? srcById(t.catId) : catById(t.catId);
    const label = who ? who.name : (isInc ? "Other income" : "Deleted category");
    const d = new Date(t.date + "T00:00");
    list.append(el("li", {},
      el("span", { class: "d" }, d.toLocaleDateString("en-GB", { day: "numeric", month: "short" })),
      el("span", { class: "t" },
        el("span", {}, el("span", { class: "dot", style: `background:${isInc ? "var(--ok)" : (who ? who.color : "var(--line)")}` }), label),
        el("small", {}, [t.note, !isInc && t.method].filter(Boolean).join(" – "))),
      el("span", { class: "a" + (isInc ? " in" : "") }, (isInc ? "+" : "") + money(t.amount)),
      el("span", { class: "ops" },
        el("button", { "aria-label": `Edit ${label} ${money(t.amount)}`, onclick: () => startEdit(t.id) }, "✎"),
        el("button", { "aria-label": `Delete ${label} ${money(t.amount)}`, onclick: () => removeTx(t.id) }, "✕"))
    ));
  }
}

/* ---------- phone bottom sheet ---------- */
const phone = matchMedia("(max-width: 640px)");
function openSheet() {
  if (!phone.matches) return;
  document.body.classList.add("sheet-open");
  setTimeout(() => $("#f-amount").focus(), 260);
}
function closeSheet() {
  if (!document.body.classList.contains("sheet-open")) return;
  document.body.classList.remove("sheet-open");
  $("#f-amount").blur();
  $("#fab").focus({ preventScroll: true });
}
$("#fab").onclick = () => { resetForm(); openSheet(); };
$("#backdrop").onclick = () => { closeSheet(); resetForm(); };
$("#sheet-close").onclick = () => { closeSheet(); resetForm(); };
document.addEventListener("keydown", e => { if (e.key === "Escape" && document.body.classList.contains("sheet-open")) { closeSheet(); resetForm(); } });
phone.addEventListener("change", () => document.body.classList.remove("sheet-open"));

/* ---------- form ---------- */
function fillCatSelect() {
  const sel = $("#f-cat"), keep = sel.value;
  const items = ui.type === "expense" ? state.categories : state.sources;
  sel.replaceChildren(...items.map(c => el("option", { value: c.id }, c.name)));
  if (items.some(c => c.id === keep)) sel.value = keep;
  $("#f-cat-label").textContent = ui.type === "expense" ? "Category" : "Source";
  $("#f-method-wrap").hidden = ui.type !== "expense";
  $("#f-submit").textContent = ui.editing ? "Save changes" : (ui.type === "expense" ? "Add expense" : "Add income");
  document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.type === ui.type)));
}
function setType(type) { ui.type = type; fillCatSelect(); }
function resetForm() {
  ui.editing = null;
  $("#f-amount").value = ""; $("#f-note").value = ""; $("#f-error").textContent = "";
  const t = todayISO();
  $("#f-date").value = ymOf(t) === ui.month ? t : ui.month + "-01";
  $("#form-title").textContent = "Add a transaction";
  $("#f-cancel").hidden = true;
  fillCatSelect();
}
function startEdit(id) {
  const t = state.tx.find(x => x.id === id); if (!t) return;
  ui.editing = id; ui.type = t.type; fillCatSelect();
  $("#f-amount").value = t.amount; $("#f-cat").value = t.catId; $("#f-date").value = t.date;
  $("#f-note").value = t.note || ""; if (t.method) $("#f-method").value = t.method;
  $("#form-title").textContent = "Edit transaction"; $("#f-cancel").hidden = false;
  if (phone.matches) { openSheet(); return; }
  $("#add").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  $("#f-amount").focus();
}
function removeTx(id) {
  const t = state.tx.find(x => x.id === id); if (!t) return;
  if (!confirm(`Delete this ${money(t.amount)} ${t.type}?`)) return;
  tombstone([id]); state.tx = state.tx.filter(x => x.id !== id); save();
  if (ui.editing === id) resetForm();
  render(); toast("Transaction deleted");
}
$("#tx-form").addEventListener("submit", e => {
  e.preventDefault();
  const amount = parseAmount($("#f-amount").value), date = $("#f-date").value, catId = $("#f-cat").value;
  const err = $("#f-error");
  if (!(amount > 0)) { err.textContent = "Enter an amount above zero, like 12.50."; $("#f-amount").focus(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { err.textContent = "Pick a date."; $("#f-date").focus(); return; }
  if (!catId) { err.textContent = `Add a ${ui.type === "expense" ? "category" : "source"} in Plan & settings first.`; return; }
  const rec = { type: ui.type, amount, date, catId, note: $("#f-note").value.trim(), method: ui.type === "expense" ? $("#f-method").value : "" };
  if (ui.editing) {
    Object.assign(state.tx.find(x => x.id === ui.editing), rec); toast("Changes saved");
  } else {
    state.tx.push({ id: uid(), created: Date.now(), ...rec });
    toast(ui.type === "expense" ? "Expense added" : "Income added");
  }
  save();
  if (ymOf(date) !== ui.month) ui.month = ymOf(date);
  closeSheet(); resetForm(); render();
});
$("#f-cancel").onclick = () => { closeSheet(); resetForm(); };
document.querySelectorAll(".seg button").forEach(b => b.onclick = () => setType(b.dataset.type));

/* ---------- year view ---------- */
function renderYear() {
  $("#year-start").value = state.yearStart;
  const months = Array.from({ length: 12 }, (_, i) => addMonths(state.yearStart, i));
  const grid = {}, incM = {}, expM = {};
  for (const m of months) {
    const d = monthData(m);
    incM[m] = d.income; expM[m] = d.spent;
    for (const [id, v] of Object.entries(d.spentBy)) {
      const k = catById(id) ? id : "__deleted";
      (grid[k] ||= {})[m] = (grid[k][m] || 0) + v;
    }
  }
  const activeMonths = months.filter(m => expM[m] > 0).length;
  const cell = (v, extra = "") => el("td", { class: (v === 0 ? "zero " : v < 0 ? "neg " : "") + extra }, v === 0 ? "–" : money(v));
  const tbl = $("#year-table"); tbl.replaceChildren();
  tbl.append(el("thead", {}, el("tr", {}, el("th", {}, "Category"),
    ...months.map(m => el("th", {}, el("button", { onclick: () => { ui.month = m; switchView("month"); } }, monthName(m, "short")))),
    el("th", {}, "Total"), el("th", {}, "Avg / month"))));
  const body = el("tbody");
  const rowsDef = [...state.categories.map(c => [c.id, c.name])];
  if (grid.__deleted) rowsDef.push(["__deleted", "Deleted categories"]);
  for (const [id, name] of rowsDef) {
    const vals = months.map(m => (grid[id] || {})[m] || 0), tot = vals.reduce((a, b) => a + b, 0);
    body.append(el("tr", {}, el("td", {}, name), ...vals.map(v => cell(v)), cell(tot), cell(activeMonths ? tot / activeMonths : 0)));
  }
  const tE = months.map(m => expM[m] || 0), tI = months.map(m => incM[m] || 0), tL = months.map((m, i) => tI[i] - tE[i]);
  const sum = a => a.reduce((x, y) => x + y, 0);
  body.append(el("tr", { class: "tot" }, el("td", {}, "Total spent"), ...tE.map(v => cell(v)), cell(sum(tE)), cell(activeMonths ? sum(tE) / activeMonths : 0)));
  body.append(el("tr", { class: "tot" }, el("td", {}, "Income"), ...tI.map(v => cell(v)), cell(sum(tI)), el("td")));
  body.append(el("tr", { class: "tot" }, el("td", {}, "Left over"), ...tL.map(v => cell(v)), cell(sum(tL)), el("td")));
  tbl.append(body);
}
$("#year-start").addEventListener("change", e => {
  if (/^\d{4}-\d{2}$/.test(e.target.value)) { state.yearStart = e.target.value; save(); renderYear(); }
});

/* ---------- settings ---------- */
function editList(target, items, kind) {
  const ul = $(target); ul.replaceChildren();
  items.forEach(item => {
    const name = el("input", { value: item.name, "aria-label": `${kind} name`, maxlength: 40 });
    name.addEventListener("change", () => {
      const v = name.value.trim(); if (!v) { name.value = item.name; return; }
      item.name = v; save(); render();
    });
    const amt = el("input", { value: item.planned || "", inputmode: "decimal", placeholder: "0", "aria-label": `Planned amount for ${item.name}` });
    amt.addEventListener("change", () => {
      const v = amt.value.trim() === "" ? 0 : parseAmount(amt.value);
      if (!(v >= 0)) { amt.value = item.planned || ""; toast("Enter a number, like 45.50"); return; }
      item.planned = v; save(); render();
    });
    const used = state.tx.filter(t => t.catId === item.id).length;
    const del = el("button", { class: "del", "aria-label": `Remove ${item.name}`, onclick: () => {
      const msg = used ? `Remove "${item.name}"? Its ${used} transaction(s) stay in your totals under "Deleted categories".` : `Remove "${item.name}"?`;
      if (!confirm(msg)) return;
      const arr = kind === "Category" ? state.categories : state.sources;
      arr.splice(arr.indexOf(item), 1); save(); render();
    } }, "✕");
    const sw = el("span", { class: "dot", style: `background:${item.color || "var(--ok)"};margin:0` });
    ul.append(el("li", {}, sw, name, amt, del));
  });
}
function renderSettings() {
  editList("#cat-edit", state.categories, "Category");
  editList("#src-edit", state.sources, "Income source");
  $("#plan-total").textContent = money(state.categories.reduce((a, c) => a + (c.planned || 0), 0));
  $("#inc-total").textContent = money(state.sources.reduce((a, c) => a + (c.planned || 0), 0));
}
$("#add-cat").onclick = () => {
  const used = new Set(state.categories.map(c => c.color));
  const color = COLORS.find(c => !used.has(c)) || COLORS[state.categories.length % COLORS.length];
  state.categories.push({ id: uid(), name: "New category", planned: 0, color }); save(); render();
  const ins = document.querySelectorAll("#cat-edit input"); ins[ins.length - 2].select();
};
$("#add-src").onclick = () => {
  state.sources.push({ id: uid(), name: "New source", planned: 0 }); save(); render();
  const ins = document.querySelectorAll("#src-edit input"); ins[ins.length - 2].select();
};

/* backup / restore / csv / reset */
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("#backup").onclick = () => download(`budget-backup-${todayISO()}.json`, JSON.stringify(state, null, 2), "application/json");
$("#restore").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!valid(d)) throw new Error();
    if (!confirm("Replace everything in this browser with the backup?")) return;
    state = normalize(d); save({ force: true }); render(); toast("Backup restored");
  } catch { toast("That file isn't a budget backup."); }
});
$("#csv").onclick = () => {
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["Date", "Type", "Category / source", "Amount (EUR)", "Paid with", "Note"].map(q).join(",")];
  for (const t of [...state.tx].sort((a, b) => a.date.localeCompare(b.date))) {
    const who = t.type === "income" ? srcById(t.catId) : catById(t.catId);
    lines.push([t.date, t.type, who ? who.name : "Deleted", t.amount.toFixed(2), t.method, t.note].map(q).join(","));
  }
  download(`budget-transactions-${todayISO()}.csv`, "\ufeff" + lines.join("\r\n"), "text/csv");
};
$("#reset").onclick = () => {
  if (!confirm("Erase all transactions and reset the plan? Download a backup first if you might want it back.")) return;
  state = defaults(); save({ force: true }); resetForm(); render(); toast("Everything erased");
};

/* ---------- month end: Excel report + close ---------- */
function renderMonthEnd() {
  const ym = ui.month, arch = state.archive[ym], n = monthTx(ym).length;
  const name = monthName(ym);
  const p = $("#me-text");
  if (arch && !n) p.textContent = `You closed ${name} on ${new Date(arch.closedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}. Its totals stay in the Month and Year views.`;
  else if (arch) p.textContent = `${name} was closed before, and you've added ${n} entr${n === 1 ? "y" : "ies"} since. Close it again to include them.`;
  else p.textContent = `When ${name} is over, close it: you get an Excel report of the month, and its entries are cleared from the app. Your plan and the month's totals are kept.`;
  $("#me-close").hidden = n === 0;
  $("#me-close").textContent = `Close ${name}`;
  $("#me-excel").disabled = !n && !arch;
  $("#me-excel").textContent = n ? "Download Excel report only" : "Download Excel report";
}

let excelLoading;
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve();
  return excelLoading ||= new Promise((res, rej) => {
    const sc = el("script", { src: "vendor/exceljs.min.js" });
    sc.onload = res; sc.onerror = () => { excelLoading = null; rej(new Error("load")); };
    document.head.append(sc);
  });
}

async function exportExcel(ym) {
  await loadExcelJS();
  const d = monthData(ym), arch = d.arch;
  const txs = [...d.txs].sort((a, b) => a.date.localeCompare(b.date) || a.created - b.created);
  const EUR = '€#,##0.00;[Red]-€#,##0.00;"-"';
  const ARIAL = (o = {}) => ({ name: "Arial", size: 10, ...o });
  const NAVY = "FF1F3864", SUBFILL = "FFD9E1F2", YEL = "FFFFF2CC";
  const fill = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const thin = { style: "thin", color: { argb: "FFBFBFBF" } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const xDate = iso => { const [y, m, dd] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, dd)); };

  const expName = t => catById(t.catId)?.name ?? "Deleted category";
  const incName = t => srcById(t.catId)?.name ?? "Deleted source";

  const wb = new ExcelJS.Workbook();
  wb.creator = "Budget app";
  const b = wb.addWorksheet("Budget", { views: [{ showGridLines: false, state: "frozen", ySplit: 6 }] });
  const ex = wb.addWorksheet("Expenses", { views: [{ state: "frozen", ySplit: 1 }] });
  const inc = wb.addWorksheet("Income", { views: [{ state: "frozen", ySplit: 1 }] });
  b.properties.tabColor = { argb: NAVY }; ex.properties.tabColor = { argb: "FFC00000" }; inc.properties.tabColor = { argb: "FF2E7D32" };

  /* --- log sheets --- */
  function logSheet(ws, headers, widths, rows, listRange) {
    ws.columns = widths.map(w => ({ width: w }));
    const h = ws.getRow(1);
    headers.forEach((t, i) => {
      const c = h.getCell(i + 1); c.value = t; c.font = ARIAL({ bold: true, color: { argb: "FFFFFFFF" } });
      c.fill = fill(NAVY); c.alignment = { horizontal: "center" }; c.border = box;
    });
    rows.forEach((r, i) => {
      const row = ws.getRow(i + 2);
      r.forEach((v, j) => { const c = row.getCell(j + 1); c.value = v; c.font = ARIAL({ color: { argb: "FF0000FF" } }); });
      row.getCell(1).numFmt = "dd/mm/yyyy"; row.getCell(4).numFmt = EUR;
    });
    const last = Math.max(rows.length + 1, 2) + 200;
    for (let r = rows.length + 2; r <= last; r++) {
      ws.getCell(r, 1).numFmt = "dd/mm/yyyy"; ws.getCell(r, 4).numFmt = EUR;
      for (let c = 1; c <= headers.length; c++) ws.getCell(r, c).font = ARIAL({ color: { argb: "FF0000FF" } });
    }
    for (let r = 2; r <= last; r++) ws.getCell(r, 2).dataValidation = { type: "list", allowBlank: true, formulae: [listRange] };
    ws.autoFilter = { from: "A1", to: { row: 1, column: headers.length } };
  }

  /* --- budget rows --- */
  const srcRows = state.sources.map(s => ({ name: s.name, planned: arch ? (arch.plannedInc?.[s.id] || 0) : (s.planned || 0) }));
  if (txs.some(t => t.type === "income" && !srcById(t.catId))) srcRows.push({ name: "Deleted source", planned: 0 });
  const archIncome = arch ? arch.income : 0;

  const catRows = state.categories.map(c => ({ name: c.name, planned: d.plannedOf(c), archived: arch ? (arch.cats[c.id] || 0) : 0 }));
  const orphanArch = arch ? Object.entries(arch.cats).filter(([id]) => !catById(id)).reduce((a, [, v]) => a + v, 0) : 0;
  if (orphanArch || txs.some(t => t.type === "expense" && !catById(t.catId)))
    catRows.push({ name: "Deleted category", planned: 0, archived: orphanArch });

  const expTx = txs.filter(t => t.type === "expense"), incTx = txs.filter(t => t.type === "income");
  const sumExp = n => expTx.filter(t => expName(t) === n).reduce((a, t) => a + t.amount, 0);
  const sumInc = n => incTx.filter(t => incName(t) === n).reduce((a, t) => a + t.amount, 0);

  b.columns = [{ width: 30 }, { width: 15 }, { width: 15 }, { width: 15 }, { width: 12 }];
  b.getCell("A1").value = `Monthly Budget – ${monthName(ym)}`;
  b.getCell("A1").font = ARIAL({ bold: true, size: 16, color: { argb: NAVY } });
  b.getCell("A2").value = "Exported from your Budget app. Blue numbers are inputs; everything else is a formula. Add rows on the Expenses or Income tab and the totals update.";
  b.getCell("A2").font = ARIAL({ italic: true, size: 9, color: { argb: "FF595959" } });
  b.getCell("A4").value = "Month"; b.getCell("A4").font = ARIAL({ bold: true });
  b.getCell("B4").value = xDate(ym + "-01"); b.getCell("B4").numFmt = "mmmm yyyy"; b.getCell("B4").font = ARIAL({ bold: true });

  const header = (r, title) => ["" + title, "Planned", "Actual", "Difference", "% of plan"].forEach((t, i) => {
    const c = b.getCell(r, i + 1); c.value = t; c.font = ARIAL({ bold: true, color: { argb: "FFFFFFFF" } }); c.fill = fill(NAVY);
    c.alignment = { horizontal: i ? "center" : "left" };
  });

  const incStart = 13;
  header(incStart - 1, "Income");
  let r = incStart, incTotal = 0, incPlan = 0;
  for (const s of srcRows) {
    const act = sumInc(s.name) + (s.name === srcRows[0].name ? archIncome : 0);
    const archPart = s.name === srcRows[0].name && archIncome ? `+${archIncome}` : "";
    b.getCell(r, 1).value = s.name;
    b.getCell(r, 2).value = s.planned; b.getCell(r, 2).font = ARIAL({ color: { argb: "FF0000FF" } }); b.getCell(r, 2).fill = fill(YEL);
    b.getCell(r, 3).value = { formula: `SUMIFS(Income!$D:$D,Income!$B:$B,$A${r})${archPart}`, result: act };
    b.getCell(r, 4).value = { formula: `C${r}-B${r}`, result: act - s.planned };
    b.getCell(r, 5).value = { formula: `IF(B${r}=0,"",C${r}/B${r})`, result: s.planned ? act / s.planned : "" };
    incTotal += act; incPlan += s.planned; r++;
  }
  const incEnd = r - 1, incTot = r;
  b.getCell(incTot, 1).value = "Total income";
  b.getCell(incTot, 2).value = { formula: `SUM(B${incStart}:B${incEnd})`, result: incPlan };
  b.getCell(incTot, 3).value = { formula: `SUM(C${incStart}:C${incEnd})`, result: incTotal };
  b.getCell(incTot, 4).value = { formula: `C${incTot}-B${incTot}`, result: incTotal - incPlan };
  b.getCell(incTot, 5).value = { formula: `IF(B${incTot}=0,"",C${incTot}/B${incTot})`, result: incPlan ? incTotal / incPlan : "" };

  const exH = incTot + 2, exStart = exH + 1;
  header(exH, "Expenses");
  r = exStart; let expTotal = 0, expPlan = 0;
  for (const c of catRows) {
    const act = sumExp(c.name) + c.archived;
    b.getCell(r, 1).value = c.name; b.getCell(r, 1).fill = fill(YEL);
    b.getCell(r, 2).value = c.planned; b.getCell(r, 2).font = ARIAL({ color: { argb: "FF0000FF" } }); b.getCell(r, 2).fill = fill(YEL);
    b.getCell(r, 3).value = { formula: `SUMIFS(Expenses!$D:$D,Expenses!$B:$B,$A${r})${c.archived ? "+" + c.archived : ""}`, result: act };
    b.getCell(r, 4).value = { formula: `B${r}-C${r}`, result: c.planned - act };
    b.getCell(r, 5).value = { formula: `IF(B${r}=0,"",C${r}/B${r})`, result: c.planned ? act / c.planned : "" };
    expTotal += act; expPlan += c.planned; r++;
  }
  const exEnd = r - 1, exTot = r;
  b.getCell(exTot, 1).value = "Total expenses";
  b.getCell(exTot, 2).value = { formula: `SUM(B${exStart}:B${exEnd})`, result: expPlan };
  b.getCell(exTot, 3).value = { formula: `SUM(C${exStart}:C${exEnd})`, result: expTotal };
  b.getCell(exTot, 4).value = { formula: `B${exTot}-C${exTot}`, result: expPlan - expTotal };
  b.getCell(exTot, 5).value = { formula: `IF(B${exTot}=0,"",C${exTot}/B${exTot})`, result: expPlan ? expTotal / expPlan : "" };

  // summary block
  header(6, "Summary");
  const sum = [
    ["Income", `B${incTot}`, incPlan, `C${incTot}`, incTotal, "C7-B7", incTotal - incPlan],
    ["Expenses", `B${exTot}`, expPlan, `C${exTot}`, expTotal, "B8-C8", expPlan - expTotal],
    ["Left over (income − expenses)", "B7-B8", incPlan - expPlan, "C7-C8", incTotal - expTotal, "C9-B9", (incTotal - expTotal) - (incPlan - expPlan)]
  ];
  sum.forEach(([label, fb, rb, fc, rc, fd, rd], i) => {
    const row = 7 + i;
    b.getCell(row, 1).value = label;
    b.getCell(row, 2).value = { formula: fb, result: rb };
    b.getCell(row, 3).value = { formula: fc, result: rc };
    b.getCell(row, 4).value = { formula: fd, result: rd };
  });
  b.getCell("A10").value = "Savings rate";
  b.getCell("B10").value = { formula: 'IF(B7=0,"",B9/B7)', result: incPlan ? (incPlan - expPlan) / incPlan : "" };
  b.getCell("C10").value = { formula: 'IF(C7=0,"",C9/C7)', result: incTotal ? (incTotal - expTotal) / incTotal : "" };
  b.getCell("A11").value = "Difference: positive = good (under budget, or more income than planned).";
  b.getCell("A11").font = ARIAL({ italic: true, size: 9, color: { argb: "FF595959" } });

  // formats + borders
  const tableRows = [...Array.from({ length: 5 }, (_, i) => 6 + i), ...range(incStart - 1, incTot), ...range(exH, exTot)];
  for (const row of tableRows) for (let c = 1; c <= 5; c++) {
    const cell = b.getCell(row, c);
    cell.border = box;
    if (!cell.font || cell.font.name !== "Arial") cell.font = ARIAL();
    if (c >= 2 && c <= 4) cell.numFmt = EUR;
    if (c === 5) cell.numFmt = "0%";
  }
  ["B10", "C10"].forEach(a => b.getCell(a).numFmt = "0%");
  for (const row of [9, incTot, exTot]) for (let c = 1; c <= 5; c++) {
    const cell = b.getCell(row, c); cell.font = ARIAL({ bold: true }); cell.fill = fill(SUBFILL);
  }
  for (const row of [6, incStart - 1, exH]) for (let c = 1; c <= 5; c++)
    b.getCell(row, c).font = ARIAL({ bold: true, color: { argb: "FFFFFFFF" } });

  const redRule = { type: "cellIs", operator: "lessThan", formulae: [0], style: { font: { color: { argb: "FFC00000" }, bold: true }, fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFDE2E2" } } } };
  const greenRule = { type: "cellIs", operator: "greaterThan", formulae: [0], style: { font: { color: { argb: "FF2E7D32" } } } };
  b.addConditionalFormatting({ ref: `D${exStart}:D${exTot}`, rules: [redRule, greenRule] });
  b.addConditionalFormatting({ ref: `D${incStart}:D${incTot}`, rules: [redRule, greenRule] });
  b.addConditionalFormatting({ ref: "D7:D9", rules: [redRule] });
  b.addConditionalFormatting({ ref: `E${exStart}:E${exEnd}`, rules: [{ type: "cellIs", operator: "greaterThan", formulae: [1], style: { font: { color: { argb: "FFC00000" }, bold: true } } }] });
  if (arch) {
    b.getCell(`A${exTot + 2}`).value = "Actual amounts include totals from entries cleared when you closed this month earlier (added in the formula).";
    b.getCell(`A${exTot + 2}`).font = ARIAL({ italic: true, size: 9, color: { argb: "FF595959" } });
  }

  logSheet(ex, ["Date", "Category", "Note", "Amount (€)", "Paid with"], [12, 26, 36, 14, 16],
    expTx.map(t => [xDate(t.date), expName(t), t.note || "", t.amount, t.method || ""]),
    `Budget!$A$${exStart}:$A$${exEnd}`);
  logSheet(inc, ["Date", "Source", "Note", "Amount (€)"], [12, 24, 36, 14],
    incTx.map(t => [xDate(t.date), incName(t), t.note || "", t.amount]),
    `Budget!$A$${incStart}:$A$${incEnd}`);

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = el("a", { href: url, download: `Budget-${ym}.xlsx` }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function range(a, b) { return Array.from({ length: b - a + 1 }, (_, i) => a + i); }

$("#me-excel").onclick = async () => {
  try { await exportExcel(ui.month); toast("Excel report downloaded"); }
  catch { toast("Couldn't create the Excel file. Check your connection and try again."); }
};
$("#me-close").onclick = async () => {
  const ym = ui.month, name = monthName(ym), n = monthTx(ym).length;
  try { await exportExcel(ym); }
  catch { toast("Couldn't create the Excel file, so nothing was cleared."); return; }
  if (!confirm(`Your Excel report for ${name} has downloaded. Check it opens, then press OK to clear this month's ${n} entr${n === 1 ? "y" : "ies"} from the app.\n\nYour plan and ${name}'s totals are kept.`)) {
    toast("Report downloaded. Nothing was cleared."); return;
  }
  const d = monthData(ym);
  const prev = state.archive[ym];
  state.archive[ym] = {
    cats: d.spentBy,
    income: d.income,
    planned: prev ? prev.planned : Object.fromEntries(state.categories.map(c => [c.id, c.planned || 0])),
    plannedInc: prev ? prev.plannedInc : Object.fromEntries(state.sources.map(s => [s.id, s.planned || 0])),
    closedAt: Date.now()
  };
  tombstone(monthTx(ym).map(t => t.id));
  state.tx = state.tx.filter(t => ymOf(t.date) !== ym);
  save(); resetForm(); render(); toast(`${name} closed`);
};

/* ---------- navigation ---------- */
function switchView(v) {
  ui.view = v;
  document.body.dataset.view = v;
  document.body.classList.remove("sheet-open");
  for (const name of ["month", "year", "settings"]) $("#view-" + name).hidden = name !== v;
  document.querySelectorAll("nav button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.view === v)));
  if (v === "month") resetForm();
  render(); window.scrollTo(0, 0);
}
document.querySelectorAll("nav button").forEach(b => b.onclick = () => switchView(b.dataset.view));
$("#prev").onclick = () => { ui.month = addMonths(ui.month, -1); resetForm(); render(); };
$("#next").onclick = () => { ui.month = addMonths(ui.month, 1); resetForm(); render(); };
$("#today").onclick = () => { ui.month = ymOf(todayISO()); resetForm(); render(); };

function render() {
  if (ui.view === "month") renderMonth();
  else if (ui.view === "year") renderYear();
  else renderSettings();
}

document.body.dataset.view = ui.view;
resetForm();
render();
setStatus(sync.meta.dirty ? "saving" : "ok");
pull();
