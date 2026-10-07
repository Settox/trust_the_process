// map.js — mappa: nodi, collegamenti, penna, pan/zoom, selezione, minimappa, tab, ricerca, undo
import { state, currentPage, findNode, save, mediaUrls, hydrateMedia, storeBlob, idbDel, runtime } from "../core/store.js";
import { uid, clamp, escapeHtml, toast, plainText, r1, promptModal, confirmModal } from "../core/util.js";
import { emit, on } from "../core/bus.js";
import { settings } from "../core/settings.js";
import { icon, gripIcon } from "../ui/icons.js";
import { showMenu } from "../ui/contextMenu.js";
import { svc } from "../core/svc.js";
import { rectOf, setBoxRect, attachCropBox } from "../core/crop.js";
import { registerAction } from "../ui/commandPalette.js";

const NS = "http://www.w3.org/2000/svg";
export const PALETTE = ["#8ab4ff", "#ff6b9d", "#ffd166", "#6ee7a0", "#4ecdc4", "#c9a6ff", "#ff9e6d", "#ffffff"];

/* ---- DOM ---- */
let viewport, world, svgEl, drawSvg, tabsEl, cursorsEl, zoomPct, ctxBarEl;
let nodeActionsEl, connActionsEl, linkPaletteEl, penBarEl;

export const view = { x: 0, y: 0, z: 1 };
let views = {}, viewPid = null, viewAnim = 0, viewSaveT = null;

export let selectedNode = null, selectedConn = null;
let currentColor = "#8ab4ff";

const disp = {}, nodeEls = {};
let localDrag = null, editingTab = false, linkingFrom = null, tempLine = null;
let msel = {};
let selBoxEl = null, miniEl = null, miniOn = false;

let renderAll = () => { renderTabs(); renderGraph(); updateNodeActions(); };
export function setRenderAll(fn) { renderAll = fn; }

/* ================= TAB / PAGINE ================= */
function renderTabs() {
  if (!tabsEl) return;
  tabsEl.innerHTML = "";
  state.pages.forEach((p, i) => {
    const b = document.createElement("div");
    b.className = "tab" + (i === state.current ? " active" : "");
    b.title = "Doppio clic per rinominare";
    const n = document.createElement("span");
    n.className = "tab-name";
    n.textContent = p.name;
    b.appendChild(n);
    if (state.pages.length > 1) {
      const x = document.createElement("button");
      x.className = "tab-x";
      x.textContent = "×";
      x.onclick = (e) => { e.stopPropagation(); deletePage(i); };
      b.appendChild(x);
    }
    b.addEventListener("click", () => { if (!editingTab) switchPage(i); });
    b.addEventListener("dblclick", (e) => { e.preventDefault(); e.stopPropagation(); startRenameTab(i); });
    b.addEventListener("contextmenu", (e) => {
      e.preventDefault(); e.stopPropagation();
      const items = [{ l: "Rinomina pagina", fn: () => startRenameTab(i) }];
      if (state.pages.length > 1) { items.push({ sep: 1 }, { l: "Elimina pagina", danger: true, fn: () => deletePage(i) }); }
      showMenu(items, e.clientX, e.clientY);
    });
    tabsEl.appendChild(b);
  });
  const add = document.createElement("button");
  add.className = "tab-add";
  add.textContent = "+";
  add.title = "Nuova pagina";
  add.onclick = addPage;
  tabsEl.appendChild(add);
}

function startRenameTab(i) {
  const tab = tabsEl.querySelectorAll(".tab")[i], p = state.pages[i];
  if (!tab || !p || editingTab) return;
  const nameEl = tab.querySelector(".tab-name");
  if (!nameEl) return;
  const inp = document.createElement("input");
  inp.className = "tab-input"; inp.value = p.name; inp.maxLength = 48; inp.spellcheck = false;
  inp.style.width = Math.max(70, nameEl.offsetWidth + 22) + "px";
  tab.replaceChild(inp, nameEl); editingTab = true; inp.focus(); inp.select();
  let done = false;
  function finish(ok) {
    if (done) return; done = true; editingTab = false;
    const t = inp.value.trim();
    if (ok && t && t !== p.name) { p.name = t; save(); }
    renderTabs();
  }
  inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); finish(true); } else if (e.key === "Escape") { e.preventDefault(); finish(false); } });
  inp.addEventListener("blur", () => finish(true));
  ["click", "dblclick", "pointerdown", "contextmenu"].forEach(ev => inp.addEventListener(ev, e => e.stopPropagation()));
}

export function addPage() {
  state.pages.push({ id: uid(), name: "Pagina " + (state.pages.length + 1), nodes: [], connections: [] });
  state.current = state.pages.length - 1;
  Object.keys(disp).forEach(k => delete disp[k]);
  renderAll(); save();
}

export async function deletePage(i) {
  if (state.pages.length <= 1) return;
  if (state.pages[i].nodes.some(n => n.locked)) { toast("La pagina contiene nodi bloccati: togli prima i lucchetti."); return; }
  if (!(await confirmModal('Eliminare la pagina "' + state.pages[i].name + '"?'))) return;
  const curId = currentPage().id;
  state.pages.splice(i, 1);
  const ix = state.pages.findIndex(p => p.id === curId);
  state.current = ix >= 0 ? ix : Math.min(i, state.pages.length - 1);
  selectedNode = null; selectedConn = null;
  Object.keys(disp).forEach(k => delete disp[k]);
  renderAll(); save();
}

export function switchPage(i) {
  if (i === state.current) return;
  state.current = i;
  selectedNode = null; selectedConn = null;
  Object.keys(disp).forEach(k => delete disp[k]);
  Array.prototype.forEach.call(tabsEl.querySelectorAll(".tab"), (t, k) => t.classList.toggle("active", k === i));
  loadView(); renderGraph(); updateNodeActions();
  emit("page:changed", { index: i });
}

/* ================= NODI ================= */
function serializeBody(el) {
  const c = el.cloneNode(true);
  c.querySelectorAll("[data-media-id]").forEach(m => { m.removeAttribute("src"); m.removeAttribute("poster"); });
  return c.innerHTML;
}

function fillBody(bodyEl, n) {
  bodyEl.innerHTML = n.body || "";
  bodyEl.querySelectorAll("[data-media-id]").forEach(m => {
    m.setAttribute("contenteditable", "false");
    if (mediaUrls[m.getAttribute("data-media-id")]) m.src = mediaUrls[m.getAttribute("data-media-id")];
  });
  bodyEl.querySelectorAll("video,iframe,img").forEach(m => m.setAttribute("contenteditable", "false"));
}

function lockSvg(on) {
  return on ? icon("lock", 14) : icon("unlock", 14);
}

function renderSource(srcEl, n) {
  const s = n.source;
  if (!s) { srcEl.style.display = "none"; return; }
  srcEl.style.display = "flex";
  let label, go;
  if (typeof s === "string") label = "Fonte: " + escapeHtml(s);
  else if (s.type === "pdf") { label = "Fonte: " + escapeHtml(s.volumeName || "Volume") + " · p." + s.page; go = () => svc.openPdfViewer(s.volumeId, s.page, s.phrase, s.segs, s.spanIndices); }
  else if (s.type === "pdf-image") { label = "Fonte: " + escapeHtml(s.volumeName || "Volume") + " · p." + s.page; go = () => svc.openPdfViewer(s.volumeId, s.page); }
  else { label = "Fonte: " + escapeHtml(s.volumeName || s.label || "Volume"); go = () => svc.focusVolume(s.volumeId, s.phrase, s.start); }
  srcEl.innerHTML = '<span class="src-label">' + label + '</span>';
  if (go) {
    const b = document.createElement("button");
    b.className = "src-go"; b.textContent = "Apri"; b.title = "Vai alla fonte";
    b.onclick = (e) => { e.stopPropagation(); go(); };
    srcEl.appendChild(b);
  }
}

function applyNodeStyle(el, n) {
  el.style.setProperty("--fs", (n.fs || 12.5) + "px");
  if (n.color) { el.style.setProperty("--nc", n.color); el.classList.add("colored"); }
  else { el.style.removeProperty("--nc"); el.classList.remove("colored"); }
  el.classList.toggle("bare", !!n.bare);
  el.classList.toggle("locked", !!n.locked);
  const lb = el.querySelector(".node-lock");
  if (lb) { lb.innerHTML = lockSvg(!!n.locked); lb.classList.toggle("on", !!n.locked); lb.title = n.locked ? "Bloccato: clicca per sbloccare" : "Blocca (impedisce l'eliminazione)"; }
}

