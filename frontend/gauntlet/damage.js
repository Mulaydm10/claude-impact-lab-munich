// Glassbox Gauntlet — the ball and everything that can be done to it.
// Damage is pure geometry + vertex colour: no textures, no postprocessing.

import * as THREE from 'three';

const BASE = new THREE.Color('#c9ccd1');

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const RADIUS = 0.62;

export function createBall() {
  const group = new THREE.Group();

  const geo = new THREE.IcosahedronGeometry(RADIUS, 5).toNonIndexed();
  const pos = geo.attributes.position;
  const original = pos.array.slice();
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    colors[i * 3] = BASE.r;
    colors[i * 3 + 1] = BASE.g;
    colors[i * 3 + 2] = BASE.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    name: 'ball_steel',
    vertexColors: true,
    metalness: 0.82,
    roughness: 0.34,
    flatShading: false
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'ball';

  // Dark interior, revealed wherever a chunk is knocked out.
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(RADIUS * 0.94, 3),
    new THREE.MeshStandardMaterial({ name: 'ball_core', color: '#20242a', metalness: 0.3, roughness: 0.9, side: THREE.BackSide })
  );
  core.name = 'core';
  group.add(core, mesh);

  const triCount = pos.count / 3;
  const alive = new Uint8Array(triCount).fill(1);
  const rnd = mulberry(0x51a2b1);

  const vAt = (i, out) => out.set(original[i * 3], original[i * 3 + 1], original[i * 3 + 2]);
  const tmp = new THREE.Vector3();
  const dirOf = (i) => {
    vAt(i, tmp);
    return tmp.clone().normalize();
  };

  function eachVertex(fn) {
    for (let i = 0; i < pos.count; i++) fn(i, dirOf(i));
  }

  function shade(i, target, amount) {
    const c = geo.attributes.color;
    const t = new THREE.Color(target);
    c.setXYZ(
      i,
      THREE.MathUtils.lerp(c.getX(i), t.r, amount),
      THREE.MathUtils.lerp(c.getY(i), t.g, amount),
      THREE.MathUtils.lerp(c.getZ(i), t.b, amount)
    );
  }

  function offset(i, along, amount) {
    pos.setXYZ(i, pos.getX(i) + along.x * amount, pos.getY(i) + along.y * amount, pos.getZ(i) + along.z * amount);
  }

  function randomDir() {
    const v = new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
    if (v.lengthSq() < 1e-4) v.set(1, 0, 0);
    return v.normalize();
  }

  function dent(dir, radius = 0.55, depth = 0.09) {
    eachVertex((i, d) => {
      const t = 1 - Math.min(1, d.angleTo(dir) / radius);
      if (t <= 0) return;
      const fall = t * t * (3 - 2 * t);
      offset(i, d, -depth * fall);
      shade(i, '#8f949b', 0.5 * fall);
    });
  }

  function scorch(dir, radius = 0.7, intensity = 0.75) {
    eachVertex((i, d) => {
      const t = 1 - Math.min(1, d.angleTo(dir) / radius);
      if (t <= 0) return;
      shade(i, '#2b2118', intensity * t * t);
      if (t > 0.6) shade(i, '#4a2f1c', 0.25 * t);
    });
  }

  function crack(dir, length = 1.2, width = 0.09, depth = 0.05) {
    const axis = new THREE.Vector3().crossVectors(dir, randomDir()).normalize();
    const wobble = rnd() * 0.4 + 0.8;
    eachVertex((i, d) => {
      const ang = d.angleTo(dir);
      if (ang > length) return;
      const plane = Math.abs(d.dot(axis));
      const w = width * (0.6 + 0.9 * Math.sin(ang * 4 * wobble) ** 2);
      if (plane > w) return;
      const fall = (1 - plane / w) * (1 - ang / length);
      offset(i, d, -depth * fall);
      shade(i, '#15171b', 0.9 * fall);
    });
  }

  const debrisDirs = [];
  function chunk(dir, radius = 0.42) {
    for (let t = 0; t < triCount; t++) {
      if (!alive[t]) continue;
      const c = new THREE.Vector3();
      for (let k = 0; k < 3; k++) {
        vAt(t * 3 + k, tmp);
        c.add(tmp);
      }
      c.divideScalar(3).normalize();
      const ang = c.angleTo(dir);
      if (ang < radius) {
        alive[t] = 0;
        for (let k = 0; k < 3; k++) pos.setXYZ(t * 3 + k, 0, 0, 0);
      } else if (ang < radius * 1.5) {
        for (let k = 0; k < 3; k++) {
          const i = t * 3 + k;
          const d = dirOf(i);
          offset(i, d, -0.05 * (1 - (ang - radius) / (radius * 0.5)));
          shade(i, '#3a3f46', 0.6);
        }
      }
    }
    debrisDirs.push(dir.clone());
    return dir.clone();
  }

  function commit() {
    pos.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
  }

  function reset() {
    pos.array.set(original);
    const c = geo.attributes.color;
    for (let i = 0; i < pos.count; i++) c.setXYZ(i, BASE.r, BASE.g, BASE.b);
    alive.fill(1);
    debrisDirs.length = 0;
    commit();
    mesh.visible = true;
    core.visible = true;
  }

  return {
    group,
    mesh,
    core,
    material,
    geometry: geo,
    ops: { dent, scorch, crack, chunk },
    randomDir,
    commit,
    reset,
    livingRatio: () => alive.reduce((s, v) => s + v, 0) / triCount
  };
}

