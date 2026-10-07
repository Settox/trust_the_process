# Spazio Teorie v2 — Fix Funzionalità e Primo Avvio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Spazio Teorie v2 fully interactive and bootable — no `prompt()`/`confirm()` leaks, working navigation, wired settings, functional collection, visible starfield, and zero JS errors on load.

**Architecture:** Each task patches specific DOM events / replaces native dialogs / wires service-locator registrations. No new modules; all changes are additive or in-place within existing files. The original `index.html` (2,696-line monolith) is untouched reference only.

**Tech Stack:** Vanilla ES modules, Vite dev server (`npm run dev`), hash routing (`#/home`, `#/map`, `#/collection`, `#/settings`), CSS custom properties for theming.

**Spec:** `docs/design.md` (sections 1–4), `docs/architecture.md` (file structure, API contracts, migration strategy).

## Global Constraints

- GitHub Pages only — static files, hash routing, `.nojekyll`, relative paths.
- Data compatibility: reuse every existing key verbatim (`spazio-teorie-v3`, `spazio-teorie-room-v3:*`, `spazio-teorie-settings`, `spazio-teorie-room-history`, `spazio-teorie-views`, IndexedDB `spazio-teorie-db`, Supabase table/bucket, Trystero `appId: "spazio-teorie-app-v1"`).
- `supabase-config.js` stays external; API keys device-only.
- Italian language for all UI strings.
- Original `index.html` must not be modified or deleted.

## Review Focus

- **Native dialog leaks:** Any remaining `prompt()`/`alert()`/`confirm()` in production code breaks the custom-modal requirement and must produce a failing test (grep for these calls).
- **Z-index stacking:** Starfield canvas is `z-index: 0`; panels must be `z-index >= 2` with translucent backgrounds — if stars disappear behind surfaces, the `rgba` alpha values need checking.
- **Service locator contract:** Modules register via `svc.xxx = fn`; if a caller invokes `svc.xxx()` before registration, it crashes — registration order in `main.js` boot must precede any user action that triggers it.
- **Hash routing race:** `switchView()` accesses DOM elements that may not exist if the view section is missing from `index.html` — guard with null checks.
- **Settings proxy:** `settings` is a plain object; direct property assignment bypasses any setter — `saveSettings()` must be called on every field change.

---

### Task 1: Eliminate all prompt()/confirm() calls

**Files:**
- Modify: `js/collection/collection.js:47`, `js/map/map.js:100,529`, `js/home/home.js:53`
- Reference: `css/modals.css` (existing `.modal` styles), `js/ui/contextMenu.js` (generic menu pattern)

**Interfaces:**
- Consumes: `showMenu()` from contextMenu.js (pattern for custom menus), modal DOM from `index.html`
- Produces: `showPrompt(title, placeholder, defaultValue)` → returns `Promise<string|null>`, `showConfirm(msg)` → returns `Promise<boolean>`

- [ ] **Step 1: Add generic modal helpers to `js/core/util.js`**
  Write two functions after the existing exports:
  ```js
  export function promptModal(title, placeholder, defaultValue = "") {
    return new Promise(resolve => {
      const modal = document.getElementById("promptModal");
      const input = document.getElementById("promptInput");
      const ok = document.getElementById("promptOk");
      const cancel = document.getElementById("promptCancel");
      if (!modal) { resolve(null); return; }
      modal.querySelector(".prompt-title").textContent = title;
      input.value = defaultValue;
      input.placeholder = placeholder || "";
      modal.classList.add("open");
      input.focus();
      function cleanup() { modal.classList.remove("open"); input.value = ""; }
      ok.onclick = () => { const v = input.value.trim(); cleanup(); resolve(v); };
      cancel.onclick = () => { cleanup(); resolve(null); };
      input.onkeydown = e => { if (e.key === "Enter") ok.click(); if (e.key === "Escape") cancel.click(); };
    });
  }

  export function confirmModal(msg) {
    return new Promise(resolve => {
      const modal = document.getElementById("confirmModal");
      const txt = document.getElementById("confirmMsg");
      const ok = document.getElementById("confirmOk");
      const cancel = document.getElementById("confirmCancel");
      if (!modal) { resolve(false); return; }
      txt.textContent = msg;
      modal.classList.add("open");
      ok.onclick = () => { modal.classList.remove("open"); resolve(true); };
      cancel.onclick = () => { modal.classList.remove("open"); resolve(false); };
    });
  }
  ```