function createNodeElement(n) {
  const el = document.createElement("div");
  el.className = "node" + (selectedNode === n.id ? " selected" : "");
  el.dataset.id = n.id;
  nodeEls[n.id] = el;
  el.style.left = n.x + "px"; el.style.top = n.y + "px"; el.style.width = n.w + "px"; el.style.height = n.h + "px";
  el.innerHTML = '<div class="node-head"><span class="node-grip" title="Trascina">' + gripIcon(12) + '</span><span class="node-title" contenteditable="true" spellcheck="false"></span><button class="node-lock" title="Lucchetto"></button><button class="node-del" title="Elimina">' + icon("trash", 14) + '</button></div>' +
    '<div class="node-body" contenteditable="true" spellcheck="false"></div><div class="node-src"></div>' +
    '<span class="node-link-handle" title="Trascina su un altro nodo per collegare"></span><span class="node-resize" title="Ridimensiona"></span>';
  const titleEl = el.querySelector(".node-title"), bodyEl = el.querySelector(".node-body"), srcEl = el.querySelector(".node-src");
  titleEl.textContent = n.title || "";
  fillBody(bodyEl, n);
  renderSource(srcEl, n);
  applyNodeStyle(el, n);
  el.querySelector(".node-lock").onclick = (e) => { e.stopPropagation(); n.locked = !n.locked; applyNodeStyle(el, n); if (selectedNode === n.id) updateNodeActions(); save(); };
  titleEl.addEventListener("input", () => { n.title = titleEl.textContent; save(); });
  bodyEl.addEventListener("input", () => { n.body = serializeBody(bodyEl); save(); });
  bodyEl.addEventListener("paste", (e) => {
    const cd = e.clipboardData;
    if (!cd) return;
    for (let i = 0; i < cd.items.length; i++) {
      if (cd.items[i].type.indexOf("image") === 0) { e.preventDefault(); insertImageBlob(n.id, cd.items[i].getAsFile()); break; }
    }
  });
  bodyEl.addEventListener("click", (e) => { if (e.target.tagName === "IMG" && e.target.src) { e.stopPropagation(); svc.openLightbox(e.target.src); } });
  el.addEventListener("click", (e) => {
    if (e.target.closest(".node-del") || e.target.closest(".node-link-handle") || e.target.closest(".node-src") || e.target.tagName === "IMG" || e.target.tagName === "VIDEO" || e.target.tagName === "IFRAME") return;
    selectNode(n.id);
  });
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault(); e.stopPropagation(); selectNode(n.id);
    const img = (e.target.tagName === "IMG" && e.target.dataset.mediaId && e.target.src) ? e.target : null;
    const items = [];
    if (img) { items.push({ l: "Ingrandisci immagine", fn: () => svc.openLightbox(img.src) }, { l: "Ritaglia immagine…", fn: () => cropNodeImage(n, img) }, { sep: 1 }); }
    items.push({ l: "Inserisci immagine…", fn: () => { svc.pendingNodeId = n.id; svc.clickImageFile(); } });
    items.push({ l: "Inserisci video…", fn: () => promptVideo(n.id) });
    items.push({ l: "Collega a un altro nodo", fn: () => startLinking(n.id) });
    items.push({ sep: 1 });
    items.push({ l: n.bare ? "Mostra riquadro" : "Nascondi riquadro", fn: () => { n.bare = !n.bare; applyNodeStyle(el, n); updateNodeActions(); save(); } });
    items.push({ l: n.locked ? "Sblocca nodo" : "Blocca nodo (lucchetto)", fn: () => { n.locked = !n.locked; applyNodeStyle(el, n); updateNodeActions(); save(); } });
    items.push({ sep: 1 });
    items.push({ l: "Elimina nodo", danger: true, fn: () => removeNode(n.id) });
    showMenu(items, e.clientX, e.clientY);
  });
  el.querySelector(".node-del").onclick = (e) => { e.stopPropagation(); removeNode(n.id); };
  bindDrag(el, n, el.querySelector(".node-grip"));
  bindResize(el, n, el.querySelector(".node-resize"));
  bindLink(el, n, el.querySelector(".node-link-handle"));
  return el;
}

function renderNodes() {
  for (const id in nodeEls) delete nodeEls[id];
  world.querySelectorAll(".node").forEach(x => x.remove());
  currentPage().nodes.forEach(n => world.appendChild(createNodeElement(n)));
}

export function addNode(partial = {}) {
  const node = {
    id: uid(),
    x: typeof partial.x === "number" ? partial.x : Math.round(viewCenter().x - 115 + Math.random() * 120 - 60),
    y: typeof partial.y === "number" ? partial.y : Math.round(viewCenter().y - 90 + Math.random() * 120 - 60),
    w: 230, h: 180,
    title: partial.title || "Nuovo nodo",
    body: partial.body || "",
    source: partial.source || ""
  };
  currentPage().nodes.push(node);
  selectedNode = node.id; selectedConn = null;
  renderAll(); save();
  setTimeout(() => {
    const el = world.querySelector('.node[data-id="' + node.id + '"]');
    if (el && !partial.body) el.querySelector(".node-title").focus();
  }, 60);
  return node;
}

export function removeNode(id) {
  const nd = findNode(id);
  if (nd && nd.locked) { toast("Nodo bloccato: togli prima il lucchetto."); return; }
  const p = currentPage();
  p.nodes = p.nodes.filter(n => n.id !== id);
  p.connections = p.connections.filter(c => c.from !== id && c.to !== id);
  if (selectedNode === id) selectedNode = null;
  renderAll(); save();
}

export function selectNode(id) {
  selectedNode = id; selectedConn = null;
  world.querySelectorAll(".node").forEach(el => el.classList.toggle("selected", el.dataset.id === id));
  renderConnections(); updateNodeActions();
}

function updateNodeActions() {
  const n = selectedNode ? findNode(selectedNode) : null;
  if (nodeActionsEl) {
    nodeActionsEl.classList.toggle("visible", !!n);
    if (n) {
      const fs = nodeActionsEl.querySelector("#naFs"); if (fs) fs.textContent = String(+(n.fs || 12.5).toFixed(1));
      const color = nodeActionsEl.querySelector("#naColor"); if (color && document.activeElement !== color) color.value = n.color || "#8ab4ff";
      const bare = nodeActionsEl.querySelector("#naBare"); if (bare) bare.textContent = n.bare ? "Mostra riquadro" : "Nascondi riquadro";
      const lock = nodeActionsEl.querySelector("#naLock"); if (lock) { lock.innerHTML = lockSvg(!!n.locked) + (n.locked ? " Bloccato" : " Blocca"); lock.classList.toggle("accent", !!n.locked); }
    }
  }
  const c = selectedConn ? currentPage().connections.find(x => x.id === selectedConn) : null;
  if (connActionsEl) {
    connActionsEl.classList.toggle("visible", !!c);
    if (c) {
      const lbl = connActionsEl.querySelector("#connLabel");
      if (lbl && document.activeElement !== lbl) lbl.value = c.label || "";
    }
  }
  updateCtxBar();
}

function bindDrag(el, n, h) {
  h.addEventListener("pointerdown", function (e) {
    if (e.button) return; e.preventDefault(); e.stopPropagation();
    const wasMulti = !!msel[n.id] && selIds().length > 1;
    if (!wasMulti) { clearMsel(); selectNode(n.id); } else { selectNode(n.id); }
    delete disp[n.id]; localDrag = n.id;
    const p0 = worldPos(e.clientX, e.clientY), ox = p0.x - n.x, oy = p0.y - n.y;
    h.setPointerCapture(e.pointerId);
    const group = wasMulti ? selNodes().filter(q => !q.locked) : [n];
    if (!group.some(q => q.id === n.id) && !n.locked) group.push(n);
    const starts = {}; group.forEach(q => { starts[q.id] = { x: q.x, y: q.y }; });
    function mv(ev) {
      const p = worldPos(ev.clientX, ev.clientY), nx = Math.round(p.x - ox), ny = Math.round(p.y - oy), dx = nx - n.x, dy = ny - n.y;
      if (wasMulti) group.forEach(q => { q.x = Math.round(starts[q.id].x + dx); q.y = Math.round(starts[q.id].y + dy); const qe = nodeEls[q.id]; if (qe) { qe.style.left = q.x + "px"; qe.style.top = q.y + "px"; } });
      else if (!n.locked) { n.x = nx; n.y = ny; el.style.left = n.x + "px"; el.style.top = n.y + "px"; }
      renderConnections(); emit("collab:push");
    }
    function up() { localDrag = null; h.removeEventListener("pointermove", mv); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up); save(); }
    h.addEventListener("pointermove", mv); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
  });
}

function bindResize(el, n, h) {
  h.addEventListener("pointerdown", function (e) {
    if (e.button) return; e.preventDefault(); e.stopPropagation();
    delete disp[n.id]; localDrag = n.id;
    const sx = e.clientX, sy = e.clientY, sw = n.w, sh = n.h;
    h.setPointerCapture(e.pointerId);
    function mv(ev) { n.w = Math.max(160, Math.round(sw + (ev.clientX - sx) / view.z)); n.h = Math.max(100, Math.round(sh + (ev.clientY - sy) / view.z)); el.style.width = n.w + "px"; el.style.height = n.h + "px"; renderConnections(); emit("collab:push"); }
    function up() { localDrag = null; h.removeEventListener("pointermove", mv); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up); save(); }
    h.addEventListener("pointermove", mv); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
  });
}

