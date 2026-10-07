// collection.js — Raccolta completa con Carica file (nessun import circolare)
import { state, save, storeBlob, idbDel, activeRoom, mediaUrls } from "../core/store.js";
import { uid, toast, escapeHtml, promptModal, confirmModal } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { svc } from "../core/svc.js";
import { registerAction } from "../ui/commandPalette.js";

const $ = (id) => document.getElementById(id);
let container = null, mode = "main", searchQuery = "";

export function setCollTab(t) { mode = t; renderList(); }

export function mount(hostId) {
  container = document.getElementById(hostId);
  renderCollection();
}

export function renderCollection() {
  if (!container) return;
  const isFull = container.id === "collectionHostFull";
  container.innerHTML = `
    <div class="coll-head">
      ${isFull ? '<button class="ico" id="collBackBtn" title="Indietro">-</button>' : ''}
      <h2>${isFull ? "Raccolta" : ""}</h2>
      <button class="ico" id="collapseAllBtn" title="Espandi/comprimi tutte le cartelle">${icon("fold", 16)}</button>
      <button class="ico" id="addFolderBtn" title="Nuova cartella">${icon("plus", 16)}</button>
      <button class="ico" id="addVolumeBtn" title="Nuovo volume">${icon("book", 16)}</button>
    </div>
    <div class="coll-tabs">
      <button id="ctMain" class="${mode==="main"?"on":""}">Raccolta</button>
      <button id="ctTr" class="${mode==="tr"?"on":""}">Tradotti</button>
    </div>
    <div class="coll-search">
      <span>⌕</span>
      <input type="text" id="collSearch" placeholder="Cerca nei titoli, testi, PDF…" spellcheck="false">
      <span id="collSearchClear" style="display:none">✕</span>
    </div>
    <div id="collection"></div>
  `;
  bindEvents();
  renderList();
}

function bindEvents() {
  const cb = document.getElementById("collapseAllBtn");
  if (cb) cb.onclick = () => {
    const folders = [...container.querySelectorAll(".folder")];
    if (!folders.length) { toast("Nessuna cartella: creane una con il pulsante +."); return; }
    const anyClosed = folders.some(el => !el.classList.contains("open"));
    folders.forEach(el => el.classList.toggle("open", anyClosed));
    state.folders.forEach(f => { f.open = anyClosed; });
    save();
  };
  const af = document.getElementById("addFolderBtn");
  if (af) af.onclick = async () => { const n = await promptModal("Nuova cartella", "Nome cartella"); if (n?.trim()) { state.folders.push({id: uid(), name: n.trim().slice(0, 48)}); save(); renderList(); } };
  const av = document.getElementById("addVolumeBtn");
  if (av) av.onclick = () => { state.volumes.push({id: uid(), name: "Nuovo volume", type: "text", text: ""}); save(); renderList(); };
  const ctMain = document.getElementById("ctMain");
  if (ctMain) ctMain.onclick = () => setCollTab("main");
  const ctTr = document.getElementById("ctTr");
  if (ctTr) ctTr.onclick = () => setCollTab("tr");
  const cs = document.getElementById("collSearch");
  if (cs) cs.addEventListener("input", (e) => { searchQuery = e.target.value.trim(); const cl = document.getElementById("collSearchClear"); if (cl) cl.style.display = searchQuery ? "" : "none"; renderList(); });
  const ccl = document.getElementById("collSearchClear");
  if (ccl) ccl.onclick = () => { const s = document.getElementById("collSearch"); if (s) s.value = ""; searchQuery = ""; ccl.style.display = "none"; renderList(); };
  const cbb = document.getElementById("collBackBtn");
  if (cbb) cbb.onclick = () => { if (window.location.hash.startsWith("#/map")) window.location.hash = "#/map"; };
  // drop sulla lista: file dal desktop -> nuovo volume; volume trascinato fuori dalle cartelle -> folderId null
  const list = document.getElementById("collection");
  if (list) {
    list.addEventListener("dragover", (e) => e.preventDefault());
    list.addEventListener("drop", (e) => {
      const vid = e.dataTransfer.getData("text/spazio-volume");
      if (vid) {
        const v = state.volumes.find(x => x.id === vid);
        if (v && v.folderId) { v.folderId = null; save(); renderCollection(); toast("Rimosso dalla cartella"); }
        return;
      }
      e.preventDefault();
      const f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleFileSelect(f);
    });
  }
}

