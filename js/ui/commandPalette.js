// commandPalette.js — Ctrl+K command search
import { escapeHtml } from "../core/util.js";
import { icon } from "./icons.js";

// icona per azione (per etichetta) e, in mancanza, per categoria
const LABEL_ICON = {
  "Vai a Home": "home", "Vai a Mappa": "map", "Vai a Raccolta": "collection", "Vai a Impostazioni": "settings",
  "Nuovo nodo": "plus", "Elimina nodo": "trash", "Nuova pagina": "copy", "Annulla": "undo", "Ripeti": "redo",
  "Modalità penna": "pen", "Attiva/Disattiva penna": "pen", "Adatta vista": "fit", "Zoom avanti": "zoomin", "Zoom indietro": "zoomout",
  "Nuovo volume": "book", "Nuova cartella": "folderPlus", "Carica file": "upload", "Apri EPUB": "epub",
  "Lettura ad alta voce": "speak", "Play/Pausa": "play", "Segmento successivo": "next", "Segmento precedente": "prev",
  "Crea nodo da selezione": "plus", "Taglia e crea nodo": "scissors", "Annulla taglio": "undo",
  "Traduci volume": "translate", "Entra in stanza": "enter", "Esci dalla stanza": "leave",
  "Apri pannello collaborazione": "collab", "Nuovo spazio personale": "star", "Chiudi lightbox": "close"
};
const GROUP_ICON = { Navigazione: "chevron", Nodi: "node", Mappa: "map", Raccolta: "collection", Voce: "speak", Traduzione: "translate", Collaborazione: "collab", Home: "home", Lightbox: "image" };
const iconFor = (a) => LABEL_ICON[a.label] || GROUP_ICON[a.group] || "node";

let pal = null, input = null, list = null;

let actions = [];
let selIdx = 0;

export function registerAction(group, label, kbd, fn) {
  // deduplica: stesso gruppo+etichetta → l'ultima registrazione vince
  const i = actions.findIndex(a => a.group === group && a.label === label);
  const item = { group, label, kbd, fn };
  if (i >= 0) actions[i] = item;
  else actions.push(item);
}

function filtered(filter) {
  const f = (filter || "").toLowerCase();
  return actions.filter(a => !f || a.label.toLowerCase().includes(f) || a.group.toLowerCase().includes(f));
}

function render(filter = "") {
  if (!list) return;
  list.innerHTML = "";
  const items = filtered(filter);
  selIdx = 0;
  let lastGroup = "";
  items.forEach((a, i) => {
    if (a.group !== lastGroup) {
      lastGroup = a.group;
      const g = document.createElement("div");
      g.className = "palette-group";
      g.textContent = lastGroup;
      list.appendChild(g);
    }
    const item = document.createElement("div");
    item.className = "palette-item" + (i === 0 ? " sel" : "");
    item.innerHTML = `<div class="pi-ico">${icon(iconFor(a), 17)}</div><div class="pi-name">${escapeHtml(a.label)}</div><div class="kbd">${escapeHtml(a.kbd || "")}</div>`;
    item.onclick = () => { close(); a.fn(); };
    item.onmouseenter = () => { selIdx = i; markSel(items); };
    list.appendChild(item);
  });
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "palette-group";
    empty.textContent = "Nessuna azione trovata";
    list.appendChild(empty);
  }
}

function markSel(items) {
  if (!list) return;
  list.querySelectorAll(".palette-item").forEach((el, i) => {
    el.classList.toggle("sel", i === selIdx);
  });
  const sel = list.querySelectorAll(".palette-item")[selIdx];
  if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: "nearest" });
}

export function openPalette() {
  if (!pal) return;
  pal.hidden = false;
  input.value = "";
  render("");
  input.focus();
}

export function close() {
  if (!pal) return;
  pal.hidden = true;
  input.value = "";
}

export function togglePalette() {
  if (!pal) return;
  if (pal.hidden) openPalette(); else close();
}

export function initCommandPalette() {
  pal = document.getElementById("commandPalette");
  input = document.getElementById("paletteInput");
  list = document.getElementById("paletteList");
  if (!pal || !input || !list) return;

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); togglePalette(); return; }
    if (pal.hidden) return;
    const items = filtered(input.value);
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); selIdx = Math.min(selIdx + 1, items.length - 1); markSel(items); }
    else if (e.key === "ArrowUp") { e.preventDefault(); selIdx = Math.max(selIdx - 1, 0); markSel(items); }
    else if (e.key === "Enter") { e.preventDefault(); const a = items[selIdx]; if (a) { close(); a.fn(); } }
  });
  pal.addEventListener("click", (e) => { if (e.target === pal) close(); });
  input.addEventListener("input", () => render(input.value));
  render();
}
