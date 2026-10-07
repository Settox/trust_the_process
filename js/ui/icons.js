// icons.js — icone SVG inline (stroke 1.8, 24x24, coerenti)
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>',
  map: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
  collection: '<path d="m16 6 4 14"/><path d="M12 6v14"/><path d="M8 8v12"/><path d="M4 4v16"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  command: '<path d="M9 6a3 3 0 1 0-3 3h3zM15 6a3 3 0 1 1 3 3h-3zM9 18a3 3 0 1 1-3-3h3zM15 18a3 3 0 1 0 3-3h-3zM9 9h6M9 15h6"/>',
  node: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  pen: '<path d="M15.7 21.3a1 1 0 0 1-1.4 0l-1.6-1.6a1 1 0 0 1 0-1.4l5.6-5.6a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4z"/><path d="m18 13-1.4-6.9a1 1 0 0 0-.7-.8L3.2 2a1 1 0 0 0-1.2 1.2l3.3 12.7a1 1 0 0 0 .8.7L13 18"/><path d="m2.3 2.3 7.3 7.3"/><circle cx="11" cy="11" r="2"/>',
  collab: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M15 3.1a4 4 0 0 1 0 7.8"/>',
  star: '<path d="M12 3l2.5 5.6 6.1.6-4.6 4.1 1.3 6-5.3-3.2L6.7 19.3 8 13.3 3.4 9.2l6.1-.6z"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.7-1.6"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m21 16-5-5L5 20"/>',
  video: '<rect x="2.5" y="5" width="13" height="14" rx="2"/><path d="M15.5 10l6-3v10l-6-3z"/>',
  speak: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M19 5a10 10 0 0 1 0 14"/>',
  translate: '<path d="M3 5h9M7.5 3v2M5.5 5c0 5 2.5 8 5.5 9"/><path d="M12 9c1 1.5 2 2.5 3 3M21 21l-5-9-5 9M14 18h4"/>',
  fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  open: '<path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  leave: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 3"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  folderOpen: '<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v1"/><path d="M3 6v12a2 2 0 0 0 2 2h14.6a2 2 0 0 0 1.9-1.4l2.1-6.4a1.5 1.5 0 0 0-1.4-2H7.4a2 2 0 0 0-1.9 1.4L3 18"/>',
  fold: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
  cover: '<rect x="5" y="2.5" width="14" height="19" rx="2"/><path d="M9 2.5v19"/><circle cx="14" cy="8" r="1.4"/><path d="m11 17 3-3.5 3 3.5"/>',
  epub: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h6M9 11h6"/>',
  help: '<circle cx="12" cy="12" r="9.2"/><path d="M9.4 9.2a2.7 2.7 0 0 1 5.3.8c0 1.8-2.7 2.2-2.7 3.8"/><path d="M12 17.2h.01"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  enter: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>',
  zoomin: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6M11 8v6"/>',
  zoomout: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6"/>',
  play: '<polygon points="6 4 20 12 6 20 6 4"/>',
  next: '<path d="m6 5 7 7-7 7"/><path d="M18 5v14"/>',
  prev: '<path d="m18 5-7 7 7 7"/><path d="M6 5v14"/>',
  close: '<path d="M18 6 6 18M6 6l12 12"/>',
  folderPlus: '<path d="M3 6a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/>'
};

export function icon(name, size = 16, cls = "") {
  const p = P[name] || P.node;
  return '<svg class="' + cls + '" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
}

export function gripIcon(size = 12) {
  return '<svg width="' + size + '" height="16" viewBox="0 0 12 24" fill="currentColor" aria-hidden="true"><circle cx="3" cy="5" r="1.7"/><circle cx="9" cy="5" r="1.7"/><circle cx="3" cy="12" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="3" cy="19" r="1.7"/><circle cx="9" cy="19" r="1.7"/></svg>';
}
