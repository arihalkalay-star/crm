import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

/* ================= setup ================= */
const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "implicit" },
});

const DEAL_STAGES = [
  { k: "ליד חדש", c: "" },
  { k: "שיחת התאמה", c: "blue" },
  { k: "הצעה נשלחה", c: "amber" },
  { k: "משא ומתן", c: "amber" },
  { k: "נסגר", c: "green" },
  { k: "לא נסגר", c: "red" },
];
const CLIENT_STATUSES = [
  { k: "ליד", c: "blue" },
  { k: "לקוח פעיל", c: "green" },
  { k: "לקוח עבר", c: "" },
  { k: "לא רלוונטי", c: "red" },
];
const TASK_STATUSES = [
  { k: "לעשות", c: "" },
  { k: "בתהליך", c: "amber" },
  { k: "הושלם", c: "green" },
];
const PRIORITIES = [
  { k: "גבוהה", c: "red" },
  { k: "רגילה", c: "" },
  { k: "נמוכה", c: "blue" },
];

const S = { user: null, clients: [], deals: [], tasks: [], updates: [], loaded: false };
const pref = (k, d) => localStorage.getItem("crm." + k) || d;
const setPref = (k, v) => localStorage.setItem("crm." + k, v);
const $app = document.getElementById("app");

/* ================= helpers ================= */
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (v) => (v === null || v === undefined || v === "" ? "" : "₪" + Number(v).toLocaleString("he-IL"));
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => {
  if (!d) return "";
  const [y, m, dd] = String(d).slice(0, 10).split("-");
  return `${+dd}.${+m}.${y.slice(2)}`;
};
const fmtWhen = (ts) => {
  const d = new Date(ts);
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", year: "2-digit" }) +
    " " + d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
};
const isLate = (d) => d && d < today();
const chipOf = (list, k) => {
  const o = list.find((x) => x.k === k);
  return `<span class="chip ${o ? o.c : ""}">${esc(k || "—")}</span>`;
};
const opts = (list, cur, empty) =>
  (empty !== undefined ? `<option value="">${esc(empty)}</option>` : "") +
  list.map((o) => { const k = o.k ?? o; return `<option value="${esc(k)}" ${k === cur ? "selected" : ""}>${esc(k)}</option>`; }).join("");
const byId = (t, id) => S[t].find((r) => r.id === id);
const clientName = (id) => (id ? byId("clients", id)?.name || "" : "");
const dealTitle = (id) => (id ? byId("deals", id)?.title || "" : "");
const tagsHtml = (tags) => `<div class="chips">${(tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>`;
const allTags = () => [...new Set([...S.clients, ...S.deals].flatMap((r) => r.tags || []))].sort();

let toastT;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 2600);
}
function fail(error) {
  console.error(error);
  toast("משהו לא נשמר. נסה שוב.");
}

/* ================= data ================= */
async function loadAll() {
  const [c, d, t, u] = await Promise.all([
    sb.from("clients").select("*").order("updated_at", { ascending: false }),
    sb.from("deals").select("*").order("updated_at", { ascending: false }),
    sb.from("tasks").select("*").order("position").order("created_at"),
    sb.from("updates").select("*").order("created_at", { ascending: false }),
  ]);
  for (const r of [c, d, t, u]) if (r.error) throw r.error;
  S.clients = c.data; S.deals = d.data; S.tasks = t.data; S.updates = u.data; S.loaded = true;
}
const DEFAULTS = { clients: { status: "ליד", tags: [] }, deals: { stage: "ליד חדש", tags: [] }, tasks: { status: "לעשות", priority: "רגילה" }, updates: { kind: "הערה" } };
async function insert(table, row) {
  row = { ...DEFAULTS[table], ...row };
  const { data, error } = await sb.from(table).insert(row).select().single();
  if (error) { fail(error); return null; }
  table === "tasks" ? S[table].push(data) : S[table].unshift(data);
  return data;
}
const pending = {};
function update(table, id, patch, { now = false } = {}) {
  const rec = byId(table, id);
  if (rec) Object.assign(rec, patch, { updated_at: new Date().toISOString() });
  const key = table + ":" + id;
  pending[key] = { table, id, patch: { ...(pending[key]?.patch || {}), ...patch }, t: pending[key]?.t };
  clearTimeout(pending[key].t);
  const flush = async () => {
    const p = pending[key]; delete pending[key];
    const { error } = await sb.from(table).update(p.patch).eq("id", id);
    if (error) fail(error); else flashSaved();
  };
  if (now) return flush();
  pending[key].t = setTimeout(flush, 700);
}
async function remove(table, id) {
  const { error } = await sb.from(table).delete().eq("id", id);
  if (error) return fail(error);
  S[table] = S[table].filter((r) => r.id !== id);
  if (table === "clients") { S.deals.forEach((d) => d.client_id === id && (d.client_id = null)); S.tasks.forEach((t) => t.client_id === id && (t.client_id = null)); S.updates = S.updates.filter((u) => u.client_id !== id); }
  if (table === "deals") { S.tasks.forEach((t) => t.deal_id === id && (t.deal_id = null)); S.updates = S.updates.filter((u) => u.deal_id !== id); }
}
function flashSaved() {
  const el = document.querySelector(".saved");
  if (!el) return;
  el.textContent = "נשמר ✓";
  clearTimeout(el._t); el._t = setTimeout(() => (el.textContent = ""), 1600);
}

