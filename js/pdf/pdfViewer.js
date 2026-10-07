// pdfViewer.js — lettore PDF (scorrimento continuo, text layer, nodi da testo/area)
import { state, activeRoom, idbPut, idbGet, downloadRoomBlob, uploadRoomBlob, storeBlob, mediaUrls, save } from "../core/store.js";
import { uid, clamp, toast, escapeHtml } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { rectOf, setBoxRect, attachCropBox } from "../core/crop.js";
import { svc } from "../core/svc.js";

const PDFJS_WORKER = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

function loadPdfJs() {
  if (window.pdfjsLib) { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; return Promise.resolve(); }
  return Promise.reject(new Error("pdf.js non caricato"));
}

/* ---- stato viewer ---- */
const pdfState = { doc: null, volumeId: null, pageNum: 1, hlPage: 0, highlightPhrase: "", highlightIndices: null, highlightSegs: null, hlDone: false };
let pdfZoom = 1, pdfPgs = [], pdfObs = null, pdfRender = 0, pdfRaf = 0, pdfCropPg = null, pdfCropActive = false, pdfWait = { id: null };

const $ = (id) => document.getElementById(id);

function closePdf() {
  pdfWait.id = null; stopPdfCrop(); pdfRender++;
  if (pdfObs) { pdfObs.disconnect(); pdfObs = null; }
  $("pdfModal").classList.remove("open");
  $("pdfPages").innerHTML = ""; pdfPgs = [];
  pdfState.doc = null; pdfState.volumeId = null; pdfState.highlightPhrase = ""; pdfState.highlightIndices = null; pdfState.highlightSegs = null; pdfState.hlPage = 0;
}

function makeCover(doc, v) {
  if (!v || v.coverId) return Promise.resolve();
  return doc.getPage(1).then(pg => {
    const b0 = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: 360 / b0.width });
    const c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    return pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise.then(() => new Promise(res => {
      c.toBlob(blob => { storeBlob(blob).then(id => { mediaUrls[id] = URL.createObjectURL(blob); v.coverId = id; res(); }); }, "image/jpeg", 0.85);
    }));
  }).catch(() => {});
}

function volNameOf(id) { const v = state.volumes.find(x => x.id === id); return v ? (v.name || (v.pdf && v.pdf.name) || "Volume") : "Volume"; }

/* ---- testo selezione ---- */
function spanSel(range, sp) {
  let len = sp.textContent.length, a = 0, b = len, r;
  if (sp.contains(range.startContainer)) { r = document.createRange(); r.selectNodeContents(sp); r.setEnd(range.startContainer, range.startOffset); a = r.toString().length; }
  if (sp.contains(range.endContainer)) { r = document.createRange(); r.selectNodeContents(sp); r.setEnd(range.endContainer, range.endOffset); b = r.toString().length; }
  return [a, b];
}
function selectedPdfText() {
  const sel = window.getSelection(); if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return "";
  const range = sel.getRangeAt(0); const out = []; let lastBottom = null, lastPg = null;
  $("pdfPages").querySelectorAll(".pdf-tl").forEach(tl => {
    tl.querySelectorAll("span").forEach(sp => {
      if (!range.intersectsNode(sp)) return;
      let t = sp.textContent; if (!t) return;
      const ab = spanSel(range, sp); t = t.slice(ab[0], ab[1]); if (!t) return;
      const top = sp.offsetTop, pgId = tl.parentNode;
      if (out.length) { const sameLine = (pgId === lastPg) && Math.abs(top - lastBottom) < (parseFloat(sp.style.fontSize) || 10) * 0.6; if (!sameLine) out.push(pgId !== lastPg ? "\n\n" : "\n"); else if (!/\s$/.test(out[out.length - 1]) && !/^\s/.test(t)) out.push(" "); }
      out.push(t); lastBottom = top; lastPg = pgId;
    });
  });
  let txt = out.join("");
  txt = txt.replace(/(\w)-\n(\w)/g, "$1$2").replace(/([^\n.!?:;])\n(?!\n)/g, "$1 ").replace(/[ \t]+/g, " ").trim();
  return txt;
}

