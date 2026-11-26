// Game rules: SKYRING — fly the Coral Chain ring-run. Pass all 12 numbered rings in order,
// then land on the Gull Island runway before the 240 s timer runs out. Rings pay 1000 points
// times the combo (consecutive rings without a miss); a clean landing pays the time bonus.
// Crashing into terrain or the sea, or the timer hitting zero, ends the run.
import * as THREE from 'three';
import { COURSE, RING_COUNT, TIME_LIMIT, RUNWAY, groundHeight, nearestLandmark } from './world.js';
import { makeFlightState, resetFlight, stepFlight } from './plane.js';
import { clamp, wrapAngle } from './util.js';

export const PHASE_MENU = 'menu';
export const PHASE_FLY = 'fly';
export const PHASE_WIN = 'win';
export const PHASE_CRASH = 'crash';
export const PHASE_TIMEOUT = 'timeout';

export function makeGame() {
  return {
    phase: PHASE_MENU,
    time: 0, timeLeft: TIME_LIMIT,
    ring: 0, score: 0, combo: 0, bestCombo: 0, ringMissed: false, ringClosest: Infinity,
    ringsPassed: 0, misses: 0,
    best: 0,
    flight: makeFlightState(),
    wind: { x: 2.5, z: -1.5, label: 'W 6 kt' },
    message: '',
    messageT: 0,
    events: [], // { type, text, t } — ring / crash / land / win
    started: false,
  };
}

export function startRun(g) {
  resetFlight(g.flight, { x: 420, y: 41.7, z: -140, heading: Math.PI });
  g.phase = PHASE_FLY;
  g.time = 0; g.timeLeft = TIME_LIMIT;
  g.ring = 0; g.score = 0; g.combo = 0; g.bestCombo = 0; g.ringMissed = false; g.ringClosest = Infinity;
  g.ringsPassed = 0; g.misses = 0;
  g.message = 'RING 1/12 — FLY THROUGH THE GOLD RING';
  g.messageT = 3;
  g.events = [{ type: 'start', text: 'Takeoff — Gull Island runway', t: 0 }];
  g.started = true;
}

function ringCenter(i) { const c = COURSE[i]; return new THREE.Vector3(c.x, c.y, c.z); }

function ringDirection(i) {
  const a = ringCenter(i), b = ringCenter((i + 1) % COURSE.length);
  return b.clone().sub(a).normalize();
}

// Ring pass: the hoop is a 16 m torus around its centre. Passing means coming within
// 17 m of the centre (through the disc, grazing the tube at most) — the flight model's
// turn radius is ~70 m, so a tighter window would punish a straight-in approach that
// is a metre off.
// 80 m and then flew away beyond 150 m without going through — counted once per
// approach, re-armed when the plane comes back in. (A plane-crossing test does not
// work here: ring 1 is approached from the runway, ~100 deg off the ring's facing,
// so the plane starts on the "past" side of its tilted plane.)
function checkRing(g, prev, next) {
  if (g.ring >= RING_COUNT) return;
  const c = ringCenter(g.ring);
  const dist = next.distanceTo(c);
  g.ringClosest = Math.min(g.ringClosest, dist);
  if (dist < 17) {
    const pts = 1000 * (g.combo + 1);
    g.score += pts;
    g.combo += 1;
    g.bestCombo = Math.max(g.bestCombo, g.combo);
    g.ringsPassed += 1;
    g.ring += 1;
    g.ringClosest = Infinity;
    g.ringMissed = false;
    g.events.push({ type: 'ring', text: `RING ${g.ringsPassed}/12  +${pts}`, t: g.time });
    g.message = g.ring >= RING_COUNT
      ? 'ALL RINGS CLEAR — LAND ON THE RUNWAY!'
      : `RING ${g.ring + 1}/12 — NEXT: ${nearestLandmark(COURSE[g.ring].x, COURSE[g.ring].z).name.toUpperCase()}`;
    g.messageT = 2.5;
    return;
  }
  if (dist > 150 && g.ringClosest < 80 && !g.ringMissed) {
    // Approached, then flew away without going through: combo breaks, ring stays.
    g.ringMissed = true;
    g.combo = 0;
    g.misses += 1;
    g.events.push({ type: 'miss', text: `MISSED RING ${g.ring + 1} — COMBO LOST`, t: g.time });
    g.message = `MISSED RING ${g.ring + 1} — TURN BACK!`;
    g.messageT = 2.5;
  } else if (dist < 80) {
    // Back in range: the ring can be missed again on the next failed approach.
    g.ringMissed = false;
  }
}

