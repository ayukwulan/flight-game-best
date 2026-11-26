// Aircraft: a small original prop-plane ("Kestrel") built from primitives, plus the arcade
// flight model. The model is deliberately simple and deterministic: speed from throttle,
// pitch/roll from the stick, heading follows bank, lift falls off below stall speed.
import * as THREE from 'three';
import { clamp, wrapAngle, angleLerp } from './util.js';
import { groundHeight } from './world.js';

export const PLANE = {
  stallSpeed: 26, maxSpeed: 95, accel: 14, drag: 0.12,
  pitchRate: 0.9, rollRate: 3.0, turnRate: 1.0,
};

export function buildPlaneMesh() {
  const g = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: 0xe8452c }); // kestrel red
  const cream = new THREE.MeshLambertMaterial({ color: 0xf6ead2 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2b2f36 });
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fd8ef, emissive: 0x1a3a4a });

  // Fuselage: tapered cylinder pointing -Z (nose forward is -Z in three convention here).
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 0.55, 7.2, 10), paint);
  body.rotation.x = Math.PI / 2;
  g.add(body);
  // Nose cone + spinner.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.15, 1.6, 10), cream);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -4.4;
  g.add(nose);
  const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 8), dark);
  spinner.rotation.x = -Math.PI / 2;
  spinner.position.z = -5.4;
  g.add(spinner);
  // Propeller blades (spin in the render loop via userData).
  const prop = new THREE.Group();
  const bladeMat = new THREE.MeshLambertMaterial({ color: 0x1c1e22 });
  for (const a of [0, Math.PI]) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.35, 4.6, 0.12), bladeMat);
    blade.rotation.z = a;
    prop.add(blade);
  }
  prop.position.z = -5.5;
  g.add(prop);
  g.userData.prop = prop;
  // Canopy.
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 8), glass);
  canopy.scale.set(0.9, 0.75, 1.7);
  canopy.position.set(0, 1.0, -1.2);
  g.add(canopy);
  // Main wings.
  const wing = new THREE.Mesh(new THREE.BoxGeometry(13.5, 0.28, 2.4), cream);
  wing.position.set(0, 0.1, -0.4);
  g.add(wing);
  const wingTipL = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.3, 2.4), paint);
  wingTipL.position.set(-6.9, 0.1, -0.4); g.add(wingTipL);
  const wingTipR = wingTipL.clone(); wingTipR.position.x = 6.9; g.add(wingTipR);
  // Tail.
  const tail = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.24, 1.6), cream);
  tail.position.set(0, 0.35, 3.2);
  g.add(tail);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.24, 2.4, 1.8), paint);
  fin.position.set(0, 1.3, 3.2);
  g.add(fin);
  // Landing gear.
  for (const x of [-1.1, 1.1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.4, 6), dark);
    leg.position.set(x, -1.3, -1.0);
    g.add(leg);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.4, 10), dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, -2.0, -1.0);
    g.add(wheel);
  }
  // Navigation lights: lit wingtip lamps (the "instruments lit" cue in chase view).
  const navL = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
  navL.position.set(-7.1, 0.1, -0.4); g.add(navL);
  const navR = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: 0x2aff5a }));
  navR.position.set(7.1, 0.1, -0.4); g.add(navR);
  return g;
}

// Flight state: position, heading (yaw), pitch, roll, speed, throttle.
export function makeFlightState() {
  return {
    pos: new THREE.Vector3(420, 41.7, -140),
    heading: Math.PI, pitch: 0, roll: 0,
    speed: 42, throttle: 0.65,
    crashed: false, landed: false,
  };
}

export function resetFlight(f, start) {
  f.pos.set(start.x, start.y, start.z);
  f.heading = start.heading ?? Math.PI;
  f.pitch = 0; f.roll = 0; f.speed = 42; f.throttle = 0.65;
  f.crashed = false; f.landed = false;
}

// input: { pitch: -1..1 (up positive), roll: -1..1 (right positive), throttle: 0..1, dt }
// Returns 'fly' | 'crash' | 'land'.
export function stepFlight(f, input, dt, wind) {
  if (f.crashed || f.landed) return f.crashed ? 'crash' : 'land';
  // Throttle -> speed. Throttling down bites faster than spooling up (flaps + drag).
  const target = PLANE.stallSpeed + input.throttle * (PLANE.maxSpeed - PLANE.stallSpeed);
  const rate = target > f.speed ? 2.2 : 5.0;
  f.speed += (target - f.speed) * clamp(PLANE.accel * dt / PLANE.maxSpeed, 0, 1) * rate;
  f.speed -= f.speed * PLANE.drag * dt * 0.25;
  f.throttle = input.throttle;
  // Stick -> pitch / roll (smoothed).
  f.pitch = clamp(f.pitch + input.pitch * PLANE.pitchRate * dt, -0.6, 0.6);
  f.pitch *= (1 - 0.4 * dt); // gentle return toward level
  const targetRoll = input.roll * 1.1;
  f.roll = angleLerp(f.roll, targetRoll, clamp(PLANE.rollRate * dt, 0, 1));
  // Heading follows bank; pitch changes altitude.
  f.heading = wrapAngle(f.heading + (-f.roll) * PLANE.turnRate * dt * clamp(f.speed / 40, 0.4, 1.4));
  const dir = new THREE.Vector3(-Math.sin(f.heading), 0, -Math.cos(f.heading));
  // Climb / sink: pitch component plus lift shortfall below stall.
  const lift = clamp(f.speed / PLANE.stallSpeed, 0, 1.4);
  const climb = Math.sin(f.pitch) * f.speed - (1 - Math.min(lift, 1)) * 9;
  f.pos.addScaledVector(dir, f.speed * Math.cos(f.pitch) * dt);
  f.pos.y += climb * dt;
  // Wind drift.
  f.pos.x += wind.x * dt; f.pos.z += wind.z * dt;
  // Ceiling.
  if (f.pos.y > 320) { f.pos.y = 320; f.pitch = Math.min(f.pitch, 0); }
  // Ground / sea collision.
  const ground = groundHeight(f.pos.x, f.pos.z);
  if (f.pos.y <= Math.max(ground + 1.2, 1.2)) {
    // A gentle touchdown on the runway at low speed and shallow pitch counts as a landing.
    const onRunway = Math.abs(f.pos.x - 420) < 14 && Math.abs(f.pos.z + 60) < 110;
    if (onRunway && f.speed < 55 && Math.abs(f.pitch) < 0.3 && Math.abs(f.roll) < 0.5) {
      f.landed = true;
      f.pos.y = ground + 1.2;
      return 'land';
    }
    f.crashed = true;
    f.pos.y = Math.max(ground + 1.2, 1.2);
    return 'crash';
  }
  return 'fly';
}

export function syncPlaneMesh(mesh, f, time) {
  mesh.position.copy(f.pos);
  mesh.rotation.set(0, 0, 0);
  mesh.rotateY(f.heading);
  mesh.rotateX(-f.pitch);
  mesh.rotateZ(f.roll);
  if (mesh.userData.prop) mesh.userData.prop.rotation.z += 0.35 + f.speed * 0.02;
}
