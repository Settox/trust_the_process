// collab.js — Collaborazione P2P (Trystero) + sincronizzazione + cursori
import { state, serverReady, supabaseClient, save, saveLocalState, load, defaultState, persistRoomState, loadRoomFromServer, ensureRoomOnServer, cleanRoomName, storageKey, setActiveRoom } from "../core/store.js";
import { uid, toast, promptModal } from "../core/util.js";
import { emit, on } from "../core/bus.js";
import { svc } from "../core/svc.js";
import { settings } from "../core/settings.js";
import { touch as historyTouch } from "../core/history.js";
import { registerAction } from "../ui/commandPalette.js";

let collab = { active: false, room: null, roomObj: null, send: {}, peers: {}, synced: false, backedUp: false };
let lc = 0;

const TRYSTERO_SOURCES = [
  'https://esm.sh/trystero@0.21/torrent',
  'https://esm.sh/trystero@0.21/nostr',
  'https://cdn.jsdelivr.net/npm/trystero@0.21/+esm'
];

async function loadTrystero() {
  for (const src of TRYSTERO_SOURCES) {
    try {
      const mod = await import(/* @vite-ignore */ src);
      if (mod.joinRoom && mod.selfId) return mod;
    } catch (e) {}
  }
  return null;
}

export async function joinRoom(room) {
  room = cleanRoomName(room);
  if (!room) { toast("Nome stanza non valido"); return; }
  if (collab.active && collab.room === room) return;
  leaveRoom(false);

  let loaded = null;
  if (serverReady) loaded = await loadRoomFromServer(room);
  if (!loaded) loaded = JSON.parse(localStorage.getItem(storageKey(room)) || "null");
  if (!loaded) loaded = { pages: [{ id: uid(), name: "Pagina 1", nodes: [], connections: [] }], folders: [], volumes: [], current: 0 };

  // salva subito lo stato corrente (personale o altra stanza) prima di sostituirlo:
  // il salvataggio debounced potrebbe altrimenti scrivere lo stato della stanza sulla chiave sbagliata
  saveLocalState();
  localStorage.setItem("spazio-teorie-v3-backup-prima-della-stanza", JSON.stringify(state));
  Object.assign(state, loaded);
  state.current = Math.min(state.current || 0, state.pages.length - 1);
  collab.active = true;
  collab.room = room;
  svc.setActiveRoom && svc.setActiveRoom(room);
  setActiveRoom(room);
  historyTouch(room, { nodeCount: state.pages.reduce((a, p) => a + p.nodes.length, 0) });

  const trystero = await loadTrystero();
  if (!trystero) {
    toast("Modalità stanza locale (rete P2P non disponibile)");
    finishJoin(room);
    return;
  }

  try {
    const roomObj = trystero.joinRoom({ appId: "spazio-teorie-app-v1" }, "room-" + room);
    collab.roomObj = roomObj;

    // Azioni P2P: makeAction restituisce [send, onData]
    const [sendState, onState] = roomObj.makeAction("state");
    const [sendOps, onOps] = roomObj.makeAction("ops");
    const [sendCursor, onCursor] = roomObj.makeAction("cursor");
    collab.send = { state: sendState, ops: sendOps, cursor: sendCursor };

    onState((data) => {
      if (!data || !data.pages) return;
      Object.assign(state, data);
      svc.renderTabs && svc.renderTabs();
      svc.renderGraph && svc.renderGraph();
      svc.renderCollection && svc.renderCollection();
    });
    onOps((data) => { if (Array.isArray(data)) applyOps(data); });
    onCursor((data, peerId) => updateRemoteCursor(peerId, data));

    roomObj.onPeerJoin((id) => {
      collab.peers[id] = { name: "Utente " + String(id).slice(-4), hue: Math.floor(Math.random() * 360) };
      updatePeersUI();
      // chi era già nella stanza manda il proprio stato al nuovo arrivato
      try { sendState(state, [id]); } catch (e) {}
      toast("Un amico è entrato nella stanza");
    });
    roomObj.onPeerLeave((id) => {
      delete collab.peers[id];
      const cur = document.getElementById("cursor-" + id);
      if (cur) cur.remove();
      updatePeersUI();
    });
  } catch (e) {
    toast("Errore connessione P2P: " + (e.message || e));
  }

  finishJoin(room);
}

function finishJoin(room) {
  history.replaceState(null, "", "?room=" + encodeURIComponent(room));
  svc.renderTabs && svc.renderTabs();
  svc.renderGraph && svc.renderGraph();
  svc.renderCollection && svc.renderCollection();
  svc.switchView && svc.switchView("map");
  toast("Entrato in " + room);
  updatePeersUI();
}