function bindLink(el, n, h) {
  h.addEventListener("pointerdown", function (e) {
    e.preventDefault(); e.stopPropagation();
    const start = { x: n.x + n.w / 2, y: n.y + n.h / 2 };
    showTemp(start); h.setPointerCapture(e.pointerId);
    function mv(ev) { updateTemp(start, worldPos(ev.clientX, ev.clientY)); }
    function up(ev) {
      hideTemp();
      const t = document.elementFromPoint(ev.clientX, ev.clientY);
      const tel = t && t.closest ? t.closest(".node") : null;
      if (tel && tel.dataset.id !== n.id) addConnection(n.id, tel.dataset.id, currentColor);
      h.removeEventListener("pointermove", mv); h.removeEventListener("pointerup", up); h.removeEventListener("pointercancel", up);
    }
    h.addEventListener("pointermove", mv); h.addEventListener("pointerup", up); h.addEventListener("pointercancel", up);
  });
}

function startLinking(id) { linkingFrom = id; toast("Ora clicca il nodo di destinazione per collegarlo."); }

export function worldPos(cx, cy) {
  const r = viewport.getBoundingClientRect();
  return { x: (cx - r.left - view.x) / view.z, y: (cy - r.top - view.y) / view.z };
}
export function viewCenter() {
  const r = viewport.getBoundingClientRect();
  return worldPos(r.left + r.width / 2, r.top + r.height / 2);
}
function geom(n) { return disp[n.id] || n; }

/* ================= COLLEGAMENTI ================= */
function connGeom(c, a, b) {
  const ga = geom(a), gb = geom(b);
  const x1 = ga.x + ga.w / 2, y1 = ga.y + ga.h / 2, x2 = gb.x + gb.w / 2, y2 = gb.y + gb.h / 2;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, bx = c.bx || 0, by = c.by || 0;
  return { x1, y1, x2, y2, mx, my, cx: mx + 2 * bx, cy: my + 2 * by, px: mx + bx, py: my + by };
}

function renderConnections() {
  svgEl.querySelectorAll("g.conn").forEach(g => g.remove());
  currentPage().connections.forEach(c => {
    const a = findNode(c.from), b = findNode(c.to);
    if (!a || !b) return;
    const q = connGeom(c, a, b);
    const g = document.createElementNS(NS, "g");
    g.setAttribute("class", "conn" + (selectedConn === c.id ? " selected" : ""));
    g.dataset.id = c.id;
    const d = "M" + q.x1 + " " + q.y1 + " Q" + q.cx + " " + q.cy + " " + q.x2 + " " + q.y2;
    function mk(cls) { const p = document.createElementNS(NS, "path"); p.setAttribute("class", cls); p.setAttribute("d", d); return p; }
    const glow = mk("conn-glow"); glow.setAttribute("stroke", c.color);
    const core = mk("conn-core"); core.setAttribute("stroke", c.color);
    const hit = mk("conn-hit");
    g.appendChild(glow); g.appendChild(core); g.appendChild(hit);
    if (c.label) {
      const tw = Math.max(24, String(c.label).length * 6.4 + 16);
      const rc = document.createElementNS(NS, "rect");
      rc.setAttribute("x", q.px - tw / 2); rc.setAttribute("y", q.py - 10); rc.setAttribute("width", tw); rc.setAttribute("height", 20); rc.setAttribute("rx", 9);
      rc.setAttribute("class", "conn-lbl-bg"); rc.setAttribute("stroke", c.color);
      const tx = document.createElementNS(NS, "text");
      tx.setAttribute("x", q.px); tx.setAttribute("y", q.py); tx.setAttribute("class", "conn-lbl"); tx.textContent = c.label;
      g.appendChild(rc); g.appendChild(tx);
    }
    if (selectedConn === c.id) {
      const hoff = c.label ? 22 : 0;
      const hd = document.createElementNS(NS, "circle");
      hd.setAttribute("cx", q.px); hd.setAttribute("cy", q.py + hoff); hd.setAttribute("r", 7); hd.setAttribute("class", "conn-handle"); hd.setAttribute("stroke", c.color);
      hd.addEventListener("pointerdown", function (e) {
        e.preventDefault(); e.stopPropagation();
        function mv(ev) {
          const p = worldPos(ev.clientX, ev.clientY);
          const a2 = findNode(c.from), b2 = findNode(c.to);
          if (!a2 || !b2) return;
          const q2 = connGeom({}, a2, b2);
          c.bx = Math.round(p.x - q2.mx); c.by = Math.round(p.y - hoff - q2.my);
          renderConnections(); emit("collab:push");
        }
        function up() { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); save(); }
        window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
      });
      g.appendChild(hd);
    }
    g.addEventListener("click", (e) => { e.stopPropagation(); selectConn(c.id); });
    g.addEventListener("dblclick", (e) => {
      e.stopPropagation(); e.preventDefault(); selectConn(c.id);
      setTimeout(() => { const li = connActionsEl.querySelector("#connLabel"); li.focus(); li.select(); }, 30);
    });
    g.addEventListener("contextmenu", (e) => {
      e.preventDefault(); e.stopPropagation(); selectConn(c.id);
      showMenu([
        { l: "Scrivi / modifica relazione", fn: () => { setTimeout(() => { const li = connActionsEl.querySelector("#connLabel"); li.focus(); li.select(); }, 30); } },
        { l: "Raddrizza linea", fn: () => { delete c.bx; delete c.by; renderConnections(); save(); } },
        { sep: 1 },
        { l: "Elimina collegamento", danger: true, fn: () => removeConnection(c.id) }
      ], e.clientX, e.clientY);
    });
    svgEl.appendChild(g);
  });
}

export function addConnection(from, to, color) {
  const p = currentPage();
  if (p.connections.some(c => c.from === from && c.to === to)) return;
  p.connections.push({ id: uid(), from, to, color });
  renderConnections(); save();
}
export function removeConnection(id) {
  const p = currentPage();
  p.connections = p.connections.filter(c => c.id !== id);
  if (selectedConn === id) selectedConn = null;
  renderConnections(); save();
}
function selectConn(id) {
  selectedConn = id; selectedNode = null;
  world.querySelectorAll(".node").forEach(el => el.classList.remove("selected"));
  renderConnections(); updateNodeActions();
}
function showTemp(p) {
  tempLine = document.createElementNS(NS, "line");
  tempLine.setAttribute("class", "temp"); tempLine.setAttribute("x1", p.x); tempLine.setAttribute("y1", p.y); tempLine.setAttribute("x2", p.x); tempLine.setAttribute("y2", p.y);
  svgEl.appendChild(tempLine);
}
function updateTemp(a, b) { if (tempLine) { tempLine.setAttribute("x1", a.x); tempLine.setAttribute("y1", a.y); tempLine.setAttribute("x2", b.x); tempLine.setAttribute("y2", b.y); } }
function hideTemp() { if (tempLine) { tempLine.remove(); tempLine = null; } }

/* ================= PALETTE ================= */
function renderPalette() {
  const paletteEl = linkPaletteEl.querySelector("#palette");
  paletteEl.innerHTML = "";
  PALETTE.forEach(c => {
    const s = document.createElement("span");
    s.className = "swatch" + (c === currentColor ? " on" : "");
    s.style.background = c; s.title = c;
    s.onclick = () => {
      currentColor = c;
      const ci = linkPaletteEl.querySelector("#color"); if (ci) ci.value = c;
      if (selectedConn) { const conn = currentPage().connections.find(x => x.id === selectedConn); if (conn) { conn.color = c; renderConnections(); save(); } }
      renderPalette();
    };
    paletteEl.appendChild(s);
  });
}

/* ================= IMMAGINI / VIDEO ================= */

/* ================= IMMAGINI / VIDEO ================= */
export function insertImageBlob(nodeId, blob) {
  return storeBlob(blob).then(id => {
    const url = URL.createObjectURL(blob); mediaUrls[id] = url;
    const el = nodeBodyEl(nodeId);
    if (el) {
      const img = document.createElement("img");
      img.src = url; img.dataset.mediaId = id; img.setAttribute("contenteditable", "false");
      img.onload = () => {
        const nn = findNode(nodeId), nd = world.querySelector('.node[data-id="' + nodeId + '"]');
        if (nn && nd) { const need = nd.offsetHeight + (el.scrollHeight - el.clientHeight); if (need > nn.h) { nn.h = Math.min(need + 4, 560); nd.style.height = nn.h + "px"; renderConnections(); save(); } }
      };
      el.appendChild(img); saveBody(nodeId);
    } else {
      const n = findNode(nodeId);
      if (n) { n.body = (n.body || "") + '<img data-media-id="' + id + '" contenteditable="false">'; save(); }
    }
  });
}

function nodeBodyEl(id) { return world.querySelector('.node[data-id="' + id + '"] .node-body') || null; }
function saveBody(id) { const n = findNode(id), el = nodeBodyEl(id); if (n && el) { n.body = serializeBody(el); save(); } }

