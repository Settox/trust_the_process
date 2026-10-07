// store.js — stato, persistenza (localStorage/IndexedDB/Supabase), media
import { uid, toast } from "./util.js";
import { emit } from "./bus.js";
import { svc } from "./svc.js";

/* ---- costanti contratto (identiche all'originale) ---- */
export const KEY = "spazio-teorie-v3";
export const PERSONAL_KEY = KEY;
export const ROOM_KEY_PREFIX = "spazio-teorie-room-v3:";
export const DB_NAME = "spazio-teorie-db";
export const DB_VERSION = 3;
export const SUPABASE_TABLE = "spazio_teorie_projects";
export const SUPABASE_BUCKET = "spazio-teorie-files";

/* ---- runtime flags condivisi ---- */
export const runtime = { applying: false, collabActive: false };

/* ---- stato ---- */
export let state = null;
export let activeRoom = null;

let serverSaveTimer = null;
let serverSaveAgain = false;
let localSaveTimer = null;
let savePending = false;
let serverSaveBusy = false;
let quotaWarned = 0;

export let serverReady = false;
export let supabaseClient = null;

try {
  if (window.supabase && window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url && window.SUPABASE_CONFIG.key) {
    supabaseClient = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.key);
    serverReady = true;
  }
} catch (e) {
  console.warn("Supabase non configurato", e);
}

/* ---- IndexedDB ---- */
let dbPromise = null;
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
      if (!db.objectStoreNames.contains("pdfs")) db.createObjectStore("pdfs");
      if (!db.objectStoreNames.contains("epubs")) db.createObjectStore("epubs");
      if (!db.objectStoreNames.contains("tts")) db.createObjectStore("tts");
    };
    req.onsuccess = (e) => res(e.target.result);
    req.onerror = (e) => rej(e.target.error);
  });
  return dbPromise;
}

