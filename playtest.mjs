// SKYRING playtest: rules in Node (flight model, ring passing, win/crash/timeout) then the
// real game in a headless Chromium (menu -> takeoff -> fly -> rings -> crash/win/restart,
// no console/page errors, no external requests, all values finite).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { COURSE, RING_COUNT, TIME_LIMIT, groundHeight, nearestLandmark } from './game/src/world.js';
import { makeFlightState, resetFlight, stepFlight } from './game/src/plane.js';
import { makeGame, startRun, stepGame, PHASE_MENU, PHASE_FLY, PHASE_WIN, PHASE_CRASH, PHASE_TIMEOUT } from './game/src/game.js';

const STEP = 1 / 60;
const NEUTRAL = { pitch: 0, roll: 0, throttle: 0.7 };

// --- World sanity ---
assert.equal(COURSE.length, RING_COUNT, 'Course has 12 rings');
for (const c of COURSE) {
  const g = groundHeight(c.x, c.z);
  assert(c.y > g + 8, `Ring at (${c.x},${c.z}) y=${c.y} must clear terrain ${g.toFixed(1)}`);
  assert(Number.isFinite(g));
}
assert.equal(nearestLandmark(-560, -420).name, 'Turtle Rock');
assert.equal(nearestLandmark(420, -60).name, 'Gull Island');
console.log('World PASS: 12 rings clear terrain, landmarks resolve.');

// --- Flight model: throttle changes speed, stick changes attitude, terrain kills ---
{
  const f = makeFlightState();
  resetFlight(f, { x: 420, y: 120, z: -140, heading: Math.PI });
  const v0 = f.speed;
  for (let i = 0; i < 120; i++) stepFlight(f, { pitch: 0, roll: 0, throttle: 1.0 }, STEP, { x: 0, z: 0 });
  assert(f.speed > v0 + 10, `Full throttle accelerates: ${v0.toFixed(1)} -> ${f.speed.toFixed(1)}`);
  const h0 = f.heading;
  for (let i = 0; i < 120; i++) stepFlight(f, { pitch: 0, roll: 1, throttle: 0.7 }, STEP, { x: 0, z: 0 });
  assert(Math.abs(f.heading - h0) > 0.3, 'Banking turns the plane');
  assert(f.roll > 0.5, 'Roll responds to stick');
  // Into the sea at low altitude = crash.
  const g2 = makeFlightState();
  resetFlight(g2, { x: 0, y: 4, z: 0, heading: 0 });
  let r = 'fly';
  for (let i = 0; i < 600 && r === 'fly'; i++) r = stepFlight(g2, { pitch: -1, roll: 0, throttle: 0.3 }, STEP, { x: 0, z: 0 });
  assert.equal(r, 'crash', 'Diving into the sea crashes');
  // Runway touchdown = land.
  const g3 = makeFlightState();
  resetFlight(g3, { x: 420, y: 48, z: -140, heading: Math.PI });
  r = 'fly';
  for (let i = 0; i < 600 && r === 'fly'; i++) r = stepFlight(g3, { pitch: -0.15, roll: 0, throttle: 0.25 }, STEP, { x: 0, z: 0 });
  assert.equal(r, 'land', `Gentle runway touchdown lands (got ${r})`);
  console.log('Flight PASS: throttle, bank, sea crash, runway landing.');
}

