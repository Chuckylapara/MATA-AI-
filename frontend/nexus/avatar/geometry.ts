// Procedural particle geometry for the NEXUS avatar, modelled on the reference image:
// a luminous humanoid bust drawn with flowing contour lines, a glowing orange core in
// the face, gold energy veins down the neck, a particle "halo" above the head and a
// particle mountain landscape with gold rivers on both sides.
//
// Everything is generated from math (no mesh assets) so each state is just a shader
// uniform change, and body regions are particle groups that can be retargeted.

export const GROUP = { HEAD: 0, HALO: 1, NECK: 2, TORSO: 3, VEINS: 4, ENV: 5, DUST: 6, EYES: 7, ARMS: 8, CORE: 9 } as const;

export const HEAD_CENTER = { x: 0, y: 1.76, z: 0 };
export const NECK_PIVOT = { x: 0, y: 1.28, z: 0 };
export const SHOULDER_L = [0.8, 0.62, 0.02] as const; // avatar's left is +x (viewer's right)
export const SHOULDER_R = [-0.8, 0.62, 0.02] as const;

export interface ParticleBuffers {
  position: Float32Array;
  normal: Float32Array;
  gold: Float32Array;
  group: Float32Array;
  rand: Float32Array;
  size: Float32Array;
  count: number;
}

// ---------------------------------------------------------------- deterministic RNG + noise
export function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}
function smooth(t: number) { return t * t * (3 - 2 * t); }
export function noise2(x: number, y: number) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  const u = smooth(xf), v = smooth(yf);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v; // 0..1
}
export function fbm(x: number, y: number, oct = 5) {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { s += amp * noise2(x * f, y * f); f *= 2.03; amp *= 0.5; }
  return s;
}

// ---------------------------------------------------------------- builder
class Builder {
  p: number[] = []; n: number[] = []; g: number[] = []; grp: number[] = []; r: number[] = []; s: number[] = [];
  private rnd: () => number;
  constructor(rnd: () => number) { this.rnd = rnd; }
  add(x: number, y: number, z: number, nx: number, ny: number, nz: number, gold: number, group: number, size: number) {
    this.p.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    this.n.push(nx / l, ny / l, nz / l);
    this.g.push(gold); this.grp.push(group); this.r.push(this.rnd()); this.s.push(size);
  }
  build(): ParticleBuffers {
    return {
      position: new Float32Array(this.p), normal: new Float32Array(this.n), gold: new Float32Array(this.g),
      group: new Float32Array(this.grp), rand: new Float32Array(this.r), size: new Float32Array(this.s),
      count: this.g.length,
    };
  }
}

// ---------------------------------------------------------------- body surfaces
const HC = HEAD_CENTER;
const RX = 0.43, RY = 0.56, RZ = 0.46;

/** Head surface point for latitude theta (0=top … π=bottom) and azimuth u (0 = facing viewer). */
function headPoint(theta: number, u: number, ring: number) {
  const c = Math.cos(theta);
  let r = Math.sin(theta);
  if (c < 0) r *= 1 - 0.3 * Math.pow(-c, 1.5);          // narrower jaw & chin
  if (c > 0.55) r *= 1 + 0.04 * (c - 0.55);              // fuller cranium
  let x = RX * r * Math.sin(u);
  let z = RZ * r * Math.cos(u);
  let y = HC.y + RY * c + 0.006 * Math.sin(6 * u + ring * 0.7);
  if (z > 0) {
    z *= 0.93;
    // nose ridge
    z += 0.055 * Math.exp(-((u / 0.11) ** 2)) * Math.exp(-(((y - HC.y + 0.08) / 0.075) ** 2));
    // brow + eye sockets
    for (const ex of [-0.14, 0.14]) {
      z -= 0.028 * Math.exp(-(((x - ex) ** 2 + (y - HC.y - 0.035) ** 2) / 0.0035));
    }
    z += 0.018 * Math.exp(-(((y - HC.y - 0.09) / 0.03) ** 2)) * Math.exp(-((x / 0.22) ** 2)); // brow ridge
    z += 0.02 * Math.exp(-(((y - HC.y + 0.39) / 0.05) ** 2)) * Math.exp(-((x / 0.08) ** 2));   // chin
  }
  return { x, y, z };
}

