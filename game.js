'use strict';

// ── Constants ────────────────────────────────────────────────────────────────

const SHARE_URL = 'https://flickyclicky.vercel.app/';

// Replace with your Firebase project's web app config (Project settings → General →
// Your apps → SDK setup and configuration → Config). Leaving this as the placeholder
// disables the daily leaderboard but the game works fine without it.
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyBGELmPeIsil2nB-Ux-iz7xDzLCbhsV2rg',
  authDomain: 'flickyclicky.firebaseapp.com',
  projectId: 'flickyclicky',
};

const LB_COLLECTION  = 'leaderboard_days';
const LB_NAME_MAX_LEN = 16;

const TARGETS_PER_ROUND   = 18;
const TARGET_RADIUS       = 44;
const RING_RADII          = [10, 20, 32, TARGET_RADIUS];
const POPUP_DURATION      = 1900;
const SPAWN_GAP_MIN       = 750;
const SPAWN_GAP_MAX       = 2000;
const BURST_GAP_MIN       = 0;    // targets that nearly overlap
const BURST_GAP_MAX       = 180;
const BURST_CHANCE        = 0.28; // ~28% of gaps are bursts
const SPEED_PEAK          = 200;  // base speed score, awarded near-instantly
const SPEED_DECAY_MS      = 300;  // exponential decay time constant (ms)
const ACCURACY_MULT       = [1.5, 1.2, 1.0, 0.8]; // bullseye -> outer ring multiplier
const TYPE_SCORE_MULT     = { popup: 1, drifter: 1.2, flyby: 1.35 }; // moving-target bonus
const DRIFTER_SPEED_RANGE = [90, 160];
const FLYBY_SPEED_RANGE   = [250, 380];
const CANVAS_W            = 700;
const CANVAS_H            = 420;
const MAX_SCORE           = 3600;
const MISS_PENALTY        = 50;

const TYPE_POOL = [
  ...Array(10).fill('popup'),
  ...Array(5).fill('drifter'),
  ...Array(3).fill('flyby'),
];

const RING_EMOJI = ['🎯', '✅', '🟡', '⭕'];
const MISS_EMOJI = '❌';

const GRADE_THRESHOLDS = [
  [0.90, 'S'],
  [0.75, 'A'],
  [0.55, 'B'],
  [0.35, 'C'],
  [0,    'D'],
];

const TYPE_THEME = {
  popup:   { ring: ['#2a3a2a','#1e4a1e','#22662b','#33aa44'], border: ['#3a5a3a','#2d7a2d','#33aa44','#66ff88'], dot: '#88ffaa', cross: 'rgba(136,255,170,0.35)' },
  drifter: { ring: ['#1a2a3a','#1a3a5a','#1a5a8a','#2288cc'], border: ['#2a4a6a','#2266aa','#2288cc','#55bbff'], dot: '#88ddff', cross: 'rgba(100,200,255,0.35)' },
  flyby:   { ring: ['#3a2010','#5a2a0a','#8a4400','#cc7700'], border: ['#6a3a10','#aa5500','#cc7700','#ffaa22'], dot: '#ffcc55', cross: 'rgba(255,180,50,0.35)' },
};

// ── Seeded RNG ────────────────────────────────────────────────────────────────

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function makeDailySeed() {
  const d = new Date();
  const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return { seed: hashStr(key), key };
}

function rngRange(rng, lo, hi) { return lo + rng() * (hi - lo); }
function rngInt(rng, lo, hi)   { return Math.floor(rngRange(rng, lo, hi + 1)); }
function rngShuffle(rng, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Round generation ──────────────────────────────────────────────────────────

const MIN_SPAWN_DIST = TARGET_RADIUS * 2.2; // stationary popups must not overlap on spawn

function overlapsExistingPopup(x, y, spawnTime, duration, targets) {
  for (const t of targets) {
    if (t.type !== 'popup') continue;
    const overlapsInTime = spawnTime < t.spawnTime + t.duration && t.spawnTime < spawnTime + duration;
    if (overlapsInTime && Math.hypot(x - t.x, y - t.y) < MIN_SPAWN_DIST) return true;
  }
  return false;
}

function generateRound(rng) {
  const types   = rngShuffle(rng, TYPE_POOL);
  const targets = [];
  let t = 1200;

  for (let i = 0; i < TARGETS_PER_ROUND; i++) {
    const type      = types[i];
    const spawnTime = t;
    const isBurst   = i > 0 && rng() < BURST_CHANCE;
    t += isBurst
      ? rngRange(rng, BURST_GAP_MIN, BURST_GAP_MAX)
      : rngRange(rng, SPAWN_GAP_MIN, SPAWN_GAP_MAX);

    if (type === 'popup') {
      let x, y, attempts = 0;
      do {
        x = rngRange(rng, TARGET_RADIUS + 30, CANVAS_W - TARGET_RADIUS - 30);
        y = rngRange(rng, TARGET_RADIUS + 30, CANVAS_H - TARGET_RADIUS - 30);
        attempts++;
      } while (overlapsExistingPopup(x, y, spawnTime, POPUP_DURATION, targets) && attempts < 20);
      targets.push({ type, spawnTime, x, y, duration: POPUP_DURATION });
    } else {
      const speedRange = type === 'flyby' ? FLYBY_SPEED_RANGE : DRIFTER_SPEED_RANGE;
      const speed = rngRange(rng, speedRange[0], speedRange[1]);
      const edge  = rngInt(rng, 0, 3);
      let x, y, vx = 0, vy = 0;
      if (edge === 0) {
        x = -TARGET_RADIUS; y = rngRange(rng, TARGET_RADIUS + 20, CANVAS_H - TARGET_RADIUS - 20);
        vx = speed; vy = rngRange(rng, -speed * 0.35, speed * 0.35);
      } else if (edge === 1) {
        x = CANVAS_W + TARGET_RADIUS; y = rngRange(rng, TARGET_RADIUS + 20, CANVAS_H - TARGET_RADIUS - 20);
        vx = -speed; vy = rngRange(rng, -speed * 0.35, speed * 0.35);
      } else if (edge === 2) {
        y = -TARGET_RADIUS; x = rngRange(rng, TARGET_RADIUS + 20, CANVAS_W - TARGET_RADIUS - 20);
        vy = speed; vx = rngRange(rng, -speed * 0.35, speed * 0.35);
      } else {
        y = CANVAS_H + TARGET_RADIUS; x = rngRange(rng, TARGET_RADIUS + 20, CANVAS_W - TARGET_RADIUS - 20);
        vy = -speed; vx = rngRange(rng, -speed * 0.35, speed * 0.35);
      }
      const mainSpeed = Math.max(Math.abs(vx), Math.abs(vy));
      const crossTime = ((Math.max(CANVAS_W, CANVAS_H) + TARGET_RADIUS * 4) / mainSpeed) * 1000;
      targets.push({ type, spawnTime, x, y, vx, vy, duration: crossTime });
    }
  }
  return targets;
}

// ── Web Audio ─────────────────────────────────────────────────────────────────

let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playTone(freq, type, gainPeak, duration, freqEnd) {
  if (muted) return;
  const now = audioCtx.currentTime;
  const g = audioCtx.createGain();
  const o = audioCtx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, now);
  if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, now + duration);
  g.gain.setValueAtTime(gainPeak, now);
  g.gain.exponentialRampToValueAtTime(0.001, now + duration);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(now); o.stop(now + duration);
}