export function stepGame(g, input, dt) {
  if (g.phase !== PHASE_FLY) return;
  g.time += dt;
  g.timeLeft = TIME_LIMIT - g.time;
  if (g.messageT > 0) g.messageT -= dt;
  // Wind slowly veers.
  const wob = Math.sin(g.time * 0.05) * 1.5;
  g.wind.x = 2.5 + wob; g.wind.z = -1.5 + Math.cos(g.time * 0.04) * 1.2;
  const prev = g.flight.pos.clone();
  const result = stepFlight(g.flight, input, dt, g.wind);
  const next = g.flight.pos.clone();
  if (result === 'fly') checkRing(g, prev, next);
  if (result === 'crash') {
    g.phase = PHASE_CRASH;
    const ground = groundHeight(g.flight.pos.x, g.flight.pos.z);
    const intoSea = g.flight.pos.y <= 1.5 && ground < 0;
    g.events.push({ type: 'crash', text: intoSea ? 'DITCHED IN THE SEA' : 'CRASHED INTO TERRAIN', t: g.time });
    g.best = Math.max(g.best, g.score);
    return;
  }
  if (result === 'land') {
    if (g.ring >= RING_COUNT) {
      const timeBonus = Math.round(g.timeLeft) * 10;
      g.score += timeBonus;
      g.phase = PHASE_WIN;
      g.events.push({ type: 'win', text: `LANDED — TIME BONUS +${timeBonus}`, t: g.time });
      g.best = Math.max(g.best, g.score);
    } else {
      // Touched down early: bounce back up, run continues, combo resets.
      g.flight.landed = false;
      g.flight.pos.y = groundHeight(g.flight.pos.x, g.flight.pos.z) + 4;
      g.flight.speed = Math.max(g.flight.speed, 40);
      g.combo = 0;
      g.message = `TOO EARLY — ${RING_COUNT - g.ring} RINGS LEFT! TAKE OFF AGAIN`;
      g.messageT = 3;
      g.events.push({ type: 'early', text: 'LANDED EARLY — BACK IN THE AIR', t: g.time });
    }
    return;
  }
  if (g.timeLeft <= 0) {
    g.phase = PHASE_TIMEOUT;
    g.events.push({ type: 'timeout', text: 'TIME UP', t: g.time });
    g.best = Math.max(g.best, g.score);
  }
}

export function ringDirectionOf(i) { return ringDirection(i); }

export function nextRingInfo(g) {
  if (g.ring >= RING_COUNT) return { label: 'LAND ON THE RUNWAY', x: RUNWAY.x, y: 40, z: RUNWAY.z };
  const c = COURSE[g.ring];
  const lm = nearestLandmark(c.x, c.z);
  return { label: `RING ${g.ring + 1}/12 · ${lm.name.toUpperCase()}`, x: c.x, y: c.y, z: c.z };
}

export function headingDeg(h) {
  // 0° = north (-Z), 90° = east (+X).
  let deg = ((-h * 180) / Math.PI) % 360;
  if (deg < 0) deg += 360;
  return Math.round(deg);
}

export function speedKts(f) { return Math.round(f.speed * 1.94); }
export function altFt(f) { return Math.max(0, Math.round((f.pos.y - Math.max(groundHeight(f.pos.x, f.pos.z), 0)) * 3.28)); }
export { clamp, wrapAngle };