function torsoWidth(y: number) {
  if (y >= 0.97) return 0.17;
  if (y >= 0.5) {
    // rounded shoulder: concave trapezius near the neck, vertical at the deltoid
    const e = Math.sqrt(Math.max(0, 1 - ((y - 0.5) / 0.47) ** 2));
    return 0.17 + 0.85 * Math.pow(e, 1.35);
  }
  return 1.02 + 0.05 * (0.5 - y);                    // upper arms flare slightly outward
}
function torsoDepth(y: number) {
  if (y >= 0.97) return 0.17;
  return 0.2 + 0.12 * Math.min(1, (1.0 - y) / 0.5);
}
/** Front-surface z of the torso at (x, y); returns null outside the silhouette. */
export function torsoZ(x: number, y: number) {
  const w = torsoWidth(y);
  const q = Math.abs(x) / w;
  if (q >= 1) return null;
  let z = torsoDepth(y) * Math.pow(1 - q ** 3, 1 / 3);
  // pectoral volume
  for (const px of [-0.42, 0.42]) z += 0.05 * Math.exp(-(((x - px) ** 2) / 0.06 + ((y - 0.38) ** 2) / 0.05));
  // sternum groove
  z -= 0.02 * Math.exp(-((x / 0.05) ** 2)) * (y < 0.75 ? 1 : 0);
  return z;
}
function torsoNormal(x: number, y: number) {
  const e = 0.01;
  const z0 = torsoZ(x, y) ?? 0;
  const zx = (torsoZ(x + e, y) ?? z0) - z0;
  const zy = (torsoZ(x, y + e) ?? z0) - z0;
  return [-zx / e, -zy / e, 1] as const;
}