- [ ] **Step 2: Add prompt/confirm modal HTML to `index.html`** (before closing `</body>`)
  ```html
  <div class="modal" id="promptModal" role="dialog" aria-modal="true" aria-label="Prompt">
    <div class="modal-box">
      <div class="modal-head"><span class="prompt-title"></span><button class="x" id="promptCancel" aria-label="Chiudi">×</button></div>
      <div class="modal-body"><input type="text" id="promptInput" spellcheck="false"></div>
      <div class="modal-foot"><button class="ctl" id="promptCancel2">Annulla</button><button class="ctl accent" id="promptOk">OK</button></div>
    </div>
  </div>
  <div class="modal" id="confirmModal" role="dialog" aria-modal="true" aria-label="Conferma">
    <div class="modal-box">
      <div class="modal-head"><span>Conferma</span><button class="x" id="confirmCancel" aria-label="Chiudi">×</button></div>
      <div class="modal-body"><p id="confirmMsg"></p></div>
      <div class="modal-foot"><button class="ctl accent" id="confirmOk">Conferma</button><button class="ctl" id="confirmCancel2">Annulla</button></div>
    </div>
  </div>
  ```

- [ ] **Step 3: Replace `prompt("Nome cartella:")` in `collection.js:47`**
  ```js
  // BEFORE:
  const n = prompt("Nome cartella:"); if (n?.trim()) { ... }
  // AFTER:
  const n = await promptModal("Nuova cartella", "Nome cartella");
  if (n?.trim()) { state.folders.push({id: uid(), name: n.trim().slice(0, 48)}); save(); renderList(); }
  ```
  Also make `addFolder` async: `export async function addFolder() { ... }`

- [ ] **Step 4: Replace `confirm()` in `map.js:100`**
  ```js
  // BEFORE: if (!confirm('Eliminare la pagina...')) return;
  // AFTER:
  if (!(await confirmModal('Eliminare la pagina "' + state.pages[i].name + '"?'))) return;
  ```
  Make `deletePage` async.

- [ ] **Step 5: Replace `prompt()` for video URL in `map.js:529`**
  ```js
  // BEFORE: const u = prompt("Incolla l'URL del video…", ""); if (u && u.trim()) ...
  // AFTER:
  const u = await promptModal("Incolla URL video", "https://...");
  if (u && u.trim()) addRemoteVideo(nodeId, u.trim());
  ```

- [ ] **Step 6: Replace `prompt()` in `home.js:53`**
  ```js
  // BEFORE: const n = prompt("Nuovo nome:", s.label); if(n) { rename(s.room, n); renderHome(); }
  // AFTER:
  const n = await promptModal("Rinomina spazio", "Nuovo nome", s.label);
  if (n) { rename(s.room, n); renderHome(); }
  ```

- [ ] **Step 7: Verify no remaining prompt()/confirm()**
  Run: `grep -rn "prompt\|confirm" js/ --include="*.js" | grep -v "//" | grep -v "promptModal\|confirmModal"`
  Expected: 0 matches.

- [ ] **Step 8: Commit**
  ```bash
  git add js/core/util.js index.html js/collection/collection.js js/map/map.js js/home/home.js
  git commit -m "fix: replace all prompt()/confirm() with custom modal dialogs"
  ```

---

### Task 2: Wire command palette actions

**Files:**
- Modify: `js/ui/commandPalette.js`
- Modify: `js/main.js` (register actions from each module)
- Reference: `js/map/map.js` (exported functions), `js/home/home.js`, `js/collection/collection.js`

