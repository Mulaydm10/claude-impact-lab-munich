// Glassbox Gauntlet — scene, run schedule, endings.
import * as THREE from 'three';
import { FIXTURE, FIXTURE_NOTE, buildGauntlet, SEVERITY } from './data.js';
import { createBall, applyFinding, shatter, RADIUS } from './damage.js';

const GATE_GAP = 11;
const FIRST_GATE = 8;
const SEG = 2.15;
const RUN_CAP = 20; // seconds of rolling, hard cap
const PASS_MARK = 30;

const el = (id) => document.getElementById(id);
const sev = (n) => SEVERITY[Math.max(0, Math.min(4, n | 0))];

/* ---------------------------------------------------------------- scene */

const canvas = el('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setClearColor('#0b0d10');

const scene = new THREE.Scene();
scene.fog = new THREE.Fog('#0b0d10', 26, 62);

const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
scene.add(new THREE.HemisphereLight('#9fb4c8', '#1b2027', 1.5));
const key = new THREE.DirectionalLight('#fff4e6', 1.5);
key.position.set(6, 9, -4);
scene.add(key);
const rim = new THREE.DirectionalLight('#7fa6d0', 0.9);
rim.position.set(-7, 4, 8);
scene.add(rim);

const world = new THREE.Group();
scene.add(world);

const ball = createBall();
scene.add(ball.group);

const blob = new THREE.Mesh(
  new THREE.CircleGeometry(RADIUS * 1.25, 24),
  new THREE.MeshBasicMaterial({ color: '#05070a', transparent: true, opacity: 0.55 })
);
blob.rotation.x = -Math.PI / 2;
scene.add(blob);

function labelSprite(text, sub) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 256;
  const x = c.getContext('2d');
  x.clearRect(0, 0, 1024, 256);
  x.fillStyle = 'rgba(11,14,18,0.9)';
  x.fillRect(0, 0, 1024, 256);
  x.strokeStyle = '#39424c';
  x.lineWidth = 6;
  x.strokeRect(3, 3, 1018, 250);
  x.fillStyle = '#e8e4dc';
  x.font = 'bold 96px ui-monospace, Menlo, Consolas, monospace';
  x.textAlign = 'center';
  x.fillText(text, 512, 118);
  if (sub) {
    x.fillStyle = '#8d9aa4';
    x.font = '44px ui-monospace, Menlo, Consolas, monospace';
    x.fillText(sub, 512, 190);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 1.1), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  return m;
}

const floorMat = new THREE.MeshStandardMaterial({ color: '#20262d', metalness: 0.1, roughness: 0.95 });
const railMat = new THREE.MeshStandardMaterial({ color: '#252b32', metalness: 0.5, roughness: 0.6 });
const postMat = new THREE.MeshStandardMaterial({ color: '#2e353d', metalness: 0.6, roughness: 0.5 });

function buildTrack(length) {
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, length), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.001, length / 2 - 10);
  world.add(floor);
  for (const s of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.34, length), railMat);
    rail.position.set(s * 2.6, 0.17, length / 2 - 10);
    world.add(rail);
  }
  for (let z = -8; z < length - 10; z += 2) {
    const tick = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.02, 0.06), new THREE.MeshBasicMaterial({ color: '#1e242b' }));
    tick.position.set(0, 0.006, z);
    world.add(tick);
  }
}

function buildGate(stage, z, index) {
  const g = new THREE.Group();
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 3.4, 12), postMat);
    post.position.set(s * 2.55, 1.7, 0);
    g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.26, 0.3), postMat);
  beam.position.y = 3.3;
  g.add(beam);

  const lbl = labelSprite(stage.label, stage.blurb);
  lbl.position.set(0, 4.15, -0.02);
  lbl.rotation.y = Math.PI; // face the camera, which trails the ball
  g.add(lbl);

  // Obstacle body: severity-coded by SHAPE as well as colour.
  const worst = stage.worst;
  const color = sev(worst).color;
  const obMat = new THREE.MeshStandardMaterial({ color, metalness: 0.35, roughness: 0.55, emissive: color, emissiveIntensity: 0.14 });
  let ob;
  if (worst >= 4) ob = new THREE.Mesh(new THREE.OctahedronGeometry(0.5), obMat);
  else if (worst === 3) ob = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.34), obMat);
  else if (worst === 2) ob = new THREE.Mesh(new THREE.ConeGeometry(0.52, 0.86, 3), obMat);
  else if (worst === 1) ob = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.3), obMat);
  else ob = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 8, 24), obMat);
  ob.position.set(0, 0.95, 0);
  ob.userData.spin = worst > 0 ? 1.4 : 0.5;
  g.add(ob);
  g.userData.obstacle = ob;
  g.position.z = z;
  world.add(g);
  return g;
}

