// main.js — entry point, inizializzazione moduli, cablaggio registry
import { initShell, switchView } from "./ui/shell.js";
import { initMap } from "./map/map.js";
import { initContextMenu } from "./ui/contextMenu.js";
import { initLightbox } from "./ui/lightbox.js";
import { initHome, renderHome } from "./home/home.js";
import { initReader } from "./reader/reader.js";
import { initTranslate } from "./translate/translate.js";
import { initCommandPalette, registerAction, togglePalette } from "./ui/commandPalette.js";
import { initCollection } from "./collection/collection.js";
import { initPdfViewer } from "./pdf/pdfViewer.js";
import { joinRoom } from "./collab/collab.js";
import { hydrateMedia, state, save, normalizeState } from "./core/store.js";
import { settings, saveSettings } from "./core/settings.js";
import { startStarfield } from "./starfield/starfield.js";
import { svc } from "./core/svc.js";
import { copyText, promptModal, toast, downloadJson, uid, escapeHtml } from "./core/util.js";
import { LANGS } from "./core/i18n.js";
import { fillSysVoices } from "./voice/tts.js";
import { on } from "./core/bus.js";

async function boot() {
  // Wire cross-module service registry
  svc.switchView = switchView;
  svc.joinRoom = joinRoom;
  svc.copyText = copyText;
  svc.openSettings = () => switchView("settings");
  svc.showMenu = (items, x, y) => {
    const ctx = document.getElementById("ctx");
    if (!ctx) return;
    ctx.innerHTML = "";
    items.forEach(it => {
      if (it.sep) { const d = document.createElement("div"); d.className = "ctx-sep"; ctx.appendChild(d); return; }
      const d = document.createElement("div");
      d.className = "ctx-item" + (it.danger ? " danger" : "");
      d.textContent = it.l;
      d.onclick = (e) => { e.stopPropagation(); d.closest("#ctx")?.classList.remove("open"); it.fn(); };
      ctx.appendChild(d);
    });
    ctx.classList.add("open");
    ctx.style.left = Math.min(x, window.innerWidth - 200) + "px";
    ctx.style.top = Math.min(y, window.innerHeight - 100) + "px";
  };
  // Missing registrations (called by other modules but never set)
  svc.clickImageFile = () => document.getElementById("imageFile")?.click();
  svc.saveState = () => save();
  svc.saveSettings = () => saveSettings();
  svc.aiProfile = () => { const l = settings.aiProfiles || []; return l.find(x => x.id === settings.aiActive) || l[0] || null; };
  svc.incomingPct = () => 0;

  // Inizializzazione UI e servizi
  initShell();
  initContextMenu();
  initLightbox();
  initHome();
  initReader();
  initTranslate();
  initCommandPalette();
  initCollection();
  initPdfViewer();

  // Monta la Raccolta nella sidebar della mappa e nella vista dedicata
  svc.mount && svc.mount("collectionHost");
  const hostFull = document.getElementById("collectionHostFull");
  if (hostFull) {
    // la vista Raccolta riusa lo stesso pannello: quando si entra nella vista, sposta il pannello lì
    window.addEventListener("hashchange", placeCollection);
    placeCollection();
  }
  function placeCollection() {
    const full = location.hash.slice(2) === "collection";
    const showId = full ? "collectionHostFull" : "collectionHost";
    const hideEl = document.getElementById(full ? "collectionHost" : "collectionHostFull");
    if (hideEl) hideEl.innerHTML = "";
    svc.mount(showId);
  }

  // Inizializzazione Mappa
  initMap();

  // Avvio starfield
  startStarfield();

  // Stato (salvataggi server ecc.) -> indicatore nella topbar
  on("status", (d) => { const st = document.getElementById("statusText"); if (st && d && d.text) st.textContent = d.text; });

  // Quando si torna su una vista, i contenuti devono essere aggiornati
  on("route:changed", (r) => {
    if (r === "map" && svc.renderGraph) svc.renderGraph();
    if (r === "home") renderHome();
  });

  // Wire topbar "Nodo" button
  document.getElementById("addNodeBtn").onclick = () => svc.addNode && svc.addNode({});

  // Wire rail "Azioni" button -> command palette
  document.getElementById("paletteBtn").onclick = () => togglePalette();

  // ===== Aiuto =====
  const helpModal = document.getElementById("helpModal");
  document.getElementById("helpBtn").onclick = () => helpModal.classList.add("open");
  document.getElementById("helpClose").onclick = () => helpModal.classList.remove("open");
  helpModal.addEventListener("click", (e) => { if (e.target === helpModal) helpModal.classList.remove("open"); });

  // ===== Export / Import progetto (JSON) =====
  document.getElementById("exportBtn").onclick = () => {
    downloadJson(state, "spazio-teorie-" + new Date().toISOString().slice(0, 10) + ".json");
    toast("Progetto esportato");
  };
  const importFile = document.getElementById("importFile");
  document.getElementById("importBtn").onclick = () => importFile.click();
  importFile.addEventListener("change", () => {
    const f = importFile.files[0]; importFile.value = "";
    if (!f) return;
    f.text().then(txt => {
      const s = normalizeState(JSON.parse(txt));
      if (!s) { toast("File non valido: non è un progetto Spazio Teorie."); return; }
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, s);
      save();
      svc.clearSelection && svc.clearSelection();
      svc.renderTabs && svc.renderTabs();
      svc.renderGraph && svc.renderGraph();
      svc.renderCollection && svc.renderCollection();
      toast("Progetto importato");
    }).catch(() => toast("File non leggibile: JSON non valido."));
  });

  // ===== Collaborazione: wiring modal =====
  const collabModal = document.getElementById("collabModal");
  const roomInput = document.getElementById("roomInput");
  const roomLeave = document.getElementById("roomLeave");
  document.getElementById("collabBtn").onclick = () => {
    collabModal.classList.toggle("open");
    if (collabModal.classList.contains("open")) {
      roomLeave.style.display = svc.collabActive && svc.collabActive() ? "" : "none";
      roomInput.focus();
    }
  };
  document.getElementById("collabClose").onclick = () => collabModal.classList.remove("open");
  collabModal.addEventListener("click", (e) => { if (e.target === collabModal) collabModal.classList.remove("open"); });
  document.getElementById("roomJoin").onclick = () => {
    const r = roomInput.value.trim();
    if (r) { svc.joinRoom(r); collabModal.classList.remove("open"); }
  };
  roomInput.addEventListener("keydown", (e) => { if (e.key === "Enter") document.getElementById("roomJoin").click(); });
  roomLeave.onclick = () => { svc.leaveRoom && svc.leaveRoom(); roomLeave.style.display = "none"; };
  document.getElementById("roomCopyLink").onclick = () => {
    const room = svc.collabActive && svc.collabActive() ? (roomInput.value.trim() || "room") : (roomInput.value.trim() || "room");
    const link = location.origin + location.pathname + "?room=" + encodeURIComponent(room);
    svc.copyText(link).then(() => toast("Link copiato"));
  };

  // Caricamento media in background
  await hydrateMedia();

  // Auto-join da URL ?room=
  const q = new URLSearchParams(location.search);
  const roomParam = q.get("room");
  if (roomParam) joinRoom(roomParam);

  // ===== Impostazioni: tab switching =====
  document.querySelectorAll(".settings-tabs button").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".settings-tabs button").forEach(b => b.classList.remove("on"));
      document.querySelectorAll(".settings-section").forEach(s => s.classList.remove("active"));
      btn.classList.add("on");
      const tab = btn.dataset.settab;
      document.getElementById("set-" + tab)?.classList.add("active");
    };
  });

  // ===== Impostazioni: binding campi (valori iniziali + salvataggio) =====
  const bindText = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = settings[key] || "";
    el.addEventListener("input", () => { settings[key] = el.value; saveSettings(); });
  };
  const bindCheck = (id, key) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.checked = settings[key] !== false;
    el.addEventListener("change", () => { settings[key] = el.checked; saveSettings(); });
  };
  const bindSelect = (id, key, def) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = settings[key] || def || "";
    el.addEventListener("change", () => { settings[key] = el.value; saveSettings(); });
  };

  bindText("setMyName", "myName");
  bindCheck("setDblNode", "dblNode");
  bindSelect("setTtsProv", "ttsProv", "browser");
  bindText("setElKey", "elKey");
  bindSelect("setTrProv", "trProvider", "google");

  // campi voce / provider
  bindText("setElVoice", "elVoice");
  bindText("setElModel", "elModel");
  bindText("setOaUrl", "oaUrl");
  bindText("setOaKey", "oaKey");
  bindText("setOaModel", "oaModel");
  bindText("setOaVoice", "oaVoice");
  bindText("setGcKey", "gcKey");
  bindText("setGcVoice", "gcVoice");
  bindText("setGmKey", "gmKey");
  bindText("setGmModel", "gmModel");
  bindText("setGmVoice", "gmVoice");
  bindText("setSpeechLang", "speechLang");
  const bindNum = (id, key, def) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.value = settings[key] != null ? settings[key] : def;
    el.addEventListener("change", () => { const v = parseFloat(el.value); settings[key] = isNaN(v) ? def : v; saveSettings(); });
  };
  bindNum("setSysPitch", "sysPitch", 1);
  bindNum("setGmRpm", "gmRpm", 3);

  // campi traduzione
  bindText("setLtUrl", "ltUrl");
  bindText("setLtKey", "ltKey");

  // mostra solo il gruppo di campi del provider selezionato
  const setTtsProvEl = document.getElementById("setTtsProv");
  const setTrProvEl = document.getElementById("setTrProv");
  function refreshProvGroups() {
    const pv = (setTtsProvEl && setTtsProvEl.value) || "browser";
    document.querySelectorAll(".prov-grp[data-prov]").forEach(g => { g.style.display = g.dataset.prov === pv ? "" : "none"; });
    const tp = (setTrProvEl && setTrProvEl.value) || "google";
    document.querySelectorAll(".prov-grp[data-trprov]").forEach(g => { g.style.display = g.dataset.trprov === tp ? "" : "none"; });
  }
  if (setTtsProvEl) setTtsProvEl.addEventListener("change", refreshProvGroups);
  if (setTrProvEl) setTrProvEl.addEventListener("change", refreshProvGroups);
  refreshProvGroups();

  // Lingua di destinazione: popola le opzioni da i18n.LANGS
  const setTrT = document.getElementById("setTrTarget");
  if (setTrT) {
    setTrT.innerHTML = LANGS.map(l => `<option value="${l[0]}">${l[1]}</option>`).join("");
    bindSelect("setTrTarget", "trTarget", "en");
  }

  // Voce di sistema: popola le voci disponibili
  fillSysVoices();
  if (window.speechSynthesis) {
    window.speechSynthesis.onvoiceschanged = () => fillSysVoices();
  }
  const setSv = document.getElementById("setSysVoice");
  if (setSv) setSv.addEventListener("change", () => { settings.sysVoice = setSv.value; saveSettings(); });

  // ===== Impostazioni: gestione profili AI (scheda "Modelli AI") =====
  const AI_KINDS = [["openai", "OpenAI / compatibile (GPT, Gemini via URL…)"], ["gemini", "Gemini (API nativa)"], ["claude", "Claude (Anthropic)"]];
  function renderAiProfiles() {
    const host = document.getElementById("aiProfilesList");
    if (!host) return;
    host.innerHTML = "";
    const list = settings.aiProfiles || (settings.aiProfiles = []);
    if (!list.length) {
      const empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "Nessun modello configurato. Aggiungine uno per usarlo nella traduzione AI.";
      host.appendChild(empty);
    }
    list.forEach(p => {
      const card = document.createElement("div");
      card.className = "ai-card" + (settings.aiActive === p.id ? " active" : "");
      card.innerHTML =
        '<div class="ai-card-head">' +
          '<label class="ai-use"><input type="radio" name="aiActivePick" ' + (settings.aiActive === p.id ? "checked" : "") + '> Usa questo</label>' +
          '<input type="text" class="ai-name" value="' + escapeHtml(p.name || "") + '" placeholder="Nome (es. Gemini)">' +
          '<button class="ctl mini ai-del" style="color:var(--danger)">Elimina</button>' +
        '</div>' +
        '<div class="ai-card-grid">' +
          '<div class="field"><label>Tipo</label><select class="ai-kind">' + AI_KINDS.map(k => '<option value="' + k[0] + '"' + (p.kind === k[0] ? " selected" : "") + '>' + k[1] + '</option>').join("") + '</select></div>' +
          '<div class="field ai-url-row"><label>URL API</label><input type="text" class="ai-url" value="' + escapeHtml(p.url || "") + '" placeholder="https://api.openai.com/v1"></div>' +
          '<div class="field"><label>Chiave API</label><input type="password" class="ai-key" value="' + escapeHtml(p.key || "") + '"></div>' +
          '<div class="field"><label>Modello</label><input type="text" class="ai-model" value="' + escapeHtml(p.model || "") + '" placeholder="gpt-4o-mini"></div>' +
          '<div class="field"><label>Richieste/min</label><input type="number" class="ai-rpm" min="1" max="240" step="1" value="' + (p.rpm || 30) + '"></div>' +
        '</div>';
      const persist = () => saveSettings();
      card.querySelector(".ai-use input").addEventListener("change", () => { settings.aiActive = p.id; persist(); renderAiProfiles(); });
      card.querySelector(".ai-name").addEventListener("input", (e) => { p.name = e.target.value; persist(); });
      const kindSel = card.querySelector(".ai-kind");
      const urlRow = card.querySelector(".ai-url-row");
      const syncKind = () => { urlRow.style.display = kindSel.value === "openai" ? "" : "none"; };
      kindSel.addEventListener("change", () => { p.kind = kindSel.value; persist(); syncKind(); });
      syncKind();
      card.querySelector(".ai-url").addEventListener("input", (e) => { p.url = e.target.value; persist(); });
      card.querySelector(".ai-key").addEventListener("input", (e) => { p.key = e.target.value; persist(); });
      card.querySelector(".ai-model").addEventListener("input", (e) => { p.model = e.target.value; persist(); });
      card.querySelector(".ai-rpm").addEventListener("change", (e) => { const v = parseInt(e.target.value, 10); p.rpm = isNaN(v) ? 30 : v; persist(); });
      card.querySelector(".ai-del").onclick = async () => {
        list.splice(list.indexOf(p), 1);
        if (settings.aiActive === p.id) settings.aiActive = list.length ? list[0].id : "";
        persist(); renderAiProfiles();
      };
      host.appendChild(card);
    });
    const add = document.createElement("button");
    add.className = "ctl";
    add.style.marginTop = "10px";
    add.textContent = "+ Aggiungi modello AI";
    add.onclick = () => {
      const p = { id: uid(), name: "Nuovo modello", kind: "openai", url: "https://api.openai.com/v1", key: "", model: "gpt-4o-mini", rpm: 30 };
      settings.aiProfiles.push(p);
      if (!settings.aiActive) settings.aiActive = p.id;
      saveSettings(); renderAiProfiles();
    };
    host.appendChild(add);
    const fb = document.createElement("div");
    fb.className = "field";
    fb.style.marginTop = "10px";
    fb.innerHTML = '<label><input type="checkbox" id="setAiFallback"' + (settings.aiFallback !== false ? " checked" : "") + '> Se un modello fallisce, riprova con gli altri in elenco</label>';
    fb.querySelector("input").addEventListener("change", (e) => { settings.aiFallback = e.target.checked; saveSettings(); });
    host.appendChild(fb);
  }
  renderAiProfiles();

  // ===== Command palette actions =====
  const firstReadableVolume = () => {
    const v = state.volumes.find(x => (x.text && x.text.trim()) || (x.type === "pdf" && x.pdf));
    if (!v) { toast("Nessun volume con testo: aggiungi un volume nella Raccolta."); return null; }
    return v.id;
  };
  registerAction("Navigazione", "Vai a Home", "Ctrl+Shift+H", () => switchView("home"));
  registerAction("Navigazione", "Vai a Mappa", "Ctrl+Shift+M", () => switchView("map"));
  registerAction("Navigazione", "Vai a Raccolta", "Ctrl+Shift+C", () => switchView("collection"));
  registerAction("Navigazione", "Vai a Impostazioni", "Ctrl+Shift+I", () => switchView("settings"));
  registerAction("Nodi", "Nuovo nodo", "Ctrl+N", () => svc.addNode && svc.addNode({}));
  registerAction("Mappa", "Modalità penna", "Ctrl+P", () => svc.setPen && svc.setPen(!svc.penIsOn()));
  registerAction("Mappa", "Adatta vista", "Ctrl+0", () => svc.fitAll && svc.fitAll(true));
  registerAction("Mappa", "Annulla", "Ctrl+Z", () => svc.histUndo && svc.histUndo());
  registerAction("Mappa", "Ripeti", "Ctrl+Shift+Z", () => svc.histRedo && svc.histRedo());
  registerAction("Raccolta", "Nuovo volume", "Ctrl+Shift+N", () => svc.addVolume && svc.addVolume());
  registerAction("Voce", "Lettura ad alta voce", "Ctrl+R", () => { const id = firstReadableVolume(); if (id) svc.openReader(id); });
  registerAction("Traduzione", "Traduci volume", "Ctrl+T", () => { const id = firstReadableVolume(); if (id) svc.openTranslate(id); });
  registerAction("Collaborazione", "Entra in stanza", "Ctrl+J", async () => {
    const r = await promptModal("Nome stanza", "es. mio-progetto-01");
    if (r) { svc.joinRoom(r); }
  });
  registerAction("Collaborazione", "Apri pannello collaborazione", "", () => document.getElementById("collabBtn").click());

  console.log("Spazio Teorie v2 boot complete");
}

boot();