function playHit(ringIndex) {
  ensureAudio();
  const freqs = [1100, 770, 550, 385];
  const freq  = freqs[ringIndex] ?? 330;
  playTone(freq, ringIndex === 0 ? 'sine' : 'triangle', 0.28, 0.22, freq * 0.45);
  if (ringIndex === 0) playTone(freq * 2, 'sine', 0.12, 0.25, freq);
}

function playMiss() {
  ensureAudio();
  playTone(140, 'sawtooth', 0.06, 0.1, 80);
}

function playCombo(streak) {
  ensureAudio();
  const freq = 440 * Math.pow(1.12, Math.min(streak - 3, 8));
  playTone(freq, 'sine', 0.18, 0.15, freq * 1.5);
}

function playCountdown(isGo) {
  ensureAudio();
  playTone(isGo ? 880 : 440, 'triangle', 0.22, isGo ? 0.35 : 0.12);
}

function playResultFanfare(grade) {
  ensureAudio();
  const seqs = {
    S: [523, 659, 784, 1047],
    A: [440, 554, 659, 880],
    B: [392, 494, 587],
    C: [330, 392, 494],
    D: [262, 294, 330],
  };
  (seqs[grade] ?? seqs.C).forEach((f, i) => {
    setTimeout(() => playTone(f, 'sine', 0.14, 0.28), i * 110);
  });
}

// ── Particles ─────────────────────────────────────────────────────────────────

const particles = [];

function spawnHitParticles(cx, cy, ringIndex, scale) {
  const colors = ['#ffd700','#a8e6cf','#ffcc5c','#e0e0e0'];
  const color  = colors[ringIndex] ?? '#e0e0e0';
  const count  = ringIndex === 0 ? 16 : 9;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 / count) * i + Math.random() * 0.5;
    const spd   = 90 + Math.random() * 140;
    particles.push({
      x: cx, y: cy,
      vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd,
      life: 1, decay: 0.035 + Math.random() * 0.025,
      r: (2.5 + Math.random() * 3) * scale, color,
    });
  }
  particles.push({ type: 'ring', x: cx, y: cy, r: TARGET_RADIUS * scale * 0.5, life: 1, decay: 0.065, color, scale });
}

function spawnScorePopup(cx, cy, points, scale) {
  particles.push({
    type: 'text', x: cx, y: cy - 14 * scale, vy: -60,
    text: `+${points}`, life: 1, decay: 0.022, scale,
  });
}

const trailMap = new Map();

function updateTrail(idx, cx, cy, now) {
  if (!trailMap.has(idx)) trailMap.set(idx, []);
  const trail = trailMap.get(idx);
  trail.push({ x: cx, y: cy, t: now });
  while (trail.length > 0 && now - trail[0].t > 280) trail.shift();
}
function clearTrail(idx) { trailMap.delete(idx); }

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= p.decay;
    if (p.life <= 0) { particles.splice(i, 1); continue; }
    if (p.type === 'text') {
      p.y += p.vy * dt;
    } else if (p.type === 'ring') {
      p.r += (TARGET_RADIUS * p.scale * 1.4 - p.r) * 0.22;
    } else {
      p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 180 * dt;
    }
  }
}