/* ================= router ================= */
function route() {
  const h = location.hash.replace(/^#\/?/, "");
  if (h.includes("access_token") || h.includes("error=")) return { name: "deals" };
  const [name, id] = h.split("/");
  return { name: name || "deals", id };
}
window.addEventListener("hashchange", () => render());

function shell(active, inner) {
  const tab = (n, label, icon) =>
    `<a href="#/${n}" class="${active === n ? "on" : ""}">${icon ? `<span>${icon}</span>` : ""}${label}</a>`;
  return `
  <header class="top"><div class="in">
    <a class="brand" href="#/deals"><i>A</i>Alkalay CRM</a>
    <nav class="tabs">${tab("deals", "עסקאות")}${tab("clients", "לקוחות")}${tab("tasks", "משימות")}</nav>
    <button class="me" id="logout" title="${esc(S.user?.email)}">יציאה</button>
  </div></header>
  <main>${inner}</main>
  <nav class="bottom-tabs">${tab("deals", "עסקאות", "◎")}${tab("clients", "לקוחות", "☰")}${tab("tasks", "משימות", "✓")}</nav>`;
}

/* ================= render ================= */
function render() {
  if (!S.user) return renderLogin();
  if (!S.loaded) { $app.innerHTML = `<div class="boot">טוען…</div>`; return; }
  const r = route();
  let html, after;
  switch (r.name) {
    case "deal": [html, after] = dealPage(r.id); break;
    case "client": [html, after] = clientPage(r.id); break;
    case "clients": [html, after] = clientsView(); break;
    case "tasks": [html, after] = tasksView(); break;
    default: [html, after] = dealsView();
  }
  const active = r.name === "deal" ? "deals" : r.name === "client" ? "clients" : r.name;
  $app.innerHTML = shell(active, html);
  document.getElementById("logout").onclick = async () => { await sb.auth.signOut(); };
  after && after();
  window.scrollTo(0, 0);
}

/* ---------- login ---------- */
function renderLogin() {
  $app.innerHTML = `
  <div class="login"><div class="box">
    <div class="brand"><i>A</i>Alkalay CRM</div>
    <h1>כניסה</h1>
    <p>נשלח לך קישור כניסה למייל. בלי סיסמה.</p>
    <form id="lf">
      <input id="em" type="email" dir="ltr" placeholder="you@email.com" required autocomplete="email" value="${esc(pref("email", ""))}">
      <button class="btn primary" type="submit">שליחת קישור כניסה</button>
    </form>
    <form id="cf" hidden style="margin-top:14px">
      <input id="code" inputmode="numeric" dir="ltr" placeholder="קוד מהמייל" autocomplete="one-time-code">
      <button class="btn" type="submit">כניסה עם קוד</button>
    </form>
    <div class="msg" id="msg"></div>
  </div></div>`;
  const msg = document.getElementById("msg");
  document.getElementById("lf").onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById("em").value.trim();
    setPref("email", email);
    msg.className = "msg"; msg.textContent = "שולח…";
    const { error } = await sb.auth.signInWithOtp({
      email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
    });
    if (error) { msg.className = "msg err"; msg.textContent = "לא הצלחתי לשלוח. בדוק את הכתובת, או נסה שוב בעוד דקה."; console.error(error); return; }
    msg.textContent = "שלחתי. פתח את המייל ולחץ על הקישור. אם במייל יש קוד, אפשר להקליד אותו כאן.";
    document.getElementById("cf").hidden = false;
  };
  document.getElementById("cf").onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.auth.verifyOtp({ email: pref("email", ""), token: document.getElementById("code").value.trim(), type: "email" });
    if (error) { msg.className = "msg err"; msg.textContent = "הקוד לא עבד. נסה שוב."; }
  };
}