function matchesVolume(v) {
  if (mode === "tr" && !(v.tr || v.lang)) return false;
  if (!searchQuery) return true;
  const q = searchQuery.toLowerCase();
  return (v.name || "").toLowerCase().includes(q) || (v.text || "").toLowerCase().includes(q) || (v.pdf?.name || "").toLowerCase().includes(q) || (v.epub?.name || "").toLowerCase().includes(q);
}

function renderList() {
  const r = document.getElementById("collection");
  if (!r) return;
  r.innerHTML = "";
  if (mode === "tr") {
    state.volumes.filter(v => v.tr || v.lang).forEach(v => renderVolume(v));
    if (!r.children.length) r.innerHTML = '<div class="coll-empty">Nessun volume tradotto ancora.<br>Usa l\'azione «Traduci» su un volume.</div>';
    return;
  }
  state.folders.forEach(f => renderFolder(f, 0));
  state.volumes.filter(v => !v.folderId).forEach(v => { if (matchesVolume(v)) renderVolume(v); });
  if (!r.children.length) {
    r.innerHTML = '<div class="coll-empty">' + (searchQuery ? "Nessun risultato per «" + escapeHtml(searchQuery) + "»." : "La raccolta è vuota.<br>Crea un volume, una cartella, oppure trascina qui un file (testo, PDF, EPUB, immagini…).") + "</div>";
  }
}

function renderFolder(f, depth) {
  const el = document.createElement("div");
  const children = state.volumes.filter(v => v.folderId === f.id);
  // durante la ricerca le cartelle con risultati si aprono da sole
  const open = searchQuery ? children.some(v => matchesVolume(v)) : f.open !== false;
  el.className = "folder" + (open ? " open" : "");
  el.style.paddingLeft = (depth + 1) * 14 + "px";
  el.innerHTML = `<div class="folder-head"><span class="tri">${icon("chevron", 11)}</span><span class="folder-ico">${icon(open ? "folderOpen" : "folder", 14)}</span><input class="fname" value="${escapeHtml(f.name)}"><span class="folder-count">${children.length || ""}</span><button class="ico folder-del" title="Elimina cartella">${icon("trash", 12)}</button></div><div class="folder-body"></div>`;
  const head = el.querySelector(".folder-head"), body = el.querySelector(".folder-body");
  children.forEach(v => { const r = renderVolume(v, true); if (r) body.appendChild(r); });
  head.querySelector(".fname").addEventListener("input", (e) => { f.name = e.target.value; save(); });
  head.querySelector(".folder-del").onclick = (e) => { e.stopPropagation(); deleteFolder(f.id); };
  head.addEventListener("click", (e) => {
    if (e.target.tagName === "INPUT" || e.target.closest(".folder-del")) return;
    el.classList.toggle("open");
    f.open = el.classList.contains("open");
    head.querySelector(".folder-ico").innerHTML = icon(f.open ? "folderOpen" : "folder", 14);
    save();
  });
  // drop target: trascina volumi nella cartella
  ["dragover", "dragenter"].forEach(ev => el.addEventListener(ev, (e) => {
    if (![...e.dataTransfer.types].includes("text/spazio-volume")) return;
    e.preventDefault(); e.stopPropagation(); el.classList.add("drop-target");
  }));
  el.addEventListener("dragleave", () => el.classList.remove("drop-target"));
  el.addEventListener("drop", (e) => {
    const vid = e.dataTransfer.getData("text/spazio-volume");
    el.classList.remove("drop-target");
    if (!vid) return;
    e.preventDefault(); e.stopPropagation();
    const v = state.volumes.find(x => x.id === vid);
    if (v && v.folderId !== f.id) { v.folderId = f.id; save(); renderCollection(); toast("Spostato in «" + f.name + "»"); }
  });
  document.getElementById("collection").appendChild(el);
}

function typeChip(v) {
  if (v.type === "pdf") return '<span class="pdf-chip">PDF</span>';
  if (v.type === "epub") return '<span class="pdf-chip epub-chip">EPUB</span>';
  return "";
}

