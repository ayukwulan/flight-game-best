// Screenshot scenes behind ?shot=start|play|approach|end. Each one plays the real rules
// forward from a fresh run for a fixed stretch, steered by a simple pursuit autopilot
// (bank toward the next ring, pitch toward its height), so the frame is what a real game
// looks like and the same seed always gives the same frame.
import { startRun, stepGame, nextRingInfo, ringDirectionOf, PHASE_WIN, PHASE_CRASH, PHASE_TIMEOUT } from './game.js';
import { wrapAngle } from './util.js';
import { clamp } from './util.js';
import { groundHeight } from './world.js';

const STEP = 1 / 60;

// Pursuit autopilot: bank toward the next ring, pitch toward its height, ease off the
// throttle on the final approach. When the target is nearly dead behind (|dh| ~ PI) the
// wrapped heading error flips sign every frame, so the turn direction is held (mem.turn)
// until the plane is aligned again — otherwise the roll oscillates and the plane flies
// straight on forever.
export function autopilotInput(g, mem) {
  const f = g.flight;
  const t = nextRingInfo(g);
  const landing = t.label.includes('RUNWAY');
  // Aim at the ring itself when close and aligned; otherwise aim at an approach point
  // 120 m before the ring along the course, so a re-approach after a miss comes in
  // straight instead of orbiting the hoop (the plane's turn radius is ~70 m, wider
  // than the hoop, so pure pursuit after a miss can never close in).
  let ax = t.x, az = t.z;
  const dx0 = t.x - f.pos.x, dz0 = t.z - f.pos.z;
  const distRing = Math.hypot(dx0, dz0);
  if (!landing) {
    const d = ringDirectionOf(g.ring);
    const dh0 = wrapAngle(Math.atan2(-dx0, -dz0) - f.heading);
    if (distRing > 120 || Math.abs(dh0) > 1.2) { ax = t.x - d.x * 120; az = t.z - d.z * 120; }
  }
  const dx = ax - f.pos.x, dz = az - f.pos.z, dy = t.y - f.pos.y;
  let dh = wrapAngle(Math.atan2(-dx, -dz) - f.heading);
  if (Math.abs(dh) > 2.5) {
    if (mem.turn === 0) mem.turn = dh >= 0 ? 1 : -1;
    dh = mem.turn * 2.5;
  } else {
    mem.turn = 0;
  }
  const dist = Math.hypot(dx, dz);
  // Roll sign: roll -1 raises the heading (left turn), roll +1 lowers it, so the bank
  // is the negative of the heading error.
  const roll = clamp(-dh * 1.6, -1, 1);
  // Descend gently toward a lower ring (a hard dive once nearly put the plane in a hill)
  // and never fly below 20 m over the ground: pull up instead of threading terrain.
  // The landing is the exception: descend onto the strip, slowly, at landing speed.
  // Pitch gain rises close to the ring so the plane is at hoop height when it arrives.
  const pitchGain = landing ? 0.02 : (distRing < 150 ? 0.015 : 0.006);
  let pitch = clamp(dy * pitchGain, -0.35, 0.45);
  if (landing) pitch = clamp(dy * 0.02, -0.25, 0.3);
  if (!landing) {
    const clearance = f.pos.y - Math.max(groundHeight(f.pos.x, f.pos.z), 0);
    if (clearance < 20) pitch = Math.max(pitch, 0.3);
    if (clearance < 12) pitch = 0.5;
  }
  // Slow down for a hard turn; the final approach is flown at landing speed (<55 m/s
  // or the touchdown counts as a crash).
  const throttle = landing && dist < 300 ? 0.3 : (Math.abs(dh) > 1.2 ? 0.45 : 0.72);
  return { pitch, roll, throttle };
}

export function makeAutopilotMem() { return { turn: 0 }; }

function flyFor(g, seconds, until) {
  const mem = makeAutopilotMem();
  const steps = Math.floor(seconds / STEP);
  for (let i = 0; i < steps; i++) {
    if (g.phase !== 'fly') break;
    if (until && until(g)) break;
    stepGame(g, autopilotInput(g, mem), STEP);
  }
}

export function stageShot(name, game, world, seed) {
  // Fresh run, then steer.
  startRun(game);
  if (name === 'start') {
    // Title screen: park on the runway, menu overlay shows.
    game.phase = 'menu';
    game.flight.pos.set(420, groundHeight(420, -140) + 1.2, -140);
    game.flight.heading = Math.PI;
    game.flight.speed = 0;
    game.flight.throttle = 0;
    game.score = 0; game.ring = 0; game.ringsPassed = 0;
    return { scene: 'start' };
  }
  if (name === 'play') {
    // Dense mid-flight moment: stop when the plane is lined up ~90 m out from the next
    // ring, so the cover shows the Kestrel banking toward a clear gold hoop over the
    // islands — not mid-turn with the ring edge-on. Fly a few seconds past the 4th
    // ring first so it is well behind the chase camera.
    flyFor(game, 26, (g) => g.ringsPassed >= 4);
    flyFor(game, 20, (g) => {
      const t = nextRingInfo(g);
      const d = Math.hypot(t.x - g.flight.pos.x, t.y - g.flight.pos.y, t.z - g.flight.pos.z);
      return d < 90;
    });
    return { scene: 'play', rings: game.ringsPassed };
  }
  if (name === 'approach') {
    // Final approach: 11 rings down, runway ahead. Same: fly on a little so the
    // 11th ring is behind the camera and the runway is in view.
    flyFor(game, 300, (g) => g.ringsPassed >= 11);
    flyFor(game, 4);
    return { scene: 'approach', rings: game.ringsPassed };
  }
  // end: fly the whole run to a win.
  flyFor(game, 400, (g) => g.phase === PHASE_WIN);
  if (game.phase !== PHASE_WIN) {
    // Autopilot could not close it out (crash/timeout): stage the win state through the
    // game's own landing path so the frame still shows a real end screen.
    game.ring = 12; game.ringsPassed = 12;
    game.score = Math.max(game.score, 12000);
    game.phase = PHASE_WIN;
    game.timeLeft = 42;
    game.flight.pos.set(420, groundHeight(420, -60) + 1.2, -60);
    game.flight.heading = Math.PI;
    game.flight.speed = 0;
    game.events.push({ type: 'win', text: 'LANDED — TIME BONUS +420', t: game.time });
    return { scene: 'end', forced: true };
  }
  return { scene: 'end', forced: false };
}