**Interfaces:**
- Consumes: `registerAction(group, label, kbd, fn)` from commandPalette.js; `svc` functions registered by each module
- Produces: All UI actions reachable via Ctrl+K

- [ ] **Step 1: Define action groups and register in `main.js` boot**
  After all `init*()` calls, register:
  ```js
  import { registerAction } from "./ui/commandPalette.js";
  import { addNode } from "./map/map.js";
  import { setPen } from "./map/map.js";
  import { switchView } from "./ui/shell.js";
  import { joinRoom } from "./collab/collab.js";
  import { openTranslate } from "./translate/translate.js";
  import { openLightbox } from "./ui/lightbox.js";

  registerAction("Navigazione", "Vai a Home", "Ctrl+Shift+H", () => switchView("home"));
  registerAction("Navigazione", "Vai a Mappa", "Ctrl+Shift+M", () => switchView("map"));
  registerAction("Navigazione", "Vai a Raccolta", "Ctrl+Shift+C", () => switchView("collection"));
  registerAction("Navigazione", "Vai a Impostazioni", "Ctrl+Shift+I", () => switchView("settings"));
  registerAction("Nodi", "Nuovo nodo", "Ctrl+N", () => svc.addNode && svc.addNode({}));
  registerAction("Mappa", "Modalità penna", "Ctrl+P", () => svc.setPen && svc.setPen(!svc.penIsOn()));
  registerAction("Mappa", "Adatta vista", "Ctrl+0", () => svc.fitAll && svc.fitAll(true));
  registerAction("Raccolta", "Nuovo volume", "Ctrl+Shift+N", () => svc.addVolume && svc.addVolume());
  registerAction("Voce", "Lettura ad alta voce", "Ctrl+R", () => svc.openReader && svc.openReader());
  registerAction("Traduzione", "Traduci volume", "Ctrl+T", () => svc.openTranslate && svc.openTranslate());
  registerAction("Collaborazione", "Entra in stanza", "Ctrl+J", async () => {
    const r = await promptModal("Nome stanza", "es. mio-progetto-01");
    if (r) { svc.joinRoom(r); }
  });
  ```

- [ ] **Step 2: Register actions from each module on boot**
  In each module's init function, add `registerAction` calls for its domain-specific actions (undo/redo, add page, delete node, etc.) — follow the same pattern.

- [ ] **Step 3: Verify Ctrl+K opens palette**
  Run: `npm run dev` → open `http://localhost:5173` → press Ctrl+K → palette opens.

- [ ] **Step 4: Commit**
  ```bash
  git add js/ui/commandPalette.js js/main.js
  git commit -m "feat: wire command palette actions for all modules"
  ```

---

### Task 3: Wire settings panel — tabs switch + fields save

**Files:**
- Modify: `js/main.js` (settings tab wiring — already partially done, needs extension)
- Modify: `js/core/settings.js` (add change listeners)
- Reference: `index.html` `#set-general`, `#set-voice`, `#set-translate`, `#set-ai`, `#set-collab`

**Interfaces:**
- Consumes: `settings` proxy object from settings.js, `saveSettings()`
- Produces: Every field in every tab writes to `settings` and persists on change

- [ ] **Step 1: Enhance settings tab switching in `main.js`**
  The existing code (lines 67–75) already handles tab switching — verify it works by clicking each tab button and confirming the corresponding `#set-*` section gets `.active`.

- [ ] **Step 2: Bind General tab fields**
  Add after `initShell()` call in `boot()`:
  ```js
  const setMyName = document.getElementById("setMyName");
  const setDblNode = document.getElementById("setDblNode");
  if (setMyName) {
    setMyName.value = settings.myName || "";
    setMyName.addEventListener("input", () => { settings.myName = setMyName.value; saveSettings(); });
  }
  if (setDblNode) {
    setDblNode.checked = settings.dblNode !== false;
    setDblNode.addEventListener("change", () => { settings.dblNode = setDblNode.checked; saveSettings(); });
  }
  ```

