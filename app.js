/* =========================================================
   Słoik – metoda spinaczy z „Atomowych nawyków”
   Czysty JavaScript, bez bibliotek. Dane w IndexedDB.
   ========================================================= */
'use strict';

/* ---------- Kolory kulek ---------- */
const COLORS = {
  blue:   { name: 'Niebieska', acc: 'niebieską', label: 'mało ważne',    light: '#b9d4ff', base: '#3b82f6', dark: '#1d3f8f', vibrate: 15 },
  yellow: { name: 'Żółta',     acc: 'żółtą',     label: 'średnio ważne', light: '#fff6bf', base: '#facc15', dark: '#a16207', vibrate: 35 },
  red:    { name: 'Czerwona',  acc: 'czerwoną',  label: 'bardzo ważne',  light: '#ffc4c4', base: '#ef4444', dark: '#8b1c1c', vibrate: [40, 50, 40] },
};
const ORDER = ['blue', 'yellow', 'red'];

/* ---------- Drobne pomocniki ---------- */
const $ = (sel) => document.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const timeOf = (ts) => new Date(ts).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

// Deterministyczna „losowość” z id kulki (żeby słoik zawsze wyglądał tak samo)
function hash01(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

function plural(n, one, few, many) {
  if (n === 1) return one;
  const d = n % 10, t = n % 100;
  return (d >= 2 && d <= 4 && !(t >= 12 && t <= 14)) ? few : many;
}

/* =========================================================
   BAZA DANYCH (IndexedDB)
   Każda kulka: { id, date: 'RRRR-MM-DD', ts, color, note }
   ========================================================= */
const DB = (() => {
  const NAME = 'sloik', STORE = 'balls';
  let dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(NAME, 1);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('date', 'date');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  // Zapis: czekamy aż transakcja się zakończy (dane są wtedy na dysku)
  async function write(fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async function read(fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = fn(db.transaction(STORE, 'readonly').objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  const byTime = (list) => list.sort((a, b) => a.ts - b.ts);

  return {
    put: (ball) => write((s) => s.put(ball)),
    putMany: (list) => write((s) => list.forEach((b) => s.put(b))),
    remove: (id) => write((s) => s.delete(id)),
    byDate: async (key) => byTime(await read((s) => s.index('date').getAll(key))),
    range: async (from, to) => byTime(await read((s) => s.index('date').getAll(IDBKeyRange.bound(from, to)))),
    all: async () => byTime(await read((s) => s.getAll())),
  };
})();

/* =========================================================
   SŁOIK – geometria, rysowanie, fizyka
   ========================================================= */

// Kształt słoika liczony względem rozmiaru płótna (W x H, proporcja 3:4)
function jarGeom(W, H) {
  const t = Math.max(1.2, W * 0.014); // grubość szkła
  const g = {
    W, H, t,
    lidL: W * 0.25, lidR: W * 0.75, lidT: H * 0.015, lidB: H * 0.085,
    neckL: W * 0.23, neckR: W * 0.77, neckT: H * 0.08, neckB: H * 0.125,
    shoulderY: H * 0.21,
    L: W * 0.08, R: W * 0.92, B: H * 0.975, cr: W * 0.16,
  };
  // wnętrze (tam mieszczą się kulki)
  g.iL = g.L + t; g.iR = g.R - t; g.iB = g.B - t; g.icr = g.cr - t;
  g.inL = g.neckL + t; g.inR = g.neckR - t;
  return g;
}

function jarPath(ctx, g, i = 0) {
  const sh = g.neckB + (g.shoulderY - g.neckB) * 0.2;
  ctx.beginPath();
  ctx.moveTo(g.neckL + i, g.neckT);
  ctx.lineTo(g.neckL + i, g.neckB);
  ctx.quadraticCurveTo(g.L + i, sh, g.L + i, g.shoulderY);
  ctx.lineTo(g.L + i, g.B - g.cr);
  ctx.arcTo(g.L + i, g.B - i, g.L + g.cr, g.B - i, g.cr - i);
  ctx.lineTo(g.R - g.cr, g.B - i);
  ctx.arcTo(g.R - i, g.B - i, g.R - i, g.B - g.cr, g.cr - i);
  ctx.lineTo(g.R - i, g.shoulderY);
  ctx.quadraticCurveTo(g.R - i, sh, g.neckR - i, g.neckB);
  ctx.lineTo(g.neckR - i, g.neckT);
  ctx.closePath();
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBall(ctx, x, y, r, color) {
  const c = COLORS[color] || COLORS.blue;
  const gr = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  gr.addColorStop(0, c.light);
  gr.addColorStop(0.5, c.base);
  gr.addColorStop(1, c.dark);
  ctx.fillStyle = gr;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  if (r > 4) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.38, y - r * 0.42, r * 0.22, r * 0.13, -0.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawJar(ctx, g, balls, r, simple) {
  ctx.clearRect(0, 0, g.W, g.H);

  // tylna ścianka szkła
  jarPath(ctx, g);
  const back = ctx.createLinearGradient(g.L, 0, g.R, 0);
  back.addColorStop(0, 'rgba(170,200,255,0.11)');
  back.addColorStop(0.5, 'rgba(170,200,255,0.03)');
  back.addColorStop(1, 'rgba(170,200,255,0.08)');
  ctx.fillStyle = back;
  ctx.fill();

  // kulki (przycięte do wnętrza słoika)
  ctx.save();
  jarPath(ctx, g, g.t);
  ctx.clip();
  for (const b of balls) drawBall(ctx, b.x, b.y, r, b.color);
  ctx.restore();

  // krawędź szkła
  jarPath(ctx, g);
  ctx.lineWidth = Math.max(1, g.t * 0.9);
  ctx.strokeStyle = 'rgba(210,225,255,0.38)';
  ctx.stroke();

  // odblaski
  if (!simple) {
    const top = g.shoulderY + g.H * 0.05, bottom = g.B - g.cr * 0.9;
    const hl = ctx.createLinearGradient(0, top, 0, bottom);
    hl.addColorStop(0, 'rgba(255,255,255,0.28)');
    hl.addColorStop(1, 'rgba(255,255,255,0.02)');
    ctx.fillStyle = hl;
    roundRectPath(ctx, g.L + g.W * 0.05, top, g.W * 0.035, bottom - top, g.W * 0.017);
    ctx.fill();
    roundRectPath(ctx, g.R - g.W * 0.075, top + g.H * 0.04, g.W * 0.014, (bottom - top) * 0.45, g.W * 0.007);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fill();
  }

  // pokrywka
  const lid = ctx.createLinearGradient(0, g.lidT, 0, g.lidB);
  lid.addColorStop(0, '#5b6577');
  lid.addColorStop(1, '#2c3340');
  ctx.fillStyle = lid;
  roundRectPath(ctx, g.lidL, g.lidT, g.lidR - g.lidL, g.lidB - g.lidT, Math.max(2, g.W * 0.025));
  ctx.fill();
  if (!simple) {
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let k = 1; k <= 3; k++) {
      const y = g.lidT + (g.lidB - g.lidT) * (k / 4);
      ctx.beginPath(); ctx.moveTo(g.lidL + 4, y); ctx.lineTo(g.lidR - 4, y); ctx.stroke();
    }
  }
}

// Układa kulki od dna w rzędach (plaster miodu). Zwraca null, jeśli się nie zmieszczą.
function packPositions(n, r, g, limitY) {
  const pos = [];
  let prev = [], prevK = -1;
  const cy = g.B - g.cr, cL = g.L + g.cr, cR = g.R - g.cr, maxD = g.icr - r;
  for (let row = 0; pos.length < n; row++) {
    const y = g.iB - r - row * r * Math.sqrt(3);
    if (y < limitY) return null;
    let minX = g.iL + r, maxX = g.iR - r;
    if (y > cy) {
      const dy = y - cy;
      const ext = Math.sqrt(Math.max(0, maxD * maxD - dy * dy));
      minX = cL - ext; maxX = cR + ext;
    }
    let k = Math.floor((maxX - minX) / (2 * r) + 1e-6) + 1;
    if (k === prevK) k--;
    if (k < 1) { prev = []; prevK = k; continue; }
    const start = (minX + maxX) / 2 - (k - 1) * r;
    const rowPos = [];
    for (let i = 0; i < k; i++) {
      const x = start + i * 2 * r;
      if (prev.every((p) => Math.hypot(p.x - x, p.y - y) >= r * 1.95)) rowPos.push({ x, y });
    }
    pos.push(...rowPos);
    prev = rowPos; prevK = k;
  }
  return pos.slice(0, n);
}

// Im więcej kulek, tym mniejsze – żeby zawsze mieściły się w słoiku
function radiusFor(n, g, start = 0.06) {
  let r = g.W * start;
  const minR = g.W * 0.012, limit = g.H * 0.27;
  while (r > minR && !packPositions(Math.max(n, 1), r, g, limit)) r *= 0.94;
  return r;
}

// Odbija/zatrzymuje kulkę na ściankach słoika
function constrain(b, r, g) {
  const hit = (nx, ny) => { b.hit = true; b.nx = nx; b.ny = ny; };
  if (b.y >= g.shoulderY) {
    if (b.x < g.iL + r) { b.x = g.iL + r; hit(1, 0); }
    if (b.x > g.iR - r) { b.x = g.iR - r; hit(-1, 0); }
  } else {
    if (b.x < g.inL + r) { b.x = g.inL + r; hit(1, 0); }
    if (b.x > g.inR - r) { b.x = g.inR - r; hit(-1, 0); }
  }
  if (b.y > g.iB - r) { b.y = g.iB - r; hit(0, -1); }
  const cy = g.B - g.cr;
  if (b.y > cy) {
    const cx = b.x < g.W / 2 ? g.L + g.cr : g.R - g.cr;
    const inCorner = b.x < g.W / 2 ? b.x < cx : b.x > cx;
    if (inCorner) {
      const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy), max = g.icr - r;
      if (d > max && d > 0) {
        b.x = cx + (dx / d) * max;
        b.y = cy + (dy / d) * max;
        hit(-dx / d, -dy / d);
      }
    }
  }
}

class JarView {
  constructor(canvas, { simple = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.simple = simple;
    this.balls = [];
    this.r = 10;
    this.g = jarGeom(150, 200);
    this.raf = 0;
  }

  setSize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.g = jarGeom(w, h);
  }

  // Ustawia kulki od razu na dnie (bez animacji)
  setData(list, forcedR) {
    // miniaturki: większe kulki, żeby było je widać
    this.r = forcedR || radiusFor(list.length, this.g, this.simple ? 0.1 : 0.06);
    const pos = packPositions(list.length, this.r, this.g, -Infinity) || [];
    this.balls = list.map((d, i) => {
      const p = pos[i] || { x: this.g.W / 2, y: this.g.H * 0.3 };
      const jitter = (hash01(d.id) - 0.5) * this.r * 0.12;
      return { id: d.id, color: d.color, x: p.x + jitter, y: p.y, vx: 0, vy: 0 };
    });
    this.draw();
  }

  draw() { drawJar(this.ctx, this.g, this.balls, this.r, this.simple); }

  // Nowa kulka wpada od góry
  drop(d) {
    const nr = radiusFor(this.balls.length + 1, this.g);
    if (Math.abs(nr - this.r) > 0.01) {
      // słoik się zapełnia – zmniejszamy kulki i układamy je od nowa
      this.setData(this.balls.map((b) => ({ id: b.id, color: b.color })), nr);
    }
    const g = this.g;
    this.balls.push({
      id: d.id, color: d.color,
      x: g.W / 2 + (Math.random() - 0.5) * g.W * 0.12,
      y: g.neckT + this.r,
      vx: (Math.random() - 0.5) * g.W * 0.3,
      vy: 0,
    });
    this.start();
  }

  remove(id) {
    this.balls = this.balls.filter((b) => b.id !== id);
    const nr = radiusFor(this.balls.length, this.g);
    if (Math.abs(nr - this.r) > 0.01) this.setData(this.balls.map((b) => ({ id: b.id, color: b.color })));
    this.start();
  }

  start() {
    this.calm = 0;
    this.frames = 0;
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame((t) => this.tick(t));
    }
  }

  tick(t) {
    const dt = Math.min(0.033, (t - this.last) / 1000);
    this.last = t;
    this.step(dt);
    this.draw();
    this.frames++;
    if (this.calm > 25 || this.frames > 600) { this.raf = 0; return; }
    this.raf = requestAnimationFrame((tt) => this.tick(tt));
  }

  // Prosta fizyka (position based): grawitacja, zderzenia kulek, ścianki, lekkie odbicie
  step(dt) {
    const g = this.g, r = this.r, B = this.balls;
    const G = g.H * 4.5, SUB = 4, h = dt / SUB, min = 2 * r;
    let maxV = 0;
    for (let s = 0; s < SUB; s++) {
      for (const b of B) {
        b.px = b.x; b.py = b.y; b.hit = false;
        b.vy += G * h;
        b.vx *= 0.996;
        b.ivx = b.vx; b.ivy = b.vy;
        b.x += b.vx * h; b.y += b.vy * h;
      }
      for (let it = 0; it < 4; it++) {
        for (let i = 0; i < B.length; i++) {
          const a = B[i];
          for (let j = i + 1; j < B.length; j++) {
            const b = B[j];
            const dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
            if (d2 < min * min) {
              let d = Math.sqrt(d2), nx = 1, ny = 0;
              if (d > 1e-6) { nx = dx / d; ny = dy / d; } else { d = 0; }
              const ov = (min - d) / 2;
              a.x -= nx * ov; a.y -= ny * ov;
              b.x += nx * ov; b.y += ny * ov;
              a.hit = true; a.nx = -nx; a.ny = -ny;
              b.hit = true; b.nx = nx; b.ny = ny;
            }
          }
        }
        for (const b of B) constrain(b, r, g);
      }
      for (const b of B) {
        b.vx = (b.x - b.px) / h;
        b.vy = (b.y - b.py) / h;
        if (b.hit) {
          // odbicie: jeśli kulka uderzyła z dużą prędkością, odbija się lekko
          const vin = b.ivx * b.nx + b.ivy * b.ny;
          if (vin < -g.H * 0.4) {
            const tx = b.ivx - vin * b.nx, ty = b.ivy - vin * b.ny;
            b.vx = tx * 0.85 - vin * 0.3 * b.nx;
            b.vy = ty * 0.85 - vin * 0.3 * b.ny;
          }
        }
      }
    }
    for (const b of B) maxV = Math.max(maxV, Math.hypot(b.vx, b.vy));
    this.calm = maxV < g.H * 0.03 ? this.calm + 1 : 0;
  }
}

/* =========================================================
   APLIKACJA
   ========================================================= */
const LS = {
  get(k, def = null) { try { const v = localStorage.getItem(k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignoruj */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignoruj */ } },
};

// stały identyfikator tego telefonu (żeby odróżnić moje kulki od cudzych)
let ME = LS.get('sloik-me');
if (!ME) { ME = 'u' + uid() + Math.random().toString(36).slice(2, 8); LS.set('sloik-me', ME); }

const state = {
  today: dateKey(),
  todayBalls: [],
  month: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  noteFor: null,
  noteTimer: 0,
  view: 'today',
  // tryb Razem
  pair: LS.get('sloik-pair'),        // { room, name } albo null
  sync: null,                         // połączenie z Firebase
  syncModule: null,
  members: [],
  partnerToday: [],
  stopToday: null,
  watchStart: 0,
};

let todayJar, partnerJar, dayJar, dayPartnerJar;

const paired = () => !!(state.pair && state.sync);

function partnerInfo() {
  const others = state.members.filter((m) => m.id !== ME).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0));
  return others[0] || null;
}
const partnerName = () => (partnerInfo() ? partnerInfo().name : 'Druga osoba');
const myName = () => (state.pair && state.pair.name) || 'Ja';

function fitJar(view, slot) {
  const w = slot.clientWidth, h = slot.clientHeight;
  if (!w || !h) return false;
  const jw = Math.floor(Math.min(w, h * 0.75, 420));
  if (jw < 20) return false;
  view.setSize(jw, Math.floor(jw / 0.75));
  return true;
}

function renderCounts(el, balls) {
  el.innerHTML = '';
  for (const c of ORDER) {
    const n = balls.filter((b) => b.color === c).length;
    const chip = document.createElement('div');
    chip.className = 'count';
    chip.title = `${COLORS[c].name} (${COLORS[c].label})`;
    chip.innerHTML = `<span class="mini-dot ${c}"></span><span>${n}</span>`;
    el.appendChild(chip);
  }
}

/* ---------- Dziś ---------- */
async function loadToday() {
  state.today = dateKey();
  state.todayBalls = await DB.byDate(state.today);
  $('#todayDate').textContent = cap(new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }));
  todayJar.setData(state.todayBalls);
  updateToday();
  if (paired()) watchToday();
}

