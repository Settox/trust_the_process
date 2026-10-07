// contextMenu.js — menu contestuale
import { escapeHtml } from "../core/util.js";
import { icon } from "./icons.js";

const ctx = () => document.getElementById("ctx");

export function showMenu(items, x, y) {
  const el = ctx();
  if (!el) return;
  el.innerHTML = "";
  items.forEach(it => {
    if (it.sep) {
      const d = document.createElement("div");
      d.className = "ctx-sep";
      el.appendChild(d);
      return;
    }
    const d = document.createElement("div");
    d.className = "ctx-item" + (it.danger ? " danger" : "");
    if (it.html) d.innerHTML = it.html;
    else d.innerHTML = (it.icon ? icon(it.icon, 14) : "") + "<span>" + escapeHtml(it.l) + "</span>";
    d.setAttribute("role", "menuitem");
    d.tabIndex = -1;
    d.onclick = (e) => { e.stopPropagation(); closeMenu(); it.fn(); };
    el.appendChild(d);
  });
  el.classList.add("open");
  const r = el.getBoundingClientRect();
  el.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
  el.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
}

export function closeMenu() {
  const el = ctx();
  if (el) el.classList.remove("open");
}

export function initContextMenu() {
  document.addEventListener("click", closeMenu);
  document.addEventListener("contextmenu", (e) => {
    const el = ctx();
    if (!el || !e.target.closest) return;
    if (!e.target.closest("#ctx")) closeMenu();
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
}
