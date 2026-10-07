# Design — Spazio Teorie v2

## 1. Sistema grafico stellare (identità)

Le stelle sono l'identità del prodotto, non solo sfondo.

### Campo stellare (`Starfield`)

- **Canvas singolo** ottimizzato (`<canvas>` a schermo intero, `devicePixelRatio` cap a 2).
- **3 livelli di profondità** con parallasse (fattori ~16/42/95 px) e velocità di scintillio diverse.
- **Nebulose**: gradienti radiali multipli animati a bassa frequenza (non `filter:blur` costoso; usare gradienti precalcolati o CSS a layer).
- **Stelle cadenti**: rare (probabilità ~0.7 ogni 1.8s, max 2 attive), con coda a gradiente.
- **Scintillio**: `alpha = base * (0.5 + 0.5*sin(t*k + phase))`.
- **Prestazioni**: `requestAnimationFrame` con delta-time; **pausa** quando `document.hidden` (visibilitychange) o `prefers-reduced-motion`.
- **`prefers-reduced-motion: reduce`** → campo statico (nessuna animazione, nessuna stella cadente, nessun parallasse).
- Contrasto: le stelle sono dietro (`z-index` basso), il testo sopra con sfondi `--panel`/`--glass` semitrasparenti sufficientemente opachi.

### Design token (nuovi, non derivati)

```css
:root {
  /* palette */
  --space-950:#04050d; --space-900:#070a18; --space-800:#0b0f22;
  --surface:#0e1228; --surface-2:#141936; --surface-3:#1b2144;
  --line:#ffffff14; --line-2:#ffffff24;
  --text:#eaf0ff; --text-dim:#9aa3c7; --text-faint:#5f6a94;
  --accent:#8ab4ff; --accent-2:#c9a6ff; --accent-glow:#8ab4ff66;
  --star:#ffffff; --star-warm:#ffe0b3;
  --danger:#ff6b9d; --ok:#6ee7a0; --warn:#ffd166;
  /* radii / depth */
  --r-sm:8px; --r-md:12px; --r-lg:18px;
  --shadow-1:0 4px 24px #00000055; --shadow-2:0 12px 48px #00000088;
  /* motion */
  --ease:cubic-bezier(.2,.8,.2,1); --dur:160ms;
  /* type */
  --font-ui:"Segoe UI",system-ui,sans-serif; --font-display:"Segoe UI",system-ui,sans-serif;
}
```

### Stelle come nodi / presenza

- **Nodo "stella"**: i nodi della mappa hanno un piccolo bagliore (`--accent-glow`) che li rende "punti luminosi in una costellazione"; i collegamenti sono "archi di costellazione" (linee curve con trattini animati).
- **Presenza**: i cursori remoti sono stelle colorate (cerchio con bagliore) — stessa metafora.
- **Home**: le stanze sono "costellazioni" (card con mini-anteprima del grafo + puntini per i peer connessi).

## 2. Information Architecture

### Navigazione principale — rail laterale (dock)

Rail verticale a sinistra (icona + etichetta), sempre visibile su desktop; su mobile diventa bottom bar o drawer:

- **Home** (costellazioni/spazi)
- **Mappa** (canvas del grafo; è anche la vista personale)
- **Raccolta** (volumi/cartelle)
- **Impostazioni** (sezioni)

Header compatto in alto: brand "Spazio Teorie", nome stanza/spazio attivo, stato connessione, **apri command palette (Ctrl/Cmd+K)**, azioni primarie contestuali (Nodo, Penna, Collabora) — spostate dalla vecchia barra affollata.

### Home stellare (nuova)

- **"Il mio spazio personale"** sempre in evidenza (prima card).
- **Spazi di collaborazione** già visitati = costellazioni/card: nome, ultima apertura, numero nodi, anteprima mappa, chi è connesso (se disponibile).
- Azioni per card: **Apri**, **Copia link**, **Rinomina etichetta locale**, **Rimuovi dalla cronologia** (senza cancellare i dati).
- **Crea / entra in una stanza** scrivendo il nome.
- **Ricerca e ordinamento** (nome / ultima apertura).
- Link `?room=nome` apre direttamente quella stanza (auto-join).
- Cronologia in nuova chiave `spazio-teorie-room-history`; popolata alla prima apertura scansionando `spazio-teorie-room-v3:*` già in localStorage.

### Command palette (Ctrl/Cmd+K)

Raggruppate: Navigazione, Nodi, Mappa, Raccolta, Voce/Lettura, Traduzione, Collaborazione, File, Impostazioni, Aiuto. Ricerca fuzzy, navigazione da tastiera (↑↓ Invio Esc), `aria-label`, focus visibile.

### Pannello contestuale (sostituisce `#ctxBar`)

- Selezionando un **nodo**: titolo azioni (dimensione testo A-/A+, colore, riquadro, lucchetto, immagine, video, elimina, fonte).
- Selezionando un **collegamento**: relazione (input), colore, raddrizza, elimina.
- **Penna**: strumenti penna/evidenziatore/gomma, colore, spessore, annulla/cancella/fatto.
- **Selezione multipla**: allineamenti, griglia, distribuisci, elimina.

### Impostazioni in sezioni

`Generale` (nome, cursore/hue, doppio clic crea nodo) · `Voce` (provider + chiavi/opzioni) · `Traduzione` (provider + target) · `Modelli AI` (elenco, RPM, fallback) · `Collaborazione` (spiegazioni/status). Chiavi API **solo dispositivo**, mai nello stato condiviso.

## 3. Accessibilità e responsive

- **Tastiera**: tutti i controlli raggiungibili; focus visibile (`:focus-visible` con outline `--accent`); `aria-label` su icone; dialog con `role="dialog"` + `aria-modal` + focus trap; Esc chiude.
- **Contrasto**: testo `--text` su `--surface` ≥ 7:1; `--text-dim` ≥ 4.5:1.
- **`prefers-reduced-motion`**: disabilita animazioni/parallasse/stelle cadenti.
- **Responsive**: rail → bottom bar su mobile; Raccolta come drawer/overlay su schermi stretti; nodi e pannelli touch-friendly; viewport meta già presente.
- **Lingua**: tutta la UI in italiano (`<html lang="it">`).

## 4. Regole di comportamento (bug/ambiguità da segnalare nel report)

- Non inventare comportamenti: se l'originale ha un comportamento ambiguo, documentarlo nel report finale.
