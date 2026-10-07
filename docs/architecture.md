# Architettura — Spazio Teorie v2

## Scelta stack

**Vanilla ES modules, nessuna build.** Deploy statico su GitHub Pages: niente Node a runtime, niente server.

- `index.html` + `js/*.js` (moduli ES) + `css/*.css` + `.nojekyll` + `supabase-config.js`.
- Routing **solo hash**: `#/home`, `#/map`, `#/collection`, `#/settings`. Il link condiviso resta `?room=nome` (query, non hash) per retro-compatibilità; il router lo intercetta e auto-joina.
- Librerie via CDN come l'originale: `pdf.js`, `pdf-lib` (solo traduzione PDF), `@supabase/supabase-js`, Trystero via `esm.sh` (import dinamico).
- `base` relativa: usare percorsi relativi (`./`, `./js/`, `./css/`) così funziona su `https://user.github.io/nome-repo/` e anche in subdirectory.
- Nessun GitHub Actions necessario (solo file statici); fornire comunque `.github/workflows/static.yml` opzionale e istruzioni nel report.

## Struttura cartelle

```
spazio-teorie-v2/
├── .nojekyll
├── index.html
├── supabase-config.js        # esterno, non committato (template: supabase-config.example.js)
├── favicon.svg
├── sfx/                      # copiato dall'originale (easter egg)
├── css/
│   ├── tokens.css            # design token
│   ├── base.css              # reset, tipografia, focus, toast
│   ├── starfield.css         # nebula/stars layer
│   ├── shell.css             # rail, header, layout
│   ├── home.css
│   ├── map.css               # nodi, collegamenti, pannelli, zoom, minimappa
│   ├── collection.css
│   ├── modals.css            # pdf, reader, translate, crop, lightbox, command palette
│   └── responsive.css
├── js/
│   ├── main.js               # boot, router hash, init moduli
│   ├── core/
│   │   ├── util.js           # uid, clamp, escapeHtml, downloadJson, copyText, base64
│   │   ├── store.js          # stato, localStorage, IndexedDB, Supabase, migrazione
│   │   ├── settings.js       # impostazioni dispositivo
│   │   ├── history.js        # cronologia stanze (NUOVA)
│   │   ├── bus.js            # event bus (pub/sub)
│   │   └── i18n.js           # stringhe italiane
│   ├── starfield/starfield.js
│   ├── ui/
│   │   ├── shell.js          # rail, header, routing viste
│   │   ├── commandPalette.js
│   │   ├── contextMenu.js
│   │   └── icons.js
│   ├── home/home.js
│   ├── map/
│   │   ├── map.js            # viewport, pan/zoom/fit, switch pagina, render orchestrator
│   │   ├── nodes.js
│   │   ├── connections.js
│   │   ├── pen.js
│   │   ├── minimap.js
│   │   └── selection.js
│   ├── collection/
│   │   ├── collection.js
│   │   └── upload.js         # "Carica file" + drag&drop + routing tipo file
│   ├── pdf/pdfViewer.js
│   ├── reader/reader.js
│   ├── voice/tts.js          # provider + cache
│   ├── translate/translate.js
│   ├── collab/
│   │   ├── collab.js         # join/leave, Trystero, azioni
│   │   ├── sync.js           # snapshot/applyOps LWW
│   │   └── files.js          # trasferimento blocchi + richiesta file
│   ├── settings/settingsPanel.js
│   └── lightbox.js
├── docs/                     # audit, design, architecture, report
└── tests/                    # (opzionale) playwright QA
```

## API interne (contratti)

- `store` espone: `state`, `getState()`, `setState()`, `save()`, `saveLocal()`, `scheduleServerSave()`, `currentPage()`, `findNode(id)`, `addNode(partial)`, `removeNode(id)`, `normalizeState`, `load(room)`, `storageKey`, `idb*`, `uploadRoomBlob`, `downloadRoomBlob`, `storeBlob`, `hydrateMedia`, `mediaUrls`.
- `bus` espone `on(event,fn)`, `emit(event,data)`. Eventi: `state:changed`, `selection:changed`, `page:changed`, `collab:peers`, `collab:state`, `route:changed`.
- `map` espone `renderGraph()`, `renderNodes()`, `renderConnections()`, `applyView()`, `fitAll(animate)`.
- `collab` espone `joinRoom(room)`, `leaveRoom(show)`, `collabPush()`, `active`, `peers`.
- `settings` espone `settings` (proxy persistente), `saveSettings()`.
- `history` (NUOVA) espone `list()`, `touch(room, meta)`, `rename(room, label)`, `remove(room)`, `seedFromStorage()`.

## Strategia GitHub Pages

1. Percorsi relativi ovunque.
2. `.nojekyll` per impedire a Jekyll di processare file.
3. Routing `#/...` (nessun fallback SPA necessario).
4. `supabase-config.js` esterno (non committare la vera chiave; fornire `.example`).
5. Workflow opzionale `static.yml` (upload della cartella `spazio-teorie-v2/` o della root del repo).

## Strategia migrazione dati (compatibilità)

- Stesse chiavi localStorage, stesso DB IndexedDB, stessa tabella/bucket Supabase, stesso `appId`/stanza Trystero.
- `normalizeState` potenziato (idempotente) + migrazione `settings` (replicare quella originale).
- Prima apertura: `history.seedFromStorage()` scansiona `spazio-teorie-room-v3:*` e popola `spazio-teorie-room-history`.
- Nessuna rottura: se una chiave/stanza esiste, continua a funzionare.

## Ordine di implementazione (moduli)

1. `core` (util, store, settings, bus, i18n) — fondamento.
2. `starfield` — identità visiva.
3. `ui/shell` + router + command palette.
4. `map` (nodes, connections, pen, minimap, selection).
5. `home` + `history`.
6. `collection` + `upload` ("Carica file").
7. `pdf/pdfViewer`, `reader`, `voice/tts`, `translate`.
8. `collab` (collab, sync, files).
9. `settings/settingsPanel`.
10. Integrazione + QA.
