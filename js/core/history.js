// history.js — cronologia spazi di collaborazione (NUOVA feature)
import { ROOM_KEY_PREFIX } from "./store.js";

const HISTORY_KEY = "spazio-teorie-room-history";
const HISTORY_SEEDED = "spazio-teorie-room-history-seeded";

let cache = null;

export function list() {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]") || []; }
  catch (e) { cache = []; }
  return cache;
}

function persist() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(cache)); } catch (e) {}
}

/* registra (o aggiorna) l'ingresso in una stanza */
export function touch(room, meta = {}) {
  list();
  const idx = cache.findIndex(e => e.room === room);
  const entry = {
    room,
    label: (idx >= 0 ? cache[idx].label : meta.label) || room,
    lastOpened: Date.now(),
    nodeCount: meta.nodeCount || (idx >= 0 ? cache[idx].nodeCount : 0)
  };
  if (idx >= 0) cache[idx] = entry;
  else cache.unshift(entry);
  persist();
  return entry;
}

export function rename(room, label) {
  list();
  const e = cache.find(x => x.room === room);
  if (e) { e.label = label || room; persist(); }
}

export function remove(room) {
  list();
  cache = cache.filter(x => x.room !== room);
  persist();
}

export function get(room) {
  return list().find(x => x.room === room);
}

/* prima apertura: popola la cronologia scansionando le stanze già in localStorage */
export function seedFromStorage() {
  try {
    if (localStorage.getItem(HISTORY_SEEDED) === "1") return;
    list();
    const seen = {};
    cache.forEach(e => { seen[e.room] = 1; });
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(ROOM_KEY_PREFIX) === 0) {
        const room = k.slice(ROOM_KEY_PREFIX.length);
        if (room && !seen[room]) {
          seen[room] = 1;
          let nodeCount = 0;
          try {
            const s = JSON.parse(localStorage.getItem(k));
            nodeCount = (s.pages || []).reduce((acc, p) => acc + (p.nodes || []).length, 0);
          } catch (e) {}
          cache.unshift({ room, label: room, lastOpened: 0, nodeCount });
        }
      }
    }
    persist();
    localStorage.setItem(HISTORY_SEEDED, "1");
  } catch (e) { console.warn("seedFromStorage", e); }
}
