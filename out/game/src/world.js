// World: the Coral Chain — a seeded island archipelago with a marked ring-run course.
// Terrain is a heightfield over a 1600x1600 m sea. Islands rise from the water; the course
// threads a valley between Turtle Rock and Twin Peaks, crosses Coral Bay, and finishes on the
// runway at Gull Island. All geometry is generated here from seed 7, so every run is identical.
import * as THREE from 'three';
import { makeNoise2D, clamp, lerp } from './util.js';

export const WORLD = { size: 1600, half: 800, seaLevel: 0 };
export const RING_COUNT = 12;
export const TIME_LIMIT = 240; // seconds for the whole run

const noise = makeNoise2D(7);
const noise2 = makeNoise2D(77);

// Island mask: a few gaussian bumps placed by hand so the course has recognisable landmarks.
const ISLANDS = [
  { x: -560, z: -420, r: 260, h: 46, name: 'Turtle Rock' },
  { x: -260, z: -180, r: 220, h: 38, name: 'Twin Peaks' },
  { x: 120, z: -320, r: 200, h: 30, name: 'Coral Bay' },
  { x: 420, z: -60, r: 240, h: 52, name: 'Gull Island' },
  { x: -120, z: 320, r: 230, h: 34, name: 'Palm Cay' },
  { x: 520, z: 380, r: 210, h: 28, name: 'Anchor Rock' },
  { x: -620, z: 380, r: 190, h: 26, name: 'Mist Point' },
];
export const LANDMARKS = ISLANDS.map((i) => ({ name: i.name, x: i.x, z: i.z }));

// Course: start on the runway at Gull Island, loop out over the sea, thread the rings back.
export const COURSE = [
  { x: 420, z: -60, y: 68 },   // 1  over the runway, climb-out
  { x: 260, z: -260, y: 38 },  // 2  Coral Bay gap
  { x: 60, z: -330, y: 40 },   // 3  Coral Bay
  { x: -160, z: -260, y: 42 }, // 4  Twin Peaks shoulder
  { x: -330, z: -180, y: 52 }, // 5  Twin Peaks pass
  { x: -520, z: -380, y: 56 }, // 6  Turtle Rock turn
  { x: -560, z: -120, y: 34 }, // 7  Turtle Rock west
  { x: -420, z: 140, y: 32 },  // 8  Mist Point gap
  { x: -160, z: 300, y: 50 },  // 9  Palm Cay
  { x: 120, z: 330, y: 34 },   // 10 Palm Cay east
  { x: 380, z: 300, y: 36 },   // 11 Anchor Rock
  { x: 420, z: 140, y: 42 },   // 12 final approach, on the runway centreline — straight in to land
];
export const RUNWAY = { x: 420, z: -60, heading: Math.PI, length: 220, width: 26 };

export function groundHeight(x, z) {
  let h = -6; // sea floor
  for (const isl of ISLANDS) {
    const dx = x - isl.x, dz = z - isl.z;
    const d2 = (dx * dx + dz * dz) / (isl.r * isl.r);
    if (d2 < 4) h += isl.h * Math.exp(-d2 * 1.6) * (0.75 + 0.5 * noise(x * 0.012 + 3, z * 0.012 - 2));
  }
  h += 6 * noise(x * 0.02, z * 0.02) + 2.5 * noise2(x * 0.05, z * 0.05);
  // Flatten a pad under the Gull Island runway so takeoffs and landings are fair:
  // full plateau over the strip (|x-420|<28, |z+60|<115), smooth falloff beyond.
  const dz = Math.abs(z + 60), dx = Math.abs(x - 420);
  const fz = dz < 115 ? 1 : clamp(1 - (dz - 115) / 60, 0, 1);
  const fx = dx < 28 ? 1 : clamp(1 - (dx - 28) / 30, 0, 1);
  const rx = fx * fz;
  const s = rx * rx * (3 - 2 * rx);
  return lerp(h, 40.5, s);
}

export function nearestLandmark(x, z) {
  let best = null, bd = Infinity;
  for (const lm of LANDMARKS) {
    const d = Math.hypot(x - lm.x, z - lm.z);
    if (d < bd) { bd = d; best = lm; }
  }
  return { name: best.name, dist: bd };
}

function terrainMaterial() {
  // Vertex-coloured terrain: sand near the water, grass, then rock on the peaks.
  return new THREE.MeshLambertMaterial({ vertexColors: true });
}

