// shell.js — nav rail, topbar, view switching
import { emit } from "../core/bus.js";

const views = { home: "view-home", map: "view-map", collection: "view-collection", settings: "view-settings" };
let currentRoute = "home";

export function switchView(route) {
  if (!views[route]) return;
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".rail-item").forEach(i => i.classList.remove("active"));
  document.getElementById(views[route]).classList.add("active");
  const railItem = document.querySelector(`.rail-item[data-route="${route}"]`);
  if (railItem) railItem.classList.add("active");
  currentRoute = route;
  location.hash = "#/" + route;
  emit("route:changed", route);
}

export function initShell() {
  document.querySelectorAll(".rail-item[data-route]").forEach(btn => {
    btn.onclick = () => switchView(btn.dataset.route);
  });
  window.addEventListener("hashchange", () => {
    const route = location.hash.slice(2) || "home";
    switchView(route);
  });
  const initial = location.hash.slice(2) || "home";
  switchView(initial);
}
