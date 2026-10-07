# Audit — Collaborazione P2P (Trystero), Supabase, cursori, watch party

Riferimento: `index.html` righe 695–709, 1337–1686, 1510–1580, 1710–1730.

## Caricamento Trystero

```js
const TRYSTERO_SOURCES = [
  'https://esm.sh/trystero@0.21/torrent',
  'https://esm.sh/trystero@0.21/nostr',
  'https://cdn.jsdelivr.net/npm/trystero@0.21/+esm'
];
```
- `loadTrystero()` prova in ordine finché trova `joinRoom`/`selfId`.
- `joinRoom` → `trysteroJoin({appId:"spazio-teorie-app-v1"}, "room-"+room)`.

## Azioni P2P (azioni dichiarate)

`makeAction(...)` per: `state`, `need`, `file`, `hello`, `ops`, `cur`, `sfx`, `wparty`.

## Ingresso stanza (`joinRoom`, 1582)

1. `cleanRoomName`; se già attivo → `leaveRoom(false)`.
2. In parallelo: `loadRoomFromServer(room)` (Supabase) + `loadTrystero()`.
3. Priorità stato: **server** → cache locale `load(room)` → `defaultState()` (+`ensureRoomOnServer`).
4. `render()` + `hydrateMedia()` in background.
5. Trystero join; registra handler per ogni azione.
6. `history.replaceState` → `?room=<nome>`.

## Sincronizzazione a campi (last-writer-wins)

- `snapshot()`: mappa `{ "node|<id>": {e,id,pid,f}, "conn|...", "draw|...", "folder|...", "vol|...", "meta|pages|folders|vols" }`.
- `FIELDS` (1353): elenco campi sincronizzabili per entità.
- `collabPush`/`collabFlush`: diff contro `lastSnap`, spedisce `ops` con timestamp `nextT()` (Lamport-ish: `floor(lc/1000)+1` + `SITE`).
- `applyOps(list)` (1438): applica con `clock` per campo, tombstone (`tomb`) per cancellazioni, protezione dei campi in digitazione (`typingIn`), animazione `disp` per nodi mossi da remoto.
- `adoptState(pack)` (1462): adotta lo stato completo (prima sync), backup pre-stanza in `spazio-teorie-v3-backup-prima-della-stanza`.

## Cursori e identità

- `queueCursor`/`flushCursor` (1478): spedisce `{x,y,p,h}`; `remoteCursor` disegna cerchi colorati (`hueCol`), `hashHue`/`hashStr` per colore stabile.
- `MY_NAME` (default "Utente NNNN"), `MY_HUE`, `settings.myName/myHue` personalizzabili.

## Trasferimento file P2P (1510–1580)

- `missingFiles()`: elenca blobs/PDF non in IndexedDB.
- `requestMissingFiles(force)`: round-robin sui peer, `send.need`.
- `serveFiles(req,peerId)` → `sendFile` a blocchi `CHUNK=192KB` con `serving` per dedup.
- `receiveFile(data,meta)`: ricompone, salva IndexedDB, `uploadRoomBlob` (per ri-persistenza), aggiorna media/poster/PDF.
- `fetchPdfData(volumeId)`: IndexedDB → server → richiesta P2P con attesa (fino a 300s) e progresso.

## Watch party (1710–1730)

- `wpar[id] = {leader, mode:"lead"|"follow"|"free"}`; `wpSend({k:"start"|"s"|"end", id, t, p})`.
- Lead sincronizza play/pause/seek; follower si allinea (se `|currentTime - t| > 1.2`). Menu contestuale sul `<video>`.

## Easter egg (1948–1962)

- Konami "↑↑↓↓←→←→" → `playEaster()`: cerca file audio in `sfx/` (`easteregg.*`, `sfx.*`, ecc.) e `send.sfx` ai peer.

## Leave / auto-join

- `leaveRoom(show)` (1663): azzera stato collab, torna a stato personale, pulisce URL.
- Auto-join da URL `?room=` (2691).

## Requisito v2

Mantenere identico: `appId:"spazio-teorie-app-v1"`, stanza `"room-"+nome`, azioni/API Trystero, ordine di priorità stato, sincronizzazione a campi LWW, cursori, trasferimento file a blocchi, watch party. Aggiungere: cronologia stanze (Home) e presenza online mostrata nelle card.