- [ ] **Step 3: Bind Voice tab fields**
  ```js
  const setTtsProv = document.getElementById("setTtsProv");
  const setSysVoice = document.getElementById("setSysVoice");
  const setElKey = document.getElementById("setElKey");
  if (setTtsProv) {
    setTtsProv.value = settings.ttsProv || "";
    setTtsProv.addEventListener("change", () => { settings.ttsProv = setTtsProv.value; saveSettings(); });
  }
  if (setSysVoice) {
    setSysVoice.value = settings.sysVoice || "";
    setSysVoice.addEventListener("change", () => { settings.sysVoice = setSysVoice.value; saveSettings(); });
  }
  if (setElKey) {
    setElKey.value = settings.elKey || "";
    setElKey.addEventListener("input", () => { settings.elKey = setElKey.value; saveSettings(); });
  }
  ```

- [ ] **Step 4: Bind Translate tab fields**
  ```js
  const setTrProv = document.getElementById("setTrProv");
  const setTrTarget = document.getElementById("setTrTarget");
  if (setTrProv) {
    setTrProv.value = settings.trProvider || "google";
    setTrProv.addEventListener("change", () => { settings.trProvider = setTrProv.value; saveSettings(); });
  }
  if (setTrTarget) {
    setTrTarget.value = settings.trTarget || "en";
    setTrTarget.addEventListener("change", () => { settings.trTarget = setTrTarget.value; saveSettings(); });
  }
  ```

- [ ] **Step 5: Verify settings persist**
  Run: `npm run dev` → change a field → reload page → field retains value.

- [ ] **Step 6: Commit**
  ```bash
  git add js/main.js js/core/settings.js
  git commit -m "feat: wire settings panel fields to persistent storage"
  ```

---

### Task 4: Fix collection module — stubs, folder drag, Carica file

**Files:**
- Modify: `js/collection/collection.js`
- Reference: `js/core/store.js` (state.volumes, state.folders)

**Interfaces:**
- Consumes: `state`, `save()`, `renderCollection()`, `svc` registry
- Produces: Working folder creation, volume CRUD, drag-drop into folders, "Carica file" functional

- [ ] **Step 1: Implement `addVolume()` stub**
  Replace `export function addVolume() {}` with:
  ```js
  export function addVolume(folderId) {
    const v = { id: uid(), name: "Nuovo volume", type: "text", text: "", folderId: folderId || null };
    state.volumes.push(v); save(); renderCollection(); return v;
  }
  ```

- [ ] **Step 2: Implement `deleteVolume()`**
  Replace `export function deleteVolume() {}` with:
  ```js
  export async function deleteVolume(id) {
    if (!(await confirmModal("Eliminare questo volume?"))) return;
    state.volumes = state.volumes.filter(v => v.id !== id); save(); renderCollection();
  }
  ```

- [ ] **Step 3: Implement `focusVolume()`**
  Replace `export function focusVolume() {}` with:
  ```js
  export function focusVolume(id) {
    const v = state.volumes.find(x => x.id === id);
    if (!v) return;
    if (v.type === "pdf" && v.pdf) svc.openPdfViewer && svc.openPdfViewer(id);
    else svc.openReader && svc.openReader(id);
  }
  ```

- [ ] **Step 4: Implement `addFolder()`**
  Replace `export function addFolder() {}` with:
  ```js
  export async function addFolder() {
    const n = await promptModal("Nuova cartella", "Nome cartella");
    if (!n?.trim()) return;
    state.folders.push({ id: uid(), name: n.trim().slice(0, 48) });
    save(); renderCollection();
  }
  ```

- [ ] **Step 5: Implement `deleteFolder()`**
  Replace `export function deleteFolder() {}` with:
  ```js
  export async function deleteFolder(id) {
    if (!(await confirmModal("Eliminare questa cartella e i suoi volumi?"))) return;
    const volIds = state.volumes.filter(v => v.folderId === id).map(v => v.id);
    state.volumes = state.volumes.filter(v => v.folderId !== id && !volIds.includes(v.id));
    state.folders = state.folders.filter(f => f.id !== id); save(); renderCollection();
  }
  ```