export function idbPut(s, k, v) {
  return openDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(s, "readwrite");
    tx.objectStore(s).put(v, k);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  }));
}
export function idbGet(s, k) {
  return openDB().then(db => new Promise((res, rej) => {
    const r = db.transaction(s, "readonly").objectStore(s).get(k);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
export function idbDel(s, k) {
  return openDB().then(db => new Promise((res, rej) => {
    const tx = db.transaction(s, "readwrite");
    tx.objectStore(s).delete(k);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  }));
}

/* ---- file server ---- */
export function roomFilePath(kind, id, type) {
  return activeRoom + "/" + kind + "/" + id;
}

export async function uploadRoomBlob(id, b, kind) {
  if (!activeRoom || !serverReady || !supabaseClient) return;
  try {
    const path = roomFilePath(kind, id, b.type);
    const r = await supabaseClient.storage.from(SUPABASE_BUCKET).upload(path, b, { contentType: b.type || "application/octet-stream", upsert: true });
    if (r.error) throw r.error;
  } catch (e) {
    console.warn("Upload file server fallito", e);
    toast("Caricamento sul server non riuscito (" + ((e && e.message) || "errore") + "). Il file resta sul tuo dispositivo e viene dato agli amici connessi.");
  }
}

export async function downloadRoomBlob(id, kind, type) {
  if (!activeRoom || !serverReady || !supabaseClient) return null;
  const base = activeRoom + "/" + kind + "/" + id;
  const paths = [base];
  const ext = (String(type || "").split("/")[1] || "").replace(/[^a-zA-Z0-9]+/g, "").slice(0, 8);
  if (ext) paths.push(base + "." + ext);
  if (kind === "blob") paths.push(base + ".png", base + ".jpg", base + ".jpeg", base + ".webp", base + ".gif", base + ".mp4", base + ".webm", base + ".mov", base + ".bin");
  else if (kind === "pdf") paths.push(base + ".pdf");
  else if (kind === "epub") paths.push(base + ".epub");
  for (let i = 0; i < paths.length; i++) {
    try {
      const r = await supabaseClient.storage.from(SUPABASE_BUCKET).download(paths[i]);
      if (!r.error && r.data) return r.data;
    } catch (e) {}
  }
  return null;
}

/* ---- stato ---- */
export function defaultState() {
  return { pages: [{ id: uid(), name: "Pagina 1", nodes: [], connections: [] }], folders: [], volumes: [], current: 0 };
}

export function cleanRoomName(room) {
  return String(room || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "room";
}

export function storageKey(room) {
  return room ? ROOM_KEY_PREFIX + room : PERSONAL_KEY;
}

export function normalizeState(s) {
  if (!s || !Array.isArray(s.pages) || !s.pages.length) return null;
  if (!Array.isArray(s.folders)) s.folders = [];
  if (!Array.isArray(s.volumes)) s.volumes = [];
  if (typeof s.current !== "number") s.current = 0;
  s.pages.forEach(p => { if (!Array.isArray(p.nodes)) p.nodes = []; if (!Array.isArray(p.connections)) p.connections = []; });
  return s;
}

export function load(room) {
  try {
    const raw = localStorage.getItem(storageKey(room));
    if (!raw) return null;
    return normalizeState(JSON.parse(raw));
  } catch (e) { return null; }
}

state = load(null) || defaultState();

export function saveLocalState() {
  try { localStorage.setItem(storageKey(activeRoom), JSON.stringify(state)); return true; }
  catch (e) { return false; }
}

function warnQuota() {
  const n = Date.now();
  if (n - quotaWarned > 60000) {
    quotaWarned = n;
    toast("Memoria del browser piena: il progetto non si salva più in locale." + (activeRoom ? " Resta salvato sul server." : " Esporta una copia."));
  }
}

export function scheduleLocalSave() {
  savePending = true;
  clearTimeout(localSaveTimer);
  localSaveTimer = setTimeout(() => {
    localSaveTimer = null;
    if (savePending) { savePending = false; if (!saveLocalState()) warnQuota(); }
  }, 650);
}

export function scheduleServerSave() {
  if (!activeRoom || !serverReady) return;
  clearTimeout(serverSaveTimer);
  serverSaveTimer = setTimeout(() => { persistRoomState(); }, 1200);
}

export async function persistRoomState() {
  if (!activeRoom || !serverReady || !supabaseClient) return;
  if (serverSaveBusy) { serverSaveAgain = true; return; }
  serverSaveBusy = true;
  const roomAtStart = activeRoom;
  try {
    const clean = JSON.parse(JSON.stringify(state));
    delete clean.current;
    const r = await supabaseClient.from(SUPABASE_TABLE).upsert({ server_id: roomAtStart, name: roomAtStart, state: clean, updated_at: new Date().toISOString() }, { onConflict: "server_id" });
    if (r.error) throw r.error;
    if (activeRoom === roomAtStart) emit("status", { text: "Salvato sul server · " + roomAtStart });
  } catch (e) {
    console.warn("Salvataggio server fallito", e);
    if (activeRoom === roomAtStart) emit("status", { text: "Salvato localmente · server non raggiungibile" });
  } finally {
    serverSaveBusy = false;
    if (serverSaveAgain) { serverSaveAgain = false; scheduleServerSave(); }
  }
}

export async function loadRoomFromServer(room) {
  if (!serverReady || !supabaseClient) return null;
  try {
    const r = await supabaseClient.from(SUPABASE_TABLE).select("state").eq("server_id", room).maybeSingle();
    if (r.error) throw r.error;
    return r.data && normalizeState(r.data.state);
  } catch (e) { console.warn("Caricamento server fallito", e); return null; }
}

export async function ensureRoomOnServer(room, s) {
  if (!serverReady || !supabaseClient) return;
  try {
    const r = await supabaseClient.from(SUPABASE_TABLE).upsert({ server_id: room, name: room, state: JSON.parse(JSON.stringify(s)), updated_at: new Date().toISOString() }, { onConflict: "server_id", ignoreDuplicates: true });
    if (r.error) throw r.error;
  } catch (e) { console.warn("Creazione progetto server fallita", e); }
}

/* ---- save centrale ---- */
export function save(noSync) {
  scheduleLocalSave();
  if (activeRoom) scheduleServerSave();
  if (!noSync && !runtime.applying && svc.collabPush) svc.collabPush();
  emit("state:changed", { noSync: !!noSync });
}

/* ---- pagina corrente / nodi ---- */
export function currentPage() {
  return state.pages[state.current] || state.pages[0];
}
export function findNode(id) {
  const p = currentPage();
  for (const n of p.nodes) if (n.id === id) return n;
  return null;
}

/* ---- media (blob) ---- */
export const mediaUrls = {};
let mediaHydrateBusy = null;

export function storeBlob(b) {
  const id = uid();
  return idbPut("blobs", id, { blob: b, type: b.type }).then(() => {
    if (activeRoom && !/^video\//.test(b.type || "")) uploadRoomBlob(id, b, "blob");
    return id;
  });
}

export function clearMediaUrls() {
  for (const id in mediaUrls) { try { URL.revokeObjectURL(mediaUrls[id]); } catch (e) {} }
  for (const id in mediaUrls) delete mediaUrls[id];
}

export function collectMediaIds() {
  const ids = [], seen = {};
  state.pages.forEach(p => {
    p.nodes.forEach(n => {
      const t = document.createElement("div");
      t.innerHTML = n.body || "";
      t.querySelectorAll("[data-media-id]").forEach(m => {
        const id = m.getAttribute("data-media-id");
        if (id && !seen[id]) { seen[id] = 1; ids.push(id); }
      });
    });
  });
  state.volumes.forEach(v => { if (v.coverId && !seen[v.coverId]) { seen[v.coverId] = 1; ids.push(v.coverId); } });
  return ids;
}

export async function hydrateMedia() {
  if (mediaHydrateBusy) return mediaHydrateBusy;
  mediaHydrateBusy = (async function () {
    const ids = collectMediaIds();
    let changed = false;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      if (mediaUrls[id]) continue;
      const rec = await idbGet("blobs", id);
      if (rec && rec.blob) { mediaUrls[id] = URL.createObjectURL(rec.blob); changed = true; continue; }
      const remote = await downloadRoomBlob(id, "blob", null);
      if (remote) { await idbPut("blobs", id, { blob: remote, type: remote.type }); mediaUrls[id] = URL.createObjectURL(remote); changed = true; }
    }
    return changed;
  })().finally(() => { mediaHydrateBusy = null; });
  return mediaHydrateBusy;
}

export function setState(s) { state = s; }
export function setActiveRoom(room) { activeRoom = room; }
