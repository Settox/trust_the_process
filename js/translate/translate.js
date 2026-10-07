// translate.js — traduzione volumi/PDF (browser, google, libre, AI) + PDF con layout
import { state, activeRoom, idbPut, save, mediaUrls } from "../core/store.js";
import { uid, sleep, toast, base64ToBlob, confirmModal } from "../core/util.js";
import { settings, saveSettings } from "../core/settings.js";
import { aiTranslate, aiTranslateList, waitMs } from "../core/ai.js";
import { svc } from "../core/svc.js";
import { registerAction } from "../ui/commandPalette.js";

function fillLangSelect(sel, current) {
  const langs = [
    ["it", "Italiano"], ["en", "Inglese"], ["fr", "Francese"], ["es", "Spagnolo"],
    ["de", "Tedesco"], ["pt", "Portoghese"], ["ru", "Russo"], ["zh-CN", "Cinese"],
    ["ja", "Giapponese"], ["ko", "Coreano"], ["ar", "Arabo"], ["hi", "Hindi"],
    ["nl", "Olandese"], ["pl", "Polacco"], ["tr", "Turco"], ["el", "Greco"], ["la", "Latino"]
  ];
  sel.innerHTML = "";
  langs.forEach(([code, label]) => {
    const o = document.createElement("option");
    o.value = code; o.textContent = label;
    if (code === current) o.selected = true;
    sel.appendChild(o);
  });
}

const $ = (id) => document.getElementById(id);

const tr = { v: null, busy: false, abort: false, useBt: false, src: null, bt: {}, gmode: "" };

export function openTranslate(vid) {
  const v = state.volumes.find(x => x.id === vid); if (!v) return;
  if (!(v.type === "pdf" && v.pdf) && !(v.text && v.text.trim())) { toast("Il volume non ha testo da tradurre."); return; }
  tr.v = v;
  fillLangSelect($("trLang"), settings.trTarget || "en");
  $("trTitle").textContent = "Traduci «" + (v.name || "volume") + "»";
  $("trProvNote").textContent = (v.type === "pdf" ? "Crea un nuovo PDF tradotto, con lo stesso aspetto. " : "") + (settings.trProvider === "browser" ? "Servizio: traduttore del browser (Chrome, sul tuo computer, nessun limite)" : settings.trProvider === "ai" ? (svc.aiProfile() ? "Servizio: " + svc.aiProfile().name + " (" + svc.aiProfile().model + "), " + svc.aiProfile().rpm + " richieste/min con attesa automatica" : "Servizio: modello AI non ancora impostato (Impostazioni)") : settings.trProvider === "libre" ? "Servizio: LibreTranslate (" + (settings.ltUrl || "URL non impostato") + ")" : "Servizio: traduttore web gratuito (non ufficiale, può rallentare o interrompersi sui libri lunghi).");
  $("trBar").style.width = "0%"; $("trInfo").textContent = ""; $("trGo").style.display = "inline-flex"; $("trGo").disabled = false; $("trStop").style.display = "none";
  $("trModal").classList.add("open");
}

export async function closeTranslate() {
  if (tr.busy) { if (!(await confirmModal("Interrompere la traduzione? Il testo già tradotto verrà conservato come parziale."))) return; tr.abort = true; }
  $("trModal").classList.remove("open");
}

/* ---- servizi ---- */
function gtParse(data) { return (data && data[0] || []).map(x => (x && x[0] ? x[0] : "")).join(""); }