/* ---- build pagine ---- */
function scrollToPdfPage(n) { const pg = pdfPgs[clamp(n, 1, pdfPgs.length || 1) - 1]; if (pg) $("pdfScroll").scrollTop = pg.el.offsetTop - 8; }
function curPdfPage() { const mid = $("pdfScroll").scrollTop + $("pdfScroll").clientHeight * 0.35; let cur = 1; for (let i = 0; i < pdfPgs.length; i++) { if (pdfPgs[i].el.offsetTop <= mid) cur = i + 1; else break; } return cur; }
function updatePdfInfo() { if (!pdfState.doc) return; const c = curPdfPage(); pdfState.pageNum = c; if (document.activeElement !== $("pdfGo")) $("pdfGo").value = c; $("pdfPageInfo").textContent = "/ " + pdfState.doc.numPages; $("pdfZoomInfo").textContent = Math.round(pdfZoom * 100) + "%"; }

const _mc = document.createElement("canvas").getContext("2d");
function buildTextLayer(tc, vp, tl) {
  const frag = document.createDocumentFragment();
  tc.items.forEach(it => {
    if (typeof it.str !== "string") return;
    if (it.str === "") { if (it.hasEOL) frag.appendChild(document.createElement("br")); return; }
    const m = window.pdfjsLib.Util.transform(vp.transform, it.transform);
    const fs = Math.hypot(m[2], m[3]); if (!fs) return;
    const st = tc.styles[it.fontName] || {}; const ff = st.fontFamily || "sans-serif";
    const asc = typeof st.ascent === "number" ? st.ascent : (typeof st.descent === "number" ? 1 + st.descent : 0.85);
    const ang = Math.atan2(m[1], m[0]);
    const sp = document.createElement("span"); sp.textContent = it.str;
    sp.style.left = m[4] + "px"; sp.style.top = (m[5] - fs * asc) + "px"; sp.style.fontSize = fs + "px"; sp.style.fontFamily = ff;
    _mc.font = fs + "px " + ff; const w = _mc.measureText(it.str).width, tw = it.width * vp.scale;
    const sx = (w > 0 && tw > 0) ? tw / w : 1; let tr = "";
    if (ang) tr += "rotate(" + ang + "rad) "; if (Math.abs(sx - 1) > 0.001) tr += "scaleX(" + sx + ")";
    if (tr) sp.style.transform = tr;
    frag.appendChild(sp);
    if (it.hasEOL) frag.appendChild(document.createElement("br"));
  });
  tl.appendChild(frag);
}

async function renderPdfPg(pg, scale, tok) {
  if (pg.done || pg.busy || !pdfState.doc) return;
  pg.busy = true;
  try {
    const page = await pdfState.doc.getPage(pg.n);
    if (tok !== pdfRender) return;
    const vp = page.getViewport({ scale });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cv = document.createElement("canvas");
    cv.width = Math.round(vp.width * dpr); cv.height = Math.round(vp.height * dpr);
    cv.style.width = Math.round(vp.width) + "px"; cv.style.height = Math.round(vp.height) + "px";
    await page.render({ canvasContext: cv.getContext("2d"), viewport: page.getViewport({ scale: scale * dpr }) }).promise;
    if (tok !== pdfRender) return;
    const tl = document.createElement("div"); tl.className = "pdf-tl"; tl.style.width = cv.style.width; tl.style.height = cv.style.height;
    pg.el.style.width = cv.style.width; pg.el.style.height = cv.style.height; pg.el.innerHTML = "";
    pg.el.appendChild(cv); pg.el.appendChild(tl);
    const tc = await page.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false });
    buildTextLayer(tc, vp, tl);
    pg.done = true;
    if (pdfState.hlPage === pg.n) applyPdfHighlight(pg);
  } catch (e) {} finally { pg.busy = false; }
}
function unloadPdfPg(pg) { if (!pg.done || $("pdfCropBox").parentNode === pg.el) return; pg.el.innerHTML = ""; pg.done = false; }

