// epub.js — supporto EPUB: parsing (JSZip), caricamento volumi, lettore a capitoli, blocchi per TTS/traduzione
import { state, save, idbPut, idbGet, storeBlob, mediaUrls, activeRoom, uploadRoomBlob, downloadRoomBlob } from "../core/store.js";
import { uid, toast, escapeHtml } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { svc } from "../core/svc.js";
import { registerAction } from "../ui/commandPalette.js";

const $ = (id) => document.getElementById(id);

/* ================= PARSING ================= */
function loadJSZip() {
  if (window.JSZip) return Promise.resolve(window.JSZip);
  return Promise.reject(new Error("JSZip non caricato (serve la connessione per il CDN)."));
}

function resolvePath(base, href) {
  const parts = (base + href).split("/");
  const out = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

function dirname(p) {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i + 1);
}

export async function parseEpub(blob) {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(blob);
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) throw new Error("Non è un EPUB valido (manca container.xml).");
  const containerXml = await containerFile.async("text");
  const cDoc = new DOMParser().parseFromString(containerXml, "application/xml");
  const rootfile = cDoc.querySelector("rootfile");
  const opfPath = rootfile && rootfile.getAttribute("full-path");
  if (!opfPath) throw new Error("EPUB non valido (rootfile mancante).");
  const opfFile = zip.file(opfPath);
  if (!opfFile) throw new Error("EPUB non valido (OPF mancante).");
  const opfDoc = new DOMParser().parseFromString(await opfFile.async("text"), "application/xml");
  const base = dirname(opfPath);

  const title = (opfDoc.querySelector("metadata > title, metadata > *|title") || {}).textContent || "";
  const author = (opfDoc.querySelector("metadata > creator, metadata > *|creator") || {}).textContent || "";
  const lang = (opfDoc.querySelector("metadata > language, metadata > *|language") || {}).textContent || "";

  const manifest = {};
  opfDoc.querySelectorAll("manifest > item, manifest > *|item").forEach(it => {
    manifest[it.getAttribute("id")] = {
      href: it.getAttribute("href"),
      type: it.getAttribute("media-type") || "",
      props: it.getAttribute("properties") || ""
    };
  });

  const chapters = [];
  opfDoc.querySelectorAll("spine > itemref, spine > *|itemref").forEach(ref => {
    if (ref.getAttribute("linear") === "no") return;
    const it = manifest[ref.getAttribute("idref")];
    if (!it || !/xhtml|html/i.test(it.type)) return;
    chapters.push({ href: resolvePath(base, it.href), title: "" });
  });
  if (!chapters.length) {
    // fallback: tutti i documenti html del manifest
    Object.keys(manifest).forEach(id => {
      const it = manifest[id];
      if (/xhtml|html/i.test(it.type)) chapters.push({ href: resolvePath(base, it.href), title: "" });
    });
  }

  // copertina: properties="cover-image" oppure <meta name="cover" content="id">
  let coverPath = null, coverType = null;
  for (const id in manifest) {
    const it = manifest[id];
    if (it.props.split(/\s+/).indexOf("cover-image") >= 0 && /^image\//.test(it.type)) { coverPath = resolvePath(base, it.href); coverType = it.type; break; }
  }
  if (!coverPath) {
    const meta = opfDoc.querySelector('metadata > meta[name="cover"], metadata > *|meta[name="cover"]');
    const cid = meta && meta.getAttribute("content");
    if (cid && manifest[cid] && /^image\//.test(manifest[cid].type)) { coverPath = resolvePath(base, manifest[cid].href); coverType = manifest[cid].type; }
  }
  if (!coverPath) {
    for (const id in manifest) {
      const it = manifest[id];
      if (/^image\//.test(it.type) && /cover/i.test(it.href)) { coverPath = resolvePath(base, it.href); coverType = it.type; break; }
    }
  }
  let coverBlob = null;
  if (coverPath && zip.file(coverPath)) {
    coverBlob = await zip.file(coverPath).async("blob");
    coverBlob = new Blob([coverBlob], { type: coverType || "image/jpeg" });
  }

  return { zip, title: title.trim(), author: author.trim(), lang: (lang || "").trim(), chapters, coverBlob, manifest, base };
}

/* titoli capitoli: prima intestazione del documento, altrimenti nome file */
async function chapterTitle(book, ch, idx) {
  if (ch.title) return ch.title;
  try {
    const f = book.zip.file(ch.href);
    if (!f) return "Capitolo " + (idx + 1);
    const doc = new DOMParser().parseFromString(await f.async("text"), "application/xhtml+xml");
    const h = doc.querySelector("h1,h2,h3,title");
    ch.title = (h && h.textContent.trim().slice(0, 90)) || "Capitolo " + (idx + 1);
  } catch (e) { ch.title = "Capitolo " + (idx + 1); }
  return ch.title;
}

/* ================= STORAGE VOLUME ================= */
async function getEpubBlob(v) {
  const rec = await idbGet("epubs", v.id);
  if (rec && rec.blob) return rec.blob;
  const remote = await downloadRoomBlob(v.id, "epub", "application/epub+zip");
  if (remote) { await idbPut("epubs", v.id, { blob: remote, name: v.epub && v.epub.name }); return remote; }
  return null;
}

export async function loadEpubFile(vid, file) {
  const v = state.volumes.find(x => x.id === vid);
  if (!v) return;
  let book;
  try {
    book = await parseEpub(file);
  } catch (e) {
    toast("EPUB non leggibile: " + (e.message || "errore"));
    return;
  }
  if (!book.chapters.length) { toast("Questo EPUB non contiene capitoli leggibili."); return; }
  await idbPut("epubs", vid, { blob: file, name: file.name });
  v.type = "epub";
  v.epub = { name: file.name, chapters: book.chapters.length, title: book.title, author: book.author };
  if (book.lang) v.lang0 = book.lang;
  if (!v.name || v.name === "Nuovo volume" || v.name === "File") v.name = (book.title || file.name.replace(/\.[^.]+$/, "")).slice(0, 90);
  if (book.coverBlob && !v.coverId) {
    const id = await storeBlob(book.coverBlob);
    mediaUrls[id] = URL.createObjectURL(book.coverBlob);
    v.coverId = id;
  }
  if (activeRoom) uploadRoomBlob(vid, file, "epub");
  save();
  svc.renderCollection && svc.renderCollection();
  toast("EPUB caricato: " + book.chapters.length + " capitoli");
}

/* ================= BLOCCHI (lettura TTS / traduzione) ================= */
function chapterText(doc) {
  const out = [];
  doc.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,blockquote").forEach(el => {
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  });
  if (!out.length) {
    const t = (doc.body ? doc.body.textContent : "").replace(/\s+/g, " ").trim();
    if (t) out.push(t);
  }
  return out;
}

