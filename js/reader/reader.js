// reader.js — lettura ad alta voce (frasi, nodi, tagli)
import { state, save } from "../core/store.js";
import { toast, escapeHtml } from "../core/util.js";
import { settings, saveSettings } from "../core/settings.js";
import { langBcp } from "../core/i18n.js";
import { elTTS, ttsProv, useEleven, pickSysVoice, TTS_NAMES } from "../voice/tts.js";
import { svc } from "../core/svc.js";
import { registerAction } from "../ui/commandPalette.js";

const $ = (id) => document.getElementById(id);

const SILENT = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
const rd = { vol: null, segs: [], i: -1, playing: false, audio: new Audio(), token: 0, speed: 1, mode: "el", lang: "it-IT", open: false, els: [], cuts: [], nodeN: 0, resumeOK: false };

function readerOpen() { return rd.open; }

function updateReaderVoiceLabel() {
  const s = $("rdProv");
  if (!s.options.length) Object.keys(TTS_NAMES).forEach(k => { const o = document.createElement("option"); o.value = k; o.textContent = TTS_NAMES[k]; s.appendChild(o); });
  s.value = ttsProv();
}

const PG_MARK = /^—\s*p\.\s*(\d+)\s*—$/;
function textToBlocks(text) {
  const blocks = []; let pg = null;
  String(text || "").split(/\n{2,}|\r\n\r\n/).forEach(par => {
    const t = par.replace(/\s*\n\s*/g, " ").trim(); if (!t) return;
    const m = t.match(PG_MARK); if (m) { pg = +m[1]; return; }
    blocks.push({ pg, text: t });
  });
  return blocks;
}
async function volumeBlocks(v, onProgress, isCancelled) {
  if (v.type === "pdf" && v.pdf) return svc.getPdfBlocks(v, onProgress, isCancelled);
  return textToBlocks(v.text);
}