// --- Game rules: ring pass scores + combo, miss breaks combo, win needs all rings + landing ---
{
  const g = makeGame();
  assert.equal(g.phase, PHASE_MENU);
  startRun(g);
  assert.equal(g.phase, PHASE_FLY);
  // Teleport onto the approach line of ring 1 (40 m back along the course direction)
  // and fly straight through its hoop.
  const c = COURSE[0];
  const c1 = new (await import('three')).Vector3(c.x, c.y, c.z);
  const c2v = new (await import('three')).Vector3(COURSE[1].x, COURSE[1].y, COURSE[1].z);
  const d1 = c2v.clone().sub(c1).normalize();
  const behind = c1.clone().addScaledVector(d1, -40);
  g.flight.pos.copy(behind);
  g.flight.heading = Math.atan2(-d1.x, -d1.z);
  g.flight.pitch = Math.asin(Math.max(-0.6, Math.min(0.6, d1.y)));
  g.flight.speed = 60;
  for (let i = 0; i < 120; i++) stepGame(g, NEUTRAL, STEP);
  assert.equal(g.ringsPassed, 1, `Ring 1 passes (got ${g.ringsPassed})`);
  assert.equal(g.score, 1000, 'First ring pays 1000');
  assert.equal(g.combo, 1);
  // Miss ring 2 by flying past its plane 60 m to the side of the hoop.
  const c2 = COURSE[1];
  const c2c = new (await import('three')).Vector3(c2.x, c2.y, c2.z);
  const c3v = new (await import('three')).Vector3(COURSE[2].x, COURSE[2].y, COURSE[2].z);
  const d2 = c3v.clone().sub(c2c).normalize();
  const side = new (await import('three')).Vector3(-d2.z, 0, d2.x).normalize().multiplyScalar(60);
  g.flight.pos.copy(c2c.clone().addScaledVector(d2, -40).add(side));
  g.flight.heading = Math.atan2(-d2.x, -d2.z);
  g.flight.pitch = Math.asin(Math.max(-0.6, Math.min(0.6, d2.y)));
  g.flight.speed = 60;
  for (let i = 0; i < 300; i++) stepGame(g, NEUTRAL, STEP);
  assert.equal(g.combo, 0, 'Missing a ring breaks the combo');
  assert.equal(g.ringsPassed, 1, 'Missed ring does not count');
  // Timeout ends the run.
  g.time = TIME_LIMIT - 0.05;
  for (let i = 0; i < 10 && g.phase === PHASE_FLY; i++) stepGame(g, NEUTRAL, STEP);
  assert.equal(g.phase, PHASE_TIMEOUT, 'Timer at zero ends the run');
  console.log('Rules PASS: ring score/combo, miss breaks combo, timeout.');
  // Win path: all rings + landing.
  const w = makeGame();
  startRun(w);
  w.ring = 12; w.ringsPassed = 12; w.score = 12000;
  w.flight.pos.set(420, 48, -140);
  w.flight.heading = Math.PI; w.flight.speed = 40; w.flight.pitch = 0; w.flight.roll = 0;
  let r2 = 'fly';
  for (let i = 0; i < 600 && w.phase === PHASE_FLY; i++) stepGame(w, { pitch: -0.1, roll: 0, throttle: 0.3 }, STEP);
  assert.equal(w.phase, PHASE_WIN, `All rings + landing wins (got ${w.phase})`);
  assert(w.score > 12000, 'Landing pays a time bonus');
  console.log('Win PASS: all rings + runway landing = win with time bonus.');
}

// --- Autopilot (the same one the screenshots use) can fly the whole course ---
{
  const shots = await import('./game/src/shots.js');
  const g = makeGame();
  startRun(g);
  const mem = shots.makeAutopilotMem();
  let steps = 0;
  while (g.phase === PHASE_FLY && steps < 60 * 400) {
    stepGame(g, shots.autopilotInput(g, mem), STEP);
    steps++;
  }
  console.log(`Autopilot full run: phase=${g.phase}, rings=${g.ringsPassed}/12, score=${g.score}, time=${g.time.toFixed(1)}s, steps=${steps}`);
  assert(g.phase === PHASE_WIN, `Autopilot should win the run (got ${g.phase}, rings ${g.ringsPassed})`);
}

console.log('Node rules PASS.');