function drawParticles(ctx, goldColor) {
  for (const p of particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.life);
    if (p.type === 'text') {
      ctx.font = `bold ${Math.round(15 * p.scale)}px 'Segoe UI', system-ui, sans-serif`;
      ctx.fillStyle = goldColor; ctx.textAlign = 'center';
      ctx.shadowColor = goldColor; ctx.shadowBlur = 6 * p.scale;
      ctx.fillText(p.text, p.x, p.y);
    } else if (p.type === 'ring') {
      ctx.strokeStyle = p.color; ctx.lineWidth = 2 * p.scale;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
}

// ── Ambient idle animation ────────────────────────────────────────────────────

const ambientTargets = [];

function initAmbient() {
  ambientTargets.length = 0;
  const types = ['popup', 'popup', 'drifter', 'flyby', 'drifter', 'popup'];
  const positions = [
    [120, 90], [520, 300], [320, 200], [80, 300], [580, 110], [400, 340],
  ];
  types.forEach((type, i) => {
    const [bx, by] = positions[i];
    const speed = type === 'flyby' ? 55 : type === 'drifter' ? 28 : 0;
    const angle = Math.random() * Math.PI * 2;
    ambientTargets.push({
      type,
      x: bx + (Math.random() - 0.5) * 60,
      y: by + (Math.random() - 0.5) * 40,
      vx: type === 'popup' ? 0 : Math.cos(angle) * speed,
      vy: type === 'popup' ? 0 : Math.sin(angle) * speed,
      phase: Math.random() * Math.PI * 2,
    });
  });
}

function updateAmbient(dt) {
  for (const t of ambientTargets) {
    t.x += t.vx * dt;
    t.y += t.vy * dt;
    t.phase += dt;
    // wrap around with margin
    const m = TARGET_RADIUS + 20;
    if (t.x < -m) t.x = CANVAS_W + m;
    if (t.x > CANVAS_W + m) t.x = -m;
    if (t.y < -m) t.y = CANVAS_H + m;
    if (t.y > CANVAS_H + m) t.y = -m;
  }
}

function drawAmbient(ctx, scale) {
  ctx.save();
  for (const t of ambientTargets) {
    const cx = t.x * scale;
    const cy = t.y * scale;
    const theme = TYPE_THEME[t.type];
    const pulse = 1 + 0.04 * Math.sin(t.phase * 0.8);
    const alpha = 0.10 + 0.04 * Math.sin(t.phase * 1.1);

    ctx.globalAlpha = alpha;

    const ringR = RING_RADII.map(rr => rr * scale * pulse);
    for (let i = ringR.length - 1; i >= 0; i--) {
      ctx.beginPath(); ctx.arc(cx, cy, ringR[i], 0, Math.PI * 2);
      ctx.fillStyle = theme.ring[i]; ctx.fill();
    }
    // outer border only
    ctx.beginPath(); ctx.arc(cx, cy, ringR[ringR.length - 1], 0, Math.PI * 2);
    ctx.strokeStyle = theme.border[ringR.length - 1];
    ctx.lineWidth = 1 * scale; ctx.stroke();
  }
  ctx.restore();
}

// ── Target rendering ──────────────────────────────────────────────────────────

function drawTrail(ctx, idx, type, scale) {
  const trail = trailMap.get(idx);
  if (!trail || trail.length < 2) return;
  const theme = TYPE_THEME[type] ?? TYPE_THEME.popup;
  ctx.save();
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i-1], b = trail[i];
    const frac = i / trail.length;
    ctx.globalAlpha = frac * 0.45;
    ctx.strokeStyle = theme.dot;
    ctx.lineWidth   = TARGET_RADIUS * scale * 2 * frac * 0.5;
    ctx.lineCap     = 'round';
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
}