function renderVolume(v, inline) {
  if (!matchesVolume(v)) return null;
  const el = document.createElement("div");
  el.className = "volume" + (v.coverId ? " has-cover" : "");
  el.draggable = true;
  el.dataset.vid = v.id;
  const isFile = v.type === "pdf" || v.type === "epub";
  const coverHTML = v.coverId
    ? `<img src="${mediaUrls[v.coverId] || ''}" data-media-id="${v.coverId}" alt="Copertina"><span class="cov-plus" title="Cambia copertina">${icon("cover", 11)} Cambia</span>`
    : `<div class="cover-placeholder" title="Aggiungi una copertina">${icon("cover", 14)}<span>Copertina</span></div>`;
  const btns = `<button class="ctl mini" data-action="open" title="Apri">${icon("open", 12)}</button><button class="ctl mini" data-action="read" title="Leggi ad alta voce">${icon("speak", 12)}</button><button class="ctl mini" data-action="translate" title="Traduci">${icon("translate", 12)}</button>`;
  el.innerHTML = `<div class="volume-cover ${v.coverId ? 'has' : ''}">${coverHTML}</div>
    <div class="volume-head"><input class="volume-name" value="${escapeHtml(v.name || 'Volume')}"></div>
    <div class="volume-btns">${typeChip(v)}${btns}
    <button class="ctl mini" data-action="cover" title="Cambia copertina">${icon("cover", 12)}</button><button class="ctl mini" data-action="upload" title="Carica un file in questo volume">${icon("upload", 12)}</button><button class="ctl mini" data-action="del" title="Elimina">${icon("trash", 12)}</button></div>
    ${isFile ? `<div class="volume-text-placeholder">${escapeHtml((v.pdf && v.pdf.name) || (v.epub && v.epub.name) || v.type.toUpperCase())}</div>` : `<div class="volume-text" contenteditable="true">${escapeHtml(v.text || '')}</div>`}`;
  el.querySelector(".volume-name").addEventListener("input", (e) => { v.name = e.target.value; save(); });
  const vt = el.querySelector(".volume-text");
  if (vt) vt.addEventListener("input", () => { v.text = vt.innerText; save(); });
  const cov = el.querySelector(".volume-cover");
  cov.addEventListener("click", (e) => { e.stopPropagation(); requestCover(v.id); });
  cov.addEventListener("contextmenu", (e) => {
    e.preventDefault(); e.stopPropagation();
    const items = [{ l: "Cambia copertina…", icon: "cover", fn: () => requestCover(v.id) }];
    if (v.coverId) items.push({ l: "Rimuovi copertina", icon: "trash", danger: true, fn: () => removeCover(v) });
    svc.showMenu(items, e.clientX, e.clientY);
  });
  el.querySelectorAll("[data-action]").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const a = btn.dataset.action;
      if (a === "open") focusVolume(v.id);
      else if (a === "read") svc.openReader && svc.openReader(v.id);
      else if (a === "translate") svc.openTranslate && svc.openTranslate(v.id);
      else if (a === "cover") requestCover(v.id);
      else if (a === "upload") { svc.pendingVolumeId = v.id; document.getElementById("uploadFile").click(); }
      else if (a === "del") deleteVolume(v.id);
    };
  });
  // doppio clic: apri/leggi il volume
  el.addEventListener("dblclick", (e) => {
    if (e.target.closest("button") || e.target.closest("input") || e.target.closest(".volume-text")) return;
    focusVolume(v.id);
  });
  // drag & drop verso le cartelle (o fuori per toglierlo dalla cartella)
  el.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("text/spazio-volume", v.id);
    e.dataTransfer.effectAllowed = "move";
  });
  if (!inline) document.getElementById("collection").appendChild(el);
  return el;
}

export function addVolume(folderId) {
  const v = { id: uid(), name: "Nuovo volume", type: "text", text: "", folderId: folderId || null };
  state.volumes.push(v); save(); renderCollection(); return v;
}
export async function deleteVolume(id) {
  if (!(await confirmModal("Eliminare questo volume?"))) return;
  state.volumes = state.volumes.filter(v => v.id !== id); save(); renderCollection();
}
export function focusVolume(id) {
  const v = state.volumes.find(x => x.id === id);
  if (!v) return;
  if (v.type === "pdf" && v.pdf) svc.openPdfViewer && svc.openPdfViewer(id);
  else if (v.type === "epub" && v.epub) svc.openEpubReader && svc.openEpubReader(id);
  else svc.openReader && svc.openReader(id);
}