/* ---------- shared: kanban ---------- */
function kanban(items, stages, field, cardHtml, onAdd) {
  return `<div class="board">${stages.map((s) => {
    const list = items.filter((i) => (i[field] || stages[0].k) === s.k);
    const sum = field === "stage" ? list.reduce((a, d) => a + (Number(d.value) || 0), 0) : 0;
    return `<section class="col" data-col="${esc(s.k)}">
      <h3><span>${chipOf(stages, s.k)}</span><small>${list.length}</small></h3>
      ${sum ? `<div class="col-sum">${money(sum)}</div>` : ""}
      ${list.map((i) => `<article class="card" draggable="true" data-id="${i.id}">${cardHtml(i)}</article>`).join("")}
      ${onAdd ? `<button class="add" data-add="${esc(s.k)}">+ חדש</button>` : ""}
    </section>`;
  }).join("")}</div>`;
}
function wireKanban(table, field, open, onAdd) {
  document.querySelectorAll(".card").forEach((c) => {
    c.onclick = () => open(c.dataset.id);
    c.ondragstart = (e) => { e.dataTransfer.setData("text/plain", c.dataset.id); c.classList.add("dragging"); };
    c.ondragend = () => c.classList.remove("dragging");
  });
  document.querySelectorAll(".col").forEach((col) => {
    col.ondragover = (e) => { e.preventDefault(); col.classList.add("over"); };
    col.ondragleave = () => col.classList.remove("over");
    col.ondrop = (e) => {
      e.preventDefault(); col.classList.remove("over");
      const id = e.dataTransfer.getData("text/plain");
      const rec = byId(table, id);
      if (rec && rec[field] !== col.dataset.col) { update(table, id, { [field]: col.dataset.col }, { now: true }); render(); }
    };
  });
  if (onAdd) document.querySelectorAll("[data-add]").forEach((b) => (b.onclick = () => onAdd(b.dataset.add)));
}