export function buildWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  // --- sky: big gradient dome (BackSide sphere with vertex colours) ---
  const skyGeo = new THREE.SphereGeometry(2400, 24, 12);
  const skyPos = skyGeo.attributes.position;
  const skyCol = new Float32Array(skyPos.count * 3);
  const top = new THREE.Color(0x2f6fd0), mid = new THREE.Color(0x9ecfee), low = new THREE.Color(0xf6d9a8);
  for (let i = 0; i < skyPos.count; i++) {
    const t = clamp(skyPos.getY(i) / 2400, -0.1, 1);
    const c = t > 0.25 ? mid.clone().lerp(top, (t - 0.25) / 0.75) : low.clone().lerp(mid, (t + 0.1) / 0.35);
    skyCol[i * 3] = c.r; skyCol[i * 3 + 1] = c.g; skyCol[i * 3 + 2] = c.b;
  }
  skyGeo.setAttribute('color', new THREE.BufferAttribute(skyCol, 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false }));
  group.add(sky);

  // --- sun + clouds ---
  const sun = new THREE.Mesh(new THREE.SphereGeometry(46, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xfff3c4, fog: false }));
  sun.position.set(-900, 620, -1500);
  group.add(sun);
  const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
  const cloudRng = (() => { let s = 1234; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  for (let i = 0; i < 26; i++) {
    const c = new THREE.Group();
    const puffs = 3 + Math.floor(cloudRng() * 3);
    for (let p = 0; p < puffs; p++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(14 + cloudRng() * 18, 10, 8), cloudMat);
      s.position.set(p * 22 - puffs * 11 + cloudRng() * 8, cloudRng() * 6, cloudRng() * 14 - 7);
      s.scale.y = 0.45;
      c.add(s);
    }
    c.position.set((cloudRng() - 0.5) * 2200, 190 + cloudRng() * 90, (cloudRng() - 0.5) * 2200);
    group.add(c);
  }

  // --- sea ---
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(4800, 4800, 1, 1),
    new THREE.MeshLambertMaterial({ color: 0x1e7fa8 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = WORLD.seaLevel;
  group.add(sea);

  // --- terrain heightfield ---
  const SEG = 160;
  const geo = new THREE.PlaneGeometry(WORLD.size, WORLD.size, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 3);
  const sand = new THREE.Color(0xe8d9a0), grass = new THREE.Color(0x5da24a),
    rock = new THREE.Color(0x8a7f72), snow = new THREE.Color(0xf2f4f6);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = groundHeight(x, z);
    pos.setY(i, h);
    let c;
    if (h < 2.5) c = sand.clone();
    else if (h < 16) c = sand.clone().lerp(grass, (h - 2.5) / 13.5);
    else if (h < 34) c = grass.clone().lerp(rock, (h - 16) / 18);
    else c = rock.clone().lerp(snow, clamp((h - 34) / 14, 0, 1));
    // subtle noise tint so the ground is not flat colour
    const tint = 0.92 + 0.16 * noise(x * 0.09, z * 0.09);
    cols[i * 3] = c.r * tint; cols[i * 3 + 1] = c.g * tint; cols[i * 3 + 2] = c.b * tint;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, terrainMaterial());
  group.add(terrain);

  // --- runway on Gull Island (flattened strip + markings) ---
  const rw = new THREE.Group();
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(RUNWAY.width, RUNWAY.length),
    new THREE.MeshLambertMaterial({ color: 0x3a3f46 }));
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 0.4;
  rw.add(strip);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf5f5f0 });
  for (let i = -4; i <= 4; i++) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 14), lineMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(0, 0.55, i * 22);
    rw.add(dash);
  }
  const thresh = new THREE.Mesh(new THREE.PlaneGeometry(RUNWAY.width - 4, 10), lineMat);
  thresh.rotation.x = -Math.PI / 2;
  thresh.position.set(0, 0.55, -RUNWAY.length / 2 + 8);
  rw.add(thresh);
  rw.position.set(RUNWAY.x, groundHeight(RUNWAY.x, RUNWAY.z) + 0.2, RUNWAY.z);
  rw.rotation.y = RUNWAY.heading;
  group.add(rw);

  // --- landmark beacons: a small flag pole + floating label sprite on each named island ---
  // NOTE: each sprite gets its OWN canvas — a shared canvas would leave every texture
  // showing the last drawing (textures upload lazily, on first render).
  function textSprite(draw, w, h) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const x = c.getContext('2d');
    draw(x);
    const tex = new THREE.CanvasTexture(c);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set(w, h, 1);
    return sprite;
  }
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xdddddd });
  // Landmark label sprites, returned so the render loop can fade any label whose
  // projected extent would cross the viewport edge (a sprite is centred on its
  // anchor, so one near the edge renders as cut-off text).
  const labels = [];
  for (const isl of ISLANDS) {
    const gy = groundHeight(isl.x, isl.z);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 26, 6), poleMat);
    pole.position.set(isl.x, gy + 13, isl.z);
    group.add(pole);
    const sprite = textSprite((x) => {
      x.fillStyle = 'rgba(10,20,40,0.55)';
      x.fillRect(0, 8, 256, 48);
      x.fillStyle = '#ffffff';
      x.font = 'bold 30px sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(isl.name.toUpperCase(), 128, 34);
    }, 64, 16);
    sprite.position.set(isl.x, gy + 34, isl.z);
    group.add(sprite);
    labels.push(sprite);
  }

  // --- target rings: glowing torus + inner disc hint, numbered by position ---
  const rings = [];
  const ringGeo = new THREE.TorusGeometry(16, 1.6, 10, 40);
  COURSE.forEach((c, i) => {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffb020 });
    const ring = new THREE.Mesh(ringGeo, mat);
    ring.position.set(c.x, c.y, c.z);
    // Face along the course direction (toward the next ring).
    const nxt = COURSE[(i + 1) % COURSE.length];
    ring.lookAt(nxt.x, nxt.y, nxt.z);
    group.add(ring);
    // Number sprite floating above the ring.
    const sprite = textSprite((x) => {
      x.fillStyle = 'rgba(10,20,40,0.6)';
      x.beginPath(); x.arc(128, 32, 28, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#ffd23e';
      x.font = 'bold 34px sans-serif';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(String(i + 1), 128, 34);
    }, 18, 4.5);
    sprite.position.set(c.x, c.y + 22, c.z);
    group.add(sprite);
    rings.push({ mesh: ring, mat, pos: new THREE.Vector3(c.x, c.y, c.z), passed: false, index: i });
  });

  return { group, rings, terrain, labels };
}