export async function getEpubBlocks(v, onProgress, isCancelled) {
  const blob = await getEpubBlob(v);
  if (!blob) throw new Error("File EPUB non trovato su questo dispositivo" + (activeRoom ? " né sul server." : "."));
  const book = await parseEpub(blob);
  const blocks = [];
  for (let i = 0; i < book.chapters.length; i++) {
    if (isCancelled && isCancelled()) return blocks;
    if (onProgress) onProgress(i + 1, book.chapters.length);
    const ch = book.chapters[i];
    const f = book.zip.file(ch.href);
    if (!f) continue;
    try {
      const doc = new DOMParser().parseFromString(await f.async("text"), "application/xhtml+xml");
      const title = await chapterTitle(book, ch, i);
      const paras = chapterText(doc);
      paras.forEach((t, k) => blocks.push({ hd: k === 0 ? title : null, text: t }));
    } catch (e) {}
  }
  return blocks;
}

/* ================= LETTORE EPUB (viewer a capitoli) ================= */
const eb = { book: null, vol: null, i: 0, imgUrls: [] };

function ebCleanup() {
  eb.imgUrls.forEach(u => { try { URL.revokeObjectURL(u); } catch (e) {} });
  eb.imgUrls = [];
}

async function ebRenderChapter(i) {
  const book = eb.book;
  if (!book) return;
  eb.i = Math.max(0, Math.min(book.chapters.length - 1, i));
  const ch = book.chapters[eb.i];
  const host = $("ebContent");
  host.innerHTML = '<div class="hint" style="padding:30px">Carico il capitolo…</div>';
  const sel = $("ebChapters");
  if (sel && sel.value !== String(eb.i)) sel.value = String(eb.i);
  $("ebPos").textContent = (eb.i + 1) + " / " + book.chapters.length;

  const f = book.zip.file(ch.href);
  if (!f) { host.innerHTML = '<div class="empty">Capitolo mancante nel file.</div>'; return; }
  let doc;
  try {
    doc = new DOMParser().parseFromString(await f.async("text"), "application/xhtml+xml");
  } catch (e) {
    host.innerHTML = '<div class="empty">Capitolo non leggibile.</div>'; return;
  }

  // sanifica: niente script/style/inline handler
  doc.querySelectorAll("script,style,link,iframe,form,input,button,select,textarea,audio,video,svg").forEach(el => el.remove());
  const walk = doc.body ? [doc.body, ...doc.body.querySelectorAll("*")] : [];
  walk.forEach(el => {
    [...el.attributes].forEach(a => {
      const n = a.name.toLowerCase();
      if (n.startsWith("on") || n === "style" || n === "srcset") el.removeAttribute(a.name);
      if ((n === "href" || n === "xlink:href") && /^\s*javascript:/i.test(a.value)) el.removeAttribute(a.name);
    });
  });

  // immagini: blob URL dal pacchetto
  const imgs = doc.querySelectorAll("img");
  for (const img of imgs) {
    const src = img.getAttribute("src");
    if (!src || /^data:|^https?:/i.test(src)) continue;
    const path = resolvePath(dirname(ch.href), decodeURIComponent(src.split("#")[0]));
    const zf = book.zip.file(path);
    if (zf) {
      const ext = (path.split(".").pop() || "").toLowerCase();
      const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" }[ext] || "image/jpeg";
      try {
        const b = new Blob([await zf.async("blob")], { type: mime });
        const u = URL.createObjectURL(b);
        eb.imgUrls.push(u);
        img.src = u;
      } catch (e) { img.remove(); }
    } else img.remove();
  }

  const title = await chapterTitle(book, ch, eb.i);
  host.innerHTML = '<h2 class="eb-h">' + escapeHtml(title) + "</h2>" + (doc.body ? doc.body.innerHTML : "");
  host.scrollTop = 0;
}