/* ---- copertine ---- */
export function requestCover(vid) {
  svc.pendingCoverId = vid;
  const inp = document.getElementById("coverFile");
  if (inp) inp.click();
}
export async function removeCover(v) {
  if (!v.coverId) return;
  const old = v.coverId;
  v.coverId = null;
  if (mediaUrls[old]) { try { URL.revokeObjectURL(mediaUrls[old]); } catch (e) {} delete mediaUrls[old]; }
  try { await idbDel("blobs", old); } catch (e) {}
  save(); renderCollection(); toast("Copertina rimossa");
}
function applyCoverFile(vid, f) {
  if (!/^image\//i.test(f.type)) { toast("La copertina deve essere un'immagine."); return; }
  const v = state.volumes.find(x => x.id === vid);
  if (!v) return;
  storeBlob(f).then(id => {
    const old = v.coverId;
    mediaUrls[id] = URL.createObjectURL(f);
    v.coverId = id;
    if (old && old !== id) { try { idbDel("blobs", old); } catch (e) {} if (mediaUrls[old]) { try { URL.revokeObjectURL(mediaUrls[old]); } catch (e) {} delete mediaUrls[old]; } }
    save(); renderCollection(); toast("Copertina aggiornata");
  });
}
export async function addFolder() {
  const n = await promptModal("Nuova cartella", "Nome cartella");
  if (!n?.trim()) return;
  state.folders.push({ id: uid(), name: n.trim().slice(0, 48) });
  save(); renderCollection();
}
export async function deleteFolder(id) {
  if (!(await confirmModal("Eliminare questa cartella e i suoi volumi?"))) return;
  const volIds = state.volumes.filter(v => v.folderId === id).map(v => v.id);
  state.volumes = state.volumes.filter(v => v.folderId !== id && !volIds.includes(v.id));
  state.folders = state.folders.filter(f => f.id !== id); save(); renderCollection();
}

export function initCollection() {
  const uploadFile = document.getElementById("uploadFile");
  if (uploadFile) {
    uploadFile.addEventListener("change", (e) => {
      const f = e.target.files[0]; if (!f) return; handleFileSelect(f); e.target.value = "";
    });
  }
  const coverFile = document.getElementById("coverFile");
  if (coverFile) {
    coverFile.addEventListener("change", (e) => {
      const f = e.target.files[0]; e.target.value = "";
      if (!f) return;
      const vid = svc.pendingCoverId; svc.pendingCoverId = null;
      if (vid) applyCoverFile(vid, f);
    });
  }

  // ===== Command palette actions for collection module =====
  registerAction("Raccolta", "Nuovo volume", "Ctrl+Shift+N", () => addVolume());
  registerAction("Raccolta", "Nuova cartella", "Ctrl+Shift+F", () => addFolder());
  registerAction("Raccolta", "Carica file", "", () => { document.getElementById("uploadFile")?.click(); });
}

function handleFileSelect(f) {
  let vid = svc.pendingVolumeId;
  if (!vid) {
    // nessun volume selezionato: crea un nuovo volume per il file
    const v = addVolume();
    v.name = (f.name || "File").replace(/\.[^.]+$/, "").slice(0, 80) || "File";
    vid = v.id;
  }
  svc.pendingVolumeId = null;
  const ext = (f.name || "").split(".").pop().toLowerCase();
  if (ext === "pdf" || f.type === "application/pdf") { svc.loadPdfFile && svc.loadPdfFile(vid, f); return; }
  if (ext === "epub" || f.type === "application/epub+zip") { svc.loadEpubFile ? svc.loadEpubFile(vid, f) : toast("Modulo EPUB non caricato."); return; }
  if (ext === "txt" || ext === "md" || ext === "markdown" || /^text\//i.test(f.type)) {
    f.text().then(t => { const v = state.volumes.find(x => x.id === vid); if (v) { v.text = t; v.type = "text"; save(); } renderCollection && renderCollection(); toast("Testo caricato"); });
    return;
  }
  if (/^image\//i.test(f.type)) {
    storeBlob(f).then(id => { mediaUrls[id] = URL.createObjectURL(f); const v = state.volumes.find(x => x.id === vid); if (v) v.coverId = id; save(); renderCollection && renderCollection(); toast("Immagine aggiunta"); });
    return;
  }
  if (/^video\//i.test(f.type)) {
    storeBlob(f).then(id => { mediaUrls[id] = URL.createObjectURL(f); const n = {id: uid(), title: f.name, body: `<video data-media-id="${id}" controls></video>`, source: {type:"video",volumeId:vid}}; svc.addNode && svc.addNode(n); toast("Video aggiunto come nodo"); });
    return;
  }
  toast("Tipo file non supportato: " + f.type);
}

svc.renderCollection = renderCollection;
svc.mount = mount;
svc.pendingVolumeId = null;
svc.pendingCoverId = null;
svc.setCollTab = setCollTab;
svc.addVolume = addVolume;
svc.addFolder = addFolder;
svc.deleteVolume = deleteVolume;
svc.deleteFolder = deleteFolder;
svc.focusVolume = focusVolume;
svc.requestCover = requestCover;