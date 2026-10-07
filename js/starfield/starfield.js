// starfield.js — campo stellare a più livelli con parallasse, nebulose, stelle cadenti, scintillio
let canvas, ctx;
let field = [], shoots = [];
let mouse = { x: 0, y: 0 };
let running = true;
let reduceMotion = false;
let spawnTimer = null;

const starLayers = [
  { c: 170, r0: 0.2, r1: 0.55, al: 0.55, px: 18 },
  { c: 90,  r0: 0.5, r1: 1.1,  al: 0.8,  px: 44 },
  { c: 40,  r0: 1.0, r1: 1.8,  al: 1,    px: 96 },
  { c: 18,  r0: 1.4, r1: 2.6,  al: 1,    px: 160, big: true }
];

function buildField() {
  field = [];
  starLayers.forEach(L => {
    for (let i = 0; i < L.c; i++) {
      field.push({
        x: Math.random(), y: Math.random(),
        r: L.r0 + Math.random() * (L.r1 - L.r0),
        tw: 0.5 + Math.random() * 1.5,
        ph: Math.random() * Math.PI * 2,
        al: L.al, px: L.px,
        big: !!L.big
      });
    }
  });
}

function spawnShoot() {
  shoots.push({ x: Math.random() * 0.4 + 0.5, y: Math.random() * 0.35, vx: -(0.004 + Math.random() * 0.006), vy: 0.002 + Math.random() * 0.003, life: 1 });
}

function init() {
  canvas = document.getElementById("stars");
  if (!canvas) return;
  ctx = canvas.getContext("2d");
  reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  motionQuery.addEventListener("change", (e) => {
    reduceMotion = e.matches;
    if (reduceMotion) { shoots = []; }
  });
  buildField();
  resize();
  window.addEventListener("resize", resize);
  window.addEventListener("mousemove", e => {
    mouse.x = (e.clientX / window.innerWidth) - 0.5;
    mouse.y = (e.clientY / window.innerHeight) - 0.5;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { running = false; }
    else { running = true; last = performance.now(); requestAnimationFrame(loop); }
  });
  if (!reduceMotion) {
    spawnTimer = setInterval(() => { if (shoots.length < 2 && Math.random() < 0.7) spawnShoot(); }, 1800);
  }
  last = performance.now();
  requestAnimationFrame(loop);
}

function resize() {
  if (!canvas) return;
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

let last = 0;
function draw(t) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const W = canvas.width, H = canvas.height;
  const motion = reduceMotion ? 0 : 1;
  for (let i = 0; i < field.length; i++) {
    const s = field[i];
    const px = s.x * W + mouse.x * s.px * motion;
    const py = s.y * H + mouse.y * s.px * motion;
    const a = s.al * (reduceMotion ? 1 : (0.5 + 0.5 * Math.sin(t * 0.0012 * s.tw + s.ph)));
    ctx.globalAlpha = a;
    ctx.fillStyle = s.big ? "#fff" : "#fff";
    ctx.beginPath();
    ctx.arc(px, py, s.r, 0, Math.PI * 2);
    ctx.fill();
    if (s.big) {
      ctx.globalAlpha = a * 0.25;
      ctx.beginPath();
      ctx.arc(px, py, s.r * 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (!reduceMotion) {
    for (let j = 0; j < shoots.length; j++) {
      const sh = shoots[j];
      sh.x += sh.vx; sh.y += sh.vy; sh.life -= 0.008;
      const qx = sh.x * W, qy = sh.y * H;
      const len = 90;
      const g = ctx.createLinearGradient(qx, qy, qx - sh.vx * len * 60, qy - sh.vy * len * 60);
      g.addColorStop(0, "rgba(255,255,255," + (0.9 * sh.life) + ")");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(qx, qy);
      ctx.lineTo(qx - sh.vx * len * 60, qy - sh.vy * len * 60);
      ctx.stroke();
    }
    shoots = shoots.filter(s => s.life > 0 && s.x > 0);
  }
  ctx.globalAlpha = 1;
}

function loop(t) {
  if (!running) return;
  draw(t);
  requestAnimationFrame(loop);
}

export function startStarfield() { init(); }