function ebSelectedText() {
  const s = window.getSelection();
  if (!s || s.isCollapsed || !s.rangeCount) return "";
  const host = $("ebContent");
  if (!host.contains(s.getRangeAt(0).commonAncestorContainer)) return "";
  return s.toString().replace(/\s+/g, " ").trim();
}

async function ebNodeFromChapter() {
  const v = eb.vol, book = eb.book;
  if (!v || !book) return;
  let text = ebSelectedText();
  let label = "selezione";
  if (!text) {
    const ch = book.chapters[eb.i];
    const f = book.zip.file(ch.href);
    const doc = new DOMParser().parseFromString(await f.async("text"), "application/xhtml+xml");
    text = chapterText(doc).join("\n\n");
    label = "capitolo";
  }
  if (!text) { toast("Nessun testo in questo capitolo."); return; }
  const title = await chapterTitle(book, book.chapters[eb.i], eb.i);
  const c = svc.viewCenter ? svc.viewCenter() : { x: 400, y: 300 };
  svc.addNode({
    x: Math.round(c.x - 115), y: Math.round(c.y - 90),
    title: (v.name || "EPUB") + " — " + title,
    body: escapeHtml(text.slice(0, 4000)).replace(/\n/g, "<br>"),
    source: { type: "epub", volumeId: v.id, volumeName: v.name, chapter: eb.i, chapterTitle: title, label: label }
  });
  closeEpubReader();
  svc.switchView && svc.switchView("map");
  toast("Nodo creato dal " + label);
}

