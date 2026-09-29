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
    yearStart: "2026-10"
  };
}

/* ---------- storage ---------- */
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const d = JSON.parse(raw);
    return valid(d) ? d : defaults();
  } catch { return defaults(); }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { toast("Couldn't save. Your browser may be blocking storage."); }
}
function valid(d) {
  return d && Array.isArray(d.categories) && Array.isArray(d.sources) && Array.isArray(d.tx);
}

let state = load();

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

function renderMonth() {
  const ym = ui.month;
  $("#month-title").textContent = monthName(ym);
  $("#today").hidden = ym === ymOf(todayISO());

  const txs = monthTx(ym);
  const exp = txs.filter(t => t.type === "expense");
  const inc = txs.filter(t => t.type === "income");
  const spent = exp.reduce((a, t) => a + t.amount, 0);
  const income = inc.reduce((a, t) => a + t.amount, 0);
  const planned = state.categories.reduce((a, c) => a + (c.planned || 0), 0);
  const left = planned - spent;

  $("#left-label").textContent = left >= 0 ? `Left to spend in ${monthName(ym).split(" ")[0]}` : `Over plan in ${monthName(ym).split(" ")[0]}`;
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
  const byCat = {};
  for (const t of exp) byCat[t.catId] = (byCat[t.catId] || 0) + t.amount;
  const ul = $("#lines"); ul.replaceChildren();
  const rows = state.categories.map(c => ({ c, s: byCat[c.id] || 0 }));
  const orphan = Object.entries(byCat).filter(([id]) => !catById(id)).reduce((a, [, v]) => a + v, 0);
  for (const { c, s } of rows) {
    if (!c.planned && !s) continue;
    const rem = (c.planned || 0) - s;
    const p = c.planned > 0 ? Math.min(1, s / c.planned) : (s > 0 ? 1 : 0);
    const over = rem < 0;
    ul.append(el("li", {},
      badge(c),
      el("div", { class: "lname" }, c.name),
      el("div", { class: "lnums" },
        `${money(s)} `, el("span", { style: "color:var(--muted)" }, `of ${money(c.planned || 0)}`),
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
  if (!sorted.length) list.append(el("li", { class: "empty", style: "display:block" }, "Nothing logged for this month yet. Add your first expense above."));
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
  $("#add").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  $("#f-amount").focus();
}
function removeTx(id) {
  const t = state.tx.find(x => x.id === id); if (!t) return;
  if (!confirm(`Delete this ${money(t.amount)} ${t.type}?`)) return;
  state.tx = state.tx.filter(x => x.id !== id); save();
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
  resetForm(); render();
});
$("#f-cancel").onclick = resetForm;
document.querySelectorAll(".seg button").forEach(b => b.onclick = () => setType(b.dataset.type));

/* ---------- year view ---------- */
function renderYear() {
  $("#year-start").value = state.yearStart;
  const months = Array.from({ length: 12 }, (_, i) => addMonths(state.yearStart, i));
  const grid = {}, incM = {}, expM = {};
  for (const t of state.tx) {
    const ym = ymOf(t.date); if (!months.includes(ym)) continue;
    if (t.type === "income") { incM[ym] = (incM[ym] || 0) + t.amount; continue; }
    expM[ym] = (expM[ym] || 0) + t.amount;
    const k = catById(t.catId) ? t.catId : "__deleted";
    (grid[k] ||= {})[ym] = (grid[k][ym] || 0) + t.amount;
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
    state = d; state.yearStart ||= "2026-10"; save(); render(); toast("Backup restored");
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
  state = defaults(); save(); resetForm(); render(); toast("Everything erased");
};

/* ---------- navigation ---------- */
function switchView(v) {
  ui.view = v;
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

resetForm();
render();