function openCrop(src, onBlob) {
  cropCtx = { onBlob };
  const cropModal = document.getElementById("cropModal");
  const cropImg = document.getElementById("cropImg");
  const cropBox = document.getElementById("cropBox");
  const cropStage = document.getElementById("cropStage");
  cropModal.classList.add("open");
  cropImg.onload = () => {
    const w = cropImg.clientWidth, h = cropImg.clientHeight;
    cropStage.style.width = w + "px"; cropStage.style.height = h + "px";
    setBoxRect(cropBox, 0, 0, w, h);
    cropCtx.scale = cropImg.naturalWidth / w;
  };
  cropImg.src = src;
}
let cropCtx = null;
function closeCrop() { document.getElementById("cropModal").classList.remove("open"); cropCtx = null; }

function cropNodeImage(n, img) {
  const oldId = img.dataset.mediaId;
  openCrop(img.src, blob => {
    storeBlob(blob).then(id => {
      const url = URL.createObjectURL(blob); mediaUrls[id] = url;
      img.src = url; img.dataset.mediaId = id;
      if (oldId && oldId !== id) { idbDel("blobs", oldId); if (mediaUrls[oldId]) { try { URL.revokeObjectURL(mediaUrls[oldId]); } catch (e) {} delete mediaUrls[oldId]; } }
      saveBody(n.id);
    });
  });
}

function isYoutube(u) { return /(youtube\.com|youtu\.be)/i.test(u); }
function ytEmbed(url) { const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/); return m ? ("https://www.youtube.com/embed/" + m[1]) : url; }
function addVideo(nodeId, url, id) {
  const el = nodeBodyEl(nodeId); if (!el) return;
  const v = document.createElement("video"); v.controls = true; v.preload = "metadata"; v.setAttribute("playsinline", ""); v.style.maxWidth = "100%"; v.style.display = "block"; v.setAttribute("contenteditable", "false");
  if (id) v.dataset.mediaId = id; v.src = url; el.appendChild(v); saveBody(nodeId);
}
function addRemoteVideo(nodeId, url) {
  const el = nodeBodyEl(nodeId); if (!el) return;
  if (isYoutube(url)) { const f = document.createElement("iframe"); f.src = ytEmbed(url); f.style.width = "100%"; f.style.height = "180px"; f.setAttribute("allowfullscreen", ""); f.setAttribute("contenteditable", "false"); el.appendChild(f); }
  else { const v = document.createElement("video"); v.controls = true; v.src = url; v.style.maxWidth = "100%"; v.setAttribute("contenteditable", "false"); el.appendChild(v); }
  saveBody(nodeId);
}
function promptVideo(nodeId, mx, my) {
  svc.pendingNodeId = nodeId;
  showMenu([
    { l: "Carica un file video…", fn: () => { document.getElementById("videoFile").click(); } },
    { l: "Incolla un link (YouTube / mp4 / webm)…", fn: async () => { const u = await promptModal("Incolla URL video", "https://..."); if (u && u.trim()) addRemoteVideo(nodeId, u.trim()); } }
  ], typeof mx === "number" ? mx : window.innerWidth / 2 - 90, typeof my === "number" ? my : window.innerHeight / 2 - 40);
}
function guessVideoType(name) {
  const e = (String(name).split(".").pop() || "").toLowerCase();
  return ({ mp4: "video/mp4", m4v: "video/mp4", mov: "video/mp4", webm: "video/webm", ogv: "video/ogg", mkv: "video/x-matroska", avi: "video/x-msvideo" })[e] || "video/mp4";
}
function fixVideoBlob(f) { const t = f.type; if (t && t.indexOf("video/") === 0) return f; return new Blob([f], { type: guessVideoType(f.name) }); }
export function addVideoFile(nodeId, f) {
  const blob = fixVideoBlob(f);
  storeBlob(blob).then(id => { const url = URL.createObjectURL(blob); mediaUrls[id] = url; addVideo(nodeId, url, id); });
}
function pendingPoster(pct) {
  const label = pct > 0 ? ("Video in arrivo… " + Math.round(pct * 100) + "%") : "In attesa del video dagli amici…";
  const sv = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#0b0e22"/><rect x="40" y="108" width="240" height="8" rx="4" fill="#232a55"/><rect x="40" y="108" width="' + Math.round(240 * pct) + '" height="8" rx="4" fill="#8ab4ff"/><text x="160" y="84" fill="#aab1d8" font-family="Segoe UI,Arial,sans-serif" font-size="15" text-anchor="middle">' + label + '</text></svg>';
  return "data:image/svg+xml;utf8," + encodeURIComponent(sv);
}
export function markPending(worldEl) {
  worldEl.querySelectorAll("video[data-media-id]").forEach(v => { if (!v.getAttribute("src")) v.poster = pendingPoster(svc.incomingPct ? svc.incomingPct(v.dataset.mediaId) : 0); });
}
export function updateMediaProgress(id, pct) {
  const p = Math.round(pct * 100);
  world.querySelectorAll('video[data-media-id="' + id + '"]').forEach(v => { if (!v.getAttribute("src") && v._pp !== p) { v._pp = p; v.poster = pendingPoster(pct); } });
}

/* ================= PAN / ZOOM ================= */
function applyView() {
  world.style.transform = "translate(" + view.x + "px," + view.y + "px) scale(" + view.z + ")";
  const g = 28 * view.z;
  viewport.style.backgroundSize = g + "px " + g + "px";
  viewport.style.backgroundPosition = view.x + "px " + view.y + "px";
  viewport.style.backgroundImage = view.z < 0.4 ? "none" : "";
  if (zoomPct) zoomPct.textContent = Math.round(view.z * 100) + "%";
  if (viewPid) {
    views[viewPid] = { x: view.x, y: view.y, z: view.z };
    clearTimeout(viewSaveT);
    viewSaveT = setTimeout(() => { try { localStorage.setItem("spazio-teorie-views", JSON.stringify(views)); } catch (e) {} }, 500);
  }
}
function loadView() {
  viewPid = currentPage().id;
  const v = views[viewPid];
  view.x = v ? v.x : 0; view.y = v ? v.y : 0; view.z = v ? v.z : 1;
  applyView();
}
export function setView(x, y, z, animate) {
  const tok = ++viewAnim;
  if (!animate) { view.x = x; view.y = y; view.z = z; applyView(); return; }
  const x0 = view.x, y0 = view.y, z0 = view.z, t0 = performance.now(), D = 360;
  (function step(now) {
    if (tok !== viewAnim) return;
    const u = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - u, 3);
    view.x = x0 + (x - x0) * e; view.y = y0 + (y - y0) * e; view.z = z0 + (z - z0) * e;
    applyView();
    if (u < 1) requestAnimationFrame(step);
  })(t0);
}
function zoomAt(cx, cy, f) {
  const r = viewport.getBoundingClientRect();
  const nz = clamp(view.z * f, 0.1, 3); f = nz / view.z;
  const px = cx - r.left, py = cy - r.top;
  view.x = px - (px - view.x) * f; view.y = py - (py - view.y) * f; view.z = nz;
  applyView();
}
function zoomCenter(f) { const r = viewport.getBoundingClientRect(); viewAnim++; zoomAt(r.left + r.width / 2, r.top + r.height / 2, f); }
export function fitAll(animate) {
  const p = currentPage(), r = viewport.getBoundingClientRect();
  if (!p.nodes.length) { setView(40, 40, 1, animate); return; }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  p.nodes.forEach(n => { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); });
  const pad = 70, bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const nz = clamp(Math.min((r.width - pad * 2) / bw, (r.height - pad * 2) / bh), 0.1, 1.25);
  setView(r.width / 2 - (x0 + bw / 2) * nz, r.height / 2 - (y0 + bh / 2) * nz, nz, animate);
}
function clearSelection() {
  selectedNode = null; selectedConn = null;
  world.querySelectorAll(".node").forEach(el => el.classList.remove("selected"));
  renderConnections(); updateNodeActions();
}

