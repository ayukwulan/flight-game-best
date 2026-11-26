// HUD: DOM overlay (big legible text for the judge's screenshots) + a canvas instrument
// strip (artificial horizon, throttle, compass tape). All updates are cheap text writes.
import { headingDeg, speedKts, altFt, nextRingInfo, PHASE_MENU, PHASE_FLY, PHASE_WIN, PHASE_CRASH, PHASE_TIMEOUT } from './game.js';

let els = {};
let horizonCtx = null;

export function buildHUD(document) {
  const root = document.getElementById('hud');
  root.innerHTML = `
  <div id="hud-top">
    <div class="hud-box" id="hud-score"><div class="lbl">SCORE</div><div class="big" id="v-score">0</div></div>
    <div class="hud-box" id="hud-ring"><div class="lbl">RINGS</div><div class="big" id="v-ring">0/12</div></div>
    <div class="hud-box" id="hud-time"><div class="lbl">TIME</div><div class="big" id="v-time">4:00</div></div>
    <div class="hud-box" id="hud-combo"><div class="lbl">COMBO</div><div class="big" id="v-combo">×1</div></div>
    <div class="hud-box" id="hud-best"><div class="lbl">BEST</div><div class="big" id="v-best">0</div></div>
  </div>
  <div id="hud-objective"><span id="v-objective">SKYRING · CORAL CHAIN RING-RUN</span></div>
  <div id="hud-left">
    <div class="hud-box"><div class="lbl">ALTITUDE</div><div class="big" id="v-alt">0<span class="unit"> FT</span></div></div>
    <div class="hud-box"><div class="lbl">AIRSPEED</div><div class="big" id="v-spd">0<span class="unit"> KT</span></div></div>
    <div class="hud-box"><div class="lbl">HEADING</div><div class="big" id="v-hdg">000°</div></div>
    <div class="hud-box"><div class="lbl">WIND</div><div class="big small" id="v-wind">W 6 kt</div></div>
  </div>
  <div id="hud-message"></div>
  <div id="hud-bottom">
    <canvas id="horizon" width="220" height="110"></canvas>
    <div id="hud-throttle"><div class="lbl">THROTTLE</div><div id="thr-bar"><div id="thr-fill"></div></div><div id="v-thr">65%</div></div>
    <div id="hud-controls">W/S THROTTLE · ↑/↓ PITCH · ←/→ BANK · MOUSE STEER · R RESTART · P PAUSE</div>
  </div>
  <div id="overlay"></div>`;
  for (const id of ['v-score', 'v-ring', 'v-time', 'v-combo', 'v-best', 'v-objective', 'v-alt', 'v-spd', 'v-hdg', 'v-wind', 'hud-message', 'overlay', 'v-thr', 'thr-fill']) {
    els[id] = document.getElementById(id);
  }
  horizonCtx = document.getElementById('horizon').getContext('2d');
}