// ---------------------------------------------------------------- main generator
export function buildAvatar(quality = 1, seed = 7): ParticleBuffers {
  const rnd = mulberry32(seed);
  const b = new Builder(rnd);
  const q = Math.max(0.25, Math.min(1.25, quality));

  // --- HEAD: horizontal flowing contour rings ---------------------------------
  const rings = Math.round(54 * Math.sqrt(q));
  for (let i = 0; i < rings; i++) {
    const theta = 0.17 * Math.PI + (i / (rings - 1)) * 0.77 * Math.PI;
    const circ = 2 * Math.PI * RX * Math.sin(theta);
    const n = Math.max(24, Math.round(circ * 420 * q));
    for (let k = 0; k < n; k++) {
      const u = (k / n) * Math.PI * 2 + rnd() * 0.004;
      const { x, y, z } = headPoint(theta, u, i);
      const nx = x / RX, ny = (y - HC.y) / RY, nz = z / RZ;
      const face = Math.exp(-((x / 0.2) ** 2) - (((y - HC.y + 0.06) / 0.17) ** 2)) * (z > 0.12 ? 1 : 0);
      b.add(x, y, z, nx, ny, nz, face, GROUP.HEAD, 0.85 + rnd() * 0.5);
    }
  }
  // Loose particles on the crown (the reference's top edge dissolves into dots)
  for (let i = 0; i < 1600 * q; i++) {
    const theta = (0.08 + rnd() * 0.3) * Math.PI, u = rnd() * Math.PI * 2;
    const { x, y, z } = headPoint(theta, u, 0);
    const push = 1 + rnd() * 0.06;
    b.add(x * push, HC.y + (y - HC.y) * push, z * push, x, y - HC.y, z, 0, GROUP.HEAD, 0.9 + rnd() * 1.2);
  }

  // --- CORE: volumetric orange glow inside the face ----------------------------
  for (let i = 0; i < 2600 * q; i++) {
    const gx = gauss(rnd) * 0.11, gy = gauss(rnd) * 0.1, gz = 0.24 + gauss(rnd) * 0.05;
    const surf = headPoint(Math.acos(Math.max(-1, Math.min(1, gy / RY - 0.06 / RY))), gx / RX, 0);
    b.add(gx, HC.y - 0.06 + gy, Math.min(gz, surf.z - 0.01), 0, 0, 1, 1, GROUP.CORE, 1.1 + rnd() * 1.6);
  }

  // --- EYES: two faint glints that follow gaze and blink -----------------------
  for (const ex of [-0.14, 0.14]) {
    for (let i = 0; i < 40; i++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 0.022;
      const x = ex + Math.cos(a) * rr * 1.5, y = HC.y + 0.035 + Math.sin(a) * rr * 0.7;
      const z = headPoint(Math.acos((y - HC.y) / RY), Math.asin(Math.max(-1, Math.min(1, x / RX))), 0).z + 0.004;
      b.add(x, y, z, 0, 0, 1, 0.6, GROUP.EYES, 1.2 + rnd());
    }
  }

  // --- HALO: particle spray around the crown -----------------------------------
  for (let i = 0; i < 6500 * q; i++) {
    const u = rnd() * Math.PI * 2;
    const theta = (0.06 + Math.pow(rnd(), 1.3) * 0.56) * Math.PI;  // biased to the top
    const dir = [Math.sin(theta) * Math.sin(u), Math.cos(theta), Math.sin(theta) * Math.cos(u) * 0.85];
    const d = 1.02 + Math.pow(rnd(), 2.2) * 0.75;
    const x = dir[0] * RX * d * 1.06 + (rnd() - 0.5) * 0.12, y = HC.y + 0.03 + dir[1] * RY * d, z = dir[2] * RZ * d + (rnd() - 0.5) * 0.1;
    b.add(x, y, z, dir[0], dir[1], dir[2], rnd() < 0.03 ? 0.4 : 0, GROUP.HALO, 1.2 + Math.pow(rnd(), 3) * 4.2);
  }

  // --- NECK: vertical flowing lines -------------------------------------------
  const neckLines = Math.round(40 * Math.sqrt(q));
  for (let l = 0; l < neckLines; l++) {
    const a = -Math.PI * 0.62 + (l / (neckLines - 1)) * Math.PI * 1.24;
    const pts = Math.round(90 * q);
    for (let k = 0; k < pts; k++) {
      const t = k / (pts - 1);
      const y = 0.9 + t * 0.48;
      const flare = 1 + 0.9 * Math.pow(1 - t, 3);
      const r = 0.18 * flare;
      const x = Math.sin(a) * r * (1 + 0.6 * Math.pow(1 - t, 4));
      const z = Math.cos(a) * r * 0.85 + 0.02;
      b.add(x, y, z, Math.sin(a), 0, Math.cos(a), 0, GROUP.NECK, 0.8 + rnd() * 0.5);
    }
  }

  // --- TORSO: offset contour lines following the shoulder silhouette ----------
  const outline: [number, number][] = [];
  for (let y = 0.97; y >= -0.35; y -= 0.003) outline.push([torsoWidth(y), y]);        // trapezius → shoulder → side
  const lines = Math.round(30 * Math.sqrt(q));
  for (const side of [1, -1]) {
    for (let k = 0; k < lines; k++) {
      const off = 0.012 + k * 0.03;
      let prev: [number, number] | null = null;
      for (let i = 1; i < outline.length - 1; i++) {
        const [x0, y0] = outline[i - 1], [x1, y1] = outline[i + 1];
        const tx = x1 - x0, ty = y1 - y0, tl = Math.hypot(tx, ty) || 1;
        // inward normal (towards the body centre / downward)
        const nx = -ty / tl, ny = tx / tl;
        const [ox, oy] = outline[i];
        // the body interior is always towards −x (centre) and −y (down) from the outline
        const x = ox - Math.abs(nx) * off, y = oy - Math.abs(ny) * off;
        if (x < 0.02) continue;
        if (prev) {
          // resample densely between successive offset points
          const seg = Math.hypot(x - prev[0], y - prev[1]);
          const steps = Math.max(1, Math.round(seg * 260 * q));
          for (let s = 1; s <= steps; s++) {
            const px = prev[0] + ((x - prev[0]) * s) / steps, py = prev[1] + ((y - prev[1]) * s) / steps;
            const zz = torsoZ(px, py);
            if (zz === null || py < -0.4) continue;
            const nrm = torsoNormal(px, py);
            b.add(px * side, py, zz + 0.004, nrm[0] * side, nrm[1], nrm[2], 0, GROUP.TORSO, 0.8 + rnd() * 0.5);
          }
        }
        prev = [x, y];
      }
    }
  }
  // Concentric pectoral arcs "(( ))"
  for (const cx of [-0.44, 0.44]) {
    for (let r = 0.07; r < 0.42; r += 0.032 / Math.sqrt(q)) {
      const n = Math.round(r * 2 * Math.PI * 200 * q);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const x = cx + Math.cos(a) * r * 1.1, y = 0.3 + Math.sin(a) * r;
        if ((cx < 0 && x > -0.05) || (cx > 0 && x < 0.05) || y > 0.66) continue;
        const zz = torsoZ(x, y);
        if (zz === null) continue;
        const nrm = torsoNormal(x, y);
        b.add(x, y, zz + 0.006, nrm[0], nrm[1], nrm[2], 0, GROUP.TORSO, 1.0 + rnd() * 0.5);
      }
    }
  }
  // Sparse surface dust + sternum particle pool
  for (let i = 0; i < 1800 * q; i++) {
    const x = (rnd() * 2 - 1) * 1.0, y = -0.35 + rnd() * 1.35;
    const zz = torsoZ(x, y);
    if (zz === null) continue;
    const nrm = torsoNormal(x, y);
    b.add(x, y, zz + rnd() * 0.02, nrm[0], nrm[1], nrm[2], 0, GROUP.TORSO, 0.6 + rnd() * 0.9);
  }
  for (let i = 0; i < 1400 * q; i++) {
    const x = gauss(rnd) * 0.07, y = -0.15 + gauss(rnd) * 0.07;
    b.add(x, y, (torsoZ(x, y) ?? 0.3) + 0.01 + rnd() * 0.03, 0, 0, 1, 0.1, GROUP.TORSO, 1 + rnd() * 2);
  }

  // --- VEINS: branching gold energy lines from the jaw down to the sternum ----
  const veinPath = (sx: number, sy: number, ex: number, ey: number, wobble: number, depth: number) => {
    const steps = Math.round(Math.hypot(ex - sx, ey - sy) * 520 * q);
    let jx = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      jx += (rnd() - 0.5) * wobble;
      jx *= 0.96;
      const x = sx + (ex - sx) * t + jx, y = sy + (ey - sy) * t;
      const zs = y > 0.95 ? Math.sqrt(Math.max(0, 0.15 ** 2 - x * x)) * 0.85 + 0.03 : (torsoZ(x, y) ?? 0.2);
      b.add(x, y, zs + 0.012, 0, 0, 1, 1, GROUP.VEINS, 1.0 + rnd() * 0.8);
      if (depth > 0 && rnd() < 0.012) {
        const dir = x >= 0 ? 1 : -1;
        veinPath(x, y, x + dir * (0.05 + rnd() * 0.12), y - 0.08 - rnd() * 0.18, wobble * 0.8, depth - 1);
      }
    }
  };
  for (const s of [-1, 1]) {
    veinPath(s * 0.05, 1.3, s * 0.02, 0.5, 0.004, 2);
    veinPath(s * 0.09, 1.2, s * 0.06, 0.62, 0.005, 2);
  }
  veinPath(0, 0.62, 0, 0.02, 0.003, 1);

  // --- ENVIRONMENT: particle mountains with gold rivers -----------------------
  for (const side of [1, -1]) {
    const nx = Math.round(210 * q), nz = Math.round(120 * q);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = 1.15 + (i / nx) * 4.6 + (rnd() - 0.5) * 0.03;
        const z = -5.5 + (j / nz) * 6.3 + (rnd() - 0.5) * 0.03;
        const sx = x * 0.55 + (side > 0 ? 0 : 40), sz = z * 0.55;
        const ridge = 1 - Math.abs(fbm(sx * 1.3, sz * 1.3, 4) * 2 - 1);
        const rise = 0.25 + 0.42 * (x - 1.15) - 0.06 * z;
        const y = -0.62 + rise * (0.35 + fbm(sx, sz) * 1.3) + ridge * ridge * 0.6 * (0.3 + 0.3 * (x - 1.15));
        const v = Math.abs(noise2(sx * 2.1 + 3.7, sz * 2.1 - 1.3) - 0.5);
        const v2 = Math.abs(noise2(sx * 4.3 - 8.1, sz * 4.3 + 2.2) - 0.5);
        const gold = v < 0.04 || (v2 < 0.02 && ridge > 0.6) ? 1 : 0;
        if (gold === 0 && rnd() < 0.1) continue;
        b.add(side * x, y, z, 0, 1, 0.3, gold, GROUP.ENV, gold ? 1.4 + rnd() : 0.8 + rnd() * 1.0 + ridge * 0.6);
      }
    }
  }

  // --- DUST: floating motes in the volume -------------------------------------
  for (let i = 0; i < 2600 * q; i++) {
    b.add((rnd() * 2 - 1) * 5.5, -0.6 + rnd() * 3.4, -5 + rnd() * 5.5, 0, 0, 1, rnd() < 0.08 ? 1 : 0,
          GROUP.DUST, 0.5 + rnd() * 1.2);
  }

  return b.build();
}

function gauss(rnd: () => number) {
  const u = 1 - rnd(), v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------------------------------------------------------------- arms (CPU-animated, for motion mirroring)
export const ARM_RING = 22, ARM_RINGS_PER_BONE = 26, FINGER_PTS = 10;
export const HAND_BONES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];
export const ARM_POINTS = 2 * ARM_RING * ARM_RINGS_PER_BONE + HAND_BONES.length * FINGER_PTS;