/* ================= PENNA ================= */
const pen = { on: false, tool: "pen", color: "#ffffff", w: 4, mine: [] };
function drawsOf(p) { return p.drawings || (p.drawings = []); }
function strokePath(pts) {
  const n = pts.length; if (!n) return "";
  if (n === 1) return "M" + pts[0][0] + " " + pts[0][1] + " l0.01 0";
  let d = "M" + pts[0][0] + " " + pts[0][1];
  if (n === 2) return d + " L" + pts[1][0] + " " + pts[1][1];
  for (let i = 1; i < n - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; d += " Q" + pts[i][0] + " " + pts[i][1] + " " + r1(mx) + " " + r1(my); }
  return d + " L" + pts[n - 1][0] + " " + pts[n - 1][1];
}
function strokeEl(d) {
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", strokePath(d.pts || []));
  p.setAttribute("stroke", d.color || "#fff");
  p.setAttribute("stroke-width", d.w || 3);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
  if (d.op && d.op < 1) p.setAttribute("stroke-opacity", d.op);
  p.dataset.id = d.id;
  return p;
}
function renderDrawings() { drawSvg.innerHTML = ""; drawsOf(currentPage()).forEach(d => drawSvg.appendChild(strokeEl(d))); }
function simplify(pts, eps) {
  if (pts.length < 4) return pts;
  const keep = new Array(pts.length); keep[0] = keep[pts.length - 1] = true;
  (function rdp(a, b) {
    let md = 0, mi = -1;
    const ax = pts[a][0], ay = pts[a][1], bx = pts[b][0], by = pts[b][1], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    for (let i = a + 1; i < b; i++) { const dd = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / L; if (dd > md) { md = dd; mi = i; } }
    if (md > eps && mi > 0) { keep[mi] = true; rdp(a, mi); rdp(mi, b); }
  })(0, pts.length - 1);
  return pts.filter((_, i) => keep[i]);
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function strokeHit(d, px, py, rad) {
  const pts = d.pts || [], th = (d.w || 3) / 2 + rad;
  if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]) <= th;
  for (let i = 0; i < pts.length - 1; i++) if (segDist(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= th) return true;
  return false;
}
export function setPen(on) {
  pen.on = !!on;
  viewport.classList.toggle("pen-on", pen.on);
  viewport.classList.toggle("pen-eraser", pen.on && pen.tool === "eraser");
  const penBtn = document.getElementById("penBtn");
  if (penBtn) penBtn.classList.toggle("accent", pen.on);
  penBarEl.classList.toggle("visible", pen.on);
  if (pen.on) { clearSelection(); if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); }
  updatePenBar(); updateCtxBar();
}
function updatePenBar() {
  penBarEl.querySelectorAll("[data-pt]").forEach(b => b.classList.toggle("on", b.dataset.pt === pen.tool));
  penBarEl.querySelectorAll("[data-pw]").forEach(b => b.classList.toggle("on", +b.dataset.pw === pen.w));
  penBarEl.querySelectorAll(".swatch").forEach(s => s.classList.toggle("on", s.title === pen.color));
  viewport.classList.toggle("pen-eraser", pen.on && pen.tool === "eraser");
}

/* ================= SELEZIONE MULTIPLA / MINIMAPPA ================= */
function selIds() { return Object.keys(msel); }
function markSel() { for (const id in nodeEls) nodeEls[id] && nodeEls[id].classList.toggle("msel", !!msel[id]); }
function clearMsel() { if (selIds().length) { msel = {}; markSel(); } }
function selNodes() { return currentPage().nodes.filter(n => msel[n.id]); }
function arrange(fn) { const ns = selNodes(); if (ns.length < 2) return; fn(ns); Object.keys(disp).forEach(k => delete disp[k]); renderGraph(); save(); }
function selItems() {
  const it = [{ sep: 1 }, { l: miniOn ? "Nascondi mini-mappa" : "Mostra mini-mappa", fn: toggleMini }];
  if (selIds().length < 1) return it;
  const f = g => () => arrange(g);
  return it.concat([
    { sep: 1 },
    { l: "Allinea a sinistra", fn: f(ns => { const m = Math.min.apply(0, ns.map(n => n.x)); ns.forEach(n => n.x = m); }) },
    { l: "Allinea in alto", fn: f(ns => { const m = Math.min.apply(0, ns.map(n => n.y)); ns.forEach(n => n.y = m); }) },
    { l: "Centra in orizzontale", fn: f(ns => { const c = ns.reduce((s, n) => s + n.x + n.w / 2, 0) / ns.length; ns.forEach(n => n.x = Math.round(c - n.w / 2)); }) },
    { l: "Distribuisci in orizzontale", fn: f(ns => { ns.sort((a, b) => a.x - b.x); const gap = 40; let x = ns[0].x; ns.forEach(n => { n.x = x; x += n.w + gap; }); }) },
    { l: "Disponi in griglia", fn: f(ns => { const cols = Math.ceil(Math.sqrt(ns.length)), x0 = Math.min.apply(0, ns.map(n => n.x)), y0 = Math.min.apply(0, ns.map(n => n.y)), cw = Math.max.apply(0, ns.map(n => n.w)) + 40, ch = Math.max.apply(0, ns.map(n => n.h)) + 40; ns.forEach((n, i) => { n.x = x0 + (i % cols) * cw; n.y = y0 + Math.floor(i / cols) * ch; }); }) },
    { sep: 1 },
    { l: "Elimina selezionati", danger: true, fn: () => { selNodes().forEach(n => { if (!n.locked) removeNode(n.id); }); msel = {}; } }
  ]);
}
function toggleMini() { miniOn = !miniOn; miniEl.style.display = miniOn ? "block" : "none"; drawMini(); }
function drawMini() {
  if (!miniOn) return;
  const c = miniEl.getContext("2d"), W = miniEl.width, H = miniEl.height, ns = currentPage().nodes;
  c.clearRect(0, 0, W, H);
  if (!ns.length) return;
  const r = viewport.getBoundingClientRect(), vx = -view.x / view.z, vy = -view.y / view.z, vw = r.width / view.z, vh = r.height / view.z;
  const x0 = Math.min(vx, Math.min.apply(0, ns.map(n => n.x))), y0 = Math.min(vy, Math.min.apply(0, ns.map(n => n.y)));
  const x1 = Math.max(vx + vw, Math.max.apply(0, ns.map(n => n.x + n.w))), y1 = Math.max(vy + vh, Math.max.apply(0, ns.map(n => n.y + n.h)));
  const s = Math.min((W - 12) / (x1 - x0 || 1), (H - 12) / (y1 - y0 || 1));
  miniEl._m = { x0, y0, s };
  ns.forEach(n => { c.fillStyle = n.color || "#8ab4ff"; c.globalAlpha = .75; c.fillRect(6 + (n.x - x0) * s, 6 + (n.y - y0) * s, Math.max(3, n.w * s), Math.max(3, n.h * s)); });
  c.globalAlpha = 1; c.strokeStyle = "#fff"; c.lineWidth = 2; c.strokeRect(6 + (vx - x0) * s, 6 + (vy - y0) * s, vw * s, vh * s);
}

/* ================= UNDO / REDO ================= */
const hist = { u: [], r: [], cur: null, pid: null, t: 0, busy: false };
function pageSnap() { const p = currentPage(); return JSON.stringify({ n: p.nodes, c: p.connections, d: p.drawings || [] }); }
function histCapture() {
  if (hist.busy || runtime.applying) return;
  const p = currentPage(), s = pageSnap();
  if (hist.pid !== p.id) { hist.pid = p.id; hist.cur = s; hist.u = []; hist.r = []; return; }
  if (s === hist.cur) return;
  const now = Date.now();
  if (now - hist.t > 700 || !hist.u.length) { hist.u.push(hist.cur); if (hist.u.length > 40) hist.u.shift(); }
  hist.t = now; hist.cur = s; hist.r = [];
}
function histApply(s) {
  const o = JSON.parse(s), p = currentPage();
  hist.busy = true; p.nodes = o.n; p.connections = o.c; p.drawings = o.d;
  selectedNode = null; selectedConn = null;
  Object.keys(disp).forEach(k => delete disp[k]);
  renderGraph(); renderDrawings(); hist.cur = s; hist.busy = false; save();
}
export function histUndo() { if (!hist.u.length) { toast("Niente da annullare."); return; } hist.r.push(hist.cur); histApply(hist.u.pop()); }
export function histRedo() { if (!hist.r.length) { toast("Niente da ripetere."); return; } hist.u.push(hist.cur); histApply(hist.r.pop()); }

/* ================= RICERCA NODI ================= */
let nsQuery = "", nsHits = [], nsIdx = -1;
function computeHits() {
  nsHits = [];
  const q = nsQuery.trim().toLowerCase(); if (!q) return;
  state.pages.forEach((p, pi) => {
    p.nodes.forEach(n => {
      const src = n.source ? (typeof n.source === "string" ? n.source : (n.source.volumeName || "")) : "";
      const txt = ((n.title || "") + " " + plainText(n.body) + " " + src).toLowerCase();
      if (txt.indexOf(q) >= 0) nsHits.push({ pi, id: n.id });
    });
  });
}
function updateSearchInfo() {
  const info = document.getElementById("nodeSearchInfo");
  if (!nsQuery.trim()) { info.textContent = ""; return; }
  info.textContent = nsHits.length ? ((nsIdx >= 0 ? (nsIdx + 1) + "/" : "") + nsHits.length) : "0";
}
export function applyNodeSearch(rec) {
  if (rec !== false) computeHits();
  const active = !!nsQuery.trim(), ids = {};
  nsHits.forEach(h => { if (h.pi === state.current) ids[h.id] = 1; });
  Object.keys(nodeEls).forEach(id => { const el = nodeEls[id]; el.classList.toggle("sm", active && !!ids[id]); el.classList.toggle("sd", active && !ids[id]); });
  updateSearchInfo();
}
export function focusNode(id) {
  const n = findNode(id); if (!n) return;
  selectNode(id);
  const r = viewport.getBoundingClientRect();
  setView(r.width / 2 - (n.x + n.w / 2) * view.z, r.height / 2 - (n.y + n.h / 2) * view.z, view.z, true);
}
function goHit(d) {
  if (!nsHits.length) return;
  nsIdx = (nsIdx + d + nsHits.length) % nsHits.length;
  const h = nsHits[nsIdx];
  if (h.pi !== state.current) { switchPage(h.pi); setTimeout(() => focusNode(h.id), 150); }
  else focusNode(h.id);
  updateSearchInfo();
}