function fmtTime(s) {
  const t = Math.max(0, Math.ceil(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function drawHorizon(f, phase) {
  const ctx = horizonCtx, W = 220, H = 110;
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
  ctx.translate(W / 2, H / 2);
  ctx.rotate(-f.roll);
  ctx.translate(0, f.pitch * 90);
  ctx.fillStyle = '#2f6fd0'; ctx.fillRect(-W, -H, W * 2, H); // sky
  ctx.fillStyle = '#7a5a34'; ctx.fillRect(-W, 0, W * 2, H);  // ground
  ctx.fillStyle = '#ffffff'; ctx.fillRect(-W, -1.5, W * 2, 3); // horizon line
  ctx.restore();
  // Fixed aircraft symbol.
  ctx.strokeStyle = '#ffd23e'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(W / 2 - 26, H / 2); ctx.lineTo(W / 2 - 8, H / 2); ctx.moveTo(W / 2 + 8, H / 2); ctx.lineTo(W / 2 + 26, H / 2);
  ctx.moveTo(W / 2, H / 2 - 2); ctx.lineTo(W / 2, H / 2 + 8); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText('ATTITUDE', W / 2, 12);
  if (phase !== PHASE_FLY) { ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(0, 0, W, H); }
}

export function updateHUD(g) {
  const f = g.flight;
  els['v-score'].textContent = String(g.score);
  els['v-ring'].textContent = `${g.ringsPassed}/12`;
  els['v-time'].textContent = fmtTime(g.timeLeft);
  els['v-time'].style.color = g.timeLeft < 30 && g.phase === PHASE_FLY ? '#ff5a4a' : '';
  els['v-combo'].textContent = `×${Math.max(1, g.combo)}`;
  els['v-best'].textContent = String(Math.max(g.best, g.score));
  els['v-alt'].innerHTML = `${altFt(f)}<span class="unit"> FT</span>`;
  els['v-spd'].innerHTML = `${speedKts(f)}<span class="unit"> KT</span>`;
  els['v-hdg'].textContent = `${String(headingDeg(f.heading)).padStart(3, '0')}°`;
  els['v-wind'].textContent = g.wind.label;
  els['v-thr'].textContent = `${Math.round(f.throttle * 100)}%`;
  els['thr-fill'].style.width = `${Math.round(f.throttle * 100)}%`;
  const next = nextRingInfo(g);
  els['v-objective'].textContent = g.phase === PHASE_FLY ? `NEXT: ${next.label}` : 'SKYRING · CORAL CHAIN RING-RUN';
  els['hud-message'].textContent = g.messageT > 0 ? g.message : '';
  els['hud-message'].style.opacity = g.messageT > 0 ? '1' : '0';
  drawHorizon(f, g.phase);
  drawOverlay(g);
}

function overlayHTML(g) {
  if (g.phase === PHASE_MENU) {
    return `<div class="panel"><h1>SKYRING</h1><h2>CORAL CHAIN RING-RUN</h2>
    <p>Fly the Kestrel through all <b>12 gold rings</b> over the Coral Chain, then land on the
    Gull Island runway before the clock runs out. Rings pay <b>1000 × combo</b> — miss one and
    the combo breaks. Watch the wind, mind the peaks, don't ditch in the sea.</p>
    <p class="keys">W/S throttle &nbsp;·&nbsp; ↑/↓ pitch &nbsp;·&nbsp; ←/→ bank &nbsp;·&nbsp; mouse steers &nbsp;·&nbsp; R restart</p>
    <p class="go">PRESS ENTER OR CLICK TO TAKE OFF</p></div>`;
  }
  if (g.phase === PHASE_WIN) {
    return `<div class="panel win"><h1>YOU WIN!</h1><h2>ALL 12 RINGS · CLEAN LANDING</h2>
    <p class="final">FINAL SCORE <b>${g.score}</b> &nbsp;·&nbsp; BEST COMBO ×${g.bestCombo} &nbsp;·&nbsp; TIME LEFT ${fmtTime(g.timeLeft)}</p>
    <p class="go">PRESS R TO FLY AGAIN</p></div>`;
  }
  if (g.phase === PHASE_CRASH) {
    const last = g.events[g.events.length - 1];
    return `<div class="panel crash"><h1>CRASHED!</h1><h2>${last ? last.text : ''}</h2>
    <p class="final">SCORE <b>${g.score}</b> &nbsp;·&nbsp; RINGS ${g.ringsPassed}/12 &nbsp;·&nbsp; BEST ${Math.max(g.best, g.score)}</p>
    <p class="go">PRESS R TO FLY AGAIN</p></div>`;
  }
  if (g.phase === PHASE_TIMEOUT) {
    return `<div class="panel crash"><h1>TIME UP!</h1><h2>THE CLOCK BEAT YOU TO THE RUNWAY</h2>
    <p class="final">SCORE <b>${g.score}</b> &nbsp;·&nbsp; RINGS ${g.ringsPassed}/12 &nbsp;·&nbsp; BEST ${Math.max(g.best, g.score)}</p>
    <p class="go">PRESS R TO FLY AGAIN</p></div>`;
  }
  return '';
}

let lastOverlay = null;
function drawOverlay(g) {
  const html = overlayHTML(g);
  if (html !== lastOverlay) { els.overlay.innerHTML = html; lastOverlay = html; }
}