/* ---------- deals ---------- */
function dealsView() {
  const mode = pref("dealsMode", "board");
  const q = (pref("dealsQ", "") || "").toLowerCase();
  const items = S.deals.filter((d) => !q || [d.title, clientName(d.client_id), d.product, ...(d.tags || [])].join(" ").toLowerCase().includes(q));
  const open = S.deals.filter((d) => !["נסגר", "לא נסגר"].includes(d.stage));
  const openSum = open.reduce((a, d) => a + (Number(d.value) || 0), 0);
  const won = S.deals.filter((d) => d.stage === "נסגר").reduce((a, d) => a + (Number(d.value) || 0), 0);
  const head = `<div class="head"><div><h1>עסקאות</h1>
    <div class="sub">${open.length} פתוחות${openSum ? ` · ${money(openSum)} בצנרת` : ""}${won ? ` · ${money(won)} נסגרו` : ""}</div></div>
    <div class="tools"><input class="search" id="q" placeholder="חיפוש…" value="${esc(pref("dealsQ", ""))}">
    <div class="seg"><button data-m="board" class="${mode === "board" ? "on" : ""}">קנבן</button><button data-m="table" class="${mode === "table" ? "on" : ""}">טבלה</button></div>
    <button class="btn primary" id="new">+ עסקה</button></div></div>`;
  let body;
  if (!S.deals.length) body = `<div class="tbl-wrap"><div class="empty"><b>עוד אין עסקאות</b>כל ליד שאתה מדבר איתו על עבודה הוא עסקה. הוסף את הראשונה.</div></div>`;
  else if (mode === "board")
    body = kanban(items, DEAL_STAGES, "stage", (d) => `
      <div class="t">${esc(d.title || "ללא שם")}</div>
      <div class="m">${d.client_id ? `<span>${esc(clientName(d.client_id))}</span>` : ""}${d.value ? `<span class="v">${money(d.value)}</span>` : ""}
      ${d.next_step_date ? `<span class="${isLate(d.next_step_date) ? "late" : ""}">${fmtDate(d.next_step_date)}</span>` : ""}</div>
      ${d.next_step ? `<div class="m" style="margin-top:4px">← ${esc(d.next_step)}</div>` : ""}`, true);
  else
    body = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>עסקה</th><th>לקוח</th><th>שלב</th><th>סכום</th><th>הצעד הבא</th><th>מתי</th><th>תגיות</th></tr></thead><tbody>
      ${items.map((d) => `<tr data-id="${d.id}"><td class="title">${esc(d.title || "ללא שם")}</td><td>${esc(clientName(d.client_id))}</td><td>${chipOf(DEAL_STAGES, d.stage)}</td>
      <td class="num">${money(d.value)}</td><td class="dim">${esc(d.next_step || "")}</td><td class="num ${isLate(d.next_step_date) ? "late" : "dim"}">${fmtDate(d.next_step_date)}</td><td>${tagsHtml(d.tags)}</td></tr>`).join("")}
    </tbody></table></div>`;
  return [head + body, () => {
    wireSearch("dealsQ");
    document.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { setPref("dealsMode", b.dataset.m); render(); }));
    document.getElementById("new").onclick = () => newDeal();
    document.querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => (location.hash = "#/deal/" + tr.dataset.id)));
    wireKanban("deals", "stage", (id) => (location.hash = "#/deal/" + id), (stage) => newDeal({ stage }));
  }];
}
async function newDeal(extra = {}) {
  const d = await insert("deals", { title: "", stage: "ליד חדש", ...extra });
  if (d) location.hash = "#/deal/" + d.id;
}
function wireSearch(key) {
  const q = document.getElementById("q");
  if (!q) return;
  q.oninput = () => { setPref(key, q.value); clearTimeout(q._t); q._t = setTimeout(() => { render(); const n = document.getElementById("q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
}

/* ---------- record page building blocks ---------- */
function tagEditor(tags) {
  return `<div class="chips" id="tags">${(tags || []).map((t, i) => `<span class="tag">${esc(t)}<button data-rm="${i}" aria-label="הסרה">×</button></span>`).join("")}
    <input class="tag-input" id="tagin" list="taglist" placeholder="+ תגית"><datalist id="taglist">${allTags().map((t) => `<option value="${esc(t)}">`).join("")}</datalist></div>`;
}
function wireTags(table, rec) {
  const rerender = () => { document.getElementById("tags").outerHTML = tagEditor(rec.tags); wireTags(table, rec); };
  document.querySelectorAll("#tags [data-rm]").forEach((b) => (b.onclick = () => {
    const tags = [...(rec.tags || [])]; tags.splice(+b.dataset.rm, 1);
    update(table, rec.id, { tags }, { now: true }); rerender();
  }));
  const inp = document.getElementById("tagin");
  const add = () => {
    const v = inp.value.trim().replace(/,$/, "");
    if (!v) return;
    const tags = [...new Set([...(rec.tags || []), v])];
    update(table, rec.id, { tags }, { now: true }); rerender();
    document.getElementById("tagin").focus();
  };
  inp.onkeydown = (e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } };
  inp.onchange = () => { if (allTags().includes(inp.value.trim())) add(); };
}
function bindFields(table, rec) {
  document.querySelectorAll("[data-f]").forEach((el) => {
    const f = el.dataset.f;
    const ev = el.tagName === "SELECT" || el.type === "date" ? "change" : "input";
    el.addEventListener(ev, () => {
      let v = el.value;
      if (el.type === "number") v = v === "" ? null : Number(v);
      else if (el.type === "date") v = v || null;
      else if (f === "client_id" || f === "deal_id") v = v || null;
      update(table, rec.id, { [f]: v }, { now: ev === "change" });
      if (el.dataset.rerender) render();
    });
  });
}
function linkedTasks(filter, ctx) {
  const list = S.tasks.filter(filter).sort((a, b) => (a.status === "הושלם") - (b.status === "הושלם") || String(a.due_date || "9").localeCompare(String(b.due_date || "9")));
  return `<div class="sec"><h2>משימות <small class="dim" style="font-weight:600;color:var(--muted)">${list.filter((t) => t.status !== "הושלם").length} פתוחות</small></h2>
    <div class="list">${list.map((t) => `<div class="item" data-task="${t.id}">
      <input type="checkbox" class="done" data-done="${t.id}" ${t.status === "הושלם" ? "checked" : ""}>
      <div class="grow ${t.status === "הושלם" ? "struck" : ""}"><b>${esc(t.title || "ללא שם")}</b></div>
      ${t.priority === "גבוהה" ? chipOf(PRIORITIES, t.priority) : ""}
      ${t.due_date ? `<span class="${isLate(t.due_date) && t.status !== "הושלם" ? "late" : "dim"}" style="font-size:13px">${fmtDate(t.due_date)}</span>` : ""}</div>`).join("")}
    </div>
    <div class="add-row" style="border:0;padding:6px 0"><input id="newtask" placeholder="+ משימה חדשה, Enter לשמירה"></div></div>`;
}
function wireLinkedTasks(ctx) {
  document.querySelectorAll("[data-done]").forEach((cb) => {
    cb.onclick = (e) => e.stopPropagation();
    cb.onchange = () => { update("tasks", cb.dataset.done, { status: cb.checked ? "הושלם" : "לעשות" }, { now: true }); render(); };
  });
  document.querySelectorAll("[data-task]").forEach((it) => (it.onclick = () => openTask(it.dataset.task)));
  const nt = document.getElementById("newtask");
  if (nt) nt.onkeydown = async (e) => {
    if (e.key !== "Enter" || !nt.value.trim()) return;
    const t = await insert("tasks", { title: nt.value.trim(), ...ctx, position: Date.now() });
    if (t) { render(); document.getElementById("newtask")?.focus(); }
  };
}
function timeline(filter, ctx) {
  const list = S.updates.filter(filter);
  return `<div class="sec timeline"><h2>יומן עדכונים</h2>
    <div class="composer"><textarea id="upd" placeholder="מה קרה? שיחה, הודעה, החלטה…"></textarea><button class="btn" id="addupd">הוספה</button></div>
    ${list.map((u) => `<div class="u"><time>${fmtWhen(u.created_at)}</time><p>${esc(u.body)}</p><button data-delupd="${u.id}" title="מחיקה">×</button></div>`).join("") || `<div class="dim" style="font-size:13.5px;color:var(--muted);padding:6px 0">עוד אין עדכונים.</div>`}
  </div>`;
}
function wireTimeline(ctx) {
  const ta = document.getElementById("upd");
  const add = async () => {
    const body = ta.value.trim(); if (!body) return;
    const u = await insert("updates", { body, ...ctx });
    if (u) render();
  };
  document.getElementById("addupd").onclick = add;
  ta.onkeydown = (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add(); };
  document.querySelectorAll("[data-delupd]").forEach((b) => (b.onclick = async () => {
    if (!confirm("למחוק את העדכון?")) return;
    await remove("updates", b.dataset.delupd); render();
  }));
}

/* ---------- deal page ---------- */
function dealPage(id) {
  const d = byId("deals", id);
  if (!d) return [`<div class="empty"><b>העסקה לא נמצאה</b><a href="#/deals">חזרה לעסקאות</a></div>`];
  const c = d.client_id && byId("clients", d.client_id);
  const html = `<div class="crumb"><a href="#/deals">עסקאות</a> / ${esc(d.title || "עסקה חדשה")}</div>
  <div class="page">
    <input class="page-title" data-f="title" value="${esc(d.title)}" placeholder="שם העסקה, למשל: ליווי 4 חודשים – אסתר">
    <div class="saved"></div>
    <div class="props">
      <div class="k">שלב</div><div class="v"><select class="field" data-f="stage" data-rerender="1">${opts(DEAL_STAGES, d.stage)}</select></div>
      <div class="k">לקוח</div><div class="v"><select class="field" data-f="client_id" data-rerender="1">${opts(S.clients.map((x) => ({ k: x.id })), d.client_id, "— בחר לקוח —").replace(/>([0-9a-f-]{36})</g, (m, cid) => ">" + esc(clientName(cid) || "ללא שם") + "<")}<option value="__new">+ לקוח חדש…</option></select>
        ${c ? `<a class="link-out" href="#/client/${c.id}">לדף הלקוח ←</a>` : ""}</div>
      <div class="k">סכום</div><div class="v"><input class="field" type="number" inputmode="decimal" data-f="value" value="${d.value ?? ""}" placeholder="₪"></div>
      <div class="k">מסלול / מוצר</div><div class="v"><input class="field" data-f="product" value="${esc(d.product)}" placeholder="למשל: לחבר את הפאזל"></div>
      <div class="k">הצעד הבא</div><div class="v"><input class="field" data-f="next_step" value="${esc(d.next_step)}" placeholder="מה הדבר הבא שצריך לקרות?"></div>
      <div class="k">מתי</div><div class="v"><input class="field" type="date" data-f="next_step_date" value="${d.next_step_date || ""}"></div>
      <div class="k">סגירה צפויה</div><div class="v"><input class="field" type="date" data-f="close_date" value="${d.close_date || ""}"></div>
      <div class="k">תגיות</div><div class="v">${tagEditor(d.tags)}</div>
      <div class="k">נוצרה</div><div class="v dim" style="padding-inline-start:8px;color:var(--muted)">${fmtDate(d.created_at)}</div>
    </div>
    <div class="sec"><h2>הערות</h2><textarea class="field" data-f="notes" placeholder="כל מה שחשוב לזכור על העסקה הזאת">${esc(d.notes)}</textarea></div>
    ${linkedTasks((t) => t.deal_id === d.id)}
    ${timeline((u) => u.deal_id === d.id)}
    <div class="page-actions"><a class="btn ghost" href="#/deals">→ חזרה</a><button class="btn ghost danger" id="del">מחיקת העסקה</button></div>
  </div>`;
  return [html, () => {
    bindFields("deals", d);
    const sel = document.querySelector('[data-f="client_id"]');
    sel.addEventListener("change", async (e) => {
      if (sel.value !== "__new") return;
      e.stopImmediatePropagation();
      const name = prompt("שם הלקוח:");
      if (!name) { render(); return; }
      const nc = await insert("clients", { name });
      if (nc) { update("deals", d.id, { client_id: nc.id }, { now: true }); render(); }
    }, { capture: true });
    wireTags("deals", d);
    wireLinkedTasks({ deal_id: d.id, client_id: d.client_id });
    wireTimeline({ deal_id: d.id, client_id: d.client_id });
    document.getElementById("del").onclick = async () => {
      if (!confirm("למחוק את העסקה? המשימות שלה יישארו.")) return;
      await remove("deals", d.id); location.hash = "#/deals";
    };
    if (!d.title) document.querySelector(".page-title").focus();
  }];
}

/* ---------- clients ---------- */
function clientsView() {
  const q = (pref("clientsQ", "") || "").toLowerCase();
  const items = S.clients.filter((c) => !q || [c.name, c.company, c.email, c.phone, c.source, ...(c.tags || [])].join(" ").toLowerCase().includes(q));
  const head = `<div class="head"><div><h1>לקוחות</h1><div class="sub">${S.clients.length} במאגר · ${S.clients.filter((c) => c.status === "לקוח פעיל").length} פעילים</div></div>
    <div class="tools"><input class="search" id="q" placeholder="חיפוש…" value="${esc(pref("clientsQ", ""))}"><button class="btn primary" id="new">+ לקוח</button></div></div>`;
  const body = !S.clients.length
    ? `<div class="tbl-wrap"><div class="empty"><b>המאגר ריק</b>הוסף את האנשים שאתה מדבר איתם, כל אחד מקבל דף משלו.</div></div>`
    : `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>שם</th><th>עסק</th><th>סטטוס</th><th>תגיות</th><th>טלפון</th><th>עסקאות</th><th>עודכן</th></tr></thead><tbody>
      ${items.map((c) => `<tr data-id="${c.id}"><td class="title">${esc(c.name || "ללא שם")}</td><td>${esc(c.company || "")}</td><td>${chipOf(CLIENT_STATUSES, c.status)}</td>
      <td>${tagsHtml(c.tags)}</td><td class="num dim" dir="ltr" style="text-align:right">${esc(c.phone || "")}</td><td class="num">${S.deals.filter((d) => d.client_id === c.id).length || ""}</td><td class="num dim">${fmtDate(c.updated_at)}</td></tr>`).join("")}
      </tbody></table></div>`;
  return [head + body, () => {
    wireSearch("clientsQ");
    document.getElementById("new").onclick = async () => { const c = await insert("clients", { name: "" }); if (c) location.hash = "#/client/" + c.id; };
    document.querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => (location.hash = "#/client/" + tr.dataset.id)));
  }];
}
function waLink(phone) {
  let p = String(phone || "").replace(/[^\d+]/g, "");
  if (!p) return "";
  if (p.startsWith("+")) p = p.slice(1); else if (p.startsWith("0")) p = "972" + p.slice(1);
  return `https://wa.me/${p}`;
}
function clientPage(id) {
  const c = byId("clients", id);
  if (!c) return [`<div class="empty"><b>הלקוח לא נמצא</b><a href="#/clients">חזרה ללקוחות</a></div>`];
  const deals = S.deals.filter((d) => d.client_id === c.id);
  const html = `<div class="crumb"><a href="#/clients">לקוחות</a> / ${esc(c.name || "לקוח חדש")}</div>
  <div class="page">
    <input class="page-title" data-f="name" value="${esc(c.name)}" placeholder="שם מלא">
    <div class="saved"></div>
    <div class="props">
      <div class="k">סטטוס</div><div class="v"><select class="field" data-f="status">${opts(CLIENT_STATUSES, c.status)}</select></div>
      <div class="k">עסק</div><div class="v"><input class="field" data-f="company" value="${esc(c.company)}" placeholder="שם העסק / תחום"></div>
      <div class="k">תפקיד</div><div class="v"><input class="field" data-f="role" value="${esc(c.role)}" placeholder="למשל: בעלים, מאמנת"></div>
      <div class="k">טלפון</div><div class="v"><input class="field" type="tel" dir="ltr" style="text-align:right" data-f="phone" value="${esc(c.phone)}" placeholder="05x-xxxxxxx">
        ${c.phone ? `<a class="link-out" target="_blank" rel="noopener" href="${esc(waLink(c.phone))}">וואטסאפ ←</a>` : ""}</div>
      <div class="k">מייל</div><div class="v"><input class="field" type="email" dir="ltr" style="text-align:right" data-f="email" value="${esc(c.email)}" placeholder="name@email.com">
        ${c.email ? `<a class="link-out" href="mailto:${esc(c.email)}">מייל ←</a>` : ""}</div>
      <div class="k">הגיע/ה דרך</div><div class="v"><input class="field" data-f="source" value="${esc(c.source)}" placeholder="למשל: קבוצת סודות הזוהר"></div>
      <div class="k">תגיות</div><div class="v">${tagEditor(c.tags)}</div>
      <div class="k">נוצר</div><div class="v" style="padding-inline-start:8px;color:var(--muted)">${fmtDate(c.created_at)}</div>
    </div>
    <div class="sec"><h2>הערות</h2><textarea class="field" data-f="notes" placeholder="מה חשוב לדעת עליו/ה: העסק, הכאב, מה אמר/ה">${esc(c.notes)}</textarea></div>
    <div class="sec"><h2>עסקאות <button class="btn" id="newdeal">+ עסקה</button></h2>
      <div class="list">${deals.map((d) => `<a class="item" href="#/deal/${d.id}"><div class="grow"><b>${esc(d.title || "ללא שם")}</b></div>${d.value ? `<span class="num">${money(d.value)}</span>` : ""}${chipOf(DEAL_STAGES, d.stage)}</a>`).join("") || `<div style="font-size:13.5px;color:var(--muted);padding:6px 0">אין עסקאות עדיין.</div>`}</div></div>
    ${linkedTasks((t) => t.client_id === c.id)}
    ${timeline((u) => u.client_id === c.id)}
    <div class="page-actions"><a class="btn ghost" href="#/clients">→ חזרה</a><button class="btn ghost danger" id="del">מחיקת הלקוח</button></div>
  </div>`;
  return [html, () => {
    bindFields("clients", c);
    wireTags("clients", c);
    wireLinkedTasks({ client_id: c.id });
    wireTimeline({ client_id: c.id });
    document.getElementById("newdeal").onclick = () => newDeal({ client_id: c.id, title: c.name ? `${c.name}` : "" });
    document.getElementById("del").onclick = async () => {
      if (!confirm("למחוק את הלקוח? העסקאות והמשימות שלו יישארו, בלי קישור.")) return;
      await remove("clients", c.id); location.hash = "#/clients";
    };
    if (!c.name) document.querySelector(".page-title").focus();
  }];
}