/* ================= PANNELLO CONTESTUALE ================= */
function updateCtxBar() {
  const a = nodeActionsEl.classList.contains("visible"), b = connActionsEl.classList.contains("visible"), p = penBarEl.classList.contains("visible");
  linkPaletteEl.classList.toggle("visible", (a || b) && !p);
  ctxBarEl.classList.toggle("show", a || b || p);
}

/* ================= RENDER ================= */
export function renderGraph() {
  if (!world) return;
  renderDrawings();
  const needCov = state.volumes.some(v => v.coverId && !mediaUrls[v.coverId]);
  renderNodes();
  renderConnections();
  applyNodeSearch(false);
  markPending(world);
  hydrateMedia().then(changed => {
    if (!changed) return;
    if (needCov && svc.renderCollection) svc.renderCollection();
    renderNodes(); renderConnections(); applyNodeSearch(false); markPending(world);
  });
}

export function renderTabsExported() { renderTabs(); }
export function updateNodeActionsExported() { updateNodeActions(); }
export function renderConnectionsExported() { renderConnections(); }
export function renderDrawingsExported() { renderDrawings(); }
export function renderNodesExported() { renderNodes(); }
export function selectConnExported(id) { selectConn(id); }
export function getViewport() { return viewport; }
export function getNodeEls() { return nodeEls; }
export function getDisp() { return disp; }
export function setCurrentColor(c) { currentColor = c; }
export function getCurrentColor() { return currentColor; }
export function clearSelectionExported() { clearSelection(); }
export function penIsOn() { return pen.on; }
export function mselIds() { return selIds(); }
export function mselClear() { clearMsel(); }

