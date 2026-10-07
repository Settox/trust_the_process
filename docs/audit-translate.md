# Audit: Traduzione in Spazio Teorie

Questo documento elenca le funzionalità di traduzione integrate nell'applicazione "Spazio Teorie" (basate su `index.html`).

## Panoramica
La funzionalità di traduzione permette di tradurre volumi di testo o PDF, salvando il risultato come un nuovo volume separato nella scheda "Tradotti".

## Interfaccia Utente (UI)
- **Modale di Traduzione (`trModal`)**:
  - Definita a `Line 622-634`.
  - Include un selettore per la lingua (`#trLang`), una barra di avanzamento (`trBar` - `Line 385`), informazioni sullo stato (`#trInfo`) e controlli (`#trGo` per avviare, `#trStop` per interrompere).
- **Scheda "Tradotti"**:
  - Gestita tramite `collTab === 'tr'` (`Line 945`).
  - Visualizza i volumi con `v.tr === true`.
- **Pulsante Traduci**:
  - Presente in ogni volume (se non già tradotto o se contiene testo) come icona di traduzione (`trB`, `Line 1010-1011`).
- **Chip Tradotto (`tr-chip`)**:
  - Indica se un volume è tradotto e mostra la lingua di destinazione e il volume originale (`Line 1011`).

## Servizi di Traduzione
L'applicazione supporta diverse modalità di traduzione configurabili nelle impostazioni (`setTrProv`):

1.  **Traduttore del browser (`browser`)**:
    - Utilizza le API di traduzione del browser (`self.Translator`, `Line 2254-2260`).
    - Disponibile in Chrome su desktop.
2.  **Traduttore web gratuito (`google`)**:
    - Chiamate non ufficiali a Google Translate (`gtMulti`, `gtPost`, `gtGet`, `Line 2261-2279`).
3.  **LibreTranslate (`libre`)**:
    - Richiede un server dedicato (`settings.ltUrl`, `Line 2246`).
4.  **Modelli AI (`ai`)**:
    - Utilizza modelli configurabili (Gemini, Claude, OpenAI, ecc.) tramite `aiTranslate` (`Line 2465`).
    - Utilizza un system prompt specifico (`trSys`, `Line 2417`).

## Funzionalità Principali

### Logica di Traduzione
- **Traduzione Testo**:
  - La funzione principale è `openTranslate(vid)` (`Line 2233`).
  - Gestita in blocchi con `chunkBlocks` (`Line 2285`) per superare limiti di dimensione.
  - Supporta tentativi automatici in caso di errore (`translateRetry`, `Line 2280`).
- **Traduzione PDF**:
  - Utilizza `runPdfTranslation` (`Line 2292`).
  - Estrae il testo, lo traduce mantenendo il layout (usando `pdf-lib` per ricreare il PDF) e sovrappone il testo tradotto (o usa immagini).

### Supporto Tecnico
- **`trSys(target)`**: Costruisce il prompt per i modelli AI.
- **`trParagraphs(tc, vp)`**: Estrae paragrafi dal PDF (`Line 2349`).
- **`translateChunk(text, target)`**: Selezione del provider (`Line 2241`).
- **`chunkBlocks`**: Suddivisione del testo per i limiti del provider (`Line 2285`).
