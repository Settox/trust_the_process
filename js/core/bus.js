// bus.js — event bus minimale
const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => off(event, fn);
}

export function off(event, fn) {
  const s = listeners.get(event);
  if (s) s.delete(fn);
}

export function emit(event, data) {
  const s = listeners.get(event);
  if (!s) return;
  for (const fn of Array.from(s)) {
    try { fn(data); } catch (e) { console.error("[bus]", event, e); }
  }
}