function buildFinish(z) {
  const g = new THREE.Group();
  for (let i = 0; i < 12; i++) {
    const b = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.09, 0.3),
      new THREE.MeshBasicMaterial({ color: i % 2 ? '#e8e4dc' : '#3a424b' })
    );
    b.position.set(-2.475 + i * 0.45, 0.05, 0);
    g.add(b);
  }
  g.position.z = z;
  world.add(g);
  return g;
}

/* --------------------------------------------------------------- sparks */

const sparkGeo = new THREE.TetrahedronGeometry(0.06);
const sparkMat = new THREE.MeshBasicMaterial({ color: '#ffcf8f' });
const sparks = [];
function burst(origin, strength) {
  const n = Math.round(6 + strength * 22);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(sparkGeo, sparkMat);
    m.position.copy(origin);
    scene.add(m);
    sparks.push({
      m,
      life: 0.5 + Math.random() * 0.4,
      vel: new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(1.5 + strength * 4)
    });
  }
}
function stepSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    s.life -= dt;
    s.vel.y -= 9 * dt;
    s.m.position.addScaledVector(s.vel, dt);
    s.m.scale.setScalar(Math.max(0.01, s.life * 1.6));
    if (s.life <= 0 || s.m.position.y < -0.5) {
      scene.remove(s.m);
      sparks.splice(i, 1);
    }
  }
}
function clearSparks() {
  sparks.forEach((s) => scene.remove(s.m));
  sparks.length = 0;
}

/* ----------------------------------------------------------------- audio */

let actx = null;
function audio() {
  if (!actx) {
    try {
      actx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      actx = null;
    }
  }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function thud(strength) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(180 + strength * 60, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(48, a.currentTime + 0.22);
  g.gain.setValueAtTime(0.0001, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.05 + strength * 0.16, a.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + 0.45);
  o.connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + 0.5);
}
function sting(low) {
  const a = audio();
  if (!a) return;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = low ? 'sawtooth' : 'sine';
  o.frequency.setValueAtTime(low ? 110 : 420, a.currentTime);
  o.frequency.exponentialRampToValueAtTime(low ? 27 : 660, a.currentTime + (low ? 1.6 : 0.5));
  g.gain.setValueAtTime(0.0001, a.currentTime);
  g.gain.exponentialRampToValueAtTime(low ? 0.22 : 0.12, a.currentTime + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + (low ? 2.4 : 1.1));
  const f = a.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = low ? 420 : 3000;
  o.connect(f).connect(g).connect(a.destination);
  o.start();
  o.stop(a.currentTime + (low ? 2.5 : 1.2));
}

/* ------------------------------------------------------------------- run */

let G = null; // gauntlet data
let gates = [];
let finishLine = null;
let schedule = null;
let shards = null;
const state = { t: 0, phase: 'idle', scale: 1, applied: -1, endT: 0, gray: 0, shake: 0, ended: false };

function makeSchedule(g) {
  const keys = [{ t: 0, z: -4 }];
  const events = [];
  let t = 0;
  let loss = 0;
  g.stages.forEach((s, i) => {
    const z = FIRST_GATE + i * GATE_GAP;
    t += SEG * (1 + loss);
    keys.push({ t, z });
    events.push({ t, stage: i });
    loss = Math.min(0.5, loss + Math.min(0.28, s.load * 0.028));
  });
  t += SEG * (1 + loss) * 0.95;
  const finishZ = FIRST_GATE + g.stages.length * GATE_GAP;
  keys.push({ t, z: finishZ });
  const scale = t > RUN_CAP ? RUN_CAP / t : 1;
  keys.forEach((k) => (k.t *= scale));
  events.forEach((e) => (e.t *= scale));
  return { keys, events, finishZ, end: t * scale };
}

