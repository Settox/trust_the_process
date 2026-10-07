// lightbox.js — visualizzazione ingrandita immagini con pan e zoom
import { svc } from "../core/svc.js";
import { clamp } from "../core/util.js";
import { registerAction } from "../ui/commandPalette.js";

let lb = { s: 1, x: 0, y: 0, fit: 1, nw: 0, nh: 0 };
let lbModal, lbImg, lbStage, lbZoom;

export function openLightbox(src) {
  if (!lbModal) return;
  lbImg.onload = () => {
    lb.nw = lbImg.naturalWidth || 1;
    lb.nh = lbImg.naturalHeight || 1;
    lbImg.style.width = lb.nw + "px";
    lbImg.style.height = lb.nh + "px";
    lbReset();
  };
  lbImg.src = src;
  lbModal.classList.remove("hidden");
}

export function closeLightbox() {
  if (!lbModal) return;
  lbModal.classList.add("hidden");
  lbImg.removeAttribute("src");
}

function applyLb() {
  lbImg.style.transform = `translate(${lb.x}px, ${lb.y}px) scale(${lb.s})`;
  if (lbZoom) lbZoom.textContent = Math.round(lb.s * 100) + "%";
}

function lbReset() {
  const W = window.innerWidth, H = window.innerHeight;
  lb.s = Math.min(W * 0.92 / lb.nw, H * 0.88 / lb.nh);
  lb.fit = lb.s;
  lb.x = (W - lb.nw * lb.s) / 2;
  lb.y = (H - lb.nh * lb.s) / 2;
  applyLb();
}

function lbZoomAt(cx, cy, f) {
  const ns = clamp(lb.s * f, lb.fit * 0.2, Math.max(lb.fit * 25, 8));
  f = ns / lb.s;
  lb.x = cx - (cx - lb.x) * f;
  lb.y = cy - (cy - lb.y) * f;
  lb.s = ns;
  applyLb();
}

export function initLightbox() {
  lbModal = document.getElementById("lightbox");
  lbImg = document.getElementById("lbImg");
  lbStage = document.getElementById("lbStage");
  lbZoom = document.getElementById("lbZoom");

  if (!lbModal) return;

  document.getElementById("lbIn")?.addEventListener("click", () => lbZoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.3));
  document.getElementById("lbOut")?.addEventListener("click", () => lbZoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.3));
  document.getElementById("lbFit")?.addEventListener("click", lbReset);
  document.getElementById("lbClose")?.addEventListener("click", closeLightbox);

  lbStage.addEventListener("wheel", (e) => {
    e.preventDefault();
    lbZoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  lbStage.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY, ox = lb.x, oy = lb.y;
    let moved = false;
    const onImg = e.target === lbImg;

    function mv(ev) {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (Math.hypot(dx, dy) > 3) moved = true;
      lb.x = ox + dx;
      lb.y = oy + dy;
      applyLb();
    }

    function up() {
      window.removeEventListener("pointermove", mv);
      window.removeEventListener("pointerup", up);
      if (!moved && !onImg) closeLightbox();
    }

    window.addEventListener("pointermove", mv);
    window.addEventListener("pointerup", up);
  });

  lbImg.addEventListener("dblclick", () => {
    if (lb.s < 0.999) lbZoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / lb.s);
    else lbReset();
  });

  // ===== Command palette actions for lightbox module =====
  registerAction("Lightbox", "Chiudi lightbox", "Escape", () => { if (!lbModal.classList.contains("hidden")) closeLightbox(); });
}

svc.openLightbox = openLightbox;
svc.closeLightbox = closeLightbox;