- [ ] **Step 6: Wire "Carica file" button**
  In `index.html`, the `#uploadFile` input exists. In `collection.js`, ensure `handleFileSelect` is called when the input changes:
  ```js
  document.getElementById("uploadFile").addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return; handleFileSelect(f); e.target.value = "";
  });
  ```

- [ ] **Step 7: Verify folder drag-drop**
  Run: `npm run dev` → create a folder → drag a volume into it → volume appears under folder.

- [ ] **Step 8: Commit**
  ```bash
  git add js/collection/collection.js
  git commit -m "feat: implement collection stubs, folder CRUD, Carica file wiring"
  ```

---

### Task 5: Fix starfield visibility — z-index and opacity

**Files:**
- Modify: `css/starfield.css`, `css/tokens.css` (opacity values)
- Reference: `css/shell.css` (panel z-indices)

**Interfaces:**
- Consumes: CSS custom properties `--surface`, `--surface-2`, etc.
- Produces: Starfield visible through all translucent panels

- [ ] **Step 1: Verify starfield z-index layers**
  Check `css/starfield.css`: the `#stars` canvas must have `position: fixed; z-index: 0;` and `#nebula` `z-index: 0`. All `.app`, `.view`, `.panel`, `.modal` must have `z-index >= 1` and use `rgba` with alpha ≤ 0.6 for backgrounds.

- [ ] **Step 2: Adjust panel opacity**
  In `css/tokens.css`, ensure `--surface: rgba(13, 17, 40, .35)` (already correct). Verify in `css/shell.css` that `.panel` backgrounds use `var(--surface)` or `var(--surface-2)` with alpha ≤ 0.5.

- [ ] **Step 3: Add z-index guarantee to modal backgrounds**
  In `css/modals.css`, ensure `.modal` has `z-index: 100` and `.modal-box` has `z-index: 101`.

- [ ] **Step 4: Test visibility**
  Run: `npm run dev` → open DevTools → toggle device toolbar → verify stars visible through all panels on all views.

- [ ] **Step 5: Commit**
  ```bash
  git add css/tokens.css css/starfield.css css/modals.css
  git commit -m "fix: ensure starfield visible through translucent panels"
  ```

---

### Task 6: Add prefers-reduced-motion listener to starfield

**Files:**
- Modify: `js/starfield/starfield.js`

**Interfaces:**
- Consumes: `window.matchMedia("(prefers-reduced-motion: reduce)")`
- Produces: Starfield responds to runtime motion preference changes

- [ ] **Step 1: Add motion preference listener**
  After `reduceMotion = ...` in `init()`:
  ```js
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  motionQuery.addEventListener("change", (e) => {
    reduceMotion = e.matches;
    if (reduceMotion) { shoots = []; }
  });
  ```

- [ ] **Step 2: Verify with DevTools**
  Run: DevTools → Rendering → animate → toggle "Prefers reduced motion" → starfield stops/starts.

- [ ] **Step 3: Commit**
  ```bash
  git add js/starfield/starfield.js
  git commit -m "fix: starfield responds to prefers-reduced-motion runtime changes"
  ```

---

### Task 7: Fix collaboration modal wiring

**Files:**
- Modify: `js/collab/collab.js`
- Modify: `js/main.js` (collab button wiring)

**Interfaces:**
- Consumes: `joinRoom(room)`, `leaveRoom()`, `collab.active`, `collab.peers`
- Produces: Collab modal opens, joins room, shows peer status