function zAt(t) {
  const k = schedule.keys;
  if (t <= 0) return k[0].z;
  for (let i = 1; i < k.length; i++) {
    if (t <= k[i].t) {
      const u = (t - k[i - 1].t) / Math.max(1e-4, k[i].t - k[i - 1].t);
      return THREE.MathUtils.lerp(k[i - 1].z, k[i].z, u);
    }
  }
  return k[k.length - 1].z + (t - k[k.length - 1].t) * 5;
}

/* -------------------------------------------------------------- overlay */

const callouts = [];
function callout(finding) {
  const s = sev(finding.severity);
  const node = document.createElement('div');
  node.className = 'callout';
  node.style.setProperty('--c', s.color);
  node.innerHTML =
    `<span class="glyph">${s.glyph}</span><span class="body"><b>${escape_(finding.text)}</b>` +
    (finding.detail ? `<i>${escape_(finding.detail)}</i>` : '') +
    `</span>`;
  el('callouts').appendChild(node);
  callouts.push({ node, life: 3.4 });
  requestAnimationFrame(() => node.classList.add('in'));
}
function escape_(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}
function stepCallouts(dt) {
  for (let i = callouts.length - 1; i >= 0; i--) {
    const c = callouts[i];
    c.life -= dt;
    if (c.life <= 0) {
      c.node.classList.remove('in');
      setTimeout(() => c.node.remove(), 400);
      callouts.splice(i, 1);
    }
  }
}
function clearCallouts() {
  callouts.forEach((c) => c.node.remove());
  callouts.length = 0;
  el('callouts').innerHTML = '';
}

function banner(stage) {
  const b = el('banner');
  const s = sev(stage.worst);
  b.innerHTML =
    `<span class="k">${escape_(stage.label)}</span>` +
    `<span class="v" style="color:${s.color}">${s.glyph} ${stage.count} finding${stage.count === 1 ? '' : 's'}</span>`;
  b.classList.add('in');
  clearTimeout(banner._t);
  banner._t = setTimeout(() => b.classList.remove('in'), 2200);
}

function markTick(i, stage) {
  const t = el('ticks').children[i];
  if (!t) return;
  t.classList.add('hit');
  t.style.setProperty('--c', sev(stage.worst).color);
  t.querySelector('.g').textContent = sev(stage.worst).glyph;
}

/* --------------------------------------------------------------- stages */

function hitStage(i, instant) {
  const stage = G.stages[i];
  const ops = stage.findings.filter((f) => f.severity > 0).slice(0, 5);
  let impact = 0;
  ops.forEach((f, k) => {
    const dir = ball.randomDir();
    // bias damage onto the hemisphere the camera can see
    dir.set(Math.abs(dir.x) * 0.9 + 0.35, dir.y * 0.7 + 0.3, -Math.abs(dir.z) * 0.5 - 0.15).normalize();
    const r = applyFinding(ball, f.severity, dir);
    impact = Math.max(impact, r.impact);
  });
  if (!instant) {
    banner(stage);
    stage.shown.forEach((f, k) => setTimeout(() => callout(f), k * 320));
    if (impact > 0) {
      burst(ball.group.position.clone().add(new THREE.Vector3(0, 0.1, -RADIUS)), impact);
      state.shake = Math.min(0.5, impact * 0.5);
      thud(impact);
    }
  }
  markTick(i, stage);
  const g = gates[i];
  if (g && g.userData.obstacle && stage.worst > 0) g.userData.obstacle.userData.knocked = true;
}

/* --------------------------------------------------------------- ending */

function breakdownHTML() {
  return G.stages
    .map((s) => {
      const sv = sev(s.worst);
      const top = s.findings.find((f) => f.severity > 0);
      return `<div class="row"><span class="g" style="color:${sv.color}">${sv.glyph}</span>
        <span class="n">${escape_(s.label)}</span>
        <span class="c">${s.count === 0 ? 'clean' : s.count + ' finding' + (s.count === 1 ? '' : 's')}</span>
        <span class="d">${escape_(top ? top.text : s.findings[0] ? s.findings[0].text : '')}</span></div>`;
    })
    .join('');
}

