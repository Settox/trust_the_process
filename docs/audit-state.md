# Audit – Stato e dati

Riferimento funzionale: `Teorimaxing-main/index.html` (righe 710‑812, 1338‑1488, 1974‑1988).

---

## 1. Chiavi `localStorage`

| Chiave | Valore | Linee di riferimento | Note |
|---|---|---|---|
| `spazio-teorie-v3` | JSON `state` | 712 | Stato **personale** (nessuna stanza). |
| `spazio-teorie-room-v3:<nome>` | JSON `state` | 715, 803 | Stato per stanza. `ROOM_KEY_PREFIX = "spazio-teorie-room-v3:"`. |
| `spazio-teorie-v3-backup-prima-della-stanza` | JSON `state` | 1466 | Backup automatico prima di adottare lo stato di una stanza. |
| `spazio-teorie-views` | JSON `{ [pageId]: {x,y,z} }` | 746, 1774 | Pan/zoom per pagina. ```js\ntry{views=JSON.parse(localStorage.getItem("spazio-teorie-views")||"{}")||{};}catch(e){views={};}\n``` |
| `spazio-teorie-collapsed` | JSON `{ [volumeId]: 1 }` | 938‑943 | Volumi compressi. |
| `spazio-teorie-collapsed-folders` | JSON `{ [folderId]: 1 }` | 942‑943 | Cartelle compresse. |
| `spazio-teorie-aside` | `"0"` / `"1"` | 1927‑1929 | Visibilità pannello laterale. |
| `spazio-teorie-colltab` | `"main"` / `"tr"` | 2152‑2153 | Scheda attiva nella Collezione. |
| `spazio-teorie-settings` | JSON `settings` | 1974‑1988 | Impostazioni solo dispositivo (API voce/traduzione, AI, UI). |
| `<KEY>-backup-prima-della-stanza` | JSON `state` | 1466 | Backup temporaneo del local state prima di entrare in una stanza. |

---

## 2. IndexedDB

```js // Line 759‑760
var req = indexedDB.open("spazio-teorie-db", 2);
req.onupgradeneeded = function(e){
  var db = e.target.result;
  if(!db.objectStoreNames.contains("blobs"))   db.createObjectStore("blobs");
  if(!db.objectStoreNames.contains("pdfs"))    db.createObjectStore("pdfs");
  if(!db.objectStoreNames.contains("tts"))    db.createObjectStore("tts");
};
```

* **Database**: `spazio-teorie-db` (versione 2).
* **Object store**:
  * `blobs` – `{blob, type}` (immagini, video, copertine).
  * `pdfs` – `ArrayBuffer` (contenuto PDF).
  * `tts` – `{blob, ts?, shared?}` (cache audio TTS).

Helper disponibili:
```js // Line 758‑765
function openDB(){...}
function idbPut(s,k,v){...}
function idbGet(s,k){...}
function idbDel(s,k){...}
```
---

## 3. Integrazione Supabase (persistenza server)

**Tabella**: `spazio_teorie_projects`
```js // Line 839‑856
await supabaseClient.from("spazio_teorie_projects").upsert({
  server_id: roomAtStart,
  name: roomAtStart,
  state: clean,
  updated_at: new Date().toISOString()
},{onConflict:"server_id"});
```
- Colonne: `server_id` (PK = nome stanza), `name`, `state` (JSON senza campo `current`), `updated_at`.

**Bucket**: `spazio-teorie-files`
```js // Line 775‑790
var path = room + "/" + kind + "/" + id; // es. "myroom/blob/abc123"
await supabaseClient.storage.from("spazio-teorie-files").upload(path, blob, {contentType:..., upsert:true});
```
- Percorsi di salvataggio: `<room>/<kind>/<id>` (senza estensione). Per download con fallback legacy vedi line 790‑794.
---

## 4. Struttura dello stato

```js // Line 801‑805
function defaultState(){
  return {pages:[{id:uid(),name:"Pagina 1",nodes:[],connections:[]}],folders:[],volumes:[],current:0};
}
function storageKey(room){return room?ROOM_KEY_PREFIX+room:PERSONAL_KEY;}
function normalizeState(s){
  if(!s||!Array.isArray(s.pages)||!s.pages.length) return null;
  if(!Array.isArray(s.folders)) s.folders=[];
  if(!Array.isArray(s.volumes)) s.volumes=[];
  if(typeof s.current!=="number") s.current=0;
  s.pages.forEach(p=>{if(!Array.isArray(p.nodes)) p.nodes=[]; if(!Array.isArray(p.connections)) p.connections=[];});
  return s;
}
```

### Entità principali (definite nella costante `FIELDS` – line 1353‑1360)
```js // Line 1353‑1360
var FIELDS = {
  node: ["x","y","w","h","title","body","source","fs","color","bare","locked"],
  conn: ["from","to","color","label","bx","by"],
  page: ["name"],
  vol:  ["name","text","type","pdf","folderId","coverId","locked","tr","lang","srcId"],
  draw: ["color","w","op","pts"],
  folder:["name","locked"]
};
```

- **Node**: posizione (`x,y,w,h`), contenuto (`title,body,source`), stile (`fs,color,bare,locked`).
- **Connection**: collegamento (`from,to`), colore/etichetta, curvatura (`bx,by`).
- **Page**: solo `name`.
- **Volume**: `name`, `text` (note), `type` (`"text"` | `"pdf"`), `pdf` (meta), `folderId`, `coverId`, `locked`, `tr` (se tradotto), `lang`, `srcId` (origine).
- **Folder**: `name`, `locked`.
- **Drawing**: colore, spessore, opacità, punti.
---

## 5. Funzioni di migrazione e normalizzazione

- **`normalizeState(s)`** (Line 804‑811) garantisce che ogni pagina abbia `nodes` e `connections`, e che `folders`/`volumes`/`current` siano presenti.
- **`defaultState()`** (Line 801) crea lo stato iniziale con una pagina “Pagina 1”.
- **`storageKey(room)`** (Line 803) costruisce la chiave `localStorage` per lo stato di una stanza.
- **`cleanRoomName(room)`** (Line 802) pulisce il nome della stanza (max 80 caratteri, solo alfanumerici, `._-`).
- **`snapshot()` / `packState()`** (Line 1355‑1380) creano rappresentazioni ridotte per la sincronizzazione P2P, usando `FIELDS` per includere solo i campi dichiarati.
- **`collabSendState()`** (Line 1389‑1390) invia lo stato completo al peer quando necessario.
---

## 6. Altri componenti collegati
- **Persistenza locale**: `saveLocalState()` (Line 814) e `scheduleLocalSave()` (Line 818‑824) con debounce di 650 ms.
- **Persistenza server**: `scheduleServerSave()` (Line 825‑828) e `persistRoomState()` (Line 830‑844) con debounce di 1200 ms.
- **Import/Export**: funzioni `exportBtn` e `importBtn` (Line 1732‑1748) serializzano stato + media.
- **Watch‑party** e **penna** non influenzano lo schema dello stato.
---

### Riepilogo
Questo documento raccoglie tutti i punti di riferimento (chiavi, DB, tabelle, bucket, struttura dello stato e funzioni di migrazione) necessari per garantire compatibilità con la versione v2. Le chiavi e i nomi dei record **non devono essere modificati**; è consentito aggiungere nuove chiavi (es. `spazio-teorie-room-history`) seguendo lo stesso schema di prefisso `spazio-teorie-`.