function updateToday() {
  renderCounts($('#todayCounts'), state.todayBalls);
  $('#undoBtn').disabled = state.todayBalls.length === 0;
  if (paired()) renderCounts($('#partnerCounts'), state.partnerToday);
}

async function addBall(color) {
  if (dateKey() !== state.today) await loadToday(); // minęła północ
  const now = new Date();
  const ball = { id: uid(), date: dateKey(now), ts: now.getTime(), color, note: '' };

  state.todayBalls.push(ball);
  todayJar.drop(ball);
  updateToday();
  if (navigator.vibrate) navigator.vibrate(COLORS[color].vibrate);
  openNote(ball);
  askPersist();

  try { await DB.put(ball); }
  catch (e) { toast('Nie udało się zapisać kulki: ' + e.message); }
  if (state.sync) state.sync.pushBall(ball).catch(() => {});
}

async function undoLast() {
  const last = state.todayBalls.pop();
  if (!last) return;
  if (state.noteFor === last.id) closeNote(false);
  todayJar.remove(last.id);
  updateToday();
  if (navigator.vibrate) navigator.vibrate(10);
  try { await DB.remove(last.id); toast('Cofnięto ostatnią kulkę'); }
  catch (e) { toast('Błąd: ' + e.message); }
  if (state.sync) state.sync.removeBall(last.id).catch(() => {});
}