function drawTarget(ctx, tgt, idx, elapsed, scale) {
  const age  = elapsed - tgt.spawnTime;
  const frac = age / tgt.duration;
  let cx, cy;

  if (tgt.type === 'popup') {
    cx = tgt.x * scale; cy = tgt.y * scale;
  } else {
    cx = (tgt.x + tgt.vx * age / 1000) * scale;
    cy = (tgt.y + tgt.vy * age / 1000) * scale;
    updateTrail(idx, cx, cy, elapsed);
    drawTrail(ctx, idx, tgt.type, scale);
  }

  const theme = TYPE_THEME[tgt.type] ?? TYPE_THEME.popup;
  const r = TARGET_RADIUS * scale;

  let alpha = 1;
  if (frac < 0.07) alpha = frac / 0.07;
  if (tgt.type === 'popup' && frac > 0.78) alpha = 1 - (frac - 0.78) / 0.22;
  alpha = Math.max(0, Math.min(1, alpha));

  let pulse = 1;
  if (tgt.type === 'popup' && frac > 0.68) pulse = 1 + 0.07 * Math.sin(elapsed / 70);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Outer glow
  const grad = ctx.createRadialGradient(cx, cy, r * 0.6, cx, cy, r * 1.5);
  grad.addColorStop(0, theme.border[3] + '30');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2); ctx.fill();

  // Rings
  const ringR = RING_RADII.map(rr => rr * scale * pulse);
  for (let i = ringR.length - 1; i >= 0; i--) {
    ctx.beginPath(); ctx.arc(cx, cy, ringR[i], 0, Math.PI * 2);
    ctx.fillStyle = theme.ring[i]; ctx.fill();
    ctx.strokeStyle = theme.border[i]; ctx.lineWidth = 1.3 * scale; ctx.stroke();
  }

  // Bullseye
  ctx.beginPath(); ctx.arc(cx, cy, 4.5 * scale * pulse, 0, Math.PI * 2);
  ctx.fillStyle = theme.dot; ctx.fill();

  // Crosshair
  const ext = r * 1.45;
  ctx.strokeStyle = theme.cross; ctx.lineWidth = 0.9 * scale;
  ctx.beginPath();
  ctx.moveTo(cx - ext, cy); ctx.lineTo(cx + ext, cy);
  ctx.moveTo(cx, cy - ext); ctx.lineTo(cx, cy + ext);
  ctx.stroke();

  // Flyby speed lines
  if (tgt.type === 'flyby') {
    const spd = Math.hypot(tgt.vx, tgt.vy);
    const nx = tgt.vx / spd, ny = tgt.vy / spd;
    ctx.lineCap = 'round';
    for (const offset of [-0.3, 0, 0.3]) {
      const ox = -ny * r * offset, oy = nx * r * offset;
      ctx.globalAlpha = alpha * (0.7 - Math.abs(offset) * 0.8);
      ctx.strokeStyle = 'rgba(255,180,50,0.55)'; ctx.lineWidth = 2.2 * scale;
      ctx.beginPath();
      ctx.moveTo(cx - nx * r * 1.1 + ox, cy - ny * r * 1.1 + oy);
      ctx.lineTo(cx - nx * r * 2.5 + ox, cy - ny * r * 2.5 + oy);
      ctx.stroke();
    }
    ctx.globalAlpha = alpha;
  }

  // Drifter scan arc
  if (tgt.type === 'drifter') {
    const scanAngle = (elapsed / 600) % (Math.PI * 2);
    ctx.strokeStyle = theme.border[3] + 'aa'; ctx.lineWidth = 1.5 * scale;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.1, scanAngle, scanAngle + Math.PI * 0.6); ctx.stroke();
  }

  // Popup timer arc
  if (tgt.type === 'popup' && frac > 0.1) {
    ctx.strokeStyle = frac > 0.7 ? '#ff5544' : theme.border[2];
    ctx.lineWidth   = 2.5 * scale;
    ctx.globalAlpha = alpha * 0.75;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 7 * scale, -Math.PI / 2, -Math.PI / 2 + (1 - frac) * Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreHit(distFromCenter, reactionMs, type) {
  let ringIndex = RING_RADII.length - 1;
  for (let i = 0; i < RING_RADII.length; i++) {
    if (distFromCenter <= RING_RADII[i]) { ringIndex = i; break; }
  }
  const speedScore   = SPEED_PEAK * Math.exp(-Math.max(0, reactionMs) / SPEED_DECAY_MS);
  const accuracyMult = ACCURACY_MULT[ringIndex];
  const typeMult     = TYPE_SCORE_MULT[type] ?? 1;
  const mult         = accuracyMult * typeMult;
  return { ringIndex, speedScore, mult, total: Math.round(speedScore * mult) };
}

function calcGrade(score) {
  const pct = score / MAX_SCORE;
  for (const [thresh, grade] of GRADE_THRESHOLDS) {
    if (pct >= thresh) return grade;
  }
  return 'D';
}

// ── localStorage ──────────────────────────────────────────────────────────────

function todayKey() {
  const d = new Date();
  return `ds_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function startResetCountdown() {
  const el = document.getElementById('reset-countdown');
  el.style.display = '';

  function tick() {
    const now      = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
    const msLeft   = midnight - now;
    const hours    = Math.floor(msLeft / 3600000);
    const minutes  = Math.floor((msLeft % 3600000) / 60000);
    el.textContent = hours > 0
      ? `Resets in ${hours}h ${minutes}m`
      : `Resets in ${minutes}m`;
  }

  tick();
  setInterval(tick, 30000);
}

function loadResult(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
}

function loadTodayResult() { return loadResult(todayKey()); }

function saveTodayResult(result) {
  localStorage.setItem(todayKey(), JSON.stringify(result));
}

function load7DayHistory() {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    const key   = `ds_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const label = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
    return { label, data: loadResult(key), isToday: i === 6 };
  });
}

// ── Share ─────────────────────────────────────────────────────────────────────

