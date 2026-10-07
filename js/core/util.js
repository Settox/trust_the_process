// util.js — helper condivisi
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function clamp(v, a, b) {
  return v < a ? a : (v > b ? b : v);
}

export function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export function r1(x) {
  return Math.round(x * 10) / 10;
}

export function plainText(html) {
  try {
    return new DOMParser().parseFromString(html || "", "text/html").body.textContent || "";
  } catch (e) {
    return "";
  }
}

/* ---- toast ---- */
let _toastTimer = null;
export function toast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

/* ---- clipboard ---- */
export function copyText(t) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(t).catch(() => legacyCopy(t));
  }
  return legacyCopy(t);
}
function legacyCopy(t) {
  return new Promise(res => {
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
    res();
  });
}

/* ---- base64 / blob ---- */
export function blobToBase64(b) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(b);
  });
}

export function base64ToBlob(b64) {
  const m = String(b64).match(/^data:(.*?);base64,(.*)$/);
  const type = m ? m[1] : "application/octet-stream";
  const bin = atob(m ? m[2] : String(b64).replace(/^data:.*?;base64,/, ""));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type });
}

export function downloadJson(obj, name) {
  const blob = new Blob([JSON.stringify(obj)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---- identità / colori peer ---- */
export function hashStr(s) {
  let h = 0;
  s = String(s);
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function hashHue(id) {
  return Math.floor(((hashStr(id) * 0.61803398875) % 1) * 360);
}

export function hueCol(h, a) {
  return "hsla(" + h + ",90%,62%," + a + ")";
}

/* ---- modal dialogs ---- */
export function promptModal(title, placeholder, defaultValue = "") {
  return new Promise(resolve => {
    const modal = document.getElementById("promptModal");
    const input = document.getElementById("promptInput");
    const ok = document.getElementById("promptOk");
    const cancels = [document.getElementById("promptCancel"), document.getElementById("promptCancel2")].filter(Boolean);
    if (!modal) { resolve(null); return; }
    modal.querySelector(".prompt-title").textContent = title;
    input.value = defaultValue;
    input.placeholder = placeholder || "";
    modal.classList.add("open");
    input.focus();
    input.select();
    function cleanup() { modal.classList.remove("open"); input.value = ""; }
    ok.onclick = () => { const v = input.value.trim(); cleanup(); resolve(v); };
    cancels.forEach(c => c.onclick = () => { cleanup(); resolve(null); });
    modal.onclick = (e) => { if (e.target === modal) { cleanup(); resolve(null); } };
    input.onkeydown = e => { if (e.key === "Enter") ok.click(); if (e.key === "Escape") cancels[0] && cancels[0].click(); };
  });
}

export function confirmModal(msg) {
  return new Promise(resolve => {
    const modal = document.getElementById("confirmModal");
    const txt = document.getElementById("confirmMsg");
    const ok = document.getElementById("confirmOk");
    const cancels = [document.getElementById("confirmCancel"), document.getElementById("confirmCancel2")].filter(Boolean);
    if (!modal) { resolve(false); return; }
    txt.textContent = msg;
    modal.classList.add("open");
    ok.onclick = () => { modal.classList.remove("open"); resolve(true); };
    cancels.forEach(c => c.onclick = () => { modal.classList.remove("open"); resolve(false); });
    modal.onclick = (e) => { if (e.target === modal) { modal.classList.remove("open"); resolve(false); } };
  });
}