function wrapSeg(sp, a, b) {
  const t = sp.textContent; if (a < 0) a = 0; if (b > t.length) b = t.length; if (b <= a) return;
  sp.textContent = "";
  if (a > 0) sp.appendChild(document.createTextNode(t.slice(0, a)));
  const m = document.createElement("mark"); m.className = "hl"; m.textContent = t.slice(a, b); sp.appendChild(m);
  if (b < t.length) sp.appendChild(document.createTextNode(t.slice(b)));
}
function locatePhrase(spans, phrase) {
  const want = String(phrase || "").replace(/\s+/g, " ").trim().toLowerCase(); if (!want) return null;
  let all = "", map = [], i, j, sp, t, lc2;
  for (i = 0; i < spans.length; i++) {
    sp = spans[i]; t = sp.textContent;
    for (j = 0; j < t.length; j++) {
      if (/\s/.test(t.charAt(j))) { if (all && all.charAt(all.length - 1) !== " ") { all += " "; map.push([i, -1]); } }
      else { lc2 = t.charAt(j).toLowerCase(); for (let q = 0; q < lc2.length; q++) { all += lc2.charAt(q); map.push([i, j]); } }
    }
    const nx = spans[i + 1];
    if (nx) {
      const nt = nx.textContent;
      if (/\w-$/.test(t) && /^\w/.test(nt) && Math.abs(nx.offsetTop - sp.offsetTop) > (parseFloat(sp.style.fontSize) || 10) * 0.6) { all = all.slice(0, -1); map.pop(); }
      else if (all && all.charAt(all.length - 1) !== " ") { all += " "; map.push([i, -1]); }
    }
  }
  const p = all.indexOf(want); if (p < 0) return null;
  const segs = {}, out = [];
  for (let q = p; q < p + want.length; q++) {
    const m = map[q]; if (!m || m[1] < 0) continue;
    let sg = segs[m[0]]; if (!sg) { sg = segs[m[0]] = [m[0], m[1], m[1] + 1]; out.push(sg); }
    else { if (m[1] < sg[1]) sg[1] = m[1]; if (m[1] + 1 > sg[2]) sg[2] = m[1] + 1; }
  }
  return out;
}
function applyPdfHighlight(pg) {
  const tl = pg.el.querySelector(".pdf-tl"); if (!tl) return;
  const spans = Array.prototype.slice.call(tl.querySelectorAll("span")); if (!spans.length) return;
  let segs = pdfState.highlightSegs; if (!(segs && segs.length)) segs = locatePhrase(spans, pdfState.highlightPhrase);
  if (segs && segs.length) { segs.forEach(g => { if (spans[g[0]]) wrapSeg(spans[g[0]], g[1], g[2]); }); }
  else if (pdfState.highlightIndices && pdfState.highlightIndices.length) { pdfState.highlightIndices.forEach(i => { if (spans[i]) spans[i].classList.add("hl"); }); }
  const first = tl.querySelector(".hl");
  if (first && !pdfState.hlDone) { pdfState.hlDone = true; first.scrollIntoView({ block: "center" }); }
}

async function buildPdfPages(goTo) {
  const doc = pdfState.doc; stopPdfCrop();
  if (pdfObs) pdfObs.disconnect();
  $("pdfPages").innerHTML = ""; pdfPgs = [];
  const tok = ++pdfRender;
  const p1 = await doc.getPage(1); const b0 = p1.getViewport({ scale: 1 });
  const avail = Math.min($("pdfScroll").clientWidth - 28, 1100) || 900;
  const scale = avail / b0.width * pdfZoom;
  pdfObs = new IntersectionObserver(es => {
    es.forEach(e => { const pg = pdfPgs[+e.target.dataset.n - 1]; if (!pg) return; if (e.isIntersecting) renderPdfPg(pg, scale, tok); else unloadPdfPg(pg); });
  }, { root: $("pdfScroll"), rootMargin: "900px 0px" });
  for (let i = 1; i <= doc.numPages; i++) {
    const d = document.createElement("div"); d.className = "pdf-pg"; d.dataset.n = i;
    d.style.width = Math.round(b0.width * scale) + "px"; d.style.height = Math.round(b0.height * scale) + "px";
    $("pdfPages").appendChild(d); pdfPgs.push({ n: i, el: d, done: false, busy: false }); pdfObs.observe(d);
  }
  $("pdfGo").max = doc.numPages;
  if (goTo) scrollToPdfPage(pdfState.pageNum);
  updatePdfInfo();
}

async function fetchPdfData(volumeId) {
  let ab = await idbGet("pdfs", volumeId); if (ab) return ab;
  if (activeRoom) { const remote = await downloadRoomBlob(volumeId, "pdf", "application/pdf"); if (remote) { ab = await remote.arrayBuffer(); await idbPut("pdfs", volumeId, ab); return ab; } }
  if (svc.requestMissingFiles && svc.collabActive && svc.collabActive()) {
    pdfWait.id = volumeId; $("pdfTitle").textContent = "Cerco il PDF tra gli amici…";
    const t0 = Date.now(); let warned = false;
    while ($("pdfModal").classList.contains("open") && pdfWait.id === volumeId && Date.now() - t0 < 300000) {
      if (svc.hasPeers && svc.hasPeers()) { if (!svc.incoming || !svc.incoming[volumeId] || Date.now() - svc.incoming[volumeId].last > 8000) { await svc.requestMissingFiles(true); } }
      else if (!warned && Date.now() - t0 > 6000) { warned = true; $("pdfTitle").textContent = "In attesa che un amico con il PDF sia online…"; }
      await new Promise(r => setTimeout(r, 600));
      ab = await idbGet("pdfs", volumeId); if (ab) { pdfWait.id = null; return ab; }
    }
    const aborted = !$("pdfModal").classList.contains("open");
    pdfWait.id = null;
    if (!aborted) toast("PDF non arrivato: serve che almeno un amico che lo ha caricato sia connesso alla stanza.");
    return null;
  }
  toast("Questo PDF non è sul tuo dispositivo. Entra nel server o caricalo tu.");
  return null;
}

