# Audit — UI / CSS / struttura DOM

Riferimento: `index.html` righe 1–710 (HTML/CSS) e handler UI sparsi.

## Struttura DOM attuale

```
#nebula (gradienti sfondo)
#stars (canvas campo stellare)
header
  .row
    .brand (logo + "Spazio Teorie")
    .tabs#tabs (pagine/tab + aggiungi)
    .spacer
    .searchbox (cerca nei nodi + info + prev/next)
    .status (dot + statusText)
    .divider
    button#addNodeBtn ("Nodo")
    button#penBtn ("Penna")
    button#collabBtn ("Collabora")
    button#moreBtn ("⋯" → menu: impostazioni, alleggerisci, esporta, importa, nuovo, aiuto)
    .hidden-legacy (#exportBtn #importBtn #newBtn #helpBtn)
main
  aside (Raccolta)
    .head (titolo + comprimi/espandi + nuova cartella + nuovo volume)
    .coll-tabs (#ctMain "Raccolta", #ctTr "Tradotti")
    .coll-search (#collSearch + #collSearchClear)
    #searchResults
    #collection
  #viewport
    #world
      #svg (collegamenti + glow filter)
      #drawSvg (disegni penna)
    #collToggle
    #ctxBar (contiene #nodeActions, #connActions, #linkPalette, #penBar)
    #cursors (cursori remoti)
    #zoomHud (zoom out / pct / zoom in / fit)
#ctx (menu contestuale)
#toast
input#imageFile, #videoFile, #pdfFile, #importFile (nascosti)
#lightbox (#lbStage #lbImg #lbBar)
#cropModal (ritaglio immagine)
#pdfModal (lettore PDF)
#collabModal (collaborazione)
#settingsModal (voce e traduzione)
#trModal (traduci)
#readerModal (lettura ad alta voce)
#helpModal (come si usa)
#selBox (selezione multipla) + #miniMap (canvas)
```

## Modal attuali (da ripensare)

1. `settingsModal` — monolite "Voce e traduzione" (Generale + Lettura + Traduzione + Modelli AI) → v2: sezioni separate (Generale, Voce, Traduzione, Modelli AI, Collaborazione).
2. `collabModal` — ingresso stanza (nome, Entra/Crea, Esci, Copia link, peers).
3. `pdfModal` — lettore PDF.
4. `readerModal` — lettura vocale (+ mini).
5. `trModal` — traduzione.
6. `cropModal` — ritaglio.
7. `helpModal` — "Come si usa".
8. `lightbox` — zoom immagini.

## Tema visuale attuale (da sostituire)

- Token CSS in `:root`: `--bg:#05060f`, `--glass`, `--panel`, `--line`, `--text:#e9ecf8`, `--dim`, `--accent:#6ec1ff`, `--accent2:#a06bff`, `--danger`, `--ok`, `--warn`, `--r:14px`, `--shadow`.
- Sfondo: `#nebula` (gradienti radiali animati) + `#stars` canvas (3 layer parallasse + stelle cadenti + scintillio).
- Font: "Segoe UI", system-ui. `color-scheme: dark`.
- Palette nodi/linee: `["#6ec1ff","#ff5c8a","#ffd166","#7ae582","#4ecdc4","#b388ff","#ff9e6d","#ffffff"]`.

## Interazioni globali da preservare

- `showMenu(items,x,y)` (1331): menu contestuale con filtri (rimuove voci AI non volute).
- Toast (754), `copyText`/`legacyCopy` (891–895).
- Tastiera: Ctrl/Cmd+Z/Y (undo/redo, 1697), Delete/Backspace (elimina selezione, 1759), Esc (chiudi modali/menu, 1760), Ctrl/Cmd+K **da aggiungere** (command palette).
- Doppio clic sul vuoto → nuovo nodo (1751); contextmenu sul vuoto → menu (nuovo nodo, incolla come nodo, adatta vista, penna, annulla/ripeti, pagina, impostazioni, allineamenti).
- Drag & drop file sul viewport (1762): immagini → nodo, video → nodo.
- Paste immagine nei nodi (1051); incolla immagine (Ctrl+V) globale.

## Help (contenuto da migrare, 660–690)

Elenco completo delle istruzioni utente (nodi, collegamenti, penna, raccolta, PDF, voce, traduzione, collaborazione, export/import). In v2 va riscritto per la nuova UI ma con contenuti equivalenti.

## Requisiti v2 (novità)

- Navigazione principale nuova (rail/dock laterale): Home ⇄ Mappa ⇄ Raccolta ⇄ Impostazioni.
- **Command palette (Ctrl/Cmd+K)** con tutte le azioni.
- Barra/pannello contestuale per nodo, collegamento, penna, selezione multipla (sostituisce `#ctxBar` in testata).
- Impostazioni in sezioni (non più un modale unico).
- Sostituire il menu "⋯" con struttura chiara.
- Layout responsive (desktop + mobile), accessibilità tastiera, focus visibile, `aria-label`.
- Tema stellare: campo a più livelli con parallasse, nebulose, stelle cadenti rare, scintillio; stelle come nodi/indicatori presenza; `prefers-reduced-motion`; canvas ottimizzato; pausa a scheda nascosta; contrasto/leggibilità.