async function btTranslate(text, target) {
  if (!("Translator" in self)) throw new Error("Il traduttore del browser richiede Chrome recente su computer. Scegli un altro servizio nelle impostazioni.");
  const tl = String(target).split("-")[0];
  if (!tr.src) {
    let src = "en";
    if ("LanguageDetector" in self) { try { const det = await self.LanguageDetector.create(); const r = await det.detect(String(text).slice(0, 400)); if (r && r[0] && r[0].detectedLanguage && r[0].detectedLanguage !== "und") src = r[0].detectedLanguage; } catch (e) {} }
    tr.src = src;
  }
  if (tr.src === tl) return text;
  tr.bt = tr.bt || {};
  const key = tr.src + ">" + tl;
  if (!tr.bt[key]) { try { tr.bt[key] = await self.Translator.create({ sourceLanguage: tr.src, targetLanguage: tl }); } catch (e) { throw new Error("Lingua non disponibile nel browser (" + tr.src + " > " + tl + "). Se è la prima volta, clicca di nuovo Traduci per scaricare il modello."); } }
  return await tr.bt[key].translate(text);
}

async function gtMulti(arr, target) {
  const body = "client=gtx&sl=auto&tl=" + encodeURIComponent(target) + "&dt=t" + arr.map(t => "&q=" + encodeURIComponent(t)).join("");
  const res = await fetch("https://translate.googleapis.com/translate_a/t", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body });
  if (!res.ok) { const e = new Error("Traduttore: errore " + res.status); e.status = res.status; throw e; }
  let j = await res.json(); if (!Array.isArray(j)) j = [j];
  return j.map(x => (Array.isArray(x) ? x[0] : x));
}
async function gtPost(text, target) {
  const res = await fetch("https://translate.googleapis.com/translate_a/single", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" }, body: "client=gtx&sl=auto&tl=" + encodeURIComponent(target) + "&dt=t&q=" + encodeURIComponent(text) });
  if (!res.ok) { const e = new Error("Traduttore: errore " + res.status); e.status = res.status; throw e; }
  return gtParse(await res.json());
}
function splitForGet(text, max) {
  const out = []; let cur = "";
  text.split(/\n{2,}/).forEach(par => {
    while (par.length > max) { let cut = par.lastIndexOf(". ", max); if (cut < max * 0.4) cut = par.lastIndexOf(" ", max); if (cut < 1) cut = max; if (cur) { out.push(cur); cur = ""; } out.push(par.slice(0, cut + 1)); par = par.slice(cut + 1); }
    if (cur && (cur.length + par.length + 2) > max) { out.push(cur); cur = ""; }
    cur += (cur ? "\n\n" : "") + par;
  });
  if (cur) out.push(cur);
  return out;
}
async function gtGet(text, target) {
  const parts = splitForGet(text, 1300), out = [];
  for (let i = 0; i < parts.length; i++) {
    const res = await fetch("https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=" + encodeURIComponent(target) + "&dt=t&q=" + encodeURIComponent(parts[i]));
    if (!res.ok) { const e = new Error("Traduttore: errore " + res.status); e.status = res.status; throw e; }
    out.push(gtParse(await res.json()));
    await sleep(140);
  }
  return out.join("\n\n");
}

async function translateChunk(text, target) {
  const prov = settings.trProvider;
  if (prov === "libre") {
    if (!settings.ltUrl) throw new Error("Imposta l'URL di LibreTranslate in Impostazioni.");
    const body = { q: text, source: "auto", target: target.split("-")[0] === "zh" ? "zh" : target, format: "text" };
    if (settings.ltKey) body.api_key = settings.ltKey;
    const r = await fetch(settings.ltUrl.replace(/\/+$/, "") + "/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error("LibreTranslate: errore " + r.status);
    const j = await r.json(); return j.translatedText || "";
  }
  if (prov === "browser" || tr.useBt) return await btTranslate(text, target);
  if (prov === "ai") return await aiTranslate(text, target);
  if (tr.gmode !== "get") { try { return await gtPost(text, target); } catch (e) { if (e instanceof TypeError) tr.gmode = "get"; else throw e; } }
  return await gtGet(text, target);
}

async function translateRetry(text, target) {
  let wait = 1200, last = null;
  for (let a = 0; a < 5; a++) {
    if (tr.abort) throw new Error("Interrotto");
    try { return await translateChunk(text, target); }
    catch (e) {
      last = e;
      if (e.final || (e.message && /imposta (l'URL|la chiave)/i.test(e.message))) throw e;
      $("trInfo").textContent = "Il servizio rallenta, riprovo (" + (a + 1) + "/5)…";
      await sleep(wait); wait *= 2;
    }
  }
  throw last || new Error("Traduzione non riuscita");
}

function chunkBlocks(blocks, max) {
  const chunks = []; let cur = null;
  blocks.forEach(b => {
    const parts = [];
    if (b.text.length > max) {
      let s = b.text, pos = 0;
      while (pos < s.length) {
        let end = Math.min(s.length, pos + max);
        if (end < s.length) { let cut = s.lastIndexOf(". ", end); if (cut < pos + max * 0.5) cut = s.lastIndexOf(" ", end); if (cut > pos) end = cut + 1; }
        parts.push(s.slice(pos, end).trim()); pos = end;
      }
    } else parts.push(b.text);
    parts.forEach(p => {
      if (!p) return;
      if (cur && cur.pg === b.pg && (cur.len + p.length + 2) <= max) { cur.items.push(p); cur.len += p.length + 2; }
      else { cur = { pg: b.pg, items: [p], len: p.length, first: true }; chunks.push(cur); }
    });
  });
  const seen = {};
  chunks.forEach(c => { c.mark = (c.pg != null && !seen[c.pg]); seen[c.pg] = 1; });
  return chunks;
}

/* ---- PDF con layout ---- */
let pdocLib = null;
function loadPdfLib() {
  if (window.PDFLib) { pdocLib = window.PDFLib; return Promise.resolve(); }
  return new Promise((res, rej) => {
    const sc = document.createElement("script");
    sc.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
    sc.onload = () => { pdocLib = window.PDFLib; res(); };
    sc.onerror = () => rej(new Error("Impossibile caricare lo strumento per creare il PDF."));
    document.head.appendChild(sc);
  });
}
function wrapLines(c, t, w) {
  const out = []; let cur = "";
  t.split(/\s+/).forEach(wd => { const x = cur ? cur + " " + wd : wd; if (cur && c.measureText(x).width > w) { out.push(cur); cur = wd; } else cur = x; });
  if (cur) out.push(cur);
  return out;
}
function drawFit(c, t, x, y, w, h, f) {
  let ln;
  for (;;) {
    c.font = f + "px Georgia,'Times New Roman',serif";
    ln = wrapLines(c, t, w);
    if (ln.length * f * 1.15 <= h + 1 || f <= 6) break;
    f -= 0.5;
  }
  ln.forEach((l, i) => c.fillText(l, x, y + i * f * 1.15));
}

async function runPdfTranslation(v, target) {
  tr.busy = true; tr.abort = false; tr.useBt = false; tr.src = null;
  $("trGo").style.display = "none"; $("trStop").style.display = "inline-flex";
  let err = "", done = 0, n = 0, bytes = null, pdoc = null;
  try {
    if (!window.pdfjsLib) throw new Error("pdf.js non è caricato: controlla la connessione e riprova.");
    window.pdfjsLib.GlobalWorkerOptions = window.pdfjsLib.GlobalWorkerOptions || {};
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    await loadPdfLib();
    const ab = await svc.getPdfBytes(v);
    if (!ab) throw new Error("PDF non trovato su questo dispositivo.");
    const doc = await window.pdfjsLib.getDocument({ data: ab.slice(0) }).promise;
    n = doc.numPages;
    pdoc = await pdocLib.PDFDocument.create();
    const font = await pdoc.embedFont(pdocLib.StandardFonts.Helvetica), S = 1.4;
    for (let i = 1; i <= n; i++) {
      if (tr.abort) break;
      $("trInfo").textContent = "Traduco pagina " + i + "/" + n + "…";
      $("trBar").style.width = Math.round((i - 1) / n * 100) + "%";
      const page = await doc.getPage(i), v1 = page.getViewport({ scale: 1 }), vs = page.getViewport({ scale: S });
      const cv = document.createElement("canvas"); cv.width = Math.round(vs.width); cv.height = Math.round(vs.height);
      const c = cv.getContext("2d");
      await page.render({ canvasContext: c, viewport: vs }).promise;
      const paras = trParagraphs(await page.getTextContent(), v1);
      let texts = [];
      if (paras.length) {
        texts = await trPage(null, paras, target);
        c.textBaseline = "top";
        paras.forEach((q, k) => { c.fillStyle = "#fff"; c.fillRect(q.x * S - 2, q.y * S, q.w * S + 4, q.h * S); c.fillStyle = "#111"; drawFit(c, (texts[k] || q.t).trim(), q.x * S, q.y * S, q.w * S, q.h * S, q.fs * S * 0.95); });
      }
      const jpg = await pdoc.embedJpg(cv.toDataURL("image/jpeg", 0.82)), pp = pdoc.addPage([v1.width, v1.height]);
      pp.drawImage(jpg, { x: 0, y: 0, width: v1.width, height: v1.height });
      paras.forEach((q, k) => { try { const tx = (texts[k] || q.t).replace(/[^\x20-\x7E\xA0-\xFF]/g, ""); if (tx.trim()) pp.drawText(tx, { x: q.x, y: v1.height - q.y - q.fs, size: Math.max(4, q.fs * 0.8), font, opacity: 0, maxWidth: Math.max(20, q.w), lineHeight: q.fs }); } catch (e) {} });
      cv.width = 0; cv.height = 0; page.cleanup(); done++;
    }
    if (!done) throw new Error("Nessuna pagina tradotta.");
    bytes = await pdoc.save();
  } catch (e) { err = e.message || "Errore"; }
  tr.busy = false;
  if (bytes && done) {
    const partial = done < n, nid = uid(), nm = (v.name || "Volume") + " [" + target.toUpperCase() + "]" + (partial ? " (parziale)" : "");
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    try {
      await idbPut("pdfs", nid, buf);
      const nv = { id: nid, name: nm, type: "pdf", pdf: { name: nm + ".pdf", pageCount: done }, folderId: null, tr: true, lang: target, srcId: v.id };
      state.volumes.push(nv);
      try { const d2 = await window.pdfjsLib.getDocument({ data: buf.slice(0) }).promise; await svc.makeCover(d2, nv); } catch (e) {}
      const mb = buf.byteLength / 1048576;
      if (activeRoom && mb <= 45) { const { uploadRoomBlob } = await import("../core/store.js"); uploadRoomBlob(nid, new Blob([buf], { type: "application/pdf" }), "pdf"); }
      else if (activeRoom) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([buf], { type: "application/pdf" })); a.download = nm + ".pdf"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 8000); toast("Il PDF tradotto pesa " + Math.round(mb) + " MB, troppo per il server: l'ho scaricato."); }
      svc.setCollTab && svc.setCollTab("tr");
      save();
      $("trBar").style.width = "100%";
      $("trInfo").textContent = partial ? ("Salvata una traduzione parziale" + (err ? ": " + err : "") + ".") : "Traduzione completata.";
      setTimeout(() => $("trModal").classList.remove("open"), partial ? 1800 : 900);
    } catch (e) { $("trInfo").textContent = "Salvataggio non riuscito: " + (e.message || "memoria piena"); $("trGo").style.display = "inline-flex"; $("trStop").style.display = "none"; }
  } else { $("trInfo").textContent = err || "Interrotto."; $("trGo").style.display = "inline-flex"; $("trStop").style.display = "none"; }
}

async function volumeBlocks(v, onProgress, isCancelled) {
  if (v.type === "pdf" && v.pdf) return svc.getPdfBlocks(v, onProgress, isCancelled);
  return svc.textToBlocks(v.text);
}

/* ---- trPage / trParagraphs (traduzione dentro il PDF) ---- */
async function trPage(key, paras, lang) {
  tr.abort = false;
  const texts = paras.map(q => q.t);
  let out = null, prov = settings.trProvider;
  if (prov === "google" && !tr.useBt) {
    const waits = [0, 4000, 15000, 40000];
    for (let a = 0; a < waits.length && !out; a++) {
      if (tr.abort) throw new Error("Interrotto");
      if (waits[a]) { $("trInfo").textContent = "Il servizio gratuito è sovraccarico, riprovo tra " + (waits[a] / 1000) + " s…"; await sleep(waits[a]); }
      try { const o = await gtMulti(texts, lang); if (o.length === texts.length) out = o; }
      catch (e) { if (a === 1 && "Translator" in self) { tr.useBt = true; toast("Servizio web saturo: passo al traduttore del browser."); break; } }
    }
    if (out) { await sleep(250 + Math.random() * 350); return out; }
  }
  if (prov === "browser" || tr.useBt || prov === "google") { out = []; for (let i = 0; i < texts.length; i++) { if (tr.abort) throw new Error("Interrotto"); out.push(await translateRetry(texts[i], lang)); } return out; }
  if (prov === "ai") return await aiTranslateList(texts, lang, () => tr.abort);
  const joined = await translateRetry(texts.join("\n\n"), lang);
  out = joined.split(/\n{2,}/);
  if (out.length !== texts.length) { out = []; for (let k = 0; k < texts.length; k++) out.push(await translateRetry(texts[k], lang)); }
  return out;
}

function trParagraphs(tc, vp) {
  const sc = vp.scale, lines = [];
  tc.items.forEach(it => {
    if (!it.str || !it.str.trim()) return;
    const m = window.pdfjsLib.Util.transform(vp.transform, it.transform), fs = Math.hypot(m[2], m[3]); if (!fs) return;
    const x = m[4], y = m[5], w = (it.width || 0) * sc;
    let L = null;
    for (let i = 0; i < lines.length; i++) { const l = lines[i]; if (Math.abs(l.y - y) < fs * 0.4 && x >= l.x0 - fs * 3 && x <= l.x1 + fs * 3) { L = l; break; } }
    if (!L) { L = { y, x0: x, x1: x + w, fs, it: [] }; lines.push(L); }
    L.it.push({ x, w, s: it.str }); L.x0 = Math.min(L.x0, x); L.x1 = Math.max(L.x1, x + w); L.fs = Math.max(L.fs, fs);
  });
  lines.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  lines.forEach(l => { l.it.sort((a, b) => a.x - b.x); let tx = ""; l.it.forEach((q, i) => { const pv = l.it[i - 1]; if (pv && q.x - (pv.x + pv.w) > l.fs * 0.12 && !/\s$/.test(tx) && !/^\s/.test(q.s)) tx += " "; tx += q.s; }); l.t = tx.replace(/\s+/g, " ").trim(); });
  const ps = [];
  lines.forEach(l => {
    let P = null;
    for (let i = ps.length - 1; i >= 0 && i > ps.length - 6; i--) { const q = ps[i]; if (l.y > q.y && l.y - q.y < q.fs * 1.8 && Math.abs(l.x0 - q.x0) < q.fs * 4 && l.x0 < q.x1 && l.x1 > q.x0) { P = q; break; } }
    if (P) { P.t += " " + l.t; P.y = l.y; P.x1 = Math.max(P.x1, l.x1); P.x0 = Math.min(P.x0, l.x0); }
    else ps.push({ x0: l.x0, x1: l.x1, y0: l.y, y: l.y, fs: l.fs, t: l.t });
  });
  return ps.filter(q => q.t.length > 1).map(q => ({ x: q.x0 / sc, y: (q.y0 - q.fs) / sc, w: (q.x1 - q.x0) / sc, h: (q.y - q.y0 + q.fs * 1.25) / sc, fs: q.fs / sc, t: q.t }));
}

function trGo() {
  const v = tr.v; if (!v || tr.busy) return;
  const target = $("trLang").value;
  settings.trTarget = target; saveSettings();
  if (v.type === "pdf" && v.pdf) return runPdfTranslation(v, target);
  tr.busy = true; tr.abort = false;
  $("trGo").style.display = "none"; $("trStop").style.display = "inline-flex"; $("trBar").style.width = "0%";
  const out = []; let ok = false, errMsg = "";
  (async () => {
    try {
      $("trInfo").textContent = "Preparo il testo…";
      const blocks = await volumeBlocks(v, (i, n) => { $("trInfo").textContent = "Estraggo il testo dal PDF… pagina " + i + "/" + n; }, () => tr.abort);
      if (!blocks.length) throw new Error("Nessun testo trovato" + (v.type === "pdf" ? " (il PDF potrebbe essere una scansione senza testo)" : "") + ".");
      const chunks = chunkBlocks(blocks, settings.trProvider === "ai" ? 6000 : 3200);
      const translated = new Array(chunks.length); let nextChunk = 0, done = 0;
      const workerCount = Math.min(3, chunks.length);
      async function trWorker() {
        while (!tr.abort) {
          const i = nextChunk++; if (i >= chunks.length) return;
          const c = chunks[i];
          $("trInfo").textContent = "Traduco… " + Math.min(done + 1, chunks.length) + "/" + chunks.length;
          translated[i] = await translateRetry(c.items.join("\n\n"), target);
          done++; $("trBar").style.width = Math.round(done / chunks.length * 100) + "%";
          if (settings.trProvider !== "ai") await sleep(settings.trProvider === "libre" ? 60 : 120);
        }
      }
      await Promise.all(Array.from({ length: workerCount }, () => trWorker()));
      if (!tr.abort) translated.forEach((t, i) => { const c = chunks[i]; if (c.mark) out.push("— p. " + c.pg + " —"); out.push(t.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim()); });
      ok = !tr.abort;
    } catch (e) { errMsg = e.message || "Errore"; }
    tr.busy = false;
    if (out.length) {
      const partial = !ok;
      const nv = { id: uid(), name: (v.name || "Volume") + " [" + target.toUpperCase() + "]" + (partial ? " (parziale)" : ""), text: out.join("\n\n"), type: "text", pdf: null, folderId: null, tr: true, lang: target, srcId: v.id };
      state.volumes.push(nv);
      svc.setCollTab && svc.setCollTab("tr");
      save();
      $("trBar").style.width = "100%";
      $("trInfo").textContent = partial ? ("Salvata una traduzione parziale" + (errMsg ? ": " + errMsg : "") + ".") : "Traduzione completata.";
      toast(partial ? "Traduzione parziale salvata in «Tradotti»" : "Traduzione salvata in «Tradotti»");
      setTimeout(() => $("trModal").classList.remove("open"), partial ? 1800 : 900);
    } else { $("trInfo").textContent = errMsg || "Interrotto."; $("trGo").style.display = "inline-flex"; $("trStop").style.display = "none"; }
  })();
}

export function initTranslate() {
  $("trClose").onclick = closeTranslate;
  $("trCancel").onclick = closeTranslate;
  $("trStop").onclick = () => { tr.abort = true; $("trInfo").textContent = "Interrompo…"; };
  $("trSettings").onclick = () => { svc.openSettings && svc.openSettings(); };
  $("trGo").onclick = trGo;

  // ===== Command palette actions for translate module =====
  registerAction("Traduzione", "Traduci volume", "Ctrl+T", () => { svc.openTranslate && svc.openTranslate(); });
}

svc.openTranslate = openTranslate;
svc.closeTranslate = closeTranslate;
svc.textToBlocks = function (text) {
  const blocks = []; let pg = null;
  const PG_MARK = /^—\s*p\.\s*(\d+)\s*—$/;
  String(text || "").split(/\n{2,}|\r\n\r\n/).forEach(par => {
    const t = par.replace(/\s*\n\s*/g, " ").trim(); if (!t) return;
    const m = t.match(PG_MARK); if (m) { pg = +m[1]; return; }
    blocks.push({ pg, text: t });
  });
  return blocks;
};
