# Audit — Lettura vocale (TTS)

Riferimento: `index.html` righe 2400–2687.

## Provider vocali

| Provider | Id | Funzione | Endpoint | Note |
|---|---|---|---|---|
| Browser | `browser` | `speakSystem()` (2635) | `speechSynthesis` | gratis, pitch/rate, `pickSysVoice(lang)`. |
| ElevenLabs | `eleven` | `ttsEleven()` (2488) | `api.elevenlabs.io/v1/text-to-speech/<voice>` | `xi-api-key`, `output_format=mp3_44100_64`, `previous_text`/`next_text` per continuità. |
| OpenAI-compat | `openai` | `ttsOpenAI()` (2495) | `<base>/audio/speech` | modello/voce/`response_format=mp3`, chiave opzionale per localhost. |
| Google Cloud | `google` | `ttsGoogle()` (2501) | `texttospeech.googleapis.com/v1/text:synthesize?key=` | voce `it-IT-Neural2-A`, `audioEncoding=MP3`. |
| Gemini TTS | `gemini` | `ttsGemini()` (2511) | `generativelanguage...:generateContent` | `responseModalities:["AUDIO"]`, `prebuiltVoiceConfig.voiceName`, PCM→WAV (`pcmToWav`). |

- `ttsProv()` (2487): `settings.ttsProv` → fallback `elKey ? "eleven" : "browser"`.
- `ttsRetry(fn, gateP, cancel)` (2518): 4 tentativi, backoff su 429/5xx/TypeError.

## Cache audio (`cloudTTS`, 2527–2577)

Ordine di risoluzione per ogni frase (signature = sha1 di provider+config+testo):
1. Cache memoria `ttsMem`.
2. Cache IndexedDB store `tts` (key = hash).
3. Cache condivisa stanza: `downloadRoomBlob(key,"tts","audio/mpeg")` (solo se `activeRoom` + server).
4. Generazione una volta (`ttsInFlight` per dedup), salva in IndexedDB + upload stanza.

## Lettore (`readerModal`)

- Stato `rd = { vol, segs, i, playing, audio, token, speed, mode, lang, open, els, cuts }`.
- `openReader(vid, startPage)` (2608): carica blocchi (`volumeBlocks`), `makeSegments` (split frasi, MAX 380 caratteri), `renderReaderList`.
- `playFrom(i)` (2621): ElevenLabs→`elTTS` con prefetch(+1,+2); browser→`speakSystem`.
- Controlli: Play/Pausa (`rdPlay`), prec/succ, velocità (`rdSpeed` 0.75–2×), voce (`rdProv`), impostazioni.
- **Crea nodo / Taglia** durante la lettura (2648–2675): `rdCreateNode(cut)`, `rdCutSegs` (per volumi testo rimuove la frase; per PDF solo salta), `rdUndoCut`.
- Mini-player (`rdMini`, 2679): riduce a barra per ascoltare mentre si lavora.
- Tasti: N (nodo), X (taglia), U (annulla taglio), spazio (play), ←/→.

## Impostazioni voce (settings, 1994–2048)

- `settings`: `ttsProv, sysVoice, sysPitch, speechLang, elKey, elVoice, elModel, oaUrl, oaKey, oaModel, oaVoice, gcKey, gcVoice, gmKey, gmModel, gmVoice, gmRpm`.
- Pannelli per servizio (`ttsBoxes`), "Prova la voce" (`setTest`), "Svuota cache audio" (`setClearCache`).
- `LANGS` (1989): lista lingue `[code, label, BCP47]`.

## Requisito v2

Preservare tutti i 5 provider + cache (memoria/IndexedDB/condivisa) + lettore con nodi/tagli. Riorganizzare le impostazioni voce in sezione "Voce" dedicata.