/* ---------- Pole „za co?” ---------- */
function openNote(ball) {
  const input = $('#noteInput');
  // jeśli coś było wpisane dla poprzedniej kulki – zapisz to
  if (state.noteFor && input.value.trim()) saveNote(state.noteFor, input.value);
  state.noteFor = ball.id;
  input.value = '';
  $('#noteDot').className = 'mini-dot ' + ball.color;
  const sheet = $('#noteSheet');
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  armNoteTimer();
}

function armNoteTimer() {
  clearTimeout(state.noteTimer);
  state.noteTimer = setTimeout(() => {
    if (document.activeElement !== $('#noteInput')) closeNote(true);
  }, 7000);
}

function closeNote(save) {
  clearTimeout(state.noteTimer);
  const input = $('#noteInput');
  if (save && state.noteFor && input.value.trim()) saveNote(state.noteFor, input.value);
  state.noteFor = null;
  input.value = '';
  input.blur();
  const sheet = $('#noteSheet');
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
}

async function saveNote(id, text) {
  const note = text.trim().slice(0, 120);
  const b = state.todayBalls.find((x) => x.id === id);
  if (!b) return;
  b.note = note;
  try { await DB.put(b); } catch (e) { toast('Błąd zapisu opisu'); }
  if (state.sync) state.sync.pushBall(b).catch(() => {});
}