/* ================= INIT ================= */
export function initMap() {
  viewport = document.getElementById("viewport");
  world = document.getElementById("world");
  svgEl = document.getElementById("svg");
  drawSvg = document.getElementById("drawSvg");
  tabsEl = document.getElementById("tabs");
  cursorsEl = document.getElementById("cursors");
  zoomPct = document.getElementById("zoomPct");
  ctxBarEl = document.getElementById("ctxBar");

  try { views = JSON.parse(localStorage.getItem("spazio-teorie-views") || "{}") || {}; } catch (e) { views = {}; }

  // pannello contestuale (costruito dinamicamente)
  ctxBarEl.innerHTML =
    '<div class="panel" id="nodeActions">' +
      '<button class="ctl mini" id="naImg">' + icon("image", 13) + ' Immagine</button>' +
      '<button class="ctl mini" id="naVid">' + icon("video", 13) + ' Video</button>' +
      '<span class="divider"></span>' +
      '<button class="ctl mini" id="naFsDown" aria-label="Riduci testo">A−</button><span id="naFs" style="font-size:12px;min-width:26px;text-align:center;">12.5</span><button class="ctl mini" id="naFsUp" aria-label="Ingrandisci testo">A+</button>' +
      '<span class="divider"></span>' +
      '<input type="color" id="naColor" class="color-input" value="#8ab4ff" title="Colore del nodo"><button class="ctl mini" id="naColorReset" title="Colore predefinito">↺</button>' +
      '<button class="ctl mini" id="naBare">Riquadro</button>' +
      '<button class="ctl mini" id="naLock"></button>' +
      '<span class="divider"></span>' +
      '<button class="ctl mini" id="naDel" style="color:var(--danger)">' + icon("trash", 13) + ' Elimina</button>' +
    '</div>' +
    '<div class="panel" id="connActions"><span class="lbl">Relazione:</span><input type="text" id="connLabel" placeholder="Scrivi la relazione…" spellcheck="false" maxlength="80"><button class="ctl mini" id="connStraight">Raddrizza</button><button class="ctl mini" id="connDel" style="color:var(--danger)">Elimina</button></div>' +
    '<div class="panel" id="linkPalette"><span class="lbl">Colore linee</span><span id="palette" style="display:flex;gap:5px;"></span><input type="color" id="color" class="color-input" value="#8ab4ff" title="Colore personalizzato"></div>' +
    '<div class="panel" id="penBar">' +
      '<button class="ctl mini" data-pt="pen">Penna</button><button class="ctl mini" data-pt="hl">Evidenziatore</button><button class="ctl mini" data-pt="eraser">Gomma</button>' +
      '<span class="divider"></span><span id="penColors" style="display:flex;gap:5px;"></span><input type="color" id="penColor" class="color-input" value="#ffffff" title="Colore personalizzato">' +
      '<span class="divider"></span>' +
      '<button class="ctl mini" data-pw="2">Sottile</button><button class="ctl mini" data-pw="4">Media</button><button class="ctl mini" data-pw="8">Spessa</button>' +
      '<span class="divider"></span>' +
      '<button class="ctl mini" id="penUndo">Annulla</button><button class="ctl mini" id="penClear" style="color:var(--danger)">Cancella tutto</button><button class="ctl mini accent" id="penDone">Fatto</button>' +
    '</div>';

  nodeActionsEl = document.getElementById("nodeActions");
  connActionsEl = document.getElementById("connActions");
  linkPaletteEl = document.getElementById("linkPalette");
  penBarEl = document.getElementById("penBar");

  // selezione multipla + minimappa (elementi globali)
  selBoxEl = document.createElement("div"); selBoxEl.id = "selBox"; document.body.appendChild(selBoxEl);
  miniEl = document.createElement("canvas"); miniEl.id = "miniMap"; miniEl.width = 340; miniEl.height = 236; document.body.appendChild(miniEl);

  // crop
  const cropBox = document.getElementById("cropBox");
  const cropStage = document.getElementById("cropStage");
  attachCropBox(cropBox, cropStage);
  document.getElementById("cropOk").onclick = () => {
    const cropImg = document.getElementById("cropImg");
    if (!cropCtx || !cropImg.naturalWidth) return;
    const r = rectOf(cropBox), s = cropCtx.scale;
    const sx = Math.round(r.x * s), sy = Math.round(r.y * s), sw = Math.round(r.w * s), sh = Math.round(r.h * s);
    if (sw < 2 || sh < 2) { closeCrop(); return; }
    const c = document.createElement("canvas"); c.width = sw; c.height = sh;
    c.getContext("2d").drawImage(cropImg, sx, sy, sw, sh, 0, 0, sw, sh);
    const cb = cropCtx.onBlob;
    c.toBlob(blob => { closeCrop(); if (cb) cb(blob); }, "image/png");
  };
  document.getElementById("cropCancel").onclick = closeCrop;
  document.getElementById("cropCancel2").onclick = closeCrop;

  // palette
  renderPalette();
  const colorInput = linkPaletteEl.querySelector("#color");
  colorInput.addEventListener("input", () => {
    currentColor = colorInput.value;
    if (selectedConn) { const conn = currentPage().connections.find(x => x.id === selectedConn); if (conn) { conn.color = currentColor; renderConnections(); save(); } }
    renderPalette();
  });

  // penna palette colori
  (function () {
    const box = penBarEl.querySelector("#penColors");
    PALETTE.forEach(c => {
      const s = document.createElement("span"); s.className = "swatch"; s.style.background = c; s.title = c;
      s.onclick = () => { pen.color = c; penBarEl.querySelector("#penColor").value = c; if (pen.tool === "eraser") pen.tool = "pen"; updatePenBar(); };
      box.appendChild(s);
    });
  })();
  penBarEl.querySelector("#penColor").addEventListener("input", function () { pen.color = this.value; if (pen.tool === "eraser") pen.tool = "pen"; updatePenBar(); });
  penBarEl.querySelectorAll("[data-pt]").forEach(b => { b.onclick = () => { pen.tool = b.dataset.pt; updatePenBar(); }; });
  penBarEl.querySelectorAll("[data-pw]").forEach(b => { b.onclick = () => { pen.w = +b.dataset.pw; if (pen.tool === "eraser") pen.tool = "pen"; updatePenBar(); }; });
  document.getElementById("penBtn").onclick = () => setPen(!pen.on);
  penBarEl.querySelector("#penDone").onclick = () => setPen(false);
  penBarEl.querySelector("#penUndo").onclick = () => {
    const pg = currentPage(), arr = drawsOf(pg);
    while (pen.mine.length) {
      const id = pen.mine.pop(); const i = arr.findIndex(d => d.id === id);
      if (i >= 0) { arr.splice(i, 1); renderDrawings(); save(); return; }
    }
    toast("Niente da annullare.");
  };
  penBarEl.querySelector("#penClear").onclick = async () => {
    const pg = currentPage();
    if (!drawsOf(pg).length) { toast("Nessun disegno in questa pagina."); return; }
    if (!(await confirmModal("Cancellare tutti i disegni di questa pagina?"))) return;
    pg.drawings = []; pen.mine = []; renderDrawings(); save();
  };

  // azioni nodo
  document.getElementById("naImg").onclick = () => { if (selectedNode) { svc.pendingNodeId = selectedNode; document.getElementById("imageFile").click(); } };
  document.getElementById("naVid").onclick = (e) => { e.stopPropagation(); if (!selectedNode) return; const r = e.currentTarget.getBoundingClientRect(); promptVideo(selectedNode, r.left, r.bottom + 6); };
  document.getElementById("naDel").onclick = () => { if (selectedNode) removeNode(selectedNode); };
  document.getElementById("naFsDown").onclick = () => { const n = selectedNode && findNode(selectedNode); if (!n) return; n.fs = clamp(Math.round(((n.fs || 12.5) - 1) * 10) / 10, 8, 48); styled(); };
  document.getElementById("naFsUp").onclick = () => { const n = selectedNode && findNode(selectedNode); if (!n) return; n.fs = clamp(Math.round(((n.fs || 12.5) + 1) * 10) / 10, 8, 48); styled(); };
  document.getElementById("naColor").addEventListener("input", function () { const n = selectedNode && findNode(selectedNode); if (!n) return; n.color = this.value; const el = nodeEls[n.id]; if (el) applyNodeStyle(el, n); save(); });
  document.getElementById("naColorReset").onclick = () => { const n = selectedNode && findNode(selectedNode); if (!n) return; delete n.color; styled(); };
  document.getElementById("naBare").onclick = () => { const n = selectedNode && findNode(selectedNode); if (!n) return; n.bare = !n.bare; styled(); };
  document.getElementById("naLock").onclick = () => { const n = selectedNode && findNode(selectedNode); if (!n) return; n.locked = !n.locked; styled(); };
  function styled() { const n = selectedNode && findNode(selectedNode); if (n && nodeEls[n.id]) applyNodeStyle(nodeEls[n.id], n); updateNodeActions(); save(); }

  // azioni collegamento
  const connLabelEl = connActionsEl.querySelector("#connLabel");
  connLabelEl.addEventListener("input", () => { const c = selectedConn && currentPage().connections.find(x => x.id === selectedConn); if (!c) return; c.label = connLabelEl.value; renderConnections(); save(); });
  connLabelEl.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") connLabelEl.blur(); });
  connActionsEl.querySelector("#connStraight").onclick = () => { const c = selectedConn && currentPage().connections.find(x => x.id === selectedConn); if (!c) return; delete c.bx; delete c.by; renderConnections(); save(); };
  connActionsEl.querySelector("#connDel").onclick = () => { if (selectedConn) removeConnection(selectedConn); };

  // ricerca nodi
  const nodeSearchEl = document.getElementById("nodeSearch");
  nodeSearchEl.addEventListener("input", () => { nsQuery = nodeSearchEl.value; nsIdx = -1; applyNodeSearch(true); });
  nodeSearchEl.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") { e.preventDefault(); goHit(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { nodeSearchEl.value = ""; nsQuery = ""; nsIdx = -1; applyNodeSearch(true); nodeSearchEl.blur(); }
  });
  document.getElementById("nsNext").onclick = () => goHit(1);
  document.getElementById("nsPrev").onclick = () => goHit(-1);

  // zoom hud
  document.getElementById("zoomIn").onclick = () => zoomCenter(1.25);
  document.getElementById("zoomOut").onclick = () => zoomCenter(0.8);
  document.getElementById("zoomFit").onclick = () => fitAll(true);

  // pan / zoom eventi
  viewport.addEventListener("wheel", (e) => {
    const tb = e.target.closest && e.target.closest(".node-body");
    if (tb && !e.ctrlKey && !e.altKey && tb.scrollHeight > tb.clientHeight + 1) return;
    e.preventDefault(); viewAnim++;
    const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    zoomAt(e.clientX, e.clientY, Math.exp(-d * (e.ctrlKey ? 0.01 : 0.0013)));
  }, { passive: false });

  let lastMid = 0, lastMidX = 0, lastMidY = 0;
  function startPan(e, mid) {
    viewAnim++;
    const sx = e.clientX, sy = e.clientY, vx = view.x, vy = view.y; let moved = false;
    try { viewport.setPointerCapture(e.pointerId); } catch (er) {}
    function mv(ev) {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (!moved) { if (Math.hypot(dx, dy) < 3) return; moved = true; viewport.classList.add("panning"); }
      view.x = vx + dx; view.y = vy + dy; applyView();
    }
    function up(ev) {
      viewport.removeEventListener("pointermove", mv); viewport.removeEventListener("pointerup", up); viewport.removeEventListener("pointercancel", up);
      viewport.classList.remove("panning");
      try { viewport.releasePointerCapture(ev.pointerId); } catch (er) {}
      if (!moved && !mid) { const ae = document.activeElement; if (ae && ae !== document.body && ae.blur) ae.blur(); clearSelection(); }
    }
    viewport.addEventListener("pointermove", mv); viewport.addEventListener("pointerup", up); viewport.addEventListener("pointercancel", up);
  }
  viewport.addEventListener("pointerdown", (e) => {
    if (e.button === 1) {
      e.preventDefault();
      const now = Date.now();
      if (now - lastMid < 450 && Math.hypot(e.clientX - lastMidX, e.clientY - lastMidY) < 16) { lastMid = 0; fitAll(true); return; }
      lastMid = now; lastMidX = e.clientX; lastMidY = e.clientY; startPan(e, true); return;
    }
    if (e.button !== 0) return;
    if (pen.on) return;
    if (e.target !== viewport && e.target !== world) return;
    startPan(e, false);
  });

  // broadcast posizione cursore ai peer (collab)
  viewport.addEventListener("pointermove", (e) => {
    if (!svc.collabCursor) return;
    const r = viewport.getBoundingClientRect();
    svc.collabCursor(Math.round(e.clientX - r.left), Math.round(e.clientY - r.top));
  });

  // doppio clic crea nodo
  viewport.addEventListener("dblclick", (e) => {
    if (settings.dblNode === false || pen.on || e.target.closest("#ctxBar") || e.target.closest("g.conn") || e.target.closest("#collToggle")) return;
    if (e.target.closest(".node") || e.target.closest("#zoomHud")) return;
    const p = worldPos(e.clientX, e.clientY);
    addNode({ x: Math.round(p.x - 115), y: Math.round(p.y - 90) });
  });

  // contextmenu sul vuoto
  viewport.addEventListener("contextmenu", (e) => {
    if (e.target.closest(".node") || e.target.closest("#zoomHud") || e.target.closest("#ctxBar")) return;
    e.preventDefault(); e.stopPropagation();
    if (pen.on) return;
    const p = worldPos(e.clientX, e.clientY);
    const at = { x: Math.round(p.x - 115), y: Math.round(p.y - 90) };
    showMenu([
      { l: "Nuovo nodo qui", fn: () => addNode(at) },
      { l: "Incolla come nodo", fn: () => navigator.clipboard.readText().then(t => { if (t && t.trim()) addNode({ x: at.x, y: at.y, title: "Appunto", body: escapeHtml(t).replace(/\n/g, "<br>") }); else toast("Appunti vuoti."); }).catch(() => toast("Il browser non permette di leggere gli appunti.")) },
      { sep: 1 },
      { l: "Adatta la vista a tutti i nodi", fn: () => fitAll(true) },
      { l: "Penna", fn: () => setPen(true) },
      { sep: 1 },
      { l: "Annulla", fn: histUndo },
      { l: "Ripeti", fn: histRedo },
      { sep: 1 },
      { l: "Nuova pagina", fn: addPage }
    ].concat(selItems()), e.clientX, e.clientY);
  });

  // drop file sul viewport
  viewport.addEventListener("dragover", (e) => e.preventDefault());
  viewport.addEventListener("drop", (e) => {
    e.preventDefault();
    const files = Array.prototype.slice.call(e.dataTransfer.files || []);
    if (!files.length) return;
    const target = e.target.closest ? e.target.closest(".node") : null;
    const p = worldPos(e.clientX, e.clientY);
    files.forEach(f => {
      if (f.type.indexOf("image") === 0) {
        if (target) insertImageBlob(target.dataset.id, f);
        else {
          const node = addNode({ x: Math.round(p.x - 115), y: Math.round(p.y - 90), title: "Immagine" });
          storeBlob(f).then(id => { const url = URL.createObjectURL(f); mediaUrls[id] = url; const el = nodeBodyEl(node.id); if (el) { const img = document.createElement("img"); img.src = url; img.dataset.mediaId = id; img.setAttribute("contenteditable", "false"); el.appendChild(img); saveBody(node.id); } else { node.body = '<img data-media-id="' + id + '" contenteditable="false">'; save(); } });
        }
      } else if (f.type.indexOf("video") === 0) {
        let nodeId = target ? target.dataset.id : null;
        if (!nodeId) { const n2 = addNode({ x: Math.round(p.x - 115), y: Math.round(p.y - 90), title: "Video" }); nodeId = n2.id; }
        addVideoFile(nodeId, f);
      }
    });
  });

  // selezione multipla (shift + drag)
  viewport.addEventListener("pointerdown", function (e) {
    if (e.button) return;
    const bg = e.target === viewport || e.target === world || e.target === svgEl || e.target.id === "drawSvg";
    if (!e.shiftKey || !bg || pen.on) { if (!e.target.closest(".node")) clearMsel(); return; }
    e.stopImmediatePropagation(); e.preventDefault();
    const sx = e.clientX, sy = e.clientY; selBoxEl.style.display = "block";
    function mv(ev) { selBoxEl.style.left = Math.min(sx, ev.clientX) + "px"; selBoxEl.style.top = Math.min(sy, ev.clientY) + "px"; selBoxEl.style.width = Math.abs(ev.clientX - sx) + "px"; selBoxEl.style.height = Math.abs(ev.clientY - sy) + "px"; }
    function up(ev) {
      window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); selBoxEl.style.display = "none";
      const a = worldPos(Math.min(sx, ev.clientX), Math.min(sy, ev.clientY)), b = worldPos(Math.max(sx, ev.clientX), Math.max(sy, ev.clientY));
      msel = {};
      currentPage().nodes.forEach(n => { if (n.x < b.x && n.x + n.w > a.x && n.y < b.y && n.y + n.h > a.y) msel[n.id] = 1; });
      markSel();
      if (selIds().length) toast(selIds().length + " nodi selezionati: tasto destro sul vuoto per allinearli.");
    }
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); mv(e);
  }, true);

  // penna pointerdown (capture)
  viewport.addEventListener("pointerdown", function (e) {
    if (!pen.on || e.button !== 0) return;
    if (e.target.closest && e.target.closest("#ctxBar,#zoomHud,#collToggle")) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const pg = currentPage(), arr = drawsOf(pg);
    try { viewport.setPointerCapture(e.pointerId); } catch (er) {}
    function cleanup(mv, up, ev) { viewport.removeEventListener("pointermove", mv); viewport.removeEventListener("pointerup", up); viewport.removeEventListener("pointercancel", up); try { viewport.releasePointerCapture(ev.pointerId); } catch (er) {} }
    if (pen.tool === "eraser") {
      let did = false;
      function erase(cx, cy) { const p = worldPos(cx, cy), rad = 10 / view.z, before = arr.length; for (let i = arr.length - 1; i >= 0; i--) if (strokeHit(arr[i], p.x, p.y, rad)) arr.splice(i, 1); if (arr.length !== before) { did = true; renderDrawings(); } }
      erase(e.clientX, e.clientY);
      const emv = ev => erase(ev.clientX, ev.clientY);
      const eup = ev => { cleanup(emv, eup, ev); if (did) save(); };
      viewport.addEventListener("pointermove", emv); viewport.addEventListener("pointerup", eup); viewport.addEventListener("pointercancel", eup); return;
    }
    const hl = pen.tool === "hl";
    const f = worldPos(e.clientX, e.clientY);
    const pts = [[r1(f.x), r1(f.y)]];
    const d = { id: uid(), color: pen.color, w: r1((hl ? pen.w * 3.5 : pen.w) / view.z), op: hl ? 0.38 : 1, pts };
    const el = strokeEl(d); drawSvg.appendChild(el);
    const mv = ev => { const p = worldPos(ev.clientX, ev.clientY); const l = pts[pts.length - 1]; if (Math.hypot(p.x - l[0], p.y - l[1]) * view.z < 2) return; pts.push([r1(p.x), r1(p.y)]); el.setAttribute("d", strokePath(pts)); };
    const up = ev => { cleanup(mv, up, ev); d.pts = simplify(pts, 0.7 / view.z); if (d.op === 1) delete d.op; el.setAttribute("d", strokePath(d.pts)); arr.push(d); pen.mine.push(d.id); save(); };
    viewport.addEventListener("pointermove", mv); viewport.addEventListener("pointerup", up); viewport.addEventListener("pointercancel", up);
  }, true);

  // minimappa
  miniEl.addEventListener("pointerdown", (e) => {
    if (!miniEl._m) return;
    const b = miniEl.getBoundingClientRect(), m = miniEl._m;
    const wx = (e.clientX - b.left) * (miniEl.width / b.width), wy = (e.clientY - b.top) * (miniEl.height / b.height);
    const X = (wx - 6) / m.s + m.x0, Y = (wy - 6) / m.s + m.y0, r = viewport.getBoundingClientRect();
    setView(r.width / 2 - X * view.z, r.height / 2 - Y * view.z, view.z, true);
  });
  setInterval(() => { if (miniOn && !document.hidden) drawMini(); }, 500);

  // video file input
  document.getElementById("videoFile").addEventListener("change", function () {
    const f = this.files[0]; if (!f) return;
    if (svc.pendingNodeId) addVideoFile(svc.pendingNodeId, f);
    else toast("Seleziona prima un nodo.");
    this.value = "";
  });

  // image file input (nodo)
  document.getElementById("imageFile").addEventListener("change", function () {
    const f = this.files[0]; if (!f) return;
    if (svc.pendingCoverMode) { this.value = ""; return; } // gestito dalla Raccolta
    const nodeId = svc.pendingNodeId;
    if (!nodeId) { this.value = ""; return; }
    const url = URL.createObjectURL(f);
    const onDone = blob => { URL.revokeObjectURL(url); insertImageBlob(nodeId, blob); };
    showMenu([
      { l: "Ritaglia immagine…", fn: () => openCrop(url, onDone) },
      { l: "Inserisci intera", fn: () => onDone(f) }
    ], window.innerWidth / 2 - 80, window.innerHeight / 2);
    this.value = "";
  });

  // eventi globali tastiera
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !typingTarget(e.target)) {
      const k = (e.key || "").toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); histUndo(); }
      else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); histRedo(); }
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      const t = e.target;
      if (t && (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "INPUT")) return;
      if (selectedConn) removeConnection(selectedConn);
      else if (selectedNode) removeNode(selectedNode);
    }
  });

  // undo/redo via bus (per callback esterni)
  on("state:changed", () => { if (!runtime.applying) histCapture(); });

  // ===== Command palette actions for map module =====
  registerAction("Nodi", "Elimina nodo", "Delete", () => { if (selectedNode) removeNode(selectedNode); });
  registerAction("Nodi", "Nuova pagina", "Ctrl+Shift+P", addPage);
  registerAction("Nodi", "Annulla", "Ctrl+Z", histUndo);
  registerAction("Nodi", "Ripeti", "Ctrl+Y", histRedo);
  registerAction("Mappa", "Zoom avanti", "Ctrl++", () => zoomCenter(1.25));
  registerAction("Mappa", "Zoom indietro", "Ctrl+-", () => zoomCenter(0.8));
  registerAction("Mappa", "Adatta vista", "Ctrl+0", () => fitAll(true));
  registerAction("Mappa", "Attiva/Disattiva penna", "Ctrl+P", () => setPen(!pen.on));

  // toggle sidebar Raccolta
  const collToggleBtn = document.getElementById("collToggle");
  const collSidebar = document.getElementById("collectionSidebar");
  if (collToggleBtn && collSidebar) {
    const syncCollToggle = () => {
      const collapsed = collSidebar.classList.contains("collapsed");
      collToggleBtn.textContent = collapsed ? "»" : "«";
      collToggleBtn.title = collapsed ? "Mostra la Raccolta" : "Nascondi la Raccolta";
    };
    collToggleBtn.onclick = () => { collSidebar.classList.toggle("collapsed"); syncCollToggle(); };
    // su schermi stretti la Raccolta parte nascosta per lasciare spazio alla mappa
    if (window.innerWidth <= 640) collSidebar.classList.add("collapsed");
    syncCollToggle();
  }

  loadView();
  // primo render: senza questo la mappa resta vuota (niente tab, niente nodi) fino alla prima modifica
  renderAll();
}