function formatDateStr(key) {
  const clean = (key ?? todayKey()).replace('ds_', '');
  const [y, m, d] = clean.split('-').map(Number);
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[m-1]} ${d}, ${y}`;
}

function buildShareText(result, dateStr, isPractice) {
  const emojis = result.targets.map(t => t.ringIndex != null ? RING_EMOJI[t.ringIndex] : MISS_EMOJI);
  const rows   = [];
  for (let i = 0; i < emojis.length; i += 9) rows.push(emojis.slice(i, i+9).join(''));
  return [
    isPractice ? 'FlickyClicky — Practice Round' : `FlickyClicky — ${dateStr}`,
    `Score: ${result.totalScore} / ${MAX_SCORE} (${result.grade})`,
    rows.join('\n'),
    '',
    `Play at: ${SHARE_URL}`,
  ].join('\n');
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const canvas     = document.getElementById('game-canvas');
const ctx        = canvas.getContext('2d');
const scoreEl    = document.getElementById('score-display');
const remainEl   = document.getElementById('targets-remaining');
const progressEl = document.getElementById('progress-bar');
const missFlash  = document.getElementById('miss-flash');

const startOverlay     = document.getElementById('start-overlay');
const countdownOverlay = document.getElementById('countdown-overlay');
const resultsOverlay   = document.getElementById('results-overlay');
const countdownNum     = document.getElementById('countdown-number');
const alreadyPlayedMsg = document.getElementById('already-played-msg');

// ── Canvas sizing ─────────────────────────────────────────────────────────────

function resizeCanvas() {
  const wrap = document.getElementById('game-wrap');
  const w = Math.min(wrap.clientWidth, CANVAS_W);
  canvas.width  = Math.round(w);
  canvas.height = Math.round(w * (CANVAS_H / CANVAS_W));
}
resizeCanvas();
window.addEventListener('resize', () => { resizeCanvas(); render(); });
function getScale() { return canvas.width / CANVAS_W; }

// ── Game state ────────────────────────────────────────────────────────────────

let state          = 'idle';
let isPractice     = false;
let targets        = [];
let activeIndices  = []; // supports multiple simultaneous targets
let nextSpawnIndex = 0;
let score          = 0;
let hitLog         = [];
let elapsed        = 0;
let lastFrame      = 0;
let rafId          = null;
let shakeFrames    = 0;
let missStreak     = 0;
let combo          = 0;
let comboAnim      = 0;
let dailyKey_      = '';
let missPenaltyTotal = 0;

// ── Input ─────────────────────────────────────────────────────────────────────

canvas.addEventListener('click', onCanvasClick);
canvas.addEventListener('touchend', e => {
  e.preventDefault();
  const t = e.changedTouches[0];
  const rect = canvas.getBoundingClientRect();
  onCanvasClick({ clientX: t.clientX, clientY: t.clientY, _rect: rect });
}, { passive: false });

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'Enter') {
    if (state === 'idle') {
      document.getElementById('start-btn').click();
    } else if (state === 'done') {
      document.getElementById('replay-btn').click();
    }
  }
  if (e.code === 'KeyP' && (state === 'idle' || state === 'done')) {
    document.getElementById('practice-btn').click();
  }
});

function onCanvasClick(e) {
  if (state !== 'playing') return;
  ensureAudio();

  const rect  = e._rect || canvas.getBoundingClientRect();
  const scale = getScale();
  const mx    = (e.clientX - rect.left) * (canvas.width / rect.width);
  const my    = (e.clientY - rect.top)  * (canvas.height / rect.height);

  if (activeIndices.length === 0) { onMiss(); return; }

  // Find the closest active target to the click point
  let hitIdx = -1, hitDist = Infinity, hitCx = 0, hitCy = 0, hitAge = 0;
  for (const idx of activeIndices) {
    const tgt = targets[idx];
    const age = elapsed - tgt.spawnTime;
    if (age < 0 || age > tgt.duration) continue;
    let cx, cy;
    if (tgt.type === 'popup') {
      cx = tgt.x * scale; cy = tgt.y * scale;
    } else {
      cx = (tgt.x + tgt.vx * age / 1000) * scale;
      cy = (tgt.y + tgt.vy * age / 1000) * scale;
    }
    const dist = Math.hypot(mx - cx, my - cy) / scale;
    if (dist < hitDist) { hitDist = dist; hitIdx = idx; hitCx = cx; hitCy = cy; hitAge = age; }
  }

  if (hitIdx < 0 || hitDist > TARGET_RADIUS + 8) { onMiss(); return; }

  const tgt    = targets[hitIdx];
  const result = scoreHit(hitDist, hitAge, tgt.type);
  score = Math.min(MAX_SCORE, score + result.total);
  combo++;
  missStreak = 0;
  hitLog.push({ ringIndex: result.ringIndex, score: result.total, speedScore: result.speedScore, mult: result.mult, reactionMs: hitAge, type: tgt.type });

  scoreEl.textContent = score;
  spawnHitParticles(hitCx, hitCy, result.ringIndex, scale);
  spawnScorePopup(hitCx, hitCy, result.total, scale);
  playHit(result.ringIndex);
  if (combo >= 3) { playCombo(combo); comboAnim = 1.0; }

  clearTrail(hitIdx);
  activeIndices.splice(activeIndices.indexOf(hitIdx), 1);
}

function onMiss() {
  const deduction = Math.min(MISS_PENALTY, score);
  score -= deduction;
  missPenaltyTotal += deduction;
  scoreEl.textContent = score;
  playMiss();
  missStreak++;
  combo = 0;
  triggerMissFlash();
  if (missStreak >= 3) shakeFrames = 10;
}

function triggerMissFlash() {
  missFlash.classList.add('flash');
  setTimeout(() => missFlash.classList.remove('flash'), 90);
}

// ── Game loop ─────────────────────────────────────────────────────────────────

function startLoop() {
  lastFrame = performance.now();
  rafId = requestAnimationFrame(loop);
}

function loop(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;

  if (state === 'playing') {
    elapsed += dt * 1000;
    checkTargetExpiry();
    update(dt);
    render();
    if (hitLog.length >= TARGETS_PER_ROUND && activeIndices.length === 0) {
      endRound();
      return;
    }
  } else {
    updateAmbient(dt);
    render();
  }

  rafId = requestAnimationFrame(loop);
}

function checkTargetExpiry() {
  for (let i = activeIndices.length - 1; i >= 0; i--) {
    const idx = activeIndices[i];
    const tgt = targets[idx];
    if (elapsed - tgt.spawnTime <= tgt.duration) continue;

    const deduction = Math.min(MISS_PENALTY, score);
    score -= deduction;
    missPenaltyTotal += deduction;
    scoreEl.textContent = score;
    hitLog.push({ ringIndex: null, score: -deduction, reactionMs: null, type: tgt.type });
    missStreak++;
    combo = 0;
    if (missStreak >= 3) shakeFrames = 10;
    triggerMissFlash();
    playMiss();
    clearTrail(idx);
    activeIndices.splice(i, 1);
  }
}

function update(dt) {
  updateParticles(dt);
  updateHUD();
  if (comboAnim > 0) comboAnim = Math.max(0, comboAnim - dt * 1.8);

  // Spawn all targets whose time has come (supports bursts / simultaneous)
  while (nextSpawnIndex < TARGETS_PER_ROUND && elapsed >= targets[nextSpawnIndex].spawnTime) {
    activeIndices.push(nextSpawnIndex++);
  }
  if (shakeFrames > 0) shakeFrames--;
}

function updateHUD() {
  progressEl.style.width = (hitLog.length / TARGETS_PER_ROUND * 100) + '%';
  remainEl.textContent   = Math.max(0, TARGETS_PER_ROUND - hitLog.length);
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function render() {
  const scale = getScale();
  const W = canvas.width, H = canvas.height;
  ctx.save();

  if (shakeFrames > 0) {
    const mag = shakeFrames * 1.8;
    ctx.translate((Math.random() - 0.5) * mag, (Math.random() - 0.5) * mag);
  }

  const rootStyle = getComputedStyle(document.documentElement);
  const goldColor = rootStyle.getPropertyValue('--gold').trim();
  ctx.fillStyle = rootStyle.getPropertyValue('--canvas-bg').trim();
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = rootStyle.getPropertyValue('--grid-line').trim();
  ctx.lineWidth = 1;
  const gs = 50 * scale;
  for (let x = 0; x < W; x += gs) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,H); ctx.stroke(); }
  for (let y = 0; y < H; y += gs) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(W,y); ctx.stroke(); }

  // Ambient targets on non-playing screens
  if (state !== 'playing') {
    drawAmbient(ctx, scale);
  }

  // All active targets (may be multiple simultaneously)
  if (state === 'playing') {
    for (const idx of activeIndices) {
      const tgt = targets[idx];
      const age = elapsed - tgt.spawnTime;
      if (age >= 0 && age < tgt.duration) drawTarget(ctx, tgt, idx, elapsed, scale);
    }
  }

  drawParticles(ctx, goldColor);

  // Combo overlay text
  if (state === 'playing' && combo >= 3 && comboAnim > 0) {
    ctx.save();
    ctx.globalAlpha = comboAnim;
    ctx.font = `bold ${Math.round(18 * scale)}px 'Segoe UI', system-ui, sans-serif`;
    ctx.fillStyle = goldColor; ctx.textAlign = 'center';
    ctx.shadowColor = goldColor; ctx.shadowBlur = 12 * scale;
    ctx.fillText(`${combo}× COMBO`, W / 2, H - 24 * scale);
    ctx.restore();
  }

  ctx.restore();
}

// ── Round control ─────────────────────────────────────────────────────────────

function beginCountdown(onDone) {
  state = 'countdown';
  countdownOverlay.classList.remove('hidden');
  let count = 3;
  countdownNum.textContent = count;
  playCountdown(false);

  const tick = setInterval(() => {
    count--;
    if (count <= 0) {
      clearInterval(tick);
      countdownNum.textContent = 'GO!';
      playCountdown(true);
      setTimeout(() => { countdownOverlay.classList.add('hidden'); onDone(); }, 500);
    } else {
      countdownNum.textContent = count;
      countdownNum.style.animation = 'none';
      void countdownNum.offsetWidth;
      countdownNum.style.animation = '';
      playCountdown(false);
    }
  }, 700);
}

function startRound(practice) {
  isPractice     = practice;
  score          = 0;
  hitLog         = [];
  missPenaltyTotal = 0;
  missStreak     = 0;
  combo          = 0;
  comboAnim      = 0;
  shakeFrames    = 0;
  nextSpawnIndex = 0;
  activeIndices  = [];
  particles.length = 0;
  trailMap.clear();
  scoreEl.textContent = '0';

  const { seed, key } = makeDailySeed();
  dailyKey_ = key;
  const rng = mulberry32(practice ? (Date.now() ^ 0xdeadbeef) : seed);
  targets = generateRound(rng);

  beginCountdown(() => {
    state   = 'playing';
    elapsed = 0;
    startLoop();
  });
}

function endRound() {
  state = 'done';
  cancelAnimationFrame(rafId);

  const grade  = calcGrade(score);
  const result = { totalScore: score, grade, targets: hitLog, maxScore: MAX_SCORE, dateKey: dailyKey_, missPenalty: missPenaltyTotal };

  if (!isPractice) saveTodayResult(result);
  showResults(result, !isPractice);
}

// ── Results: animated score counter ──────────────────────────────────────────

function animateScore(targetScore, el, onDone) {
  const duration = 1100;
  const start    = performance.now();
  function frame(now) {
    const t    = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = `${Math.round(ease * targetScore).toLocaleString()} / ${MAX_SCORE.toLocaleString()}`;
    if (t < 1) requestAnimationFrame(frame);
    else { el.textContent = `${targetScore.toLocaleString()} / ${MAX_SCORE.toLocaleString()}`; onDone?.(); }
  }
  requestAnimationFrame(frame);
}

// ── Results: per-target breakdown ─────────────────────────────────────────────

function buildBreakdownTable(log) {
  const table    = document.getElementById('breakdown-table');
  table.innerHTML = '';
  const bestScore = Math.max(...log.map(t => t.score));

  log.forEach((t, i) => {
    const isMiss = t.ringIndex == null;
    const isBest = !isMiss && t.score === bestScore;
    const row    = document.createElement('div');
    row.className = `bd-row${isMiss ? ' miss' : ''}${isBest ? ' best' : ''}`;

    const typeLabel = { popup: 'pop', drifter: 'drft', flyby: 'fly' }[t.type] ?? '?';
    const timeStr   = t.reactionMs != null ? `${(t.reactionMs/1000).toFixed(2)}s` : '—';
    const ptClass   = isMiss        ? 'pts-miss'
                    : t.score >= 250 ? 'pts-max'
                    : t.score >= 120 ? 'pts-high'
                    : 'pts-mid';

    row.innerHTML = `
      <span class="bd-num">#${String(i+1).padStart(2,'0')}</span>
      <span class="bd-emoji">${isMiss ? MISS_EMOJI : RING_EMOJI[t.ringIndex]}</span>
      <span class="bd-type">${typeLabel}</span>
      <span class="bd-time">${timeStr}</span>
      <span class="bd-pts ${ptClass}">${isMiss ? t.score : '+' + t.score}</span>
    `;
    table.appendChild(row);
  });
}

// ── Results UI ────────────────────────────────────────────────────────────────

function showResults(result, playFanfare = false) {
  render();

  const dateStr  = formatDateStr(result.dateKey);
  const scoreEl2 = document.getElementById('result-score-animated');
  const gradeEl  = document.getElementById('result-grade');

  document.getElementById('result-date').textContent = dateStr;

  gradeEl.textContent = result.grade;
  gradeEl.className   = `grade-${result.grade}`;
  gradeEl.style.animation = 'none';
  void gradeEl.offsetWidth;
  gradeEl.style.animation = '';

  scoreEl2.textContent = `0 / ${MAX_SCORE.toLocaleString()}`;

  const emojis = result.targets.map(t => t.ringIndex != null ? RING_EMOJI[t.ringIndex] : MISS_EMOJI);
  const rows   = [];
  for (let i = 0; i < emojis.length; i += 9) rows.push(emojis.slice(i, i+9).join(''));
  document.getElementById('emoji-grid').textContent = rows.join('\n');

  const hits     = result.targets.filter(t => t.ringIndex != null);
  const missPen  = result.missPenalty ?? (result.targets.filter(t => t.ringIndex == null).length * MISS_PENALTY);
  const speedPts = hits.reduce((s, t) => s + Math.round(t.speedScore ?? 0), 0);
  const avgMult  = hits.length ? hits.reduce((s, t) => s + (t.mult ?? 1), 0) / hits.length : 1;
  const avgReact = hits.length
    ? hits.reduce((s, t) => s + t.reactionMs, 0) / hits.length : null;

  const modPct = Math.round((avgMult - 1) * 100);
  document.getElementById('stat-acc').textContent   = `${modPct >= 0 ? '+' : ''}${modPct}%`;
  document.getElementById('stat-spd').textContent   = speedPts.toLocaleString();
  document.getElementById('stat-hits').textContent  = `${hits.length}/${TARGETS_PER_ROUND}`;
  document.getElementById('stat-pen').textContent   = missPen > 0 ? `-${missPen}` : '0';
  document.getElementById('stat-react').textContent = avgReact != null
    ? `${(avgReact/1000).toFixed(2)}s` : '—';

  buildBreakdownTable(result.targets);

  // Breakdown toggle (re-bind each open to reset state)
  const toggle = document.getElementById('breakdown-toggle');
  const table  = document.getElementById('breakdown-table');
  let open = false;
  table.classList.add('hidden');
  toggle.textContent = 'show ▾';
  toggle.onclick = () => {
    open = !open;
    table.classList.toggle('hidden', !open);
    toggle.textContent = open ? 'hide ▴' : 'show ▾';
  };

  // Share button
  const shareBtn     = document.getElementById('share-btn');
  const shareConfirm = document.getElementById('share-confirm');
  const shareLabel   = document.getElementById('share-btn-label');
  shareBtn.onclick = () => {
    const text = buildShareText(result, dateStr, isPractice);
    navigator.clipboard.writeText(text).then(() => {
      shareLabel.textContent = 'Copied!';
      shareConfirm.classList.add('show');
      setTimeout(() => {
        shareLabel.textContent = 'Copy Score';
        shareConfirm.classList.remove('show');
      }, 1800);
    });
  };

  setupLeaderboard(result);

  document.getElementById('results-scroll').scrollTop = 0;

  // Reset animation
  resultsOverlay.style.animation = 'none';
  void resultsOverlay.offsetWidth;
  resultsOverlay.style.animation = '';
  resultsOverlay.classList.remove('hidden');

  renderHistoryStrip();

  setTimeout(() => {
    animateScore(result.totalScore, scoreEl2, () => {
      if (playFanfare) playResultFanfare(result.grade);
    });
  }, 200);
}

// ── 7-day history strip ───────────────────────────────────────────────────────

function renderHistoryStrip() {
  const strip = document.getElementById('history-strip');
  strip.innerHTML = '';
  for (const { label, data, isToday } of load7DayHistory()) {
    const div = document.createElement('div');
    div.className = `history-day${isToday ? ' today' : ''}`;

    const lbl = document.createElement('div');
    lbl.className   = 'day-label';
    lbl.textContent = label;

    const grd = document.createElement('div');
    grd.className   = `day-grade ${data ? `grade-${data.grade}` : 'empty'}`;
    grd.textContent = data ? data.grade : '·';

    const sc = document.createElement('div');
    sc.className   = 'day-score';
    sc.textContent = data ? data.totalScore.toLocaleString() : '';

    div.append(lbl, grd, sc);
    strip.appendChild(div);
  }
}

// ── Leaderboard (Firebase) ─────────────────────────────────────────────────────

let db = null;

function initFirebase() {
  if (FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') return; // not configured
  try {
    if (typeof firebase === 'undefined') return;
    firebase.initializeApp(FIREBASE_CONFIG);
    db = firebase.firestore();
  } catch {
    db = null;
  }
}
initFirebase();

function pacificDateKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

function lbStorageKey(pacKey) { return `ds_lb_${pacKey}`; }

const lbSection   = document.getElementById('leaderboard-section');
const lbForm      = document.getElementById('lb-entry-form');
const lbNameInput = document.getElementById('lb-name-input');
const lbStatus    = document.getElementById('lb-status');
const lbRankInfo  = document.getElementById('lb-rank-info');
const lbListWrap  = document.getElementById('lb-list-wrap');
const lbList      = document.getElementById('lb-list');

function setLbStatus(text) {
  lbStatus.textContent = text || '';
  lbStatus.classList.toggle('hidden', !text);
}

function setupLeaderboard(result) {
  if (isPractice) {
    lbSection.classList.add('hidden');
    return;
  }

  if (!db) {
    lbSection.classList.remove('hidden');
    lbForm.classList.add('hidden');
    lbRankInfo.classList.add('hidden');
    lbListWrap.classList.add('hidden');
    setLbStatus('Leaderboard unavailable.');
    return;
  }

  lbSection.classList.remove('hidden');
  const pacKey = pacificDateKey();
  const saved  = loadResult(lbStorageKey(pacKey));

  if (saved) {
    lbForm.classList.add('hidden');
    lbListWrap.classList.add('hidden');
    lbRankInfo.classList.add('hidden');
    setLbStatus('Loading leaderboard…');
    fetchLeaderboard(pacKey)
      .then(entries => renderLeaderboard(entries, saved.id))
      .catch(() => setLbStatus('Could not load leaderboard.'));
    return;
  }

  lbForm.classList.remove('hidden');
  lbListWrap.classList.add('hidden');
  lbRankInfo.classList.add('hidden');
  lbNameInput.value = '';
  setLbStatus('');

  const submitBtn = document.getElementById('lb-submit-btn');
  submitBtn.disabled = false;

  lbForm.onsubmit = (e) => {
    e.preventDefault();
    const name = lbNameInput.value.trim().slice(0, LB_NAME_MAX_LEN);
    if (!name) return;

    submitBtn.disabled = true;
    setLbStatus('Submitting…');

    db.collection(LB_COLLECTION).doc(pacKey).collection('entries').add({
      name,
      score: result.totalScore,
      grade: result.grade,
      ts: firebase.firestore.FieldValue.serverTimestamp(),
    }).then(docRef => {
      localStorage.setItem(lbStorageKey(pacKey), JSON.stringify({ name, score: result.totalScore, id: docRef.id }));
      lbForm.classList.add('hidden');
      setLbStatus('Loading leaderboard…');
      return fetchLeaderboard(pacKey).then(entries => renderLeaderboard(entries, docRef.id));
    }).catch(() => {
      submitBtn.disabled = false;
      setLbStatus('Could not submit score. Try again.');
    });
  };
}

function fetchLeaderboard(pacKey) {
  return db.collection(LB_COLLECTION).doc(pacKey).collection('entries')
    .orderBy('score', 'desc')
    .limit(500)
    .get()
    .then(snap => snap.docs.map(d => ({ id: d.id, ...d.data() })));
}

function renderLeaderboard(entries, highlightId) {
  setLbStatus('');
  lbList.innerHTML = '';

  const yourRank = entries.findIndex(e => e.id === highlightId) + 1;
  if (yourRank > 0) {
    lbRankInfo.textContent = `You're #${yourRank} of ${entries.length} today`;
    lbRankInfo.classList.remove('hidden');
  } else {
    lbRankInfo.classList.add('hidden');
  }

  entries.forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = `lb-row${entry.id === highlightId ? ' you' : ''}`;

    const rank = document.createElement('span');
    rank.className   = 'lb-rank';
    rank.textContent = `#${i + 1}`;

    const name = document.createElement('span');
    name.className   = 'lb-name';
    name.textContent = entry.name;

    const score = document.createElement('span');
    score.className   = 'lb-score';
    score.textContent = entry.score.toLocaleString();

    const grade = document.createElement('span');
    grade.className   = `lb-grade grade-${entry.grade}`;
    grade.textContent = entry.grade;

    row.append(rank, name, score, grade);
    lbList.appendChild(row);

    if (entry.id === highlightId) {
      requestAnimationFrame(() => {
        lbListWrap.scrollTop = row.offsetTop - lbListWrap.clientHeight / 2 + row.clientHeight / 2;
      });
    }
  });

  lbListWrap.classList.remove('hidden');
}