export async function openPdfViewer(volumeId, pageNum, phrase, segs, indices) {
  $("pdfModal").classList.add("open");
  $("pdfTitle").textContent = "Caricamento";
  loadPdfJs().then(() => {
    const v = state.volumes.find(x => x.id === volumeId);
    if (!v || !v.pdf) { closePdf(); return; }
    return fetchPdfData(volumeId).then(ab => {
      if (!ab) { closePdf(); return null; }
      return window.pdfjsLib.getDocument({ data: ab }).promise.then(doc => {
        pdfState.doc = doc; pdfState.volumeId = volumeId;
        pdfState.pageNum = clamp(pageNum || 1, 1, doc.numPages);
        pdfState.hlPage = phrase ? pdfState.pageNum : 0;
        pdfState.highlightPhrase = phrase || ""; pdfState.highlightIndices = indices || null; pdfState.highlightSegs = segs || null; pdfState.hlDone = false;
        $("pdfTitle").textContent = v.name || v.pdf.name;
        return buildPdfPages(true);
      });
    });
  }).catch(err => { toast("Errore apertura PDF: " + err.message); closePdf(); });
}

/* ---- nodi dal PDF ---- */
function getSelectedPdf() {
  const sel = window.getSelection(); if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const text = selectedPdfText().replace(/\s+/g, " ").trim(); if (!text) return null;
  const range = sel.getRangeAt(0);
  const pgs = $("pdfPages").querySelectorAll(".pdf-pg");
  let found = null, segs = [];
  for (let q = 0; q < pgs.length && !found; q++) {
    const tl = pgs[q].querySelector(".pdf-tl"); if (!tl) continue;
    const spans = tl.querySelectorAll("span");
    for (let i = 0; i < spans.length; i++) { const sp = spans[i]; if (!range.intersectsNode(sp)) continue; const ab = spanSel(range, sp); if (ab[1] > ab[0]) segs.push([i, ab[0], ab[1]]); }
    if (segs.length) found = pgs[q];
  }
  if (!found) return null;
  return { text, page: +found.dataset.n, segs };
}
function addNodeFromPdf(text, volumeId, pageNum, segs) {
  const volName = volNameOf(volumeId);
  svc.addNode({ title: volName + " — p." + pageNum, body: escapeHtml(text), source: { type: "pdf", volumeId, volumeName: volName, page: pageNum, phrase: text, segs } });
  toast("Frase aggiunta alla mappa");
}
function startPdfCrop() {
  const pg = pdfPgs[curPdfPage() - 1];
  if (!pg || !pg.done) { toast("Attendi il caricamento della pagina."); return false; }
  pdfCropActive = true; pdfCropPg = pg;
  pg.el.appendChild($("pdfCropBox")); $("pdfCropBox").style.display = "block";
  setBoxRect($("pdfCropBox"), pg.el.clientWidth * 0.2, pg.el.clientHeight * 0.2, pg.el.clientWidth * 0.6, pg.el.clientHeight * 0.6);
  return true;
}
function stopPdfCrop() { pdfCropActive = false; $("pdfCropBox").style.display = "none"; if ($("pdfCropBox").parentNode !== $("pdfScroll")) $("pdfScroll").appendChild($("pdfCropBox")); }

/* ---- getPdfBytes / blocks (per ricerca, lettura, traduzione) ---- */
export async function getPdfBytes(v) {
  let ab = await idbGet("pdfs", v.id); if (ab) return ab;
  if (activeRoom) { const b = await downloadRoomBlob(v.id, "pdf", "application/pdf"); if (b) { ab = await b.arrayBuffer(); await idbPut("pdfs", v.id, ab); return ab; } }
  return null;
}