export async function openEpubReader(vid, chapterIdx) {
  const v = state.volumes.find(x => x.id === vid);
  if (!v || v.type !== "epub") return;
  $("epubModal").classList.add("open");
  $("ebTitle").textContent = v.name || "EPUB";
  $("ebContent").innerHTML = '<div class="hint" style="padding:30px">Apro il libro…</div>';
  $("ebChapters").innerHTML = "";
  $("ebPos").textContent = "";
  ebCleanup(); eb.book = null; eb.vol = v;
  try {
    const blob = await getEpubBlob(v);
    if (!blob) throw new Error("File EPUB non trovato su questo dispositivo" + (activeRoom ? " né sul server." : "."));
    const book = await parseEpub(blob);
    eb.book = book;
    const sel = $("ebChapters");
    for (let i = 0; i < book.chapters.length; i++) {
      const t = await chapterTitle(book, book.chapters[i], i);
      const o = document.createElement("option");
      o.value = String(i); o.textContent = t;
      sel.appendChild(o);
    }
    await ebRenderChapter(typeof chapterIdx === "number" ? chapterIdx : 0);
  } catch (e) {
    $("ebContent").innerHTML = '<div class="empty">' + escapeHtml(e.message || "Errore") + "</div>";
  }
}

export function closeEpubReader() {
  $("epubModal").classList.remove("open");
  ebCleanup(); eb.book = null; eb.vol = null;
}

export function initEpub() {
  $("ebClose").onclick = closeEpubReader;
  $("ebPrev").onclick = () => ebRenderChapter(eb.i - 1);
  $("ebNext").onclick = () => ebRenderChapter(eb.i + 1);
  $("ebChapters").addEventListener("change", function () { ebRenderChapter(parseInt(this.value, 10) || 0); });
  $("ebRead").onclick = () => {
    if (!eb.vol) return;
    const vid = eb.vol.id, ch = eb.i;
    closeEpubReader();
    svc.openReader && svc.openReader(vid, null, ch);
  };
  $("ebNode").onclick = ebNodeFromChapter;
  $("ebCover").onclick = async () => {
    if (!eb.book || !eb.vol) return;
    if (!eb.book.coverBlob) { toast("Questo EPUB non ha una copertina interna. Puoi caricarne una dalla Raccolta."); return; }
    const id = await storeBlob(eb.book.coverBlob);
    mediaUrls[id] = URL.createObjectURL(eb.book.coverBlob);
    eb.vol.coverId = id;
    save(); svc.renderCollection && svc.renderCollection();
    toast("Copertina importata dal libro");
  };
  $("epubModal").addEventListener("click", (e) => { if (e.target === $("epubModal")) closeEpubReader(); });
  document.addEventListener("keydown", (e) => {
    if (!$("epubModal").classList.contains("open")) return;
    if (e.key === "Escape") closeEpubReader();
    else if (e.key === "ArrowRight" && !e.target.closest("select,input,textarea")) ebRenderChapter(eb.i + 1);
    else if (e.key === "ArrowLeft" && !e.target.closest("select,input,textarea")) ebRenderChapter(eb.i - 1);
  });

  registerAction("Raccolta", "Apri EPUB", "", () => {
    const v = state.volumes.find(x => x.type === "epub");
    if (v) openEpubReader(v.id); else toast("Nessun EPUB nella Raccolta.");
  });
}

svc.loadEpubFile = loadEpubFile;
svc.getEpubBlocks = getEpubBlocks;
svc.openEpubReader = openEpubReader;