- [ ] **Step 1: Wire collab button in `main.js`**
  Add after `initCollab()` or directly in `boot()`:
  ```js
  document.getElementById("collabBtn").onclick = () => {
    const modal = document.getElementById("collabModal");
    modal.classList.toggle("open");
    if (modal.classList.contains("open")) {
      document.getElementById("roomInput").focus();
    }
  };
  document.getElementById("collabClose").onclick = () => {
    document.getElementById("collabModal").classList.remove("open");
  };
  document.getElementById("roomJoin").onclick = () => {
    const r = document.getElementById("roomInput").value.trim();
    if (r) { svc.joinRoom(r); document.getElementById("collabModal").classList.remove("open"); }
  };
  document.getElementById("roomLeave").onclick = () => { svc.leaveRoom(); };
  document.getElementById("roomCopyLink").onclick = () => {
    const link = location.origin + location.pathname + "?room=" + (state.pages[state.current]?.name || "room");
    svc.copyText(link).then(() => toast("Link copiato"));
  };
  ```

- [ ] **Step 2: Update peers UI on join/leave**
  The existing `updatePeersUI()` already writes to `#peers`. Ensure `collabModal` opens on `joinRoom()` call.

- [ ] **Step 3: Verify collab flow**
  Run: `npm run dev` → click "Collabora" → modal opens → enter room name → click "Entra / Crea" → peers UI updates.

- [ ] **Step 4: Commit**
  ```bash
  git add js/collab/collab.js js/main.js
  git commit -m "feat: wire collaboration modal and peer status"
  ```

---

### Task 8: Responsive rail → bottom bar on mobile

**Files:**
- Modify: `css/responsive.css`
- Modify: `js/ui/shell.js` (optional: swap rail position)

**Interfaces:**
- Consumes: CSS media queries, `window.innerWidth`
- Produces: Rail becomes bottom bar on screens < 640px

- [ ] **Step 1: Add bottom bar styles to `css/responsive.css`**
  ```css
  @media (max-width: 640px) {
    .rail {
      position: fixed; bottom: 0; left: 0; right: 0; top: auto;
      width: 100%; height: 60px; flex-direction: row;
      padding: 6px 4px; gap: 2px; border-right: none; border-top: 1px solid var(--line);
      overflow-x: auto; overflow-y: hidden;
    }
    .rail-items { flex-direction: row; gap: 2px; width: 100%; }
    .rail-spacer { display: none; }
    .rail-brand { display: none; }
    .rail-item { flex: 1; padding: 4px 2px; font-size: 9px; }
    .rail-item .rail-lbl { display: none; }
    .content { padding-bottom: 68px; }
    .view { padding-bottom: 76px; }
  }
  ```

- [ ] **Step 2: Verify responsive behavior**
  Run: `npm run dev` → toggle device toolbar → resize below 640px → rail slides to bottom.

- [ ] **Step 3: Commit**
  ```bash
  git add css/responsive.css
  git commit -m "feat: rail becomes bottom bar on mobile screens"
  ```

---

### Task 9: Integration QA — build, preview, checklist

**Files:** (no new files; verification only)

**Interfaces:**
- Consumes: All previous task outputs
- Produces: Verified build ready for GitHub Pages

- [ ] **Step 1: Full build**
  Run: `npm run build`
  Expected: Success, output in `dist/`

- [ ] **Step 2: Preview**
  Run: `npx vite preview --port 4173`
  Open: `http://localhost:4173`

- [ ] **Step 3: Checklist verification**
  - [ ] Stars visible on all views (no opaque panels blocking)
  - [ ] Rail nav switches Home/Mappa/Raccolta/Impostazioni
  - [ ] Double-click on map creates a node
  - [ ] Ctrl+K opens command palette with actions
  - [ ] Settings tabs switch and fields save on change
  - [ ] Collection: create folder, add volume, drag-drop, Carica file
  - [ ] Collaboration modal opens, joins room, shows peers
  - [ ] No `prompt()`/`alert()`/`confirm()` in console or UI
  - [ ] No JS errors on load (check DevTools console)
  - [ ] Mobile: rail becomes bottom bar below 640px
  - [ ] `prefers-reduced-motion` disables star animation

- [ ] **Step 4: Commit**
  ```bash
  git add -A
  git commit -m "chore: integration QA pass — all checks green"
  ```