function pageParagraphsFromContent(tc) {
  const lines = []; let cur = null, lastY = null, lastEnd = 0, lastStr = "";
  tc.items.forEach(it => {
    if (typeof it.str !== "string") return;
    const tr = it.transform, y = tr[5], fs = Math.abs(tr[3]) || it.height || 10;
    if (it.str === "") { if (it.hasEOL) cur = null; return; }
    if (cur === null || Math.abs(y - lastY) > fs * 0.55) { cur = { y, fs, t: "", x: tr[4] }; lines.push(cur); lastEnd = tr[4]; lastStr = ""; }
    else { const gap = tr[4] - lastEnd; if (gap > fs * 0.18 && !/\s$/.test(lastStr) && !/^\s/.test(it.str)) cur.t += " "; }
    cur.t += it.str; lastStr = it.str; lastEnd = tr[4] + (it.width || 0); lastY = y; if (it.hasEOL) cur = null;
  });
  const paras = []; let pt = "", prev = null;
  lines.forEach(l => {
    const t = l.t.replace(/\s+/g, " ").trim(); if (!t) return;
    let newP = false;
    if (prev) { const gap = prev.y - l.y; if (gap > prev.fs * 1.75 || gap < -prev.fs * 3) newP = true; else if (/[.!?:»”"…]$/.test(prev.t) && gap > prev.fs * 1.3) newP = true; }
    if (newP || !pt) { if (pt) paras.push(pt); pt = t; }
    else if (/[A-Za-zÀ-ÿ]-$/.test(pt) && /^[a-zà-ÿ]/.test(t)) pt = pt.slice(0, -1) + t;
    else pt += " " + t;
    prev = { y: l.y, fs: l.fs, t };
  });
  if (pt) paras.push(pt);
  return paras;
}

const parCache = {};
export async function getPdfBlocks(v, onProgress, isCancelled) {
  const key = v.id + "|" + (v.pdf && v.pdf.name) + "|" + (v.pdf && v.pdf.pageCount);
  if (parCache[key]) return parCache[key];
  const ab = await getPdfBytes(v);
  if (!ab) throw new Error("Il PDF non è su questo dispositivo.");
  await loadPdfJs();
  const doc = await window.pdfjsLib.getDocument({ data: ab }).promise;
  const blocks = [];
  for (let i = 1; i <= doc.numPages; i++) {
    if (isCancelled && isCancelled()) { try { doc.destroy(); } catch (e) {} throw new Error("Interrotto"); }
    const pg = await doc.getPage(i), tc = await pg.getTextContent();
    pageParagraphsFromContent(tc).forEach(t => blocks.push({ pg: i, text: t }));
    if (onProgress) onProgress(i, doc.numPages);
  }
  try { doc.destroy(); } catch (e) {}
  parCache[key] = blocks;
  return blocks;
}

const pdfTextCache = {};
export async function getPdfPages(v) {
  const key = v.id + "|" + (v.pdf && v.pdf.name) + "|" + (v.pdf && v.pdf.pageCount);
  if (pdfTextCache[key]) return pdfTextCache[key];
  const ab = await getPdfBytes(v); if (!ab) return null;
  await loadPdfJs();
  const doc = await window.pdfjsLib.getDocument({ data: ab }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i++) { const pg = await doc.getPage(i), tc = await pg.getTextContent(); pages.push(tc.items.map(it => it.str).join(" ").replace(/\s+/g, " ")); }
  try { doc.destroy(); } catch (e) {}
  pdfTextCache[key] = pages;
  return pages;
}

/* ---- init ---- */
export function initPdfViewer() {
  const cropProxy = { get clientWidth() { return $("pdfCropBox").parentNode ? $("pdfCropBox").parentNode.clientWidth : 0; }, get clientHeight() { return $("pdfCropBox").parentNode ? $("pdfCropBox").parentNode.clientHeight : 0; } };
  attachCropBox($("pdfCropBox"), cropProxy);

  $("pdfClose").onclick = closePdf;
  $("pdfPrev").onclick = () => scrollToPdfPage(curPdfPage() - 1);
  $("pdfNext").onclick = () => scrollToPdfPage(curPdfPage() + 1);
  $("pdfGo").addEventListener("change", function () { const n = parseInt(this.value, 10); if (n) scrollToPdfPage(n); });
  $("pdfZoomIn").onclick = () => setPdfZoom(pdfZoom + 0.25);
  $("pdfZoomOut").onclick = () => setPdfZoom(pdfZoom - 0.25);
  function setPdfZoom(z) { if (!pdfState.doc) return; pdfZoom = clamp(z, 0.5, 2.5); pdfState.pageNum = curPdfPage(); buildPdfPages(true); }

  $("pdfScroll").addEventListener("scroll", () => { if (pdfRaf) return; pdfRaf = requestAnimationFrame(() => { pdfRaf = 0; updatePdfInfo(); }); });

  document.addEventListener("copy", (e) => {
    if (!$("pdfModal").classList.contains("open")) return;
    const sel = window.getSelection(); if (!sel || sel.isCollapsed) return;
    const a = sel.anchorNode; const el = a && (a.nodeType === 3 ? a.parentNode : a);
    if (!(el && el.closest && el.closest(".pdf-tl"))) return;
    const t = selectedPdfText(); if (!t) return;
    e.clipboardData.setData("text/plain", t); e.preventDefault();
  });
  $("pdfCopy").addEventListener("mousedown", e => e.preventDefault());
  $("pdfCopy").onclick = () => { const t = selectedPdfText(); if (!t) { toast("Seleziona prima il testo nella pagina."); return; } copyText(t).then(() => toast("Testo copiato")); };
  $("pdfCutText").addEventListener("mousedown", e => e.preventDefault());
  $("pdfCutText").onclick = () => { if (!pdfState.doc) return; const r = getSelectedPdf(); if (!r) { toast("Seleziona prima una frase nel testo della pagina."); return; } addNodeFromPdf(r.text, pdfState.volumeId, r.page, r.segs); };
  $("pdfCutImg").onclick = () => {
    if (!pdfState.doc) return;
    if (!pdfCropActive) { if (startPdfCrop()) toast("Trascina il riquadro blu, poi premi di nuovo Nodo da un'area."); return; }
    const pg = pdfCropPg, cv = pg && pg.el.querySelector("canvas"), r = rectOf($("pdfCropBox"));
    if (!cv || r.w < 4 || r.h < 4) { toast("Area troppo piccola."); return; }
    const k = cv.width / pg.el.clientWidth;
    const c = document.createElement("canvas"); c.width = Math.round(r.w * k); c.height = Math.round(r.h * k);
    c.getContext("2d").drawImage(cv, r.x * k, r.y * k, r.w * k, r.h * k, 0, 0, c.width, c.height);
    const n = pg.n, vid = pdfState.volumeId, volName = volNameOf(vid);
    c.toBlob(blob => {
      storeBlob(blob).then(id => {
        mediaUrls[id] = URL.createObjectURL(blob);
        svc.addNode({ title: volName + " — p." + n, body: '<img data-media-id="' + id + '" contenteditable="false">', source: { type: "pdf-image", volumeId: vid, volumeName: volName, page: n } });
        stopPdfCrop(); toast("Immagine pagina aggiunta");
      });
    }, "image/png");
  };
  $("pdfRead").onclick = () => { if (!pdfState.doc || !pdfState.volumeId) return; const vid = pdfState.volumeId, pg = curPdfPage(); closePdf(); svc.openReader(vid, pg); };
}

/* carica un file PDF in un volume (usato da "Carica file") */
export function loadPdfFile(volumeId, f) {
  const reader = new FileReader();
  reader.onload = () => {
    const ab = reader.result;
    idbPut("pdfs", volumeId, ab).then(() => {
      if (activeRoom) uploadRoomBlob(volumeId, new Blob([ab], { type: "application/pdf" }), "pdf");
      return loadPdfJs();
    }).then(() => window.pdfjsLib.getDocument({ data: ab }).promise).then(doc => {
      const v = state.volumes.find(x => x.id === volumeId);
      if (v) { v.type = "pdf"; v.pdf = { name: f.name, pageCount: doc.numPages }; }
      return makeCover(doc, v).then(() => { svc.renderCollection(); save(); toast("PDF caricato"); });
    }).catch(err => toast("Errore PDF: " + err.message));
  };
  reader.readAsArrayBuffer(f);
}

function copyText(t) { return navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(t).catch(() => legacyCopy(t)) : legacyCopy(t); }
function legacyCopy(t) { return new Promise(res => { const ta = document.createElement("textarea"); ta.value = t; ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0"; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove(); res(); }); }

/* ---- registro svc ---- */
svc.openPdfViewer = openPdfViewer;
svc.loadPdfFile = loadPdfFile;
svc.getPdfBytes = getPdfBytes;
svc.getPdfBlocks = getPdfBlocks;
svc.getPdfPages = getPdfPages;
svc.makeCover = makeCover;
svc.volNameOf = volNameOf;
svc.closePdf = closePdf;