function typingTarget(t) { return !!(t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")); }

/* ---- registro svc ---- */
svc.addNode = addNode;
svc.removeNode = removeNode;
svc.addConnection = addConnection;
svc.plainText = plainText;
svc.renderGraph = renderGraph;
svc.renderNodes = renderNodesExported;
svc.renderConnections = renderConnectionsExported;
svc.renderDrawings = renderDrawingsExported;
svc.renderTabs = renderTabsExported;
svc.updateNodeActions = updateNodeActionsExported;
svc.applyNodeSearch = applyNodeSearch;
svc.selectNode = selectNode;
svc.selectConn = selectConnExported;
svc.focusNode = focusNode;
svc.switchPage = switchPage;
svc.addPage = addPage;
svc.worldPos = worldPos;
svc.viewCenter = viewCenter;
svc.fitAll = fitAll;
svc.setView = setView;
svc.setPen = setPen;
svc.histUndo = histUndo;
svc.histRedo = histRedo;
svc.getViewport = getViewport;
svc.getNodeEls = getNodeEls;
svc.getDisp = getDisp;
svc.getCurrentColor = getCurrentColor;
svc.clearSelection = clearSelectionExported;
svc.penIsOn = penIsOn;
svc.mselIds = mselIds;
svc.mselClear = mselClear;
svc.updateMediaProgress = updateMediaProgress;
svc.markPending = markPending;
svc.renderConnectionsFn = renderConnections;
