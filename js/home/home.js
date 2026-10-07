// home.js — home stellare, gestione spazi (costellazioni)
import { list, touch, rename, remove, seedFromStorage } from "../core/history.js";
import { state, load, setActiveRoom, saveLocalState } from "../core/store.js";
import { svc } from "../core/svc.js";
import { toast, escapeHtml, promptModal } from "../core/util.js";
import { icon } from "../ui/icons.js";
import { registerAction } from "../ui/commandPalette.js";

const $ = (id) => document.getElementById(id);

let homeQuery = "", homeSortMode = "recent";

export function renderHome() {
  const container = $("homeGrid");
  const personal = $("homePersonal");
  container.innerHTML = "";
  personal.innerHTML = "";

  // Spazio personale
  const hp = document.createElement("div");
  hp.className = "home-personal";
  hp.innerHTML = '<div class="hp-ico">' + icon("star", 24) + '</div>' +
                 '<div class="hp-body"><div class="hp-name">Il mio spazio personale</div><div class="hp-desc">La tua mappa privata, salvata solo su questo dispositivo.</div></div>' +
                 '<button class="ctl hp-open">Apri</button>';
  hp.onclick = () => { if (svc.leaveRoom) svc.leaveRoom(false); setActiveRoom(null); const st = document.getElementById("statusText"); if (st) st.textContent = "Personale · salvato"; svc.switchView("map"); };
  personal.appendChild(hp);

  // Spazi collab (filtrati dalla ricerca e ordinati)
  let spaces = list();
  if (homeQuery) spaces = spaces.filter(s => ((s.label || s.room) + " " + s.room).toLowerCase().includes(homeQuery));
  if (homeSortMode === "name") spaces = spaces.slice().sort((a, b) => (a.label || a.room).localeCompare(b.label || b.room, "it"));
  if (!spaces.length) {
    container.innerHTML = homeQuery
      ? '<div class="home-empty">Nessuno spazio corrisponde alla ricerca.</div>'
      : '<div class="home-empty">Nessuno spazio visitato finora. Crea il primo qui sopra!</div>';
  } else {
    spaces.forEach(s => {
      const card = document.createElement("div");
      card.className = "constellation";
      card.innerHTML = `<div class="cs-head">
          <div class="cs-star">${icon("star", 16)}</div>
          <div class="cs-name">${escapeHtml(s.label || s.room)}</div>
          <button class="cs-menu">⋯</button>
        </div>
        <div class="cs-preview"><canvas></canvas><div class="cs-veil"></div></div>
        <div class="cs-meta">
          <span class="m time">${s.lastOpened ? new Date(s.lastOpened).toLocaleDateString() : "-"}</span>
          <span class="m"><span class="n">${s.nodeCount}</span> nodi</span>
        </div>`;
      
      const canvas = card.querySelector("canvas");
      drawPreview(canvas, s.room);
      
      card.onclick = () => { svc.joinRoom(s.room); svc.switchView("map"); };
      card.querySelector(".cs-menu").onclick = (e) => {
        e.stopPropagation();
        svc.showMenu([
          { l: "Apri", fn: () => { svc.joinRoom(s.room); svc.switchView("map"); } },
          { l: "Copia link", fn: () => { const link = location.origin + location.pathname + "?room=" + encodeURIComponent(s.room); svc.copyText(link).then(() => toast("Link copiato")); } },
          { l: "Rinomina", fn: async () => { const n = await promptModal("Rinomina spazio", "Nuovo nome", s.label); if (n) { rename(s.room, n); renderHome(); } } },
          { l: "Rimuovi dalla cronologia", danger: true, fn: () => { remove(s.room); renderHome(); } }
        ], e.clientX, e.clientY);
      };
      container.appendChild(card);
    });
  }
}

function drawPreview(canvas, room) {
  if (!canvas) return;
  const s = load(room);
  if (!s || !s.pages || !s.pages.length) { canvas.style.display = "none"; return; }
  const nodes = s.pages.flatMap(p => p.nodes || []);
  if (!nodes.length) { canvas.style.display = "none"; return; }
  const W = 280, H = 104;
  canvas.width = W; canvas.height = H; canvas.style.width = W + "px"; canvas.style.height = H + "px";
  const ctx = canvas.getContext("2d");
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  nodes.forEach(n => { minX = Math.min(minX, n.x); minY = Math.min(minY, n.y); maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h); });
  const sc = Math.min((W - 30) / (maxX - minX || 1), (H - 30) / (maxY - minY || 1));
  ctx.fillStyle = "rgba(138,180,255,.5)";
  nodes.forEach(n => { ctx.fillRect(15 + (n.x - minX) * sc, 15 + (n.y - minY) * sc, Math.max(3, n.w * sc), Math.max(3, n.h * sc)); });
  // Draw connection lines
  ctx.strokeStyle = "rgba(138,180,255,.25)"; ctx.lineWidth = 1;
  s.pages.forEach(p => p.connections.forEach(c => {
    const a = nodes.find(n => n.id === c.from), b = nodes.find(n => n.id === c.to);
    if (!a || !b) return;
    ctx.beginPath();
    ctx.moveTo(15 + (a.x + a.w/2 - minX) * sc, 15 + (a.y + a.h/2 - minY) * sc);
    ctx.lineTo(15 + (b.x + b.w/2 - minX) * sc, 15 + (b.y + b.h/2 - minY) * sc);
    ctx.stroke();
  }));
}

export function initHome() {
  seedFromStorage();
  $("homeRoomJoin").onclick = () => { const r = $("homeRoomInput").value.trim(); if (r) { svc.joinRoom(r); svc.switchView("map"); } };
  $("homeRoomInput").addEventListener("keydown", (e) => { if (e.key === "Enter") $("homeRoomJoin").click(); });
  $("homeSearch").addEventListener("input", (e) => { homeQuery = e.target.value.trim().toLowerCase(); renderHome(); });
  $("homeSort").addEventListener("change", (e) => { homeSortMode = e.target.value; renderHome(); });
  renderHome();

  // ===== Command palette actions for home module =====
  registerAction("Home", "Entra in stanza", "Ctrl+J", async () => {
    const r = await promptModal("Nome stanza", "es. mio-progetto-01");
    if (r) { svc.joinRoom(r); svc.switchView("map"); }
  });
  registerAction("Home", "Nuovo spazio personale", "Ctrl+N", () => { svc.switchView("map"); });
}