// --- Browser: the real game in headless Chromium ---
const require = createRequire(import.meta.url);
let playwright;
for (const loc of ['playwright-core', '/opt/hatch/skills/spaces/ts-runtime/dist/node_modules/playwright-core', '/opt/muse/assets/spaces/ts-runtime/dist/node_modules/playwright-core']) {
  try { playwright = require(loc); break; } catch {}
}
if (!playwright) throw new Error('Install playwright-core to run the browser playtest');
const browser = await playwright.chromium.launch({
  executablePath: join(homedir(), '.cache/ms-playwright/chromium-1148/chrome-linux/chrome'),
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
});
const consoleErrors = [], pageErrors = [], remote = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1:8091') && !r.url().startsWith('data:')) remote.push(r.url()); });
  await page.goto('http://127.0.0.1:8091', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game?.S.phase === 'menu', { timeout: 20000 });
  assert.equal(await page.evaluate(() => document.querySelector('.panel h1')?.textContent), 'SKYRING');
  // Take off with Enter, fly with real keys for 10 s.
  await page.keyboard.press('Enter');
  await page.evaluate(() => __game.S.flight.throttle = 0.8);
  await page.keyboard.down('ArrowUp');
  await page.waitForTimeout(3000);
  await page.keyboard.up('ArrowUp');
  await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(2000);
  await page.keyboard.up('ArrowRight');
  const mid = await page.evaluate(() => ({ phase: __game.S.phase, alt: __game.S.flight.pos.y, spd: __game.S.flight.speed, score: __game.S.score }));
  assert.equal(mid.phase, 'fly', `Still flying after 5 s of input (got ${mid.phase})`);
  assert(mid.alt > 20 && mid.spd > 30, `Plane is airborne and fast: ${JSON.stringify(mid)}`);
  // HUD shows live numbers.
  const hud = await page.evaluate(() => document.getElementById('v-alt').textContent);
  assert(/\d+/.test(hud) && !hud.startsWith('0'), `HUD altitude live: ${hud}`);
  // Drive the real step function forward with the autopilot and confirm a ring passes in-browser.
  const rings = await page.evaluate(async () => {
    const shots = await import('./src/shots.js');
    const mem = shots.makeAutopilotMem();
    for (let i = 0; i < 60 * 240; i++) {
      if (__game.S.phase !== 'fly') break;
      __game.step(1 / 60, shots.autopilotInput(__game.S, mem));
    }
    return { phase: __game.S.phase, rings: __game.S.ringsPassed, score: __game.S.score };
  });
  console.log(`Browser autopilot: ${JSON.stringify(rings)}`);
  assert(rings.rings >= 1, 'At least one ring passes in the real browser game');
  // Crash path: dive into the sea, expect the CRASHED overlay.
  await page.evaluate(() => { __game.startRun(); const f = __game.S.flight; f.pos.set(0, 5, 0); f.pitch = -0.5; f.speed = 50; });
  await page.waitForFunction(() => window.__game.S.phase === 'crash', { timeout: 20000 });
  assert.equal(await page.evaluate(() => document.querySelector('.panel.crash h1')?.textContent), 'CRASHED!');
  // Restart with R, then force the win overlay through the real landing path.
  await page.keyboard.press('KeyR');
  assert.equal(await page.evaluate(() => __game.S.phase), 'fly');
  await page.evaluate(() => {
    const S = __game.S; S.ring = 12; S.ringsPassed = 12; S.score = 12000;
    const f = S.flight; f.pos.set(420, 6, -140); f.heading = Math.PI; f.speed = 40; f.pitch = 0; f.roll = 0; f.throttle = 0.3;
  });
  await page.waitForFunction(() => window.__game.S.phase === 'win', { timeout: 20000 });
  assert.equal(await page.evaluate(() => document.querySelector('.panel.win h1')?.textContent), 'YOU WIN!');
  // Shot scenes render and flag ready.
  for (const shot of ['start', 'play', 'approach', 'end']) {
    await page.goto(`http://127.0.0.1:8091/?shot=${shot}&seed=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true, { timeout: 60000 });
    const state = await page.evaluate(() => ({ phase: __game.S.phase, rings: __game.S.ringsPassed, score: __game.S.score }));
    console.log(`Shot ${shot}: ${JSON.stringify(state)}`);
    assert(!['menu', 'fly', 'win', 'crash', 'timeout'].includes(state.phase) === false);
  }
  // No NaN/Infinity anywhere in the scene graph.
  const finite = await page.evaluate(() => {
    const vals = [];
    __game.scene.traverse((o) => { vals.push(...o.position.toArray(), ...o.rotation.toArray().slice(0, 3), ...o.scale.toArray()); });
    return vals.every(Number.isFinite);
  });
  assert(finite, 'Scene graph has no NaN/Infinity');
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(remote, []);
  console.log('Browser PASS: menu, takeoff, keys, HUD, rings, crash, restart, win, all 4 shots.');
  console.log('console errors: 0; page errors: 0; external requests: 0');
} finally { await browser.close(); }
