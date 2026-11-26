// Boot + render loop. Chase camera behind the Kestrel, sun + hemisphere light, fog for depth.
// Exposes window.__game for the playtest, and window.__shotReady once a staged scene has drawn.
import * as THREE from 'three';
import { buildWorld, COURSE, RING_COUNT } from './world.js';
import { buildPlaneMesh, syncPlaneMesh } from './plane.js';
import { makeGame, startRun, stepGame, PHASE_MENU, PHASE_FLY, PHASE_WIN, PHASE_CRASH, PHASE_TIMEOUT } from './game.js';
import { buildHUD, updateHUD } from './hud.js';
import { ensureAudio, setEngine, ringChime, missBuzz, crashThud, winFanfare } from './audio.js';
import { stageShot } from './shots.js';
import { clamp } from './util.js';

const params = new URLSearchParams(location.search);
const shotName = params.get('shot');
const seed = Number(params.get('seed') || 1);

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xbcd9ea, 300, 1900);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.5, 5000);

scene.add(new THREE.HemisphereLight(0xbfd9ff, 0x6a7a5a, 0.9));
const sun = new THREE.DirectionalLight(0xfff2cf, 1.6);
sun.position.set(-600, 800, -900);
scene.add(sun);

const world = buildWorld(scene);
const planeMesh = buildPlaneMesh();
scene.add(planeMesh);

const game = makeGame();
buildHUD(document);

const keys = new Set();
let mouseX = 0, mouseY = 0, mouseActive = false;
let paused = false;
let lastEventCount = 0;

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys.add(e.code);
  ensureAudio();
  if (e.code === 'Enter' && game.phase === PHASE_MENU) startRun(game);
  if (e.code === 'KeyR' && game.phase !== PHASE_MENU) { startRun(game); }
  if (e.code === 'KeyP' && game.phase === PHASE_FLY) paused = !paused;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('mousedown', (e) => { ensureAudio(); if (game.phase === PHASE_MENU) startRun(game); });