function endRun() {
  if (state.ended) return;
  state.ended = true;
  const pass = G.score >= PASS_MARK;
  el('verdictPanel').innerHTML = `
    <div class="vhead">
      <div class="score"><b>${G.score}</b><span>/100 · ${escape_(String(G.verdict).replace(/_/g, ' '))}</span></div>
      <div class="meta">${G.sourceCount} sources · ${G.claimCount} claims · ${escape_(G.sessionId)}</div>
    </div>
    <div class="breakdown">${breakdownHTML()}</div>
    ${G.summary ? `<p class="summary">${escape_(G.summary)}</p>` : ''}`;
  el('verdictPanel').classList.add('in');

  if (pass) {
    state.phase = 'pass';
    state.scale = 0.42; // brief hang as it crosses
    el('passWord').textContent = String(G.verdict).replace(/_/g, ' ');
    el('passSub').textContent = `${G.score}/100 · crossed the line`;
    burst(ball.group.position.clone().add(new THREE.Vector3(0, 0.2, 0)), 0.9);
    sting(false);
    setTimeout(() => el('pass').classList.add('in'), 420);
  } else {
    state.phase = 'fail';
    state.scale = 1;
    shards = shatter(ball, THREE);
    shards.group.position.copy(ball.group.position);
    scene.add(shards.group);
    burst(ball.group.position.clone(), 1);
    sting(true);
    setTimeout(() => el('slam').classList.add('in'), 850);
  }
}

/* ----------------------------------------------------------------- loop */

let last = performance.now();
let errCount = 0;
function frame(now) {
  try {
    tick(now);
  } catch (err) {
    if (errCount++ < 3) console.error('gauntlet frame error', err);
    window.__lastError = String((err && err.stack) || err);
  }
  requestAnimationFrame(frame);
}

function tick(now) {
  const raw = Math.min(0.05, (now - last) / 1000);
  last = now;
  const dt = raw * state.scale;

  if (state.phase === 'running') {
    state.t += dt;
    while (state.applied + 1 < schedule.events.length && state.t >= schedule.events[state.applied + 1].t) {
      state.applied++;
      hitStage(schedule.events[state.applied].stage, false);
    }
    if (state.t >= schedule.end) {
      if (G.score < PASS_MARK) state.phase = 'slowing';
      else endRun();
    }
  } else if (state.phase === 'slowing') {
    state.t += dt;
    state.scale = Math.max(0.22, state.scale - raw * 1.5);
    state.gray = Math.min(1, state.gray + raw * 1.3);
    canvas.style.filter = `saturate(${1 - state.gray * 0.94}) contrast(${1 + state.gray * 0.12})`;
    if (state.scale <= 0.24) endRun();
  } else if (state.phase === 'fail') {
    state.gray = Math.min(1, state.gray + raw * 0.9);
    canvas.style.filter = `saturate(${1 - state.gray * 0.94}) contrast(${1 + state.gray * 0.12})`;
    if (shards) shards.step(raw * 0.55);
  } else if (state.phase === 'pass') {
    state.t += dt * 0.5;
    state.scale = Math.min(1, state.scale + raw * 0.9);
    if (finishLine) {
      finishLine.children.forEach((b, i) => {
        const k = Math.sin(performance.now() / 240 + i * 0.5) * 0.5 + 0.5;
        b.position.y = 0.05 + k * 0.06;
      });
    }
  }

  // ball transform
  const z = state.phase === 'idle' ? -4 : zAt(state.t);
  const prevZ = ball.group.position.z;
  ball.group.position.set(0, RADIUS + Math.max(0, state.shake) * 0.25, z);
  ball.group.rotation.x += (z - prevZ) / RADIUS;
  blob.position.set(0, 0.004, z);
  blob.scale.setScalar(1 - Math.max(0, state.shake) * 0.2);
  if (shards) shards.group.position.z = ball.group.position.z;
  state.shake = Math.max(0, state.shake - raw * 1.6);

  // camera
  const target = new THREE.Vector3(4.4, 2.6, z - 6.1);
  if (state.phase === 'fail' || state.phase === 'pass') target.set(3.1, 1.9, z - 4.6);
  camera.position.lerp(target, 1 - Math.pow(0.001, raw));
  camera.position.x += (Math.random() - 0.5) * state.shake * 0.5;
  camera.position.y += (Math.random() - 0.5) * state.shake * 0.4;
  camera.lookAt(0, 0.45 + state.shake * 0.2, z + 3.2);

  // gate obstacles
  for (const g of gates) {
    const ob = g.userData.obstacle;
    if (!ob) continue;
    ob.rotation.y += raw * ob.userData.spin;
    if (ob.userData.knocked) {
      ob.position.y = THREE.MathUtils.lerp(ob.position.y, 2.2, raw * 2);
      ob.rotation.z += raw * 5;
      ob.material.opacity = 1;
    }
  }

  stepSparks(raw);
  stepCallouts(raw);

  // anchor callouts beside the ball
  const p = ball.group.position.clone().project(camera);
  const cx = (p.x * 0.5 + 0.5) * innerWidth;
  const cy = (-p.y * 0.5 + 0.5) * innerHeight;
  const holder = el('callouts');
  holder.style.transform = `translate(${Math.round(Math.min(innerWidth - 380, cx + 58))}px, ${Math.round(
    Math.max(90, Math.min(innerHeight - 240, cy - 130))
  )}px)`;

  el('clock').textContent = (state.phase === 'idle' ? 0 : Math.min(99, state.t)).toFixed(1) + 's';

  renderer.render(scene, camera);
}

