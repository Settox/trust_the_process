# Audit Report: Raccolta (Collection) and PDF Functionality in `index.html`

This document provides a comprehensive inventory and technical audit of all features related to the **Raccolta** (collection/library), **Folders**, **Volumes**, **PDF Loading & Viewing**, **Text Extraction / Cutting**, **Image & Video Handling**, **Drag & Drop**, **Cover Management**, **Volume Menu Actions**, and related synchronization / export mechanisms in `index.html`.

---

## 1. Overview & Data Structures

The application state for the collection resides in the global `state` object (persisted via LocalStorage and Supabase in real-time P2P/rooms):
- `state.folders`: Array of folder objects (`{ id, name, locked }`)
- `state.volumes`: Array of volume objects (`{ id, name, text, type, pdf, folderId, coverId, locked, tr, lang, srcId }`)

---

## 2. Raccolta (Collection & Folder Management)

### A. Rendering Collection (`renderCollection()` & `volumeEl()`)
- **Location**: ~Lines ~944–1026
- **Behavior**:
  - Switches between `Raccolta` (main) and `Tradotti` (translated volumes) tabs based on `collTab`.
  - Renders root-level volumes (`!v.tr && !v.folderId`) and folders (`state.folders`).
  - Supports folder toggling (collapse/expand, persisted in `spazio-teorie-collapsed-folders`), renaming, folder locking (`makeLock`), deletion (`deleteFolder`), and creating new volumes inside folders.

### B. Volume Actions & Properties
- **Volume Fields**:
  - `name`: Editable title (`.volume-name`).
  - `coverId`: ID of the blob stored in IndexedDB used as cover image.
  - `text`: Optional text note attached to text-type volumes.
  - `pdf`: Metadata object (`{ name, pageCount }`) for PDF volumes.
  - `tr` / `lang` / `srcId`: Translation metadata for translated volumes.
- **Volume Menu (`volumeMenu()`)**:
  - ~Lines 2191–2198
  - Actions: "Leggi ad alta voce", "Traduci…", "Sposta su/giù", and moving volumes between root and folders.

### C. Drag & Drop Reordering & Nesting
- **Location**: ~Lines 367–375, 2161–2190
- **Implementation**: HTML5 Drag & Drop API (`dragstart`, `dragover`, `drop`, `dragend`).
- **Capabilities**:
  - Reordering volumes and folders.
  - Dropping volumes into folders or onto root drop zones (`.drop-root`).

---

## 3. PDF Loading, Viewing & Text Extraction

### A. PDF Loading & Storage (`#pdfFile` change handler)
- **Location**: ~Lines 1194–1200
- **Flow**:
  - Reads uploaded PDF file via `FileReader` as `ArrayBuffer`.
  - Stores binary in IndexedDB under store `"pdfs"` keyed by volume ID (`idbPut("pdfs", vid, ab)`).
  - Automatically generates and stores a cover image (page 1 rendered to canvas -> blob -> IndexedDB/storage) (`makeCover()`, ~Lines 1195–1196).
  - Uploads PDF binary to Supabase Storage if in an active room (`uploadRoomBlob()`).

### B. PDF Viewer Modal & Continuous Scrolling (`openPdfViewer()`, `buildPdfPages()`)
- **Location**: ~Lines 1201–1327
- **PDF.js Integration**:
  - Uses `pdf.js` (`3.11.174`) worker (`PDFJS_WORKER`).
  - **Continuous Scroll (`#pdfScroll`)**: Renders page containers (`.pdf-pg`), observing visibility via `IntersectionObserver` (`900px` root margin) to load/unload canvases and text layers dynamically.
  - **Text Layer (`.pdf-tl`)**: Renders transparent text spans over canvases (`buildTextLayer()`, ~Lines 1221–1242) ensuring native text selection, highlighting (`applyPdfHighlight()`, `locatePhrase()`), and custom copy handling (`selectedPdfText()`).

### C. Text Extraction & Cutting from PDF
- **`#pdfCutText`**: Extracts currently selected text in PDF viewer and calls `addNodeFromPdf()` (~Line 1318), creating a canvas/node linked back to the source volume and page (`source: { type: "pdf", volumeId, volumeName, page, phrase, segs }`).
- **`#pdfCutImg` (`#pdfCropBox`)**: Allows cropping a visual region of a PDF page (`startPdfCrop()`, ~Lines 1321–1327), rendering the cropped region to a canvas, storing it as a blob, and inserting an image node linked to the PDF page source (`type: "pdf-image"`).

---

## 4. Image, Video, & Cover Management

### A. Cover Management
- **Trigger**: Click on `.volume-cover` or `.cover-placeholder` (`pendingVolumeId`, `pendingCoverMode = true`).
- **Handling**: Opens `#imageFile` input, stores the blob via `storeBlob()`, sets `v.coverId`, and refreshes the collection view.

### B. Image Handling in Nodes
- **Upload / Paste / Drop**: `#imageFile` listener (~Lines 1157–1172), Clipboard `paste` listener on node bodies (~Lines 1051), and viewport `drop` listener (~Lines 1762–1765).
- **Interactive Features**:
  - Click image to open in **Lightbox** (`openLightbox()`, ~Lines 1333–1346).
  - Context menu on images: Ingrandisci immagine, Ritaglia immagine (`openCrop()` / `cropNodeImage()`).

### C. Video Handling in Nodes
- **Upload / Link**: `#videoFile` listener (~Lines 1181), `promptVideo()` (~Line 1187) supporting direct file uploads (with MIME type guessing/fixing via `guessVideoType()` / `fixVideoBlob()`, ~Lines 1848–1849) or external/YouTube links (`isYoutube()`, `ytEmbed()`, `addRemoteVideo()`, ~Lines 1183–1186).
- **Watch Party (`wpar`)**: Real-time video synchronization across peers in collaborative rooms (`wpSend()`, `wpRecv()`, ~Lines 1710–1730).

---

## 5. Summary Code Snippets & Key Function Reference

| Feature | Function / Handler Name | Approximate Line Range | Description |
| :--- | :--- | :--- | :--- |
| **Collection Render** | `renderCollection()` | 944–983 | Renders folders, volumes, and translated items. |
| **Volume Element** | `volumeEl()` | 984–1026 | Constructs volume DOM (cover, head, buttons, text/notes). |
| **Add Volume / Folder** | `addVolume()`, `addFolder()` | 1027–1031 | Creates new collection entities. |
| **PDF Upload & Storage** | `pdfFile` change handler | 1197–1200 | Stores PDF in IDB & Supabase, triggers cover generation. |
| **PDF Viewer & Scroll** | `openPdfViewer()`, `buildPdfPages()` | 1201–1209 | Opens modal, sets up IntersectionObserver for pages. |
| **PDF Text Layer** | `buildTextLayer()` | 1221–1242 | Creates selectable DOM text spans over PDF canvas. |
| **PDF Text Cutting** | `addNodeFromPdf()` | 1318 | Converts selected PDF text into a linked map node. |
| **PDF Image Cutting** | `#pdfCutImg` handler | 1323–1327 | Crops PDF canvas region into an image node. |
| **Image & Blob Storage** | `storeBlob()`, `uploadRoomBlob()` | 766–795 | Persists files to IndexedDB and Supabase storage. |
| **Drag & Drop Reorder** | `makeGrip()`, `moveVolume()` | 367–375, 2161–2178 | Handles drag-and-drop reordering and folder nesting. |