function splitSentences(t) { const m = t.match(/[^.!?…]+[.!?…]+["»”')\]]*\s*|[^.!?…]+$/g); return m ? m : [t]; }
function makeSegments(blocks) {
  const segs = []; const MAX = 380;
  blocks.forEach(b => {
    let cur = "";
    function push() { const s = cur.trim(); if (s) segs.push({ pg: b.pg, text: s }); cur = ""; }
    splitSentences(b.text).forEach(s => {
      s = s.trim(); if (!s) return;
      while (s.length > MAX) { let cut = s.lastIndexOf(", ", MAX); if (cut < MAX * 0.4) cut = s.lastIndexOf(" ", MAX); if (cut < 1) cut = MAX; if (cur) push(); segs.push({ pg: b.pg, text: s.slice(0, cut + 1).trim() }); s = s.slice(cut + 1).trim(); }
      if (cur && (cur.length + s.length + 1) > MAX) push();
      cur += (cur ? " " : "") + s;
    });
    push();
  });
  return segs;
}

function renderReaderList() {
  $("rdList").innerHTML = ""; rd.els = [];
  let lastPg = null;
  const frag = document.createDocumentFragment();
  rd.segs.forEach((s, i) => {
    if (s.pg != null && s.pg !== lastPg) { const h = document.createElement("div"); h.className = "rd-pg"; h.dataset.pg = s.pg; h.textContent = "Pagina " + s.pg; frag.appendChild(h); lastPg = s.pg; }
    const d = document.createElement("div"); d.className = "rd-seg"; d.dataset.i = i; d.textContent = s.text; frag.appendChild(d); rd.els.push(d);
  });
  $("rdList").appendChild(frag);
  updateReaderUI();
}

function highlightSeg(i, scroll) {
  try { $("rdNow").textContent = (rd.segs[i] && rd.segs[i].text) || ""; } catch (e) {}
  rd.els.forEach((el, k) => { el.classList.toggle("cur", k === i); el.classList.toggle("done", k < i); });
  const el = rd.els[i];
  if (el && scroll !== false) el.scrollIntoView({ block: "center", behavior: "smooth" });
}

function updateReaderUI() {
  const n = rd.segs.length;
  $("rdCount").textContent = n ? ((rd.i >= 0 ? rd.i + 1 : 0) + " / " + n) : "";
  $("rdPlay").textContent = rd.playing ? "⏸" : "▶";
  let rem = 0;
  for (let k = Math.max(0, rd.i); k < n; k++) rem += rd.segs[k].text.length;
  $("rdChars").textContent = n && useEleven() ? ("Da leggere: " + rem.toLocaleString("it-IT") + " caratteri (possono consumare la quota di " + (TTS_NAMES[ttsProv()] || "servizio vocale") + ")") : "";
}

function unlockAudio() { try { rd.audio.src = SILENT; const p = rd.audio.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
function stopPlayback() { rd.token++; rd.resumeOK = false; try { rd.audio.pause(); } catch (e) {} try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {} }

export async function openReader(vid, startPage) {
  const v = state.volumes.find(x => x.id === vid); if (!v) return;
  stopPlayback(); rd.playing = false; rd.vol = v; rd.i = -1; rd.cuts = []; rd.segs = []; rd.els = [];
  rd.lang = v.lang ? langBcp(v.lang) : (settings.speechLang || "it-IT");
  $("rdTitle").textContent = v.name || "Lettura";
  $("rdList").innerHTML = '<div class="hint">Preparo il testo…</div>';
  $("readerModal").classList.add("open"); rd.open = true;
  updateReaderVoiceLabel(); updateReaderUI();
  const myTok = ++rd.token;
  try {
    const blocks = await volumeBlocks(v, (i, n) => { if (rd.token === myTok) $("rdList").innerHTML = '<div class="hint">Estraggo il testo dal PDF… pagina ' + i + ' di ' + n + '</div>'; }, () => !rd.open || rd.vol !== v);
    if (rd.vol !== v || !rd.open) return;
    rd.segs = makeSegments(blocks);
    if (!rd.segs.length) { $("rdList").innerHTML = '<div class="empty">Nessun testo da leggere' + (v.type === "pdf" ? ' (il PDF sembra una scansione senza testo: serve un OCR).' : '.') + '</div>'; updateReaderUI(); return; }
    renderReaderList();
    let si = 0;
    if (startPage) { const f = rd.segs.findIndex(s => s.pg != null && s.pg >= startPage); if (f >= 0) si = f; }
    rd.i = si; highlightSeg(si); updateReaderUI();
  } catch (e) { if (rd.open) $("rdList").innerHTML = '<div class="empty">' + escapeHtml(e.message || "Errore") + '</div>'; }
}

export function closeReader() {
  stopPlayback(); rd.playing = false; rd.open = false; rd.vol = null;
  $("readerModal").classList.remove("open", "mini"); updateReaderUI();
}

async function playFrom(i) {
  while (i >= 0 && i < rd.segs.length && rd.segs[i].cut) i++;
  if (i < 0 || i >= rd.segs.length) { rd.playing = false; updateReaderUI(); return; }
  stopPlayback();
  const tok = rd.token; rd.i = i; rd.playing = true; highlightSeg(i); updateReaderUI();
  const seg = rd.segs[i];
  if (useEleven()) {
    try {
      const prev = i > 0 ? rd.segs[i - 1].text : null, next = i < rd.segs.length - 1 ? rd.segs[i + 1].text : null;
      const url = await elTTS(seg.text, prev, next);
      if (tok !== rd.token) return;
      rd.mode = "el";
      const a = rd.audio;
      a.onended = () => { if (tok === rd.token && rd.playing) playFrom(i + 1); };
      a.onerror = null; a.src = url; a.playbackRate = rd.speed;
      try { await a.play(); rd.resumeOK = true; } catch (pe) { if (tok !== rd.token) return; rd.playing = false; updateReaderUI(); toast("Il browser ha bloccato la riproduzione: premi Play."); return; }
      prefetch(i + 1, 2);
    } catch (e) { if (tok !== rd.token) return; rd.playing = false; updateReaderUI(); toast(e.message || "Errore voce"); }
    return;
  }
  speakSystem(seg.text, tok, i);
}
async function prefetch(from, count) {
  const tok = rd.token;
  for (let k = 0; k < count; k++) {
    const j = from + k; if (j >= rd.segs.length || tok !== rd.token) return;
    const prev = j > 0 ? rd.segs[j - 1].text : null, next = j < rd.segs.length - 1 ? rd.segs[j + 1].text : null;
    try { await elTTS(rd.segs[j].text, prev, next); } catch (e) { return; }
  }
}
function speakSystem(text, tok, i) {
  if (!window.speechSynthesis) { rd.playing = false; updateReaderUI(); toast("Il browser non supporta la sintesi vocale: scegli un altro servizio vocale."); return; }
  rd.mode = "sys";
  const u = new SpeechSynthesisUtterance(text);
  u.lang = rd.lang; u.rate = rd.speed; u.pitch = settings.sysPitch || 1;
  const vv = pickSysVoice(rd.lang); if (vv) u.voice = vv;
  u.onend = () => { if (tok === rd.token && rd.playing) playFrom(i + 1); };
  u.onerror = (ev) => { if (tok === rd.token && ev.error !== "canceled" && ev.error !== "interrupted") { rd.playing = false; updateReaderUI(); } };
  window.speechSynthesis.speak(u);
}

function rdSelection() {
  const s = window.getSelection(); if (!s || s.isCollapsed || !s.rangeCount) return null;
  const r = s.getRangeAt(0); if (!$("rdList").contains(r.commonAncestorContainer)) return null;
  const txt = s.toString().replace(/\s+/g, " ").trim(); if (!txt) return null;
  const idx = [];
  rd.els.forEach((el, k) => { if (r.intersectsNode(el)) idx.push(k); });
  return { text: txt, idx };
}
function rdTargets() {
  const sel = rdSelection(); if (sel && sel.idx.length) return { text: sel.text, idx: sel.idx, sel: true };
  if (rd.i < 0 || !rd.segs[rd.i]) return null;
  const n = parseInt($("rdNodeN").value, 10) || 1, idx = []; let k = rd.i;
  while (k >= 0 && idx.length < n) { if (!rd.segs[k].cut) idx.unshift(k); k--; }
  return { text: idx.map(q => rd.segs[q].text).join(" "), idx, sel: false };
}
function rdCutSegs(v, idx) {
  let removed = 0;
  const before = (v.type !== "pdf" && typeof v.text === "string") ? v.text : null;
  const done = [];
  idx.forEach(k => {
    const s = rd.segs[k]; if (!s || s.cut) return;
    if (before !== null) {
      const words = s.text.split(/\s+/).filter(Boolean).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      if (words.length) { const re = new RegExp(words.join("\\s+")); if (re.test(v.text)) { v.text = v.text.replace(re, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n"); removed++; } }
    }
    s.cut = true; done.push(k); if (rd.els[k]) rd.els[k].classList.add("cut");
  });
  if (!done.length) return;
  rd.cuts = rd.cuts || []; rd.cuts.push({ v, idx: done, text: before });
  if (before !== null) { svc.saveState && svc.saveState(); svc.renderCollection(); }
  if (rd.playing && done.indexOf(rd.i) >= 0) playFrom(rd.i + 1);
  return removed;
}
function rdCreateNode(cut) {
  const v = rd.vol; if (!v) return;
  const t = rdTargets(); if (!t || !t.text) { toast("Niente da usare: avvia la lettura o seleziona del testo."); return; }
  const first = rd.segs[t.idx[0]] || rd.segs[rd.i], pg = first ? first.pg : null, vn = v.name || "Volume";
  const src = (v.type === "pdf" && pg != null) ? { type: "pdf", volumeId: v.id, volumeName: vn, page: pg, phrase: t.text } : { type: "text", volumeId: v.id, volumeName: vn, phrase: t.text };
  rd.nodeN = (rd.nodeN || 0) + 1;
  const c = svc.viewCenter(); const k = (rd.nodeN - 1) % 6;
  svc.addNode({ x: Math.round(c.x - 115 + k * 36), y: Math.round(c.y - 90 + k * 36), title: vn + (pg != null ? " — p." + pg : ""), body: escapeHtml(t.text), source: src });
  if (cut) {
    const rm = rdCutSegs(v, t.idx);
    toast(v.type === "pdf" ? "Nodo creato. Nel PDF la frase non si cancella: viene solo saltata nella lettura." : (rm ? "Tagliato dal volume e aggiunto alla mappa." : "Nodo creato, ma non ho ritrovato il testo da togliere dal volume."));
  } else toast("Nodo aggiunto alla mappa");
  try { window.getSelection().removeAllRanges(); } catch (e) {}
}
function rdUndoCut() {
  const c = rd.cuts && rd.cuts.pop(); if (!c) { toast("Nessun taglio da annullare."); return; }
  c.idx.forEach(k => { if (rd.segs[k]) rd.segs[k].cut = false; if (rd.els[k]) rd.els[k].classList.remove("cut"); });
  if (c.text !== null && c.v.type !== "pdf") { c.v.text = c.text; svc.saveState && svc.saveState(); svc.renderCollection(); }
  toast("Taglio annullato (il nodo creato resta nella mappa).");
}

export function initReader() {
  $("rdList").addEventListener("click", (e) => { const d = e.target.closest(".rd-seg"); if (!d) return; if (rdSelection()) return; unlockAudio(); playFrom(+d.dataset.i); });
  $("rdClose").onclick = closeReader;
  $("rdPlay").onclick = () => {
    if (rd.playing) { rd.playing = false; if (rd.mode === "el") { try { rd.audio.pause(); } catch (e) {} } else { rd.token++; try { window.speechSynthesis.cancel(); } catch (e) {} rd.resumeOK = false; } updateReaderUI(); return; }
    if (rd.mode === "el" && rd.resumeOK && useEleven() && !rd.audio.ended && rd.i >= 0) { rd.playing = true; rd.audio.play().catch(() => {}); updateReaderUI(); return; }
    unlockAudio(); playFrom(rd.i >= 0 ? rd.i : 0);
  };
  $("rdNext").onclick = () => { unlockAudio(); let n = Math.min(rd.segs.length - 1, rd.i + 1); while (n < rd.segs.length - 1 && rd.segs[n] && rd.segs[n].cut) n++; if (rd.playing) playFrom(n); else { rd.i = n; highlightSeg(n); updateReaderUI(); stopPlayback(); } };
  $("rdPrev").onclick = () => { unlockAudio(); let n = Math.max(0, rd.i - 1); while (n > 0 && rd.segs[n] && rd.segs[n].cut) n--; if (rd.playing) playFrom(n); else { rd.i = n; highlightSeg(n); updateReaderUI(); stopPlayback(); } };
  $("rdSpeed").addEventListener("change", function () { rd.speed = parseFloat(this.value) || 1; try { rd.audio.playbackRate = rd.speed; } catch (e) {} if (rd.playing && rd.mode === "sys") playFrom(rd.i); });
  $("rdNode").onclick = () => rdCreateNode(false);
  $("rdCut").onclick = () => rdCreateNode(true);
  $("rdUndoCut").onclick = rdUndoCut;
  $("rdMini").onclick = () => { const m = !$("readerModal").classList.contains("mini"); $("readerModal").classList.toggle("mini", m); $("rdMini").textContent = m ? "▢" : "▁"; $("rdMini").title = m ? "Riapri il lettore completo" : "Riduci a barra: ascolti mentre lavori sulla mappa"; if (!m && rd.i >= 0) highlightSeg(rd.i); };
  $("rdProv").onchange = function () { settings.ttsProv = this.value; svc.saveSettings(); updateReaderUI(); if (rd.playing) playFrom(rd.i); };

  document.addEventListener("keydown", (e) => {
    if (!rd.open || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if ((t && (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) || (t && (t.tagName === "SELECT" || t.tagName === "BUTTON"))) return;
    const k = e.key.toLowerCase();
    if (k === "n") { e.preventDefault(); rdCreateNode(false); }
    else if (k === "x") { e.preventDefault(); rdCreateNode(true); }
    else if (k === "u") { e.preventDefault(); rdUndoCut(); }
    else if (k === " ") { e.preventDefault(); $("rdPlay").click(); }
    else if (k === "arrowright") { e.preventDefault(); $("rdNext").click(); }
    else if (k === "arrowleft") { e.preventDefault(); $("rdPrev").click(); }
  });
  window.addEventListener("beforeunload", () => { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) {} });

  // ===== Command palette actions for reader module =====
  registerAction("Voce", "Lettura ad alta voce", "Ctrl+R", () => { svc.openReader && svc.openReader(); });
  registerAction("Voce", "Play/Pausa", "Space", () => { if (svc.readerOpen && svc.readerOpen()) { $("rdPlay")?.click(); } });
  registerAction("Voce", "Segmento successivo", "Right", () => { if (svc.readerOpen && svc.readerOpen()) { $("rdNext")?.click(); } });
  registerAction("Voce", "Segmento precedente", "Left", () => { if (svc.readerOpen && svc.readerOpen()) { $("rdPrev")?.click(); } });
  registerAction("Voce", "Crea nodo da selezione", "N", () => { if (svc.readerOpen && svc.readerOpen()) { $("rdNode")?.click(); } });
  registerAction("Voce", "Taglia e crea nodo", "X", () => { if (svc.readerOpen && svc.readerOpen()) { $("rdCut")?.click(); } });
  registerAction("Voce", "Annulla taglio", "U", () => { if (svc.readerOpen && svc.readerOpen()) { $("rdUndoCut")?.click(); } });
}

svc.openReader = openReader;
svc.closeReader = closeReader;
svc.readerOpen = readerOpen;