/**
 * Severity -> what actually happens to the ball.
 * Returns { speedLoss, impact } so the run schedule can slow the ball down.
 */
export function applyFinding(ball, severity, seedDir) {
  const dir = seedDir || ball.randomDir();
  const o = ball.ops;
  let speedLoss = 0;
  let impact = 0.15;
  if (severity === 1) {
    o.dent(dir, 0.42, 0.055);
    impact = 0.25;
  } else if (severity === 2) {
    o.dent(dir, 0.55, 0.1);
    o.scorch(dir, 0.62, 0.6);
    speedLoss = 0.04;
    impact = 0.45;
  } else if (severity === 3) {
    o.dent(dir, 0.62, 0.14);
    o.crack(dir, 1.15, 0.085, 0.06);
    o.scorch(dir, 0.5, 0.35);
    speedLoss = 0.09;
    impact = 0.7;
  } else if (severity >= 4) {
    o.chunk(dir, 0.4);
    o.crack(dir, 1.5, 0.11, 0.07);
    o.scorch(dir, 0.85, 0.5);
    speedLoss = 0.16;
    impact = 1;
  }
  ball.commit();
  return { speedLoss, impact, dir };
}

/** Break the ball into shards that fly apart. Returns the shard group + a step fn. */
export function shatter(ball, THREE_NS = THREE) {
  ball.mesh.visible = false;
  ball.core.visible = false;
  const shards = new THREE_NS.Group();
  const mat = new THREE_NS.MeshStandardMaterial({ name: 'shard_steel', color: '#9aa0a8', metalness: 0.8, roughness: 0.45, flatShading: true });
  const rnd = mulberry(0x9e3779b9);
  const bits = [];
  for (let i = 0; i < 46; i++) {
    const s = RADIUS * (0.14 + rnd() * 0.22);
    const g = rnd() > 0.5 ? new THREE_NS.TetrahedronGeometry(s) : new THREE_NS.BoxGeometry(s, s * 0.6, s * 1.3);
    const m = new THREE_NS.Mesh(g, mat);
    const dir = new THREE_NS.Vector3(rnd() * 2 - 1, rnd() * 1.2, rnd() * 2 - 1).normalize();
    m.position.copy(dir).multiplyScalar(RADIUS * 0.7);
    bits.push({
      mesh: m,
      vel: dir.clone().multiplyScalar(1.6 + rnd() * 2.6).add(new THREE_NS.Vector3(0, 1.6 + rnd() * 1.4, 0)),
      spin: new THREE_NS.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(9)
    });
    shards.add(m);
  }
  function step(dt) {
    for (const b of bits) {
      b.vel.y -= 7.5 * dt;
      b.mesh.position.addScaledVector(b.vel, dt);
      b.mesh.rotation.x += b.spin.x * dt;
      b.mesh.rotation.y += b.spin.y * dt;
      b.mesh.rotation.z += b.spin.z * dt;
      if (b.mesh.position.y < -0.3) {
        b.mesh.position.y = -0.3;
        b.vel.y *= -0.32;
        b.vel.multiplyScalar(0.72);
      }
    }
  }
  return { group: shards, step };
}