/* ---------------------------------------------------------------- setup */

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

function clearWorld() {
  while (world.children.length) {
    const c = world.children.pop();
    c.traverse?.((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.map) o.material.map.dispose();
    });
  }
  gates = [];
}

function load(doc, label) {
  G = buildGauntlet(doc);
  schedule = makeSchedule(G);
  clearWorld();
  buildTrack(schedule.finishZ + 24);
  G.stages.forEach((s, i) => gates.push(buildGate(s, FIRST_GATE + i * GATE_GAP, i)));
  finishLine = buildFinish(schedule.finishZ);

  el('ticks').innerHTML = G.stages
    .map((s) => `<div class="tick"><span class="g">·</span><span class="l">${escape_(s.label)}</span></div>`)
    .join('');
  el('meta').innerHTML =
    `<b>${escape_(G.intent.domain || 'report')}</b>` +
    `<span>${G.sourceCount} sources · ${G.claimCount} claims · ${G.stages.length} stages</span>` +
    `<em>${escape_(label)}</em>`;
  reset();
}

function reset() {
  state.t = 0;
  state.phase = 'idle';
  state.scale = 1;
  state.applied = -1;
  state.gray = 0;
  state.shake = 0;
  state.ended = false;
  canvas.style.filter = '';
  ball.reset();
  clearSparks();
  clearCallouts();
  if (shards) {
    scene.remove(shards.group);
    shards = null;
  }
  el('slam').classList.remove('in');
  el('pass').classList.remove('in');
  el('verdictPanel').classList.remove('in');
  gates.forEach((g) => {
    const ob = g.userData.obstacle;
    if (ob) {
      ob.userData.knocked = false;
      ob.position.y = 0.95;
      ob.rotation.set(0, 0, 0);
    }
  });
  [...el('ticks').children].forEach((t) => {
    t.classList.remove('hit');
    t.querySelector('.g').textContent = '·';
  });
  camera.position.set(4.4, 2.6, -10);
}

function start() {
  audio();
  if (state.phase !== 'idle') reset();
  state.phase = 'running';
}

function skip() {
  if (state.ended) return;
  for (let i = state.applied + 1; i < G.stages.length; i++) hitStage(i, true);
  state.applied = G.stages.length - 1;
  state.t = schedule.end;
  if (G.score < PASS_MARK) state.phase = 'slowing';
  else {
    state.phase = 'pass';
    endRun();
  }
  audio();
}

el('replay').onclick = start;
el('skip').onclick = skip;
addEventListener('keydown', (e) => {
  if (e.key === 'r') start();
  if (e.key === 's') skip();
});

// file drop: a real /api/verify FullReport replaces the fixture
const drop = document.documentElement;
drop.addEventListener('dragover', (e) => {
  e.preventDefault();
  el('drop').classList.add('in');
});
drop.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) el('drop').classList.remove('in');
});
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  el('drop').classList.remove('in');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  try {
    const doc = JSON.parse(await file.text());
    load(doc, file.name);
    start();
  } catch (err) {
    el('meta').insertAdjacentHTML('beforeend', `<em class="bad">could not read ${escape_(file.name)}</em>`);
  }
});

window.__gauntlet = { state, start, skip, ball, load, get data() { return G; }, get schedule() { return schedule; } };

resize();
load(FIXTURE, FIXTURE_NOTE);
requestAnimationFrame(frame);
setTimeout(start, 700);