addEventListener('mousemove', (e) => {
  mouseX = (e.clientX / innerWidth - 0.5) * 2;
  mouseY = (e.clientY / innerHeight - 0.5) * 2;
  mouseActive = true;
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function readInput() {
  const f = game.flight;
  let pitch = 0, roll = 0;
  if (keys.has('ArrowUp')) pitch += 1;
  if (keys.has('ArrowDown')) pitch -= 1;
  if (keys.has('ArrowLeft')) roll -= 1;
  if (keys.has('ArrowRight')) roll += 1;
  if (mouseActive && game.phase === PHASE_FLY) {
    roll += clamp(mouseX * 1.4, -1, 1) * 0.8;
    pitch += clamp(-mouseY * 1.2, -1, 1) * 0.6;
  }
  let throttle = f.throttle;
  if (keys.has('KeyW')) throttle = clamp(throttle + 0.5 * (1 / 60), 0, 1);
  if (keys.has('KeyS')) throttle = clamp(throttle - 0.5 * (1 / 60), 0, 1);
  return { pitch: clamp(pitch, -1, 1), roll: clamp(roll, -1, 1), throttle };
}

function playEventSounds() {
  for (let i = lastEventCount; i < game.events.length; i++) {
    const ev = game.events[i];
    if (ev.type === 'ring') ringChime(game.combo);
    else if (ev.type === 'miss') missBuzz();
    else if (ev.type === 'crash') crashThud();
    else if (ev.type === 'win') winFanfare();
  }
  lastEventCount = game.events.length;
}

function updateRings(time) {
  world.rings.forEach((r, i) => {
    if (i < game.ring) {
      // Passed: shrink to a small muted marker so a just-flown ring never fills the
      // chase camera's frame.
      r.mat.color.setHex(0x69b578); r.mesh.scale.setScalar(0.45);
    } else if (i === game.ring) {
      const pulse = 1 + Math.sin(time * 5) * 0.08;
      r.mat.color.setHex(0xffb020); r.mesh.scale.setScalar(pulse);
    } else { r.mat.color.setHex(0xffb020); r.mesh.scale.setScalar(1); }
  });
}

// Chase camera: behind and above the plane, looking ahead down the course.
const camOffset = new THREE.Vector3();
function updateCamera(dt) {
  const f = game.flight;
  const back = new THREE.Vector3(Math.sin(f.heading), 0, Math.cos(f.heading));
  const desired = f.pos.clone().addScaledVector(back, 20).add(new THREE.Vector3(0, 7, 0));
  camOffset.lerp(desired, clamp(dt * 5, 0, 1));
  camera.position.copy(camOffset);
  const ahead = f.pos.clone().addScaledVector(new THREE.Vector3(-Math.sin(f.heading), 0, -Math.cos(f.heading)), 60);
  ahead.y += f.pitch * 30;
  camera.lookAt(ahead);
  camera.rotateZ(f.roll * 0.35);
}

const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
let shotStaged = false;
let frames = 0;

// Landmark labels are sprites centred on their island anchor: when the anchor is
// near a screen edge the sprite hangs off-screen and the text renders cut off.
// Fade each label out as its projected extent approaches the viewport edge, and
// hide it entirely when it would clip or sits behind the camera.
const _labelPos = new THREE.Vector3();
function updateLabels() {
  const tanHalfFov = Math.tan((camera.fov * Math.PI / 180) / 2);
  for (const s of world.labels) {
    _labelPos.copy(s.position).project(camera);
    const dist = camera.position.distanceTo(s.position);
    // Sprite half-extent in NDC: world half-size / (distance * tan(fov/2) [* aspect]).
    const hw = (s.scale.x / 2) / (dist * tanHalfFov * camera.aspect);
    const hh = (s.scale.y / 2) / (dist * tanHalfFov);
    // Fully visible while the whole sprite is inside; fade to 0 over a 0.08 NDC band.
    const fx = Math.max(0, (Math.abs(_labelPos.x) - (1 - hw - 0.08)) / 0.08);
    const fy = Math.max(0, (Math.abs(_labelPos.y) - (1 - hh - 0.08)) / 0.08);
    const behind = _labelPos.z < -1 || _labelPos.z > 1;
    const a = behind ? 0 : Math.max(0, 1 - Math.max(fx, fy));
    s.material.opacity = a;
    s.visible = a > 0;
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (shotName && !shotStaged) {
    stageShot(shotName, game, world, seed);
    shotStaged = true;
    camOffset.copy(game.flight.pos).add(new THREE.Vector3(Math.sin(game.flight.heading) * 20, 7, Math.cos(game.flight.heading) * 20));
  }
  if (!paused && game.phase === PHASE_FLY) {
    acc += dt;
    while (acc >= STEP) { stepGame(game, readInput(), STEP); acc -= STEP; }
    playEventSounds();
  }
  setEngine(game.flight.throttle, game.phase === PHASE_FLY);
  updateRings(now / 1000);
  syncPlaneMesh(planeMesh, game.flight, now / 1000);
  updateCamera(dt);
  updateLabels();
  renderer.render(scene, camera);
  updateHUD(game);
  frames++;
  if (shotName && shotStaged && frames > 5) window.__shotReady = true;
}

// Menu idle: park the plane on the runway so the title screen shows the aircraft + runway.
if (!shotName) {
  game.flight.pos.set(420, 41.7, -140);
  game.flight.heading = Math.PI;
  camOffset.copy(game.flight.pos).add(new THREE.Vector3(0, 7, 20));
}

window.__game = {
  S: game, game, world, planeMesh,
  step: (dt = STEP, input) => { if (game.phase === PHASE_FLY) { stepGame(game, input ?? readInput(), dt); playEventSounds(); } },
  startRun: () => startRun(game),
  renderer, scene, camera,
};
requestAnimationFrame(frame);
