// Runebound Depths — auto-casting wizard dungeon crawler (three.js, portrait first).
// ?auto=1 lets a bot play (for recording / testing), ?t=N fast-forwards N seconds, ?seed=N fixes the dungeon.
import * as THREE from './vendor/three.module.js';
import { Monet, PRODUCTS } from './monet.js';
import { mirror, restore } from './durable.js';
import { ELEMENTS, ELEMENT_ORDER, START_ELEMENTS, SHAPES, BOSS_SPELLS, LEGENDARY, LEGACY_IDS, spellDef, TOTAL_SPELLS, levelText, fusionOf, RES, UNDEAD, resistOf,
  SPELL_TIERS, spellTier, HEROES, STATS, STAT_NAMES, derive, statInfo, xpNeed, SLOTS, SLOT_NAMES, RARITY, rollGear, gearLines, gearScore, gearTotals } from './arcana.js';

const params = new URLSearchParams(location.search);
const AUTO = params.has('auto');
const FFWD = parseFloat(params.get('t') || '0');
const BENCH = params.has('bench');
const START_FLOOR = parseInt(params.get('floor') || (BENCH ? '8' : '1'), 10);
const REC = parseFloat(params.get('rec') || '0');
let seed = params.has('seed') ? +params.get('seed') : (Math.random() * 1e9) | 0;
function rand() {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (a, b) => a + rand() * (b - a);
const ri = (a, b) => Math.floor(rr(a, b + 1));
const pick = (a) => a[Math.floor(rand() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---------- dungeon layout constants ----------
const RW = 11, RH = 13;                 // room interior in tiles
const PILLAR_H = 0.8;                   // room pillars stay low so monsters behind them are visible
const SX = RW + 2 + 5, SZ = RH + 2 + 5; // room grid spacing (5-tile corridors)
const GW = 7, GH = 7;
const MW = GW * SX, MH = GH * SZ;
const VOID = 0, FLOOR = 1, WALL = 2, BAR = 3, OBST = 4;
const TALL = 1.5, LOW = 0.55;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const app = $('app'), fxCanvas = $('fx'), fx = fxCanvas.getContext('2d'), lowEl = $('low');

// ---------- renderer / scene ----------
const MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && innerWidth < 900);
const renderer = new THREE.WebGLRenderer({ antialias: !MOBILE, // MSAA is expensive on phone GPUs (MOBILE_PERFORMANCE.md)
  powerPreference: 'high-performance', preserveDrawingBuffer: AUTO });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
// phones: real shadow maps cost ~25% of the frame; the blob shadows under everything are enough
renderer.shadowMap.enabled = !MOBILE && !params.has('noshadow');
renderer.shadowMap.type = THREE.PCFShadowMap;
$('view').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const BG = 0x010103;
scene.background = new THREE.Color(BG);
scene.fog = new THREE.Fog(BG, 30, 46);
const camera = new THREE.PerspectiveCamera(36, 1, 0.5, 140);
const PITCH = 57 * Math.PI / 180;
let camDist = 28, W = 1, H = 1, DPR = 1;

const hemi = new THREE.HemisphereLight(0x4a5c80, 0x0c0812, 0.28);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0x8fa6ff, 0.3); // cold moonlight through cracks
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -15, right: 15, top: 15, bottom: -15, near: 1, far: 60 });
sun.shadow.bias = -0.0006;
scene.add(sun, sun.target);
const pLight = new THREE.PointLight(0xe8d4ff, 18, 8, 1.5);
scene.add(pLight);
const torchLights = [0, 1, 2, 3].map(() => { const l = new THREE.PointLight(0xff7a2a, 14, 6.5, 1.7); scene.add(l); return l; });
const fxLight = new THREE.PointLight(0xffa040, 0, 9, 1.2);
scene.add(fxLight);

function resize() {
  W = app.clientWidth; H = app.clientHeight; DPR = REC ? Math.min(3, 1080 / W) : Math.min(devicePixelRatio, MOBILE ? 1.35 : 1.5);
  renderer.setPixelRatio(DPR);
  renderer.setSize(W, H);
  camera.aspect = W / H;
  const vf = camera.fov * Math.PI / 180;
  const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  camDist = Math.min(16.5 / (2 * Math.tan(hf / 2)), 22 / (2 * Math.tan(vf / 2)));
  scene.fog.near = camDist + 1; scene.fog.far = camDist + 11;
  camera.updateProjectionMatrix();
  fxCanvas.width = W * DPR; fxCanvas.height = H * DPR;
  glowMat.uniforms.uScale.value = (H * DPR) / (2 * Math.tan(vf / 2));
}

// ---------- pixel textures ----------
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const hash = (x, y, s = 0) => { const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };
function stonePixels(g, w, h, base, dark, s) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const n = hash(x, y, s);
    const v = base + (n - 0.5) * 22;
    g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, y, 1, 1);
  }
  g.fillStyle = `rgb(${dark},${dark},${dark})`;
}
const floorTex = canvasTex(16, 16, (g, w, h) => {
  stonePixels(g, w, h, 196, 120, 1);
  g.fillRect(0, 0, w, 1); g.fillRect(0, 0, 1, h);
  g.fillStyle = 'rgb(225,225,225)'; g.fillRect(1, 1, w - 1, 1); g.fillRect(1, 1, 1, h - 1);
  g.fillStyle = 'rgb(150,150,150)'; g.fillRect(1, h - 1, w - 1, 1); g.fillRect(w - 1, 1, 1, h - 1);
});
const floorTex2 = canvasTex(16, 16, (g, w, h) => {
  stonePixels(g, w, h, 190, 110, 2);
  g.fillRect(0, 0, w, 1); g.fillRect(0, 0, 1, h);
  g.fillStyle = 'rgb(140,140,140)';
  for (let i = 3; i < 13; i++) { g.fillRect(i, 3, 1, 1); g.fillRect(i, 12, 1, 1); g.fillRect(3, i, 1, 1); g.fillRect(12, i, 1, 1); }
  g.fillRect(6, 6, 4, 4); g.fillStyle = 'rgb(215,215,215)'; g.fillRect(7, 7, 2, 2);
});
const wallTex = canvasTex(16, 24, (g, w, h) => {
  stonePixels(g, w, h, 190, 110, 3);
  for (let r = 0; r < 4; r++) {
    const y = r * 6; g.fillStyle = 'rgb(110,110,110)'; g.fillRect(0, y, w, 1);
    const off = r % 2 ? 4 : 10; g.fillRect(off, y, 1, 6);
    g.fillStyle = 'rgb(222,222,222)'; g.fillRect(0, y + 1, w, 1);
  }
});
const plinthTex = canvasTex(16, 96, (g, w, h) => {
  stonePixels(g, w, h, 150, 80, 4);
  for (let r = 0; r < 12; r++) {
    const y = r * 8; g.fillStyle = 'rgb(70,70,70)'; g.fillRect(0, y, w, 1);
    g.fillRect(r % 2 ? 3 : 11, y, 1, 8);
  }
  const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(0,0,0,.85)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
});
const runeTex = canvasTex(48, 48, (g, w, h) => {
  stonePixels(g, w, h, 170, 90, 5);
  g.strokeStyle = 'rgb(235,235,235)'; g.lineWidth = 2;
  g.strokeRect(4, 4, 40, 40); g.strokeRect(10, 10, 28, 28);
  g.beginPath(); g.moveTo(24, 6); g.lineTo(42, 24); g.lineTo(24, 42); g.lineTo(6, 24); g.closePath(); g.stroke();
  g.fillStyle = 'rgb(240,240,240)'; g.fillRect(21, 21, 6, 6);
  for (const [x, y] of [[4, 4], [40, 4], [4, 40], [40, 40]]) g.fillRect(x, y, 4, 4);
});
const glowTex = canvasTex(64, 64, (g) => {
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.25, 'rgba(255,255,255,.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
});
glowTex.magFilter = THREE.LinearFilter;
const blobTex = canvasTex(32, 32, (g) => {
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, 'rgba(0,0,0,.9)'); grd.addColorStop(0.6, 'rgba(0,0,0,.6)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
});
blobTex.magFilter = THREE.LinearFilter;
const splatTex = canvasTex(32, 32, (g) => {
  g.fillStyle = '#fff';
  const blob = (x, y, r) => { for (let yy = -r; yy <= r; yy++) for (let xx = -r; xx <= r; xx++) if (xx * xx + yy * yy <= r * r) g.fillRect(Math.round(x + xx), Math.round(y + yy), 1, 1); };
  blob(16, 16, 6);
  for (let i = 0; i < 14; i++) { const a = i * 2.4, d = 5 + (i * 37 % 9); blob(16 + Math.cos(a) * d, 16 + Math.sin(a) * d, 1 + (i % 3)); }
});

const webTex = canvasTex(64, 64, (g) => {
  // web anchored in the top-left corner: radial threads + sagging rings
  g.strokeStyle = 'rgba(230,235,245,.75)'; g.lineWidth = 1;
  const rays = 6;
  for (let k = 0; k <= rays; k++) { const a = k / rays * Math.PI / 2; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 64, Math.sin(a) * 64); g.stroke(); }
  for (let r = 10; r < 64; r += 9) {
    g.beginPath();
    for (let k = 0; k <= rays; k++) { const a = k / rays * Math.PI / 2, rr2 = r - (k % 2) * 3; const x = Math.cos(a) * rr2, y = Math.sin(a) * rr2; k ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
}, true);
const fogTex = canvasTex(64, 64, (g) => {
  for (let k = 0; k < 18; k++) {
    const x = 10 + hash(k, 1) * 44, y = 10 + hash(k, 2) * 44, r = 8 + hash(k, 3) * 14;
    const grd = g.createRadialGradient(x, y, 0, x, y, r); grd.addColorStop(0, 'rgba(255,255,255,.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  }
});
fogTex.magFilter = THREE.LinearFilter;

// ---------- sprite sheets ----------
const sheets = {};
// One main image per character; every bit of motion (hop, squash, waddle, flip) is done in code.
const SPRITE_H = { wizard: 0.95, slime: 0.62, eye: 0.72, imp: 0.8, skeleton: 1.0, boss: 2.5, bomber: 0.62, ghost: 0.8, shroom: 0.72, golem: 1.3, shrine: 1.2, mimic: 1.05, amazon: 0.95, berserker: 0.95, ranger: 0.95, necro: 0.95, elements: 0.6, gear: 0.6, tyrant: 3.0, sporemother: 2.8, wraith: 3.0, hollow: 2.6, stoneking: 3.2, items: 0.55, spells: 0.75 };
const SHEET_FRAMES = { items: 6, spells: 6, elements: 8, gear: 6 };
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
function fallbackSheet(name, n = 1) {
  const c = document.createElement('canvas'); c.width = 16 * n; c.height = 16; // transparent until the real art loads
  return { canvas: c, frames: n, w: 16, h: 16 };
}
// load one sheet image into a canvas; retried, because a phone on a flaky connection can drop a request
async function loadSheetImage(name, frames, tries = 3) {
  for (let k = 0; k < tries; k++) {
    try {
      const img = await loadImg('sprites/' + name + '.png?r=' + k + Date.now() % 100000);
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      c.getContext('2d').drawImage(img, 0, 0);
      return { canvas: c, frames, w: Math.floor(img.width / frames), h: img.height };
    } catch (e) { await new Promise((r) => setTimeout(r, 400 * (k + 1))); }
  }
  return null;
}
async function loadSheets() {
  let man = {};
  try { man = await (await fetch('sprites/manifest.json', { cache: 'no-cache' })).json(); } catch (e) { /* fallback art */ }
  await Promise.all(Object.keys(SPRITE_H).map(async (name) => {
    const frames = SHEET_FRAMES[name] || (man[name] ? man[name].frames : 1);
    let s = await loadSheetImage(name, frames);
    const failed = !s;
    s = s || fallbackSheet(name, frames);
    const tex = new THREE.CanvasTexture(s.canvas);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true; tex.anisotropy = 4;
    s.tex = tex;
    if (name === 'wizard') s.tip = findStaffTip(s.canvas);
    else if (['amazon', 'berserker', 'ranger', 'necro'].includes(name)) s.tip = findWeaponTip(s.canvas);
    sheets[name] = s;
    if (failed) retrySheet(name, frames);
  }));
}
// keep trying in the background and swap the real art in when it arrives (sprites share the texture)
function retrySheet(name, frames) {
  setTimeout(async () => {
    const r = await loadSheetImage(name, frames, 2);
    if (!r) return retrySheet(name, frames);
    const s = sheets[name];
    Object.assign(s, { canvas: r.canvas, w: r.w, h: r.h });
    s.tex.image = r.canvas; s.tex.needsUpdate = true;
  }, 2500);
}
function findStaffTip(c) {
  try {
    const w = c.width, h = c.height, d = c.getContext('2d').getImageData(0, 0, w, h).data;
    const pts = [];
    // the crystal is lavender-pink (blue about as strong as red); the hat is a warmer pink, so it is skipped
    for (let y = 0; y < h * 0.7; y++) for (let x = Math.floor(w * 0.6); x < w; x++) {
      const k = (y * w + x) * 4, r = d[k], b = d[k + 2], a = d[k + 3];
      if (a > 200 && b > 190 && r > 170 && b > r * 0.85) pts.push([x, y]);
    }
    if (!pts.length) return [0.82, 0.78];
    const top = Math.min(...pts.map((q) => q[1])), near = pts.filter((q) => q[1] < top + h * 0.15);
    const cx = near.reduce((a, q) => a + q[0], 0) / near.length, cy = near.reduce((a, q) => a + q[1], 0) / near.length;
    return [cx / w, 1 - cy / h];
  } catch (e) { return [0.82, 0.78]; }
}
// the highest point on the right side of a hero sprite (spear tip, axe head, bow tip, skull)
function findWeaponTip(c) {
  try {
    const w = c.width, h = c.height, d = c.getContext('2d').getImageData(0, 0, w, h).data;
    let top = h;
    for (let y = 0; y < h && top === h; y++) for (let x = Math.floor(w * 0.6); x < w; x++) if (d[(y * w + x) * 4 + 3] > 200) { top = y; break; }
    let sx = 0, n = 0;
    for (let y = top; y < Math.min(h, top + h * 0.08); y++) for (let x = Math.floor(w * 0.6); x < w; x++) if (d[(y * w + x) * 4 + 3] > 200) { sx += x; n++; }
    return n ? [sx / n / w, 1 - (top + h * 0.04) / h] : [0.82, 0.78];
  } catch (e) { return [0.82, 0.78]; }
}
function iconURL(sheet, i, size = 64) {
  const s = sheets[sheet];
  if (!s) return ''; // still loading
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  const k = size / Math.max(s.w, s.h);
  g.drawImage(s.canvas, i * s.w, 0, s.w, s.h, (size - s.w * k) / 2, (size - s.h * k) / 2, s.w * k, s.h * k);
  return c.toDataURL();
}

const spriteGeo = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
const spriteVS = `
uniform float uFrame, uFrames, uFlip, uBias;
varying vec2 vUv;
void main(){
  vec2 u = uv; if (uFlip > 0.5) u.x = 1.0 - u.x;
  vUv = vec2((uFrame + u.x) / uFrames, u.y);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.z += uBias;
  gl_Position = projectionMatrix * mv;
}`;
const spriteFS = `
uniform sampler2D uMap; uniform float uFlash, uAlpha; uniform vec3 uTint, uFlashCol;
varying vec2 vUv;
void main(){
  vec4 c = texture2D(uMap, vUv);
  if (c.a < 0.04) discard;
  gl_FragColor = vec4(mix(c.rgb * uTint, uFlashCol, uFlash), c.a * uAlpha);
}`;
function makeSprite(name, height = SPRITE_H[name], frame = 0) {
  const s = sheets[name];
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: s.tex }, uFrame: { value: frame }, uFrames: { value: s.frames }, uFlip: { value: 0 }, uBias: { value: 1.1 },
      uFlash: { value: 0 }, uAlpha: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) }, uFlashCol: { value: new THREE.Color(1, 1, 1) },
    },
    vertexShader: spriteVS, fragmentShader: spriteFS, alphaToCoverage: true,
  });
  const m = new THREE.Mesh(spriteGeo, mat);
  m.userData.bw = height * s.w / s.h; m.userData.bh = height;
  m.scale.set(m.userData.bw, height, 1);
  m.frustumCulled = false;
  scene.add(m);
  return m;
}
function setSpriteScale(m, sx = 1, sy = 1) { m.scale.set(m.userData.bw * sx, m.userData.bh * sy, 1); }
// face the camera, then lean around the feet (the plane's origin is at the bottom centre)
function billboard(m, tilt = 0) { m.quaternion.copy(camera.quaternion); if (tilt) m.rotateZ(tilt); }
function killMesh(m) { if (!m) return; scene.remove(m); if (m.material && m.material.isShaderMaterial) m.material.dispose(); }

const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, color: 0x000000, opacity: 0.5 });
function makeShadow(size) { const m = new THREE.Mesh(shadowGeo, shadowMat); m.scale.set(size, 1, size * 0.8); m.position.y = 0.02; m.renderOrder = 1; scene.add(m); return m; }
function makeGlow(color, size, opacity = 1) {
  const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity }));
  m.scale.set(size, size, 1); scene.add(m); return m;
}
function killGlow(m) { if (!m) return; scene.remove(m); m.material.dispose(); }

// ---------- particles: additive glow points + debris cubes ----------
const MAXG = 1400;
const gPos = new Float32Array(MAXG * 3), gCol = new Float32Array(MAXG * 3), gSize = new Float32Array(MAXG);
const gData = Array.from({ length: MAXG }, () => ({ life: 0, max: 1, vx: 0, vy: 0, vz: 0, s: 0, drag: 0, grav: 0, r: 0, g: 0, b: 0 }));
const glowGeo = new THREE.BufferGeometry();
glowGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3).setUsage(THREE.DynamicDrawUsage));
glowGeo.setAttribute('color', new THREE.BufferAttribute(gCol, 3).setUsage(THREE.DynamicDrawUsage));
glowGeo.setAttribute('size', new THREE.BufferAttribute(gSize, 1).setUsage(THREE.DynamicDrawUsage));
const glowMat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 500 } },
  vertexShader: `attribute float size; attribute vec3 color; varying vec3 vC; uniform float uScale;
    void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / -mv.z; vC = color; gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard; float a = 1.0 - d * 2.0; gl_FragColor = vec4(vC * (a * a * 1.6), 1.0); }`,
  blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
});
const glowPoints = new THREE.Points(glowGeo, glowMat);
glowPoints.frustumCulled = false;
scene.add(glowPoints);
let gHead = 0;
const tmpC = new THREE.Color();
function spark(x, y, z, color, { vx = 0, vy = 0, vz = 0, s = 0.25, life = 0.5, drag = 3, grav = 0, spread = 0 } = {}) {
  const i = gHead; gHead = (gHead + 1) % MAXG;
  const d = gData[i];
  tmpC.set(color);
  Object.assign(d, { life, max: life, vx: vx + (Math.random() - 0.5) * spread, vy: vy + (Math.random() - 0.5) * spread, vz: vz + (Math.random() - 0.5) * spread, s, drag, grav, r: tmpC.r, g: tmpC.g, b: tmpC.b });
  gPos[i * 3] = x; gPos[i * 3 + 1] = y; gPos[i * 3 + 2] = z;
}
function burst(x, y, z, color, n, speed = 4, s = 0.3, life = 0.5) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, v = speed * (0.4 + Math.random() * 0.6);
    const q = Math.sqrt(1 - u * u);
    spark(x, y, z, color, { vx: Math.cos(a) * q * v, vy: Math.abs(u) * v * 0.8, vz: Math.sin(a) * q * v, s: s * (0.6 + Math.random() * 0.7), life: life * (0.6 + Math.random() * 0.8), drag: 4, grav: -4 });
  }
}
function updateGlows(dt) {
  for (let i = 0; i < MAXG; i++) {
    const d = gData[i];
    if (d.life <= 0) { gSize[i] = 0; continue; }
    d.life -= dt;
    const k = Math.exp(-d.drag * dt);
    d.vx *= k; d.vy = d.vy * k + d.grav * dt; d.vz *= k;
    gPos[i * 3] += d.vx * dt; gPos[i * 3 + 1] += d.vy * dt; gPos[i * 3 + 2] += d.vz * dt;
    const t = Math.max(0, d.life / d.max);
    gSize[i] = d.s * Math.min(1, t * 2.5);
    gCol[i * 3] = d.r; gCol[i * 3 + 1] = d.g; gCol[i * 3 + 2] = d.b;
  }
  glowGeo.attributes.position.needsUpdate = glowGeo.attributes.color.needsUpdate = glowGeo.attributes.size.needsUpdate = true;
}

const MAXD = 500;
const debrisMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial(), MAXD);
debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
debrisMesh.castShadow = true;
debrisMesh.frustumCulled = false;
scene.add(debrisMesh);
const debris = Array.from({ length: MAXD }, () => ({ life: 0 }));
let dHead = 0;
const dm = new THREE.Matrix4(), dq = new THREE.Quaternion(), de = new THREE.Euler(), dv = new THREE.Vector3(), ds = new THREE.Vector3();
for (let i = 0; i < MAXD; i++) { debrisMesh.setMatrixAt(i, dm.makeScale(0, 0, 0)); debrisMesh.setColorAt(i, tmpC.set(0xffffff)); }
function chunk(x, y, z, color, n = 6, speed = 5, size = 0.12) {
  for (let k = 0; k < n; k++) {
    const i = dHead; dHead = (dHead + 1) % MAXD;
    const a = Math.random() * Math.PI * 2, v = speed * (0.3 + Math.random() * 0.7);
    debris[i] = { life: 1.2 + Math.random() * 1.2, x, y, z, vx: Math.cos(a) * v, vy: 3 + Math.random() * 4, vz: Math.sin(a) * v, rx: Math.random() * 6, ry: Math.random() * 6, s: size * (0.6 + Math.random() * 0.8) };
    debrisMesh.setColorAt(i, tmpC.set(color).offsetHSL(0, 0, (Math.random() - 0.5) * 0.15));
  }
  debrisMesh.instanceColor.needsUpdate = true;
}
function updateDebris(dt) {
  for (let i = 0; i < MAXD; i++) {
    const d = debris[i];
    if (d.life <= 0) continue;
    d.life -= dt;
    d.vy -= 22 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
    if (d.y < d.s / 2) { d.y = d.s / 2; d.vy *= -0.35; d.vx *= 0.6; d.vz *= 0.6; d.rx *= 0.5; }
    if (solid(d.x, d.z, false)) { d.vx *= -0.5; d.vz *= -0.5; d.x += d.vx * dt * 2; d.z += d.vz * dt * 2; }
    d.rx *= 0.99;
    const sc = d.life < 0.4 ? d.s * d.life / 0.4 : d.s;
    de.set(d.rx * d.life * 3, d.ry * d.life * 3, 0);
    debrisMesh.setMatrixAt(i, dm.compose(dv.set(d.x, d.y, d.z), dq.setFromEuler(de), ds.set(sc, sc, sc)));
    if (d.life <= 0) debrisMesh.setMatrixAt(i, dm.makeScale(0, 0, 0));
  }
  debrisMesh.instanceMatrix.needsUpdate = true;
}

// ---------- floor decals (splats stay for the whole floor, like the reference) ----------
const MAXS = 450;
const splatMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ map: splatTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), MAXS);
splatMesh.renderOrder = -1; // always drawn before every other see-through layer, so floor splats never cover particles
splatMesh.frustumCulled = false;
scene.add(splatMesh);
let sHead = 0;
function clearSplats() { for (let i = 0; i < MAXS; i++) { splatMesh.setMatrixAt(i, dm.makeScale(0, 0, 0)); splatMesh.setColorAt(i, tmpC.set(0)); } splatMesh.instanceMatrix.needsUpdate = true; splatMesh.instanceColor.needsUpdate = true; }
function splat(x, z, color, size = 1, opacity = 1) {
  if (cellAt(x, z) !== FLOOR) return;
  const i = sHead; sHead = (sHead + 1) % MAXS;
  de.set(0, Math.random() * Math.PI * 2, 0);
  splatMesh.setMatrixAt(i, dm.compose(dv.set(x, 0.015 + i * 0.00002, z), dq.setFromEuler(de), ds.set(size, 1, size)));
  splatMesh.setColorAt(i, tmpC.set(color).multiplyScalar(opacity));
  splatMesh.instanceMatrix.needsUpdate = true; splatMesh.instanceColor.needsUpdate = true;
}

// ---------- world ----------
let map = new Uint8Array(MW * MH), wallH = new Float32Array(MW * MH);
let rooms = [], roomGrid = [], world = null, torchFlames = [], fogPlanes = [];
const coffinCells = new Set();
const cellAt = (x, z) => { const i = Math.floor(x), j = Math.floor(z); return i < 0 || j < 0 || i >= MW || j >= MH ? VOID : map[j * MW + i]; };
function solid(x, z, fly) { const c = cellAt(x, z); return c === VOID || c === WALL || c === BAR || (!fly && c === OBST); }
// ---------- biomes: every floor rolls one; each changes materials, surroundings, light, particles, props and hazards ----------
const BIOMES = {
  crypt: { names: ['THE DROWNED CRYPT', 'THE VIOLET CATACOMBS', 'HALLS OF THE DEAD'], floor: 0x9aa5ad, wall: 0x7fb0ae, cap: 0xa8d4cf, fog: 0x010103,
    hemi: [0x4a5c80, 0x0c0812], hemiI: 0.28, sun: 0x8fa6ff, sunI: 0.3, torch: 0xff7a2a, flame: 0xff9a40, mist: 0x9ab4d8, particle: 'dust', hazard: 'spikes',
    merlons: true, crypt: true, moss: 0.35, splats: [0x2a0505, 0x1c150c, 0x101a0c, 0x200814] },
  woods: { names: ['THE OVERGROWN RUINS', 'THE WHISPERING GROVE', 'THE THORNWOOD'], floor: 0x8a9a7a, wall: 0x6f8a5a, cap: 0x9fb88a, fog: 0x07100a,
    hemi: [0x6a8a5a, 0x0c1408], hemiI: 0.34, sun: 0xd8e8a0, sunI: 0.35, torch: 0xffb060, flame: 0xffc070, mist: 0x8ab088, particle: 'fireflies', hazard: 'vents',
    merlons: true, moss: 0.7, ground: { color: 0x1c2a14, y: -1.2 }, splats: [0x1a2a0c, 0x2a1a0a, 0x0c1a08] },
  caverns: { names: ['THE HOLLOW MOUNTAIN', 'THE DEEP MINES', 'THE CRYSTAL CAVES'], floor: 0x8a8178, wall: 0x7a7068, cap: 0x9a9088, fog: 0x050507,
    hemi: [0x6a6a8a, 0x100c0a], hemiI: 0.28, sun: 0xa8b8ff, sunI: 0.22, torch: 0xffa050, flame: 0xffb060, mist: 0x8a8a9a, particle: 'dust', hazard: 'spikes',
    rock: true, moss: 0.15, ground: { color: 0x121216, y: -6 }, splats: [0x1a1612, 0x24201a, 0x120e14] },
  forge: { names: ['THE EMBER FORGE', 'THE MOLTEN HALLS', 'THE ASHEN DEEP'], floor: 0x6e5c56, wall: 0x5a4a48, cap: 0x9a5a3a, fog: 0x140603,
    hemi: [0xff8a50, 0x1a0804], hemiI: 0.3, sun: 0xffa070, sunI: 0.25, torch: 0xff6a20, flame: 0xff7a2a, mist: 0x8a5040, particle: 'embers', hazard: 'lava',
    merlons: true, rock: true, moss: 0, ground: { color: 0xff5a10, y: -2.4, lava: true }, splats: [0x1a0a04, 0x2a0a04, 0x120604] },
  frozen: { names: ['THE FROZEN DEEP', 'THE RIME HALLS', 'THE GLACIER TOMB'], floor: 0xb8c8d8, wall: 0x8aa8c0, cap: 0xeaf4ff, fog: 0x080e16,
    hemi: [0x9ab8e0, 0x0a1018], hemiI: 0.34, sun: 0xcfe0ff, sunI: 0.35, torch: 0xffa050, flame: 0xffb060, mist: 0xcfe0f0, particle: 'snow', hazard: 'spikes',
    merlons: true, moss: 0, ground: { color: 0xc8d8e8, y: -1.0 }, splats: [0x5a7a9a, 0x3a5a7a, 0x8aa0b8] },
  swamp: { names: ['THE SUNKEN FEN', 'THE ROTTING MIRE', 'THE FUNGAL MARSH'], floor: 0x7a8070, wall: 0x5a6a5a, cap: 0x7a8a6a, fog: 0x07100b,
    hemi: [0x6a8a7a, 0x0a120c], hemiI: 0.3, sun: 0xb0e0c0, sunI: 0.28, torch: 0xffb060, flame: 0xc0ff70, mist: 0x7aa08a, particle: 'spores', hazard: 'vents',
    merlons: false, moss: 0.6, ground: { color: 0x14221a, y: -0.6, water: true }, splats: [0x1a2a14, 0x101a0c, 0x22142a] },
};
const BIOME_KEYS = Object.keys(BIOMES);
const WIN_FLOOR = 50; // clear this floor's boss to win the run
const DUNGEON_INFO = {
  crypt: ['The Crypt', 'Bones, coffins and cobwebs in the dark. Spike traps.'],
  woods: ['Overgrown Ruins', 'Ruins swallowed by a forest. Spore vents, fireflies.'],
  caverns: ['Hollow Mountain', 'A chasm of stalagmites and glowing crystals. Spike traps.'],
  forge: ['Ember Forge', 'A fortress over a lava sea. Lava cracks, embers.'],
  frozen: ['Frozen Deep', 'Ice halls in a snowfield. Spike traps, falling snow.'],
  swamp: ['Sunken Fen', 'A rotting marsh of giant mushrooms. Gas vents, spores.'],
};
function pickBiome(n) {
  if (params.get('biome') && BIOMES[params.get('biome')]) return params.get('biome');
  return BIOMES[G.runDungeon] ? G.runDungeon : 'crypt'; // the whole run stays in the dungeon it rolled
}
// a floor's palette: the biome's colours with a little random drift so no two floors look the same
function biomePalette(b) {
  const j = (hex) => tmpC.set(hex).offsetHSL((rand() - 0.5) * 0.04, (rand() - 0.5) * 0.12, (rand() - 0.5) * 0.06).getHex();
  return { floor: j(b.floor), wall: j(b.wall), cap: j(b.cap), name: pick(b.names) };
}
function applyBiomeLight(b) {
  scene.background.set(b.fog); scene.fog.color.set(b.fog);
  hemi.color.set(b.hemi[0]); hemi.groundColor.set(b.hemi[1]); hemi.intensity = b.hemiI;
  sun.color.set(b.sun); sun.intensity = b.sunI;
  for (const l of torchLights) l.color.set(b.torch);
  fogMat.color.set(b.mist);
}
const PALETTES = [
  { floor: 0x9aa5ad, wall: 0x7fb0ae, cap: 0xa8d4cf, name: 'THE DROWNED HALLS' },
  { floor: 0xa59cab, wall: 0x8c8fbf, cap: 0xb8b6e6, name: 'THE VIOLET CRYPT' },
  { floor: 0xa0a693, wall: 0x7f9f86, cap: 0xaccdb0, name: 'THE MOSS VAULTS' },
  { floor: 0xb0a194, wall: 0xb08c7a, cap: 0xd9b7a2, name: 'THE EMBER DEEP' },
];

// combat room interiors on the 11 x 13 floor (x, z), before mirroring. Single, low pillars only, kept 2 tiles off the
// walls and apart from each other, so nothing forms a pocket that traps monsters or coins.
const ROOM_LAYOUTS = [
  [[2, 2], [8, 2], [2, 10], [8, 10]], // corner pillars
  [[3, 4], [7, 4], [3, 8], [7, 8]], // inner pillars
  [[3, 3], [7, 9]], // two pillars on a diagonal
  [], // open hall
  [[5, 6]], // one centre pillar
  [[3, 3], [7, 3], [5, 6], [3, 9], [7, 9]], // five
  [[2, 2], [5, 4], [8, 2], [2, 10], [5, 8], [8, 10]], // staggered
  [[3, 6], [7, 6]], // a pair across the middle
  'scatter', // a few random pillars
];
let layoutBag = [];
function genFloor(n) {
  map.fill(VOID); wallH.fill(0); coffinCells.clear(); layoutBag = [];
  rooms = []; roomGrid = new Array(GW * GH).fill(null);
  const want = Math.min(6 + n, 13);
  const add = (gx, gy, parent) => {
    const r = { gx, gy, x0: gx * SX, z0: gy * SZ, w: RW, h: RH, links: [], type: 'combat', cleared: false, visited: false, seen: false, active: false, depth: 0 };
    r.cx = r.x0 + 1 + r.w / 2; r.cz = r.z0 + 1 + r.h / 2;
    rooms.push(r); roomGrid[gy * GW + gx] = r;
    if (parent) { r.links.push(parent); parent.links.push(r); r.depth = parent.depth + 1; }
    return r;
  };
  const start = add(3, 3, null);
  let guard = 0;
  while (rooms.length < want && guard++ < 2000) {
    const p = pick(rooms);
    const [dx, dy] = pick([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    const gx = p.gx + dx, gy = p.gy + dy;
    if (gx < 0 || gy < 0 || gx >= GW || gy >= GH || roomGrid[gy * GW + gx]) continue;
    let nb = 0;
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (roomGrid[(gy + ay) * GW + gx + ax] && gy + ay >= 0 && gy + ay < GH && gx + ax >= 0 && gx + ax < GW) nb++;
    if (nb > 1 && rand() < 0.8) continue;
    add(gx, gy, p);
  }
  start.type = 'start'; start.cleared = true;
  const exit = rooms.reduce((a, b) => (b.depth > a.depth ? b : a));
  exit.type = n % 3 === 0 || n === WIN_FLOOR ? 'boss' : 'exit';
  const dead = shuffle(rooms.filter((r) => r.links.length === 1 && r !== start && r !== exit));
  if (dead[0]) dead[0].type = 'treasure';
  if (dead[1]) dead[1].type = 'shop';
  else { const c = rooms.filter((r) => r.type === 'combat'); if (c.length > 3) pick(c).type = 'shop'; }
  const extra = shuffle(rooms.filter((r) => r.type === 'combat' && r.depth > 1));
  if (n >= 2 && extra[0] && rand() < 0.7) extra[0].type = 'shrine';
  if (n >= 2 && extra[1] && rand() < 0.6) extra[1].type = 'challenge';
  const plain = shuffle(rooms.filter((r) => r.type === 'combat'));
  if (n >= 2 && plain[0] && rand() < 0.6) plain[0].variant = 'swarm';
  if (n >= 2 && plain[1] && rand() < 0.55) plain[1].variant = 'dark';
  if (n >= 3 && plain[2] && rand() < 0.6) plain[2].variant = 'traps';
  for (const r of rooms) if (r.type === 'treasure' || r.type === 'shop' || r.type === 'shrine') r.cleared = true;
  // room sizes vary: small side rooms, combat rooms from snug to wide, a big boss arena. Sizes stay odd so every room is
  // centred in its grid slot and the corridors (which run through the slot centre) still meet the doors.
  for (const r of rooms) {
    const inner = r.gx > 0 && r.gy > 0 && r.gx < GW - 1 && r.gy < GH - 1; // rooms on the grid edge never grow past the slot
    if (r.type === 'boss') { r.w = inner ? 13 : RW; r.h = inner ? 15 : RH; }
    else if (r.type === 'treasure' || r.type === 'shop' || r.type === 'shrine') { r.w = 9; r.h = 11; }
    else if (r.type !== 'start') { r.w = pick(inner ? [9, 11, 11, 13] : [9, 11]); r.h = pick(inner ? [11, 13, 13, 15] : [11, 13]); }
    r.x0 = r.gx * SX + (RW - r.w) / 2; r.z0 = r.gy * SZ + (RH - r.h) / 2;
    r.cx = r.x0 + 1 + r.w / 2; r.cz = r.z0 + 1 + r.h / 2;
  }

  const set = (i, j, v, h = 0) => { if (i < 0 || j < 0 || i >= MW || j >= MH) return; map[j * MW + i] = v; wallH[j * MW + i] = h; };
  const setWallIfVoid = (i, j, h) => { if (map[j * MW + i] === VOID) set(i, j, WALL, h); };
  for (const r of rooms) {
    for (let j = 0; j < r.h + 2; j++) for (let i = 0; i < r.w + 2; i++) {
      const edge = i === 0 || j === 0 || i === r.w + 1 || j === r.h + 1;
      const corner = (i === 0 || i === r.w + 1) && (j === 0 || j === r.h + 1);
      set(r.x0 + i, r.z0 + j, edge ? WALL : FLOOR, corner ? (j === 0 ? TALL + 0.5 : LOW + 0.35) : j === r.h + 1 ? LOW : TALL);
    }
    r.doors = [];
    if (r.type === 'combat' || r.type === 'exit' || r.type === 'challenge') {
      // each room on a floor gets a different layout (shuffled bag), randomly mirrored; door lanes always stay open
      if (!layoutBag.length) layoutBag = shuffle(ROOM_LAYOUTS.map((_, k) => k));
      const L = ROOM_LAYOUTS[layoutBag.pop()], fx = rand() < 0.5, fz = rand() < 0.5;
      const cells = L === 'scatter' ? Array.from({ length: ri(3, 5) }, () => [ri(2, r.w - 3), ri(2, r.h - 3)]) : L;
      const placed = [];
      for (let [i, j] of cells) {
        if (L !== 'scatter') { // layouts are drawn for the standard 11 x 13 room: mirror there, then centre in this room
          if (fx) i = RW - 1 - i; if (fz) j = RH - 1 - j;
          i += (r.w - RW) / 2; j += (r.h - RH) / 2;
          if (i < 0 || j < 0 || i >= r.w || j >= r.h) continue;
        }
        const midJ = Math.floor(r.h / 2), midI = Math.floor(r.w / 2);
        if ((Math.abs(j - midJ) <= 1 && (i <= 1 || i >= r.w - 2)) || (Math.abs(i - midI) <= 1 && (j <= 1 || j >= r.h - 2))) continue;
        if (i < 2 || j < 2 || i > r.w - 3 || j > r.h - 3 || placed.some(([a, b]) => Math.abs(a - i) <= 1 && Math.abs(b - j) <= 1)) continue; // no pockets
        if ((r.type === 'exit' || r.type === 'challenge') && Math.abs(i - midI) <= 1 && Math.abs(j - midJ) <= 1) continue; // stairs / golden chest appear in the centre
        placed.push([i, j]);
        set(r.x0 + 1 + i, r.z0 + 1 + j, OBST, 0.8); // low enough that monsters behind stay visible
      }
      r.coffins = [];
      if (G.biome.crypt && rand() < 0.55) for (const side of [0, r.w - 1]) {
        if (rand() < 0.4) continue;
        const j = pick([1, 2, r.h - 4, r.h - 3]);
        const ci = r.x0 + 1 + side, cj = r.z0 + 1 + j;
        if (map[cj * MW + ci] !== FLOOR || map[(cj + 1) * MW + ci] !== FLOOR) continue;
        set(ci, cj, OBST, 0.4); set(ci, cj + 1, OBST, 0.4);
        coffinCells.add(cj * MW + ci); coffinCells.add((cj + 1) * MW + ci);
        r.coffins.push([ci, cj]);
      }
    }
  }
  const corr = [];
  for (const r of rooms) for (const o of r.links) {
    if (o.gx === r.gx + 1) corr.push(['h', r, o]);
    if (o.gy === r.gy + 1) corr.push(['v', r, o]);
  }
  for (const [dir, a, b] of corr) {
    if (dir === 'h') {
      const zc = a.z0 + 1 + Math.floor(a.h / 2);
      for (let i = a.x0 + a.w + 1; i <= b.x0; i++) {
        for (let k = -1; k <= 1; k++) set(i, zc + k, FLOOR);
        setWallIfVoid(i, zc - 2, 1.0); setWallIfVoid(i, zc + 2, LOW);
      }
      a.doors.push({ cells: [-1, 0, 1].map((k) => [a.x0 + a.w + 1, zc + k]), axis: 'x' });
      b.doors.push({ cells: [-1, 0, 1].map((k) => [b.x0, zc + k]), axis: 'x' });
    } else {
      const xc = a.x0 + 1 + Math.floor(a.w / 2);
      for (let j = a.z0 + a.h + 1; j <= b.z0; j++) {
        for (let k = -1; k <= 1; k++) set(xc + k, j, FLOOR);
        setWallIfVoid(xc - 2, j, 0.9); setWallIfVoid(xc + 2, j, 0.9);
      }
      a.doors.push({ cells: [-1, 0, 1].map((k) => [xc + k, a.z0 + a.h + 1]), axis: 'z' });
      b.doors.push({ cells: [-1, 0, 1].map((k) => [xc + k, b.z0]), axis: 'z' });
    }
  }
  return start;
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const floorGeo = new THREE.BoxGeometry(1, 0.3, 1).translate(0, -0.15, 0);
function buildWorld(pal) {
  if (world) { scene.remove(world); world.traverse((o) => { if (o.isInstancedMesh) o.dispose(); if (o.material && o.userData.own) o.material.dispose(); }); }
  world = new THREE.Group(); scene.add(world);
  torchFlames.forEach(killGlow); torchFlames = [];
  const floors = [], floors2 = [], walls = [], obst = [];
  for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) {
    const c = map[j * MW + i];
    if (c === FLOOR || c === OBST) (hash(i, j, 9) < 0.12 ? floors2 : floors).push([i, j]);
    if (c === WALL) walls.push([i, j]);
    if (c === OBST && !coffinCells.has(j * MW + i)) obst.push([i, j]);
  }
  const mk = (geo, mat, list, place, cast = true) => {
    const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    im.count = list.length; im.castShadow = cast; im.receiveShadow = true; mat.userData = {};
    im.userData.own = true;
    list.forEach((it, k) => place(im, k, it));
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    world.add(im); return im;
  };
  const fc = new THREE.Color(pal.floor), wc = new THREE.Color(pal.wall), cc = new THREE.Color(pal.cap);
  const B = G.biome || BIOMES.crypt, moss = new THREE.Color(B.key === 'frozen' ? 0xe8f4ff : 0x4f6a3a);
  const nearWall = (i, j) => map[j * MW + i - 1] === WALL || map[j * MW + i + 1] === WALL || map[(j - 1) * MW + i] === WALL || map[(j + 1) * MW + i] === WALL;
  const placeFloor = (im, k, [i, j]) => {
    const sunk = hash(i, j, 7) < 0.07; // cracked, sunken tiles
    im.setMatrixAt(k, dm.makeTranslation(i + 0.5, sunk ? -0.06 : (hash(i, j, 3) - 0.5) * 0.03, j + 0.5));
    tmpC.copy(fc).multiplyScalar((0.72 + hash(i, j, 4) * 0.26) * (sunk ? 0.55 : 1));
    if (B.moss && (nearWall(i, j) || hash(i, j, 11) < B.moss * 0.3) && hash(i, j, 8) < 0.45 + B.moss * 0.3) tmpC.lerp(moss, (0.35 + hash(i, j, 9) * 0.25) * Math.min(1, B.moss + 0.4));
    im.setColorAt(k, tmpC);
  };
  mk(floorGeo, new THREE.MeshLambertMaterial({ map: floorTex }), floors, placeFloor, false);
  mk(floorGeo, new THREE.MeshLambertMaterial({ map: floorTex2 }), floors2, placeFloor, false);
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex });
  mk(boxGeo, wallMat, walls, (im, k, [i, j]) => {
    let h = wallH[j * MW + i];
    if (B.rock) { h *= 0.8 + hash(i, j, 12) * 0.7; wallH[j * MW + i] = h; } // jagged rock instead of laid stone
    de.set(0, B.rock ? (hash(i, j, 13) - 0.5) * 0.5 : 0, 0);
    im.setMatrixAt(k, dm.compose(dv.set(i + 0.5, 0, j + 0.5), dq.setFromEuler(de), ds.set(B.rock ? 1.08 : 1, h, B.rock ? 1.08 : 1)));
    im.setColorAt(k, tmpC.copy(wc).multiplyScalar((0.7 + hash(i, j, 5) * 0.3) * (hash(i, j, 6) < 0.12 ? 0.6 : 1)).lerp(moss, hash(i, j, 10) < 0.2 ? 0.3 : 0));
  });
  mk(boxGeo, new THREE.MeshLambertMaterial({ map: plinthTex }), walls, (im, k, [i, j]) => {
    im.setMatrixAt(k, dm.compose(dv.set(i + 0.5, -8, j + 0.5), dq.identity(), ds.set(1, 8, 1)));
    im.setColorAt(k, tmpC.copy(wc).multiplyScalar(0.6));
  }, false);
  const capMat = new THREE.MeshLambertMaterial({ map: floorTex });
  mk(boxGeo, capMat, walls, (im, k, [i, j]) => {
    const h = wallH[j * MW + i];
    im.setMatrixAt(k, dm.compose(dv.set(i + 0.5, h, j + 0.5), dq.identity(), ds.set(1.04, 0.14, 1.04)));
    im.setColorAt(k, cc);
  });
  const merl = B.merlons && !B.rock ? walls.filter(([i, j]) => wallH[j * MW + i] >= 1 && (i + j) % 2 === 0) : [];
  mk(boxGeo, wallMat, merl, (im, k, [i, j]) => {
    const h = wallH[j * MW + i];
    im.setMatrixAt(k, dm.compose(dv.set(i + 0.5, h + 0.14, j + 0.5), dq.identity(), ds.set(0.62, 0.36, 0.62)));
    im.setColorAt(k, tmpC.copy(wc).multiplyScalar(1.05));
  });
  mk(boxGeo, wallMat, obst, (im, k, [i, j]) => {
    im.setMatrixAt(k, dm.compose(dv.set(i + 0.5, 0, j + 0.5), dq.identity(), ds.set(0.8, PILLAR_H, 0.8)));
    im.setColorAt(k, tmpC.copy(wc).multiplyScalar(0.95));
  });
  mk(boxGeo, capMat, obst, (im, k, [i, j]) => {
    im.setMatrixAt(k, dm.compose(dv.set(i + 0.5, PILLAR_H, j + 0.5), dq.identity(), ds.set(0.98, 0.18, 0.98)));
    im.setColorAt(k, cc);
  });
  // ornate rune plates in the special rooms (the reference has these under every altar)
  const plates = rooms.filter((r) => r.type !== 'combat' && r.type !== 'challenge');
  const plateMat = new THREE.MeshLambertMaterial({ map: runeTex, color: pal.cap });
  for (const r of plates) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(3, 0.06, 3), plateMat);
    m.position.set(r.cx, 0.0, r.cz); m.receiveShadow = true; world.add(m);
  }
  // torches on the north wall of every room
  for (const r of rooms) {
    r.torches = []; r.flames = [];
    const spots = [[r.x0 + 3.5, r.z0 + 1.08, 0, 1], [r.x0 + r.w - 1.5, r.z0 + 1.08, 0, 1],
      [r.x0 + 1.08, r.z0 + 4.5, 1, 0], [r.x0 + 1.08, r.z0 + r.h - 2.5, 1, 0],
      [r.x0 + r.w + 0.92, r.z0 + 4.5, -1, 0], [r.x0 + r.w + 0.92, r.z0 + r.h - 2.5, -1, 0]];
    spots.forEach(([x, z, nx, nz], k) => {
      const p = new THREE.Vector3(x, 1.05, z);
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.34, 0.18), wallMat); b.position.set(x - nx * 0.05, 0.9, z - nz * 0.05); world.add(b);
      const f = makeGlow(B.flame, 0.9, 0.9); f.position.set(x + nx * 0.06, 1.17, z + nz * 0.06);
      const core = makeGlow(0xfff0a0, 0.35, 1); core.position.copy(f.position); f.userData.core = core;
      torchFlames.push(f, core); r.flames.push(f);
      if (k < 2) r.torches.push(p);
    });
  }
  dressRooms(wallMat);
  buildEnvironment(B);
}

// ---------- what surrounds the rooms (and grows inside them), per biome ----------
const envGeo = { cone: new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0), cyl: new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0),
  ball: new THREE.IcosahedronGeometry(1, 0), gem: new THREE.OctahedronGeometry(1, 0), cap: new THREE.SphereGeometry(1, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2) };
function buildEnvironment(B) {
  G.lavaTex = null;
  // distance (in cells) from the nearest walkable/wall cell, so props hug the rooms and leave the corridors clear
  const dist = new Uint8Array(MW * MH).fill(255), q = [];
  for (let k = 0; k < MW * MH; k++) if (map[k] !== VOID) { dist[k] = 0; q.push(k); }
  for (let h = 0; h < q.length; h++) {
    const k = q[h], i = k % MW, j = (k / MW) | 0, d = dist[k];
    if (d >= 9) continue;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ni = i + a, nj = j + b; if (ni < 0 || nj < 0 || ni >= MW || nj >= MH) continue; const nk = nj * MW + ni; if (dist[nk] > d + 1) { dist[nk] = d + 1; q.push(nk); } }
  }
  const lists = new Map();
  const put = (key, geo, mat, x, y, z, sx, sy, sz, color, yaw = 0, tilt = 0) => {
    if (!lists.has(key)) lists.set(key, { geo, mat, items: [] });
    lists.get(key).items.push([x, y, z, sx, sy, sz, color, yaw, tilt]);
  };
  const lam = (c, e = 0) => new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: e });
  const M = { trunk: lam(), leaf: lam(), rock: lam(), glow: new THREE.MeshBasicMaterial({ color: 0xffffff }), ice: new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }) };
  const out = (lo, hi, p) => { const r = []; for (let j = 0; j < MH; j++) for (let i = 0; i < MW; i++) { const d = dist[j * MW + i]; if (d >= lo && d <= hi && hash(i, j, 21) < p) r.push([i + 0.5 + (hash(i, j, 22) - 0.5) * 0.8, j + 0.5 + (hash(i, j, 23) - 0.5) * 0.8, i, j]); } return r; };
  const vary = (hex, k) => tmpC.set(hex).multiplyScalar(0.8 + k * 0.4).getHex();
  if (B.ground) {
    const g = B.ground;
    let mat;
    if (g.lava) { const t = lavaTex.clone(); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(MW / 3, MH / 3); t.needsUpdate = true; G.lavaTex = t; mat = new THREE.MeshBasicMaterial({ map: t, color: 0xffffff }); }
    else if (g.water) mat = new THREE.MeshPhongMaterial({ color: g.color, shininess: 90, specular: 0x4a6a5a, transparent: true, opacity: 0.92 });
    else mat = new THREE.MeshLambertMaterial({ color: g.color });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(MW + 40, MH + 40).rotateX(-Math.PI / 2), mat);
    plane.position.set(MW / 2, g.y, MH / 2); plane.receiveShadow = true; plane.userData.own = true; world.add(plane);
  }
  const key = Object.keys(BIOMES).find((k) => BIOMES[k] === B);
  if (key === 'woods') {
    for (const [x, z, i, j] of out(2, 8, 0.32)) { // trees
      const h = 1.4 + hash(i, j, 24) * 1.6, y0 = B.ground.y, gc = vary(pick([0x2f5a2a, 0x3a6a2a, 0x2a4a22, 0x4a6a2a]), hash(i, j, 25));
      put('trunk', envGeo.cyl, M.trunk, x, y0, z, 0.14, h * 0.6, 0.14, 0x4a3020);
      for (let t = 0; t < 3; t++) put('leaf', envGeo.cone, M.leaf, x, y0 + h * 0.45 + t * h * 0.32, z, 1.1 - t * 0.28, h * 0.55, 1.1 - t * 0.28, gc, hash(i, j, 26) * 6);
    }
    for (const [x, z, i, j] of out(1, 3, 0.18)) put('bush', envGeo.ball, M.leaf, x, B.ground.y + 0.3, z, 0.6, 0.45, 0.6, vary(0x3a5a2a, hash(i, j, 27)));
  }
  if (key === 'caverns') {
    for (const [x, z, i, j] of out(1, 9, 0.38)) { // stalagmites rising out of the chasm
      const h = 4 + hash(i, j, 24) * 6.5, r = 0.4 + hash(i, j, 25) * 0.6;
      put('rock', envGeo.cone, M.rock, x, B.ground.y, z, r, h, r, vary(0x4a4440, hash(i, j, 26)), hash(i, j, 27) * 6);
      if (hash(i, j, 28) < 0.25) { const c = pick([0x7ad8ff, 0xc07aff, 0x7affc8]); put('gem', envGeo.gem, M.glow, x, B.ground.y + h + 0.1, z, 0.22, 0.45, 0.22, c, hash(i, j, 29) * 6); const g = makeGlow(c, 1.6, 0.5); g.position.set(x, B.ground.y + h + 0.2, z); torchFlames.push(g); }
    }
  }
  if (key === 'forge') {
    for (const [x, z, i, j] of out(1, 7, 0.22)) { const h = 2 + hash(i, j, 24) * 3.5; put('rock', boxGeo, M.rock, x, B.ground.y - 0.5, z, 0.6 + hash(i, j, 25) * 0.6, h, 0.6 + hash(i, j, 26) * 0.6, vary(0x2a2424, hash(i, j, 27)), hash(i, j, 28)); }
    const lg = makeGlow(0xff5a10, 30, 0.08); lg.position.set(MW / 2, B.ground.y + 0.5, MH / 2); torchFlames.push(lg);
  }
  if (key === 'frozen') {
    for (const [x, z, i, j] of out(1, 5, 0.26)) { const h = 0.8 + hash(i, j, 24) * 2; put('ice', envGeo.cone, M.ice, x, B.ground.y, z, 0.25 + hash(i, j, 25) * 0.3, h, 0.25 + hash(i, j, 25) * 0.3, vary(0x9fd0ff, hash(i, j, 26)), 0, (hash(i, j, 27) - 0.5) * 0.4); }
    for (const [x, z, i, j] of out(4, 9, 0.22)) { const h = 1.8 + hash(i, j, 24) * 1.4; for (let t = 0; t < 3; t++) put('leaf', envGeo.cone, M.leaf, x, B.ground.y + t * h * 0.3, z, 0.95 - t * 0.25, h * 0.5, 0.95 - t * 0.25, t === 2 ? 0xf2f8ff : vary(0x2a4a3a, hash(i, j, 25))); }
  }
  if (key === 'swamp') {
    for (const [x, z, i, j] of out(2, 8, 0.16)) { // giant glowing mushrooms
      const h = 1.2 + hash(i, j, 24) * 2.2, r = 0.7 + hash(i, j, 25) * 0.8, c = pick([0x5affd0, 0xc07aff, 0x7aff7a]);
      put('trunk', envGeo.cyl, M.trunk, x, B.ground.y, z, 0.16, h, 0.16, 0xd8d0b8);
      put('capm', envGeo.cap, lam(0xffffff, 0x000000), x, B.ground.y + h, z, r, r * 0.55, r, vary(c, 0.5));
      if (hash(i, j, 26) < 0.5) { const g = makeGlow(c, r * 2.2, 0.35); g.position.set(x, B.ground.y + h + 0.2, z); torchFlames.push(g); }
    }
    for (const [x, z, i, j] of out(1, 3, 0.25)) put('reed', envGeo.cone, M.leaf, x, B.ground.y, z, 0.05, 0.9 + hash(i, j, 27) * 0.6, 0.05, 0x5a7a3a, 0, (hash(i, j, 28) - 0.5) * 0.3);
  }
  // little things on the floors inside the rooms
  for (const r of rooms) {
    for (let k = 0; k < ri(4, 9); k++) {
      const i = ri(0, r.w - 1), j = ri(0, r.h - 1), ci = r.x0 + 1 + i, cj = r.z0 + 1 + j;
      if (map[cj * MW + ci] !== FLOOR || (Math.abs(i - 5) <= 1 && Math.abs(j - 6) <= 1)) continue;
      const x = ci + rand(), z = cj + rand();
      if (key === 'woods') { for (let t = 0; t < 4; t++) put('grass', envGeo.cone, M.leaf, x + rr(-0.15, 0.15), 0, z + rr(-0.15, 0.15), 0.04, rr(0.2, 0.4), 0.04, vary(0x5a8a3a, rand()), 0, rr(-0.3, 0.3)); }
      else if (key === 'swamp') { put('capm', envGeo.cap, lam(0xffffff, 0x000000), x, 0.12, z, 0.16, 0.1, 0.16, pick([0xc07aff, 0x7affc0])); put('trunk', envGeo.cyl, M.trunk, x, 0, z, 0.03, 0.13, 0.03, 0xd8d0b8); }
      else if (key === 'caverns') { const c = pick([0x7ad8ff, 0xc07aff]); put('gem', envGeo.gem, M.glow, x, 0.15, z, 0.08, 0.2, 0.08, c, rand() * 6, rr(-0.3, 0.3)); }
      else if (key === 'frozen') put('snowp', envGeo.ball, M.rock, x, 0, z, rr(0.25, 0.45), 0.12, rr(0.25, 0.45), 0xf2f8ff);
      else if (key === 'forge') put('coal', envGeo.gem, M.glow, x, 0.04, z, 0.08, 0.05, 0.08, pick([0xff5a10, 0xff8a20]), rand() * 6);
    }
  }
  for (const L of lists.values()) {
    const im = new THREE.InstancedMesh(L.geo, L.mat, L.items.length);
    L.items.forEach(([x, y, z, sx, sy, sz, color, yaw, tilt], k) => { de.set(tilt || 0, yaw || 0, 0); im.setMatrixAt(k, dm.compose(dv.set(x, y, z), dq.setFromEuler(de), ds.set(sx, sy, sz))); im.setColorAt(k, tmpC.set(color)); });
    im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
    im.castShadow = L.mat !== M.glow; im.receiveShadow = true; im.userData.own = true; world.add(im);
  }
}
const boneMat = new THREE.MeshLambertMaterial({ color: 0xd9cfb6, emissive: 0x2a251c });
const ironMat = new THREE.MeshLambertMaterial({ color: 0x2c2c36 });
const rubbleMat = new THREE.MeshLambertMaterial({ color: 0x6a6e78 });
const waxMat = new THREE.MeshLambertMaterial({ color: 0xe9dcc0, emissive: 0x3a2a10 });
const woodMat = new THREE.MeshLambertMaterial({ color: 0x3a2418 });
const lidMat = new THREE.MeshLambertMaterial({ color: 0x4e3222 });
const webMat = new THREE.MeshBasicMaterial({ map: webTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.8 });
const fogMat = new THREE.MeshBasicMaterial({ map: fogTex, transparent: true, depthWrite: false, color: 0x9ab4d8, opacity: 0.4 });
const shroudMat = new THREE.MeshBasicMaterial({ map: fogTex, color: 0x0a0c14, transparent: true, opacity: 0.6, depthWrite: false });
function dressRooms(wallMat) {
  const bones = [], irons = [], wax = [], wood = [], lids = [], rubble = [];
  const box = (list, x, y, z, sx, sy, sz, yaw = 0, roll = 0) => list.push([x, y, z, sx, sy, sz, yaw, roll]);
  fogPlanes = [];
  for (const r of rooms) {
    const lane = (i, j) => Math.abs(i - Math.floor(r.w / 2)) <= 1 || Math.abs(j - Math.floor(r.h / 2)) <= 1;
    const free = (i, j) => map[(r.z0 + 1 + j) * MW + r.x0 + 1 + i] === FLOOR && !lane(i, j);
    // bone piles and skulls along the walls (fewer outside the crypt)
    const crypt = !!(G.biome || BIOMES.crypt).crypt;
    const piles = crypt ? (r.type === 'start' ? 3 : ri(5, 9)) : ri(0, 2);
    for (let n = 0, tries = 0; n < piles && tries < 40; tries++) {
      const edge = ri(0, 3), i = edge === 0 ? 0 : edge === 1 ? r.w - 1 : ri(0, r.w - 1), j = edge === 2 ? 0 : edge === 3 ? r.h - 1 : ri(0, r.h - 1);
      if (!free(i, j)) continue;
      n++;
      const cx = r.x0 + 1.5 + i, cz = r.z0 + 1.5 + j;
      for (let b = 0; b < ri(3, 6); b++) box(bones, cx + rr(-0.35, 0.35), 0.03 + b * 0.015, cz + rr(-0.35, 0.35), rr(0.32, 0.5), 0.08, 0.09, rr(0, 3.14), rr(-0.2, 0.2));
      if (rand() < 0.6) {
        const sx = cx + rr(-0.15, 0.15), sz = cz + rr(-0.15, 0.15);
        box(bones, sx, 0.02, sz, 0.28, 0.24, 0.26);
        box(irons, sx - 0.07, 0.13, sz + 0.13, 0.08, 0.07, 0.02); box(irons, sx + 0.07, 0.13, sz + 0.13, 0.08, 0.07, 0.02);
      }
    }
    // rubble and loose bones scattered over the floor
    for (let k = 0; k < ri(10, 18); k++) {
      const i = ri(0, r.w - 1), j = ri(0, r.h - 1);
      if (map[(r.z0 + 1 + j) * MW + r.x0 + 1 + i] !== FLOOR) continue;
      const x = r.x0 + 1.5 + i + rr(-0.4, 0.4), z = r.z0 + 1.5 + j + rr(-0.4, 0.4);
      if (rand() < 0.7) box(rubble, x, 0, z, rr(0.08, 0.2), rr(0.05, 0.14), rr(0.08, 0.2), rr(0, 3));
      else box(bones, x, 0.02, z, rr(0.25, 0.4), 0.07, 0.08, rr(0, 3));
    }
    // skulls on some pillar tops
    for (let j = 1; j <= r.h; j++) for (let i = 1; i <= r.w; i++) {
      const c = (r.z0 + j) * MW + r.x0 + i;
      if (!crypt || map[c] !== OBST || coffinCells.has(c) || rand() > 0.35) continue;
      const x = r.x0 + i + 0.5, z = r.z0 + j + 0.5;
      box(bones, x, PILLAR_H + 0.18, z, 0.3, 0.26, 0.28, rr(-0.5, 0.5));
      box(irons, x - 0.07, PILLAR_H + 0.3, z + 0.14, 0.08, 0.07, 0.02); box(irons, x + 0.07, PILLAR_H + 0.3, z + 0.14, 0.08, 0.07, 0.02);
      const c2 = makeGlow(0xffb050, 0.3, 0.8); c2.position.set(x + 0.25, PILLAR_H + 0.37, z - 0.1); torchFlames.push(c2);
      box(wax, x + 0.25, PILLAR_H + 0.18, z - 0.1, 0.07, 0.16, 0.07);
    }
    // chains hanging on the north wall
    for (const cxw of shuffle([2.5, 5.5, 7.5, 9.5]).slice(0, crypt ? ri(1, 2) : 0)) {
      const x = r.x0 + cxw, len = ri(4, 8);
      for (let k = 0; k < len; k++) box(irons, x, 1.42 - k * 0.14, r.z0 + 1.08, 0.11, 0.13, 0.05, k % 2 ? Math.PI / 2 : 0);
      box(irons, x, 1.42 - len * 0.14, r.z0 + 1.1, 0.2, 0.2, 0.06); // shackle
    }
    // candle clusters in a corner or two
    for (const [i, j] of shuffle([[0, 0], [r.w - 1, 0], [0, r.h - 1], [r.w - 1, r.h - 1]]).slice(0, crypt ? ri(1, 2) : 0)) {
      if (!free(i, j)) continue;
      const cx = r.x0 + 1.5 + i + (i ? 0.2 : -0.2), cz = r.z0 + 1.5 + j + (j ? 0.2 : -0.2);
      for (let k = 0; k < ri(3, 5); k++) {
        const x = cx + rr(-0.25, 0.25), z = cz + rr(-0.25, 0.25), h = rr(0.1, 0.32);
        box(wax, x, 0, z, 0.07, h, 0.07);
        const fl = makeGlow(0xffb050, 0.3, 0.85); fl.position.set(x, h + 0.05, z); torchFlames.push(fl);
      }
    }
    // cobwebs in the two back corners
    for (const [x, rot, flip] of [[r.x0 + 1, Math.PI / 4, 1], [r.x0 + r.w + 1, -Math.PI / 4, -1]]) {
      if (rand() < 0.3 || !(crypt || (G.biome || {}).rock)) continue;
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).translate(1, -1, 0), webMat);
      m.position.set(x, 1.7, r.z0 + 1.02); m.rotation.x = -PITCH; m.scale.x = flip; world.add(m); // tilted to face the camera
    }
    // coffins
    for (const [ci, cj] of r.coffins || []) {
      box(wood, ci + 0.5, 0, cj + 1, 0.66, 0.34, 1.5);
      box(lids, ci + 0.5, 0.34, cj + 1, 0.58, 0.07, 1.4);
      box(irons, ci + 0.5, 0.41, cj + 0.8, 0.06, 0.03, 0.42); box(irons, ci + 0.5, 0.41, cj + 0.75, 0.3, 0.03, 0.06);
    }
    // low drifting fog
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), fogMat);
      m.position.set(r.cx + rr(-2, 2), 0.3 + k * 0.25, r.cz + rr(-2, 2)); m.renderOrder = 2;
      m.userData.base = m.position.clone(); m.userData.ph = rand() * 6; world.add(m); fogPlanes.push(m);
    }
    // rooms you haven't entered are pitch black
    if (r.type !== 'start') {
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(r.w + 2.6, r.h + 2.6).rotateX(-Math.PI / 2), shroudMat.clone());
      sh.position.set(r.cx, 1.0, r.cz); sh.renderOrder = 5; world.add(sh); r.shroud = sh;
      const dim = new THREE.Mesh(new THREE.PlaneGeometry(r.w + 2, r.h + 2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
      dim.position.y = -0.4; sh.add(dim); // a second, flat darkening layer under the mist
      for (const f of r.flames) { f.visible = false; f.userData.core.visible = false; }
    }
  }
  const inst = (mat, list) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(boxGeo, mat, list.length);
    list.forEach(([x, y, z, sx, sy, sz, yaw, roll], k) => { de.set(0, yaw, roll); im.setMatrixAt(k, dm.compose(dv.set(x, y, z), dq.setFromEuler(de), ds.set(sx, sy, sz))); });
    im.castShadow = true; im.receiveShadow = true; im.userData.own = true; world.add(im);
  };
  inst(boneMat, bones); inst(ironMat, irons); inst(rubbleMat, rubble); inst(waxMat, wax); inst(woodMat, wood); inst(lidMat, lids);
}
// old stains so the place looks lived (and died) in
function biomeParticles(dt) {
  const px = player.x, pz = player.z, X = () => px + rr(-7, 7), Z = () => pz + rr(-9, 5);
  switch (G.biome.particle) {
    case 'dust': if (Math.random() < 0.35) spark(X(), rr(0.3, 2.6), Z(), 0x2c3038, { vx: rr(-0.15, 0.15), vy: rr(-0.05, 0.12), vz: rr(-0.15, 0.15), s: rr(0.06, 0.14), life: rr(2, 4), drag: 0 }); break;
    case 'fireflies': if (Math.random() < 0.3) spark(X(), rr(0.3, 2.2), Z(), Math.random() < 0.5 ? 0xd8ff6a : 0xffe46a, { vx: rr(-0.4, 0.4), vy: rr(-0.1, 0.25), vz: rr(-0.4, 0.4), s: rr(0.12, 0.24), life: rr(1.5, 3), drag: 0 }); break;
    case 'snow': for (let k = 0; k < 2; k++) spark(X(), rr(3, 5), Z(), 0xdfeaff, { vx: rr(-0.4, 0.4), vy: rr(-1.3, -0.6), vz: rr(-0.2, 0.2), s: rr(0.07, 0.15), life: 4, drag: 0 }); break;
    case 'embers': if (Math.random() < 0.6) spark(X(), rr(-0.3, 0.6), Z(), pick([0xff7a1a, 0xffb040, 0xff4a10]), { vy: rr(0.8, 1.9), vx: rr(-0.3, 0.3), vz: rr(-0.3, 0.3), s: rr(0.08, 0.18), life: rr(2, 3.5), drag: 0 }); break;
    case 'spores': if (Math.random() < 0.4) spark(X(), rr(0.2, 2.2), Z(), pick([0x9aff7a, 0xc07aff, 0x7affd8]), { vx: rr(-0.2, 0.2), vy: rr(0, 0.2), vz: rr(-0.2, 0.2), s: rr(0.1, 0.2), life: rr(2.5, 4), drag: 0 }); break;
  }
}
function grimeFloor() {
  for (const r of rooms) {
    for (let k = 0; k < ri(4, 9); k++) splat(r.x0 + 1.5 + rand() * (r.w - 1), r.z0 + 1.5 + rand() * (r.h - 1), pick(G.biome.splats), rr(0.6, 1.9));
  }
}

// ---------- audio (tiny synth, no files) ----------
let AC = null, master = null, noiseBuf = null, muted = false, silent = false, music = null;
function initAudio() {
  if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    // compressor on the master lets hits and booms be loud without clipping
    const comp = AC.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
    master = AC.createGain(); master.gain.value = 0.8; master.connect(comp).connect(AC.destination);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    music = startMusic();
  } catch (e) { AC = null; }
}
const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);
function tone(t, f0, f1, dur, type = 'square', vol = 0.08, dest = master) {
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest); o.start(t); o.stop(t + dur + 0.02);
}
function noiz(t, dur, vol, f0 = 2000, f1 = 300, type = 'lowpass', dest = master) {
  const s = AC.createBufferSource(); s.buffer = noiseBuf;
  const f = AC.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
  const g = AC.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur);
}
const vr = (k = 0.12) => 1 + (Math.random() - 0.5) * k; // pitch variation so repeats don't sound robotic
const SFX = {
  bolt: (t) => { const v = vr(); tone(t, 1500 * v, 520, 0.08, 'square', 0.03); tone(t, 320 * v, 140, 0.06, 'sine', 0.07); },
  fire: (t) => { noiz(t, 0.3, 0.16, 1800, 250); tone(t, 180 * vr(), 70, 0.25, 'sawtooth', 0.05); },
  boom: (t) => { noiz(t, 0.7, 0.55, 1400, 45); tone(t, 95 * vr(), 28, 0.55, 'sine', 0.6); noiz(t + 0.05, 0.35, 0.12, 6000, 2500, 'highpass'); },
  frost: (t) => { noiz(t, 0.45, 0.16, 7000, 2200, 'highpass'); [2093, 2637, 3136].forEach((f, i) => tone(t + i * 0.03, f, f * 1.02, 0.3, 'triangle', 0.03)); tone(t, 200, 60, 0.25, 'sine', 0.2); },
  zap: (t) => { for (let i = 0; i < 4; i++) tone(t + i * 0.025, 700 + Math.random() * 1400, 150, 0.06, 'sawtooth', 0.045); noiz(t, 0.15, 0.15, 8000, 3000, 'highpass'); },
  orb: (t) => { tone(t, 260, 780, 0.35, 'sine', 0.1); tone(t + 0.05, 520, 1560, 0.3, 'triangle', 0.03); },
  venom: (t) => { noiz(t, 0.2, 0.14, 3500 * vr(), 900, 'bandpass'); tone(t, 900 * vr(), 400, 0.08, 'square', 0.02); },
  hit: (t) => { const v = vr(0.3); noiz(t, 0.05, 0.16, 4200 * v, 1200); tone(t, 170 * v, 55, 0.08, 'sine', 0.22); },
  kill: (t) => { const v = vr(0.2); tone(t, 210 * v, 38, 0.2, 'sine', 0.42); noiz(t, 0.16, 0.22, 3200 * v, 180); tone(t + 0.02, 1100 * v, 2200 * v, 0.06, 'square', 0.025); },
  hurt: (t) => { tone(t, 320, 55, 0.35, 'sawtooth', 0.16); noiz(t, 0.25, 0.3, 1600, 90); tone(t, 90, 30, 0.3, 'sine', 0.4); },
  coin: (t, n = 0) => { const f = 1320 * Math.pow(2, Math.min(n, 14) / 12); tone(t, f, f, 0.05, 'square', 0.03); tone(t + 0.05, f * 1.5, f * 1.5, 0.09, 'square', 0.03); },
  heal: (t) => [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.06, f, f, 0.18, 'triangle', 0.08)),
  whoosh: (t) => { noiz(t, 0.2, 0.18, 700, 4000, 'bandpass'); tone(t, 300, 700, 0.12, 'sine', 0.05); },
  portal: (t) => { tone(t, 180, 720, 0.4, 'sine', 0.07); noiz(t, 0.4, 0.05, 1500, 5000, 'bandpass'); },
  spit: (t) => tone(t, 520 * vr(), 240, 0.12, 'triangle', 0.06),
  clear: (t) => { // victory fanfare: low impact, a rising major arpeggio into a held chord, a bright bell on top, a shimmer tail
    tone(t, 90, 45, 0.5, 'sine', 0.5); noiz(t, 0.35, 0.18, 1200, 120);
    [60, 64, 67, 72].forEach((n, i) => { const f = mtof(n); tone(t + i * 0.07, f, f, 0.22, 'square', 0.035); tone(t + i * 0.07, f, f, 0.3, 'triangle', 0.06); });
    [72, 76, 79, 84].forEach((n) => { const f = mtof(n); tone(t + 0.3, f, f, 1.4, 'triangle', 0.045); tone(t + 0.3, f * 1.004, f * 1.004, 1.4, 'sine', 0.03); });
    tone(t + 0.3, mtof(96), mtof(96), 1.8, 'sine', 0.05); tone(t + 0.3, mtof(96) * 2.76, mtof(96) * 2.7, 0.9, 'sine', 0.015);
    noiz(t + 0.28, 1.6, 0.06, 9000, 4000, 'highpass');
  },
  cleared: (t) => [67, 72, 76].forEach((n, i) => { const f = mtof(n); tone(t + i * 0.06, f, f, 0.35, 'triangle', 0.05); }), // soft chime for a normal room
  card: (t) => { tone(t, 660, 990, 0.09, 'sine', 0.05); tone(t + 0.04, 990, 1320, 0.1, 'sine', 0.03); },
  tap: (t) => { tone(t, 1250, 950, 0.045, 'sine', 0.045); tone(t, 620, 480, 0.06, 'triangle', 0.03); }, // soft UI click
  buy: (t) => [76, 83].forEach((n, i) => { const f = mtof(n); tone(t + i * 0.07, f, f, 0.28, 'sine', 0.06); tone(t + i * 0.07, f * 2, f * 2, 0.12, 'sine', 0.015); }),
  lock: (t) => { tone(t, 110, 70, 0.45, 'square', 0.08); noiz(t, 0.35, 0.3, 700, 60); tone(t, 60, 30, 0.4, 'sine', 0.4); },
  wave: (t) => [196, 233, 294].forEach((f, i) => tone(t + i * 0.09, f, f, 0.25, 'sawtooth', 0.04)),
  stairs: (t) => [262, 330, 392, 523, 659].forEach((f, i) => tone(t + i * 0.09, f, f * 0.5, 0.35, 'triangle', 0.09)),
  land: (t) => { tone(t, 120, 40, 0.25, 'sine', 0.5); noiz(t, 0.25, 0.25, 900, 80); },
  slam: (t) => { noiz(t, 0.7, 0.5, 600, 35); tone(t, 70, 25, 0.6, 'sine', 0.6); },
  pot: (t) => { noiz(t, 0.14, 0.2, 2800 * vr(), 600, 'bandpass'); tone(t, 700 * vr(), 300, 0.05, 'square', 0.03); },
  drip: (t) => { const f = 1300 * vr(0.3); tone(t, f, f * 0.4, 0.09, 'sine', 0.05); tone(t + 0.12, f * 0.8, f * 0.35, 0.06, 'sine', 0.02); },
  moan: (t) => {
    const o = AC.createOscillator(), f = AC.createBiquadFilter(), g = AC.createGain(), base = rr(95, 140);
    o.type = 'sawtooth'; o.frequency.setValueAtTime(base, t); o.frequency.linearRampToValueAtTime(base * 1.12, t + 0.8); o.frequency.linearRampToValueAtTime(base * 0.72, t + 2.6);
    f.type = 'bandpass'; f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(800, t + 1); f.frequency.linearRampToValueAtTime(380, t + 2.6); f.Q.value = 5;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05, t + 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 2.9);
  },
  chains: (t) => { for (let i = 0; i < 7; i++) { const tt = t + i * 0.08 + Math.random() * 0.04; tone(tt, 2600 + Math.random() * 1600, 1900, 0.05, 'square', 0.012); noiz(tt, 0.04, 0.03, 9000, 5000, 'highpass'); } },
  creak: (t) => { const o = AC.createOscillator(), g = AC.createGain(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t); for (let k = 1; k < 12; k++) o.frequency.setValueAtTime(60 + Math.random() * 40, t + k * 0.08); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.03, t + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + 1); const f = AC.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; o.connect(f).connect(g).connect(master); o.start(t); o.stop(t + 1.05); },
  spike: (t) => { noiz(t, 0.08, 0.2, 7000, 3000, 'highpass'); tone(t, 1900, 900, 0.07, 'square', 0.03); },
  hiss: (t) => noiz(t, 0.8, 0.12, 6000, 2000, 'highpass'),
  laser: (t) => { tone(t, 90, 160, 0.9, 'sawtooth', 0.08); noiz(t, 0.9, 0.06, 3000, 6000, 'bandpass'); },
  beat: (t) => { tone(t, 70, 45, 0.12, 'sine', 0.35); tone(t + 0.16, 65, 40, 0.12, 'sine', 0.25); },
};
const lastSfx = {};
function sfx(name, arg) {
  if (!AC || muted || silent) return;
  const t = AC.currentTime;
  if (lastSfx[name] && t - lastSfx[name] < 0.035) return;
  lastSfx[name] = t; SFX[name](t, arg);
}
// Music: ZEN while exploring (pads, pentatonic bells through an echo, a soft drone) and TECHNO while a room is
// locked (4-on-the-floor kick, claps, off-beat hats, acid bassline, stabs). Both run on one 128 BPM clock and crossfade.
function startMusic() {
  const bus = AC.createGain(); bus.gain.value = 0; bus.connect(master);
  bus.gain.linearRampToValueAtTime(0.14, AC.currentTime + 3);
  const zen = AC.createGain(); zen.gain.value = 1; zen.connect(bus);
  const techno = AC.createGain(); techno.gain.value = 0; techno.connect(bus);
  // echo for the bells
  const delay = AC.createDelay(1); delay.delayTime.value = 0.351; const fb = AC.createGain(); fb.gain.value = 0.42;
  const dly = AC.createBiquadFilter(); dly.type = 'lowpass'; dly.frequency.value = 2500;
  delay.connect(dly).connect(fb).connect(delay); delay.connect(zen);
  const darkF = AC.createBiquadFilter(); darkF.type = 'lowpass'; darkF.frequency.value = 260; darkF.Q.value = 2; darkF.connect(zen);
  const bells = AC.createGain(); bells.gain.value = 1; bells.connect(zen); bells.connect(delay);
  const pad = (t, f, dur, vol) => {
    for (const [type, det] of [['sine', 0], ['triangle', 6]]) {
      const o = AC.createOscillator(), g = AC.createGain();
      o.type = type; o.frequency.value = f; o.detune.value = det;
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.4); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(zen); o.start(t); o.stop(t + dur + 0.05);
    }
  };
  const bell = (t, f, vol) => { tone(t, f, f, 1.6, 'sine', vol, bells); tone(t, f * 2.01, f * 2.01, 0.6, 'sine', vol * 0.3, bells); };
  const acid = (t, f, dur, accent) => {
    const o = AC.createOscillator(), flt = AC.createBiquadFilter(), g = AC.createGain();
    o.type = 'sawtooth'; o.frequency.value = f;
    flt.type = 'lowpass'; flt.Q.value = 14; flt.frequency.setValueAtTime(accent ? 2600 : 1400, t); flt.frequency.exponentialRampToValueAtTime(220, t + dur * 0.9);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(accent ? 0.5 : 0.36, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(flt).connect(g).connect(techno); o.start(t); o.stop(t + dur + 0.02);
  };
  // soft electric-piano voice: sine + a little FM bell, gentle attack, tremolo-free
  const keys = (t, f, dur, vol, lead = false) => {
    const o = AC.createOscillator(), m = AC.createOscillator(), mg = AC.createGain(), g = AC.createGain(), lp = AC.createBiquadFilter();
    o.type = 'sine'; o.frequency.value = f; m.type = 'sine'; m.frequency.value = f * 2; mg.gain.setValueAtTime(f * (lead ? 1.2 : 0.8), t); mg.gain.exponentialRampToValueAtTime(1, t + 0.4);
    m.connect(mg).connect(o.frequency);
    lp.type = 'lowpass'; lp.frequency.value = lead ? 2600 : 1800;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(zen); if (lead) g.connect(delay);
    o.start(t); m.start(t); o.stop(t + dur + 0.05); m.stop(t + dur + 0.05);
  };
  // an 8-bar melody (MIDI notes on 16th steps; 0 = rest) so it sounds written, not random
  const MELODY = new Array(128).fill(0);
  [[0, 76], [3, 74], [6, 72], [10, 69], [16, 72], [19, 74], [22, 76], [26, 79], [32, 77], [35, 76], [38, 74], [42, 72], [48, 71], [52, 72], [56, 74],
   [64, 76], [67, 79], [70, 81], [74, 79], [80, 77], [83, 76], [86, 74], [90, 72], [96, 74], [99, 72], [102, 71], [106, 69], [112, 72], [116, 71], [120, 69]].forEach(([k, n]) => { MELODY[k] = n; });
  const PADS = [[45, 52, 57, 60], [41, 48, 53, 57], [43, 50, 55, 59], [40, 47, 52, 55]];
  const BASS = [33, 33, 45, 33, 33, 43, 33, 36, 33, 33, 45, 33, 31, 33, 36, 38]; // acid line (A1 root)
  const step = 60 / 128 / 4;
  let i = 0, next = AC.currentTime + 0.1;
  setInterval(() => {
    if (muted) { next = AC.currentTime + 0.1; return; }
    // back from the background: skip the beats missed while timers were throttled instead of playing them all at once
    if (next < AC.currentTime - 0.05) { const miss = Math.ceil((AC.currentTime - next) / step); next += miss * step; i += miss; }
    while (next < AC.currentTime + 0.3) {
      const s = i % 16, bar = Math.floor(i / 16), t = next;
      // --- explore layer: dark dungeon ambience (low drone, a slow heartbeat drum, rare low piano notes, far-off metal)
      if (i % 64 === 0) { const root = mtof(PADS[(i / 64) % 4][0] - 12); tone(t, root, root, step * 66, 'sawtooth', 0.05, darkF); tone(t, root * 1.5, root * 1.5, step * 66, 'sine', 0.06, zen); tone(t, root / 2, root / 2, step * 66, 'sine', 0.22, zen); }
      // (no wind layer: it sounded like static on phone speakers)
      if (s === 0 && bar % 2 === 0) { tone(t, 62, 38, 0.5, 'sine', 0.5, zen); tone(t + 0.22, 58, 36, 0.4, 'sine', 0.3, zen); }
      if (s === 6 && Math.random() < 0.18) { const n = pick([45, 48, 52, 53, 55]); tone(t, mtof(n), mtof(n), 2.6, 'triangle', 0.08, zen); tone(t, mtof(n + 12), mtof(n + 12), 1.4, 'sine', 0.025, zen); }
      if (s === 12 && Math.random() < 0.06) { const f = 300 + Math.random() * 500; tone(t, f, f * 0.98, 2.2, 'sine', 0.02, zen); tone(t, f * 2.76, f * 2.7, 1.2, 'sine', 0.012, zen); }
      // --- techno layer
      if (s % 4 === 0) { tone(t, 160, 42, 0.2, 'sine', 1.0, techno); noiz(t, 0.02, 0.15, 3000, 1500, 'lowpass', techno); }
      if (s === 4 || s === 12) { noiz(t, 0.14, 0.45, 2200, 900, 'bandpass', techno); noiz(t + 0.012, 0.1, 0.25, 2200, 900, 'bandpass', techno); }
      if (s % 4 === 2) noiz(t, 0.09, 0.22, 9000, 7000, 'highpass', techno);
      else if (s % 2 === 1) noiz(t, 0.03, 0.08, 10000, 8000, 'highpass', techno);
      const bn = BASS[s] + (bar % 4 === 3 && s >= 12 ? 3 : 0);
      if (s % 2 === 0 || Math.random() < 0.35) acid(t, mtof(bn), step * 0.9, s % 4 === 0 || s === 7);
      if (s === 0 && bar % 2 === 0) [57, 60, 64].forEach((n) => tone(t, mtof(n + (bar % 4 === 2 ? -2 : 0)), mtof(n), step * 2.5, 'square', 0.05, techno));
      if (bar % 8 === 7 && s >= 8) noiz(t, step, 0.06 * (s - 7), 400 + (s - 8) * 800, 8000, 'highpass', techno); // riser into the next 8 bars
      i++; next += step;
    }
  }, 40);
  let on = false;
  return {
    combat(v) {
      if (v === on) return; on = v;
      techno.gain.setTargetAtTime(v ? 1 : 0, AC.currentTime, v ? 0.15 : 0.9);
      zen.gain.setTargetAtTime(v ? 0.12 : 1, AC.currentTime, v ? 0.2 : 1.2);
    },
  };
}

// ---------- game data ----------
const SPELLS = new Proxy({}, { get: (_, id) => spellDef(id) || { name: '?', color: '#ffffff', cd: 1, els: [], sh: {} } });
const RELICS = [
  { id: 'boots', name: 'Swift Boots', info: '+15% move speed', icon: ['items', 5], apply: () => { player.speed *= 1.15; } },
  { id: 'vessel', name: 'Heart Vessel', info: '+1 heart and full heal', icon: ['items', 2], apply: () => { player.maxHp += 2; player.hp = player.maxHp; } },
  { id: 'prism', name: 'Mana Prism', info: 'All cooldowns -10%', icon: ['items', 3], apply: () => { player.cdMul *= 0.9; } },
  { id: 'lens', name: 'Cruel Lens', info: '+12% critical hit chance', icon: ['spells', 0], apply: () => { player.crit += 0.12; } },
  { id: 'lode', name: 'Lodestone', info: 'Coins fly to you from afar', icon: ['items', 0], apply: () => { player.magnet *= 1.9; } },
  { id: 'tome', name: 'Grimoire', info: '+20% spell damage', icon: ['items', 4], apply: () => { player.dmgMul *= 1.2; } },
  { id: 'feather', name: 'Phoenix Feather', info: 'Revive once with a fire burst', icon: ['spells', 1], apply: () => { player.revive++; } },
  { id: 'cloak', name: 'Shadow Cloak', info: '+10% dodge chance', icon: ['items', 1], apply: () => { player.cloakDodge = (player.cloakDodge || 0) + 0.1; } },
  { id: 'ember', name: 'Ember Heart', info: 'Getting hit sets off a fire burst', icon: ['spells', 1], apply: () => { player.ember = true; } },
];
const ENEMY = {
  slime: { hp: 24, r: 0.36, speed: 4.4, splat: 0xd8389c, chunk: 0xff6fc4, coin: 0.45 },
  eyeboss: { hp: 950, r: 1.0, speed: 2.6, splat: 0x9b0f22, chunk: 0xf3e6ea, coin: 1, sheet: 'hollow', fly: true },
  golemboss: { hp: 1300, r: 1.1, speed: 1.6, splat: 0x4a545e, chunk: 0x8a96a0, coin: 1, sheet: 'stoneking' },
  tyrant: { hp: 1150, r: 1.0, speed: 2.1, splat: 0x6e6658, chunk: 0xe8e0cc, coin: 1, sheet: 'tyrant' },
  sporeboss: { hp: 1050, r: 1.1, speed: 0.9, splat: 0x5a2a7a, chunk: 0xb070ff, coin: 1, sheet: 'sporemother' },
  wraithboss: { hp: 900, r: 0.9, speed: 2.4, splat: 0x5fc8d8, chunk: 0xbff3ff, coin: 1, sheet: 'wraith', fly: true },
  mimic: { hp: 150, r: 0.45, speed: 5, splat: 0x3a2418, chunk: 0x8a5a2a, coin: 1 },
  big: { hp: 140, r: 0.6, speed: 3.6, splat: 0xd8389c, chunk: 0xff6fc4, coin: 0.9, sheet: 'slime', h: 1.35 },
  eye: { hp: 20, r: 0.34, speed: 2.6, splat: 0x9b0f22, chunk: 0xf3e6ea, coin: 0.5, fly: true },
  imp: { hp: 12, r: 0.3, speed: 4.6, splat: 0x170b1e, chunk: 0x3a1a44, coin: 0.4 },
  skeleton: { hp: 70, r: 0.36, speed: 2.3, splat: 0x6e6658, chunk: 0xe8e0cc, coin: 0.6 },
  boss: { hp: 1100, r: 1.15, speed: 6, splat: 0xb01a74, chunk: 0xff4fb0, coin: 1 },
  bomber: { hp: 10, r: 0.32, speed: 4.8, splat: 0x2a1a10, chunk: 0xff8a2a, coin: 0.4 },
  ghost: { hp: 30, r: 0.32, speed: 2.6, splat: 0x5fc8d8, chunk: 0xbff3ff, coin: 0.5, fly: true },
  shroom: { hp: 55, r: 0.36, speed: 0, splat: 0x5a2a7a, chunk: 0xb070ff, coin: 0.5 },
  golem: { hp: 320, r: 0.52, speed: 1.7, splat: 0x4a545e, chunk: 0x8a96a0, coin: 0.9 },
};

// ---------- state ----------
const BOSSES = [
  { type: 'boss', name: 'KING GLOOP', sub: 'THE JELLY TYRANT' },
  { type: 'eyeboss', name: 'THE HOLLOW EYE', sub: 'IT HAS ALREADY SEEN YOU' },
  { type: 'golemboss', name: 'THE STONE KING', sub: 'OLDER THAN THE DUNGEON' },
  { type: 'tyrant', name: 'THE BONE TYRANT', sub: 'HE RULES THE DEAD' },
  { type: 'sporeboss', name: 'MOTHER SPORE', sub: 'SHE FEEDS THE DARK' },
  { type: 'wraithboss', name: 'THE WRAITH QUEEN', sub: 'SHE WAS ONCE A WIZARD' },
];
const G = { biomeKey: 'crypt', biome: null, boss: BOSSES[0], combo: 0, comboT: 0, comboPop: 0, coinChain: 0, coinT: 0, state: 'title', floor: 1, time: 0, hitstop: 0, slowmo: 0, kills: 0, coins: 0, curRoom: null, waveDelay: 0, best: 0, deadT: 0, pal: PALETTES[0], cardsOpen: 0 };
// ---------- meta progression: soul shards + permanent upgrades, saved on this device ----------
const META_KEY = 'rbd_meta_v1';
const UPGRADES = [
  { id: 'vit', name: 'Vitality', info: '+1 starting heart', max: 3, cost: [150, 350, 700], icon: ['items', 2] },
  { id: 'pow', name: 'Arcane Power', info: '+8% spell damage', max: 5, cost: [100, 200, 350, 550, 800], icon: ['spells', 0] },
  { id: 'haste', name: 'Haste', info: '-5% spell cooldowns', max: 5, cost: [125, 250, 425, 650, 900], icon: ['items', 3] },
  { id: 'swift', name: 'Swiftness', info: '+5% move speed', max: 3, cost: [100, 225, 400], icon: ['items', 5] },
  { id: 'greed', name: 'Greed', info: '+20% coins', max: 3, cost: [75, 175, 300], icon: ['items', 0] },
  { id: 'reach', name: 'Lodestone', info: '+25% pickup range', max: 3, cost: [50, 125, 225], icon: ['items', 1] },
  { id: 'fate', name: 'Fate', info: 'Legendary spells show up more', max: 3, cost: [200, 450, 800], icon: ['spells', 4] },
  { id: 'relic', name: 'Heirloom', info: 'Start every run with a relic', max: 1, cost: [600], icon: ['items', 4] },
  { id: 'life', name: 'Second Life', info: 'Revive once per run', max: 1, cost: [1000], icon: ['spells', 1] },
];
function loadMeta() {
  const d = { shards: 0, up: {}, codex: [], elements: START_ELEMENTS.slice(), hero: 'wizard', heroes: Object.keys(HEROES), dungeon: 'crypt', legacy: 0, legacyXp: 0, vault: {}, stash: [], tutDone: false, statBuy: {}, wins: 0, winStats: 0, winLegend: null, winRevive: 0, start: 'arcane.bolt', stats: { runs: 0, bestFloor: 0, kills: 0, bosses: 0, champs: 0, coins: 0, time: 0, bestCombo: 0, dmg: 0, shardsTotal: 0 } };
  try {
    const m = JSON.parse(localStorage.getItem(META_KEY) || 'null');
    if (m) { const r = { ...d, ...m, up: { ...m.up }, stats: { ...d.stats, ...m.stats } }; r.hero = 'wizard'; r.start = LEGACY_IDS[r.start] || r.start; return r; }
    d.stats.bestFloor = +localStorage.getItem('rbd_best') || 0; // carry over the old best
  } catch (e) { /* storage blocked: progress lives for this session only */ }
  return d;
}
const meta = loadMeta();
function saveMeta() { meta.t = Date.now(); const j = JSON.stringify(meta); try { localStorage.setItem(META_KEY, j); } catch (e) { /* ignore */ } mirror(META_KEY, j); }
const mlv = (id) => meta.up[id] || 0;
G.best = meta.stats.bestFloor;
let player = null;
let meteors = [], mines = [], rays = [], wisps = [], clouds = [], beams = [], hazards = [], holes = [], enemies = [], projs = [], eprojs = [], pickups = [], portals = [], rings = [], bolts = [], texts = [], orbs = [], pots = [], fires = [], props = [], barriers = [];
let spells = [];
const input = { x: 0, z: 0, keys: new Set(), stick: null };

function newPlayer() {
  const hid = 'wizard', hero = { ...HEROES[hid], id: hid }; // single hero for now
  return {
    hero, lv: 1, xp: 0, statPts: 0, alloc: { str: 0, agi: 0, vit: 0, int: 0, dex: 0, luk: 0 }, st: { ...hero.base }, der: derive(hero.cls, hero.base),
    g: gearTotals({}), gear: {}, bag: [], bonusHp: 0, casts: 0, critDmg: 2, area: 1, dur: 1, extraProj: 0, luck: 0, elPow: {},
    x: 0, z: 0, vx: 0, vz: 0, r: 0.3, hp: 6, maxHp: 6, speed: 5.4, iframe: 0,
    face: 1, anim: 0, step: 0, crit: 0.05, cdMul: 1, dmgMul: 1, magnet: 2.2, revive: 0, ember: false, relics: [],
    mesh: makeSprite(hero.sprite), shadow: makeShadow(0.8), staffGlow: (() => { const g = makeGlow(hero.tipColor, 0.45, 0.75); g.material.depthTest = false; g.renderOrder = 10; return g; })(), /* drawn over the wizard */ alive: true, aimX: 0, aimZ: -1, squash: 0,
  };
}

function resetLevelObjects() {
  $('bossbar').classList.add('hidden');
  for (const e of enemies) { killMesh(e.mesh); scene.remove(e.shadow); }
  for (const p of projs) killProj(p);
  for (const p of eprojs) killProj(p);
  for (const p of pickups) { killMesh(p.mesh); scene.remove(p.shadow); if (p.beam) scene.remove(p.beam); if (p.glow) killGlow(p.glow); }
  for (const p of portals) { scene.remove(p.mesh); p.mesh.material.dispose(); }
  for (const r of rings) { scene.remove(r.mesh); r.mesh.material.dispose(); }
  for (const o of orbs) { killGlow(o.glow); scene.remove(o.mesh); scene.remove(o.shadow); }
  for (const p of pots) scene.remove(p.mesh);
  for (const f of fires) killGlow(f.glow);
  for (const m of mines) killGlow(m.glow);
  for (const r of rays) for (const m of r.meshes) { scene.remove(m); m.material.dispose(); }
  for (const w of wisps) { killGlow(w.glow); scene.remove(w.mesh); scene.remove(w.shadow); }
  for (const m of meteors) { scene.remove(m.g); killGlow(m.glow); }
  mines = []; rays = []; wisps = []; meteors = [];
  for (const h of holes) killGlow(h.glow);
  for (const b of beams) { scene.remove(b.mesh); b.mesh.material.dispose(); }
  for (const h of hazards) { scene.remove(h.mesh); if (h.spikes) scene.remove(h.spikes); if (h.glow) killGlow(h.glow); }
  beams = []; hazards = []; clouds = []; G.swarm = null; G.dark = null;
  holes = []; G.still = 0; G.finisher = null; renderer.domElement.style.filter = '';
  for (const p of props) { if (p.group) scene.remove(p.group); killMesh(p.mesh); killGlow(p.glow); }
  for (const b of barriers) scene.remove(b);
  enemies = []; projs = []; eprojs = []; pickups = []; portals = []; rings = []; bolts = []; texts = []; orbs = []; pots = []; fires = []; props = []; barriers = [];
  for (const d of gData) d.life = 0;
  for (const d of debris) d.life = 0;
  clearSplats();
}

function newGame() {
  if (player) { killMesh(player.mesh); scene.remove(player.shadow); killGlow(player.staffGlow); }
  player = newPlayer();
  const sd = spellDef(meta.start);
  const startId = sd && meta.codex.includes(meta.start) && sd.els.every((e) => meta.elements.includes(e)) ? meta.start : player.hero.start;
  spells = [{ id: startId, lv: 1, t: 0.3 }];
  if (!meta.codex.includes(startId)) { meta.codex.push(startId); saveMeta(); }
  G.kills = 0; G.coins = 0; G.floor = START_FLOOR; G.bossOrder = null; G.adapt = 1; G.lvPicks = 0;
  player.maxHp += 2 * mlv('vit'); player.hp = player.maxHp;
  player.dmgMul *= 1 + 0.08 * mlv('pow'); player.cdMul *= Math.pow(0.95, mlv('haste'));
  player.speed *= 1 + 0.05 * mlv('swift'); player.magnet *= 1 + 0.25 * mlv('reach'); player.revive += mlv('life');
  G.coinMul = 1 + 0.2 * mlv('greed');
  G.run = { kills: 0, dmg: 0, bosses: 0, champs: 0, coins: 0, bestCombo: 0, time: 0 };
  // hero passives
  const hid = player.hero.id;
  if (hid === 'amazon') { player.pierceBonus = 1; player.projSpeed = 1.2; }
  if (hid === 'ranger') player.rangeBonus = 2;
  // Legacy: each level of account progress = +1 main stat (and +1 VIT every 3rd level) on every run
  const mainStat = { mage: 'int', archer: 'dex', warrior: 'str', hunter: 'str' }[player.hero.cls];
  const alloc0 = { ...player.alloc };
  for (const k of STATS) player.alloc[k] += 2 * (meta.winStats || 0) + ((meta.statBuy || {})[k] || 0);
  player.revive += meta.winRevive || 0;
  if (meta.winLegend && spellDef(meta.winLegend) && !spells.some((x) => x.id === meta.winLegend)) spells.push({ id: meta.winLegend, lv: 1, t: 2 });
  player.alloc[mainStat] += meta.legacy || 0; player.alloc.vit += Math.floor((meta.legacy || 0) / 3);
  player.metaAlloc = Object.fromEntries(STATS.map((k) => [k, player.alloc[k] - alloc0[k]])); // bought / legacy / victory stats
  for (const [slot, it] of Object.entries(meta.vault || {})) if (it) player.gear[slot] = { ...it, vault: true };
  recalcStats();
  if (mlv('relic')) later(1.3, () => { const r = relicOptions(1)[0]; if (r && player.alive) { r.pick(); G.saveDue = true; } });
  if (START_FLOOR > 1) { spells.push({ id: 'fire.orb', lv: 2, t: 1 }, { id: 'frost.nova', lv: 1, t: 1 }); player.maxHp = player.hp = 8; }
  buildSpellHud();
  renderHearts(); $('coins').textContent = 0;
  G.tut = !meta.tutDone && !AUTO ? { step: 0, moved: 0 } : null;
  if (G.tut) later(2, () => tutShow('DRAG ANYWHERE TO MOVE', true));
  { const kept = SLOTS.map((k) => meta.vault[k]).filter(Boolean); if (kept.length) later(2.6, () => toast('EQUIPPED FROM VAULT', kept.map((it) => `<span style="color:${RARITY[it.rarity].color}">${it.name}</span>`).join(' · '))); }
  startFloor(G.floor);
  G.state = 'play';
  $('hud').classList.remove('hidden');
  checkpoint();
}

// ---------- run save: one checkpoint of the current run, so a run closed mid-way can be continued from the title ----------
// Written at every floor start, and after a room clear / card pick / chest / shop buy once nothing is fighting and no
// reward pick is pending. Plain data only: the floor is rebuilt from its seed with the rooms you cleared, and you stand in
// the last safe room. Cleared on death, victory and quit. Shards are only paid when a run ends, so a continue can't pay twice.
const RUN_KEY = 'rbd_run_v1', RUN_END = 'rbd_run_end', RUN_VER = 1; // RUN_END: when the save was last cleared (native copy only)
const PLAYER_SKIP = new Set(['mesh', 'shadow', 'staffGlow', 'mirrorRoom', 'hero', 'st', 'der', 'g']); // three.js / derived
let lastRun = null; // the last checkpoint as JSON, written again on pagehide
function runSnapshot() {
  const p = {}; for (const [k, v] of Object.entries(player)) if (!PLAYER_SKIP.has(k)) p[k] = v;
  return { v: RUN_VER, t: Date.now(), floor: G.floor, fseed: G.floorSeed, seed, dungeon: G.runDungeon, bossOrder: G.bossOrder, kills: G.kills, coins: G.coins,
    coinMul: G.coinMul, adapt: G.adapt, lvPicks: G.lvPicks || 0, curse: G.curse || 0, run: G.run, room: rooms.indexOf(G.safeRoom),
    rooms: rooms.map((r) => (r.cleared ? 1 : 0) | (r.visited ? 2 : 0) | (r.seen ? 4 : 0)),
    props: props.map((q, i) => (q.opened || q.sold || q.used ? i : -1)).filter((i) => i >= 0),
    gold: props.filter((q) => q.gold && !q.opened).map((q) => rooms.indexOf(q.room)), hero: player.hero.id, player: p, spells };
}
function checkpoint() { if (BENCH || !player || !player.alive) return; G.saveDue = false; lastRun = JSON.stringify(runSnapshot()); storeRun(); }
function storeRun() { if (!lastRun) return; try { localStorage.setItem(RUN_KEY, lastRun); } catch (e) { /* storage full or blocked: no continue */ } mirror(RUN_KEY, lastRun); }
function clearRun() { lastRun = null; G.saveDue = false; try { localStorage.removeItem(RUN_KEY); } catch (e) { /* ignore */ } mirror(RUN_KEY, null); mirror(RUN_END, String(Date.now())); }
function loadRun() { // a broken or older save is dropped quietly
  try {
    const s = JSON.parse(localStorage.getItem(RUN_KEY) || 'null');
    if (!s) return null;
    if (s.v === RUN_VER && s.floor >= 1 && HEROES[s.hero] && s.player && Array.isArray(s.spells) && s.spells.every((x) => spellDef(x.id)) && Array.isArray(s.rooms)) return s;
  } catch (e) { /* unreadable */ }
  clearRun(); return null;
}
// safe = nothing is fighting, no reward pick is open or about to open
const runSafe = () => G.state === 'play' && player && player.alive && !rooms.some((q) => q.active) && !G.lvPicks && G.run.time - (G.pendT ?? -9) > 1.2;
function continueRun(s) {
  initAudio(); for (const sId of screens) $(sId).classList.add('hidden');
  if (player) { killMesh(player.mesh); scene.remove(player.shadow); killGlow(player.staffGlow); }
  player = newPlayer();
  Object.assign(player, s.player, { hero: { ...HEROES[s.hero], id: s.hero }, alive: true, iframe: 0, vx: 0, vz: 0 });
  spells = s.spells;
  Object.assign(G, { floor: s.floor, kills: s.kills, coins: s.coins, coinMul: s.coinMul, adapt: s.adapt, lvPicks: s.lvPicks, lvPickT: 0.7, run: s.run,
    bossOrder: s.bossOrder, runDungeon: s.dungeon, tut: null, combo: 0, pendT: null });
  recalcStats(); buildSpellHud(); $('coins').textContent = G.coins;
  if (player.statPts) $('pauseBtn').classList.add('pts');
  startFloor(G.floor, s.fseed);
  if (s.rooms.length === rooms.length) rooms.forEach((r, i) => {
    r.cleared = !!(s.rooms[i] & 1); r.visited = !!(s.rooms[i] & 2); r.seen = !!(s.rooms[i] & 4);
    if (r.cleared && (r.type === 'exit' || r.type === 'boss')) spawnStairs(r);
  });
  for (const i of s.props || []) {
    const q = props[i]; if (!q) continue;
    if (q.kind === 'chest') q.opened = true; else if (q.kind === 'shop') q.sold = true; else if (q.kind === 'shrine') { q.used = true; q.mesh.material.uniforms.uTint.value.set(0x555566); }
    if (q.kind !== 'shrine') { killMesh(q.mesh); q.mesh = null; }
    killGlow(q.glow); q.glow = null;
  }
  for (const i of s.gold || []) if (rooms[i]) addGoldChest(rooms[i]);
  const r = rooms[s.room];
  if (r && r.type !== 'start') { // stand in the last safe room, off its centre (chest, stairs, shrine)
    const spot = [[0, 3], [0, -3], [2, 3], [-2, 3], [3, 0], [-3, 0]].map(([dx, dz]) => [r.cx + dx, r.cz + dz]).find(([x, z]) => cellAt(x, z) === FLOOR && !hazards.some((h) => h.i === Math.floor(x) && h.j === Math.floor(z))) || [r.cx, r.cz];
    player.x = spot[0]; player.z = spot[1]; camTarget.set(player.x, 0, player.z); G.safeRoom = r;
  }
  seed = s.seed; G.curse = s.curse;
  G.state = 'play';
  $('hud').classList.remove('hidden');
  checkpoint();
}
// closing / backgrounding the app: save now if it is a safe moment, otherwise keep the last checkpoint
function saveOnHide() { if (!lastRun) return; if (runSafe()) checkpoint(); else storeRun(); }
function pauseGame() { if (G.state !== 'play' || !player || !player.alive) return; G.state = 'paused'; renderBuild(); $('pause').scrollTop = 0; $('pause').classList.remove('hidden'); }
// leaving the app mid-fight: save first (runSafe needs 'play'), then pause, so coming back shows the pause menu.
// Card picks, the death screen etc. stay as they are and just keep the last checkpoint.
function onHide() { saveOnHide(); pauseGame(); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') onHide(); });
addEventListener('pagehide', onHide);
document.addEventListener('pause', onHide); // Cordova / Capacitor app event (Android), same as hidden
{ const A = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App; if (A && A.addListener) try { A.addListener('pause', onHide); } catch (e) { /* no App plugin */ } }

function startFloor(n, fseed) {
  resetLevelObjects();
  if (!G.bossOrder) { // per run: bosses that still guard a locked element come first, so replays can unlock them early
    const unlocks = (t) => Object.values(BOSS_SPELLS).find((b) => b.boss === t)?.unlocks;
    const types = BOSSES.map((b) => b.type), locked = types.filter((t) => unlocks(t) && !meta.elements.includes(unlocks(t)));
    G.bossOrder = shuffle(locked.slice()).concat(shuffle(types.filter((t) => !locked.includes(t))));
  }
  // everything below is built from this seed: a continued run passes the saved one and gets the same floor back
  if (fseed != null) seed = fseed;
  G.floorSeed = seed; G.safeRoom = null;
  G.biomeKey = pickBiome(n); G.biome = BIOMES[G.biomeKey]; G.pal = biomePalette(G.biome); G.curse = 0;
  applyBiomeLight(G.biome);
  G.boss = BOSSES.find((b) => b.type === G.bossOrder[Math.max(0, Math.floor(n / 3) - 1) % G.bossOrder.length]);
  const start = genFloor(n);
  buildWorld(G.pal); grimeFloor();
  for (const r of rooms) setupRoom(r);
  G.champion = null;
  const champRooms = rooms.filter((r) => r.type === 'combat' && r.depth >= 2);
  if (n >= 2 && champRooms.length && rand() < 0.75) {
    const name = pick(['Grubnak', 'Old Mother Gloop', 'Skreev', 'Vexis', 'Krull', 'Morrow', 'Hollow Jack', 'Sister Ash']) + ' ' + pick(['the Hungry', 'the Hollow', 'of the Deep', 'the Unburied', 'the Weeping', 'the Rotten', 'Bonegnawer']);
    const pool = ['big', 'skeleton', 'imp', 'eye'].concat(n >= 3 ? ['ghost', 'shroom'] : [], n >= 4 ? ['golem', 'golem'] : []);
    G.champion = { name, type: pick(pool), room: pick(champRooms) };
    G.champion.room.champ = G.champion;
  }
  player.x = start.cx; player.z = start.cz + 2; player.vx = player.vz = 0; player.drop = 0.22; player.dropDelay = 1.5; // let the floor fade in first
  camTarget.set(player.x, 0, player.z);
  G.curRoom = null;
  $('floorLbl').textContent = `FLOOR ${n} / ${WIN_FLOOR}`;
  banner(`FLOOR ${n}`, n % 3 === 0 ? 'A GREAT EVIL STIRS' : G.pal.name);
  if (G.champion) later(2.4, () => toast(G.champion.name.toUpperCase(), 'stalks this floor...'));
  $('fade').style.opacity = 0;
}

function setupRoom(r) {
  const fl = G.floor;
  if (r.type === 'combat' || r.type === 'exit' || r.type === 'boss' || r.type === 'challenge') {
    r.waves = r.totalWaves = r.type === 'boss' ? 3 : Math.min(2 + Math.floor((fl - 1) / 2), 4) + (r.type === 'exit' || r.type === 'challenge' ? 1 : 0);
    const nPots = ri(1, 4);
    for (let k = 0; k < nPots; k++) {
      const i = pick([1, 2, r.w - 2, r.w - 1]), j = ri(1, r.h - 1);
      if (map[(r.z0 + j) * MW + r.x0 + i] !== FLOOR) continue;
      addPot(r.x0 + i + 0.5, r.z0 + j + 0.5);
    }
    placeHazards(r);
    for (let k = 0; k < ri(0, 3); k++) {
      const i = ri(2, r.w - 1), j = ri(2, r.h - 1);
      if (Math.abs(i - 1 - Math.floor(r.w / 2)) <= 1 || Math.abs(j - 1 - Math.floor(r.h / 2)) <= 1) continue;
      if (map[(r.z0 + j) * MW + r.x0 + i] !== FLOOR) continue;
      addBarrel(r.x0 + i + 0.5, r.z0 + j + 0.5);
    }
  }
  if (r.type === 'shrine') {
    const m = makeSprite('shrine'); m.position.set(r.cx, 0.04, r.cz);
    props.push({ kind: 'shrine', room: r, x: r.cx, z: r.cz, mesh: m, glow: makeGlowAt(r.cx, 1.1, r.cz, 0xff2a4a, 2, 0.45) });
  }
  if (r.type === 'treasure') {
    const chest = makeSprite('items', 0.9, 4);
    chest.position.set(r.cx, 0.08, r.cz);
    props.push({ mimic: G.floor >= 2 && rand() < 0.3, kind: 'chest', room: r, x: r.cx, z: r.cz, mesh: chest, glow: makeGlowAt(r.cx, 0.5, r.cz, 0xffc040, 2.2, 0.35) });
  }
  if (r.type === 'shop') {
    const offers = [
      { kind: 'heal', icon: ['items', 2], price: 10 + fl * 3, label: 'Heal 1 heart' },
      { kind: 'upgrade', icon: ['items', 3], price: 24 + fl * 6, label: 'Spell upgrade' },
      { kind: 'relic', icon: ['items', 5], price: 34 + fl * 8, label: 'Random relic' },
      { kind: 'gear', icon: ['gear', 3], price: 30 + fl * 7, label: 'Rare+ gear' },
    ];
    offers.forEach((o, k) => {
      const x = r.cx + (k - 1.5) * 2.2, z = r.cz - 1;
      const group = new THREE.Group();
      const base = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ map: wallTex, color: G.pal.wall }));
      base.scale.set(0.9, 0.45, 0.9); base.castShadow = true; group.add(base); group.position.set(x, 0, z); scene.add(group);
      const m = makeSprite(o.icon[0], 0.6, o.icon[1]); m.position.set(x, 0.75, z);
      props.push({ kind: 'shop', offer: o, x, z, mesh: m, group, glow: makeGlowAt(x, 0.9, z, 0x7fffd4, 1.6, 0.4), sold: false });
    });
  }
}
function makeGlowAt(x, y, z, c, s, o) { const g = makeGlow(c, s, o); g.position.set(x, y, z); return g; }
const spikeBaseMat = new THREE.MeshLambertMaterial({ color: 0x3a3a44 });
const spikeMat = new THREE.MeshLambertMaterial({ color: 0xc8ccd8 });
const spikeGeo = new THREE.ConeGeometry(0.08, 0.42, 4).translate(0, 0.21, 0);
const lavaTex = canvasTex(16, 16, (g) => {
  g.fillStyle = '#1a0500'; g.fillRect(0, 0, 16, 16);
  g.fillStyle = '#ff6a10';
  let x = 1, y = 8; for (let k = 0; k < 18; k++) { g.fillRect(x, y, 2, 1); x += 1; y += Math.round((hash(k, 3) - 0.5) * 3); y = Math.max(1, Math.min(14, y)); }
  x = 8; y = 1; for (let k = 0; k < 16; k++) { g.fillRect(x, y, 1, 2); y += 1; x += Math.round((hash(k, 7) - 0.5) * 3); x = Math.max(1, Math.min(14, x)); }
  g.fillStyle = '#ffd040'; g.fillRect(7, 7, 2, 2);
});
function hazardFree(r, i, j) {
  // keep the door lanes and the area right inside each door clear
  if (Math.abs(i - Math.floor(r.w / 2)) <= 1 || Math.abs(j - Math.floor(r.h / 2)) <= 1) return false;
  return map[(r.z0 + 1 + j) * MW + r.x0 + 1 + i] === FLOOR && !hazards.some((h) => h.i === r.x0 + 1 + i && h.j === r.z0 + 1 + j);
}
function placeHazards(r) {
  const spikes = r.variant === 'traps' ? 3 : G.biome.hazard === 'spikes' && G.floor >= 2 ? ri(1, 2) : 0;
  for (let row = 0; row < spikes; row++) {
    const horizontal = rand() < 0.5, grp = row % 2;
    const j0 = ri(1, r.h - 2), i0 = ri(1, r.w - 2), len = ri(3, 6);
    for (let k = 0; k < len; k++) {
      const i = horizontal ? i0 - 2 + k : i0, j = horizontal ? j0 : j0 - 2 + k;
      if (i < 0 || j < 0 || i >= r.w || j >= r.h || !hazardFree(r, i, j)) continue;
      addSpike(r.x0 + 1 + i, r.z0 + 1 + j, grp * 1.2);
    }
  }
  if (r.variant === 'traps') for (let k = 0; k < 10; k++) { const i = ri(0, r.w - 1), j = ri(0, r.h - 1); if (hazardFree(r, i, j)) addSpike(r.x0 + 1 + i, r.z0 + 1 + j, (i + j) % 2 * 1.2); }
  if (G.biome.hazard === 'vents' && G.floor >= 2) for (let k = 0; k < ri(2, 3); k++) { const i = ri(1, r.w - 2), j = ri(1, r.h - 2); if (hazardFree(r, i, j)) addVent(r.x0 + 1 + i, r.z0 + 1 + j); }
  if (G.biome.hazard === 'lava' && G.floor >= 2) for (let c = 0; c < ri(2, 3); c++) {
    let i = ri(1, r.w - 2), j = ri(1, r.h - 2);
    for (let k = 0; k < ri(2, 4); k++) { if (i >= 0 && j >= 0 && i < r.w && j < r.h && hazardFree(r, i, j)) addLava(r.x0 + 1 + i, r.z0 + 1 + j); if (rand() < 0.5) i += pick([-1, 1]); else j += pick([-1, 1]); }
  }
}
function addSpike(i, j, off) {
  const base = new THREE.Mesh(boxGeo, spikeBaseMat); base.scale.set(0.92, 0.03, 0.92); base.position.set(i + 0.5, 0, j + 0.5); base.receiveShadow = true;
  const spikes = new THREE.Group();
  for (const [ox, oz] of [[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22], [0, 0]]) { const c = new THREE.Mesh(spikeGeo, spikeMat); c.position.set(ox, 0, oz); c.castShadow = true; spikes.add(c); }
  spikes.position.set(i + 0.5, -0.45, j + 0.5); scene.add(spikes);
  scene.add(base);
  hazards.push({ kind: 'spike', i, j, x: i + 0.5, z: j + 0.5, mesh: base, spikes, off, state: 'down' });
}
function addVent(i, j) {
  const m = new THREE.Mesh(boxGeo, spikeBaseMat); m.scale.set(0.8, 0.04, 0.8); m.position.set(i + 0.5, 0, j + 0.5);
  for (let k = -1; k <= 1; k++) { const bar = new THREE.Mesh(boxGeo, ironMat); bar.scale.set(0.12, 1.5, 0.9); bar.position.set(k * 0.3, 0, 0); m.add(bar); }
  scene.add(m);
  hazards.push({ kind: 'vent', i, j, x: i + 0.5, z: j + 0.5, mesh: m, off: rand() * 4.5, state: 'idle' });
}
function addLava(i, j) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: lavaTex }));
  m.position.set(i + 0.5, 0.012, j + 0.5); m.rotation.y = ri(0, 3) * Math.PI / 2; scene.add(m);
  hazards.push({ kind: 'lava', i, j, x: i + 0.5, z: j + 0.5, mesh: m, glow: makeGlowAt(i + 0.5, 0.15, j + 0.5, 0xff5a10, 1.3, 0.35), state: 'hot' });
}
function updateHazards(dt) {
  const pi = Math.floor(player.x), pj = Math.floor(player.z), onFloor = player.alive && !(player.drop > 0);
  for (const h of hazards) {
    if (h.kind === 'spike') {
      const ph = (G.time + h.off) % 2.4;
      const st = ph < 1.4 ? 'down' : ph < 1.9 ? 'warn' : 'up';
      h.spikes.position.y = st === 'down' ? -0.45 : st === 'warn' ? -0.32 + Math.sin(G.time * 50) * 0.02 : 0;
      if (st === 'up' && h.state !== 'up') { if (Math.hypot(h.x - player.x, h.z - player.z) < 6) sfx('spike'); chunkDust(h.x, h.z, 0x8a8a96); }
      h.state = st;
      if (st === 'up') {
        if (onFloor && pi === h.i && pj === h.j) damagePlayer(1, h.x, h.z + 0.01);
        for (const e of enemies) if (!e.dead && !e.d.fly && e.y < 0.3 && Math.floor(e.x) === h.i && Math.floor(e.z) === h.j && (e.spikeCd || 0) < G.time) { e.spikeCd = G.time + 0.5; hurtEnemyRaw(e, 18 + G.floor * 3, '#c8ccd8'); }
      }
    } else if (h.kind === 'vent') {
      const ph = (G.time + h.off) % 4.5;
      const st = ph < 2.7 ? 'idle' : ph < 3.4 ? 'warn' : 'puff';
      if (st === 'warn' && Math.random() < 0.5) spark(h.x + rr(-0.3, 0.3), 0.1, h.z + rr(-0.3, 0.3), 0x5fff4a, { vy: 1.5, s: 0.25, life: 0.4, drag: 0 });
      if (st === 'puff') {
        if (h.state !== 'puff') { h.hit = false; if (Math.hypot(h.x - player.x, h.z - player.z) < 7) sfx('hiss'); }
        for (let k = 0; k < 3; k++) { const a = Math.random() * 6.28, d = Math.random() * 1.4; spark(h.x + Math.cos(a) * d, rr(0.1, 1), h.z + Math.sin(a) * d, Math.random() < 0.5 ? 0x5fff4a : 0x2a7a2a, { vy: 0.6, s: rr(0.5, 0.9), life: 0.7, drag: 1 }); }
        if (!h.hit && onFloor && Math.hypot(player.x - h.x, player.z - h.z) < 1.3) { h.hit = true; damagePlayer(1, h.x, h.z); }
        for (const e of enemies) if (!e.dead && Math.hypot(e.x - h.x, e.z - h.z) < 1.4) { e.poison = 2; e.poisonDps = Math.max(e.poisonDps || 0, 8 + G.floor * 2); }
      }
      h.state = st;
    } else if (h.kind === 'lava') {
      h.glow.material.opacity = 0.3 + Math.sin(G.time * 3 + h.x) * 0.1;
      if (Math.random() < 0.04) spark(h.x + rr(-0.4, 0.4), 0.05, h.z + rr(-0.4, 0.4), 0xff8a2a, { vy: 1.6, s: 0.2, life: 0.6, drag: 0 });
      if (onFloor && pi === h.i && pj === h.j) damagePlayer(1, h.x, h.z + 0.01);
      for (const e of enemies) if (!e.dead && !e.d.fly && e.y < 0.3 && Math.floor(e.x) === h.i && Math.floor(e.z) === h.j && (e.lavaCd || 0) < G.time) { e.lavaCd = G.time + 0.5; hurtEnemyRaw(e, 10 + G.floor * 2, '#ff8a2a'); }
    }
  }
}
function addBarrel(x, z) {
  const m = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xa8231c, emissive: 0x220000 }));
  m.scale.set(0.5, 0.62, 0.5); m.position.set(x, 0, z); m.castShadow = true;
  for (const y of [0.22, 0.75]) { const b = new THREE.Mesh(boxGeo, ironMat); b.scale.set(1.06, 0.1, 1.06); b.position.y = y; m.add(b); }
  const top = new THREE.Mesh(boxGeo, new THREE.MeshBasicMaterial({ color: 0xffb020 })); top.scale.set(0.3, 0.05, 0.3); top.position.y = 1; m.add(top);
  scene.add(m); pots.push({ x, z, mesh: m, barrel: true });
}
function addPot(x, z) {
  const m = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0xa8643c }));
  m.scale.set(0.42, 0.5, 0.42); m.position.set(x, 0, z); m.castShadow = true; m.rotation.y = Math.random();
  const lid = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x6e3a22 })); lid.scale.set(0.7, 0.16, 0.7); lid.position.y = 1; m.add(lid);
  scene.add(m); pots.push({ x, z, mesh: m });
}

// ---------- room flow ----------
function roomAt(x, z) {
  const gx = Math.floor(x / SX), gy = Math.floor(z / SZ);
  if (gx < 0 || gy < 0 || gx >= GW || gy >= GH) return null;
  const r = roomGrid[gy * GW + gx];
  if (!r) return null;
  const lx = x - r.x0, lz = z - r.z0;
  return lx > 1.2 && lx < r.w + 0.8 && lz > 1.2 && lz < r.h + 0.8 ? r : null;
}
function enterRoom(r) {
  G.curRoom = r;
  r.visited = true; r.seen = true;
  for (const o of r.links) o.seen = true;
  r.flames.slice(0, 4).forEach((f, k) => { const nx = k < 2 ? 0 : k === 2 ? 0.6 : -0.6, nz = k < 2 ? 0.6 : 0; torchLights[k].position.set(f.position.x + nx, f.position.y + 0.3, f.position.z + nz); });
  if (!r.lit) {
    r.lit = true;
    for (const f of r.flames) { f.visible = true; f.userData.core.visible = true; f.userData.flare = 1; burst(f.position.x, f.position.y, f.position.z, 0xffa040, 6, 2, 0.3, 0.4); }
    sfx('fire');
  }
  if (!r.cleared && !r.active) {
    r.active = true; r.fightT = G.run.time;
    lockRoom(r, true);
    G.waveDelay = 0.6;
    if (r.type === 'boss') { banner('BOSS LAIR', 'SURVIVE THE WAVES. SOMETHING IS COMING'); }
    if (r.type === 'challenge') { banner('CHALLENGE', 'ELITES GUARD A GOLDEN CHEST'); }
    if (r.variant === 'swarm') { r.waves = 0; G.swarm = { room: r, t: 20 + Math.min(10, G.floor), spawnT: 0.6 }; banner('SURVIVE', `${Math.round(G.swarm.t)} SECONDS`); sfx('wave'); }
    if (r.variant === 'dark') { G.dark = r; r.lit = true; for (const f of r.flames) { f.visible = false; f.userData.core.visible = false; } banner('DARKNESS', 'THE TORCHES DIE'); sfx('moan'); }
    if (r.variant === 'traps') banner('TRAP ROOM', 'MIND THE FLOOR');
  }
}
// vertical gradient with faint scanlines: bright at the floor, fading upward
const veilTex = canvasTex(16, 64, (g) => {
  const grd = g.createLinearGradient(0, 64, 0, 0); grd.addColorStop(0, 'rgba(255,255,255,.9)'); grd.addColorStop(0.5, 'rgba(255,255,255,.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 16, 64);
  g.fillStyle = 'rgba(255,255,255,.25)'; for (let y = 2; y < 64; y += 6) g.fillRect(0, y, 16, 1);
});
veilTex.magFilter = THREE.LinearFilter;
function lockRoom(r, on) {
  for (const d of r.doors) for (const [i, j] of d.cells) map[j * MW + i] = on ? BAR : FLOOR;
  if (on) {
    sfx('lock'); addShake(0.25);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.85 });
    for (const d of r.doors) for (const [i, j] of d.cells) {
      for (let k = 0; k < 3; k++) {
        const b = new THREE.Mesh(boxGeo, mat);
        const off = (k - 1) * 0.3;
        b.position.set(i + 0.5 + (d.axis === 'z' ? off : 0), 0, j + 0.5 + (d.axis === 'x' ? off : 0));
        b.scale.set(0.09, 0.01, 0.09); b.userData.t = 0; scene.add(b); barriers.push(b);
      }
      spark(i + 0.5, 0.3, j + 0.5, 0xff4fd8, { vy: 3, s: 0.6, life: 0.6 });
    }
    // a glowing energy wall across each doorway: a soft additive veil plus a glow halo at its centre
    for (const d of r.doors) {
      const cx = d.cells.reduce((a, c) => a + c[0] + 0.5, 0) / d.cells.length, cz = d.cells.reduce((a, c) => a + c[1] + 0.5, 0) / d.cells.length;
      const veil = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 1.3).translate(0, 0.65, 0), new THREE.MeshBasicMaterial({ map: veilTex, color: 0xff4fd8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      veil.position.set(cx, 0, cz); if (d.axis === 'x') veil.rotation.y = Math.PI / 2;
      veil.userData = { t: 0, veil: true }; scene.add(veil); barriers.push(veil);
      const g = makeGlow(0xff4fd8, 3.2, 0); g.position.set(cx, 0.7, cz); g.userData = { t: 0, halo: true }; barriers.push(g);
    }
  } else {
    for (const b of barriers) { if (!b.userData.veil && !b.userData.halo) burst(b.position.x, 0.6, b.position.z, 0xff4fd8, 3, 3, 0.25, 0.5); scene.remove(b); if (b.userData.veil || b.userData.halo) b.material.dispose(); }
    barriers = [];
  }
}
function spawnWave(r) {
  const fl = G.floor;
  const bossNow = r.type === 'boss' && r.waves === 1; // the boss arrives together with the final wave
  if (bossNow) { portals.push(makePortal(r.cx, r.cz - 2, G.boss.type, 1.6, 0.6)); sfx('lock'); addShake(0.5); flash(0.3); }
  const pool = [['slime', 3]];
  if (fl >= 1) pool.push(['eye', 1.6]);
  if (fl >= 2) pool.push(['imp', 2.2]);
  if (fl >= 2) pool.push(['bomber', 1.3], ['shroom', 0.9]);
  if (fl >= 3) pool.push(['skeleton', 1.6], ['big', 0.8], ['ghost', 1.3]);
  if (fl >= 4) pool.push(['golem', 0.8]);
  if (fl >= 6) pool.push(['skeleton', 1], ['big', 0.6]);
  const total = pool.reduce((a, b) => a + b[1], 0);
  let n = Math.floor(3 + fl * 0.8 + rand() * 2 + (r.type === 'exit' ? 2 : 0));
  n = Math.min(Math.round(n * (1 + Math.min(0.6, fl * 0.04)) * Math.max(1, G.adapt || 1)), 32);
  const pts = [];
  for (let k = 0; k < n; k++) {
    let roll = rand() * total, type = pool[0][0];
    for (const [t, w] of pool) { if ((roll -= w) <= 0) { type = t; break; } }
    let x, z, tries = 0;
    do { x = r.x0 + 1.5 + rand() * (r.w - 1); z = r.z0 + 1.5 + rand() * (r.h - 1); tries++; }
    while (tries < 30 && (cellAt(x, z) !== FLOOR || Math.hypot(x - player.x, z - player.z) < 3.5 || pts.some((p) => Math.hypot(p[0] - x, p[1] - z) < 1)));
    pts.push([x, z]);
    if (type === 'imp' && rand() < 0.6) { for (let q = 0; q < 2; q++) portals.push(makePortal(x + rr(-0.6, 0.6), z + rr(-0.6, 0.6), 'imp', 0.6, k * 0.12)); }
    else {
      const elite = fl >= 2 && rand() < Math.min(0.45, 0.05 * fl + (r.type === 'challenge' ? 0.3 : 0));
      const pt = makePortal(x, z, type, type === 'big' || type === 'golem' ? 1.0 : 0.7, k * 0.12);
      if (elite) { pt.elite = true; pt.mesh.children[0].material.color.set(0xffc84f); }
      portals.push(pt);
    }
  }
  if (r.champ && !r.champ.spawned && r.waves === 1) { // the champion arrives with the final wave
    r.champ.spawned = true;
    const pt = makePortal(r.cx, r.z0 + 3, r.champ.type, 1.4, 0.4); pt.elite = true; pt.champ = r.champ; pt.mesh.children[0].material.color.set(0xff3050);
    portals.push(pt);
  }
  r.waves--;
  sfx('portal');
  if (bossNow) { banner(G.boss.name, 'FINAL WAVE'); bannerT = 2.2; }
  else if (r.totalWaves > 1) { banner(r.waves === 0 ? 'FINAL WAVE' : `WAVE ${r.totalWaves - r.waves}`, ''); bannerT = 1; sfx('wave'); }
}
// feathered rings (soft falloff on both sides of the rim) instead of hard-edged flat ring geometry
function ringTexture(stops) {
  const t = canvasTex(128, 128, (g) => {
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    for (const [o, a] of stops) grd.addColorStop(o, `rgba(255,255,255,${a})`);
    g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  });
  t.magFilter = THREE.LinearFilter;
  return t;
}
const softRingTex = ringTexture([[0, 0], [0.45, 0], [0.72, 0.35], [0.86, 1], [0.93, 0.45], [1, 0]]);
const markTex = ringTexture([[0, 0.14], [0.6, 0.2], [0.8, 0.55], [0.9, 0.9], [0.96, 0.35], [1, 0]]);
const flatRingGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
const portalGeo = flatRingGeo;
const crackGeo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
function makePortal(x, z, type, size, delay = 0) {
  const mesh = new THREE.Mesh(crackGeo, new THREE.MeshBasicMaterial({ map: splatTex, color: 0x000000, transparent: true, opacity: 0.92, depthWrite: false }));
  const glow = new THREE.Mesh(portalGeo, new THREE.MeshBasicMaterial({ map: softRingTex, color: 0x8a2aff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.position.y = 0.01; glow.scale.setScalar(0.55); mesh.add(glow);
  mesh.rotation.y = Math.random() * 6; mesh.position.set(x, 0.03, z); mesh.scale.setScalar(0.01); scene.add(mesh);
  mesh.material.color.userData = glow;
  return { x, z, type, size, t: 0, dur: 0.9 + delay, delay, mesh };
}
function updateSwarm(r, dt) {
  const sw = G.swarm;
  sw.t -= dt; sw.spawnT -= dt;
  if (sw.t > 0) {
    if (sw.spawnT <= 0 && enemies.length + portals.length < (BENCH ? 40 : Math.min(40, Math.round((16 + G.floor) * Math.max(1, G.adapt || 1))))) {
      sw.spawnT = BENCH ? 0.08 : Math.max(0.22, 0.75 - G.floor * 0.04) / Math.max(1, G.adapt || 1);
      const pool = ['slime', 'slime', 'eye'].concat(G.floor >= 2 ? ['imp', 'imp', 'bomber'] : []);
      for (let k = 0; k < ri(1, 2); k++) {
        let x, z, tries = 0;
        do { x = r.x0 + 1.5 + rand() * (r.w - 1); z = r.z0 + 1.5 + rand() * (r.h - 1); } while (++tries < 20 && (cellAt(x, z) !== FLOOR || Math.hypot(x - player.x, z - player.z) < 3.5));
        const pt = makePortal(x, z, pick(pool), 0.6, k * 0.1); pt.weak = true; portals.push(pt);
      }
    }
    return;
  }
  // time's up: everything left pops, one after another
  G.swarm = null;
  for (const pt of portals) { scene.remove(pt.mesh); pt.mesh.material.dispose(); }
  portals = [];
  enemies.filter((e) => !e.dead).forEach((e, k) => later(k * 0.05, () => { if (!e.dead) { e.hp = 0; killEnemy(e); } }));
  banner('SURVIVED', ''); // the fanfare plays in clearRoom once the last one pops
}
// Adaptive difficulty: a fight cleared faster than the target pushes G.adapt up, a slow one pulls it down. It moves a
// little per room and stays inside 0.8-2x (1.3x on the easy floors 1-10). More of it means more monsters first, then HP.
// how much faster you kill thanks to gear and permanent upgrades (stat buys, legacy, victories, Power, Haste)
function metaEdge() {
  const p = player, st = {};
  for (const k of STATS) st[k] = (p.hero.base[k] || 0) + (p.alloc[k] || 0) - ((p.metaAlloc || {})[k] || 0);
  const base = derive(p.hero.cls, st), full = p.der, g = p.g;
  const fullOut = full.dmg * g.dmg * (1 + 0.08 * mlv('pow')) / (full.cd * g.cd * Math.pow(0.95, mlv('haste')));
  return Math.max(1, fullOut / (base.dmg / base.cd));
}
function adaptAfter(r) {
  if (r.fightT == null || !(r.type === 'combat' || r.type === 'exit' || r.type === 'challenge') || r.variant === 'swarm') return;
  // the clock is scaled by your gear + permanent-upgrade edge, so the game reacts to your base build and those stay an advantage
  const took = Math.max(1, G.run.time - r.fightT) * metaEdge(), target = 14 + 3 * r.totalWaves; // seconds a fair fight should last
  const step = clamp(Math.pow(target / took, 0.35), 0.88, 1.15);
  G.adapt = clamp((G.adapt || 1) * step, 0.8, G.floor <= 10 ? 1.3 : 2);
}
// An interstitial on the way down the stairs, while the screen is faded out: at most one per 2.5 minutes of play, never
// on a player's very first run, never with Remove Ads.
function floorAdDue() {
  if (AUTO || BENCH || Monet.adsRemoved || (meta.stats.runs || 0) < 1) return false;
  if (G.run.time - (G.run.lastAdT ?? -999) < 150) return false;
  G.run.lastAdT = G.run.time; return true;
}
function clearRoom(r) {
  r.cleared = true; r.active = false; adaptAfter(r);
  G.saveDue = true; G.pendT = G.run.time; // checkpoint once the room's reward pick (if any) is done
  if (G.dark === r) { G.dark = null; for (const f of r.flames) { f.visible = true; f.userData.core.visible = true; } }
  lockRoom(r, false);
  const big = r.type === 'boss' || r.champDrop || r.variant === 'swarm'; // the full fanfare is kept for boss, champion and survive rooms
  flash(0.15); sfx(big ? 'clear' : 'cleared'); if (big) addShake(0.2); // the card screen that follows says ROOM CLEARED
  for (const f of r.flames || []) { f.userData.flare = 1; burst(f.position.x, f.position.y, f.position.z, 0xffa040, 10, 3, 0.3, 0.6); }
  fxLight.position.set(r.cx, 2.5, r.cz); fxLight.intensity = 60;
  if (r.type === 'boss' && G.floor === WIN_FLOOR) { later(1.4, () => showVictory()); return; }
  if (r.type === 'exit' || r.type === 'boss') spawnStairs(r);
  if (r.type === 'challenge') { addGoldChest(r); burst(r.cx, 0.6, r.cz, 0xffd34f, 30, 5, 0.5, 0.7); }
  for (let k = 0; k < 3 + Math.floor(G.floor / 2); k++) dropPickup(r.cx + rr(-1, 1), r.cz + rr(-1, 1), 'coin');
  if (player.hp < player.maxHp && rand() < 0.05) dropPickup(r.cx, r.cz, 'heart');
  const champ = r.champDrop, bsId = G.bossSpell; G.bossSpell = null;
  if (bsId) later(0.9, () => { if (G.state === 'play') openCards('BOSS SPELL', [bossSpellCard(bsId)].concat(upgradeOptions().slice(0, 2))); });
  else if (r.mimic || champ) later(0.9, () => { if (G.state === 'play') { G.rerollFn = () => upgradeOptions(); G.rerolled = false; openCards(r.mimic ? 'MIMIC SLAIN' : 'CHAMPION SLAIN', relicOptions(2).concat(upgradeOptions().slice(0, 1))); } });
  else if (r.type === 'exit') later(0.9, () => { if (G.state === 'play') { G.rerollFn = () => upgradeOptions(); G.rerolled = false; openCards('FLOOR CLEARED', upgradeOptions()); } });
  // ordinary rooms only drop loot: power-up picks come from level ups, floor clears, champions, bosses and treasure
  r.mimic = false; r.champDrop = false;
}
function addGoldChest(r) {
  const chest = makeSprite('items', 1.1, 4); chest.position.set(r.cx, 0.08, r.cz);
  chest.material.uniforms.uTint.value.set(0xffe08a);
  props.push({ kind: 'chest', gold: true, room: r, x: r.cx, z: r.cz, mesh: chest, glow: makeGlowAt(r.cx, 0.5, r.cz, 0xffd34f, 2.6, 0.45) });
}
function spawnStairs(r) {
  const group = new THREE.Group();
  const hole = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.05, 1.6), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  hole.position.y = 0.03; group.add(hole);
  for (let k = 0; k < 4; k++) {
    const step = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: G.pal.cap }));
    step.scale.set(1.6 - k * 0.3, 0.06, 0.3); step.position.set(0, 0.04, -0.6 + k * 0.32); group.add(step);
  }
  group.position.set(r.cx, 0, r.cz); scene.add(group);
  const ring = new THREE.Mesh(portalGeo, new THREE.MeshBasicMaterial({ map: softRingTex, color: 0xff4fd8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  ring.position.set(r.cx, 0.06, r.cz); ring.scale.setScalar(1.1); ring.material.opacity = 0.6; scene.add(ring);
  props.push({ kind: 'stairs', x: r.cx, z: r.cz, group, ring, glow: makeGlowAt(r.cx, 0.3, r.cz, 0xff4fd8, 1.8, 0.22) });
  burst(r.cx, 0.5, r.cz, 0xff4fd8, 40, 6, 0.5, 0.9);
}
function nextFloor() {
  if (G.state !== 'play') return;
  G.state = 'trans'; sfx('stairs');
  $('fade').style.opacity = 1;
  later(0.55, () => {
    for (const p of props) if (p.ring) scene.remove(p.ring);
    G.floor++;
    startFloor(G.floor); checkpoint();
    if (floorAdDue()) { G.state = 'ad'; Monet.interstitial('next_floor').then(() => { if (G.state === 'ad') G.state = 'play'; }); }
    else G.state = 'play';
  });
}

// ---------- enemies ----------
function spawnEnemy(type, x, z, elite = false) {
  const d = ENEMY[type], fl = G.floor;
  const hpMul = (1 + (G.curse || 0)) * Math.pow(1.33, fl - 1) * (elite ? 3 : 1) * Math.sqrt(G.adapt || 1); // grows as fast as your build does
  const sheet = d.sheet || type;
  const h = (d.h || SPRITE_H[sheet]) * (elite ? 1.35 : 1);
  const e = {
    type, x, z, vx: 0, vz: 0, kx: 0, kz: 0, y: 0, r: d.r, hp: d.hp * hpMul, maxHp: d.hp * hpMul, d,
    speed: d.speed * (1 + Math.min(0.6, fl * 0.035)), t: rand() * 2, state: 'idle', st: rr(0.2, 0.8), flash: 0, slow: 0, freeze: 0, poison: 0, poisonDps: 0, stun: 0,
    face: 1, spawn: 0, anim: rand() * 4, mesh: makeSprite(sheet, h, d.frame || 0), shadow: makeShadow(d.r * 2.3), hits: new Map(), shots: 0, jumps: 0,
  };
  e.isBoss = BOSSES.some((b) => b.type === type);
  if (e.isBoss && G.floor === WIN_FLOOR) { e.hp *= 2; e.maxHp = e.hp; e.mesh.userData.bw *= 1.2; e.mesh.userData.bh *= 1.2; }
  if (e.isBoss) { e.state = type === 'boss' ? 'wait' : 'idle'; e.st = 1.2; $('bossname').textContent = G.boss.name; $('bossbar').classList.remove('hidden'); }
  if (G.still > 0) e.freeze = G.still; // born into stopped time
  if (elite) { e.elite = true; e.r *= 1.25; e.shadow.scale.multiplyScalar(1.25); const el = pick(ELEMENT_ORDER); e.affinity = { [el]: 0.25 }; e.affColor = new THREE.Color(ELEMENTS[el].color).getHex(); }
  if (type === 'ghost' || type === 'golem' || type === 'shroom') e.st = rr(1, 2);
  e.mesh.position.set(x, 0, z);
  enemies.push(e);
  return e;
}
function nearestEnemy(x, z, range, exclude) {
  let best = null, bd = range;
  for (const e of enemies) {
    if (e.spawn < 0.3 || e.dead || e.hidden || (exclude && exclude.has(e))) continue;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
}
function hurtEnemy(e, dmg, kx = 0, kz = 0, kb = 3, color = 0xffffff, els = null) {
  if (e.dead) return;
  const g = player.g, der = player.der;
  let crit = false, tag = '';
  dmg *= player.dmgMul * g.dmg * der.dmg;
  if (els && els.length) {
    if (g.flags.prism && Math.random() < 0.5) els = els.concat([pick(ELEMENT_ORDER)]);
    const res = resistOf(e.type, els, e.affinity);
    let ep = 0; for (const el of els) ep += (player.elPow[el] || 1) * (g.el[el] || 1);
    dmg *= res * ep / els.length;
    if (els.includes('holy') && UNDEAD.has(e.type)) dmg *= 2;
    tag = res === 0 ? 'IMMUNE' : res < 0.8 ? 'RESIST' : res > 1.2 ? 'WEAK' : '';
    if (els.includes('earth')) kb *= 1.8;
    e.lastEls = els;
  }
  if (e.shock > 0) dmg *= 1 + (e.shockAmt || 0.25);
  if (e.curse > 0) dmg *= 1.15;
  if (e.type === 'golem' && e.state === 'stun') dmg *= 1.5;
  if (dmg > 0 && Math.random() < player.crit + g.crit + der.crit + (els && els.includes('arcane') ? 0.1 : 0)) { dmg *= player.critDmg + g.critDmg + der.critDmg; crit = true; }
  G.run.dmg += Math.min(dmg, Math.max(0, e.hp)); e.hp -= dmg; e.flash = 1;
  const kmul = e.isBoss || e.type === 'shroom' ? 0.05 : e.type === 'golem' ? 0.15 : e.type === 'big' || e.elite ? 0.4 : 1;
  const kl = Math.hypot(kx, kz) || 1;
  e.kx += kx / kl * kb * kmul; e.kz += kz / kl * kb * kmul;
  e.squash = 0.25;
  const ty = 1.1 + (e.isBoss ? 2 : 0);
  if (tag === 'IMMUNE') addText(e.x, ty, e.z, 'IMMUNE', '#8a8aa0', 0.9);
  else addText(e.x, ty, e.z, Math.round(dmg) + (tag === 'WEAK' ? '!' : ''), crit ? '#ffe14f' : tag === 'WEAK' ? '#ffb43a' : tag === 'RESIST' ? '#a0a0b8' : '#ffffff', crit ? 1.5 : tag === 'WEAK' ? 1.2 : 1);
  spark(e.x, 0.5, e.z, color, { s: 0.5, life: 0.15, drag: 0 });
  for (let k = 0; k < 3; k++) spark(e.x, 0.5, e.z, color, { vx: kx / kl * rr(3, 7), vz: kz / kl * rr(3, 7), vy: rr(0.5, 2.5), s: 0.22, life: 0.25, drag: 5, spread: 2 });
  if (Math.random() < 0.35) splat(e.x + rr(-0.3, 0.3), e.z + rr(-0.3, 0.3), e.d.splat, rr(0.3, 0.6));
  if (els && dmg > 0) applyStatus(e, els, dmg);
  if (els && els.includes('frost') && ccMul(e) < 0.6 && Math.random() < 0.15) addText(e.x, ty + 0.4, e.z, 'TOUGH', '#9fe7ff', 0.7);
  if (player.hero.id === 'necro' && dmg > 0) { e.curse = 4; e.curseDmg = Math.max(e.curseDmg || 0, dmg * 1.2 * der.status); }
  sfx('hit');
  if (e.hp <= 0) killEnemy(e, kx, kz);
}
function killEnemy(e, kx = 0, kz = 0) {
  e.dead = true; killMarker(e);
  const lockedRoom = rooms.find((q) => q.active);
  if (lockedRoom && lockedRoom.waves <= 0 && portals.length === 0 && enemies.every((o) => o.dead || o === e) && G.state === 'play') {
    // slow-motion finisher only for bosses; ordinary rooms just get a short freeze-frame
    if (e.isBoss) G.finisher = { x: e.x, z: e.z, t: 0.85 };
    G.hitstop = e.isBoss ? 0.1 : 0.08; flash(0.35); addShake(0.5);
  }
  G.kills++; G.combo++; G.comboT = 2.6; G.comboPop = 1;
  G.run.kills++; G.run.bestCombo = Math.max(G.run.bestCombo, G.combo); if (e.isBoss) G.run.bosses++; if (e.name) G.run.champs++;
  const pg = player.g;
  if (e.curse > 0) { // cursed foes burst and hurt their friends
    const R = (pg.flags.shroud ? 4 : 2) * (player.hero.id === 'necro' ? 1.3 : 1), cd = e.curseDmg;
    addRing(e.x, e.z, 0.3, R, 0.35, 0xa35cff); burst(e.x, 0.6, e.z, 0xa35cff, 16, 5, 0.4, 0.5);
    later(0.05, () => { for (const o of [...enemies]) if (!o.dead && o !== e && Math.hypot(o.x - e.x, o.z - e.z) < R + o.r) hurtEnemyRaw(o, cd, '#c48cff'); });
  }
  if (pg.flags.cinders && e.burn > 0) { const bd = (e.burnDps || 10) * 4; later(0.05, () => explode({ x: e.x, z: e.z, aoe: 1.6, dmg: bd, els: ['fire'], color: 0xff7a1a })); }
  if (pg.flags.lich && G.run.kills % 15 === 0 && player.hp < player.maxHp) { player.hp++; addText(player.x, 1.5, player.z, '+', '#ff6a8a', 1); renderHearts(); }
  if (pg.flags.ouro) for (const sp of spells) sp.t -= 0.1;
  if (e.lastEls && e.lastEls.includes('holy') && Math.random() < 0.01 && player.hp < player.maxHp) dropPickup(e.x, e.z, 'heart');
  gainXp(e.isBoss ? 60 : e.name ? 25 : e.elite ? 6 : e.type === 'big' || e.type === 'golem' ? 2 : 1);
  const luck = pg.luck + player.der.loot;
  if (e.isBoss) { dropGear(e.x, e.z, 2); dropGear(e.x, e.z, 2); bossReward(e); }
  else if (e.name) dropGear(e.x, e.z, 1);
  // gear: 2% from big monsters (elites, big slimes, golems), 0.05% from the rest; luck still helps
  else if (Math.random() < (e.elite || e.type === 'big' || e.type === 'golem' ? 0.02 : 0.0005) * (1 + luck)) dropGear(e.x, e.z, 0);
  const d = e.d, big = e.isBoss ? 4 : e.type === 'big' ? 1.6 : 1;
  splat(e.x, e.z, d.splat, rr(1.0, 1.5) * big);
  for (let k = 0; k < 3 * big; k++) splat(e.x + rr(-0.8, 0.8) * big, e.z + rr(-0.8, 0.8) * big, d.splat, rr(0.3, 0.7));
  chunk(e.x, 0.5, e.z, d.chunk, Math.round(7 * big), 5 * Math.sqrt(big), 0.13);
  burst(e.x, 0.5, e.z, d.chunk, Math.round(14 * big), 5, 0.4, 0.5);
  spark(e.x, 0.6, e.z, 0xffffff, { s: 1.4 * big, life: 0.12, drag: 0 });
  addShake(e.isBoss ? 1 : 0.12 * big);
  G.hitstop = Math.max(G.hitstop, e.isBoss ? 0.25 : 0.035 * big);
  sfx(e.isBoss ? 'slam' : 'kill');
  if (Math.random() < (e.elite ? 1 : d.coin * 0.6)) for (let k = 0; k < (e.isBoss ? 25 : e.type === 'big' || e.type === 'golem' ? 3 : 1) * (e.elite ? 4 : 1); k++) dropPickup(e.x, e.z, 'coin');
  if (e.type === 'bomber') enemyBlast(e.x, e.z, 1.9, false);
  // hearts only drop when you're hurt: 5% from big monsters (elites, big slimes, golems), 0.5% from the rest
  if (player.hp < player.maxHp && Math.random() < (e.elite || e.type === 'big' || e.type === 'golem' ? 0.05 : 0.005)) dropPickup(e.x, e.z, 'heart');
  if (e.type === 'big') for (let k = 0; k < 2; k++) { const s = spawnEnemy('slime', e.x + (k ? 0.5 : -0.5), e.z); s.spawn = 1; s.hp *= 0.6; s.state = 'jump'; s.st = 0.4; s.jx = (k ? 1 : -1) * 3; s.jz = 0; }
  if (e.isBoss) { flash(0.6); $('bossbar').classList.add('hidden'); }
  if (e.name) {
    $('bossbar').classList.add('hidden'); $('bossname').textContent = 'KING GLOOP';
    const r = rooms.find((q) => q.active); if (r) r.champDrop = true;
    for (let k = 0; k < 12; k++) dropPickup(e.x, e.z, 'coin');
    dropPickup(e.x, e.z, 'heart'); toast(e.name.toUpperCase(), 'has fallen');
  }
  const gh = makeSprite(e.d.sheet || e.type, e.mesh.userData.bh);
  gh.material.transparent = true; gh.material.uniforms.uFlash.value = 1; gh.material.uniforms.uFlip.value = e.face < 0 ? 1 : 0;
  gh.position.copy(e.mesh.position); gh.quaternion.copy(camera.quaternion);
  texts.push({ ghost: gh, life: 0.16, max: 0.16, grow: true });
  killMesh(e.mesh); scene.remove(e.shadow);
}
function enemyShoot(e, ang, speed = 5, color = 0xb05cff, size = 0.9, homing = 0) {
  const p = { x: e.x + Math.cos(ang) * 0.4, z: e.z + Math.sin(ang) * 0.4, vx: Math.cos(ang) * speed, vz: Math.sin(ang) * speed, r: 0.22, life: 6, color, glow: makeGlow(color, size * 0.8, 0.8), homing };
  p.mesh = makeProjMesh('orb', color); p.shadow = makeShadow(0.45); placeProj(p, 0.55, 0);
  eprojs.push(p);
}

function updateEnemy(e, dt) {
  const d = e.d;
  e.spawn = Math.min(1, e.spawn + dt * 2.2);
  e.flash = Math.max(0, e.flash - dt * 7);
  e.squash = Math.max(0, (e.squash || 0) - dt * 2.5);
  if (e.poison > 0) { e.poison -= dt; e.poisonTick = (e.poisonTick || 0) - dt; if (e.poisonTick <= 0) { e.poisonTick = 0.5; hurtEnemyRaw(e, e.poisonDps * 0.5, '#7dff6a'); spark(e.x, 0.7, e.z, 0x7dff6a, { vy: 1.5, s: 0.35, life: 0.6 }); } if (e.poison <= 0) { e.pstacks = 0; e.poisonDps = 0; } }
  if (e.burn > 0) { e.burn -= dt; e.burnTick = (e.burnTick || 0) - dt; if (e.burnTick <= 0) { e.burnTick = 0.5; hurtEnemyRaw(e, e.burnDps * 0.5, '#ff9a4a'); spark(e.x, 0.8, e.z, 0xff7a1a, { vy: 2, s: 0.35, life: 0.4 }); } if (e.burn <= 0) e.burnDps = 0; }
  if (e.shock > 0) { e.shock -= dt; if (Math.random() < 0.12) spark(e.x + rr(-0.3, 0.3), 0.5 + Math.random() * 0.6, e.z, 0xfff36a, { s: 0.25, life: 0.1, drag: 0 }); }
  if (e.curse > 0) { e.curse -= dt; if (Math.random() < 0.08) spark(e.x, 1.1, e.z, 0xa35cff, { vy: 0.6, s: 0.3, life: 0.5 }); }
  if (e.dead) return;
  let sm = e.slow > 0 ? 1 - (e.slowAmt || 0.5) : 1;
  if (e.slow <= 0) e.slowAmt = 0;
  e.slow -= dt;
  if (e.freeze > 0 || e.stun > 0) { e.freeze -= dt; e.stun -= dt; sm = 0; }
  const edt = dt * sm;
  e.t += edt; e.st -= edt;
  const dx = player.x - e.x, dz = player.z - e.z, dist = Math.hypot(dx, dz) || 1, ux = dx / dist, uz = dz / dist;
  let mx = 0, mz = 0, sx = 1, sy = 1, tilt = 0;
  e.noContact = false;
  switch (e.type) {
    case 'slime': case 'big': case 'mimic': {
      if (e.state === 'idle' || e.state === 'wait') {
        const k = 1 - clamp(e.st / 0.5, 0, 1); sx = 1 + 0.3 * k + Math.sin(e.t * 9) * 0.03; sy = 1 - 0.3 * k - Math.sin(e.t * 9) * 0.03; e.y = 0;
        if (e.st <= 0) { e.state = 'jump'; e.st = 0.5; const lead = 0.12; e.jx = (dx + player.vx * lead) / 0.5; e.jz = (dz + player.vz * lead) / 0.5; const jl = Math.hypot(e.jx, e.jz); const mxs = e.type === 'big' ? 2.6 : e.type === 'mimic' ? 5 : 3.2; if (jl > mxs) { e.jx *= mxs / jl; e.jz *= mxs / jl; } }
      } else {
        const p = 1 - e.st / 0.5; e.y = Math.sin(p * Math.PI) * (e.type === 'big' ? 0.7 : 0.55);
        sx = p < 0.5 ? 0.78 : 0.9; sy = p < 0.5 ? 1.3 : 1.12; tilt = -Math.sign(e.jx || 1) * 0.15 * Math.sin(p * Math.PI); mx = e.jx; mz = e.jz; e.noContact = e.y > 0.35;
        if (e.st <= 0) {
          e.state = 'wait'; e.st = e.type === 'mimic' ? rr(0.3, 0.5) : rr(0.45, 0.9); e.y = 0; e.squash = 0.5; chunkDust(e.x, e.z, 0xff6fc4); if (e.type === 'big') addShake(0.08);
          if (e.type === 'mimic' && ++e.jumps % 3 === 0) { addShake(0.25); sfx('slam'); for (let k = 0; k < 10; k++) enemyShoot(e, k / 10 * Math.PI * 2, 4.2, 0xffd34f, 0.8); }
        }
      }
      break;
    }
    case 'eye': {
      e.y = 0.55 + Math.sin(e.t * 3) * 0.12;
      const flap = Math.sin(e.t * 16); sx = 1 + flap * 0.12; sy = 1 - flap * 0.06; tilt = Math.sin(e.t * 2.3) * 0.12;
      const want = 4.6;
      const tang = Math.sin(e.t * 0.7 + e.anim) > 0 ? 1 : -1;
      mx = (ux * (dist - want) * 0.8 - uz * tang * 1.2); mz = (uz * (dist - want) * 0.8 + ux * tang * 1.2);
      const ml = Math.hypot(mx, mz); if (ml > e.speed) { mx *= e.speed / ml; mz *= e.speed / ml; }
      if (e.state === 'idle' && e.st <= 0 && dist < 9) { e.state = 'charge'; e.st = 0.6; sfx('spit'); }
      if (e.state === 'charge') {
        mx *= 0.2; mz *= 0.2;
        e.chargeK = 1 - e.st / 0.6; sx = 1 + e.chargeK * 0.25; sy = 1 + e.chargeK * 0.25; tilt = 0;
        if (Math.random() < 0.5) spark(e.x + ux * 0.35, e.y + 0.45, e.z + uz * 0.35, 0xb05cff, { s: 0.3 + e.chargeK * 0.4, life: 0.15, drag: 0 });
        if (e.st <= 0) {
          const a = Math.atan2(dz, dx);
          const n = G.floor >= 4 ? 3 : 1;
          for (let k = 0; k < n; k++) enemyShoot(e, a + (k - (n - 1) / 2) * 0.28, 4.6 + G.floor * 0.15);
          e.state = 'idle'; e.st = rr(1.8, 2.8); e.squash = 0.4; e.chargeK = 0;
        }
      }
      break;
    }
    case 'imp': {
      tilt = Math.sin(e.t * 18) * 0.22; e.y = Math.abs(Math.sin(e.t * 18)) * 0.08;
      if (e.state === 'idle') {
        const wob = Math.sin(e.t * 5 + e.anim * 3) * 0.6;
        mx = (ux - uz * wob) * e.speed; mz = (uz + ux * wob) * e.speed;
        if (dist < 2.6 && e.st <= 0) { e.state = 'wind'; e.st = 0.32; e.lx = ux; e.lz = uz; }
      } else if (e.state === 'wind') {
        sx = 1.2; sy = 0.78; tilt = -e.face * 0.25; e.y = 0; e.shake = 0.06;
        if (e.st <= 0) { e.state = 'lunge'; e.st = 0.22; sfx('whoosh'); }
      } else if (e.state === 'lunge') {
        mx = e.lx * 11; mz = e.lz * 11; sx = 1.35; sy = 0.75; tilt = e.face * 0.45;
        if (Math.random() < 0.8) spark(e.x, 0.4, e.z, 0x6a2a7a, { s: 0.4, life: 0.3 });
        if (e.st <= 0) { e.state = 'idle'; e.st = rr(1, 1.6); }
      }
      break;
    }
    case 'skeleton': {
      tilt = Math.sin(e.t * 9) * 0.14; e.y = Math.abs(Math.sin(e.t * 9)) * 0.06;
      if (e.state === 'idle') {
        mx = ux * e.speed; mz = uz * e.speed;
        if (dist < 1.8 && e.st <= 0) { e.state = 'wind'; e.st = 0.5; e.lx = ux; e.lz = uz; }
      } else if (e.state === 'wind') {
        e.shake = 0.04; e.tint = 1 - e.st / 0.5; tilt = -e.face * 0.35 * e.tint; e.y = 0; sy = 1 + e.tint * 0.12;
        if (e.st <= 0) { e.state = 'lunge'; e.st = 0.18; e.tint = 0; }
      } else if (e.state === 'lunge') {
        mx = e.lx * 9; mz = e.lz * 9; sx = 1.2; sy = 0.9; tilt = e.face * 0.5;
        if (e.st <= 0) { e.state = 'idle'; e.st = rr(1.2, 1.8); }
      }
      break;
    }
    case 'bomber': {
      if (e.state === 'idle') {
        const wob = Math.sin(e.t * 8 + e.anim) * 0.5;
        mx = (ux - uz * wob) * e.speed; mz = (uz + ux * wob) * e.speed;
        tilt = Math.sin(e.t * 16) * 0.2; e.y = Math.abs(Math.sin(e.t * 16)) * 0.1;
        if (dist < 1.7) { e.state = 'fuse'; e.st = 0.75; e.ring = addMarker(e.x, e.z, 1.9, 0xff6a20); sfx('spit'); }
      } else {
        const k = 1 - e.st / 0.75;
        sx = sy = 1 + k * 0.45 + Math.sin(e.t * 50) * 0.06; e.chargeK = k; e.y = 0;
        mx = ux * 0.6; mz = uz * 0.6;
        if (e.ring) { e.ring.position.set(e.x, 0.05, e.z); e.ring.material.opacity = 0.3 + k * 0.6; }
        if (Math.random() < 0.6) spark(e.x, 0.75, e.z, 0xffd34f, { vy: 2, s: 0.25, life: 0.3, spread: 1 });
        if (e.st <= 0) { enemyBlast(e.x, e.z, 1.9, true); e.hp = 0; killEnemy(e); }
      }
      break;
    }
    case 'ghost': {
      // visible -> fade out -> hidden -> blink next to the player -> fade in
      e.y = 0.35 + Math.sin(e.t * 2.5) * 0.12; tilt = Math.sin(e.t * 1.7) * 0.15;
      if (e.state === 'idle') {
        mx = ux * e.speed; mz = uz * e.speed; e.alpha = 0.85;
        if (e.st <= 0) { e.state = 'fade'; e.st = 0.4; }
      } else if (e.state === 'fade') {
        e.alpha = 0.85 * e.st / 0.4; e.hidden = e.alpha < 0.3;
        if (e.st <= 0) { e.state = 'gone'; e.st = 0.7; e.hidden = true; }
      } else if (e.state === 'gone') {
        e.alpha = 0;
        if (e.st <= 0) {
          const room = rooms.find((q) => q.active) || G.curRoom;
          for (let tries = 0; tries < 12; tries++) {
            const a = rand() * Math.PI * 2, nx = player.x + Math.cos(a) * 2.6, nz = player.z + Math.sin(a) * 2.6;
            if (!solid(nx, nz, true) && (!room || roomAt(nx, nz) === room)) { e.x = nx; e.z = nz; break; }
          }
          e.state = 'appear'; e.st = 0.45; burst(e.x, 0.6, e.z, 0xbff3ff, 8, 2, 0.3, 0.4);
        }
      } else if (e.state === 'appear') {
        e.alpha = 0.85 * (1 - e.st / 0.45); e.hidden = e.alpha < 0.3; mx = ux; mz = uz;
        if (e.st <= 0) { e.state = 'idle'; e.st = rr(2, 3.2); e.hidden = false; }
      }
      e.noContact = e.hidden;
      break;
    }
    case 'shroom': {
      sx = 1 + Math.sin(e.t * 3) * 0.04; sy = 1 - Math.sin(e.t * 3) * 0.04;
      e.face = dx > 0 ? 1 : -1;
      if (e.state === 'idle' && e.st <= 0 && dist < 10) { e.state = 'charge'; e.st = 0.55; }
      if (e.state === 'charge') {
        const k = 1 - e.st / 0.55; e.chargeK = k; sx = 1 + k * 0.3; sy = 1 - k * 0.2;
        if (e.st <= 0) {
          const a = Math.atan2(dz, dx), n = G.floor >= 5 ? 7 : 5;
          for (let k2 = 0; k2 < n; k2++) enemyShoot(e, a + (k2 - (n - 1) / 2) * 0.24, 3.6, 0xc070ff, 0.8);
          e.state = 'idle'; e.st = rr(2.2, 3); e.squash = 0.7; e.chargeK = 0; sfx('spit');
          burst(e.x, 0.6, e.z, 0xc070ff, 8, 2, 0.3, 0.4);
        }
      }
      break;
    }
    case 'golem': {
      if (e.state === 'idle') {
        mx = ux * e.speed; mz = uz * e.speed;
        tilt = Math.sin(e.t * 5) * 0.1; e.y = Math.abs(Math.sin(e.t * 5)) * 0.05;
        if (e.st <= 0 && dist < 7) { e.state = 'wind'; e.st = 0.8; e.lx = ux; e.lz = uz; e.ring = addMarker(e.x, e.z, 0.9, 0xff3050); }
      } else if (e.state === 'wind') {
        e.tint = 1 - e.st / 0.8; e.shake = 0.06; tilt = -e.face * 0.3 * e.tint; sy = 1 - e.tint * 0.1; sx = 1 + e.tint * 0.1;
        if (e.ring) e.ring.position.set(e.x + e.lx * 1.2, 0.05, e.z + e.lz * 1.2);
        if (e.st <= 0) { e.state = 'charge'; e.st = 1.3; e.tint = 0; e.wallHit = false; sfx('whoosh'); killMarker(e); }
      } else if (e.state === 'charge') {
        mx = e.lx * 9; mz = e.lz * 9; sx = 1.25; sy = 0.85; tilt = e.face * 0.35;
        if (Math.random() < 0.7) chunkDust(e.x, e.z, 0x8a96a0);
        if (e.wallHit) {
          e.state = 'stun'; e.st = 1.6; addShake(0.35); sfx('slam'); e.squash = 0.9;
          chunk(e.x + e.lx * 0.5, 0.6, e.z + e.lz * 0.5, 0x8a96a0, 8, 4, 0.14);
          for (const pot of [...pots]) if (Math.hypot(pot.x - e.x, pot.z - e.z) < 1.5) breakPot(pot);
        } else if (e.st <= 0) { e.state = 'idle'; e.st = rr(1.5, 2.5); }
      } else if (e.state === 'stun') {
        tilt = Math.sin(e.t * 12) * 0.12; e.tint = 0;
        if (Math.random() < 0.3) spark(e.x + Math.cos(e.t * 6) * 0.4, 1.5, e.z + Math.sin(e.t * 6) * 0.4, 0xffe14f, { s: 0.25, life: 0.3, drag: 0 });
        if (e.st <= 0) { e.state = 'idle'; e.st = rr(1.5, 2.5); }
      }
      break;
    }
    case 'boss': case 'eyeboss': case 'golemboss': case 'tyrant': case 'sporeboss': case 'wraithboss':
      ({ boss: updateBoss, eyeboss: updateEyeBoss, golemboss: updateStoneKing, tyrant: updateTyrant, sporeboss: updateSpore, wraithboss: updateWraith })[e.type](e, edt, dx, dz, dist);
      sx = e.sx; sy = e.sy; mx = e.mx; mz = e.mz; tilt = e.tilt || 0; break;
  }
  // separation
  for (const o of enemies) {
    if (o === e || o.dead) continue;
    const ox = e.x - o.x, oz = e.z - o.z, od = Math.hypot(ox, oz), min = e.r + o.r;
    if (od < min && od > 0.001) { const push = (min - od) * 4; mx += ox / od * push; mz += oz / od * push; }
  }
  const sp = e.spawn < 1 ? 0 : 1;
  e.kx *= Math.exp(-8 * dt); e.kz *= Math.exp(-8 * dt);
  e.wallHit = false;
  moveCircle(e, (mx * sp + e.kx) * edt + e.kx * (dt - edt), (mz * sp + e.kz) * edt + e.kz * (dt - edt), e.r, !!d.fly); // hops don't clear pillars: slimes go around them
  if (!d.fly) unstick(e);
  if (Math.abs(mx) > 0.1) e.face = mx > 0 ? 1 : -1;
  // contact damage
  if (!e.noContact && e.spawn >= 1 && dist < e.r + player.r + 0.05) damagePlayer(e.isBoss || (e.type === 'golem' && e.state === 'charge') ? 2 : 1, e.x, e.z);
  // render
  const m = e.mesh, u = m.material.uniforms;
  const pop = e.spawn < 1 ? 1 - Math.pow(1 - e.spawn, 3) * 1.0 + Math.sin(e.spawn * Math.PI) * 0.25 : 1;
  const sq = e.squash || 0;
  setSpriteScale(m, sx * pop * (1 + sq * 0.35), sy * pop * (1 - sq * 0.3));
  const jit = e.shake ? (Math.random() - 0.5) * e.shake * 2 : 0; e.shake = 0;
  m.position.set(e.x + jit, e.y - (e.spawn < 1 && e.type !== 'boss' ? (1 - e.spawn) * 0.8 : 0), e.z);
  u.uBias.value = e.spawn < 1 ? 0 : 1.1; // rising out of the floor: let the floor hide the part below it
  billboard(m, tilt * (e.face < 0 ? -1 : 1) * -1);
  u.uFlip.value = e.face < 0 ? 1 : 0;
  if (e.alpha !== undefined) { m.material.transparent = true; u.uAlpha.value = e.alpha; e.shadow.visible = e.alpha > 0.2; }
  u.uFlash.value = Math.max(e.flash, (e.chargeK || 0) * 0.6 * (Math.sin(e.t * 40) > 0 ? 1 : 0.3));
  u.uFlashCol.value.set(e.flash > 0.01 ? 0xffffff : 0xc070ff);
  if (e.freeze > 0) u.uTint.value.set(0x9fe8ff);
  else if (e.tint) u.uTint.value.setRGB(1, 1 - e.tint * 0.6, 1 - e.tint * 0.6);
  else if (e.slow > 0) u.uTint.value.set(0xc8f0ff);
  else if (e.poison > 0) u.uTint.value.set(0xc8ffb8);
  else if (e.burn > 0) u.uTint.value.set(0xffc8a0);
  else if (e.curse > 0) u.uTint.value.set(0xd8b8ff);
  else u.uTint.value.set(e.elite ? 0xffd870 : 0xffffff);
  if (G.dark && Math.random() < 0.25) spark(e.x + e.face * 0.08, e.y + m.userData.bh * 0.72, e.z, 0xff2030, { s: 0.16, life: 0.15, drag: 0 });
  if (e.elite && Math.random() < 0.15) spark(e.x + rr(-0.3, 0.3), 0.3 + Math.random() * 0.6, e.z + rr(-0.3, 0.3), e.affColor || 0xffd34f, { vy: 1.2, s: 0.25, life: 0.5, drag: 0 });
  if (e.name || e.isBoss) $('bossfill').style.transform = `scaleX(${Math.max(0, e.hp / e.maxHp)})`;
  e.shadow.position.set(e.x, 0.02, e.z);
  const ss = (e.name ? 1.3 : 1) * d.r * 2.3 * (1 - Math.min(0.5, e.y * 0.25)) * pop;
  e.shadow.scale.set(ss, 1, ss * 0.8);
}
const markerGeo = flatRingGeo;
function addMarker(x, z, r, color) {
  const m = new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ map: markTex, color, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.position.set(x, 0.05, z); m.scale.setScalar(r); scene.add(m); return m;
}
function killMarker(e) { if (e.ring) { scene.remove(e.ring); e.ring.material.dispose(); e.ring = null; } }
// bomber explosion: always hurts other enemies (chain reactions), hurts the player only if the fuse ran out
function enemyBlast(x, z, r, hitsPlayer) {
  addRing(x, z, 0.3, r, 0.3, 0xff8a2a);
  burst(x, 0.5, z, 0xff8a2a, 26, 7, 0.55, 0.45); burst(x, 0.5, z, 0xffe08a, 10, 4, 0.45, 0.3);
  splat(x, z, 0x1a1210, r * 1.2);
  fxLight.position.set(x, 1.2, z); fxLight.intensity = 40;
  addShake(0.35); sfx('boom');
  for (const o of [...enemies]) if (!o.dead && o.type !== 'bomber' && Math.hypot(o.x - x, o.z - z) < r + o.r) hurtEnemy(o, 25, o.x - x, o.z - z, 6, 0xff8a2a);
  for (const o of enemies) if (!o.dead && o.type === 'bomber' && o.state === 'idle' && Math.hypot(o.x - x, o.z - z) < r) { o.state = 'fuse'; o.st = 0.15; }
  for (const pot of [...pots]) if (Math.hypot(pot.x - x, pot.z - z) < r) breakPot(pot);
  if (hitsPlayer && Math.hypot(player.x - x, player.z - z) < r + player.r) damagePlayer(1, x, z);
}
function hurtEnemyRaw(e, dmg, color) {
  if (e.dead) return;
  e.hp -= dmg; e.flash = Math.max(e.flash, 0.4);
  addText(e.x, 1.1, e.z, Math.round(dmg), color, 0.8);
  if (e.hp <= 0) killEnemy(e);
}
function chunkDust(x, z, color) { for (let k = 0; k < 5; k++) spark(x + rr(-0.3, 0.3), 0.08, z + rr(-0.3, 0.3), color, { vx: rr(-1.5, 1.5), vz: rr(-1.5, 1.5), vy: 0.6, s: 0.25, life: 0.35 }); }

const beamGeo = new THREE.BoxGeometry(1, 0.2, 1).translate(0.5, 0, 0);
function addBeam(e, a, spin) {
  const mesh = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xff2040, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  mesh.scale.set(14, 1, 0.08); scene.add(mesh);
  beams.push({ e, a, spin, t: 0, warn: 0.9, dur: 3.1, mesh });
  sfx('laser');
}
function updateBeams(dt) {
  for (let i = beams.length - 1; i >= 0; i--) {
    const b = beams[i]; b.t += dt;
    if (b.t > b.warn) b.a += b.spin * dt;
    const x = b.e.x, z = b.e.z, live = b.t > b.warn;
    b.mesh.position.set(x, 0.7, z); b.mesh.rotation.y = -b.a;
    b.mesh.scale.z = live ? 0.42 + Math.sin(b.t * 60) * 0.06 : 0.06;
    b.mesh.material.opacity = live ? 0.95 : 0.25 + Math.sin(b.t * 30) * 0.15;
    if (live) {
      const cx = Math.cos(b.a), cz = Math.sin(b.a);
      for (let k = 0; k < 3; k++) { const d = Math.random() * 13; spark(x + cx * d, 0.7, z + cz * d, 0xff4060, { vy: rr(0.5, 2), s: 0.35, life: 0.25, drag: 0 }); }
      const rx = player.x - x, rz = player.z - z, along = rx * cx + rz * cz, perp = Math.abs(-rx * cz + rz * cx);
      if (along > 0 && along < 14 && perp < 0.45) damagePlayer(1, player.x - cz, player.z + cx);
      if (Math.random() < 0.3) splat(x + cx * rr(1, 10), z + cz * rr(1, 10), 0x1a0606, 0.4);
    }
    if (b.t >= b.dur || b.e.dead) { scene.remove(b.mesh); b.mesh.material.dispose(); beams.splice(i, 1); }
  }
}
// The Hollow Eye: circles the room, sweeps lasers, sprays orbs, calls its children
function updateEyeBoss(e, dt, dx, dz, dist) {
  const r = rooms.find((q) => q.active) || G.curRoom, enraged = e.hp < e.maxHp * 0.5;
  e.orbit = (e.orbit || 0) + dt * (enraged ? 0.7 : 0.45);
  const tx = r.cx + Math.cos(e.orbit) * 3.2, tz = r.cz + Math.sin(e.orbit) * 2.6;
  e.mx = (tx - e.x) * 1.5; e.mz = (tz - e.z) * 1.5;
  e.y = 0.6 + Math.sin(e.t * 2) * 0.2; e.tilt = Math.sin(e.t * 1.3) * 0.1;
  const flap = Math.sin(e.t * 9); e.sx = 1 + flap * 0.08; e.sy = 1 - flap * 0.04;
  e.face = dx > 0 ? 1 : -1;
  if (e.state === 'idle' && e.st <= 0) {
    e.jumps++;
    const pickA = e.jumps % 3;
    if (pickA === 1) { e.state = 'laser'; e.st = 3.2; const a = Math.atan2(dz, dx) - 0.9; addBeam(e, a, 0.75); if (enraged) addBeam(e, a + Math.PI, 0.75); }
    else if (pickA === 2) { e.state = 'burst'; e.st = 1.6; e.shots = 0; e.cool = 0; }
    else { e.state = 'summon'; e.st = 1; for (let k = 0; k < (enraged ? 4 : 3); k++) portals.push(makePortal(r.cx + rr(-4, 4), r.cz + rr(-4, 4), 'eye', 0.7, k * 0.15)); sfx('portal'); }
  }
  if (e.state === 'laser') { e.mx *= 0.2; e.mz *= 0.2; e.chargeK = 0.5; }
  if (e.state === 'burst') {
    e.cool -= dt;
    if (e.cool <= 0 && e.shots < 3) { e.cool = 0.45; e.shots++; const n = enraged ? 18 : 14; for (let k = 0; k < n; k++) enemyShoot(e, k / n * Math.PI * 2 + e.shots * 0.2, 4, 0xb05cff, 1); e.squash = 0.5; sfx('spit'); }
  }
  if (e.state !== 'idle' && e.st <= 0) { e.state = 'idle'; e.st = enraged ? 1.2 : 1.8; e.chargeK = 0; }
}
// The Stone King: three charges in a row, then a slam that brings the ceiling down
function updateStoneKing(e, dt, dx, dz, dist) {
  const r = rooms.find((q) => q.active) || G.curRoom, enraged = e.hp < e.maxHp * 0.5;
  const ux = dx / (dist || 1), uz = dz / (dist || 1);
  e.mx = 0; e.mz = 0; e.sx = 1; e.sy = 1; e.tilt = 0;
  if (e.state === 'idle') {
    e.mx = ux * e.speed; e.mz = uz * e.speed; e.tilt = Math.sin(e.t * 4) * 0.08; e.y = Math.abs(Math.sin(e.t * 4)) * 0.05;
    if (e.st <= 0) { e.jumps++; if (e.jumps % 3 === 0) { e.state = 'slam'; e.st = 0.9; } else { e.state = 'wind'; e.st = 0.7; e.charges = enraged ? 4 : 3; e.lx = ux; e.lz = uz; } }
  } else if (e.state === 'wind') {
    e.tint = 1 - e.st / 0.7; e.shake = 0.08; e.tilt = -e.face * 0.25 * e.tint; e.lx = ux; e.lz = uz;
    if (e.st <= 0) { e.state = 'charge'; e.st = 1.4; e.tint = 0; sfx('whoosh'); }
  } else if (e.state === 'charge') {
    e.mx = e.lx * 10; e.mz = e.lz * 10; e.sx = 1.2; e.sy = 0.88; e.tilt = e.face * 0.3;
    chunkDust(e.x, e.z, 0x8a96a0);
    if (e.wallHit || e.st <= 0) {
      if (e.wallHit) { addShake(0.45); sfx('slam'); chunk(e.x, 1, e.z, 0x8a96a0, 10, 5, 0.16); }
      e.charges--;
      if (e.charges > 0) { e.state = 'wind'; e.st = 0.35; } else { e.state = 'stun'; e.st = 1.5; }
    }
  } else if (e.state === 'stun') {
    e.tilt = Math.sin(e.t * 12) * 0.1;
    if (Math.random() < 0.3) spark(e.x + Math.cos(e.t * 6) * 0.8, 3.1, e.z + Math.sin(e.t * 6) * 0.8, 0xffe14f, { s: 0.3, life: 0.3, drag: 0 });
    if (e.st <= 0) { e.state = 'idle'; e.st = enraged ? 1 : 1.6; }
  } else if (e.state === 'slam') {
    const k = 1 - e.st / 0.9; e.sy = 1 - k * 0.25; e.sx = 1 + k * 0.2; e.shake = 0.05;
    if (e.st <= 0) {
      e.squash = 0.9; addShake(0.8); sfx('slam'); G.hitstop = Math.max(G.hitstop, 0.06);
      addRing(e.x, e.z, 0.5, 4, 0.5, 0xc0c8d0);
      if (dist < 2.6) damagePlayer(1, e.x, e.z);
      const n = enraged ? 14 : 10;
      for (let q = 0; q < n; q++) {
        const x = clamp(player.x + rr(-4, 4), r.x0 + 1.5, r.x0 + r.w + 0.5), z = clamp(player.z + rr(-4, 4), r.z0 + 1.5, r.z0 + r.h + 0.5);
        later(q * 0.09, () => {
          const mk = addMarker(x, z, 0.8, 0xff3050);
          later(0.85, () => {
            scene.remove(mk); mk.material.dispose();
            chunk(x, 2, z, 0x8a96a0, 6, 3, 0.18); burst(x, 0.3, z, 0xc0c8d0, 8, 3, 0.4, 0.4); splat(x, z, 0x2a2a30, 0.9); addShake(0.12);
            if (Math.hypot(player.x - x, player.z - z) < 0.85) damagePlayer(1, x, z);
            for (const o of enemies) if (!o.dead && !o.isBoss && Math.hypot(o.x - x, o.z - z) < 0.85) hurtEnemyRaw(o, 30, '#c0c8d0');
          });
        });
      }
      if (e.jumps % 2 === 0) for (let q = 0; q < 2; q++) portals.push(makePortal(r.cx + rr(-3, 3), r.cz + rr(-3, 3), 'skeleton', 0.7, q * 0.2));
      e.state = 'idle'; e.st = 1.5;
    }
  }
}

// ---- The Bone Tyrant: greatsword sweeps, bone eruptions, raises the dead
function updateTyrant(e, dt, dx, dz, dist) {
  const r = rooms.find((q) => q.active) || G.curRoom, enraged = e.hp < e.maxHp * 0.5;
  const ux = dx / (dist || 1), uz = dz / (dist || 1);
  e.mx = 0; e.mz = 0; e.sx = 1; e.sy = 1; e.tilt = 0;
  if (e.state === 'idle') {
    e.mx = ux * e.speed; e.mz = uz * e.speed; e.tilt = Math.sin(e.t * 5) * 0.08; e.y = Math.abs(Math.sin(e.t * 5)) * 0.06;
    if (e.st <= 0) {
      e.jumps++;
      const k = e.jumps % 3;
      if (k === 1) { e.state = 'sweepWind'; e.st = enraged ? 0.55 : 0.75; e.lx = ux; e.lz = uz; e.ring = addMarker(e.x + ux * 1.8, e.z + uz * 1.8, 2.2, 0xff3050); }
      else if (k === 2) { e.state = 'bones'; e.st = 1.2; boneLines(e, enraged ? 5 : 3); }
      else { e.state = 'raise'; e.st = 1; for (let q = 0; q < (enraged ? 4 : 3); q++) portals.push(makePortal(r.cx + rr(-4, 4), r.cz + rr(-4, 4), 'skeleton', 0.7, q * 0.15)); sfx('portal'); }
    }
  } else if (e.state === 'sweepWind') {
    const k = 1 - e.st / 0.75; e.tint = k; e.shake = 0.06; e.tilt = -e.face * 0.4 * k; e.sx = 1 + 0.1 * k;
    if (e.ring) { e.ring.position.set(e.x + e.lx * 1.8, 0.05, e.z + e.lz * 1.8); e.ring.material.opacity = 0.3 + k * 0.6; }
    if (e.st <= 0) {
      killMarker(e); e.tint = 0; e.state = 'recover'; e.st = 0.6; e.tilt = e.face * 0.5; e.squash = 0.6;
      addShake(0.6); sfx('slam'); G.hitstop = Math.max(G.hitstop, 0.05);
      const cx = e.x + e.lx * 1.8, cz = e.z + e.lz * 1.8;
      addRing(cx, cz, 0.4, 2.4, 0.35, 0xffe0e0);
      for (let q = 0; q < 14; q++) { const a = Math.atan2(e.lz, e.lx) + rr(-1.1, 1.1), d = rr(0.6, 2.8); spark(e.x + Math.cos(a) * d, 0.8, e.z + Math.sin(a) * d, 0xfff0f0, { vx: Math.cos(a) * 4, vz: Math.sin(a) * 4, s: 0.5, life: 0.3 }); }
      if (Math.hypot(player.x - cx, player.z - cz) < 2.3) damagePlayer(1, e.x, e.z);
      for (const pot of [...pots]) if (Math.hypot(pot.x - cx, pot.z - cz) < 2.2) breakPot(pot);
    }
  } else if (e.state === 'recover') { e.tilt = e.face * 0.4 * (e.st / 0.6); if (e.st <= 0) { e.state = 'idle'; e.st = enraged ? 0.9 : 1.4; } }
  else if (e.st <= 0) { e.state = 'idle'; e.st = enraged ? 0.9 : 1.4; }
}
function boneLines(e, n) {
  const base = Math.atan2(player.z - e.z, player.x - e.x);
  sfx('lock');
  for (let l = 0; l < n; l++) {
    const a = base + (l - (n - 1) / 2) * 0.45;
    for (let k = 1; k <= 8; k++) {
      const x = e.x + Math.cos(a) * k * 0.85, z = e.z + Math.sin(a) * k * 0.85;
      later(k * 0.09, () => {
        if (cellAt(x, z) !== FLOOR) return;
        const mk = addMarker(x, z, 0.5, 0xffe0c0);
        later(0.45, () => {
          scene.remove(mk); mk.material.dispose();
          chunk(x, 0.2, z, 0xe8e0cc, 4, 3, 0.12); burst(x, 0.3, z, 0xfff0e0, 5, 3, 0.35, 0.3); splat(x, z, 0x3a3428, 0.5);
          if (Math.hypot(player.x - x, player.z - z) < 0.6) damagePlayer(1, x, z);
        });
      });
    }
  }
}
// ---- Mother Spore: spore spirals, poison clouds around you, her brood
function updateSpore(e, dt, dx, dz, dist) {
  const r = rooms.find((q) => q.active) || G.curRoom, enraged = e.hp < e.maxHp * 0.5;
  e.mx = (r.cx - e.x) * 0.5 + Math.sin(e.t * 0.6) * 0.8; e.mz = (r.z0 + 4 - e.z) * 0.5; e.tilt = Math.sin(e.t * 1.5) * 0.06;
  const breathe = Math.sin(e.t * 2.4); e.sx = 1 + breathe * 0.05; e.sy = 1 - breathe * 0.05; e.face = dx > 0 ? 1 : -1;
  if (e.state === 'idle' && e.st <= 0) {
    e.jumps++;
    const k = e.jumps % 3;
    if (k === 1) { e.state = 'spiral'; e.st = enraged ? 3 : 2.4; e.spin = rand() * 6; e.cool = 0; }
    else if (k === 2) {
      e.state = 'gas'; e.st = 1.2; sfx('hiss');
      for (let q = 0; q < (enraged ? 6 : 4); q++) {
        const x = player.x + rr(-3, 3), z = player.z + rr(-3, 3);
        if (cellAt(x, z) !== FLOOR) continue;
        const mk = addMarker(x, z, 1.3, 0x5fff4a);
        later(0.9, () => { scene.remove(mk); mk.material.dispose(); clouds.push({ x, z, r: 1.3, life: 3.5, cd: 0 }); });
      }
    } else { e.state = 'brood'; e.st = 1; for (let q = 0; q < (enraged ? 4 : 3); q++) portals.push(makePortal(r.cx + rr(-4, 4), r.cz + rr(-3, 4), q % 2 ? 'slime' : 'shroom', 0.7, q * 0.15)); sfx('portal'); }
  }
  if (e.state === 'spiral') {
    e.cool -= dt; e.sx = 1 + Math.sin(e.t * 18) * 0.06;
    if (e.cool <= 0) { e.cool = enraged ? 0.08 : 0.11; e.spin += 0.33; for (let q = 0; q < 2; q++) enemyShoot(e, e.spin + q * Math.PI, 3.6, q ? 0xb070ff : 0x7dff6a, 0.9); }
  }
  if (e.state !== 'idle' && e.st <= 0) { e.state = 'idle'; e.st = enraged ? 1 : 1.6; }
}
function updateClouds(dt) {
  for (let i = clouds.length - 1; i >= 0; i--) {
    const c = clouds[i]; c.life -= dt; c.cd -= dt;
    for (let k = 0; k < 2; k++) { const a = Math.random() * 6.28, d = Math.random() * c.r; spark(c.x + Math.cos(a) * d, rr(0.1, 1), c.z + Math.sin(a) * d, Math.random() < 0.5 ? 0x5fff4a : 0x2a7a2a, { vy: 0.4, s: rr(0.5, 0.9), life: 0.8, drag: 1 }); }
    if (c.cd <= 0 && player.alive && Math.hypot(player.x - c.x, player.z - c.z) < c.r) { c.cd = 1.2; damagePlayer(1, c.x, c.z); }
    if (c.life <= 0) clouds.splice(i, 1);
  }
}
// ---- The Wraith Queen: blinks around you, homing souls, her court of ghosts; snuffs the torches when hurt
function updateWraith(e, dt, dx, dz, dist) {
  const r = rooms.find((q) => q.active) || G.curRoom, enraged = e.hp < e.maxHp * 0.5;
  if (enraged && !e.snuffed) { e.snuffed = true; G.dark = r; for (const f of r.flames) { f.visible = false; f.userData.core.visible = false; } banner('THE LIGHTS DIE', ''); sfx('moan'); }
  e.y = 0.5 + Math.sin(e.t * 2) * 0.15; e.tilt = Math.sin(e.t * 1.4) * 0.12; e.face = dx > 0 ? 1 : -1;
  e.mx = 0; e.mz = 0; e.sx = 1; e.sy = 1;
  if (e.state === 'idle') {
    e.alpha = 0.92; e.hidden = false;
    const ux = dx / (dist || 1), uz = dz / (dist || 1), tang = Math.sin(e.t * 0.5) > 0 ? 1 : -1;
    e.mx = (ux * (dist - 4.5) - uz * tang * 1.5) * 0.9; e.mz = (uz * (dist - 4.5) + ux * tang * 1.5) * 0.9;
    if (e.st <= 0) {
      e.jumps++;
      const k = e.jumps % 3;
      if (k === 1) { e.state = 'fade'; e.st = 0.4; }
      else if (k === 2) { e.state = 'souls'; e.st = 1.4; e.cool = 0; e.shots = 0; }
      else { e.state = 'court'; e.st = 1; for (let q = 0; q < (enraged ? 4 : 3); q++) portals.push(makePortal(r.cx + rr(-4, 4), r.cz + rr(-4, 4), 'ghost', 0.7, q * 0.15)); sfx('moan'); }
    }
  } else if (e.state === 'fade') {
    e.alpha = 0.92 * e.st / 0.4; e.hidden = e.alpha < 0.3; e.noContact = true;
    if (e.st <= 0) {
      for (let tries = 0; tries < 12; tries++) { const a = rand() * 6.28, nx = player.x + Math.cos(a) * 3.2, nz = player.z + Math.sin(a) * 3.2; if (!solid(nx, nz, true) && roomAt(nx, nz) === r) { e.x = nx; e.z = nz; break; } }
      e.state = 'appear'; e.st = 0.45; burst(e.x, 1, e.z, 0xbff3ff, 16, 3, 0.4, 0.5);
    }
  } else if (e.state === 'appear') {
    e.alpha = 0.92 * (1 - e.st / 0.45); e.hidden = e.alpha < 0.3;
    if (e.st <= 0) { e.state = 'idle'; e.st = enraged ? 1 : 1.5; const n = enraged ? 18 : 12; for (let q = 0; q < n; q++) enemyShoot(e, q / n * Math.PI * 2, 3.4, 0xbff3ff, 0.9); addShake(0.3); sfx('spit'); }
  } else if (e.state === 'souls') {
    e.cool -= dt; e.chargeK = 0.4;
    if (e.cool <= 0 && e.shots < (enraged ? 7 : 5)) { e.cool = 0.22; e.shots++; enemyShoot(e, Math.atan2(dz, dx) + rr(-1.2, 1.2), 3.2, 0x9fe8ff, 1, 1.8); sfx('spit'); }
    if (e.st <= 0) { e.state = 'idle'; e.st = enraged ? 1 : 1.6; e.chargeK = 0; }
  } else if (e.st <= 0) { e.state = 'idle'; e.st = 1.4; }
}
function updateBoss(e, dt, dx, dz, dist) {
  const enraged = e.hp < e.maxHp * 0.5;
  e.mx = 0; e.mz = 0; e.sx = 1; e.sy = 1; e.tilt = 0;
  if (e.state === 'wait') {
    const k = 1 - clamp(e.st / 0.7, 0, 1);
    e.sx = 1 + 0.25 * k + Math.sin(e.t * 6) * 0.03; e.sy = 1 - 0.25 * k - Math.sin(e.t * 6) * 0.03; e.y = 0;
    if (e.st <= 0) {
      e.jumps++;
      if (e.jumps % 4 === 0) { e.state = 'spray'; e.st = 2.2; e.shots = 0; e.spin = rand() * 6; }
      else {
        e.state = 'jump'; e.st = enraged ? 0.75 : 0.95; e.jd = e.st;
        e.tx = clamp(player.x + player.vx * 0.4, G.curRoom.x0 + 2.2, G.curRoom.x0 + G.curRoom.w - 0.2);
        e.tz = clamp(player.z + player.vz * 0.4, G.curRoom.z0 + 2.2, G.curRoom.z0 + G.curRoom.h - 0.2);
        e.sx0 = e.x; e.sz0 = e.z;
        e.marker = new THREE.Mesh(portalGeo, new THREE.MeshBasicMaterial({ map: markTex, color: 0xff2a5a, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }));
        e.marker.position.set(e.tx, 0.05, e.tz); e.marker.scale.setScalar(2.4); scene.add(e.marker);
      }
    }
  } else if (e.state === 'jump') {
    const p = 1 - e.st / e.jd;
    e.y = Math.sin(p * Math.PI) * 3.2;
    e.x = lerp(e.sx0, e.tx, p); e.z = lerp(e.sz0, e.tz, p);
    e.sx = p < 0.5 ? 0.8 : 0.92; e.sy = p < 0.5 ? 1.3 : 1.1; e.noContact = true;
    if (e.marker) e.marker.material.opacity = 0.3 + p * 0.6;
    if (e.st <= 0) {
      e.y = 0; e.state = 'wait'; e.st = enraged ? 0.5 : 0.75; e.squash = 0.8;
      if (e.marker) { scene.remove(e.marker); e.marker.material.dispose(); e.marker = null; }
      addShake(0.7); sfx('slam'); G.hitstop = Math.max(G.hitstop, 0.06);
      addRing(e.x, e.z, 0.5, 4, 0.45, 0xff4fb0);
      splat(e.x, e.z, 0xb01a74, 3.2);
      chunk(e.x, 0.3, e.z, 0xff6fc4, 14, 7, 0.16);
      if (Math.hypot(player.x - e.x, player.z - e.z) < 2.6) damagePlayer(2, e.x, e.z);
      const n = enraged ? 16 : 12;
      for (let k = 0; k < n; k++) enemyShoot(e, k / n * Math.PI * 2 + (e.jumps % 2) * 0.2, 4.2, 0xff4fb0, 1.0);
      if (e.jumps % 3 === 0) for (let k = 0; k < (enraged ? 3 : 2); k++) { portals.push(makePortal(e.x + rr(-3, 3), e.z + rr(-3, 3), 'slime', 0.7, k * 0.1)); }
    }
  } else if (e.state === 'spray') {
    e.sx = 1 + Math.sin(e.t * 20) * 0.06; e.sy = 1 - Math.sin(e.t * 20) * 0.06; e.tilt = Math.sin(e.t * 7) * 0.08;
    e.cool = (e.cool || 0) - dt;
    if (e.cool <= 0) { e.cool = enraged ? 0.09 : 0.13; e.spin += 0.37; for (let k = 0; k < 3; k++) enemyShoot(e, e.spin + k * Math.PI * 2 / 3, 3.8, 0xb05cff, 0.9); sfx('spit'); }
    if (e.st <= 0) { e.state = 'wait'; e.st = 0.6; }
  }
  $('bossfill').style.transform = `scaleX(${Math.max(0, e.hp / e.maxHp)})`;
}

// ---------- spells ----------
// ---------- spells: generated from element x shape (see arcana.js); boss spells and legendaries are special ----------
function castSpells(dt) {
  if (player.drop > 0) return;
  const cdMul = player.cdMul * player.g.cd * player.der.cd;
  for (const s of spells) {
    const def = spellDef(s.id);
    if (!def) continue;
    s.t -= dt;
    if (s.t > 0) continue;
    const target = nearestEnemy(player.x, player.z, def.range + (player.rangeBonus || 0));
    if (!target) { s.t = 0; continue; }
    castSpell(s, def, target);
    player.casts++;
    const g = player.g;
    if ((g.flags.echo && Math.random() < 0.2) || (g.flags.stormcaller && player.casts % 8 === 0)) {
      later(0.15, () => { const t2 = player.alive && nearestEnemy(player.x, player.z, def.range + 2); if (t2) castSpell(s, def, t2); });
    }
    let cd = def.cd * cdMul;
    if (s.lv >= 5 && def.sh.beh === 'proj') cd *= 0.85;
    s.t = cd; s.pop = 1;
  }
}
const tipV = new THREE.Vector3();
function staffTip() {
  const m = player.mesh, sh = sheets[player.hero.sprite], tip = (sh && sh.tip) || [0.82, 0.78];
  tipV.set((tip[0] - 0.5) * (player.face < 0 ? -1 : 1), tip[1], 0).multiply(m.scale).applyQuaternion(m.quaternion).add(m.position);
  return tipV;
}
const lvMul = (lv) => 1 + 0.3 * (lv - 1);
const hexOf = (c) => new THREE.Color(c).getHex();
// heroes throw their own projectiles: javelins, axes, arrows, skulls
function heroVis(v) {
  const hv = player.hero.vis;
  if (!hv) return v;
  if (v === 'bolt' || v === 'lance' || v === 'glaive') return hv;
  if (v === 'venom') return hv + 'S';
  return v;
}
function castSpell(s, def, target) {
  // turn to the target so the weapon is on that side, then cast from its tip
  player.face = target.x >= player.x ? 1 : -1;
  player.mesh.material.uniforms.uFlip.value = player.face < 0 ? 1 : 0;
  const t0 = staffTip(), px = t0.x, pz = t0.z, py = t0.y;
  const a = Math.atan2(target.z - pz, target.x - px);
  const col = hexOf(def.color);
  player.aimX = Math.cos(a); player.aimZ = Math.sin(a);
  player.castT = 0.25;
  spark(px, py, pz, 0xffffff, { s: 0.9, life: 0.1, drag: 0 });
  for (let k = 0; k < 3; k++) spark(px, py, pz, col, { vx: player.aimX * 3, vz: player.aimZ * 3, vy: 1, s: 0.25, life: 0.25, spread: 2 });
  kick(-player.aimX * 0.06, -player.aimZ * 0.06);
  if (def.legendary) return castLegendary(s, def, target);
  if (def.bossSpell) return castBossSpell(s, def, target, px, pz, py, a, col);
  const sh = def.sh, g = player.g, lv = s.lv, els = def.els;
  const dmg = def.dmg * lvMul(lv);
  const area = player.area * g.area, dur = player.dur * g.dur, extra = player.extraProj + g.proj;
  switch (sh.beh) {
    case 'proj': {
      const n = sh.count + (lv >= 3) + (lv >= 5) + extra;
      for (let k = 0; k < n; k++) {
        const aa = n === 1 ? a : sh.spread ? a + (k / (n - 1) - 0.5) * sh.spread * (1 + 0.08 * extra) : a + (k - (n - 1) / 2) * 0.2;
        const rn = s.runes || {};
        addProj({ kind: heroVis(sh.vis), x: px, z: pz, y: py, a: aa, speed: sh.speed * (player.projSpeed || 1), dmg, r: sh.r, color: col, size: sh.size,
          homing: Math.max(sh.homing || 0, rn.seek ? 7 : 0), seek: !!rn.seek, target: sh.homing || rn.seek ? target : null, pierce: (sh.pierce || 0) + (player.pierceBonus || 0) + (rn.pierce || 0), bounce: rn.bounce || 0, life: sh.life * (rn.bounce ? 1.6 : 1) * (rn.seek ? 1.3 : 1),
          aoe: sh.aoe ? sh.aoe * area : 0, tx: target.x, tz: target.z, els, boomerang: !!sh.boomerang });
      }
      sfx(sh.aoe ? 'fire' : sh.vis === 'venom' ? 'venom' : 'bolt');
      break;
    }
    case 'radial': {
      const n = sh.count + (lv >= 3 ? 4 : 0) + (lv >= 5 ? 6 : 0) + extra * 3;
      const rn = s.runes || {};
      for (let k = 0; k < n; k++) addProj({ kind: heroVis(sh.vis), x: player.x, z: player.z, y: 0.7, a: a + k / n * Math.PI * 2, speed: sh.speed, dmg, r: sh.r, color: col, size: sh.size, life: sh.life * (rn.bounce ? 1.6 : 1), els,
        pierce: (player.pierceBonus || 0) + (rn.pierce || 0), bounce: rn.bounce || 0, homing: rn.seek ? 6 : 0, seek: !!rn.seek, target: rn.seek ? nearestEnemy(player.x, player.z, 8) : null });
      sfx('venom');
      break;
    }
    case 'nova': {
      const rad = sh.radius * (lv >= 3 ? 1.25 : 1) * area;
      for (let k = 0; k < (lv >= 5 ? 2 : 1); k++) later(k * 0.35, () => castNova(dmg, rad, col, els));
      break;
    }
    case 'chain': {
      const jumps = sh.jumps + (lv >= 3 ? 2 : 0) + (lv >= 5 ? 3 : 0) + extra;
      const hit = new Set(); let cur = target, from = new THREE.Vector3(px, py, pz);
      const pts = [from];
      for (let k = 0; k <= jumps && cur; k++) {
        hit.add(cur); pts.push(new THREE.Vector3(cur.x, 0.6 + cur.y, cur.z));
        hurtEnemy(cur, dmg * Math.pow(0.9, k), cur.x - from.x, cur.z - from.z, 1.5, col, els);
        burst(cur.x, 0.6, cur.z, col, 6, 4, 0.3, 0.3);
        from = pts[pts.length - 1]; cur = nearestEnemy(cur.x, cur.z, 3.8 * Math.sqrt(area), hit);
      }
      bolts.push({ pts, life: 0.22, color: def.color });
      addShake(0.1); sfx('zap');
      break;
    }
    case 'orbit': {
      const n = sh.count + (lv >= 3) + (lv >= 5 ? 2 : 0) + extra;
      for (let k = 0; k < n; k++) orbs.push({ a: k / n * Math.PI * 2, rad: sh.radius * Math.sqrt(area), life: sh.dur * dur, dmg, color: col, els,
        glow: makeGlow(col, 0.8, 0.7), mesh: makeProjMesh('orb', col), shadow: makeShadow(0.5), hits: new Map() });
      sfx('orb');
      break;
    }
    case 'rain': {
      strikes(sh.count + (lv >= 3 ? 2 : 0) + (lv >= 5 ? 3 : 0) + extra * 2, target, sh.aoe * area, dmg, col, els, 0.12);
      sfx('fire');
      break;
    }
    case 'zone': {
      const r = sh.radius * (lv >= 3 ? 1.25 : 1) * area;
      fires.push({ x: target.x, z: target.z, r, life: sh.dur * (lv >= 5 ? 2 : 1) * dur, dmg, tick: 0, els, color: col, glow: makeGlowAt(target.x, 0.2, target.z, col, r * 2.2, 0.4) });
      addRing(target.x, target.z, 0.2, r, 0.4, col); sfx('frost');
      break;
    }
    case 'mine': {
      for (let k = 0; k < (lv >= 5 ? 2 : 1); k++) {
        const x = player.x + (k ? rr(-0.8, 0.8) : 0), z = player.z + (k ? rr(-0.8, 0.8) : 0);
        mines.push({ x, z, arm: 0.45, life: 9 * dur, dmg, aoe: sh.aoe * (lv >= 3 ? 1.25 : 1) * area, els, color: col, glow: makeGlowAt(x, 0.15, z, col, 1.1, 0.6), t: 0 });
      }
      sfx('lock');
      break;
    }
    case 'beam': {
      rays.push({ target, t: sh.dur * (lv >= 3 ? 1.5 : 1) * dur, tick: 0, n: 0, dmg, els, color: col, split: lv >= 5, range: def.range + 1, meshes: [] });
      sfx('laser');
      break;
    }
    case 'summon': {
      const n = 1 + (lv >= 3) + (lv >= 5) + Math.floor(extra / 2);
      for (let k = 0; k < n; k++) wisps.push({ a: k * 2.1 + Math.random(), life: sh.dur * dur, cd: 0.3 + k * 0.2, rate: lv >= 5 ? 0.5 : 0.75, dmg, els, color: col,
        glow: makeGlow(col, 0.9, 0.8), mesh: makeProjMesh('orb', col), shadow: makeShadow(0.4), x: player.x, z: player.z });
      sfx('orb');
      break;
    }
  }
}
// strikes falling from the sky onto random foes (Rain shapes, Meteor Storm, Rockfall)
// a falling rock: dark tumbling core with glowing cracks, a fiery shell, a smoke and flame trail
const meteorRock = new THREE.IcosahedronGeometry(1, 1);
{ const pos = meteorRock.attributes.position; for (let i = 0; i < pos.count; i++) { const k = 0.8 + hash(i, 1, 3) * 0.4; pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k); } meteorRock.computeVertexNormals(); }
const meteorMats = new Map();
function makeMeteor(x, z, col, rocky, aoe) {
  const g = new THREE.Group(), size = 0.22 + aoe * 0.12;
  const mk = col + '|' + rocky;
  if (!meteorMats.has(mk)) meteorMats.set(mk, new THREE.MeshLambertMaterial({ color: rocky ? 0x8a8070 : 0x3a2a24, emissive: new THREE.Color(col).multiplyScalar(rocky ? 0.15 : 0.55), flatShading: true }));
  const core = new THREE.Mesh(meteorRock, meteorMats.get(mk));
  core.scale.setScalar(size); g.add(core);
  if (!rocky) { const shell = new THREE.Mesh(PG.ball, pMat(col, true, 0.45)); shell.scale.setScalar(size * 9); g.add(shell); }
  const glow = makeGlow(col, size * 6, rocky ? 0.3 : 0.8);
  scene.add(g);
  return { g, core, glow, x, z, sx: x + 4, sy: 9, sz: z - 3, t: 0, dur: 0.65, col, rocky };
}
function updateMeteors(dt) {
  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i]; m.t += dt;
    const k = Math.min(1, m.t / m.dur), e = k * k; // accelerates as it falls
    const px = lerp(m.sx, m.x, e), py = lerp(m.sy, 0.3, e), pz = lerp(m.sz, m.z, e);
    m.g.position.set(px, py, pz); m.glow.position.set(px, py, pz);
    m.core.rotation.x += dt * 9; m.core.rotation.z += dt * 6;
    spark(px, py, pz, m.col, { s: 0.6, life: 0.25, drag: 0, spread: 0.6 });
    if (Math.random() < 0.6) spark(px, py, pz, m.rocky ? 0x6a6458 : 0x2a2220, { s: 0.7, life: 0.6, drag: 1, vy: 0.5, spread: 0.4 });
    if (k >= 1) { scene.remove(m.g); killGlow(m.glow); meteors.splice(i, 1); }
  }
}
function strikes(n, target, aoe, dmg, col, els, gap, rocky = false) {
  const foes = enemies.filter((e) => !e.dead && !e.hidden);
  for (let k = 0; k < n; k++) {
    const e = foes.length ? pick(foes) : target;
    const x = e.x + rr(-0.9, 0.9), z = e.z + rr(-0.9, 0.9);
    later(k * gap, () => {
      if (cellAt(x, z) !== FLOOR) return;
      const mk = addMarker(x, z, aoe * 0.85, col);
      meteors.push(makeMeteor(x, z, col, rocky, aoe));
      later(0.65, () => { scene.remove(mk); mk.material.dispose(); explode({ x, z, aoe, dmg, els, color: col }); chunk(x, 0.2, z, rocky ? 0x8a96a0 : 0x3a2a24, 5, 5, 0.13); });
    });
  }
}
function castNova(dmg, rad, col, els) {
  if (!player.alive) return;
  addRing(player.x, player.z, 0.3, rad, 0.35, col);
  addRing(player.x, player.z, 0.2, rad * 0.75, 0.45, 0xffffff);
  for (let k = 0; k < 28; k++) { const a = k / 28 * Math.PI * 2; spark(player.x + Math.cos(a) * 0.5, 0.3, player.z + Math.sin(a) * 0.5, col, { vx: Math.cos(a) * rad * 3, vz: Math.sin(a) * rad * 3, vy: 1, s: 0.4, life: 0.35, drag: 5 }); }
  let hits = 0;
  for (const e of [...enemies]) if (!e.dead && Math.hypot(e.x - player.x, e.z - player.z) < rad + e.r) { hurtEnemy(e, dmg, e.x - player.x, e.z - player.z, 5, col, els); hits++; }
  for (const pot of [...pots]) if (Math.hypot(pot.x - player.x, pot.z - player.z) < rad) breakPot(pot);
  addShake(Math.min(0.25, 0.03 + hits * 0.03)); sfx('frost');
}
function castLegendary(s, def, target) {
  if (s.id === 'meteor') { strikes(7, target, 1.7, 40 + G.floor * 6, 0xff7a2a, ['fire'], 0.16); sfx('fire'); }
  if (s.id === 'hole') { holes.push({ x: target.x, z: target.z, t: 0, dur: 2.2, glow: makeGlowAt(target.x, 0.5, target.z, 0x6a1aff, 3.5, 0.6) }); sfx('portal'); }
  if (s.id === 'still') {
    G.still = 2.5;
    for (const e of enemies) e.freeze = Math.max(e.freeze, 2.5 * (e.isBoss ? 0.5 : 1)); // stopped time beats resistance, bosses half
    renderer.domElement.style.filter = 'grayscale(0.9) contrast(1.15) brightness(1.1)';
    later(2.5, () => { renderer.domElement.style.filter = ''; });
    flash(0.5); addShake(0.3); sfx('frost');
  }
}
// boss spells: each boss's own attack, now yours
function castBossSpell(s, def, target, px, pz, py, a, col) {
  const dmg = def.dmg * lvMul(s.lv), els = def.els, area = player.area * player.g.area;
  switch (def.sh.beh) {
    case 'gloop': {
      explode({ x: target.x, z: target.z, aoe: 2.2 * area, dmg, els, color: col });
      const n = 10 + s.lv * 2;
      for (let k = 0; k < n; k++) addProj({ kind: 'orb', x: target.x, z: target.z, y: 0.6, a: k / n * Math.PI * 2, speed: 7, dmg: dmg * 0.35, r: 0.25, color: col, size: 0.8, life: 0.7, els });
      sfx('slam'); addShake(0.4);
      break;
    }
    case 'bones': {
      const lines = 3 + (s.lv >= 3 ? 2 : 0);
      for (let l = 0; l < lines; l++) {
        const aa = a + (l - (lines - 1) / 2) * 0.4;
        for (let k = 1; k <= 8; k++) {
          const x = player.x + Math.cos(aa) * k * 0.9, z = player.z + Math.sin(aa) * k * 0.9;
          later(k * 0.07, () => {
            if (cellAt(x, z) !== FLOOR) return;
            chunk(x, 0.2, z, 0xe8e0cc, 3, 3, 0.12); burst(x, 0.3, z, 0xfff0e0, 4, 3, 0.35, 0.3);
            for (const e of [...enemies]) if (!e.dead && Math.hypot(e.x - x, e.z - z) < 0.8 + e.r) hurtEnemy(e, dmg, e.x - player.x, e.z - player.z, 2, col, els);
          });
        }
      }
      sfx('lock');
      break;
    }
    case 'gaze': rays.push({ sweep: true, a0: a - 0.9, arc: 1.8, t: 1.6, dur: 1.6, tick: 0, n: 0, dmg, els, color: col, range: 9, meshes: [] }); sfx('laser'); break;
    case 'spores': {
      const n = 16 + s.lv * 2;
      for (let k = 0; k < n; k++) later(k * 0.08, () => { if (!player.alive) return; for (let q = 0; q < 2; q++) addProj({ kind: 'venom', x: player.x, z: player.z, y: 0.7, a: k * 0.4 + q * Math.PI, speed: 8, dmg, r: 0.22, color: col, size: 0.7, life: 0.9, els }); });
      sfx('spit');
      break;
    }
    case 'rocks': strikes(8 + s.lv * 2, target, 1.3 * area, dmg, 0xb0a090, els, 0.08, true); addShake(0.3); sfx('slam'); break;
    case 'souls': {
      for (let k = 0; k < 4 + s.lv; k++) addProj({ kind: 'orb', x: px, z: pz, y: py, a: a + rr(-1.4, 1.4), speed: 7, dmg, r: 0.28, color: col, size: 0.9, homing: 4, target, life: 2.4, els });
      sfx('moan');
      break;
    }
  }
}
// ---------- status effects ----------
// how strongly a status lands: the monster's resistance to that element (0 = immune) times its toughness against control
const TENACITY = { big: 0.7, golem: 0.4, skeleton: 0.85, mimic: 0.6 };
function statusMul(e, el) { return Math.min(1.5, resistOf(e.type, [el], e.affinity)); }
function ccMul(e) { return (TENACITY[e.type] || 1) * (e.isBoss ? 0.35 : e.name ? 0.5 : e.elite ? 0.7 : 1); }
function ccFreeze(e, dur) { const k = statusMul(e, 'frost') * ccMul(e); if (k > 0.05) e.freeze = Math.max(e.freeze, dur * k); }
function applyStatus(e, els, dmg) {
  const pw = player.der.status;
  for (const el of els) {
    const f = statusMul(e, el);
    if (f <= 0) continue; // immune: no status at all
    switch (el) {
      case 'fire': e.burn = 3 * Math.min(1, f); e.burnDps = Math.max(e.burnDps || 0, dmg * 0.3 * pw * f); break;
      case 'frost': { // resistant foes slow less and need more chills to freeze
        const c = ccMul(e);
        e.slow = Math.max(e.slow, 2 * Math.min(1, f)); e.slowAmt = Math.max(e.slowAmt || 0, Math.min(0.6, 0.5 * f * (0.5 + 0.5 * c)));
        e.chill = (e.chill || 0) + f * c;
        if (e.chill >= 3) { ccFreeze(e, 1); e.chill = 0; }
        break;
      }
      case 'storm': e.shock = 2.5 * Math.min(1, f); e.shockAmt = 0.25 * f; break;
      case 'venom': e.poison = 4; e.pstacks = Math.min(Math.max(1, Math.round(8 * Math.min(1, f))), (e.pstacks || 0) + 1); e.poisonDps = Math.max(e.poisonDps || 0, dmg * 0.1 * e.pstacks * pw * f); break;
      case 'shadow': e.curse = 4 * Math.min(1, f); e.curseDmg = Math.max(e.curseDmg || 0, dmg * 1.5 * pw * f); break;
      case 'earth': if (Math.random() < 0.22 * f * ccMul(e)) e.stun = Math.max(e.stun || 0, 0.5); break;
    }
  }
}
// damage from beams and fields: no knockback, numbers only now and then
function dotHit(e, dmg, color, els, show) {
  if (e.dead) return;
  const g = player.g;
  let d = dmg * player.dmgMul * g.dmg * player.der.dmg * resistOf(e.type, els, e.affinity);
  if (els.includes('holy') && UNDEAD.has(e.type)) d *= 2;
  if (e.shock > 0) d *= 1 + (e.shockAmt || 0.25);
  G.run.dmg += Math.min(d, Math.max(0, e.hp)); e.hp -= d; e.flash = Math.max(e.flash, 0.3); e.lastEls = els;
  applyStatus(e, els, d);
  if (show) addText(e.x, 1.1, e.z, Math.round(d), '#' + new THREE.Color(color).getHexString(), 0.8);
  if (e.hp <= 0) killEnemy(e);
}
// ---------- leveling (Ragnarok-style stat points) ----------
function gainXp(n) {
  const p = player;
  p.xp += n;
  while (p.xp >= xpNeed(p.lv)) {
    p.xp -= xpNeed(p.lv); p.lv++; p.statPts += 3; G.lvPicks = (G.lvPicks || 0) + 1; G.lvPickT = 0.7; // a power pick follows the banner
    banner('LEVEL UP', `LEVEL ${p.lv} · +3 STAT POINTS`); bannerT = 1.2; sfx('heal');
    burst(p.x, 1, p.z, 0xffe14f, 24, 4, 0.4, 0.7);
    $('pauseBtn').classList.add('pts');
    if (AUTO) autoAllocate();
  }
}
function autoAllocate() {
  const pr = { mage: ['int', 'int', 'dex'], archer: ['dex', 'dex', 'agi'], warrior: ['str', 'str', 'vit'], hunter: ['str', 'dex', 'agi'] }[player.hero.cls];
  while (player.statPts > 0) { player.alloc[pr[player.statPts % 3]]++; player.statPts--; }
  recalcStats();
}
// everything that feeds the player's numbers: hero base stats + points spent + gear
function recalcStats() {
  const p = player, t = gearTotals(p.gear), st = {};
  for (const k of STATS) st[k] = (p.hero.base[k] || 0) + (p.alloc[k] || 0) + (t.st[k] || 0);
  const der = derive(p.hero.cls, st), bonusHp = t.hp + der.hearts * 2, delta = bonusHp - (p.bonusHp || 0);
  p.maxHp = Math.max(2, p.maxHp + delta); if (delta > 0) p.hp += delta; p.hp = Math.min(p.hp, p.maxHp);
  p.bonusHp = bonusHp; p.st = st; p.der = der; p.g = t;
  if (!p.statPts) $('pauseBtn').classList.remove('pts');
  renderHearts();
}
// ---------- gear ----------
function dropGear(x, z, minR, given = null, armed = !given) {
  const item = given || rollGear(rand, G.floor, player.g.luck + player.der.loot, minR);
  const col = hexOf(RARITY[item.rarity].color);
  // a thick additive light pillar plus a big glow so drops read from across the room
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.26, 5, 0.26), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(beam);
  const a = Math.random() * Math.PI * 2, v = given ? 1.2 : rr(1, 2.5);
  pickups.push({ kind: 'gear', item, x, z, y: 0.4, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: given ? 4 : rr(5, 7), mesh: makeSprite('gear', 0.6, SLOTS.indexOf(item.slot)), shadow: makeShadow(0.4), t: 0, spin: 0, beam, glow: makeGlow(col, 3.6, 1), armed });
}
// standing on gear for a taken slot: what you wear now vs what you'd swap to, while the 3-second ring fills
function showSwapCompare(cur, next) {
  let el = $('swapCmp'); if (!el) { el = document.createElement('div'); el.id = 'swapCmp'; $('app').appendChild(el); }
  const row = (tag, it) => `<div class="cmp"><small>${tag}</small><b style="color:${RARITY[it.rarity].color}">${it.name}</b><span>${RARITY[it.rarity].name} ${SLOT_NAMES[it.slot]}</span><p>${gearLines(it).join('<br>')}</p></div>`;
  const diff = gearScore(next) - gearScore(cur), verdict = diff > 0 ? '<em class="up">▲ BETTER</em>' : diff < 0 ? '<em class="down">▼ WEAKER</em>' : '<em>= SIMILAR</em>';
  el.innerHTML = `<div class="cmphead">SWAP? STAND STILL 3s ${verdict}</div><div class="cmpgrid">${row('WEARING', cur)}<i>➜</i>${row('ON THE FLOOR', next)}</div>`;
  el.className = 'show';
}
function hideSwapCompare() { const el = $('swapCmp'); if (el) el.className = ''; G.cmpFor = null; }
// gear never goes to a bag: an empty slot equips it, otherwise it lands on the floor next to you for the 3-second swap
function equipOrStash(item, force = false) {
  const p = player, cur = p.gear[item.slot], R = RARITY[item.rarity];
  if (cur && !force) { dropGear(p.x, p.z, 0, item, true); toast(`<span style="color:${R.color}">${item.name}</span>`, `ON THE FLOOR · STAND ON IT 3s TO SWAP`); return; }
  if (cur) dropGear(p.x, p.z, 0, cur); // swapped out: waits on the floor until you step off it
  p.bag = p.bag.filter((it) => it !== item);
  p.gear[item.slot] = item; recalcStats(); sfx('card');
  toast(`<span style="color:${R.color}">${item.name}</span>`, `EQUIPPED · ${gearLines(item).join(' · ')}`);
}
function gearCard(minR) {
  const item = rollGear(rand, G.floor, player.g.luck + player.der.loot, minR), R = RARITY[item.rarity];
  return { tag: `${R.name.toUpperCase()} ${SLOT_NAMES[item.slot].toUpperCase()}`, name: item.name, info: gearLines(item).join(', '), color: R.color, icon: gearIcon(item), legend: item.rarity === 3, pick: () => equipOrStash(item) };
}
function discover(id) {
  if (meta.codex.includes(id)) return;
  meta.codex.push(id); saveMeta();
  if (G.state === 'play' || G.state === 'cards') later(0.3, () => toast('NEW SPELL DISCOVERED', `${spellDef(id).name} · codex ${meta.codex.length}/${TOTAL_SPELLS}`));
}
function bossReward(e) {
  const id = Object.keys(BOSS_SPELLS).find((k) => BOSS_SPELLS[k].boss === e.type);
  if (!id) return;
  G.bossSpell = id;
  const el = BOSS_SPELLS[id].unlocks;
  if (el && !meta.elements.includes(el)) { meta.elements.push(el); saveMeta(); later(2, () => toast('ELEMENT UNLOCKED', `${ELEMENTS[el].name} spells can now appear`)); }
}
// ---------- icons: element emblem(s) + a shape glyph badge ----------
const iconCache = new Map();
function elementIconSrc(el) { return el === 'venom' ? ['spells', 5] : ['elements', ELEMENTS[el].icon]; }
let ICONS = new Set();
const iconPath = (name) => (ICONS.has(name) ? `icons/${name}.png` : null);
const gearIcon = (it) => iconPath(`gear_${it.slot}_${it.rarity}`) || iconURL('gear', SLOTS.indexOf(it.slot));
const elemIcon = (el) => iconPath('el_' + el) || iconURL(...elementIconSrc(el));
function spellIcon(def) {
  const painted = iconPath(def.id.replace('+', '_'));
  if (painted) return painted;
  if (iconCache.has(def.id)) return iconCache.get(def.id);
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.imageSmoothingEnabled = true;
  const drawIcon = (src, clip) => {
    const s = sheets[src[0]]; if (!s) return;
    g.save(); if (clip) clip();
    const k = 56 / Math.max(s.w, s.h);
    g.drawImage(s.canvas, src[1] * s.w, 0, s.w, s.h, 32 - s.w * k / 2, 32 - s.h * k / 2, s.w * k, s.h * k);
    g.restore();
  };
  if (def.bossSpell) drawIcon([({ boss: 'boss', tyrant: 'tyrant', eyeboss: 'hollow', sporeboss: 'sporemother', golemboss: 'stoneking', wraithboss: 'wraith' })[def.boss], 0]);
  else if (def.legendary) drawIcon(['spells', { meteor: 1, hole: 4, still: 2 }[def.id]]);
  else if (def.fused) {
    drawIcon(elementIconSrc(def.els[0]), () => { g.beginPath(); g.moveTo(0, 0); g.lineTo(64, 0); g.lineTo(0, 64); g.clip(); });
    drawIcon(elementIconSrc(def.els[1]), () => { g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 64); g.lineTo(0, 64); g.clip(); });
  } else drawIcon(elementIconSrc(def.els[0]));
  if (def.shape && SHAPES[def.shape]) {
    g.fillStyle = 'rgba(10,8,20,.85)'; g.beginPath(); g.arc(50, 50, 13, 0, 7); g.fill();
    g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 2.2; g.lineCap = 'round';
    drawGlyph(g, def.shape, 50, 50);
  }
  const url = c.toDataURL(); iconCache.set(def.id, url);
  return url;
}
function drawGlyph(g, shape, x, y) {
  const L = (a, b, c, d) => { g.beginPath(); g.moveTo(x + a, y + b); g.lineTo(x + c, y + d); g.stroke(); };
  const C = (cx, cy, r, fill) => { g.beginPath(); g.arc(x + cx, y + cy, r, 0, 7); fill ? g.fill() : g.stroke(); };
  switch (shape) {
    case 'bolt': L(-6, 4, 6, -4); L(6, -4, 1, -4); L(6, -4, 5, 1); break;
    case 'lance': L(-8, 6, 8, -6); L(8, -6, 3, -6); L(8, -6, 7, -1); L(-8, 2, -4, 6); break;
    case 'orb': C(0, 0, 5, true); break;
    case 'nova': C(0, 0, 7); C(0, 0, 2, true); break;
    case 'chain': g.beginPath(); g.moveTo(x - 7, y - 5); g.lineTo(x - 1, y - 1); g.lineTo(x - 4, y + 1); g.lineTo(x + 7, y + 6); g.stroke(); break;
    case 'halo': C(0, -6, 2, true); C(5, 4, 2, true); C(-5, 4, 2, true); C(0, 0, 6); break;
    case 'fan': L(-6, 6, -7, -4); L(-6, 6, 0, -7); L(-6, 6, 7, -3); break;
    case 'rain': L(-5, -6, -7, 0); L(0, -4, -2, 2); L(5, -6, 3, 0); C(0, 6, 2, true); break;
    case 'burst': for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; L(Math.cos(a) * 3, Math.sin(a) * 3, Math.cos(a) * 7, Math.sin(a) * 7); } break;
    case 'field': g.globalAlpha = 0.5; C(0, 2, 7, true); g.globalAlpha = 1; C(0, 2, 7); break;
    case 'glaive': g.beginPath(); g.arc(x, y, 6, 0.3, 5.2); g.stroke(); L(4, -4, 7, -7); break;
    case 'sigil': g.beginPath(); g.moveTo(x, y - 7); g.lineTo(x + 7, y); g.lineTo(x, y + 7); g.lineTo(x - 7, y); g.closePath(); g.stroke(); C(0, 0, 1.5, true); break;
    case 'ray': g.lineWidth = 4; L(-7, 5, 7, -5); g.lineWidth = 2.2; break;
    case 'wisp': C(0, -2, 4, true); L(-3, 2, -5, 7); L(0, 2, 0, 7); L(3, 2, 5, 7); break;
  }
}
const PG = {
  shard: new THREE.OctahedronGeometry(0.15, 0),
  ball: new THREE.IcosahedronGeometry(0.16, 1),
};
const projMats = new Map();
function pMat(color, add, opacity = 1) {
  const key = color + '|' + add + '|' + opacity;
  if (!projMats.has(key)) projMats.set(key, new THREE.MeshBasicMaterial(add ? { color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false } : { color }));
  return projMats.get(key);
}
// solid core + glowing shell(s); x axis points along the flight direction
function makeProjMesh(kind, color) {
  const g = new THREE.Group();
  const light = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.65).getHex();
  const add = (geo, mat, sx, sy, sz) => { const m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); g.add(m); return m; };
  if (kind === 'bolt') { g.userData.spin = add(PG.shard, pMat(light, false), 2.4, 0.75, 0.75); add(PG.shard, pMat(color, true, 0.55), 3.2, 1.5, 1.5); }
  else if (kind === 'fire') { add(PG.ball, pMat(0xfff2b0, false), 1, 1, 1); g.userData.pulse = add(PG.ball, pMat(0xff7a1a, true, 0.8), 1.9, 1.9, 1.9); add(PG.ball, pMat(0xff2a00, true, 0.3), 2.8, 2.6, 2.6); }
  else if (kind === 'venom') { add(PG.ball, pMat(light, false), 1.5, 0.55, 0.55); add(PG.ball, pMat(color, true, 0.6), 2.3, 1, 1); }
  else if (kind === 'lance') { g.userData.spin = add(PG.shard, pMat(light, false), 4.2, 0.6, 0.6); add(PG.shard, pMat(color, true, 0.5), 5, 1.3, 1.3); }
  else if (kind === 'glaive') { g.userData.spinY = add(PG.shard, pMat(light, false), 1.7, 0.35, 1.7); add(PG.ball, pMat(color, true, 0.5), 2.2, 0.6, 2.2); }
  else if (/^(javelin|axe|arrow|skull)S?$/.test(kind)) {
    const hk = kind.replace(/S$/, ''), sp = new THREE.Group(); g.add(sp);
    const part = (geo, c, sx, sy, sz, x, y = 0) => { const m = new THREE.Mesh(geo, pMat(c, false)); m.scale.set(sx, sy, sz); m.position.set(x, y, 0); sp.add(m); return m; };
    if (hk === 'javelin') { part(boxGeo, 0x8a5a2a, 0.9, 0.05, 0.05, -0.15, -0.025); part(PG.shard, 0xe8e8f0, 1.6, 0.45, 0.45, 0.36); }
    if (hk === 'axe') { part(boxGeo, 0x7a4a22, 0.5, 0.05, 0.05, -0.1, -0.025); part(boxGeo, 0xc8d0dc, 0.14, 0.26, 0.05, 0.16, -0.13); g.userData.spinZ = sp; }
    if (hk === 'arrow') { part(boxGeo, 0xd8b880, 0.7, 0.03, 0.03, -0.1, -0.015); part(PG.shard, 0xd0d4dc, 0.9, 0.35, 0.35, 0.26); part(boxGeo, 0xffffff, 0.12, 0.1, 0.02, -0.42, -0.05); }
    if (hk === 'skull') { part(PG.ball, 0xf2ece0, 1.1, 1, 1, 0); part(boxGeo, 0x101010, 0.05, 0.05, 0.06, 0.15, 0.02).position.z = 0.06; part(boxGeo, 0x101010, 0.05, 0.05, 0.06, 0.15, 0.02).position.z = -0.06; }
    add(PG.ball, pMat(color, true, 0.45), hk === 'skull' ? 2 : 2.6, 1, 1);
    if (kind.endsWith('S')) g.scale.setScalar(0.7);
  }
  else { add(PG.ball, pMat(light, false), 0.8, 0.8, 0.8); g.userData.pulse = add(PG.ball, pMat(color, true, 0.7), 1.7, 1.7, 1.7); } // enemy orb
  scene.add(g);
  return g;
}
function placeProj(p, y, dt) {
  p.t3 = (p.t3 || 0) + dt;
  const bob = Math.sin(p.t3 * 14) * 0.04;
  p.mesh.position.set(p.x, y + bob, p.z);
  p.mesh.rotation.y = -Math.atan2(p.vz, p.vx);
  if (p.mesh.userData.spin) p.mesh.userData.spin.rotation.x += dt * 18;
  if (p.mesh.userData.spinY) p.mesh.userData.spinY.rotation.y += dt * 25;
  if (p.mesh.userData.spinZ) p.mesh.userData.spinZ.rotation.z -= dt * 22;
  if (p.mesh.userData.pulse) p.mesh.userData.pulse.scale.setScalar(1.8 + Math.sin(p.t3 * 30) * 0.15);
  p.glow.position.set(p.x, y + bob, p.z);
  p.shadow.position.set(p.x, 0.02, p.z);
}
function killProj(p) { scene.remove(p.mesh); scene.remove(p.shadow); killGlow(p.glow); }
function addProj(o) {
  o.vx = Math.cos(o.a) * o.speed; o.vz = Math.sin(o.a) * o.speed;
  if (o.y === undefined) { o.x += Math.cos(o.a) * 0.35; o.z += Math.sin(o.a) * 0.35; o.y = 0.7; }
  o.glow = makeGlow(o.color, o.size * 0.8, 0.7); o.glow.position.set(o.x, 0.7, o.z);
  o.mesh = makeProjMesh(o.kind, o.color); o.shadow = makeShadow(o.kind === 'fire' ? 0.7 : 0.45);
  o.mesh.scale.setScalar(o.kind === 'fire' ? 1.1 : 1);
  o.hit = new Set(); o.maxLife = o.life;
  placeProj(o, o.y, 0);
  projs.push(o);
}
function explode(p) {
  const r = p.aoe, col = p.color || 0xffa040;
  addRing(p.x, p.z, 0.3, r, 0.3, col);
  burst(p.x, 0.5, p.z, col, 30, 7, 0.6, 0.5);
  burst(p.x, 0.5, p.z, 0xffe08a, 12, 4, 0.5, 0.3);
  for (let k = 0; k < 8; k++) spark(p.x + rr(-0.5, 0.5), 0.4, p.z + rr(-0.5, 0.5), 0x3a2a2a, { vy: 1.5 + Math.random(), s: 0.8, life: 0.9, drag: 1 });
  chunk(p.x, 0.3, p.z, 0x3a2a24, 5, 5, 0.1);
  splat(p.x, p.z, 0x1a1210, r * 1.3, 1);
  fxLight.position.set(p.x, 1.2, p.z); fxLight.intensity = 40;
  let hits = 0;
  for (const e of [...enemies]) {
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (d < r + e.r) { hurtEnemy(e, p.dmg * (1 - 0.35 * d / (r + e.r)), e.x - p.x, e.z - p.z, 6, col, p.els); hits++; }
  }
  for (const pot of [...pots]) if (Math.hypot(pot.x - p.x, pot.z - p.z) < r) breakPot(pot);
  if (p.plague) fires.push({ x: p.x, z: p.z, r: r, life: 3.5, dmg: 0, tick: 0, poison: true, glow: makeGlowAt(p.x, 0.25, p.z, 0x5fff4a, r * 2.4, 0.35) });
  if (p.burn) fires.push({ x: p.x, z: p.z, r: r * 0.8, life: 3, dmg: p.dmg * 0.25, tick: 0, glow: makeGlowAt(p.x, 0.2, p.z, 0xff5a10, r * 2.2, 0.45) });
  addShake(Math.min(0.3, 0.04 + hits * 0.035)); if (hits >= 3) G.hitstop = Math.max(G.hitstop, 0.03); sfx('boom'); // shake follows the impact
}
const ringGeo = flatRingGeo;
function addRing(x, z, r0, r1, dur, color) {
  const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: softRingTex, color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
  mesh.position.set(x, 0.12, z); scene.add(mesh);
  rings.push({ mesh, t: 0, dur, r0, r1 });
}

// ---------- player ----------
function damagePlayer(n, fx, fz) {
  if (!player.alive || player.iframe > 0 || G.state !== 'play' || BENCH) return;
  if (Math.random() < player.g.dodge + player.der.dodge + (player.cloakDodge || 0)) { addText(player.x, 1.4, player.z, 'DODGE', '#9fe7ff', 1); player.iframe = 0.35; sfx('whoosh'); return; }
  if (player.g.flags.mirror && player.mirrorRoom !== G.curRoom) { player.mirrorRoom = G.curRoom; addText(player.x, 1.4, player.z, 'BLOCKED', '#ffffff', 1.1); player.iframe = 0.6; flash(0.2); sfx('lock'); return; }
  n = Math.ceil(n * (1 + Math.floor((G.floor - 1) / 4) * 0.5)); // hits hurt more every 4 floors
  player.hp -= n; player.iframe = 1.1;
  const dx = player.x - fx, dz = player.z - fz, dl = Math.hypot(dx, dz) || 1;
  player.vx += dx / dl * 9; player.vz += dz / dl * 9;
  addShake(0.55); G.hitstop = 0.09; sfx('hurt');
  $('hurt').style.transition = 'none'; $('hurt').style.opacity = 1;
  requestAnimationFrame(() => { $('hurt').style.transition = 'opacity .6s'; $('hurt').style.opacity = 0; });
  burst(player.x, 0.6, player.z, 0xff2a4a, 16, 5, 0.4, 0.5);
  splat(player.x, player.z, 0x9b0f22, 0.6);
  player.squash = 0.6;
  if (player.ember) { const fake = { x: player.x, z: player.z, aoe: 2.4, dmg: 30 }; explode(fake); }
  renderHearts();
  if (player.hp <= 0) {
    if (player.revive > 0) {
      player.revive--; player.hp = 4; player.iframe = 2.5; renderHearts();
      explode({ x: player.x, z: player.z, aoe: 3.5, dmg: 80 }); flash(0.6); toast('PHOENIX FEATHER', 'You rise again');
      return;
    }
    playerDie();
  }
}
function offerRevive() {
  G.run.adRevive = true; G.state = 'cards';
  const row = $('cardRow'); $('cardsTitle').textContent = 'SECOND CHANCE';
  row.innerHTML = '<p class="beast" style="text-align:center">Watch an ad to get back up with full health.</p>';
  const yes = document.createElement('button'); yes.className = 'adbtn big'; yes.innerHTML = '▶ WATCH AD · REVIVE';
  const no = document.createElement('button'); no.className = 'adbtn ghost'; no.textContent = 'no thanks';
  yes.addEventListener('pointerdown', async (ev) => {
    ev.stopPropagation();
    if (!(await Monet.rewarded('revive'))) return;
    $('cards').classList.add('hidden'); G.state = 'play';
    player.hp = player.maxHp; player.iframe = 3; renderHearts(); flash(0.6); sfx('heal');
    explode({ x: player.x, z: player.z, aoe: 3.5, dmg: 80 }); toast('REVIVED', 'back in the fight');
  });
  no.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); $('cards').classList.add('hidden'); G.state = 'play'; playerDie(); });
  row.append(yes, no); $('cards').classList.remove('hidden');
}
// ---------- victory: floor 50 boss down ----------
function winRewards() {
  const out = [];
  const lockedEls = ELEMENT_ORDER.filter((e) => !meta.elements.includes(e));
  const leg = Object.keys(LEGENDARY).filter((k) => k !== meta.winLegend);
  out.push({ id: 'item', name: 'Legendary Heirloom', info: 'A legendary item goes straight into your vault.', color: '#ffa040', icon: ['gear', 2],
    pick: () => { const it = rollGear(rand, WIN_FLOOR, 1, 3); if (!meta.vault[it.slot]) meta.vault[it.slot] = it; else meta.stash.push(it); return it.name; } });
  out.push({ id: 'stats', name: 'Ascended Blood', info: '+2 to every stat on every future run (stacks with each win).', color: '#c07aff', icon: ['items', 3],
    pick: () => { meta.winStats = (meta.winStats || 0) + 1; return `+${2 * meta.winStats} all stats`; } });
  if (leg.length) { const id = pick(leg); out.push({ id: 'legend', name: `Born with ${spellDef(id).name}`, info: `Start every run with ${spellDef(id).name}. ${LEGENDARY[id].info}.`, color: '#ffb340', icon: spellIcon(spellDef(id)),
    pick: () => { meta.winLegend = id; return spellDef(id).name; } }); }
  if (lockedEls.length) { const el = pick(lockedEls); out.push({ id: 'element', name: `${ELEMENTS[el].name} Unbound`, info: `Unlock ${ELEMENTS[el].name} spells for every run.`, color: ELEMENTS[el].color, icon: elemIcon(el),
    pick: () => { meta.elements.push(el); return ELEMENTS[el].name; } }); }
  out.push({ id: 'revive', name: 'Undying', info: 'One extra revive on every future run.', color: '#ff6a8a', icon: ['spells', 1], pick: () => { meta.winRevive = (meta.winRevive || 0) + 1; return 'extra revive'; } });
  out.push({ id: 'shards', name: 'Soul Hoard', info: '+2,000 soul shards.', color: '#b98cff', icon: ['items', 3], pick: () => { meta.shards += 2000; return '+2,000 shards'; } });
  return shuffle(out).slice(0, 3);
}
function showVictory() {
  if (G.state !== 'play') return;
  G.state = 'won'; G.victory = true; flash(0.8); sfx('clear'); addShake(0.6); clearRun(); // the run is over: no continue into a second win
  meta.wins = (meta.wins || 0) + 1; saveMeta();
  const opts = winRewards();
  $('cardsTitle').textContent = `VICTORY · FLOOR ${WIN_FLOOR}`;
  const row = $('cardRow'); row.innerHTML = '<p class="beast" style="text-align:center">You conquered the depths. Choose a reward to keep forever.</p>';
  opts.forEach((o) => {
    const c = document.createElement('div'); c.className = 'card legend'; c.style.setProperty('--c', o.color);
    c.innerHTML = `<div class="ci" style="--img:url(${typeof o.icon === 'string' ? o.icon : iconURL(o.icon[0], o.icon[1])})"></div><div><div class="tag">PERMANENT REWARD</div><h3>${o.name}</h3><p>${o.info}</p></div>`;
    c.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation(); const got = o.pick(); saveMeta(); sfx('heal');
      $('cards').classList.add('hidden'); toast('REWARD KEPT', got);
      G.state = 'play'; player.revive = 0; player.iframe = 0; player.hp = 0; playerDie();
    });
    row.appendChild(c);
  });
  $('cards').classList.remove('hidden');
  if (AUTO) later(1, () => row.querySelector('.card').dispatchEvent(new PointerEvent('pointerdown')));
}
function playerDie() {
  (G.deaths = G.deaths || []).push(G.floor);
  G.deadRun = lastRun; clearRun(); // the run ends here (death, victory or quit); an ad revive puts the checkpoint back
  const won = !!G.victory; G.victory = false;
  player.alive = false; G.state = 'dead'; G.deadT = 0; G.kept = false; tutHide();
  if (!won) {
    chunk(player.x, 0.6, player.z, 0xf7b6e0, 16, 6, 0.14);
    burst(player.x, 0.6, player.z, 0xff4fd8, 40, 6, 0.6, 0.9);
    player.mesh.visible = false; player.shadow.visible = false; player.staffGlow.visible = false;
    addShake(1); flash(0.5);
  }
  $('overTitle').textContent = won ? 'VICTORY' : 'YOU FELL';
  const R = G.run, gain = { depth: (G.floor - 1) * 6, slain: Math.floor(R.kills / 8), bosses: R.bosses * 30, champions: R.champs * 12 };
  if (won) { for (const k of Object.keys(gain)) gain[k] *= 3; gain.victory = 250; }
  const total = Math.max(1, Object.values(gain).reduce((a, b) => a + b, 0));
  const st = meta.stats, newBest = G.floor > st.bestFloor;
  meta.shards += total; st.shardsTotal += total; st.runs++; st.bestFloor = Math.max(st.bestFloor, G.floor);
  st.kills += R.kills; st.bosses += R.bosses; st.champs += R.champs; st.coins += R.coins; st.time += R.time; st.dmg += R.dmg; st.bestCombo = Math.max(st.bestCombo, R.bestCombo);
  const lgBefore = meta.legacy || 0, lgGain = R.kills + (G.floor - 1) * 25 + R.bosses * 80;
  meta.legacyXp = (meta.legacyXp || 0) + lgGain;
  while (meta.legacyXp >= legacyNeed(meta.legacy || 0)) { meta.legacyXp -= legacyNeed(meta.legacy || 0); meta.legacy = (meta.legacy || 0) + 1; }
  saveMeta(); G.best = st.bestFloor;
  G.deathDelta = { total, lgGain, kills: R.kills, bosses: R.bosses, champs: R.champs, coins: R.coins, time: R.time, dmg: R.dmg };
  const ms = { mage: 'INT', archer: 'DEX', warrior: 'STR', hunter: 'STR' }[player.hero.cls];
  const lgUp = meta.legacy - lgBefore;
  const affordable = UPGRADES.filter((u) => mlv(u.id) < u.max && meta.shards >= u.cost[mlv(u.id)]).length;
  later(1.5, () => {
    $('btnSanctum2').textContent = affordable ? `SANCTUM · ${affordable} UPGRADE${affordable > 1 ? 'S' : ''} READY` : 'SANCTUM';
    $('btnSanctum2').classList.toggle('ready', affordable > 0);
  });
  later(1.4, () => {
    const canRevive = !won && !G.run.adRevive && !AUTO;
    $('overStats').innerHTML = `${canRevive ? '<button class="adbtn big" id="adRevive">▶ WATCH AD · REVIVE</button>' : ''}
      ${vaultPicker()}
      <div class="shardline" style="display:none">+<b id="shardCount">0</b> soul shards</div>
      ${newBest ? `<div class="newbest">NEW BEST · FLOOR ${G.floor}</div>` : ''}
      <div class="legacy"><span>LEGACY ${meta.legacy} · +${lgGain} XP · +◆ ${total}</span><div class="xpbar"><i style="width:${Math.round(meta.legacyXp / legacyNeed(meta.legacy) * 100)}%"></i></div>
      <small>${lgUp ? `<b>LEVEL UP!</b> every run now starts with +${meta.legacy} ${ms}${meta.legacy >= 3 ? ` and +${Math.floor(meta.legacy / 3)} VIT` : ''}` : `next level: +1 ${ms} on every run`}</small></div>
      <div id="overChest"></div>
      <div id="overUps">${overUpgrades()}</div>
`;
    showScreen('over'); renderVChest('overChest'); $('btnAgain').classList.toggle('locked', vaultChoices.length > 0);
    $('btnAgain').textContent = vaultChoices.length ? 'KEEP AN ITEM FIRST' : 'PLAY AGAIN'; $('hud').classList.add('hidden');
    let shown = 0; const step = () => { shown = Math.min(total, shown + Math.ceil(total / 30)); const el = $('shardCount'); if (el) el.textContent = shown; sfx('coin', Math.min(14, Math.floor(shown / total * 14))); if (shown < total) setTimeout(step, 40); };
    setTimeout(step, 400);
    if (AUTO) { const b = document.querySelector('[data-keep]'); if (b) b.click(); later(1.5, () => startRun()); }
    if (!vaultChoices.length) $('btnAgain').classList.remove('locked');
  });
}
// ---------- Vault: keep one item per death; every run starts wearing the vault ----------
let vaultChoices = [];
function vaultPicker() {
  const items = [...Object.values(player.gear), ...player.bag].filter((it) => it && !it.vault);
  vaultChoices = items.sort((a, b) => gearScore(b) - gearScore(a)).slice(0, 4);
  if (!vaultChoices.length) return ''; // nothing to keep: say nothing
  return `<div class="vault keep"><span>✦ KEEP ONE ITEM FOREVER ✦</span><small>Pick one before your next run. Kept items go to your Vault.</small>${vaultChoices.map((it, k) => {
    const cur = meta.vault[it.slot], better = true;
    return `<div class="gearslot bagit" data-keep="${k}" style="--c:${RARITY[it.rarity].color}"><i class="ci" style="--img:url(${gearIcon(it)})"></i><div><b>${it.name}</b> · ${better ? 'KEEP' : 'replace ' + cur.name + '?'}<br>${gearLines(it).join(' · ')}</div></div>`;
  }).join('')}</div>`;
}
$('overStats').addEventListener('click', (e) => {
  const b = e.target.closest('[data-keep]'); if (!b || G.kept) return;
  const it = vaultChoices[+b.dataset.keep]; if (!it) return;
  const keep = { ...it, vault: undefined };
  if (!meta.vault[it.slot]) meta.vault[it.slot] = keep; else meta.stash.push(keep); // empty slot: wear it; otherwise into storage
  saveMeta(); G.kept = true; sfx('clear');
  $('btnAgain').classList.remove('locked'); $('btnAgain').textContent = 'PLAY AGAIN';
  b.closest('.vault').innerHTML = `<span>KEPT</span><small style="color:${RARITY[it.rarity].color}">${it.name}</small><small> ${meta.vault[it.slot] === keep ? 'is equipped for your next run.' : 'went to your storage. Equip it in Sanctum → Character.'}</small>`;
});
function legacyNeed(l) { return 120 + l * 70; }
function fmtNum(n) { n = Math.round(n); return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n); }
function fmtTime(t) { t = Math.round(t); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, sec = t % 60; return h ? `${h}h ${m}m` : `${m}:${String(sec).padStart(2, '0')}`; }
// all speed bonuses stack, but with diminishing returns: +50% feels fast, and it can never pass +80%
function moveSpeed(p) {
  const raw = p.speed / 5.4 * p.g.speed * p.der.speed - 1;
  const bonus = raw > 0 ? 0.8 * (1 - Math.exp(-raw / 0.8)) : raw;
  return 5.4 * (1 + bonus);
}
function tutShow(text, hand) {
  if (G.state !== 'play') return; // a delayed hint must not pop up over the death screen
  let el = $('tut'); if (!el) { el = document.createElement('div'); el.id = 'tut'; $('app').appendChild(el); }
  el.innerHTML = `${hand ? '<div class="hand">👆</div>' : ''}<b>${text}</b>`; el.className = 'show';
}
function tutHide() { const el = $('tut'); if (el) el.className = ''; }
function tutUpdate(dt) {
  const t = G.tut; if (!t || G.state !== 'play') return;
  if (t.step === 0) { t.moved += Math.hypot(player.vx, player.vz) * dt; if (t.moved > 4) { t.step = 1; tutHide(); } }
  else if (t.step === 1 && enemies.some((e) => !e.dead && e.spawn >= 1)) { t.step = 2; tutShow('YOUR SPELLS FIRE ON THEIR OWN · KEEP MOVING, DODGE'); }
  else if (t.step === 2 && G.run.kills >= 3) { t.step = 3; tutShow('NICE! CLEAR THE ROOM TO MOVE ON'); later(2.5, tutHide); meta.tutDone = true; saveMeta(); G.tut = null; }
}
function updatePlayer(dt) {
  tutUpdate(dt);
  const p = player;
  p.iframe -= dt; p.castT = (p.castT || 0) - dt;
  p.squash *= Math.exp(-8 * dt);
  let ix = input.x, iz = input.z;
  if (AUTO) [ix, iz] = botInput();
  let dropY = 0;
  if (p.dropDelay > 0) { // waiting above the floor: only a growing shadow and a few falling sparks hint where you'll land
    p.dropDelay -= dt; ix = iz = 0; dropY = 40;
    const k = 1 - Math.max(0, p.dropDelay / 1.5);
    p.shadow.scale.set(0.3 + k * 0.6, 1, (0.3 + k * 0.6) * 0.8);
    if (Math.random() < k) spark(p.x + rr(-0.4, 0.4), 4 + Math.random() * 3, p.z + rr(-0.4, 0.4), 0xff7fe0, { vy: -8, s: 0.25, life: 0.5, drag: 0 });
  } else if (p.drop > 0) {
    p.drop -= dt; ix = iz = 0;
    const k = Math.max(0, p.drop / 0.22); dropY = k * k * 6;
    for (let q = 0; q < 3; q++) spark(p.x + rr(-0.15, 0.15), dropY + rr(0, 1.5), p.z, 0xff7fe0, { s: 0.5, life: 0.18, drag: 0 }); // streak
    if (p.drop <= 0) {
      // IMPACT: hard fast shake, a beat of hit-stop, flash, shockwaves, a crater and flying floor
      p.shadow.scale.set(0.8, 1, 0.64);
      p.squash = 1; trauma = 1; G.hitstop = 0.08; flash(0.3); sfx('slam'); sfx('land');
      addRing(p.x, p.z, 0.2, 3.2, 0.35, 0xffffff); addRing(p.x, p.z, 0.2, 2.2, 0.5, 0xff7fe0);
      splat(p.x, p.z, 0x050505, 2.4); splat(p.x, p.z, 0x2a1030, 1.4);
      const fcol = G.pal ? G.pal.floor : 0x8a96a0;
      chunk(p.x, 0.2, p.z, fcol, 16, 7, 0.16); chunk(p.x, 0.2, p.z, 0x3a3a44, 8, 5, 0.1);
      for (let a = 0; a < 36; a++) { const an = a / 36 * Math.PI * 2; spark(p.x + Math.cos(an) * 0.3, 0.12, p.z + Math.sin(an) * 0.3, a % 3 ? 0xc8d0e0 : 0xff7fe0, { vx: Math.cos(an) * 9, vz: Math.sin(an) * 9, vy: rr(0.5, 2), s: 0.5, life: 0.45, drag: 5 }); }
      burst(p.x, 0.6, p.z, 0xffd0f4, 24, 6, 0.5, 0.5);
      fxLight.position.set(p.x, 1.5, p.z); fxLight.color.set(0xff7fe0); fxLight.intensity = 60; later(0.4, () => fxLight.color.set(0xffa040));
      for (const pot of [...pots]) if (Math.hypot(pot.x - p.x, pot.z - p.z) < 2.5) breakPot(pot);
    }
  }
  const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
  {
    const spd0 = moveSpeed(p), tx = ix * spd0, tz = iz * spd0;
    const acc = il > 0.1 ? 38 : 26;
    p.vx += clamp(tx - p.vx, -acc * dt, acc * dt); p.vz += clamp(tz - p.vz, -acc * dt, acc * dt);
  }
  moveCircle(p, p.vx * dt, p.vz * dt, p.r, false);
  const spd = Math.hypot(p.vx, p.vz);
  if (Math.abs(p.vx) > 0.3) p.face = p.vx > 0 ? 1 : -1;
  if (p.castT > 0) p.face = p.aimX >= 0 ? 1 : -1;
  // walk animation: frame cycle, bounce and little dust puffs (the reference wizard bobs as it runs)
  let bob = 0, tilt = 0, hop = 0;
  if (spd > 0.6) {
    p.anim += dt * 6.5; // same hop rhythm at any speed; faster just means longer hops
    hop = Math.abs(Math.sin(p.anim * Math.PI));
    bob = hop * 0.13;
    tilt = Math.sin(p.anim * Math.PI) * 0.16 - p.face * 0.08;
    p.step -= dt;
    if (p.step <= 0) { p.step = 0.16; spark(p.x - p.vx * 0.04, 0.06, p.z - p.vz * 0.04, 0x9aa4b4, { vy: 0.6, vx: rr(-0.5, 0.5), vz: rr(-0.5, 0.5), s: 0.3, life: 0.35, drag: 4 }); }
  } else { p.anim = 0; bob = Math.sin(G.time * 2.4) * 0.07; tilt = Math.sin(G.time * 1.3) * 0.05; } // idle: hover and sway
  p.hover = (p.hover || 0) + ((spd > 0.6 ? 0 : 0.16) - (p.hover || 0)) * Math.min(1, dt * 4); bob += p.hover;
  const m = p.mesh, u = m.material.uniforms;
  const breathe = spd < 0.6 ? Math.sin(G.time * 3) * 0.02 : 0;
  const land = spd > 0.6 ? (1 - hop) * 0.12 : 0; // squash at the bottom of each hop
  setSpriteScale(m, (1 + p.squash * 0.3 - breathe + land) * (p.castT > 0 ? 1.08 : 1), 1 - p.squash * 0.3 + breathe - land + (p.castT > 0 ? -0.05 : 0));
  m.position.set(p.x, bob + dropY, p.z);
  billboard(m, tilt);
  u.uFlip.value = p.face < 0 ? 1 : 0;
  u.uFlash.value = p.iframe > 0 ? (Math.sin(G.time * 40) > 0 ? 0.7 : 0) : 0;
  u.uFlashCol.value.set(0xff3050);
  m.visible = p.alive;
  p.shadow.position.set(p.x, 0.02, p.z);
  pLight.position.set(p.x, 1.6, p.z + 0.4);
  pLight.intensity = 18 + (p.castT > 0 ? 7 : 0) + Math.sin(G.time * 9) * 0.6;
  // staff sparkle
  const tp = staffTip();
  // charge-up: the crystal swells in the colour of the next spell as its cooldown runs out, sparks get sucked in
  let next = null;
  for (const sp of spells) if (!next || sp.t < next.t) next = sp;
  const hasTarget = enemies.some((e) => !e.dead && !e.hidden && e.spawn >= 0.3);
  const charge = next && hasTarget ? 1 - clamp(next.t / 0.5, 0, 1) : 0;
  const col = next ? SPELLS[next.id].color : '#ff7fe0';
  p.staffGlow.position.copy(tp); p.staffGlow.visible = p.alive;
  p.staffGlow.material.color.set(col);
  p.staffGlow.material.opacity = 0.55 + charge * 0.45;
  p.staffGlow.scale.setScalar(0.32 + Math.sin(G.time * 6) * 0.04 + charge * charge * 0.95 + (charge > 0.85 ? Math.sin(G.time * 40) * 0.08 : 0) + (p.castT > 0 ? p.castT * 2.6 : 0));
  if (charge > 0.35 && Math.random() < charge) {
    const a = Math.random() * 6.28, r = 0.35 + Math.random() * 0.25, ox = Math.cos(a) * r, oy = (Math.random() - 0.3) * r, oz = Math.sin(a) * r * 0.5;
    spark(tp.x + ox, tp.y + oy, tp.z + oz, col, { vx: -ox * 5.5, vy: -oy * 5.5, vz: -oz * 5.5, s: 0.18 + charge * 0.12, life: 0.18, drag: 0 });
  } else if (Math.random() < 0.12) spark(tp.x, tp.y, tp.z, 0xff9be8, { vy: 0.5, s: 0.14, life: 0.4, spread: 0.25 });
}
let ghostT = 0;
function ghostTrail() {
  ghostT -= 1 / 60;
  if (ghostT > 0) return; ghostT = 0.04;
  const g = makeSprite('wizard'); const u = g.material.uniforms;
  u.uFlash.value = 0.8; u.uFlashCol.value.set(0xff6fe0); u.uFlip.value = player.face < 0 ? 1 : 0;
  g.material.transparent = true; u.uAlpha.value = 0.6;
  g.position.set(player.x, 0, player.z); g.quaternion.copy(camera.quaternion);
  texts.push({ ghost: g, life: 0.25 });
}
// something ended up inside a pillar (knockback, a spawn, a coin bounce): move it to the nearest open tile
function unstick(o) {
  if (cellAt(o.x, o.z) !== OBST) return;
  const ci = Math.floor(o.x), cj = Math.floor(o.z);
  let best = null, bd = 9;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    if (cellAt(ci + di + 0.5, cj + dj + 0.5) !== FLOOR) continue;
    const d = Math.hypot(ci + di + 0.5 - o.x, cj + dj + 0.5 - o.z);
    if (d < bd) { bd = d; best = [ci + di + 0.5, cj + dj + 0.5]; }
  }
  if (best) { o.x = best[0]; o.z = best[1]; }
}
function moveCircle(o, dx, dz, r, fly) {
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / 0.25) || 1;
  dx /= steps; dz /= steps;
  for (let s = 0; s < steps; s++) {
    if (dx) { const nx = o.x + dx, ex = nx + Math.sign(dx) * r; if (!solid(ex, o.z - r * 0.8, fly) && !solid(ex, o.z + r * 0.8, fly)) o.x = nx; else o.wallHit = true; }
    if (dz) { const nz = o.z + dz, ez = nz + Math.sign(dz) * r; if (!solid(o.x - r * 0.8, ez, fly) && !solid(o.x + r * 0.8, ez, fly)) o.z = nz; else o.wallHit = true; }
  }
}

// ---------- pickups / props ----------
function dropPickup(x, z, kind) {
  const mesh = makeSprite('items', kind === 'heart' ? 0.5 : 0.38, kind === 'heart' ? 2 : 0);
  const a = Math.random() * Math.PI * 2, v = rr(1, 3.5);
  pickups.push({ kind, x, z, y: 0.3, vx: Math.cos(a) * v, vz: Math.sin(a) * v, vy: rr(4, 7), mesh, shadow: makeShadow(0.35), t: 0, spin: Math.random() * 6 });
}
function updatePickups(dt) {
  G.hold = null; // the countdown ring is set again by whatever the player is standing on (a gear swap, a shop pedestal)
  if ((G.coinT -= dt) <= 0) G.coinChain = 0;
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.t += dt;
    const dx = player.x - p.x, dz = player.z - p.z, d = Math.hypot(dx, dz);
    const mag = player.magnet * player.g.magnet;
    const wanted = p.kind !== 'gear' && !(p.kind === 'heart' && player.hp >= player.maxHp); // full-health hearts stay on the floor for later
    const pulled = wanted && p.t > 0.5 && d < mag && player.alive;
    if (pulled) {
      const pull = 14 * (1 - d / mag) + 4;
      p.vx += dx / d * pull * dt * 4; p.vz += dz / d * pull * dt * 4;
    }
    p.vy -= 22 * dt; p.y += p.vy * dt;
    if (p.y < 0.05) { p.y = 0.05; p.vy = Math.abs(p.vy) > 1.5 ? -p.vy * 0.45 : 0; p.vx *= 0.8; p.vz *= 0.8; }
    p.vx *= Math.exp(-2 * dt); p.vz *= Math.exp(-2 * dt);
    moveCircle(p, p.vx * dt, p.vz * dt, 0.1, pulled); // pulled pickups pass over pillars instead of snagging on them
    if (!pulled && p.y <= 0.05) unstick(p);
    p.mesh.position.set(p.x, p.y + Math.sin(p.t * 4) * 0.04, p.z);
    p.mesh.quaternion.copy(camera.quaternion);
    if (p.kind === 'coin') setSpriteScale(p.mesh, Math.abs(Math.cos(p.t * 5 + p.spin)) * 0.9 + 0.1, 1);
    if (p.beam) { p.beam.position.set(p.x, 2.5, p.z); p.glow.position.set(p.x, p.y + 0.3, p.z); p.beam.material.opacity = 0.75 + Math.sin(p.t * 4) * 0.25; p.beam.scale.x = p.beam.scale.z = 1 + Math.sin(p.t * 4) * 0.25; }
    p.shadow.position.set(p.x, 0.02, p.z);
    if (p.kind === 'gear') { if (d > 0.9) p.armed = true; if (d >= 0.5) { p.hold = 0; p.shown = false; if (G.cmpFor === p) hideSwapCompare(); } } // stepping off resets the swap
    if (d < 0.5 && p.t > 0.35 && player.alive) {
      if (p.kind === 'coin') { const got = 1 + (Math.random() < (G.coinMul || 1) - 1 ? 1 : 0); G.coins += got; G.run.coins += got; sfx('coin', G.coinChain++); G.coinT = 0.7; spark(p.x, 0.4, p.z, 0xffd34f, { s: 0.5, life: 0.2, drag: 0 }); $('coins').textContent = G.coins; }
      else if (p.kind === 'gear') {
        if (p.t < 0.6) continue;
        const cur = player.gear[p.item.slot];
        if (cur) { // the slot is taken: stand on it for 3 seconds to swap; the old piece drops where you stand
          if (!p.armed) continue; // a piece you just swapped out waits until you step off it
          if (!p.shown) { p.shown = true; showSwapCompare(cur, p.item); G.cmpFor = p; }
          p.hold = (p.hold || 0) + dt; G.hold = { p: p.hold / 3, left: 3 - p.hold, col: RARITY[p.item.rarity].color };
          if (p.hold < 3) continue;
          hideSwapCompare(); player.gear[p.item.slot] = p.item; recalcStats(); sfx('card');
          toast(`<span style="color:${RARITY[p.item.rarity].color}">${p.item.name}</span>`, `EQUIPPED · ${gearLines(p.item).join(' · ')}`);
          dropGear(p.x, p.z, 0, cur);
        } else equipOrStash(p.item);
        scene.remove(p.beam); killGlow(p.glow);
      }
      else if (p.kind === 'heart') { if (player.hp >= player.maxHp) continue; player.hp = Math.min(player.maxHp, player.hp + 2); sfx('heal'); renderHearts(); burst(p.x, 0.5, p.z, 0xff4a6a, 10, 3, 0.4, 0.5); addText(player.x, 1.4, player.z, '+1', '#ff6a8a', 1.2); }
      killMesh(p.mesh); scene.remove(p.shadow); pickups.splice(i, 1);
    }
  }
}
function breakPot(pot) {
  const i = pots.indexOf(pot); if (i < 0) return;
  pots.splice(i, 1); scene.remove(pot.mesh);
  if (pot.barrel) {
    chunk(pot.x, 0.4, pot.z, 0xa8231c, 10, 7, 0.14);
    explode({ x: pot.x, z: pot.z, aoe: 2.5, dmg: 55 });
    burst(pot.x, 0.6, pot.z, 0xffe08a, 20, 9, 0.7, 0.5);
    addShake(0.4); G.hitstop = Math.max(G.hitstop, 0.05);
    if (player.alive && Math.hypot(player.x - pot.x, player.z - pot.z) < 2.2) damagePlayer(1, pot.x, pot.z);
    return;
  }
  chunk(pot.x, 0.3, pot.z, 0xa8643c, 8, 4, 0.12); sfx('pot');
  if (rand() < 0.45) dropPickup(pot.x, pot.z, 'coin');
  if (rand() < 0.02 && player.hp < player.maxHp) dropPickup(pot.x, pot.z, 'heart');
}
function updateProps(dt) {
  for (const p of props) {
    if (p.glow) p.glow.material.opacity = (p.glowBase = p.glowBase || p.glow.material.opacity) * (0.75 + Math.sin(G.time * 3) * 0.25);
    const d = Math.hypot(player.x - p.x, player.z - p.z);
    if (p.kind === 'chest' && !p.opened) {
      p.mesh.quaternion.copy(camera.quaternion);
      p.mesh.position.y = 0.08 + Math.abs(Math.sin(G.time * 2)) * 0.06;
      if (p.mimic && d < 2.2 && Math.random() < 0.04) { p.mesh.position.y += 0.12; spark(p.x, 0.5, p.z, 0x3a2418, { vy: 2, s: 0.3, life: 0.3 }); } // it twitches...
      if (d < 0.9 && p.mimic) {
        p.opened = true; killMesh(p.mesh); p.mesh = null; killGlow(p.glow); p.glow = null;
        const r = p.room; r.cleared = false; r.active = true; r.waves = 0; r.mimic = true; lockRoom(r, true);
        const m = spawnEnemy('mimic', p.x, p.z, true); m.spawn = 1; m.state = 'wait'; m.st = 0.5;
        banner('MIMIC!', 'THE CHEST BITES BACK'); addShake(0.6); flash(0.4); sfx('hurt');
        damagePlayer(1, p.x, p.z);
        continue;
      }
      if (d < 0.9) {
        p.opened = true; killMesh(p.mesh); p.mesh = null; G.saveDue = true; G.pendT = G.run.time;
        burst(p.x, 0.6, p.z, 0xffd34f, 40, 6, 0.5, 0.8); chunk(p.x, 0.4, p.z, 0x8a5a2a, 10, 5, 0.13); flash(0.3); addShake(0.3);
        for (let k = 0; k < 6; k++) dropPickup(p.x, p.z, 'coin');
        sfx('clear');
        later(0.4, () => { if (!G.run.boon) { G.run.boon = true; openCards('TREASURE', boonOptions()); } else openCards(p.gold ? 'GOLDEN CHEST' : 'TREASURE', relicOptions(1).concat(upgradeOptions().slice(0, 1), [gearCard(p.gold ? 2 : 1)])); });
      }
    }
    if (p.kind === 'shop' && !p.sold) {
      p.mesh.quaternion.copy(camera.quaternion);
      p.mesh.position.y = 0.75 + Math.sin(G.time * 2 + p.x) * 0.06;
      const buyT = 1.5; // stand on the pedestal to buy, like the stairs
      if (d < 0.75 && G.coins >= p.offer.price) { p.hold = (p.hold || 0) + dt; G.hold = { p: p.hold / buyT, left: buyT - p.hold, col: '#7fffd4' }; }
      else p.hold = 0;
      if (d < 0.75) {
        if (G.coins >= p.offer.price && p.hold >= buyT) {
          p.hold = 0;
          G.coins -= p.offer.price; $('coins').textContent = G.coins;
          p.sold = true; killMesh(p.mesh); killGlow(p.glow); p.glow = null; G.saveDue = true; sfx('heal'); burst(p.x, 0.8, p.z, 0x7fffd4, 20, 4, 0.4, 0.6);
          if (p.offer.kind === 'heal') { player.hp = Math.min(player.maxHp, player.hp + 2); renderHearts(); toast('HEALED', '+1 heart'); }
          if (p.offer.kind === 'upgrade') { const up = spells.filter((s) => s.lv < 5 && !spellDef(s.id).legendary); if (up.length) { const s = pick(up); s.lv++; buildSpellHud(); toast(spellDef(s.id).name.toUpperCase() + ' LV' + s.lv, levelText(spellDef(s.id), s.lv)); } }
          if (p.offer.kind === 'gear') equipOrStash(rollGear(rand, G.floor, player.g.luck + player.der.loot, 1));
          if (p.offer.kind === 'relic') { const r = relicOptions(1)[0]; r.pick(); }
        } else if (!p.warned || G.time - p.warned > 2) { p.warned = G.time; toast(`${p.offer.price} COINS`, p.offer.label); }
      }
    }
    if (p.kind === 'shrine') {
      p.mesh.quaternion.copy(camera.quaternion);
      if (!p.used && Math.random() < 0.3) spark(p.x + rr(-0.2, 0.2), 1.1, p.z, 0xff2a4a, { vy: 1.2, s: 0.25, life: 0.6, drag: 0 });
      if (p.used === false && d > 1.6) p.armed = true;
      if (!p.used && d < 0.9 && G.state === 'play' && p.armed !== false) {
        p.armed = false;
        p.used = true; G.saveDue = true; G.pendT = G.run.time;
        later(0.2, () => openCards('BLOOD SHRINE', shrineOptions(p)));
      }
    }
    if (p.kind === 'stairs') {
      p.ring.rotation.y += dt; p.ring.scale.setScalar(1.1 + Math.sin(G.time * 4) * 0.06);
      if (Math.random() < 0.5) spark(p.x + rr(-0.7, 0.7), 0.1, p.z + rr(-0.7, 0.7), 0xff4fd8, { vy: 2, s: 0.3, life: 0.7, drag: 0 });
      if (d < 0.85 && G.state === 'play') {
        p.hold = (p.hold || 0) + dt; G.hold = { p: p.hold / 3, left: 3 - p.hold, col: '#ff6ae0' };
        if (Math.random() < 0.6) spark(player.x + rr(-0.5, 0.5), 0.1, player.z + rr(-0.5, 0.5), 0xff4fd8, { vy: 2.5, s: 0.3, life: 0.6, drag: 0 });
        if (p.hold >= 3) { p.hold = 0; nextFloor(); }
      } else p.hold = 0;
    }
  }
}

// ---------- upgrade cards ----------
const isSlotSpell = (id) => { const d = spellDef(id); return d && !d.legendary && !d.bossSpell; };
const RUNES = {
  pierce: { name: 'Piercing', info: 'pierces 2 more foes', add: (r) => { r.pierce = (r.pierce || 0) + 2; } },
  bounce: { name: 'Bouncing', info: 'ricochets to the next foe (and off walls) twice', add: (r) => { r.bounce = (r.bounce || 0) + 2; } },
  seek: { name: 'Seeking', info: 'shots hunt down their target', add: (r) => { r.seek = true; } },
};
function weightedSample(list, wf, n) {
  const pool = list.slice(), out = [];
  while (out.length < n && pool.length) {
    let r = rand() * pool.reduce((a, x) => a + wf(x), 0);
    const i = pool.findIndex((x) => (r -= wf(x)) <= 0);
    out.push(pool.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}
function upgradeOptions() {
  const opts = [], specials = [];
  const owned = new Set(spells.map((s) => s.id));
  for (const s of spells) {
    const d = spellDef(s.id);
    if (s.lv < 5 && !d.legendary) opts.push({ w: 3, tag: 'UPGRADE', name: `${d.name} Lv ${s.lv + 1}`, info: levelText(d, s.lv + 1), color: d.color, icon: spellIcon(d), pick: () => { s.lv++; } });
    // runes only fit spells that shoot projectiles
    if (d.sh && (d.sh.beh === 'proj' || d.sh.beh === 'radial')) {
      const rn = s.runes || {};
      for (const [k, R] of Object.entries(RUNES)) {
        if (k === 'seek' && (rn.seek || d.sh.homing)) continue;
        if ((k === 'pierce' && (rn.pierce || 0) >= 6) || (k === 'bounce' && (rn.bounce || 0) >= 6)) continue;
        opts.push({ w: 0.7, tag: 'RUNE', name: `${R.name} ${d.name}`, info: `${d.name} ${R.info}`, color: '#9fe7ff', icon: spellIcon(d), pick: () => { s.runes = s.runes || {}; R.add(s.runes); toast(`${R.name.toUpperCase()} RUNE`, d.name); } });
      }
    }
  }
  if (spells.filter((s) => isSlotSpell(s.id)).length < 4) {
    // new spells from the elements you have unlocked; spells you have never seen are favoured
    const pool = [];
    for (const el of meta.elements) for (const sh of Object.keys(SHAPES)) { const id = el + '.' + sh; if (!owned.has(id)) pool.push(id); }
    // rarer (stronger) shapes come up less often; the card shows its tier and odds
    const tw = (id) => SPELL_TIERS[spellTier(spellDef(id))].w, total = pool.reduce((a, id) => a + tw(id), 0);
    for (const id of weightedSample(pool, tw, 6)) {
      const d = spellDef(id), isNew = !meta.codex.includes(id), T = SPELL_TIERS[spellTier(d)];
      const pct = (tw(id) / total * 100), odds = pct >= 1 ? pct.toFixed(0) : pct.toFixed(1);
      opts.push({ w: (isNew ? 1.4 : 1) * tw(id) * 0.8, tag: `${T.name} SPELL${isNew ? ' ✦ NEW' : ''} · ${odds}%`, name: d.name, info: `${d.info} · ${d.cd}s`, color: d.color, icon: spellIcon(d), pick: () => { spells.push({ id, lv: 1, t: 0.2 }); discover(id); } });
    }
  }
  // boss spells you have already earned can come back in later runs (they don't take a slot)
  for (const id of Object.keys(BOSS_SPELLS)) {
    if (!meta.codex.includes(id) || owned.has(id)) continue;
    const d = spellDef(id);
    opts.push({ w: 0.8, tag: 'BOSS SPELL', name: d.name, info: `${d.info} · no slot needed`, color: d.color, icon: spellIcon(d), pick: () => { spells.push({ id, lv: 1, t: 0.5 }); } });
  }
  // fusion: two spells of different elements, both level 3+, become one stronger spell and free a slot
  for (let i = 0; i < spells.length; i++) for (let j = i + 1; j < spells.length; j++) {
    const a = spells[i], b = spells[j];
    if (a.lv < 3 || b.lv < 3) continue;
    const fid = fusionOf(a, b);
    if (!fid) continue;
    const fd = spellDef(fid), isNew = !meta.codex.includes(fid);
    specials.push({ legend: true, tag: isNew ? 'FUSION ✦ NEW' : 'FUSION', name: fd.name, info: `${spellDef(a.id).name} + ${spellDef(b.id).name}: both effects, +20% damage, frees a slot`, color: fd.color, icon: spellIcon(fd),
      pick: () => {
        spells = spells.filter((x) => x !== a && x !== b);
        spells.push({ id: fid, lv: Math.max(a.lv, b.lv), t: 0.3, runes: { ...(a.runes || {}), ...(b.runes || {}) } });
        discover(fid); flash(0.5); addShake(0.4); sfx('clear'); toast('FUSION', fd.name.toUpperCase());
      } });
  }
  for (const r of relicOptions(2)) opts.push({ ...r, w: 1.1 });
  opts.push({ ...gearCard(0), w: 1 });
  if (player.hp < player.maxHp) opts.push({ w: player.hp <= 2 ? 4 : 1.2, tag: 'POTION', name: 'Healing Draught', info: 'Restore 2 hearts', color: '#ff6a8a', icon: ['items', 2], pick: () => { player.hp = Math.min(player.maxHp, player.hp + 4); renderHearts(); sfx('heal'); } });
  const legend = Object.keys(LEGENDARY).filter((id) => !owned.has(id));
  const lchance = legendChance();
  if (lchance > 0 && legend.length && rand() < lchance) {
    const id = pick(legend), d = spellDef(id);
    specials.push({ legend: true, tag: `LEGENDARY · ${+(lchance * 100).toFixed(1)}%`, name: d.name, info: d.info, color: '#ffb340', icon: spellIcon(d), pick: () => { spells.push({ id, lv: 1, t: 1 }); discover(id); flash(0.6); addShake(0.5); sfx('clear'); toast('LEGENDARY', d.name.toUpperCase()); } });
  }
  const out = specials.length ? [pick(specials)] : []; // a fusion or legendary, when available, is always offered
  while (out.length < 3 && opts.length) {
    const tot = opts.reduce((a, o) => a + o.w, 0); let roll = rand() * tot;
    const i = opts.findIndex((o) => (roll -= o.w) <= 0);
    out.push(opts.splice(i < 0 ? 0 : i, 1)[0]);
  }
  return out;
}
// legendary spells (outside the first-run gift) only drop deep: floors 11-19 3%, 20-29 2%, 30-39 1%, 40+ 0.5%
const legendChance = () => (G.floor < 11 ? 0 : G.floor < 20 ? 0.03 : G.floor < 30 ? 0.02 : G.floor < 40 ? 0.01 : 0.005);
// the first treasure chest of every run: pick one strong spell to feel powerful early (the first run also offers a legendary)
function boonOptions() {
  const owned = new Set(spells.map((s) => s.id)), pool = [];
  for (const el of meta.elements) for (const sh of Object.keys(SHAPES)) { const id = el + '.' + sh; if (!owned.has(id) && spellTier(spellDef(id)) >= 1) pool.push(id); }
  const gift = !meta.giftDone && meta.stats.runs === 0; // the guaranteed legendary is a one-time gift on the very first run
  const lucky = !gift && rand() < legendChance(); // after that, only deep down and rarely
  const picks = weightedSample(pool, (id) => (spellTier(spellDef(id)) === 2 ? 1.2 : 1), gift || lucky ? 2 : 3);
  const out = picks.map((id) => {
    const d = spellDef(id), T = SPELL_TIERS[spellTier(d)];
    return { tag: `${T.name} SPELL · STARTER POWER`, name: d.name, info: `${d.info} · ${d.cd}s · starts at Lv 2`, color: d.color, icon: spellIcon(d), pick: () => { spells.push({ id, lv: 2, t: 0.2 }); discover(id); } };
  });
  if (gift || lucky) {
    if (gift) { meta.giftDone = true; saveMeta(); }
    const id = pick(Object.keys(LEGENDARY).filter((k) => !owned.has(k))), d = spellDef(id);
    out.unshift({ legend: true, tag: gift ? 'LEGENDARY · BEGINNER GIFT' : `LEGENDARY · ${+(legendChance() * 100).toFixed(1)}%`, name: d.name, info: d.info, color: '#ffb340', icon: spellIcon(d), pick: () => { spells.push({ id, lv: 1, t: 1 }); discover(id); flash(0.6); addShake(0.5); sfx('clear'); } });
  }
  return out;
}
function bossSpellCard(id) {
  const d = spellDef(id), had = meta.codex.includes(id);
  discover(id);
  return { legend: true, tag: had ? 'BOSS SPELL' : 'BOSS SPELL ✦ UNLOCKED', name: d.name, info: `${d.info} · doesn't take a slot`, color: d.color, icon: spellIcon(d),
    pick: () => { const s = spells.find((x) => x.id === id); if (s) s.lv = Math.min(5, s.lv + 1); else spells.push({ id, lv: 1, t: 0.5 }); toast(d.name.toUpperCase(), 'is yours'); } };
}
function shrineOptions(p) {
  const done = () => { p.mesh.material.uniforms.uTint.value.set(0x555566); killGlow(p.glow); p.glow = null; burst(p.x, 1, p.z, 0xff2a4a, 30, 5, 0.5, 0.8); addShake(0.3); sfx('hurt'); };
  const opts = [];
  if (player.maxHp > 2) opts.push({ tag: 'BLOOD PACT', name: 'Sacrifice a heart', info: '-1 max heart. Two random spells gain +1 level.', color: '#ff3050', icon: ['items', 2],
    pick: () => { player.maxHp -= 2; player.hp = Math.min(player.hp, player.maxHp); shuffle(spells.filter((s) => s.lv < 5)).slice(0, 2).forEach((s) => s.lv++); buildSpellHud(); renderHearts(); done(); toast('BLOOD PACT', 'Your spells grow stronger'); } });
  if (player.hp > 2) opts.push({ tag: 'BLOOD PRICE', name: 'Bleed for gold', info: 'Lose 1 heart now. Gain 45 coins.', color: '#ffd34f', icon: ['items', 0],
    pick: () => { player.hp -= 2; G.coins += 45; $('coins').textContent = G.coins; renderHearts(); done(); for (let k = 0; k < 8; k++) dropPickup(p.x, p.z + 0.6, 'coin'); } });
  opts.push({ tag: 'BLOOD RELIC', name: 'Cursed relic', info: 'Gain a random relic. Enemies get 15% tougher this floor.', color: '#c070ff', icon: ['items', 5],
    pick: () => { G.curse = (G.curse || 0) + 0.15; relicOptions(1)[0].pick(); done(); } });
  opts.push({ tag: 'LEAVE', name: 'Walk away', info: 'The shrine stays dormant.', color: '#8aa0c8', icon: ['items', 1], pick: () => { p.used = false; } });
  return opts;
}
function relicOptions(n) {
  const pool = shuffle(RELICS.filter((r) => !(r.id === 'feather' && player.revive > 0) && !(r.id === 'ember' && player.ember)));
  return pool.slice(0, n).map((r) => ({ tag: 'RELIC', name: r.name, info: r.info, color: '#ffd36b', icon: iconPath('relic_' + r.id) || r.icon, pick: () => { r.apply(); player.relics.push(r.id); renderHearts(); toast(r.name.toUpperCase(), r.info); } }));
}
function openCards(title, opts) {
  if (!opts.length || G.state !== 'play') return;
  G.state = 'cards'; G.cardsOpen = performance.now();
  $('cardsTitle').textContent = title;
  const row = $('cardRow'); row.innerHTML = '';
  opts.forEach((o, k) => {
    const c = document.createElement('div'); c.className = 'card' + (o.legend ? ' legend' : ''); c.style.setProperty('--c', o.color); c.style.animationDelay = k * 0.07 + 's';
    c.innerHTML = `<div class="ci" style="--img:url(${typeof o.icon === 'string' ? o.icon : iconURL(o.icon[0], o.icon[1])})"></div><div><div class="tag">${o.tag}</div><h3>${o.name}</h3><p>${o.info}</p></div>`;
    c.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); if (performance.now() - G.cardsOpen < 350) return; chooseCard(o); });
    row.appendChild(c);
  });
  const canReroll = G.rerollFn && !G.rerolled;
  if (canReroll) {
    const rb = document.createElement('button'); rb.className = 'adbtn'; rb.innerHTML = '▶ WATCH AD · REROLL';
    rb.addEventListener('pointerdown', async (ev) => { ev.stopPropagation(); if (!(await Monet.rewarded('reroll'))) return; G.rerolled = true; const fn = G.rerollFn; G.state = 'play'; openCards(title, fn()); });
    row.appendChild(rb);
  }
  $('cards').classList.remove('hidden');
  sfx('card');
  if (AUTO) later(0.7, () => chooseCard(pick(opts)));
}
function chooseCard(o) {
  if (G.state !== 'cards') return;
  o.pick(); sfx('card'); G.rerollFn = null; G.rerolled = false; G.saveDue = true;
  $('cards').classList.add('hidden');
  G.state = 'play';
}

// ---------- HUD ----------
let heartImg = '', coinImg = '';
function renderHearts() {
  const el = $('hearts'); el.innerHTML = '';
  for (let i = 0; i < player.maxHp / 2; i++) {
    const v = clamp(player.hp - i * 2, 0, 2);
    const h = document.createElement('div'); h.className = 'heart';
    h.style.setProperty('--img', `url(${heartImg})`);
    h.innerHTML = `<i style="width:${v * 50}%"></i>`;
    el.appendChild(h);
  }
}
let spellEls = [];
function buildSpellHud() {
  const el = $('spells'); el.innerHTML = ''; spellEls = [];
  for (const s of spells) {
    const def = spellDef(s.id);
    const d = document.createElement('div'); d.className = 'spell';
    d.style.setProperty('--c', def.color); d.style.setProperty('--img', `url(${spellIcon(def)})`);
    d.innerHTML = `<div class="in"></div><div class="lv">${s.lv}</div>`;
    el.appendChild(d); spellEls.push(d);
  }
}
function updateHud() {
  spells.forEach((s, i) => {
    const el = spellEls[i]; if (!el) return;
    const cd = spellDef(s.id).cd * player.cdMul * player.g.cd * player.der.cd;
    const p = clamp(1 - s.t / cd, 0, 1);
    el.style.setProperty('--p', p.toFixed(3));
    el.classList.toggle('ready', p >= 1);
    if (s.pop) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); s.pop = 0; }
  });
}
const mm = $('minimap').getContext('2d');
function drawMinimap() {
  mm.clearRect(0, 0, 96, 96);
  const cur = G.curRoom || roomAt(player.x, player.z);
  const ox = 48 - (player.x / SX) * 13, oz = 48 - (player.z / SZ) * 13;
  for (const r of rooms) {
    if (!r.seen) continue;
    for (const o of r.links) {
      if (!o.seen) continue;
      mm.fillStyle = 'rgba(160,180,210,.5)';
      mm.fillRect(ox + (r.gx + 0.5) * 13 - 1, oz + (r.gy + 0.5) * 13 - 1, (o.gx - r.gx) * 13 + 2, (o.gy - r.gy) * 13 + 2);
    }
  }
  for (const r of rooms) {
    if (!r.seen) continue;
    const x = ox + r.gx * 13 + 2, y = oz + r.gy * 13 + 2;
    mm.fillStyle = r === cur ? '#ffffff' : r.visited ? '#5c6d8c' : '#2a3348';
    mm.fillRect(x, y, 9, 9);
    const ic = { treasure: '#ffd34f', shop: '#7fffd4', exit: '#ff4fd8', boss: '#ff3050', shrine: '#c0304a', challenge: '#ffa040' }[r.type] || { swarm: '#ff6a7a', dark: '#6a5aa8', traps: '#c8c8d8' }[r.variant];
    if (ic) { mm.fillStyle = ic; mm.fillRect(x + 3, y + 3, 3, 3); }
  }
}
let toastT = 0;
function toast(a, b) { $('toast').innerHTML = `${a}<small>${b}</small>`; $('toast').classList.add('show'); toastT = 2.2; }
let bannerT = 0;
function banner(a, b) { $('banner').innerHTML = `${a}${b ? `<small>${b}</small>` : ''}`; $('banner').classList.add('show'); bannerT = 1.8; }
function flash(a) { const f = $('flash'); f.style.transition = 'none'; f.style.opacity = a; requestAnimationFrame(() => { f.style.transition = 'opacity .35s'; f.style.opacity = 0; }); }
function addText(x, y, z, text, color, scale = 1) { texts.push({ x, y, z, text: String(text), color, scale, life: 0.75, vy: 1.8, vx: rr(-0.4, 0.4) }); }

// ---------- camera (smooth follow + lead, trauma shake, kick, zoom punch) ----------
const camTarget = new THREE.Vector3();
let trauma = 0;
const kickV = new THREE.Vector2();
function addShake(a) { trauma = Math.min(1, trauma + a * (1 - trauma * 0.75)); } // overlapping shakes add up with diminishing returns
function kick(x, z) { kickV.x += x; kickV.y += z; }
function updateCamera(dt) {
  if (player) {
    const lead = 0.28;
    let tx = player.x + player.vx * lead, tz = player.z + player.vz * lead - 0.8;
    // locked room: the whole room fits on screen, so hold the camera on it (a little drift toward the player)
    // instead of panning out over the empty dark beyond the walls
    const lockR = rooms.find((q) => q.active);
    G.camLock = (G.camLock || 0) + ((lockR ? 1 : 0) - (G.camLock || 0)) * damp(3, dt);
    if (lockR || G.camLock > 0.01) {
      const r = lockR || G.lastLockRoom;
      if (lockR) G.lastLockRoom = lockR;
      if (r) {
        const fx = r.cx + (player.x - r.cx) * 0.18, fz = r.cz - 0.8 + (player.z - r.cz) * 0.22;
        tx = lerp(tx, fx, G.camLock); tz = lerp(tz, fz, G.camLock);
      }
    }
    if (G.finisher) { tx = lerp(tx, G.finisher.x, 0.6); tz = lerp(tz, G.finisher.z - 0.4, 0.6); }
    const k = damp(6, dt);
    camTarget.x += (tx - camTarget.x) * k; camTarget.z += (tz - camTarget.z) * k;
  }
  const s = trauma * trauma, t = G.time * 1 + performance.now() / 1000;
  const n1 = Math.sin(t * 37.1) * 0.6 + Math.sin(t * 59.3) * 0.4, n2 = Math.sin(t * 41.7 + 1.3) * 0.6 + Math.sin(t * 67.1) * 0.4, n3 = Math.sin(t * 29.3 + 2.1);
  const zoom = G.state === 'dead' ? 0.75 : G.finisher ? 0.72 : G.slowmo > 0 ? 0.93 : 1;
  camZoom += (zoom - camZoom) * damp(G.finisher ? 9 : 4, dt);
  const d = camDist * camZoom;
  const cx = camTarget.x + kickV.x + n1 * s * 0.5, cz = camTarget.z + kickV.y + n2 * s * 0.5;
  camera.position.set(cx, Math.sin(PITCH) * d, cz + Math.cos(PITCH) * d);
  camera.lookAt(cx, 0, cz);
  camera.rotateZ(n3 * s * 0.035);
  trauma = Math.max(0, trauma - dt * 1.6);
  kickV.multiplyScalar(Math.exp(-14 * dt));
  sun.position.set(camTarget.x - 7, 16, camTarget.z + 5);
  sun.target.position.set(camTarget.x, 0, camTarget.z);
}
let camZoom = 1;

// ---------- auto-play bot (for teaser recording and testing) ----------
function botInput() {
  const [x, z] = botWish();
  const l = Math.hypot(x, z);
  if (l < 0.01) return [0, 0];
  const a0 = Math.atan2(z, x);
  for (const da of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2.2, -2.2]) {
    const a = a0 + da, cx = player.x + Math.cos(a) * 0.75, cz = player.z + Math.sin(a) * 0.75;
    if (!solid(cx, cz, false) && !solid(player.x + Math.cos(a) * 0.4, player.z + Math.sin(a) * 0.4, false)) return [Math.cos(a) * Math.min(1, l), Math.sin(a) * Math.min(1, l)];
  }
  return [x, z];
}
function botWish() {
  const p = player;
  let ax = 0, az = 0;
  const r = G.curRoom;
  const threats = enemies.filter((e) => !e.dead);
  for (const h of hazards) {
    const dx = p.x - h.x, dz = p.z - h.z, d = Math.hypot(dx, dz) || 1;
    if (d < 1.8 && (h.kind === 'lava' || h.state === 'warn' || h.state === 'up' || h.state === 'puff')) { ax += dx / d * 2.5 / d; az += dz / d * 2.5 / d; }
  }
  for (const c of clouds) { const dx = p.x - c.x, dz = p.z - c.z, d = Math.hypot(dx, dz) || 1; if (d < c.r + 1) { ax += dx / d * 3; az += dz / d * 3; } }
  for (const b of beams) { const cx = Math.cos(b.a + 0.4), cz = Math.sin(b.a + 0.4); ax -= cz * 3; az += cx * 3; }
  if (r && r.active || threats.length) {
    for (const e of threats) {
      const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 1;
      const w = 1 / Math.max(0.3, d * d) * (e.isBoss ? 6 : 1);
      ax += dx / d * w * 3; az += dz / d * w * 3;
      ax += -dz / d * w * 1.2; az += dx / d * w * 1.2;
    }
    for (const b of eprojs) { const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz); if (d < 2) { ax += dx / d * 2 / d; az += dz / d * 2 / d; } }
    if (r) { ax += (r.cx - p.x) * 0.12; az += (r.cz - p.z) * 0.12; }
    const coin = pickups.find((c) => Math.hypot(c.x - p.x, c.z - p.z) < 3);
    if (coin) { ax += (coin.x - p.x) * 0.2; az += (coin.z - p.z) * 0.2; }
    return [ax, az];
  }
  const near = pickups.find((c) => roomAt(c.x, c.z) === r && c.kind === 'coin' && c.t < 8);
  if (near) return toward(near.x, near.z);
  const chest = props.find((q) => q.kind === 'chest' && !q.opened && roomAt(q.x, q.z) === r);
  if (chest) return toward(chest.x, chest.z);
  const stairs = props.find((q) => q.kind === 'stairs');
  // route to the next unvisited room (or the stairs) through room centres
  const here = r || roomFromGrid(p.x, p.z);
  if (!here) return [0, 0];
  let goal = stairs && rooms.every((q) => q.visited || q.type === 'shop') ? roomAt(stairs.x, stairs.z) : null;
  if (stairs && here === goal) return toward(stairs.x, stairs.z);
  const prev = new Map([[here, null]]); const q = [here]; let found = null;
  while (q.length) { const c = q.shift(); if (goal ? c === goal : !c.visited) { found = c; break; } for (const o of c.links) if (!prev.has(o)) { prev.set(o, c); q.push(o); } }
  if (!found && stairs) { goal = roomAt(stairs.x, stairs.z); return toward(goal.cx, goal.cz); }
  if (!found) return [0, 0];
  let step = found; while (prev.get(step) && prev.get(step) !== here) step = prev.get(step);
  const horizontal = step.gx !== here.gx;
  if (horizontal && Math.abs(p.z - here.cz) > 0.4) return toward(p.x, here.cz);
  if (!horizontal && Math.abs(p.x - here.cx) > 0.4) return toward(here.cx, p.z);
  return toward(step.cx, step.cz);
}
function roomFromGrid(x, z) { const gx = Math.floor(x / SX), gy = Math.floor(z / SZ); return roomGrid[gy * GW + gx] || null; }
function toward(x, z) { const dx = x - player.x, dz = z - player.z, d = Math.hypot(dx, dz); return d < 0.1 ? [0, 0] : [dx / d, dz / d]; }

// ---------- main update ----------
function update(dt) {
  G.time += dt;
  if (G.state === 'play') {
    updatePlayer(dt); G.run.time += dt;
    if (G.lvPicks > 0 && (G.lvPickT -= dt) <= 0) { G.lvPicks--; G.lvPickT = 0.5; G.rerollFn = () => upgradeOptions(); G.rerolled = false; openCards('LEVEL UP', upgradeOptions()); }
    if ((G.comboT -= dt) <= 0) G.combo = 0;
    const r = roomAt(player.x, player.z);
    if (r && r !== G.curRoom) enterRoom(r);
    if (!r && G.curRoom && !G.curRoom.active) G.curRoom = null;
    castSpells(dt);
    if (G.curRoom && !G.curRoom.active) G.safeRoom = G.curRoom; // a continued run starts here
    if (G.saveDue && runSafe()) checkpoint();
    if (music && !rooms.some((q) => q.active)) music.combat(false);
    // waves are driven by whichever room is locked, not by where the camera thinks we are
    const cr = rooms.find((q) => q.active);
    if (cr) {
      if (music) music.combat(true);
      if (cr !== G.curRoom) console.warn('active room is not the current room', cr.type, G.curRoom && G.curRoom.type);
      if (G.swarm && G.swarm.room === cr) updateSwarm(cr, dt);
      else if (enemies.length === 0 && portals.length === 0) {
        G.waveDelay -= dt;
        if (G.waveDelay <= 0) { if (cr.waves > 0) { spawnWave(cr); G.waveDelay = 0.6; } else clearRoom(cr); }
      }
      // watchdog: an enemy stuck outside the room (spawned in a wall, knocked into the void) gets pulled back
      for (const e of enemies) {
        if (roomAt(e.x, e.z) === cr || e.isBoss) { e.out = 0; continue; }
        if ((e.out = (e.out || 0) + dt) > 2) { console.warn('enemy outside room, moved back', e.type); e.x = cr.cx + rr(-2, 2); e.z = cr.cz + rr(-2, 2); e.out = 0; }
      }
    }
  } else if (G.state === 'dead') {
    G.deadT += dt;
  }
  if (G.state === 'play' || G.state === 'dead' || G.state === 'trans') {
    for (const e of enemies) updateEnemy(e, dt);
    enemies = enemies.filter((e) => !e.dead);
    updateProjectiles(dt);
    updatePickups(dt);
    updateProps(dt);
    updateMisc(dt);
  }
  updateGlows(dt);
  updateDebris(dt);
}
function updateProjectiles(dt) {
  for (let i = projs.length - 1; i >= 0; i--) {
    const p = projs[i];
    p.life -= dt;
    if (p.homing) {
      if (!p.target || p.target.dead) p.target = nearestEnemy(p.x, p.z, 6, p.hit);
      if (p.target) {
        const want = Math.atan2(p.target.z - p.z, p.target.x - p.x), cur = Math.atan2(p.vz, p.vx);
        let da = want - cur; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
        const na = cur + clamp(da, -p.homing * dt, p.homing * dt);
        p.vx = Math.cos(na) * p.speed; p.vz = Math.sin(na) * p.speed;
      }
    }
    if (p.boomerang && !p.back && p.life < p.maxLife * 0.5) { p.back = true; p.hit.clear(); }
    if (p.back) { const dx = player.x - p.x, dz = player.z - p.z, d = Math.hypot(dx, dz) || 1; p.vx = dx / d * p.speed * 1.2; p.vz = dz / d * p.speed * 1.2; if (d < 0.5) p.life = 0; }
    const ox = p.x, oz = p.z;
    p.x += p.vx * dt; p.z += p.vz * dt;
    p.y += (0.7 - p.y) * Math.min(1, dt * 6); // leave the weapon tip, settle to flight height
    if (p.bounce > 0 && solid(p.x, p.z, false)) { // bouncing rune: ricochet off walls
      if (solid(p.x, oz, false)) p.vx *= -1; if (solid(ox, p.z, false)) p.vz *= -1;
      p.x = ox; p.z = oz; p.bounce--; burst(p.x, p.y, p.z, p.color, 4, 2, 0.25, 0.2);
    }
    if (p.boomerang && solid(p.x, p.z, false) && !p.back) { p.back = true; p.hit.clear(); p.x = ox; p.z = oz; }
    placeProj(p, p.y, dt);
    p.glow.scale.setScalar(p.size * 0.8 * (0.9 + Math.random() * 0.2));
    // trail
    if (p.seek) spark(p.x, p.y, p.z, 0xffffff, { s: 0.15, life: 0.15, drag: 0 });
    spark(p.x, p.y, p.z, p.color, { s: p.size * 0.45, life: p.kind === 'fire' ? 0.35 : 0.2, drag: 0, vy: p.kind === 'fire' ? 0.8 : 0, spread: p.kind === 'fire' ? 1 : 0.3 });
    if (p.kind === 'fire' && Math.random() < 0.4) spark(p.x, p.y, p.z, 0x40302a, { vy: 1, s: 0.5, life: 0.6, drag: 1 });
    let dead = p.life <= 0 || (solid(p.x, p.z, false) && !p.boomerang);
    if (p.kind === 'fire' && Math.hypot(p.x - p.tx, p.z - p.tz) < 0.35) dead = true;
    if (!dead) {
      for (const e of enemies) {
        if (e.dead || p.hit.has(e) || e.spawn < 0.5 || e.hidden) continue;
        if (Math.hypot(e.x - p.x, e.z - p.z) < e.r + p.r && e.y < 1.2) {
          if (p.aoe) { dead = true; break; }
          p.hit.add(e);
          hurtEnemy(e, p.dmg, p.vx, p.vz, p.kind === 'bolt' ? 2.5 : 1.2, p.color, p.els);
          if (p.bounce > 0) { // bouncing rune: jump to the next foe instead of stopping
            const nx = nearestEnemy(p.x, p.z, 5, p.hit);
            if (nx) { p.bounce--; const a2 = Math.atan2(nx.z - p.z, nx.x - p.x); p.vx = Math.cos(a2) * p.speed; p.vz = Math.sin(a2) * p.speed; p.target = nx; p.life = Math.max(p.life, 0.6); burst(p.x, p.y, p.z, p.color, 5, 2.5, 0.25, 0.2); break; }
          }
          if (p.storm) {
            const hit = new Set([e]); let from = e; const pts = [new THREE.Vector3(e.x, 0.6, e.z)];
            for (let k = 0; k < 2; k++) { const nx = nearestEnemy(from.x, from.z, 3.2, hit); if (!nx) break; hit.add(nx); pts.push(new THREE.Vector3(nx.x, 0.6, nx.z)); hurtEnemy(nx, p.dmg * 0.5, nx.x - from.x, nx.z - from.z, 1, 0xfff36a); from = nx; }
            if (pts.length > 1) { bolts.push({ pts, life: 0.15, color: '#fff36a' }); sfx('zap'); }
          }
          if (p.poison) { e.poison = 3; e.poisonDps = Math.min((e.poisonDps || 0) + p.poison, p.poison * 3); }
          if (p.pierce-- <= 0) { dead = true; break; }
        }
      }
      for (const pot of pots) if (Math.hypot(pot.x - p.x, pot.z - p.z) < 0.4) { breakPot(pot); if (!p.aoe) dead = true; break; }
    }
    if (dead) {
      if (p.aoe) explode(p);
      else { burst(p.x, p.y, p.z, p.color, 6, 3, 0.3, 0.25); }
      killProj(p); projs.splice(i, 1);
    }
  }
  for (let i = eprojs.length - 1; i >= 0; i--) {
    const p = eprojs[i];
    if (G.still > 0) continue; // frozen in time
    if (p.homing && player.alive) {
      const want = Math.atan2(player.z - p.z, player.x - p.x), cur = Math.atan2(p.vz, p.vx), sp = Math.hypot(p.vx, p.vz);
      let da = want - cur; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
      const na = cur + clamp(da, -p.homing * dt, p.homing * dt); p.vx = Math.cos(na) * sp; p.vz = Math.sin(na) * sp;
    }
    p.life -= dt; p.x += p.vx * dt; p.z += p.vz * dt;
    placeProj(p, 0.55, dt);
    if (Math.random() < 0.5) spark(p.x, 0.55, p.z, p.color, { s: 0.3, life: 0.25, drag: 0 });
    let dead = p.life <= 0 || solid(p.x, p.z, true) && cellAt(p.x, p.z) !== OBST;
    if (!dead && player.alive && Math.hypot(player.x - p.x, player.z - p.z) < player.r + p.r) { damagePlayer(1, p.x - p.vx, p.z - p.vz); dead = true; }
    if (dead) { burst(p.x, 0.55, p.z, p.color, 6, 2.5, 0.3, 0.3); killProj(p); eprojs.splice(i, 1); }
  }
}
function updateMisc(dt) {
  for (let i = portals.length - 1; i >= 0; i--) {
    const p = portals[i];
    if (G.still > 0) continue; // spawn cracks freeze too
    p.t += dt;
    const k = clamp((p.t - p.delay) / (p.dur - p.delay), 0, 1);
    p.mesh.scale.setScalar(p.size * (k < 0.15 ? k / 0.15 : 1) * (1 + Math.sin(p.t * 12) * 0.05));
    p.mesh.rotation.y += dt * 3;
    if (k > 0 && Math.random() < 0.6) { const a = Math.random() * 6.28, d = Math.random() * p.size; spark(p.x + Math.cos(a) * d, 0.05, p.z + Math.sin(a) * d, Math.random() < 0.5 ? 0x8a2aff : 0x3a1050, { vy: rr(1, 3), s: 0.3, life: 0.6, drag: 0 }); }
    if (k > 0.5 && Math.random() < 0.15) chunkDust(p.x, p.z, 0x6a6470);
    if (k >= 1) {
      const ne = spawnEnemy(p.type, p.x, p.z, p.elite);
      if (p.weak) { ne.hp *= BENCH ? 25 : 0.5; ne.maxHp = ne.hp; } // bench: tanky so the screen stays full
      if (p.champ) {
        ne.name = p.champ.name; ne.hp *= 2.6; ne.maxHp = ne.hp; ne.r *= 1.2;
        ne.mesh.userData.bw *= 1.3; ne.mesh.userData.bh *= 1.3; ne.shadow.scale.multiplyScalar(1.3);
        $('bossname').textContent = ne.name.toUpperCase(); $('bossbar').classList.remove('hidden');
        banner('CHAMPION', ne.name.toUpperCase()); toastT = 0; $('toast').classList.remove('show'); addShake(0.4); sfx('lock');
      }
      burst(p.x, 0.3, p.z, 0x8a2aff, 10, 3, 0.4, 0.4); chunk(p.x, 0.1, p.z, 0x5a5660, 6, 3, 0.1);
      splat(p.x, p.z, 0x0a0a0a, p.size * 1.6);
      scene.remove(p.mesh); p.mesh.material.dispose(); p.mesh.children[0].material.dispose(); portals.splice(i, 1);
    }
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.t += dt;
    const k = r.t / r.dur, e = 1 - Math.pow(1 - Math.min(1, k), 3);
    r.mesh.scale.setScalar(lerp(r.r0, r.r1, e));
    r.mesh.material.opacity = 1 - k;
    if (k >= 1) { scene.remove(r.mesh); r.mesh.material.dispose(); rings.splice(i, 1); }
  }
  for (let i = orbs.length - 1; i >= 0; i--) {
    const o = orbs[i]; o.life -= dt; o.a += dt * 4.2;
    const x = player.x + Math.cos(o.a) * o.rad, z = player.z + Math.sin(o.a) * o.rad;
    o.glow.position.set(x, 0.6, z); o.glow.scale.setScalar(0.8 + Math.sin(G.time * 20) * 0.1);
    o.mesh.position.set(x, 0.6 + Math.sin(G.time * 6 + o.a) * 0.08, z); o.mesh.rotation.y += dt * 6; o.shadow.position.set(x, 0.02, z);
    spark(x, 0.6, z, o.color || 0xb070ff, { s: 0.35, life: 0.25, drag: 0 });
    for (const e of enemies) {
      if (e.dead || e.spawn < 0.5) continue;
      if (Math.hypot(e.x - x, e.z - z) < e.r + 0.3 && (o.hits.get(e) || 0) < G.time) { o.hits.set(e, G.time + 0.4); hurtEnemy(e, o.dmg, e.x - player.x, e.z - player.z, 3, o.color || 0xb070ff, o.els); if (o.freeze) { ccFreeze(e, 0.8); e.slow = Math.max(e.slow, 2); } }
    }
    for (const pot of pots) if (Math.hypot(pot.x - x, pot.z - z) < 0.4) { breakPot(pot); break; }
    if (o.life <= 0) { burst(x, 0.6, z, 0xb070ff, 8, 3, 0.3, 0.3); killGlow(o.glow); scene.remove(o.mesh); scene.remove(o.shadow); orbs.splice(i, 1); }
  }
  if (G.still > 0) G.still -= dt;
  for (let i = holes.length - 1; i >= 0; i--) {
    const h = holes[i]; h.t += dt;
    const k = h.t / h.dur;
    h.glow.scale.setScalar(2 + k * 3 + Math.sin(h.t * 30) * 0.2);
    for (let q = 0; q < 4; q++) { const a = Math.random() * 6.28, d = 2.5 + Math.random() * 1.5; spark(h.x + Math.cos(a) * d, 0.4, h.z + Math.sin(a) * d, Math.random() < 0.5 ? 0x9a4aff : 0x220833, { vx: -Math.cos(a) * d * 2.2 - Math.sin(a) * 4, vz: -Math.sin(a) * d * 2.2 + Math.cos(a) * 4, s: 0.35, life: 0.45, drag: 0 }); }
    for (const e of enemies) {
      if (e.dead || e.isBoss) continue;
      const dx = h.x - e.x, dz = h.z - e.z, d = Math.hypot(dx, dz) || 1;
      if (d < 5) { e.kx += dx / d * 30 * dt; e.kz += dz / d * 30 * dt; }
    }
    if (k >= 1) {
      explode({ x: h.x, z: h.z, aoe: 3, dmg: 70 + G.floor * 8 });
      burst(h.x, 0.6, h.z, 0x9a4aff, 40, 8, 0.6, 0.6); flash(0.3);
      killGlow(h.glow); holes.splice(i, 1);
    }
  }
  // sigils (rune traps)
  for (let i = mines.length - 1; i >= 0; i--) {
    const m = mines[i]; m.t += dt; m.arm -= dt; m.life -= dt;
    m.glow.scale.setScalar(1.1 + Math.sin(m.t * (m.arm > 0 ? 30 : 6)) * 0.15);
    if (Math.random() < 0.1) spark(m.x, 0.15, m.z, m.color, { vy: 1, s: 0.2, life: 0.4, drag: 0 });
    const trig = m.arm <= 0 && enemies.some((e) => !e.dead && !e.d.fly && Math.hypot(e.x - m.x, e.z - m.z) < 0.9 + e.r);
    if (trig || m.life <= 0) { explode({ x: m.x, z: m.z, aoe: m.aoe, dmg: m.dmg, els: m.els, color: m.color }); killGlow(m.glow); mines.splice(i, 1); }
  }
  // rays: lock-on beams from the weapon tip (or a sweeping beam for Hollow Gaze)
  for (let i = rays.length - 1; i >= 0; i--) {
    const r = rays[i]; r.t -= dt; r.tick -= dt;
    const tp = staffTip(), sx = tp.x, sy = tp.y, sz = tp.z, segs = [];
    if (r.sweep) { const ang = r.a0 + (1 - r.t / r.dur) * r.arc; segs.push([sx, sz, sx + Math.cos(ang) * r.range, sz + Math.sin(ang) * r.range, null]); }
    else {
      if (!r.target || r.target.dead || r.target.hidden || Math.hypot(r.target.x - player.x, r.target.z - player.z) > r.range) r.target = nearestEnemy(player.x, player.z, r.range);
      if (r.target) segs.push([sx, sz, r.target.x, r.target.z, r.target]);
      if (r.split && r.target) { const t2 = nearestEnemy(r.target.x, r.target.z, 4, new Set([r.target])); if (t2) segs.push([sx, sz, t2.x, t2.z, t2]); }
    }
    while (r.meshes.length < segs.length) {
      const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: r.color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
      scene.add(m); r.meshes.push(m);
    }
    r.meshes.forEach((m, k) => {
      const sg = segs[k]; m.visible = !!sg; if (!sg) return;
      const len = Math.hypot(sg[2] - sg[0], sg[3] - sg[1]) || 0.01;
      m.position.set(sg[0], sy, sg[1]); m.rotation.y = -Math.atan2(sg[3] - sg[1], sg[2] - sg[0]);
      m.scale.set(len, 1, 0.22 + Math.sin(G.time * 50) * 0.05);
      if (Math.random() < 0.6) { const f = Math.random(); spark(sg[0] + (sg[2] - sg[0]) * f, sy, sg[1] + (sg[3] - sg[1]) * f, r.color, { vy: 1, s: 0.3, life: 0.2, drag: 0 }); }
    });
    if (r.tick <= 0) {
      r.tick = 0.12; r.n++;
      for (const sg of segs) {
        if (sg[4]) dotHit(sg[4], r.dmg, r.color, r.els, r.n % 3 === 0);
        else {
          const dx = sg[2] - sg[0], dz = sg[3] - sg[1], L = Math.hypot(dx, dz) || 1;
          for (const e of [...enemies]) {
            if (e.dead) continue;
            const ex = e.x - sg[0], ez = e.z - sg[1], al = (ex * dx + ez * dz) / L;
            if (al > 0 && al < L && Math.abs(ex * dz - ez * dx) / L < 0.5 + e.r) dotHit(e, r.dmg, r.color, r.els, r.n % 3 === 0);
          }
        }
      }
    }
    if (r.t <= 0) { for (const m of r.meshes) { scene.remove(m); m.material.dispose(); } rays.splice(i, 1); }
  }
  // wisps: familiars that circle you and shoot
  for (let i = wisps.length - 1; i >= 0; i--) {
    const w = wisps[i]; w.life -= dt; w.cd -= dt; w.a += dt * 1.6;
    const tx = player.x + Math.cos(w.a) * 1.3, tz = player.z + Math.sin(w.a) * 1.3;
    w.x += (tx - w.x) * Math.min(1, dt * 6); w.z += (tz - w.z) * Math.min(1, dt * 6);
    const y = 1.2 + Math.sin(G.time * 4 + w.a) * 0.15;
    w.mesh.position.set(w.x, y, w.z); w.glow.position.set(w.x, y, w.z); w.shadow.position.set(w.x, 0.02, w.z);
    if (Math.random() < 0.3) spark(w.x, y, w.z, w.color, { vy: 0.4, s: 0.25, life: 0.4, drag: 0 });
    if (w.cd <= 0) {
      const t = nearestEnemy(w.x, w.z, 8);
      if (t) { w.cd = w.rate; addProj({ kind: 'bolt', x: w.x, z: w.z, y, a: Math.atan2(t.z - w.z, t.x - w.x), speed: 12, dmg: w.dmg, r: 0.25, color: w.color, size: 0.6, homing: 7, target: t, life: 1, els: w.els }); }
    }
    if (w.life <= 0) { burst(w.x, y, w.z, w.color, 10, 3, 0.3, 0.4); killGlow(w.glow); scene.remove(w.mesh); scene.remove(w.shadow); wisps.splice(i, 1); }
  }
  // Frostwalkers: a chilling trail behind you
  if (player && player.alive && player.g.flags.frostwalk && Math.hypot(player.vx, player.vz) > 1 && (G.trailT = (G.trailT || 0) - dt) <= 0) {
    G.trailT = 0.25;
    fires.push({ x: player.x, z: player.z, r: 0.7, life: 1.6, dmg: 2 + G.floor, tick: 0, els: ['frost'], color: 0x8fe6ff, glow: makeGlowAt(player.x, 0.1, player.z, 0x8fe6ff, 1.2, 0.3) });
  }
  for (let i = fires.length - 1; i >= 0; i--) {
    const f = fires[i]; f.life -= dt; f.tick -= dt;
    if (Math.random() < 0.7) spark(f.x + rr(-f.r, f.r), 0.1, f.z + rr(-f.r, f.r), f.color ? f.color : f.poison ? (Math.random() < 0.5 ? 0x5fff4a : 0x2a8a2a) : Math.random() < 0.5 ? 0xff5a10 : 0xffb030, { vy: f.poison ? 0.8 : 2, s: f.poison ? 0.6 : 0.35, life: 0.6, drag: 0 });
    if (f.tick <= 0 && f.els) { f.tick = 0.4; for (const e of [...enemies]) if (!e.dead && Math.hypot(e.x - f.x, e.z - f.z) < f.r + e.r) dotHit(e, f.dmg, f.color, f.els, Math.random() < 0.4); }
    else if (f.tick <= 0) { f.tick = 0.4; for (const e of enemies) if (!e.dead && Math.hypot(e.x - f.x, e.z - f.z) < f.r + e.r) { if (f.poison) { e.poison = 3; e.poisonDps = Math.max(e.poisonDps || 0, 10 + G.floor * 2); } else hurtEnemyRaw(e, f.dmg, '#ffa040'); } }
    f.glow.material.opacity = 0.45 * Math.min(1, f.life);
    if (f.life <= 0) { killGlow(f.glow); fires.splice(i, 1); }
  }
  for (let i = bolts.length - 1; i >= 0; i--) { bolts[i].life -= dt; if (bolts[i].life <= 0) bolts.splice(i, 1); }
  for (let i = texts.length - 1; i >= 0; i--) {
    const t = texts[i]; t.life -= dt;
    if (t.ghost) {
      const k = Math.max(0, t.life / (t.max || 0.25));
      t.ghost.material.uniforms.uAlpha.value = k * (t.grow ? 0.95 : 0.6);
      if (t.grow) setSpriteScale(t.ghost, 1 + (1 - k) * 0.7, 1 + (1 - k) * 0.7);
      if (t.life <= 0) { killMesh(t.ghost); texts.splice(i, 1); }
      continue;
    }
    t.y += t.vy * dt; t.vy -= 4 * dt; t.x += t.vx * dt;
    if (t.life <= 0) texts.splice(i, 1);
  }
  for (const pot of pots) if (pot.barrel && Math.random() < 0.08) spark(pot.x, 0.7, pot.z, 0xffb020, { vy: 1.5, s: 0.2, life: 0.3, drag: 0 });
  for (const b of barriers) {
    b.userData.t += dt; const fadeIn = Math.min(1, b.userData.t * 3), pulse = 0.75 + Math.sin(G.time * 4 + b.position.x) * 0.25;
    if (b.userData.veil) { b.material.opacity = 0.9 * fadeIn * pulse; continue; }
    if (b.userData.halo) { b.material.opacity = 0.75 * fadeIn * pulse; continue; }
    b.scale.y = Math.min(1.3, b.userData.t * 5) * (1 + Math.sin(G.time * 10 + b.position.x * 3) * 0.05);
    if (Math.random() < 0.04) spark(b.position.x, Math.random() * 1.2, b.position.z, 0xff9be8, { vy: 1.2, s: 0.18, life: 0.5, drag: 0 });
  }
  for (let k = 0; k < torchFlames.length; k++) {
    const f = torchFlames[k];
    if (!f.userData.core) continue;
    f.userData.flare = Math.max(0, (f.userData.flare || 0) - dt * 1.5);
    const fl = (0.8 + Math.sin(G.time * 13 + k) * 0.1 + Math.sin(G.time * 23 + k * 2) * 0.08) * (1 + f.userData.flare * 1.8);
    f.scale.setScalar(fl); f.userData.core.scale.setScalar(0.35 * fl);
    if (Math.random() < 0.05) spark(f.position.x, f.position.y + 0.1, f.position.z + 0.05, 0xffa040, { vy: 1.2, s: 0.18, life: 0.5, spread: 0.3, drag: 0 });
  }
  torchLights.forEach((l, k) => { l.intensity = G.dark ? 0 : 14 + Math.sin(G.time * 15 + k * 2) * 1.6 + Math.sin(G.time * 37 + k) * 0.8; });
  hemi.intensity += ((G.dark ? 0.05 : G.biome.hemiI) - hemi.intensity) * damp(3, dt);
  sun.intensity += ((G.dark ? 0.04 : G.biome.sunI) - sun.intensity) * damp(3, dt);
  pLight.distance = G.dark ? 6.5 : 8;
  updateBeams(dt); updateHazards(dt); updateClouds(dt); updateMeteors(dt);
  fxLight.intensity *= Math.exp(-6 * dt);
  for (const r of rooms) {
    if (!r.shroud) continue;
    const sh = r.shroud, dim = sh.children[0];
    if (r.visited) {
      sh.material.opacity -= dt * 1.8; dim.material.opacity -= dt * 1.4;
      if (sh.material.opacity <= 0) { world.remove(sh); sh.material.dispose(); dim.material.dispose(); r.shroud = null; }
      continue;
    }
    // mist thins as you walk up to the room, so it reads as 'unexplored', never as 'blocked'
    const d = player ? Math.hypot(player.x - r.cx, player.z - r.cz) : 99;
    const k = clamp((d - 7) / 9, 0.25, 1);
    sh.material.opacity = 0.6 * k; dim.material.opacity = 0.45 * k;
    sh.position.x = r.cx + Math.sin(G.time * 0.2 + r.gx) * 0.4;
  }
  for (const f of fogPlanes) { const u = f.userData; f.position.x = u.base.x + Math.sin(G.time * 0.13 + u.ph) * 1.6; f.position.z = u.base.z + Math.cos(G.time * 0.11 + u.ph) * 1.2; f.rotation.y = G.time * 0.02 + u.ph; }
  if (player) biomeParticles(dt);
  if (G.lavaTex) G.lavaTex.offset.x += dt * 0.015;
  if (player && (G.dripT = (G.dripT || 2) - dt) <= 0) {
    G.dripT = rr(1.5, 4);
    const x = player.x + rr(-4.5, 4.5), z = player.z + rr(-5, 3);
    if (cellAt(x, z) === FLOOR) {
      spark(x, 3.4, z, 0x7fa4c8, { vy: -9, s: 0.14, life: 0.37, drag: 0 });
      later(0.37, () => { for (let k = 0; k < 5; k++) spark(x, 0.05, z, 0x7fa4c8, { vx: rr(-1, 1), vz: rr(-1, 1), vy: rr(1, 2), s: 0.08, life: 0.3, grav: -8, drag: 1 }); if (Math.hypot(x - player.x, z - player.z) < 6) sfx('drip'); });
    }
  }
  if ((G.ambT = (G.ambT || 6) - dt) <= 0) { G.ambT = rr(6, 13); sfx(pick(['moan', 'chains', 'moan', 'creak'])); }
}

// ---------- 2D overlay: damage numbers, lightning, shop prices ----------
const pv = new THREE.Vector3();
function toScreen(x, y, z) { pv.set(x, y, z).project(camera); return [(pv.x * 0.5 + 0.5) * W * DPR, (-pv.y * 0.5 + 0.5) * H * DPR, pv.z]; }
function drawOverlay() {
  fx.setTransform(1, 0, 0, 1, 0, 0);
  fx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  fx.globalCompositeOperation = 'lighter';
  for (const b of bolts) {
    const pts = b.pts.map((p) => toScreen(p.x, p.y, p.z));
    for (const [lw, col] of [[7 * DPR, 'rgba(255,230,80,.35)'], [3 * DPR, b.color], [1.2 * DPR, '#ffffff']]) {
      fx.strokeStyle = col; fx.lineWidth = lw; fx.beginPath();
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        if (i === 0) fx.moveTo(x0, y0);
        const nx = -(y1 - y0), ny = x1 - x0, nl = Math.hypot(nx, ny) || 1;
        for (let s = 1; s <= 6; s++) {
          const t = s / 6, j = s === 6 ? 0 : (Math.random() - 0.5) * 22 * DPR;
          fx.lineTo(lerp(x0, x1, t) + nx / nl * j, lerp(y0, y1, t) + ny / nl * j);
        }
      }
      fx.stroke();
    }
  }
  fx.globalCompositeOperation = 'source-over';
  fx.textAlign = 'center'; fx.textBaseline = 'middle';
  for (const t of texts) {
    if (t.ghost) continue;
    const [x, y] = toScreen(t.x, t.y, t.z);
    const sz = Math.round(13 * t.scale * DPR * (t.life > 0.6 ? 1 + (t.life - 0.6) * 3 : 1));
    fx.font = `bold ${sz}px "Courier New", monospace`;
    fx.globalAlpha = clamp(t.life / 0.3, 0, 1);
    fx.lineWidth = 3 * DPR; fx.strokeStyle = '#000'; fx.strokeText(t.text, x, y);
    fx.fillStyle = t.color; fx.fillText(t.text, x, y);
  }
  fx.globalAlpha = 1;
  if (G.swarm && G.state === 'play' && !BENCH) {
    fx.font = `bold ${Math.round(22 * DPR)}px "Courier New", monospace`; fx.lineWidth = 5 * DPR; fx.strokeStyle = '#1a0420';
    const txt = `SURVIVE ${Math.max(0, G.swarm.t).toFixed(1)}`;
    fx.strokeText(txt, W * DPR / 2, H * DPR * 0.1); fx.fillStyle = G.swarm.t < 5 ? '#8dff9f' : '#ff6a7a'; fx.fillText(txt, W * DPR / 2, H * DPR * 0.1);
  }
  if (G.hold && player && player.alive && G.state === 'play') { // small timer above the head, seconds inside
    const up = SPRITE_H.wizard + 0.85;
    const [x, y] = toScreen(player.x, Math.cos(PITCH) * up, player.z - Math.sin(PITCH) * up), R = 10 * DPR;
    fx.fillStyle = 'rgba(8,6,16,.85)'; fx.beginPath(); fx.arc(x, y, R, 0, Math.PI * 2); fx.fill();
    fx.lineWidth = 2.5 * DPR; fx.strokeStyle = G.hold.col; fx.beginPath(); fx.arc(x, y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, G.hold.p)); fx.stroke();
    fx.font = `bold ${11 * DPR}px "Courier New", monospace`; fx.fillStyle = '#fff';
    fx.fillText(String(Math.max(1, Math.ceil(G.hold.left))), x, y + DPR);
  }
  if (G.combo >= 3 && G.state === 'play') {
    const k = 1 + G.comboPop * 0.5, a = clamp(G.comboT / 0.6, 0, 1);
    fx.globalAlpha = a;
    fx.font = `bold ${Math.round(26 * k * DPR)}px "Courier New", monospace`;
    fx.lineWidth = 5 * DPR; fx.strokeStyle = '#1a0420';
    const col = G.combo >= 50 ? '#ff4f6a' : G.combo >= 20 ? '#ffd34f' : '#ff8be0';
    fx.strokeText(`${G.combo}x`, W * DPR / 2, H * DPR * 0.155); fx.fillStyle = col; fx.fillText(`${G.combo}x`, W * DPR / 2, H * DPR * 0.155);
    fx.font = `bold ${Math.round(11 * DPR)}px "Courier New", monospace`; fx.lineWidth = 3 * DPR;
    const word = G.combo >= 50 ? 'UNSTOPPABLE' : G.combo >= 20 ? 'RAMPAGE' : 'COMBO';
    fx.strokeText(word, W * DPR / 2, H * DPR * 0.155 + 22 * DPR * k); fx.fillStyle = '#fff'; fx.fillText(word, W * DPR / 2, H * DPR * 0.155 + 22 * DPR * k);
    fx.globalAlpha = 1;
  }
  if (player && player.alive && G.state !== 'title') {
    // above the head along the camera's up axis (sprites lean back with the billboard), one segment per heart
    const up = SPRITE_H.wizard + 0.45 + (player.drop > 0 ? 99 : 0);
    const [x, y] = toScreen(player.x, Math.cos(PITCH) * up, player.z - Math.sin(PITCH) * up);
    const hearts = player.maxHp / 2, gap = DPR, h = 3 * DPR, w = Math.min(34, 6 + hearts * 5) * DPR, seg = (w - (hearts - 1) * gap) / hearts;
    fx.fillStyle = 'rgba(10,4,8,.8)'; fx.fillRect(x - w / 2 - DPR, y - DPR, w + 2 * DPR, h + 2 * DPR);
    for (let k = 0; k < hearts; k++) {
      const v = clamp(player.hp - k * 2, 0, 2) / 2, sx = x - w / 2 + k * (seg + gap);
      fx.fillStyle = '#3a1020'; fx.fillRect(sx, y, seg, h);
      if (v > 0) { fx.fillStyle = player.hp <= 2 ? '#ff2a4a' : '#ff4f7a'; fx.fillRect(sx, y, seg * v, h); }
    }
  }
  for (const e of enemies) {
    if (e.dead || e.isBoss || e.name || e.hp >= e.maxHp || e.hidden || e.spawn < 1) continue;
    const [x, y] = toScreen(e.x, e.y + e.mesh.userData.bh + 0.15, e.z);
    const w = Math.max(16, Math.min(46, Math.sqrt(e.maxHp / Math.pow(1.33, G.floor - 1)) * 2.6)) * DPR, h = 3 * DPR;
    fx.fillStyle = 'rgba(0,0,0,.7)'; fx.fillRect(x - w / 2 - DPR, y - DPR, w + 2 * DPR, h + 2 * DPR);
    fx.fillStyle = e.elite ? '#ffd34f' : '#ff4f6a'; fx.fillRect(x - w / 2, y, w * Math.max(0, e.hp / e.maxHp), h);
  }
  for (const e of enemies) {
    if (!e.name || e.dead) continue;
    const [x, y] = toScreen(e.x, e.mesh.userData.bh + 0.4, e.z);
    fx.font = `bold ${11 * DPR}px "Courier New", monospace`; fx.lineWidth = 3 * DPR; fx.strokeStyle = '#000';
    fx.strokeText(e.name, x, y); fx.fillStyle = '#ff6a7a'; fx.fillText(e.name, x, y);
  }
  for (const p of props) {
    if (p.kind !== 'shop' || p.sold) continue;
    const [x, y] = toScreen(p.x, 1.45, p.z);
    fx.font = `bold ${12 * DPR}px "Courier New", monospace`;
    fx.lineWidth = 3 * DPR; fx.strokeStyle = '#000'; fx.strokeText(p.offer.price + 'c', x, y);
    fx.fillStyle = G.coins >= p.offer.price ? '#ffd34f' : '#9a8a6a'; fx.fillText(p.offer.price + 'c', x, y);
  }
}

// ---------- input ----------
addEventListener('keydown', (e) => {
  input.keys.add(e.code);
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyR') toggleRecording();
});
addEventListener('keyup', (e) => input.keys.delete(e.code));
function readKeys() {
  const k = input.keys;
  let x = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
  let z = (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0);
  if (input.stick) { x = input.stick.x; z = input.stick.z; }
  input.x = x; input.z = z;
}
const stickEl = $('stick'), knobEl = $('knob');
app.addEventListener('pointerdown', (e) => {
  if (G.state !== 'play' || e.target.closest('#muteBtn,#pauseBtn,.card,.screen')) return;
  input.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, z: 0 };
  const rect = app.getBoundingClientRect();
  stickEl.style.left = e.clientX - rect.left + 'px'; stickEl.style.top = e.clientY - rect.top + 'px'; stickEl.style.display = 'block';
  knobEl.style.transform = '';
});
addEventListener('pointermove', (e) => {
  const s = input.stick; if (!s || s.id !== e.pointerId) return;
  let dx = e.clientX - s.ox, dy = e.clientY - s.oy; const l = Math.hypot(dx, dy), max = 48;
  if (l > max) { dx *= max / l; dy *= max / l; }
  s.x = dx / max; s.z = dy / max;
  if (l < 6) s.x = s.z = 0;
  knobEl.style.transform = `translate(${dx}px,${dy}px)`;
});
const endStick = (e) => { if (input.stick && input.stick.id === e.pointerId) { input.stick = null; stickEl.style.display = 'none'; } };
addEventListener('pointerup', endStick); addEventListener('pointercancel', endStick);

function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.8;

}
const screens = ['title', 'over', 'sanctum', 'statsScr', 'codex', 'dungeons'];
// One tap = one action. When a tap opens a screen, the rest of that tap (pointerup / click) must not hit a button that just
// appeared under the finger (e.g. the in-game menu opening, then its BACK firing), and the same button never fires twice in a row.
const tapGuard = (() => {
  let openT = 0; const last = {};
  new MutationObserver((ms) => {
    for (const m of ms) if (m.target.matches('.screen, #cards, .ad-overlay') && !m.target.classList.contains('hidden') && (m.oldValue || '').includes('hidden')) openT = performance.now();
  }).observe($('app'), { subtree: true, attributes: true, attributeFilter: ['class'], attributeOldValue: true });
  new MutationObserver(() => { openT = performance.now(); }).observe($('app'), { childList: true }); // ad / purchase overlays
  for (const type of ['pointerdown', 'click']) {
    document.addEventListener(type, (e) => {
      const b = e.target.closest && e.target.closest('button, [data-tab], #pauseBtn, .card, [data-sku], [data-free]'); if (!b) return;
      const now = performance.now(), l = last[type];
      const tooSoon = now - openT < 350; // the rest of the tap that just opened a screen
      if (tooSoon || (l && l.b === b && now - l.t < 400)) { e.stopImmediatePropagation(); e.preventDefault(); return; }
      last[type] = { b, t: now };
      if (type === 'pointerdown' && !b.matches('.card')) { initAudio(); sfx('tap'); }
    }, true);
  }
  return { opened: () => { openT = performance.now(); } };
})();
function showScreen(id) { for (const sId of screens) { $(sId).classList.toggle('hidden', sId !== id); $(sId).scrollTop = 0; } if (id === 'title') renderTitle(); if (id === 'sanctum') renderSanctum(); if (id === 'statsScr') renderStats(); if (id === 'codex') renderCodex(); if (id === 'dungeons') renderDungeons(); }
function startRun() { initAudio(); for (const sId of screens) $(sId).classList.add('hidden'); newGame(); }
// main menu: drifting motes, a pulsing staff crystal, and the wizard casting a random spell now and then
const titleFx = (() => {
  const cv = $('titleFx'); if (!cv) return null;
  const S = 420, g = cv.getContext('2d'); cv.width = cv.height = S * 2; g.scale(2, 2);
  const parts = [], shots = [], img = new Image(); img.src = 'sprites/wizard.png';
  const TIP = { x: 254, y: 236 };
  const wiz = document.querySelector('#titleWiz img');
  const ELS = Object.values(ELEMENTS);
  let next = 1.2, last = performance.now();
  const glow = (x, y, r, col, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.globalAlpha = a; g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); };
  function cast() {
    const E = ELS[Math.floor(Math.random() * ELS.length)], kind = Math.floor(Math.random() * 3);
    const n = kind === 0 ? 1 : kind === 1 ? 5 : 12, base = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    for (let k = 0; k < n; k++) {
      const a = kind === 2 ? k / n * Math.PI * 2 : base + (k - (n - 1) / 2) * 0.28, sp = kind === 2 ? 110 : 190 + Math.random() * 40;
      shots.push({ x: TIP.x, y: TIP.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1.1, col: E.color, r: kind === 0 ? 13 : 9 });
    }
    for (let k = 0; k < 18; k++) { const a = Math.random() * 6.28, v = 30 + Math.random() * 90; parts.push({ x: TIP.x, y: TIP.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6, max: 0.6, col: E.color, r: 2 + Math.random() * 2 }); }
    flashT = 0.25; flashCol = E.color;
  }
  let flashT = 0, flashCol = '#ffffff';
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!$('title').classList.contains('hidden')) {
      g.clearRect(0, 0, S, S);
      { // find the staff crystal on screen every frame (the sprite bobs)
        const cr = cv.getBoundingClientRect(), wr = wiz.getBoundingClientRect(), tip = (sheets.wizard && sheets.wizard.tip) || [0.89, 0.67];
        if (cr.width) { TIP.x = (wr.left + wr.width * tip[0] - cr.left) * S / cr.width; TIP.y = (wr.top + wr.height * (1 - tip[1]) - cr.top) * S / cr.height; }
      }
      if (Math.random() < 0.25) parts.push({ x: 40 + Math.random() * 340, y: 300 + Math.random() * 110, vx: (Math.random() - 0.5) * 14, vy: -18 - Math.random() * 30, life: 3.5, max: 3.5, col: ['#a07bff', '#6fe3ff', '#ff7fe0'][Math.floor(Math.random() * 3)], r: 2 + Math.random() * 3 });

      flashT = Math.max(0, flashT - dt);
      g.globalCompositeOperation = 'lighter';
      const pulse = 0.55 + Math.sin(now / 300) * 0.15;
      glow(TIP.x, TIP.y, 34 + flashT * 160, flashT > 0 ? flashCol : '#ff7fe0', Math.min(1, pulse + 0.25 + flashT * 3));
      glow(210, 300, 150, '#5a3aa8', 0.22 + Math.sin(now / 700) * 0.06);
      for (let i = shots.length - 1; i >= 0; i--) {
        const s = shots[i]; s.life -= dt; s.x += s.vx * dt; s.y += s.vy * dt;
        glow(s.x, s.y, s.r * 3.2, s.col, Math.min(1, s.life * 1.5));
        glow(s.x, s.y, s.r, '#ffffff', Math.min(1, s.life * 1.5) * 0.8);
        if (Math.random() < 0.7) parts.push({ x: s.x, y: s.y, vx: 0, vy: 0, life: 0.35, max: 0.35, col: s.col, r: s.r * 0.6 });
        if (s.life <= 0) { for (let k = 0; k < 8; k++) { const a = Math.random() * 6.28; parts.push({ x: s.x, y: s.y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, life: 0.4, max: 0.4, col: s.col, r: 2 }); } shots.splice(i, 1); }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]; p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.97; p.vy *= 0.97;
        glow(p.x, p.y, p.r * 3, p.col, Math.max(0, p.life / p.max) * 0.9);
        if (p.life <= 0) parts.splice(i, 1);
      }
      g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  return { cast };
})();
function renderTitle() {
  const sv = loadRun(); // a saved run: CONTINUE leads, PLAY asks first
  $('btnContinue').classList.toggle('hidden', !sv); $('btnPlay').classList.toggle('big', !sv);
  if (sv) $('btnContinue').textContent = `CONTINUE · Floor ${sv.floor}`;
  renderVChest('titleChest'); $('best').innerHTML = `<span class="shard">◆ ${meta.shards}</span> soul shards${meta.stats.bestFloor ? ` · best floor ${meta.stats.bestFloor}` : ''}`; }
function heroThumb(id) { const h = HEROES[id], s = sheets[h.sprite]; return s ? s.canvas.toDataURL() : ''; }
function renderSanctum() {
  $('shardBal').innerHTML = `◆ ${meta.shards.toLocaleString()} <b>+</b>`;
  $('heroList').innerHTML = Object.entries(HEROES).filter(([id]) => id === 'wizard').map(([id, h]) => {
    const own = meta.heroes.includes(id), cur = meta.hero === id;
    return `<button class="sp${cur ? ' cur' : ''}" data-hero="${id}" ${!own && meta.shards < h.cost ? 'disabled' : ''} style="--c:#ff8be0" title="${h.info}">
      <img src="${heroThumb(id)}" alt="">${h.name}<small>${cur ? 'PLAYING' : own ? 'PICK' : '◆ ' + h.cost}</small></button>`;
  }).join('') + `<p class="beast" style="grid-column:1/-1;text-align:center">${HEROES[meta.hero].info}</p>`;
  $('upgList').innerHTML = UPGRADES.map((u) => {
    const l = mlv(u.id), maxed = l >= u.max, cost = maxed ? 0 : u.cost[l];
    return `<div class="upg"><div class="ci" style="--img:url(${iconPath('up_' + u.id) || iconURL(u.icon[0], u.icon[1])})"></div>
      <div class="ut"><h3>${u.name}</h3><p>${u.info}</p><div class="pips">${'<i class="on"></i>'.repeat(l)}${'<i></i>'.repeat(u.max - l)}</div></div>
      <button data-up="${u.id}" class="${!maxed && meta.shards < cost ? 'short' : ''}" ${maxed ? 'disabled' : ''}>${maxed ? 'MAX' : '◆ ' + cost}</button></div>`;
  }).join('');
  // any discovered single-element or boss spell whose element you have can start a run
  const starts = meta.codex.filter((id) => { const d = spellDef(id); return d && !d.fused && !d.legendary && d.els.every((e) => meta.elements.includes(e)); });
  $('startList').innerHTML = starts.map((id) => {
    const d = spellDef(id), cur = meta.start === id;
    return `<button class="sp${cur ? ' cur' : ''}" data-sp="${id}" style="--c:${d.color}"><span class="ci" style="--img:url(${spellIcon(d)})"></span>${d.name}<small>${cur ? 'EQUIPPED' : 'EQUIP'}</small></button>`;
  }).join('') || '<p class="beast">Discover spells in runs to start with them.</p>';

  renderVault(); renderVChest(); renderStore(); renderCharStats();
  $('elList').innerHTML = ELEMENT_ORDER.map((el) => {
    const E = ELEMENTS[el], has = meta.elements.includes(el);
    const by = Object.values(BOSS_SPELLS).find((b) => b.unlocks === el);
    const bossName = by ? (BOSSES.find((b) => b.type === by.boss) || {}).name : '';
    const src = elementIconSrc(el);
    return `<span class="elchip${has ? '' : ' off'}" style="--c:${E.color};--img:url(${elemIcon(el)})"><i></i>${E.name}${has ? '' : ` · beat ${bossName ? bossName.toLowerCase() : 'a boss'}`}</span>`;
  }).join('');
}
let vaultSel = null; // { from: 'slot' | 'stash', key }
const VCHEST_ODDS = [['Common gear', 50], ['Rare gear', 30], ['Epic gear', 15], ['Legendary gear', 5]];
const vchestCost = () => 300 + (meta.vchests || 0) * 75;
function renderVChest(target = 'vchest') {
  const c = vchestCost();
  const chest = iconPath('relic_tome') ? '' : '';
  if (!$(target)) return;
  $(target).innerHTML = `<button data-vchest="1" class="vchest">
      <span class="rays"></span><img src="${iconURL('items', 4, 128)}" alt="">
      <div><b>LUCKY CHEST</b><small>A random piece of gear for your Vault</small>
        <div class="odds">${VCHEST_ODDS.map(([k, w], i) => `<i style="--c:${RARITY[i].color}">${k.replace(' gear', '')} ${w}%</i>`).join('')}</div></div>
      <em>${meta.shards < c && Monet.iapEnabled ? `BUY<br>${dealProduct().price}` : `OPEN<br>◆ ${c}`}</em></button>`;
}
const dealProduct = () => PRODUCTS.find((x) => x.deal);
async function openVChest() {
  const c = vchestCost();
  if (meta.shards < c && !Monet.iapEnabled) return needShards(c); // no purchases (iOS for now): just say so
  if (meta.shards < c) { // the button says BUY: purchase the deal, then open
    const prod = await Monet.buy(dealProduct().sku); if (!prod) return;
    grantProduct(prod); toast('PURCHASED', prod.name);
    if (meta.shards < c) { renderTitle(); renderVChest('overChest'); if (!$('sanctum').classList.contains('hidden')) renderSanctum(); return; }
  }
  meta.shards -= c; meta.vchests = (meta.vchests || 0) + 1;
  let r = Math.random() * 100, rar = 0;
  for (let k = 0; k < VCHEST_ODDS.length; k++) { if ((r -= VCHEST_ODDS[k][1]) <= 0) { rar = k; break; } }
  const it = rollGear(Math.random, Math.max(5, meta.stats.bestFloor || 1), 0, rar); it.rarity = Math.max(it.rarity, rar);
  meta.stash.push(it); saveMeta(); initAudio(); sfx('clear');
  if (!$('sanctum').classList.contains('hidden')) renderSanctum();
  renderTitle(); renderVChest('overChest'); if ($('overUps')) $('overUps').innerHTML = overUpgrades();
  const el = document.createElement('div'); el.className = 'ad-overlay';
  el.innerHTML = `<div class="ad-box chestwin" style="--c:${RARITY[it.rarity].color}"><small>LUCKY CHEST</small><img src="${gearIcon(it)}" alt=""><b>${it.name}</b>
    <small>${RARITY[it.rarity].name} ${SLOT_NAMES[it.slot]} · sent to your storage</small><p>${gearLines(it).join('<br>')}</p>
    <button class="ad-close" data-x="again">${meta.shards < vchestCost() && Monet.iapEnabled ? `BUY ANOTHER · ${dealProduct().price}` : `OPEN ANOTHER · ◆ ${vchestCost()}`}</button><button class="ad-skip" data-x="ok">nice</button></div>`;
  $('app').appendChild(el); flash(0.3);
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-x]'); if (!b) return; el.remove(); if (b.dataset.x === 'again') openVChest(); });
}
// short on shards: go straight to buying a shard pack (the Mega Deal, or the smallest pack that covers the gap)
async function needShards(cost) {
  if (!Monet.iapEnabled) { Monet.notice('Not enough soul shards', `You need ◆ ${cost - meta.shards} more. Earn them on your runs.`); return; }
  const short = cost - meta.shards, packs = PRODUCTS.filter((x) => x.shards).sort((a, b) => a.shards - b.shards);
  const deal = packs.find((x) => x.deal);
  const prod = deal.shards >= short ? deal : packs.find((x) => x.shards >= short) || packs[packs.length - 1];
  initAudio();
  const got = await Monet.buy(prod.sku);
  if (got) { grantProduct(got); toast('PURCHASED', got.name); }
  if (!$('sanctum').classList.contains('hidden')) renderSanctum();
  if (!$('over').classList.contains('hidden') && $('overUps')) $('overUps').innerHTML = overUpgrades();
  renderTitle(); renderVChest('overChest');
}
// a purchase that finished while the app was closed (or the store answered late) is delivered when Play reports it
Monet.onGrant = (prod) => {
  grantProduct(prod); toast('PURCHASE DELIVERED', prod.name);
  renderTitle(); renderVChest('overChest'); if (!$('sanctum').classList.contains('hidden')) renderSanctum();
};
setTimeout(() => Monet.init(), 3000); // connect to Google Play Billing after the first frames, not during boot
function grantProduct(prod) {
  if (prod.shards) meta.shards += prod.shards;
  if (prod.sku === 'starter_pack') { meta.shards += 1000; const it = rollGear(Math.random, 20, 0, 3); if (!meta.vault[it.slot]) meta.vault[it.slot] = it; else meta.stash.push(it); }
  saveMeta(); sfx('clear');
}
function renderStore() {
  const free = Monet.dailyLeft('free_shards', 3);
  $('storeList').innerHTML = `<p class="beast">${Monet.mode === 'test' ? 'TEST MODE: no real money or ads on the web link.' : Monet.mode === 'web' ? 'WEB VERSION: no ads. Shop items are in the Android app.' : ''}</p>
    ${(Monet.iapEnabled ? [...PRODUCTS] : []).sort((a, b) => (b.deal ? 2 : b.sku === 'remove_ads' ? 1 : 0) - (a.deal ? 2 : a.sku === 'remove_ads' ? 1 : 0)).map((p) => { const owned = p.once && Monet.owns(p.sku);
      return `<button class="sitem${p.deal ? ' best' : ''}${p.sku === 'remove_ads' ? ' noads' : ''}" data-sku="${p.sku}" ${owned ? 'disabled' : ''}><b>${p.name}${p.deal ? ' <i>BEST DEAL</i>' : ''}${p.sku === 'remove_ads' && !owned ? ' <i class="pop">POPULAR</i>' : ''}</b><small>${p.info}</small><em>${owned ? 'OWNED' : p.price}</em></button>`; }).join('')}
    <button class="sitem free" data-free="1" ${free > 0 ? '' : 'disabled'}><b>Free soul shards</b><small>${Monet.mode === 'web' ? 'Claim' : 'Watch an ad for'} ◆ 100 · ${free} left today</small><em>▶ FREE</em></button>
    ${Monet.canRestore ? '<button class="sitem" data-restore="1"><b>Restore purchases</b><small>Get back Remove Ads and the Starter Pack</small><em>↺</em></button>' : ''}`;
}
async function storeClick(e) {
  const f = e.target.closest('[data-free]'), b = e.target.closest('[data-sku]');
  if (e.target.closest('[data-restore]')) { await Monet.restore(); renderSanctum(); return; }
  if (f && !f.disabled) { if (await Monet.rewarded('free_shards')) { Monet.useDaily('free_shards'); meta.shards += 100; saveMeta(); sfx('coin', 10); renderSanctum(); } return; }
  if (!b || b.disabled) return;
  const prod = await Monet.buy(b.dataset.sku); if (!prod) return;
  grantProduct(prod); renderSanctum(); toast('PURCHASED', prod.name);
}
// permanent stat points bought with shards; each point in a stat costs more than the last
const statCost = (k) => 100 + 50 * ((meta.statBuy || {})[k] || 0);
function permStat(k) {
  const H = HEROES.wizard, mainStat = { mage: 'int', archer: 'dex', warrior: 'str', hunter: 'str' }[H.cls];
  return (H.base[k] || 0) + ((meta.statBuy || {})[k] || 0) + 2 * (meta.winStats || 0) + (k === mainStat ? meta.legacy || 0 : 0) + (k === 'vit' ? Math.floor((meta.legacy || 0) / 3) : 0);
}
function renderCharStats() {
  const cls = HEROES.wizard.cls;
  $('charStats').innerHTML = `<div class="invlabel">BASE STATS · every run starts with these</div><div class="bstats">${STATS.map((k) => {
    const c = statCost(k);
    return `<div class="bstat"><div><b>${STAT_NAMES[k]}</b><em>${permStat(k)}</em></div><small>${statInfo(cls, k)}</small>
      <button class="buy${meta.shards < c ? ' short' : ''}" data-buystat="${k}">+<span>◆${c}</span></button></div>`; }).join('')}</div>`;
}
function renderVault() {
  const tile = (it, attr, sel, slot) => it
    ? `<button class="vt${sel ? ' sel' : ''}" ${attr} style="--c:${RARITY[it.rarity].color};--img:url(${gearIcon(it)})"><i></i></button>`
    : `<button class="vt empty" ${attr} style="--img:url(${iconURL('gear', SLOTS.indexOf(slot))})"><i></i><small>${SLOT_NAMES[slot]}</small></button>`;
  const slots = paperDoll(meta.vault, (k) => `data-vslot="${k}"`, vaultSel && vaultSel.from === 'slot' ? vaultSel.key : null);
  const stash = meta.stash.map((it, i) => tile(it, `data-vstash="${i}"`, vaultSel && vaultSel.from === 'stash' && vaultSel.key === i)).join('');
  const empties = (6 - (meta.stash.length % 6)) % 6 + (meta.stash.length < 12 ? 12 - meta.stash.length - ((6 - (meta.stash.length % 6)) % 6) : 0);
  let detail = '<p class="beast">Tap an item.</p>';
  const it = vaultSel && (vaultSel.from === 'slot' ? meta.vault[vaultSel.key] : meta.stash[vaultSel.key]);
  if (it) {
    const cur = vaultSel.from === 'stash' ? meta.vault[it.slot] : null;
    detail = `<div class="vdet" style="--c:${RARITY[it.rarity].color}"><b>${it.name}</b><small>${RARITY[it.rarity].name} ${SLOT_NAMES[it.slot]}</small><p>${gearLines(it).join('<br>')}</p>
      ${cur ? `<small>Replaces ${cur.name}</small>` : ''}
      <div class="vbtns">${vaultSel.from === 'stash' ? '<button data-vact="equip">EQUIP</button>' : '<button data-vact="unequip">UNEQUIP</button>'}<button data-vact="discard">DISCARD</button></div></div>`;
  }
  $('vaultList').innerHTML = `<div class="invframe">${slots}
    <div class="invlabel">STORAGE · ${meta.stash.length} · tap to wear</div>
    <div class="vgrid inv">${stash}${'<div class="vt void"></div>'.repeat(empties)}</div></div>${detail}`;
}
$('vaultList').addEventListener('click', (e) => {
  const t = e.target.closest('[data-vslot],[data-vstash],[data-vact]'); if (!t) return;
  if (t.dataset.vslot) vaultSel = meta.vault[t.dataset.vslot] ? { from: 'slot', key: t.dataset.vslot } : null;
  else if (t.dataset.vstash !== undefined) vaultSel = { from: 'stash', key: +t.dataset.vstash };
  else if (vaultSel) {
    const a = t.dataset.vact;
    if (a === 'equip') { const it = meta.stash.splice(vaultSel.key, 1)[0], old = meta.vault[it.slot]; meta.vault[it.slot] = it; if (old) meta.stash.push(old); vaultSel = { from: 'slot', key: it.slot }; }
    if (a === 'unequip') { meta.stash.push(meta.vault[vaultSel.key]); delete meta.vault[vaultSel.key]; vaultSel = null; }
    if (a === 'discard') { if (vaultSel.from === 'slot') delete meta.vault[vaultSel.key]; else meta.stash.splice(vaultSel.key, 1); vaultSel = null; sfx('pot'); }
    saveMeta();
  }
  initAudio(); renderVault();
});
function renderRecords() {
  const st = meta.stats;
  $('records').innerHTML = [['Runs', st.runs], ['Victories', meta.wins || 0], ['Best floor', `${st.bestFloor} / ${WIN_FLOOR}`], ['Legacy level', meta.legacy || 0], ['Bosses slain', st.bosses], ['Foes slain', fmtNum(st.kills)], ['Spells found', `${meta.codex.length}/${TOTAL_SPELLS}`]]
    .map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
}
function renderCodex() {
  renderRecords();
  const codex = new Set(meta.codex);
  $('codexCount').innerHTML = `<b>${codex.size}</b> / ${TOTAL_SPELLS} spells discovered`;
  const canStart = (d) => d && !d.fused && !d.legendary && d.els.every((e) => meta.elements.includes(e));
  const tile = (id) => { const d = spellDef(id); return codex.has(id) ? `<div class="got${meta.start === id ? ' start' : ''}" data-cx="${id}" title="${d.name}" style="--c:${d.color};--img:url(${spellIcon(d)})"></div>` : '<div class="unk">?</div>'; };
  const sd = spellDef(meta.start);
  $('codexCount').innerHTML += `<br><span class="beast">Starting spell: <b style="color:${sd ? sd.color : '#fff'}">${sd ? sd.name : '-'}</b> · tap a spell you found to start with it</span><div id="cxDetail"></div>`;
  let html = '';
  for (const el of ELEMENT_ORDER) {
    const E = ELEMENTS[el], src = elementIconSrc(el), n = Object.keys(SHAPES).filter((sh) => codex.has(el + '.' + sh)).length;
    html += `<h3><span class="elchip${meta.elements.includes(el) ? '' : ' off'}" style="--c:${E.color};--img:url(${elemIcon(el)})"><i></i>${E.name}</span> ${n}/14 · ${E.info}</h3>`;
    html += `<div class="cgrid">${Object.keys(SHAPES).map((sh) => tile(el + '.' + sh)).join('')}</div>`;
  }
  const fused = meta.codex.filter((id) => spellDef(id) && spellDef(id).fused);
  html += `<h3>Fusions ${fused.length}/392</h3><div class="cgrid">${fused.map(tile).join('') || ''}</div>`;
  if (!fused.length) html += '<p class="beast">Fuse two level-3 spells of different elements in a run.</p>';
  html += `<h3>Boss spells</h3><div class="cgrid">${Object.keys(BOSS_SPELLS).map(tile).join('')}</div>`;
  html += `<h3>Legendary</h3><div class="cgrid">${Object.keys(LEGENDARY).map(tile).join('')}</div>`;
  html += '<h3>Bestiary</h3>';
  const nameOf = { slime: 'Slime', big: 'Big slime', eye: 'Eye bat', imp: 'Shadow imp', skeleton: 'Skeleton', bomber: 'Bomber', ghost: 'Ghost', shroom: 'Mushroom', golem: 'Golem', mimic: 'Mimic',
    boss: 'King Gloop', tyrant: 'Bone Tyrant', eyeboss: 'Hollow Eye', sporeboss: 'Mother Spore', golemboss: 'Stone King', wraithboss: 'Wraith Queen' };
  for (const [type, r] of Object.entries(RES)) {
    const weak = Object.entries(r).filter(([, v]) => v > 1).map(([k]) => ELEMENTS[k].name), res = Object.entries(r).filter(([, v]) => v < 1).map(([k, v]) => ELEMENTS[k].name + (v === 0 ? ' (immune)' : ''));
    html += `<p class="beast"><b>${nameOf[type] || type}</b>${UNDEAD.has(type) ? ' · undead' : ''} — ${weak.length ? `<span class="w">weak: ${weak.join(', ')}</span>` : ''}${weak.length && res.length ? ' · ' : ''}${res.length ? `<span class="r">resists: ${res.join(', ')}</span>` : ''}</p>`;
  }
  $('codexBody').innerHTML = html;
  $('codexBody').onclick = (e) => {
    const t = e.target.closest('[data-cx]'); if (!t) return;
    const d = spellDef(t.dataset.cx), ok = canStart(d);
    $('cxDetail').innerHTML = `<div class="vdet" style="--c:${d.color}"><button class="cxclose" data-cxclose="1">✕</button><b>${d.name}</b><small>${d.els.map((x) => ELEMENTS[x].name).join(' + ')} · ${d.cd}s</small><p>${d.info}</p>
      ${ok ? `<div class="vbtns"><button data-start="${d.id}">${meta.start === d.id ? 'STARTING SPELL ✓' : 'START WITH THIS'}</button></div>` : `<small>${d.fused || d.legendary ? 'Fusions and legendaries cannot be starting spells.' : `Unlock ${d.els.filter((x) => !meta.elements.includes(x)).map((x) => ELEMENTS[x].name).join(' and ')} by beating its boss to start with this.`}</small>`}</div>`;
    $('cxDetail').classList.add('open'); // a sheet over the bottom of the screen: the list stays where you scrolled it
  };
  $('codexCount').onclick = (e) => { if (e.target.closest('[data-cxclose]')) { $('cxDetail').classList.remove('open'); return; } const b = e.target.closest('[data-start]'); if (!b) return; meta.start = b.dataset.start; saveMeta(); renderCodex(); };
}
function renderStats() {
  const st = meta.stats;
  const rows = [['Runs', st.runs], ['Best floor', st.bestFloor], ['Foes slain', fmtNum(st.kills)], ['Bosses slain', st.bosses], ['Champions slain', st.champs],
    ['Damage dealt', fmtNum(st.dmg)], ['Best combo', st.bestCombo + 'x'], ['Coins found', fmtNum(st.coins)], ['Time in the depths', fmtTime(st.time)], ['Shards earned', fmtNum(st.shardsTotal)]];
  $('statList').innerHTML = rows.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
}
$('sanctum').addEventListener('click', (e) => {
  const bs = e.target.closest('[data-buystat]');
  if (bs) { if (bs.disabled) return; const k = bs.dataset.buystat, c = statCost(k); if (meta.shards < c) return needShards(c); meta.shards -= c; meta.statBuy = meta.statBuy || {}; meta.statBuy[k] = (meta.statBuy[k] || 0) + 1; saveMeta(); initAudio(); sfx('buy'); renderSanctum(); return; }
  if (e.target.closest('#storeList')) { storeClick(e); return; }
  const tb = e.target.closest('.tabs button');
  if (tb) { for (const b of document.querySelectorAll('.tabs button')) b.classList.toggle('on', b === tb); for (const d of document.querySelectorAll('#sanctum .tab')) d.classList.toggle('hidden', d.dataset.tab !== tb.dataset.tab); $('sanctum').scrollTop = 0; return; }
  const b = e.target.closest('button'); if (!b || b.disabled) return;
  if (b.dataset.up) { const u = UPGRADES.find((x) => x.id === b.dataset.up), l = mlv(u.id); if (l < u.max && meta.shards < u.cost[l]) return needShards(u.cost[l]); if (l < u.max && meta.shards >= u.cost[l]) { meta.shards -= u.cost[l]; meta.up[u.id] = l + 1; saveMeta(); initAudio(); sfx('buy'); } }
  if (b.dataset.sp) { meta.start = b.dataset.sp; saveMeta(); }
  if (b.dataset.hero) {
    const h = b.dataset.hero;
    if (!meta.heroes.includes(h) && meta.shards >= HEROES[h].cost) { meta.shards -= HEROES[h].cost; meta.heroes.push(h); }
    if (meta.heroes.includes(h)) meta.hero = h;
    saveMeta(); initAudio(); sfx('card');
  }
  renderSanctum();
});
function renderDungeons() {
  $('dungeonList').innerHTML = BIOME_KEYS.map((k) => {
    const [name, desc] = DUNGEON_INFO[k], cur = meta.dungeon === k, img = ICONS.has('dungeon_' + k) ? `icons/dungeon_${k}.png` : '';
    const B = BIOMES[k], c = '#' + new THREE.Color(B.wall).getHexString(), f = '#' + new THREE.Color(B.fog).getHexString();
    return `<button class="dng${cur ? ' cur' : ''}" data-dng="${k}" style="--c:${c};background:${img ? `url(${img}) center/cover` : `linear-gradient(135deg, ${c}, ${f})`}">
      <span><b>${name}</b><small>${desc}</small></span></button>`;
  }).join('');
}
$('dungeonList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-dng]'); if (!b) return;
  meta.dungeon = b.dataset.dng; saveMeta(); startRun();
});
// every run rolls a dungeon (never the same twice in a row) and shows you where you are going
function rollAndRevealDungeon() {
  const opts = BIOME_KEYS.filter((k) => k !== meta.lastDungeon);
  G.runDungeon = AUTO ? (meta.lastDungeon || 'crypt') : opts[Math.floor(Math.random() * opts.length)];
  meta.lastDungeon = G.runDungeon; saveMeta();
  const [name, desc] = DUNGEON_INFO[G.runDungeon], img = ICONS.has('dungeon_' + G.runDungeon) ? `icons/dungeon_${G.runDungeon}.png` : '';
  const el = $('reveal');
  const kept = SLOTS.map((k) => meta.vault[k]).filter(Boolean);
  const carry = kept.length ? `<div class="carry"><p class="beast">YOU CARRY</p><div>${kept.map((it) => `<span title="${it.name}" style="--c:${RARITY[it.rarity].color};--img:url(${gearIcon(it)})"><i></i><b>${it.name}</b></span>`).join('')}</div></div>` : '';
  el.innerHTML = `<p class="beast">YOU DESCEND INTO</p>${img ? `<img src="${img}" alt="">` : ''}<h1>${name}</h1><p class="sub">${desc}</p>${carry}`;
  for (const sId of screens) $(sId).classList.add('hidden');
  el.classList.remove('hidden'); initAudio(); sfx('stairs');
  setTimeout(() => { el.classList.add('hidden'); startRun(); }, kept.length ? 3200 : 2200);
}
$('btnPlay').addEventListener('click', () => { const sv = loadRun(); if (sv) confirmNewRun(sv.floor); else rollAndRevealDungeon(); });
$('btnContinue').addEventListener('click', () => { const sv = loadRun(); if (sv) continueRun(sv); else renderTitle(); });
function confirmNewRun(floor) {
  const el = document.createElement('div'); el.className = 'ad-overlay'; el.id = 'newRunAsk';
  el.innerHTML = `<div class="ad-box"><b>Start a new run?</b><p>Your saved run on Floor ${floor} will be lost.</p>
    <button class="ad-close" data-x="new">START NEW RUN</button><button class="ad-skip" data-x="keep">cancel</button></div>`;
  $('app').appendChild(el);
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-x]'); if (!b) return; el.remove(); if (b.dataset.x === 'new') { clearRun(); rollAndRevealDungeon(); } });
}
$('shardBal').addEventListener('click', () => { const t = document.querySelector('.tabs [data-tab=store]'); if (t) t.click(); }); // tap the balance to open the store
document.addEventListener('click', (e) => { if (e.target.closest('[data-vchest]')) openVChest(); });
$('btnAgain').addEventListener('click', () => {
  if (G.deadT < 1) return;
  if ($('btnAgain').classList.contains('locked')) { const v = document.querySelector('.vault.keep'); if (v) { v.classList.remove('nudge'); void v.offsetWidth; v.classList.add('nudge'); v.scrollIntoView({ block: 'center', behavior: 'smooth' }); } return; }
  G.runsSinceAd = (G.runsSinceAd || 0) + 1;
  if (G.runsSinceAd >= 2 && !AUTO) { G.runsSinceAd = 0; Monet.interstitial('between_runs').then(rollAndRevealDungeon); return; }
  rollAndRevealDungeon();
});
$('overStats').addEventListener('click', async (e) => {
  const rv = e.target.closest('#adRevive');
  if (rv) {
    if (!(await Monet.rewarded('revive'))) return;
    G.run.adRevive = true; lastRun = G.deadRun; storeRun(); G.saveDue = true;
    { // the run isn't over after all: take back what the death screen paid out (it is paid again at the real end)
      const d = G.deathDelta || {}, st = meta.stats;
      meta.shards = Math.max(0, meta.shards - (d.total || 0)); st.shardsTotal -= d.total || 0; st.runs--;
      st.kills -= d.kills || 0; st.bosses -= d.bosses || 0; st.champs -= d.champs || 0; st.coins -= d.coins || 0; st.time -= d.time || 0; st.dmg -= d.dmg || 0;
      meta.legacyXp = Math.max(0, (meta.legacyXp || 0) - (d.lgGain || 0)); saveMeta();
    }
    showScreen(null); $('hud').classList.remove('hidden'); G.state = 'play';
    player.alive = true; player.hp = player.maxHp; player.iframe = 3; player.mesh.visible = player.shadow.visible = player.staffGlow.visible = true;
    renderHearts(); flash(0.6); sfx('heal'); explode({ x: player.x, z: player.z, aoe: 3.5, dmg: 80 }); toast('REVIVED', 'back in the fight');
    return;
  }
  const dbl = e.target.closest('#adDouble');
  if (dbl && !dbl.disabled) {
    if (!(await Monet.rewarded('double_shards'))) return;
    const t = +dbl.dataset.total; meta.shards += t; meta.stats.shardsTotal += t; saveMeta(); sfx('clear');
    dbl.disabled = true; dbl.textContent = `+${t} SHARDS ADDED`; $('shardCount').textContent = String(t * 2);
    $('overUps').innerHTML = overUpgrades(); return;
  }
  const b = e.target.closest('[data-buyup]'); if (!b || b.disabled) return;
  const u = UPGRADES.find((x) => x.id === b.dataset.buyup), l = mlv(u.id);
  if (l < u.max && meta.shards < u.cost[l]) return needShards(u.cost[l]);
  if (l < u.max && meta.shards >= u.cost[l]) { meta.shards -= u.cost[l]; meta.up[u.id] = l + 1; saveMeta(); sfx('buy'); $('overUps').innerHTML = overUpgrades(); }
});
// the shard shop, right on the death screen: what you can afford first, then what is next
function overUpgrades() {
  const list = UPGRADES.filter((u) => mlv(u.id) < u.max).map((u) => ({ u, cost: u.cost[mlv(u.id)] })).sort((a, b) => (meta.shards >= b.cost) - (meta.shards >= a.cost) || a.cost - b.cost).slice(0, 4);
  if (!list.length) return '';
  return `<div class="overups"><span>SPEND SOUL SHARDS · ◆ ${meta.shards}</span>${list.map(({ u, cost }) => `<button data-buyup="${u.id}" class="${meta.shards < cost ? 'short' : ''}">
    <i style="--img:url(${iconPath('up_' + u.id) || iconURL(u.icon[0], u.icon[1])})"></i><b>${u.name} ${mlv(u.id) + 1}/${u.max}</b><small>${u.info}</small><em>◆ ${cost}</em></button>`).join('')}</div>`;
}
$('btnSanctum').addEventListener('click', () => showScreen('sanctum'));
$('btnSanctum2').addEventListener('click', () => showScreen('sanctum'));
$('btnCodex').addEventListener('click', () => showScreen('codex'));
for (const b of document.querySelectorAll('.back')) b.addEventListener('click', () => showScreen(player && !player.alive ? 'over' : 'title'));
// in-run build / stats panel (pauses the game)
// ---------- Lucky Chest: spend coins any time for one random reward (odds shown on the button) ----------
const LUCKY_ODDS = [['Gear', 30], ['Spell level', 22], ['+2 stat points', 18], ['New spell', 12], ['Relic', 10], ['Healing', 7], ['Legendary spell', 1]];
const luckyCost = () => 20 + (G.run.chests || 0) * 10 + G.floor * 3;
// short on coins: the button says BUY. Buying the deal opens this chest for free on top.
async function needCoins(cost) {
  if (!Monet.iapEnabled) { Monet.notice('Not enough coins', `This chest costs ● ${cost}. Pick up more coins on this floor.`); return; }
  const prod = await Monet.buy(dealProduct().sku);
  if (!prod) return;
  grantProduct(prod); toast('PURCHASED', prod.name); openLuckyChest(true);
}
function openLuckyChest(paid = false) {
  const cost = luckyCost();
  if (!paid && G.coins < cost) return needCoins(cost);
  if (!paid) { G.coins -= cost; $('coins').textContent = G.coins; }
  G.run.chests = (G.run.chests || 0) + 1;
  let roll = rand() * 100, what = LUCKY_ODDS[0][0];
  for (const [k, w] of LUCKY_ODDS) { if ((roll -= w) <= 0) { what = k; break; } }
  const owned = new Set(spells.map((s) => s.id));
  const slotFree = spells.filter((s) => isSlotSpell(s.id)).length < 4;
  const upg = spells.filter((s) => s.lv < 5 && !spellDef(s.id).legendary);
  const newSpell = () => { const pool = []; for (const el of meta.elements) for (const sh of Object.keys(SHAPES)) if (!owned.has(el + '.' + sh)) pool.push(el + '.' + sh); const id = weightedSample(pool, (x) => SPELL_TIERS[spellTier(spellDef(x))].w, 1)[0]; spells.push({ id, lv: 1, t: 0.3 }); discover(id); toast('LUCKY CHEST: NEW SPELL', spellDef(id).name); };
  const levelUp = () => { const s = pick(upg); s.lv++; toast('LUCKY CHEST: LEVEL UP', `${spellDef(s.id).name} Lv ${s.lv}`); };
  const legend = Object.keys(LEGENDARY).filter((id) => !owned.has(id));
  if (legend.length && rand() < legendChance()) { /* the chest's legendary roll follows the same floor table */ const id = pick(legend); spells.push({ id, lv: 1, t: 1 }); discover(id); toast('LUCKY CHEST: LEGENDARY!', spellDef(id).name); flash(0.6); }
  else if (what === 'New spell' && slotFree) newSpell();
  else if ((what === 'Spell level' || what === 'New spell') && upg.length) levelUp();
  else if (what === '+2 stat points') { player.statPts += 2; $('pauseBtn').classList.add('pts'); toast('LUCKY CHEST', '+2 stat points'); }
  else if (what === 'Relic') relicOptions(1)[0].pick();
  else if (what === 'Healing' && player.hp < player.maxHp) { player.hp = Math.min(player.maxHp, player.hp + 4); renderHearts(); toast('LUCKY CHEST', 'Healed 2 hearts'); }
  else { const it = rollGear(rand, G.floor, player.g.luck + player.der.loot, what === 'Legendary spell' ? 2 : 0); dropGear(player.x, player.z, 0, it, true); toast('LUCKY CHEST', `<span style="color:${RARITY[it.rarity].color}">${it.name}</span> dropped next to you`); }
  burst(player.x, 1, player.z, 0xffd34f, 30, 5, 0.45, 0.7); sfx('clear'); G.saveDue = true;
  if (paid && !$('pause').classList.contains('hidden')) renderBuild(); // ad / shard path finishes after the click handler re-rendered
}
function paperDoll(gear, attrOf, sel, lv) {
  const tile = (k) => { const it = gear[k]; return it
    ? `<button class="vt${sel === k ? ' sel' : ''}" ${attrOf(k)} style="--c:${RARITY[it.rarity].color};--img:url(${gearIcon(it)})"><i></i></button>`
    : `<button class="vt empty" ${attrOf(k)} style="--img:url(${iconURL('gear', SLOTS.indexOf(k))})"><i></i><small>${SLOT_NAMES[k]}</small></button>`; };
  return `<div class="doll"><div class="dcol">${['hat', 'robe', 'staff'].map(tile).join('')}</div>
    <div class="dmid"><div class="aura"></div><img src="sprites/wizard.png" alt="">${lv ? `<span class="dlv">LV ${lv}</span>` : ''}</div>
    <div class="dcol">${['amulet', 'ring', 'boots'].map(tile).join('')}</div></div>`;
}
function renderBuild() {
  const p = player, d = p.der, g = p.g, pct = (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
  const statRows = `<div class="bstats">${STATS.map((k) => `<div class="bstat"><div><b>${STAT_NAMES[k]}</b><em>${p.st[k]}</em></div><small>${statInfo(p.hero.cls, k)}</small>
    ${p.statPts ? `<button data-stat="${k}">+</button>` : ''}</div>`).join('')}</div>`;
  const rows = [['Hearts', `${(p.hp / 2).toFixed(1)} / ${p.maxHp / 2}`], ['Damage', pct(p.dmgMul * g.dmg * d.dmg - 1)], ['Cooldowns', pct(p.cdMul * g.cd * d.cd - 1)],
    ['Crit', `${Math.round((p.crit + g.crit + d.crit) * 100)}% · x${(p.critDmg + g.critDmg + d.critDmg).toFixed(1)}`], ['Dodge', Math.round((g.dodge + d.dodge) * 100) + '%'],
    ['Move speed', pct(moveSpeed(p) / 5.4 - 1) + ' (max +80%)'], ['Status power', pct(d.status - 1)], ['Area', pct(p.area * g.area - 1)], ['Luck', pct(g.luck + d.loot)], ['Floor', G.floor], ['Time', fmtTime(G.run.time)]];
  const runeTxt = (s) => s.runes ? Object.entries(s.runes).map(([k, v]) => ({ pierce: `pierce ${v}`, bounce: `bounce ${v}`, seek: 'seeking' })[k]).join(', ') : '';
  const slot = (it, k, bag) => it
    ? `<div class="gearslot${bag ? ' bagit' : ''}" ${bag ? `data-bag="${k}"` : ''} style="--c:${RARITY[it.rarity].color}"><i class="ci" style="--img:url(${gearIcon(it)})"></i><div><b>${it.name}</b>${bag ? ' · tap to equip' : ''}<br>${gearLines(it).join(' · ')}</div></div>`
    : `<div class="gearslot empty"><i class="ci" style="--img:url(${iconURL('gear', SLOTS.indexOf(k))})"></i><div>${SLOT_NAMES[k]}: empty</div></div>`;
  const lc = luckyCost();
  $('buildList').innerHTML = `
    <button data-lucky="1" class="vchest"><span class="rays"></span><img src="${iconURL('items', 4, 128)}" alt="">
      <div><b>LUCKY CHEST</b><small>Spend coins for a random reward this run</small>
        <div class="odds">${LUCKY_ODDS.slice(0, 5).map(([k, w]) => `<i style="--c:#f0c36a">${k} ${w}%</i>`).join('')}</div></div>
      <em>${G.coins < lc && Monet.iapEnabled ? `BUY<br>${dealProduct().price}` : `OPEN<br>● ${lc}`}</em></button>
    ${p.statPts ? `<div class="pts">LEVEL ${p.lv} · ${p.statPts} points to spend</div>` : ''}
    ${paperDoll(p.gear, (k) => (p.gear[k] ? `data-ginfo="g:${k}"` : ''), null, p.lv)}
    <div class="wornlist">${SLOTS.filter((k) => p.gear[k]).map((k) => { const it = p.gear[k]; return `<div style="--c:${RARITY[it.rarity].color}"><b>${it.name}</b> ${gearLines(it).join(' · ')}</div>`; }).join('') || '<div>Nothing worn yet.</div>'}</div>
    ${statRows}
    <div class="bnums">${rows.filter(([k]) => k !== 'Floor' && k !== 'Time').map(([k, v]) => `<div><small>${k}</small><b>${v}</b></div>`).join('')}</div>

    <h3>Spells</h3><div class="chips">${spells.map((sp) => { const df = spellDef(sp.id); return `<span style="--c:${df.color}"><i class="ci" style="--img:url(${spellIcon(df)})"></i>${df.name} Lv ${sp.lv}${sp.runes ? ` <small>(${runeTxt(sp)})</small>` : ''}</span>`; }).join('')}</div>
    <h3>Relics</h3><div class="chips">${p.relics.length ? p.relics.map((id) => `<span>${RELICS.find((r) => r.id === id).name}</span>`).join('') : '<span>none yet</span>'}</div>`;
}
$('buildList').addEventListener('click', (e) => {
  const gi = e.target.closest('[data-ginfo]');
  if (gi) return; // gear is locked during a run; change it in the Vault before you go in
  const b = e.target.closest('[data-stat],[data-bag],[data-lucky]'); if (!b || b.disabled) return;
  if (b.dataset.lucky) openLuckyChest();
  if (b.dataset.stat && player.statPts > 0) { player.alloc[b.dataset.stat]++; player.statPts--; recalcStats(); sfx('card'); }
  if (b.dataset.bag !== undefined) { const it = player.bag.splice(+b.dataset.bag, 1)[0]; if (it) equipOrStash(it, true); }
  renderBuild();
});
$('pauseBtn').addEventListener('pointerdown', (e) => { e.stopPropagation(); pauseGame(); });
$('btnResume').addEventListener('click', () => { $('pause').classList.add('hidden'); G.state = 'play'; });
// leave mid-run without losing it: save at the last safe point and go to the title, where CONTINUE picks it up
$('btnSaveExit').addEventListener('click', () => {
  $('pause').classList.add('hidden'); G.state = 'play'; if (runSafe()) checkpoint(); else storeRun();
  G.state = 'title'; $('hud').classList.add('hidden'); showScreen('title');
});
$('btnQuit').addEventListener('click', () => { $('pause').classList.add('hidden'); G.state = 'play'; player.revive = 0; player.iframe = 0; player.hp = 0; playerDie(); });
addEventListener('resize', resize);

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min(0.05, (now - last) / 1000); last = now;
  tick(rdt);
  render();
}
const timers = [];
function later(sec, fn) { timers.push({ t: sec, fn }); }
function tick(rdt) {
  readKeys();
  for (let i = timers.length - 1; i >= 0; i--) if ((timers[i].t -= rdt) <= 0) { const f = timers[i].fn; timers.splice(i, 1); f(); }
  let dt = rdt;
  if (G.hitstop > 0) { G.hitstop -= rdt; dt = 0; }
  else if (G.finisher) { dt *= 0.16; if ((G.finisher.t -= rdt) <= 0) G.finisher = null; }
  else if (G.slowmo > 0) { G.slowmo -= rdt; dt *= 0.35; }
  if (G.state !== 'cards' && G.state !== 'title' && G.state !== 'paused') update(dt);
  updateCamera(rdt);
  G.comboPop = Math.max(0, G.comboPop - rdt * 5);
  if (player && player.alive && G.state === 'play' && player.hp <= 2) {
    G.beatT = (G.beatT || 0) - rdt;
    if (G.beatT <= 0) { G.beatT = 0.9; sfx('beat'); }
    lowEl.style.opacity = (0.25 + 0.35 * Math.pow(Math.max(0, Math.sin((0.9 - G.beatT) / 0.9 * Math.PI * 2)), 4)).toFixed(3);
  } else lowEl.style.opacity = 0;
  if (toastT > 0 && (toastT -= rdt) <= 0) $('toast').classList.remove('show');
  if (bannerT > 0 && (bannerT -= rdt) <= 0) $('banner').classList.remove('show');
}
const FPS = params.has('fps');
const perf = { n: 0, t: performance.now(), fps: 0, cpu: 0, calls: 0, worst: 0, last: performance.now() };
let perfEl = null;
if (FPS) { perfEl = document.createElement('div'); perfEl.style.cssText = 'position:absolute;left:8px;bottom:8px;z-index:60;font:12px monospace;color:#7fff9f;background:rgba(0,0,0,.6);padding:4px 6px;border-radius:6px;pointer-events:none;white-space:pre'; $('app').appendChild(perfEl); }
window.__perf = perf;
window.__g = { renderer, scene, sun, hemi, torchLights, get pLight() { return pLight; }, fxLight, fxCanvas, glowPoints, debrisMesh, splatMesh, resize };
function render() {
  const t0 = performance.now();
  if (player) { updateHud(); drawMinimap(); }
  renderer.render(scene, camera);
  drawOverlay();
  if (FPS || window.__perfOn) {
    const now = performance.now();
    perf.cpu = perf.cpu * 0.9 + (now - t0) * 0.1; perf.calls = renderer.info.render.calls; perf.worst = Math.max(perf.worst, now - perf.last); perf.last = now; perf.n++;
    if (now - perf.t > 1000) {
      perf.fps = Math.round(perf.n * 1000 / (now - perf.t)); perf.n = 0; perf.t = now;
      if (perfEl) perfEl.textContent = `${perf.fps} fps  worst ${perf.worst.toFixed(0)}ms
render ${perf.cpu.toFixed(1)}ms  calls ${perf.calls}
fx ${gData.filter((d) => d.life > 0).length}  enemies ${enemies.length}  dpr ${renderer.getPixelRatio().toFixed(2)}`;
      perf.worst = 0;
    }
  }
  if (recorder) { recCtx.drawImage(renderer.domElement, 0, 0, recCanvas.width, recCanvas.height); recCtx.drawImage(fxCanvas, 0, 0, recCanvas.width, recCanvas.height); }
}
let recorder = null, recCanvas = null, recCtx = null;
function toggleRecording(sec = 0) {
  if (recorder) { recorder.stop(); return; }
  if (!window.MediaRecorder) return;
  recCanvas = document.createElement('canvas');
  recCanvas.width = renderer.domElement.width; recCanvas.height = renderer.domElement.height;
  recCtx = recCanvas.getContext('2d');
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
  const chunks = [];
  recorder = new MediaRecorder(recCanvas.captureStream(30), { mimeType: mime, videoBitsPerSecond: 10e6 });
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type: mime }));
    a.download = `runebound_${Date.now()}.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
    a.click(); recorder = null; toast('RECORDING SAVED', a.download);
  };
  recorder.start(500);
  toast('RECORDING', sec ? `${sec}s` : 'press R to stop');
  if (sec) setTimeout(() => recorder && recorder.stop(), sec * 1000);
}

// compile every shader the effects use before play, so the first meteor / explosion / beam doesn't hitch
function warmShaders() {
  const tmp = [];
  const add = (o) => { if (o) { o.position.set(rooms[0].cx, 0.5, rooms[0].cz); tmp.push(o); if (!o.parent) scene.add(o); } };
  for (const rocky of [false, true]) { const m = makeMeteor(rooms[0].cx, rooms[0].cz, 0xff7a2a, rocky, 1.5); add(m.g); tmp.push(m.glow); }
  for (const k of ['bolt', 'fire', 'venom', 'lance', 'glaive', 'orb', 'javelin', 'axe', 'arrow', 'skull']) add(makeProjMesh(k, 0xff7fe0));
  add(new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: softRingTex, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
  add(new THREE.Mesh(markerGeo, new THREE.MeshBasicMaterial({ map: markTex, color: 0xff3050, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending })));
  add(new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xff2040, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false })));
  add(makeShadow(1)); add(makeGlow(0xffffff, 1, 1));
  try { renderer.compile(scene, camera); renderer.render(scene, camera); } catch (e) { /* warm-up is best effort */ }
  for (const o of tmp) { scene.remove(o); if (o.isSprite) o.material.dispose(); }
  meteors.length = 0;
}
(async function boot() {
  // app build: a save iOS dropped from localStorage comes back from native storage; reload once so every module reads it
  if (await restore([META_KEY, 'rbd_monet_v1', RUN_KEY], RUN_KEY, RUN_END)) {
    let again = false; try { again = Date.now() - (+sessionStorage.getItem('rbd_restored') || 0) > 10000; sessionStorage.setItem('rbd_restored', Date.now()); } catch (e) { /* no reload loop */ }
    if (again) { location.reload(); return; }
  }
  resize();
  await loadSheets();
  try { ICONS = new Set(await (await fetch('icons/manifest.json', { cache: 'no-cache' })).json()); } catch (e) { /* no painted icons yet */ }
  heartImg = iconURL('items', 2, 44); coinImg = iconURL('items', 0, 32);
  $('coinIco').style.backgroundImage = `url(${coinImg})`;
  renderTitle();
  // a dungeon behind the title screen
  player = newPlayer(); player.mesh.visible = false; player.shadow.visible = false;
  G.biome = BIOMES.crypt; applyBiomeLight(G.biome);
  genFloor(1); buildWorld(biomePalette(G.biome)); const s = rooms[0];
  camTarget.set(s.cx, 0, s.cz); G.curRoom = null;
  s.flames.slice(0, 4).forEach((f, k) => torchLights[k].position.copy(f.position).add(new THREE.Vector3(0, 0.3, 0.5)));
  killMesh(player.mesh); scene.remove(player.shadow); killGlow(player.staffGlow); player = null;
  warmShaders();
  $('fade').style.opacity = 0;
  if (AUTO) {
    $('title').classList.add('hidden'); newGame();
    if (FFWD > 0) { silent = true; const steps = Math.round(FFWD * 60); for (let i = 0; i < steps; i++) tick(1 / 60); silent = false; }
  }
  if (REC) toggleRecording(REC);
  if (BENCH) later(2.5, () => {
    spells = ['arcane.bolt', 'fire.orb', 'frost.nova', 'storm.chain', 'venom.fan', 'arcane.halo', 'fire.rain', 'shadow.wisp', 'fire+frost.field', 'meteor', 'hole'].map((id) => ({ id, lv: 5, t: Math.random() }));
    const r = rooms.find((q) => q.type === 'combat') || rooms[1];
    player.x = r.cx; player.z = r.cz;
    later(0.5, () => { if (!r.active) enterRoom(r); r.waves = 0; G.swarm = { room: r, t: 99999, spawnT: 0 }; });
  });
  window.__win = () => showVictory();
  window.__game = { G, get player() { return player; }, get pickups() { return pickups; }, cell: (x, z) => cellAt(x, z), dropGear: (r, given) => dropGear(player.x, player.z, r || 0, given), drop: (k) => dropPickup(player.x, player.z, k || 'coin'), get enemies() { return enemies; }, get portals() { return portals; }, get rooms() { return rooms; }, get props() { return props; }, spells: () => spells, tick, cards: () => openCards('ROOM CLEARED', upgradeOptions()), castNow: (id) => { const t = nearestEnemy(player.x, player.z, 20); if (t) castSpell({ id, lv: 1, t: 0 }, spellDef(id), t); } };
  requestAnimationFrame(frame);
})();

window.__portalPlaying = () => { try { return !!(G.state === 'play'); } catch (e) { return false; } };