/* ---------- Kalendarz ---------- */
let calToken = 0;

async function renderCalendar() {
  const token = ++calToken;
  const y = state.month.getFullYear(), m = state.month.getMonth();
  const first = new Date(y, m, 1);
  const days = new Date(y, m + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7; // poniedziałek = 0
  $('#monthTitle').textContent = cap(first.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' }));

  const now = new Date();
  $('#nextMonth').disabled = y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth());

  const from = dateKey(first), to = dateKey(new Date(y, m, days));
  const mine = groupByDay(await DB.range(from, to));
  if (token !== calToken) return;
  const two = paired();

  const grid = $('#calGrid');
  grid.innerHTML = '';
  grid.classList.toggle('paired-cal', two);
  for (let i = 0; i < offset; i++) {
    const e = document.createElement('div');
    e.className = 'cal-cell empty';
    grid.appendChild(e);
  }

  const todayKey = dateKey();
  const cells = [];
  for (let d = 1; d <= days; d++) {
    const key = dateKey(new Date(y, m, d));
    const list = mine[key] || [];
    const cell = document.createElement('button');
    cell.className = 'cal-cell';
    if (list.length) cell.classList.add('has');
    if (key === todayKey) cell.classList.add('today');
    const future = key > todayKey;
    if (future) { cell.classList.add('future'); cell.disabled = true; }
    cell.setAttribute('aria-label', `${d}: ${list.length} ${plural(list.length, 'kulka', 'kulki', 'kulek')}`);
    cell.innerHTML = `<span class="num">${d}</span>`;
    if (!future) {
      const jars = document.createElement('div');
      jars.className = 'jars';
      const cv = document.createElement('canvas');
      jars.appendChild(cv);
      let pcv = null;
      if (two) { pcv = document.createElement('canvas'); jars.appendChild(pcv); }
      cell.appendChild(jars);
      cells.push({ key, cv, pcv, list, cell });
      cell.addEventListener('click', () => openDay(key));
    }
    grid.appendChild(cell);
  }

  $('#calHint').innerHTML = two
    ? `<span class="legend"><span>górny: <b>${escapeHtml(myName())}</b></span><span>dolny: <b class="p">${escapeHtml(partnerName())}</b></span></span>`
    : 'Kliknij dzień, żeby zobaczyć jego słoik.';

  // miniaturki słoików (po ułożeniu siatki znamy szerokość komórki)
  const partnerViews = [];
  await new Promise((r) => requestAnimationFrame(r));
  for (const { cv, pcv, list, key, cell } of cells) {
    const full = cell.clientWidth;
    // w trybie Razem dwa słoiki jeden nad drugim (obok siebie byłyby za wąskie)
    const w = Math.max(16, Math.floor(full * (two ? 0.62 : 0.82)));
    const v = new JarView(cv, { simple: true });
    v.setSize(w, Math.floor(w / 0.75));
    v.setData(list);
    if (pcv) {
      const pv = new JarView(pcv, { simple: true });
      pv.setSize(w, Math.floor(w / 0.75));
      pv.setData([]);
      partnerViews.push({ key, pv });
    }
  }

  // kulki drugiej osoby (z internetu albo z pamięci podręcznej)
  if (two && partnerViews.length) {
    try {
      const theirs = groupByDay((await state.sync.range(from, to)).filter((b) => b.who !== ME));
      if (token !== calToken) return;
      for (const { key, pv } of partnerViews) pv.setData(sortByTs(theirs[key] || []));
    } catch (e) { /* offline – zostają puste */ }
  }
}

function groupByDay(list) {
  const out = {};
  for (const b of list) (out[b.date] = out[b.date] || []).push(b);
  return out;
}
const sortByTs = (list) => list.slice().sort((a, b) => a.ts - b.ts);
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Szczegóły dnia ---------- */
let dayKeyOpen = null;

async function openDay(key, push = true) {
  dayKeyOpen = key;
  const mine = await DB.byDate(key);
  const two = paired();
  let theirs = [];
  if (two) {
    try { theirs = sortByTs((await state.sync.range(key, key)).filter((b) => b.who !== ME)); }
    catch (e) { theirs = []; }
  }
  if (dayKeyOpen !== key) return;

  const date = parseKey(key);
  $('#dayTitle').textContent = cap(date.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' }));
  const total = (n) => `${n} ${plural(n, 'kulka', 'kulki', 'kulek')}`;
  $('#daySub').textContent = (two ? `${myName()}: ${total(mine.length)} · ${partnerName()}: ${total(theirs.length)}` : total(mine.length)) +
    (date.getFullYear() !== new Date().getFullYear() ? ` · ${date.getFullYear()}` : '');

  const dv = $('#dayView');
  dv.hidden = false;
  dv.classList.toggle('paired', two);
  if (push) history.pushState({ day: key }, '');

  $('#dayMeName').hidden = !two;
  $('#dayMeName').textContent = myName();
  $('#dayPartnerCol').hidden = !two;
  $('#dayPartnerName').textContent = partnerName();

  await new Promise((r) => requestAnimationFrame(r));
  if (fitJar(dayJar, $('#dayMeSlot'))) dayJar.setData(mine);
  renderCounts($('#dayCounts'), mine);
  if (two) {
    if (fitJar(dayPartnerJar, $('#dayPartnerSlot'))) dayPartnerJar.setData(theirs);
    renderCounts($('#dayPartnerCounts'), theirs);
  }

  // wspólna lista, posortowana po godzinie
  const all = sortByTs([...mine.map((b) => ({ ...b, mine: true })), ...theirs.map((b) => ({ ...b, mine: false }))]);
  const ul = $('#dayList');
  ul.innerHTML = '';
  if (!all.length) {
    const li = document.createElement('li');
    li.className = 'empty-day';
    li.textContent = 'Tego dnia słoik był pusty.';
    ul.appendChild(li);
  }
  for (const b of all) {
    const li = document.createElement('li');
    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = timeOf(b.ts);
    const dot = document.createElement('span');
    dot.className = 'mini-dot ' + b.color;
    const note = document.createElement('span');
    note.className = 'note' + (b.note ? '' : ' empty');
    note.textContent = b.note || 'bez opisu';
    li.append(time, dot, note);
    if (two) {
      const who = document.createElement('span');
      who.className = 'person' + (b.mine ? '' : ' partner');
      who.textContent = b.mine ? myName() : partnerName();
      li.appendChild(who);
    }
    if (b.mine) {
      const edit = document.createElement('button');
      edit.className = 'edit';
      edit.setAttribute('aria-label', 'Edytuj opis');
      edit.textContent = '✎';
      edit.addEventListener('click', async () => {
        const text = prompt('Za co ta kulka?', b.note || '');
        if (text === null) return;
        const rec = { id: b.id, date: b.date, ts: b.ts, color: b.color, note: text.trim().slice(0, 120) };
        await DB.put(rec);
        if (state.sync) state.sync.pushBall(rec).catch(() => {});
        const t = state.todayBalls.find((x) => x.id === b.id);
        if (t) t.note = rec.note;
        b.note = rec.note;
        note.textContent = rec.note || 'bez opisu';
        note.className = 'note' + (rec.note ? '' : ' empty');
      });
      li.appendChild(edit);
    }
    ul.appendChild(li);
  }
}

function closeDay() {
  $('#dayView').hidden = true;
  dayKeyOpen = null;
}

/* =========================================================
   TRYB RAZEM
   ========================================================= */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newRoomCode() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}
const formatCode = (c) => c.match(/.{1,4}/g).join('-');
const normalizeCode = (s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

async function loadSyncModule() {
  if (!state.syncModule) state.syncModule = await import('./sync.js');
  return state.syncModule;
}

async function startSync() {
  if (!state.pair) return;
  try {
    const mod = await loadSyncModule();
    if (!mod.isConfigured()) return;
    state.sync = await mod.connect(state.pair.room, ME, (code) => {
      toast('Błąd połączenia z Firebase: ' + code + '. Wyślij to Claude 🙂');
    });
  } catch (e) {
    console.warn(e);
    toast('Nie udało się połączyć wspólnego słoika');
    return;
  }
  state.sync.watchMembers((members) => {
    state.members = members;
    applyPairedLayout();
    if (state.view === 'together') renderTogether();
  });
  applyPairedLayout();
  watchToday();
}

function watchToday() {
  if (state.stopToday) state.stopToday();
  state.partnerToday = [];
  state.watchStart = Date.now();
  const key = state.today;
  state.stopToday = state.sync.watchDay(key, (list, changes, first) => {
    if (key !== state.today) return;
    const theirs = sortByTs(list.filter((b) => b.who !== ME));
    if (first) {
      state.partnerToday = theirs;
      partnerJar.setData(theirs);
      updateToday();
      return;
    }
    let reset = false;
    for (const { type, ball } of changes) {
      if (ball.who === ME) continue;
      const known = partnerJar.balls.some((x) => x.id === ball.id);
      if (type === 'added' && !known) {
        if (ball.ts > state.watchStart - 60000) {
          partnerJar.drop(ball);
          toast(`${partnerName()} wrzuca ${COLORS[ball.color].acc} kulkę${ball.note ? ': ' + ball.note : ''}`);
        } else {
          reset = true;
        }
      } else if (type === 'removed' && known) {
        partnerJar.remove(ball.id);
      }
    }
    state.partnerToday = theirs;
    if (reset) partnerJar.setData(theirs);
    updateToday();
  });
}

function applyPairedLayout() {
  const two = paired();
  $('#view-today').classList.toggle('paired', two);
  $('#partnerCol').hidden = !two;
  $('#meName').hidden = !two;
  $('#meName').textContent = myName();
  $('#partnerName').textContent = partnerInfo() ? partnerName() : 'czekam na drugą osobę…';
  // przelicz rozmiary słoików po zmianie układu
  requestAnimationFrame(() => {
    if (fitJar(todayJar, $('#meSlot'))) todayJar.setData(state.todayBalls);
    if (two && fitJar(partnerJar, $('#partnerSlot'))) partnerJar.setData(state.partnerToday);
  });
}

async function renderTogether() {
  let configured = false;
  try { configured = (await loadSyncModule()).isConfigured(); } catch (e) { configured = false; }
  $('#tgNoConfig').hidden = configured;
  $('#tgSetup').hidden = !configured || !!state.pair;
  $('#tgPaired').hidden = !configured || !state.pair;
  if (!configured) return;
  if (!state.pair) {
    $('#tgName').value = LS.get('sloik-name', '') || '';
    return;
  }
  $('#tgRoom').textContent = formatCode(state.pair.room);
  const p = partnerInfo();
  $('#tgStatus').textContent = p
    ? `Połączono: ${myName()} + ${p.name} 🎉`
    : 'Czekam, aż druga osoba wpisze kod…';
}

async function pairWith(room) {
  const name = $('#tgName').value.trim();
  if (!name) { toast('Wpisz najpierw swoje imię'); $('#tgName').focus(); return; }
  LS.set('sloik-name', name);
  state.pair = { room, name };
  LS.set('sloik-pair', state.pair);
  await startSync();
  if (!state.sync) { state.pair = null; LS.del('sloik-pair'); return; }
  renderTogether();
  // zapis imienia i całej historii idzie w tle (offline – wyśle się później)
  state.sync.setMember(name).catch((e) => toast('Błąd zapisu imienia: ' + (e.code || e.message)));
  DB.all().then((all) => state.sync.pushMany(all)).catch(() => {});
}

async function createRoom() {
  await pairWith(newRoomCode());
  if (state.pair) toast('Wspólny słoik gotowy, wyślij kod drugiej osobie');
}

async function joinRoom() {
  const code = normalizeCode($('#tgCode').value);
  if (code.length !== 16) { toast('Kod ma 16 znaków, np. ABCD-EFGH-JKLM-NPQR'); return; }
  await pairWith(code);
  if (state.pair) toast('Dołączono do wspólnego słoika 🎉');
}

function leaveRoom() {
  if (!confirm('Opuścić wspólny słoik? Twoje kulki zostają na telefonie.')) return;
  if (state.stopToday) state.stopToday();
  if (state.sync) state.sync.close();
  state.sync = null;
  state.pair = null;
  state.members = [];
  state.partnerToday = [];
  LS.del('sloik-pair');
  applyPairedLayout();
  renderTogether();
}

async function shareCode() {
  const code = formatCode(state.pair.room);
  const text = `Dołącz do mojego Słoika! Wejdź w zakładkę Razem i wpisz kod: ${code}`;
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  copyCode();
}

async function copyCode() {
  try { await navigator.clipboard.writeText(formatCode(state.pair.room)); toast('Skopiowano kod'); }
  catch (e) { toast('Nie udało się skopiować, przepisz kod ręcznie'); }
}

/* ---------- Kopia zapasowa ---------- */
async function buildExport() {
  const balls = await DB.all();
  const payload = { app: 'sloik', version: 1, exportedAt: new Date().toISOString(), balls };
  const name = `sloik-kopia-${dateKey()}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  return { blob, name, count: balls.length };
}

function markExported() {
  LS.set('sloik-last-export', Date.now());
  updateBackupInfo();
}

async function exportData() {
  const { blob, name, count } = await buildExport();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  markExported();
  toast(`Zapisano ${count} ${plural(count, 'kulkę', 'kulki', 'kulek')} do pliku ${name}`);
}

async function shareData() {
  const { blob, name } = await buildExport();
  const file = new File([blob], name, { type: 'application/json' });
  try {
    await navigator.share({ files: [file], title: 'Słoik – kopia zapasowa' });
    markExported();
  } catch (e) {
    if (e.name !== 'AbortError') toast('Nie udało się udostępnić pliku');
  }
}

function validBall(b) {
  return b && typeof b.id === 'string' && b.id.length <= 64 &&
    /^\d{4}-\d{2}-\d{2}$/.test(b.date) &&
    Number.isFinite(b.ts) && Object.prototype.hasOwnProperty.call(COLORS, b.color) &&
    (b.note == null || typeof b.note === 'string');
}

async function importData(file) {
  try {
    const json = JSON.parse(await file.text());
    const list = Array.isArray(json) ? json : json.balls;
    if (!Array.isArray(list)) throw new Error('To nie jest plik kopii Słoika.');
    const clean = list.filter(validBall).map((b) => ({
      id: b.id, date: b.date, ts: b.ts, color: b.color, note: (b.note || '').slice(0, 120),
    }));
    if (!clean.length) throw new Error('W pliku nie ma żadnych kulek.');
    const existing = new Set((await DB.all()).map((b) => b.id));
    const fresh = clean.filter((b) => !existing.has(b.id));
    await DB.putMany(fresh);
    if (state.sync && fresh.length) state.sync.pushMany(fresh).catch(() => {});
    await loadToday();
    if (state.view === 'calendar') renderCalendar();
    updateBackupInfo();
    toast(`Zaimportowano ${fresh.length} ${plural(fresh.length, 'kulkę', 'kulki', 'kulek')}` +
      (clean.length - fresh.length ? ` (pominięto ${clean.length - fresh.length} istniejących)` : ''));
  } catch (e) {
    toast('Import nieudany: ' + e.message);
  }
}

async function updateBackupInfo() {
  const all = await DB.all();
  const days = new Set(all.map((b) => b.date)).size;
  $('#dataInfo').textContent = `Na telefonie: ${all.length} ${plural(all.length, 'kulka', 'kulki', 'kulek')} z ${days} ${plural(days, 'dnia', 'dni', 'dni')}.`;
  const last = LS.get('sloik-last-export');
  $('#lastExport').textContent = last
    ? 'Ostatni eksport: ' + new Date(Number(last)).toLocaleString('pl-PL', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
    : 'Nie zrobiłeś jeszcze kopii.';
}

/* ---------- Różne ---------- */
let toastTimer = 0;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

let persistAsked = false;
function askPersist() {
  // prosi przeglądarkę, żeby nie czyściła danych przy braku miejsca
  if (persistAsked || !navigator.storage || !navigator.storage.persist) return;
  persistAsked = true;
  navigator.storage.persist().catch(() => {});
}

function showView(name) {
  state.view = name;
  for (const v of document.querySelectorAll('.view')) v.classList.toggle('active', v.id === 'view-' + name);
  for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t.dataset.view === name);
  if (name !== 'today') closeNote(true);
  if (name === 'today') applyPairedLayout();
  if (name === 'calendar') renderCalendar();
  if (name === 'together') renderTogether();
  if (name === 'backup') updateBackupInfo();
}

function checkNewDay() {
  if (dateKey() !== state.today) {
    closeNote(true);
    loadToday();
    if (state.view === 'calendar') renderCalendar();
  }
}

/* ---------- Start ---------- */
async function init() {
  todayJar = new JarView($('#jarCanvas'));
  partnerJar = new JarView($('#partnerCanvas'));
  dayJar = new JarView($('#dayCanvas'));
  dayPartnerJar = new JarView($('#dayPartnerCanvas'));
  updateToday(); // liczniki od razu, żeby słoik znał swoje miejsce
  fitJar(todayJar, $('#meSlot'));

  for (const btn of document.querySelectorAll('.ball-btn')) {
    btn.addEventListener('click', () => addBall(btn.dataset.color));
  }
  $('#undoBtn').addEventListener('click', undoLast);

  $('#noteSave').addEventListener('click', () => closeNote(true));
  $('#noteSkip').addEventListener('click', () => closeNote(false));
  $('#noteInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') closeNote(true); });
  $('#noteInput').addEventListener('focus', () => clearTimeout(state.noteTimer));
  $('#noteInput').addEventListener('blur', () => { if (state.noteFor) armNoteTimer(); });

  for (const t of document.querySelectorAll('.tab')) t.addEventListener('click', () => showView(t.dataset.view));

  $('#prevMonth').addEventListener('click', () => { state.month.setMonth(state.month.getMonth() - 1); renderCalendar(); });
  $('#nextMonth').addEventListener('click', () => { state.month.setMonth(state.month.getMonth() + 1); renderCalendar(); });

  $('#dayBack').addEventListener('click', () => history.back());
  window.addEventListener('popstate', () => { if (!$('#dayView').hidden) closeDay(); });

  $('#tgCreate').addEventListener('click', createRoom);
  $('#tgJoin').addEventListener('click', joinRoom);
  $('#tgLeave').addEventListener('click', leaveRoom);
  $('#tgShare').addEventListener('click', shareCode);
  $('#tgCopy').addEventListener('click', copyCode);
  $('#tgCode').addEventListener('input', (e) => {
    const c = normalizeCode(e.target.value).slice(0, 16);
    e.target.value = c ? formatCode(c) : '';
  });

  $('#exportBtn').addEventListener('click', exportData);
  if (navigator.canShare && navigator.canShare({ files: [new File(['{}'], 't.json', { type: 'application/json' })] })) {
    $('#shareBtn').hidden = false;
    $('#shareBtn').addEventListener('click', shareData);
  }
  $('#importInput').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) importData(f);
    e.target.value = '';
  });

  // dopasuj słoiki, gdy zmieni się dostępne miejsce (obrót ekranu, klawiatura itp.)
  const sizes = {};
  const ro = new ResizeObserver((entries) => {
    for (const en of entries) {
      const el = en.target;
      const sig = el.clientWidth + 'x' + el.clientHeight;
      if (sizes[el.id] === sig || !el.clientWidth) continue;
      sizes[el.id] = sig;
      if (el.id === 'meSlot' && fitJar(todayJar, el)) todayJar.setData(state.todayBalls);
      if (el.id === 'partnerSlot' && paired() && fitJar(partnerJar, el)) partnerJar.setData(state.partnerToday);
    }
  });
  ro.observe($('#meSlot'));
  ro.observe($('#partnerSlot'));

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.view === 'calendar') renderCalendar();
      if (dayKeyOpen) openDay(dayKeyOpen, false);
    }, 150);
  });

  // nowy dzień o północy
  setInterval(checkNewDay, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkNewDay(); });

  await loadToday();
  if (state.pair) startSync();
}

init().catch((e) => toast('Błąd uruchomienia: ' + e.message));

if ('serviceWorker' in navigator) {
  // po aktualizacji aplikacji przeładuj raz, żeby od razu działała nowa wersja
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  });
}
