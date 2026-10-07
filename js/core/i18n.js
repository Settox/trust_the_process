// i18n.js — lingua italiana
export const T = {
  app: "Spazio Teorie",
  home: "Home",
  map: "Mappa",
  collection: "Raccolta",
  settings: "Impostazioni",
  personal: "Il mio spazio personale",
  personalDesc: "La tua mappa privata, salvata solo su questo dispositivo.",
  spaces: "Spazi di collaborazione",
  noSpaces: "Nessuno spazio visitato finora.",
  createJoin: "Crea o entra in una stanza",
  roomNamePlaceholder: "es. mio-progetto-01",
  enter: "Entra / Crea",
  open: "Apri",
  copyLink: "Copia link",
  rename: "Rinomina",
  remove: "Rimuovi dalla cronologia",
  lastOpened: "Ultima apertura",
  nodes: "nodi",
  connected: "connessi",
  search: "Cerca",
  sortByName: "Per nome",
  sortByRecent: "Per ultima apertura",
  linkCopied: "Link copiato",
  noResults: "Nessun risultato",
  commandPalette: "Cerca azioni…",
  // map
  newNode: "Nodo",
  pen: "Penna",
  collaborate: "Collabora",
  // ...
};

export const LANGS = [
  ["it", "Italiano", "it-IT"],
  ["en", "Inglese", "en-US"],
  ["fr", "Francese", "fr-FR"],
  ["es", "Spagnolo", "es-ES"],
  ["de", "Tedesco", "de-DE"],
  ["pt", "Portoghese", "pt-PT"],
  ["ru", "Russo", "ru-RU"],
  ["zh-CN", "Cinese (semplificato)", "zh-CN"],
  ["ja", "Giapponese", "ja-JP"],
  ["ko", "Coreano", "ko-KR"],
  ["ar", "Arabo", "ar-SA"],
  ["hi", "Hindi", "hi-IN"],
  ["nl", "Olandese", "nl-NL"],
  ["pl", "Polacco", "pl-PL"],
  ["tr", "Turco", "tr-TR"],
  ["el", "Greco", "el-GR"],
  ["la", "Latino", "it-IT"]
];

export function langName(c) {
  for (const l of LANGS) if (l[0] === c) return l[1];
  return c || "";
}

export function langBcp(c) {
  for (const l of LANGS) if (l[0] === c) return l[2];
  return "it-IT";
}