/* ---------- tasks ---------- */
function tasksView() {
  const mode = pref("tasksMode", "table");
  const filter = pref("tasksF", "open");
  const t0 = today();
  const fns = {
    open: (t) => t.status !== "הושלם",
    today: (t) => t.status !== "הושלם" && t.due_date && t.due_date <= t0,
    late: (t) => t.status !== "הושלם" && isLate(t.due_date),
    all: () => true,
  };
  const q = (pref("tasksQ", "") || "").toLowerCase();
  let items = S.tasks.filter(mode === "board" ? () => true : fns[filter]).filter((t) => !q || [t.title, clientName(t.client_id), dealTitle(t.deal_id)].join(" ").toLowerCase().includes(q));
  const prio = { "גבוהה": 0, "רגילה": 1, "נמוכה": 2 };
  items.sort((a, b) => (a.status === "הושלם") - (b.status === "הושלם") || String(a.due_date || "9999").localeCompare(String(b.due_date || "9999")) || prio[a.priority] - prio[b.priority]);
  const lateN = S.tasks.filter(fns.late).length;
  const head = `<div class="head"><div><h1>משימות</h1><div class="sub">${S.tasks.filter(fns.open).length} פתוחות${lateN ? ` · <span class="late">${lateN} באיחור</span>` : ""}</div></div>
    <div class="tools"><input class="search" id="q" placeholder="חיפוש…" value="${esc(pref("tasksQ", ""))}">
    ${mode === "table" ? `<div class="seg">${[["open", "פתוחות"], ["today", "להיום"], ["late", "באיחור"], ["all", "הכל"]].map(([k, l]) => `<button data-f2="${k}" class="${filter === k ? "on" : ""}">${l}</button>`).join("")}</div>` : ""}
    <div class="seg"><button data-m="table" class="${mode === "table" ? "on" : ""}">טבלה</button><button data-m="board" class="${mode === "board" ? "on" : ""}">קנבן</button></div>
    </div></div>`;
  const related = (t) => [t.deal_id ? `<a href="#/deal/${t.deal_id}" data-stop>${esc(dealTitle(t.deal_id) || "עסקה")}</a>` : "", !t.deal_id && t.client_id ? `<a href="#/client/${t.client_id}" data-stop>${esc(clientName(t.client_id) || "לקוח")}</a>` : ""].join("");
  let body;
  if (mode === "board")
    body = kanban(items, TASK_STATUSES, "status", (t) => `<div class="t">${esc(t.title || "ללא שם")}</div>
      <div class="m">${t.priority !== "רגילה" ? chipOf(PRIORITIES, t.priority) : ""}${t.due_date ? `<span class="${isLate(t.due_date) && t.status !== "הושלם" ? "late" : ""}">${fmtDate(t.due_date)}</span>` : ""}${related(t) ? `<span>${related(t)}</span>` : ""}</div>`, true);
  else
    body = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th></th><th>משימה</th><th>סטטוס</th><th>עדיפות</th><th>תאריך יעד</th><th>קשור ל</th></tr></thead><tbody>
      ${items.map((t) => `<tr data-id="${t.id}"><td class="check"><input type="checkbox" class="done" data-done="${t.id}" ${t.status === "הושלם" ? "checked" : ""}></td>
      <td class="title ${t.status === "הושלם" ? "struck" : ""}">${esc(t.title || "ללא שם")}</td><td>${chipOf(TASK_STATUSES, t.status)}</td><td>${chipOf(PRIORITIES, t.priority)}</td>
      <td class="num ${isLate(t.due_date) && t.status !== "הושלם" ? "late" : "dim"}">${fmtDate(t.due_date)}</td><td class="dim">${related(t)}</td></tr>`).join("")}
      </tbody></table>${!items.length ? `<div class="empty"><b>${S.tasks.length ? "אין משימות כאן" : "עוד אין משימות"}</b>${S.tasks.length ? "נסה סינון אחר." : "כתוב משימה למטה ולחץ Enter."}</div>` : ""}
      <div class="add-row"><input id="newtask" placeholder="+ משימה חדשה, Enter לשמירה"></div></div>`;
  return [head + body, () => {
    wireSearch("tasksQ");
    document.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { setPref("tasksMode", b.dataset.m); render(); }));
    document.querySelectorAll("[data-f2]").forEach((b) => (b.onclick = () => { setPref("tasksF", b.dataset.f2); render(); }));
    document.querySelectorAll("[data-stop]").forEach((a) => a.addEventListener("click", (e) => e.stopPropagation()));
    document.querySelectorAll("[data-done]").forEach((cb) => {
      cb.onclick = (e) => e.stopPropagation();
      cb.onchange = () => { update("tasks", cb.dataset.done, { status: cb.checked ? "הושלם" : "לעשות" }, { now: true }); render(); };
    });
    document.querySelectorAll("tr[data-id]").forEach((tr) => (tr.onclick = () => openTask(tr.dataset.id)));
    const nt = document.getElementById("newtask");
    if (nt) nt.onkeydown = async (e) => {
      if (e.key !== "Enter" || !nt.value.trim()) return;
      const t = await insert("tasks", { title: nt.value.trim(), due_date: filter === "today" ? today() : null, position: Date.now() });
      if (t) { render(); document.getElementById("newtask")?.focus(); }
    };
    wireKanban("tasks", "status", openTask, async (status) => {
      const title = prompt("משימה חדשה:"); if (!title) return;
      await insert("tasks", { title, status, position: Date.now() }); render();
    });
  }];
}

/* ---------- task drawer ---------- */
function openTask(id) {
  const t = byId("tasks", id);
  if (!t) return;
  closeDrawer();
  const wrap = document.createElement("div");
  wrap.id = "drawer";
  const dealOpts = S.deals.map((d) => `<option value="${d.id}" ${d.id === t.deal_id ? "selected" : ""}>${esc(d.title || "ללא שם")}</option>`).join("");
  const clientOpts = S.clients.map((c) => `<option value="${c.id}" ${c.id === t.client_id ? "selected" : ""}>${esc(c.name || "ללא שם")}</option>`).join("");
  wrap.innerHTML = `<div class="scrim"></div><aside class="drawer" role="dialog" aria-label="משימה">
    <button class="x" aria-label="סגירה">×</button>
    <input class="page-title" data-f="title" value="${esc(t.title)}" placeholder="מה צריך לעשות?">
    <div class="saved"></div>
    <div class="props">
      <div class="k">סטטוס</div><div class="v"><select class="field" data-f="status">${opts(TASK_STATUSES, t.status)}</select></div>
      <div class="k">עדיפות</div><div class="v"><select class="field" data-f="priority">${opts(PRIORITIES, t.priority)}</select></div>
      <div class="k">תאריך יעד</div><div class="v"><input class="field" type="date" data-f="due_date" value="${t.due_date || ""}"></div>
      <div class="k">עסקה</div><div class="v"><select class="field" data-f="deal_id"><option value="">—</option>${dealOpts}</select></div>
      <div class="k">לקוח</div><div class="v"><select class="field" data-f="client_id"><option value="">—</option>${clientOpts}</select></div>
    </div>
    <div class="sec"><h2>פרטים</h2><textarea class="field" data-f="notes" placeholder="הערות למשימה">${esc(t.notes)}</textarea></div>
    <div class="page-actions"><button class="btn" id="tclose">סגירה</button><button class="btn ghost danger" id="tdel">מחיקה</button></div>
  </aside>`;
  document.body.appendChild(wrap);
  document.body.style.overflow = "hidden";
  wrap.querySelectorAll("[data-f]").forEach((el) => {
    const f = el.dataset.f;
    const ev = el.tagName === "SELECT" || el.type === "date" ? "change" : "input";
    el.addEventListener(ev, () => {
      let v = el.value || (f === "title" || f === "notes" ? el.value : null);
      const patch = { [f]: v };
      if (f === "deal_id" && v) { const d = byId("deals", v); if (d?.client_id) { patch.client_id = d.client_id; wrap.querySelector('[data-f="client_id"]').value = d.client_id; } }
      update("tasks", t.id, patch, { now: ev === "change" });
    });
  });
  const close = () => { closeDrawer(); render(); };
  wrap.querySelector(".scrim").onclick = close;
  wrap.querySelector(".x").onclick = close;
  wrap.querySelector("#tclose").onclick = close;
  wrap.querySelector("#tdel").onclick = async () => { if (!confirm("למחוק את המשימה?")) return; await remove("tasks", t.id); close(); };
  document.addEventListener("keydown", escClose);
  function escClose(e) { if (e.key === "Escape") { document.removeEventListener("keydown", escClose); close(); } }
}
function closeDrawer() {
  document.getElementById("drawer")?.remove();
  document.body.style.overflow = "";
}

/* ================= boot ================= */
async function onSession(session) {
  const had = !!S.user;
  S.user = session?.user || null;
  if (!S.user) { S.loaded = false; closeDrawer(); render(); return; }
  if (had && S.loaded) return;
  render();
  try { await loadAll(); } catch (e) { console.error(e); $app.innerHTML = `<div class="boot">לא הצלחתי לטעון את הנתונים. רענן את הדף.</div>`; return; }
  if (location.hash.includes("access_token")) history.replaceState(null, "", location.pathname + "#/deals");
  render();
}
sb.auth.onAuthStateChange((_e, session) => { onSession(session); });
const { data: { session } } = await sb.auth.getSession();
onSession(session);
