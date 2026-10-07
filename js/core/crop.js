// crop.js — shared crop box logic (used by map and pdf viewer)
export function rectOf(box) { return { x: box.offsetLeft, y: box.offsetTop, w: box.offsetWidth, h: box.offsetHeight }; }

export function setBoxRect(box, x, y, w, h) {
  box.style.left = x + "px"; box.style.top = y + "px"; box.style.width = w + "px"; box.style.height = h + "px";
}

export function attachCropBox(box, stage) {
  box.addEventListener("pointerdown", function (e) {
    e.preventDefault(); e.stopPropagation();
    const mode = e.target.classList.contains("ch") ? "resize" : "move";
    let hn = "";
    if (e.target.classList.contains("ch")) hn = Array.prototype.filter.call(e.target.classList, c => c !== "ch").join("");
    const sx = e.clientX, sy = e.clientY, r = rectOf(box), sw = stage.clientWidth || 800, sh = stage.clientHeight || 600;
    box.setPointerCapture(e.pointerId);
    function mv(ev) {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      let x = r.x, y = r.y, w = r.w, h = r.h;
      if (mode === "move") { x = clamp(r.x + dx, 0, sw - w); y = clamp(r.y + dy, 0, sh - h); }
      else {
        if (hn.indexOf("w") >= 0) { x = r.x + dx; w = r.w - dx; }
        if (hn.indexOf("e") >= 0) { w = r.w + dx; }
        if (hn.indexOf("n") >= 0) { y = r.y + dy; h = r.h - dy; }
        if (hn.indexOf("s") >= 0) { h = r.h + dy; }
        w = Math.max(12, w); h = Math.max(12, h);
        x = clamp(x, 0, sw); y = clamp(y, 0, sh);
        if (x + w > sw) w = sw - x; if (y + h > sh) h = sh - y;
      }
      setBoxRect(box, x, y, w, h);
    }
    function up() { box.removeEventListener("pointermove", mv); box.removeEventListener("pointerup", up); box.removeEventListener("pointercancel", up); }
    box.addEventListener("pointermove", mv); box.addEventListener("pointerup", up); box.addEventListener("pointercancel", up);
  });
}

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