function applyOps(ops) {
  ops.forEach(op => {
    if (op.type === "node") {
      const pg = state.pages.find(p => p.id === op.pageId);
      if (!pg) return;
      const idx = pg.nodes.findIndex(n => n.id === op.node.id);
      if (op.deleted) { if (idx >= 0) pg.nodes.splice(idx, 1); }
      else if (idx >= 0) { pg.nodes[idx] = op.node; }
      else { pg.nodes.push(op.node); }
    } else if (op.type === "conn") {
      const pg = state.pages.find(p => p.id === op.pageId);
      if (!pg) return;
      const idx = pg.connections.findIndex(c => c.id === op.conn.id);
      if (op.deleted) { if (idx >= 0) pg.connections.splice(idx, 1); }
      else if (idx >= 0) { pg.connections[idx] = op.conn; }
      else { pg.connections.push(op.conn); }
    }
  });
  svc.renderGraph && svc.renderGraph();
}

export function leaveRoom(show = true) {
  const wasInRoom = !!(collab.active || collab.room);
  if (collab.roomObj) { try { collab.roomObj.leave(); } catch (e) {} collab.roomObj = null; }
  if (wasInRoom) {
    // 1) salva lo stato della stanza sulla SUA chiave (activeRoom è ancora impostato)
    saveLocalState();
    if (serverReady) { try { persistRoomState(); } catch (e) {} }
    // 2) ripristina lo stato personale: senza questo passo il contenuto della stanza
    //    restava in memoria e veniva salvato sopra lo spazio personale (perdita dati)
    const personal = load(null) || defaultState();
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, personal);
    svc.clearSelection && svc.clearSelection();
    svc.renderTabs && svc.renderTabs();
    svc.renderGraph && svc.renderGraph();
    svc.renderCollection && svc.renderCollection();
  }
  collab.active = false;
  collab.room = null;
  collab.peers = {};
  collab.send = {};
  svc.setActiveRoom && svc.setActiveRoom(null);
  setActiveRoom(null);
  document.querySelectorAll(".rcur").forEach(c => c.remove());
  if (location.search.includes("room=")) history.replaceState(null, "", location.pathname);
  updatePeersUI();
  if (show && wasInRoom) toast("Uscito dalla stanza");
}

function updatePeersUI() {
  const p = document.getElementById("peers");
  const st = document.getElementById("statusText");
  const label = document.getElementById("spaceLabel");
  if (st) st.textContent = collab.active ? ("Stanza: " + collab.room) : "Personale · salvato";
  if (label) label.textContent = collab.active ? ("Stanza «" + collab.room + "»") : "Il mio spazio personale";
  if (!p) return;
  if (!collab.active) { p.textContent = "Non connesso"; return; }
  const list = Object.values(collab.peers);
  p.innerHTML = list.length
    ? "Connessi: " + list.map(pr => `<span class="peer"><i style="background:hsl(${pr.hue},90%,62%)"></i>${pr.name}</span>`).join("")
    : "Nella stanza «" + collab.room + "» — in attesa di altri partecipanti…";
}

function updateRemoteCursor(peerId, data) {
  if (!data) return;
  const host = document.getElementById("cursors");
  if (!host) return;
  let cur = document.getElementById("cursor-" + peerId);
  if (!cur) { cur = document.createElement("div"); cur.id = "cursor-" + peerId; cur.className = "rcur"; host.appendChild(cur); }
  cur.style.left = data.x + "px"; cur.style.top = data.y + "px"; cur.style.borderColor = "hsl(" + (collab.peers[peerId]?.hue || 0) + ",90%,62%)"; cur.style.display = "block";
}

/* diffusione dello stato ai peer (chiamata dopo le modifiche locali), con debounce */
let pushTimer = 0;
export function collabPush() {
  if (!collab.active || !collab.send.state) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { try { collab.send.state(state); } catch (e) {} }, 400);
}

/* invia la posizione del cursore ai peer */
export function collabCursor(x, y) {
  if (!collab.active || !collab.send.cursor) return;
  const now = Date.now();
  if (now - lc < 50) return;
  lc = now;
  try { collab.send.cursor({ x, y }); } catch (e) {}
}

// ===== Command palette actions for collab module =====
registerAction("Collaborazione", "Entra in stanza", "Ctrl+J", async () => {
  const r = await promptModal("Nome stanza", "es. mio-progetto-01");
  if (r) { svc.joinRoom(r); }
});
registerAction("Collaborazione", "Esci dalla stanza", "Ctrl+Shift+J", () => { svc.leaveRoom && svc.leaveRoom(); });

svc.joinRoom = joinRoom;
svc.leaveRoom = leaveRoom;
svc.setActiveRoom = setActiveRoom;
svc.collabActive = () => collab.active;
svc.hasPeers = () => Object.keys(collab.peers).length > 0;
svc.collabPush = collabPush;
svc.collabCursor = collabCursor;
svc.incoming = {};
svc.requestMissingFiles = () => {};