// ── Settings (theme / mute) ────────────────────────────────────────────────────

let muted = localStorage.getItem('ds_muted') === '1';

const themeBtn = document.getElementById('theme-btn');
const muteBtn  = document.getElementById('mute-btn');

function applyTheme(theme) {
  if (theme === 'light') {
    document.documentElement.dataset.theme = 'light';
    themeBtn.textContent = '☀️';
  } else {
    delete document.documentElement.dataset.theme;
    themeBtn.textContent = '🌙';
  }
  render();
}

function applyMute(isMuted) {
  muted = isMuted;
  muteBtn.textContent = muted ? '🔇' : '🔊';
}

themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  localStorage.setItem('ds_theme', next);
  applyTheme(next);
});

muteBtn.addEventListener('click', () => {
  const next = !muted;
  localStorage.setItem('ds_muted', next ? '1' : '0');
  applyMute(next);
});

applyTheme(localStorage.getItem('ds_theme') === 'light' ? 'light' : 'dark');
applyMute(muted);

// ── Buttons ───────────────────────────────────────────────────────────────────

document.getElementById('start-btn').addEventListener('click', () => {
  ensureAudio();
  const existing = loadTodayResult();
  if (existing) {
    isPractice = false;
    startOverlay.classList.add('hidden');
    showResults(existing, false);
    return;
  }
  startOverlay.classList.add('hidden');
  startRound(false);
});

document.getElementById('practice-btn').addEventListener('click', () => {
  ensureAudio();
  startOverlay.classList.add('hidden');
  startRound(true);
});

document.getElementById('replay-btn').addEventListener('click', () => {
  resultsOverlay.classList.add('hidden');
  startOverlay.classList.remove('hidden');
});

// ── Init ──────────────────────────────────────────────────────────────────────

function init() {
  resizeCanvas();
  initAmbient();
  renderHistoryStrip();

  const existing = loadTodayResult();
  if (existing) {
    alreadyPlayedMsg.style.display = '';
    const prevWrap  = document.getElementById('start-today-result');
    const prevGrade = document.getElementById('start-prev-grade');
    const prevScore = document.getElementById('start-prev-score');
    prevWrap.style.display = 'flex';
    prevGrade.textContent  = existing.grade;
    prevGrade.className    = `grade-${existing.grade}`;
    prevScore.textContent  = `${existing.totalScore.toLocaleString()} / ${MAX_SCORE.toLocaleString()}`;
    document.getElementById('start-btn').textContent = 'View Scores';
    startResetCountdown();
  }

  state     = 'idle';
  lastFrame = performance.now();
  rafId     = requestAnimationFrame(loop);
}

init();
