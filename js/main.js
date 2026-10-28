// 起動・設定・体験・終了。
//  - XRモード：Quest Browser の immersive-ar（パススルー）。現実の部屋に、乗客と吊り革と広告を重ねる。
//  - プレビューモード：PCブラウザ。仮の部屋を表示し、マウスで見回す（WASD で歩ける）。
// 体験の中身（director）は両モード共通。
import * as THREE from '../vendor/three.module.min.js';
import { Car, TextBoard } from './car.js';
import { TrainAudio } from './audio.js';
import { Announcer } from './voice.js';
import { Director } from './director.js';
import { EndButton, makeRay } from './ui3d.js';
import { loadSettings, saveSettings, clampSettings, CROWD, ROOM } from './settings.js';

const $ = (id) => document.getElementById(id);
const titleEl = $('title');
const startBtn = $('btn-start');
const previewBtn = $('btn-preview');
const backBtn = $('btn-back');
const statusEl = $('xr-status');
const hintEl = $('hint');

// 確認用の URL パラメータ
//  ?t=120            始まってすぐ、その秒数まで早送りする
//  ?events=seat,gaze,delay  3回の出来事を指定する（brake / gaze / manner / seat / delay）
//  ?seed=123         乗客の顔ぶれを固定する
const params = new URLSearchParams(location.search);
const SKIP_TO = parseFloat(params.get('t')) || 0;
const FORCE_EVENTS = params.get('events') ? params.get('events').split(',') : null;
const SEED = params.get('seed') ? parseInt(params.get('seed'), 10) : null;

// ---------- 設定フォーム ----------
let settings = loadSettings();
const form = {
  volume: $('volume'), volumeOut: $('volume-out'), voice: $('voice'), voiceStatus: $('voice-status'),
};
function writeForm(s) {
  document.querySelector(`input[name="crowd"][value="${s.crowd}"]`).checked = true;
  document.querySelector(`input[name="room"][value="${s.room}"]`).checked = true;
  form.volume.value = Math.round(s.volume * 100);
  form.volumeOut.value = form.volume.value;
  form.voice.checked = s.voice;
}
function readForm() {
  return clampSettings({
    ...settings,
    crowd: document.querySelector('input[name="crowd"]:checked')?.value,
    room: document.querySelector('input[name="room"]:checked')?.value,
    volume: form.volume.value / 100,
    voice: form.voice.checked,
  });
}
writeForm(settings);
form.volume.addEventListener('input', () => {
  form.volumeOut.value = form.volume.value;
  audio.setVolume(form.volume.value / 100);
  voice.volume = form.volume.value / 100;
});
$('settings').addEventListener('submit', (e) => e.preventDefault());

// ---------- レンダラーとシーン ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.02, 60);
scene.add(camera);
// 車内の蛍光灯っぽい、上からの白っぽい光
scene.add(new THREE.HemisphereLight(0xf3f4f0, 0x55504a, 2.0));
const sun = new THREE.DirectionalLight(0xffffff, 1.1);
sun.position.set(0.4, 3, 1.2);
scene.add(sun);

const car = new Car();
scene.add(car.root);
const board = new TextBoard();
car.root.add(board.mesh);
const audio = new TrainAudio();
const voice = new Announcer();
const director = new Director(car, audio, voice, board);
if (FORCE_EVENTS) director.forceEvents = FORCE_EVENTS;

const endButton = new EndButton();
scene.add(endButton.mesh);

voice.status().then((st) => {
  form.voiceStatus.textContent = {
    ok: `車内アナウンスは、この端末の日本語の音声合成で読み上げます（${voice.voice.name}）。`,
    'no-api': 'このブラウザは音声合成に対応していないため、アナウンスはチャイムと車内の電光掲示だけになります。',
    'no-ja': 'この端末には日本語の音声合成がないため、アナウンスはチャイムと車内の電光掲示だけになります。',
  }[st];
});

// ---------- 状態 ----------
const state = {
  mode: 'title', // 'title' | 'ride'
  xr: false,
  ready: false,
  floorKnown: true,
  floorY: 0,
};

// 今いる場所を「車内」の原点に（向いている方が -Z）
function anchorCar() {
  camera.updateMatrixWorld();
  const h = headPos();
  car.root.position.set(h.x, state.floorY, h.z);
  car.root.rotation.set(0, headYaw(), 0);
  car.root.updateMatrixWorld(true);
}

function headYaw() {
  camera.updateMatrixWorld();
  const f = new THREE.Vector3(0, 0, -1).transformDirection(camera.matrixWorld);
  return Math.atan2(-f.x, -f.z);
}
function headPos() {
  return new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
}

function beginRide() {
  state.mode = 'ride';
  anchorCar();
  const height = headPos().y - state.floorY;
  // 吊り革の輪は目より少し上。座っていても、天井より下に収まる高さ
  const ringY = THREE.MathUtils.clamp(height + 0.1, 1.62, 1.82);
  saveSettings(settings);
  audio.setVolume(settings.volume);
  audio.start();
  voice.enabled = settings.voice;
  voice.volume = settings.volume;
  director.begin({ crowd: CROWD[settings.crowd], room: ROOM[settings.room], ringY, seed: SEED ?? Date.now() });
  updateHead();
  if (SKIP_TO > 0) director.fastForward(SKIP_TO);
  for (const c of controllers) c.userData.ray.visible = false;
}

// プレイヤーの頭を車内座標で director に渡す
const _hl = new THREE.Vector3();
const _hw = new THREE.Vector3();
const _fw = new THREE.Vector3();
const _inv = new THREE.Matrix4();
function updateHead() {
  camera.updateMatrixWorld();
  _hw.setFromMatrixPosition(camera.matrixWorld);
  _inv.copy(car.root.matrixWorld).invert();
  _hl.copy(_hw).applyMatrix4(_inv);
  _fw.set(0, 0, -1).transformDirection(camera.matrixWorld).transformDirection(_inv);
  _fw.y = 0;
  if (_fw.lengthSq() < 1e-4) _fw.set(0, 0, -1);
  _fw.normalize();
  director.setHead(_hl, _hw, _fw, _hl.y);
}

// ---------- タイトル画面：XR 対応状況の確認 ----------
function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

async function checkXR() {
  if (!window.isSecureContext) {
    setStatus('WebXR は HTTPS（または localhost）でのみ動きます。https:// のURLで開いてください。PCではプレビューで見られます。', true);
    return;
  }
  if (!('xr' in navigator)) {
    setStatus('このブラウザは WebXR に対応していません。Meta Quest 3 のブラウザで開いてください。PCではプレビューで見られます。', true);
    return;
  }
  let ok = false;
  try {
    ok = await navigator.xr.isSessionSupported('immersive-ar');
  } catch (e) {
    console.warn(e);
  }
  if (ok) {
    startBtn.disabled = false;
    setStatus('パススルーMRで体験できます。');
  } else {
    setStatus('この環境はパススルーMR（immersive-ar）に対応していません。Meta Quest 3 のブラウザで開いてください。PCではプレビューで見られます。', true);
  }
}
checkXR();

// ---------- XR（Quest 3） ----------
const controllers = [];
for (let i = 0; i < 2; i++) {
  const c = renderer.xr.getController(i);
  c.userData.connected = false;
  const ray = makeRay();
  c.add(ray);
  c.userData.ray = ray;
  c.addEventListener('connected', () => { c.userData.connected = true; });
  c.addEventListener('disconnected', () => {
    c.userData.connected = false;
    ray.visible = false;
  });
  // トリガーを引き切ったとき／ピンチしたとき
  c.addEventListener('select', () => {
    if (!state.xr) return;
    controllerRay(c);
    onSelect(raycaster);
  });
  scene.add(c);
  controllers.push(c);
}

async function startXR() {
  settings = readForm();
  saveSettings(settings);
  audio.init(); // ボタン操作の中で音を有効化しておく
  audio.setVolume(settings.volume);
  startBtn.disabled = true;
  setStatus('起動中…');
  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', { optionalFeatures: ['local-floor'] });
  } catch (e) {
    console.error(e);
    setStatus(`パススルーMRを開始できませんでした（${e.name || 'Error'}: ${e.message || e}）。許可ダイアログで拒否した場合は、ページを再読み込みしてもう一度お試しください。`, true);
    startBtn.disabled = false;
    return;
  }
  let refType = 'local-floor';
  try {
    await session.requestReferenceSpace('local-floor');
  } catch (e) {
    refType = 'local';
  }
  state.floorKnown = refType === 'local-floor';
  renderer.xr.setReferenceSpaceType(refType);
  try {
    await renderer.xr.setSession(session);
  } catch (e) {
    console.error(e);
    setStatus(`XRの初期化に失敗しました（${e.message || e}）。`, true);
    startBtn.disabled = false;
    session.end().catch(() => {});
    return;
  }
  session.addEventListener('end', onXREnd);
  state.xr = true;
  state.ready = false;
  state.mode = 'wait';
  titleEl.hidden = true;
  backBtn.hidden = true;
  hintEl.hidden = true;
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  room.visible = false;
}

// XR の最初のフレーム：頭の位置が取れてから始める
function initXRFrame(frame) {
  const ref = renderer.xr.getReferenceSpace();
  const pose = frame && ref && frame.getViewerPose(ref);
  if (!pose) return false;
  camera.matrixWorld.fromArray(pose.transform.matrix);
  camera.matrixWorld.decompose(camera.position, camera.quaternion, camera.scale);
  const y = pose.transform.position.y;
  state.floorY = state.floorKnown ? 0 : y - 1.6; // 床が分からなければ立った人の目の高さと仮定
  beginRide();
  return true;
}

function onXREnd() {
  state.xr = false;
  backToTitle();
}

function quit() {
  if (state.xr) {
    const s = renderer.xr.getSession();
    if (s) s.end().catch(() => {});
  } else backToTitle();
}

// ---------- 光線と選択（「おわる」ボタン） ----------
const raycaster = new THREE.Raycaster();
const _rot = new THREE.Matrix4();
function controllerRay(c) {
  c.updateMatrixWorld(true);
  _rot.identity().extractRotation(c.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(_rot);
}

function onSelect(rc) {
  if (state.mode !== 'ride') return;
  if (endButton.mesh.visible && rc.intersectObject(endButton.mesh, false).length) quit();
  else endButton.summon(camera);
}

function updatePointers() {
  let hover = false;
  for (const c of controllers) {
    const ray = c.userData.ray;
    if (!c.userData.connected || !endButton.mesh.visible) {
      ray.visible = false;
      continue;
    }
    controllerRay(c);
    const h = raycaster.intersectObject(endButton.mesh, false)[0];
    if (h) hover = true;
    ray.visible = true;
    ray.scale.z = h ? h.distance : 1.2;
    ray.userData.dot.visible = !!h;
  }
  endButton.setHover(hover);
}

// ---------- PCプレビュー用の仮の部屋 ----------
// パススルーの代わり。XR と同じ見え方になるよう、深度を書かず一番最初に描く（CG はいつも部屋の手前）
const ROOMBOX = { W: 3.64, D: 3.2, H: 2.4 };
const room = new THREE.Group();
{
  const { W, D, H } = ROOMBOX;
  const basic = (c) => new THREE.MeshBasicMaterial({ color: c, depthWrite: false, side: THREE.DoubleSide });
  const add = (geo, m, x, y, z, rx = 0, ry = 0, order = -1000) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, 0);
    o.renderOrder = order;
    room.add(o);
    return o;
  };
  add(new THREE.PlaneGeometry(W, D), basic(0xb08d68), 0, 0, 0, -Math.PI / 2);
  add(new THREE.PlaneGeometry(W, D), basic(0xeeece6), 0, H, 0, Math.PI / 2);
  add(new THREE.PlaneGeometry(W, H), basic(0xe4e0d6), 0, H / 2, -D / 2);
  add(new THREE.PlaneGeometry(W, H), basic(0xdcd7cc), 0, H / 2, D / 2, 0, Math.PI);
  add(new THREE.PlaneGeometry(D, H), basic(0xd6d1c5), -W / 2, H / 2, 0, 0, Math.PI / 2);
  add(new THREE.PlaneGeometry(D, H), basic(0xdfdacf), W / 2, H / 2, 0, 0, -Math.PI / 2);
  add(new THREE.PlaneGeometry(0.8, 2.0), basic(0x9a7652), 0.95, 1.0, -D / 2 + 0.005, 0, 0, -999);
  add(new THREE.PlaneGeometry(1.5, 1.1), basic(0xbcd8ea), -0.4, 1.45, D / 2 - 0.005, 0, Math.PI, -999);
  add(new THREE.PlaneGeometry(0.35, 1.3), basic(0xd9c9a8), 0.5, 1.4, D / 2 - 0.01, 0, Math.PI, -998);
  add(new THREE.PlaneGeometry(0.35, 1.3), basic(0xd9c9a8), -1.3, 1.4, D / 2 - 0.01, 0, Math.PI, -998);
  add(new THREE.CircleGeometry(0.25, 24), basic(0xfaf8f2), 0.3, H - 0.005, 0.2, Math.PI / 2, 0, -999);
  add(new THREE.PlaneGeometry(1.6, 1.1), basic(0x8f9aa3), 0, 0.003, 0.15, -Math.PI / 2, 0, -999);
  const box = (w, h, d, color, x, z, y = h / 2) => {
    const m = new THREE.MeshLambertMaterial({ color, depthWrite: false });
    return add(new THREE.BoxGeometry(w, h, d), m, x, y, z, 0, 0, -990);
  };
  box(0.98, 0.42, 1.98, 0x7d8a96, -W / 2 + 0.52, D / 2 - 1.03);
  box(0.98, 0.12, 1.9, 0xf0ece4, -W / 2 + 0.52, D / 2 - 1.03, 0.47);
  box(1.1, 0.04, 0.6, 0xc49a6c, W / 2 - 0.32, 0.2, 0.72);
  box(0.45, 0.45, 0.45, 0x3f4a55, W / 2 - 0.85, 0.3, 0.23);
  box(0.8, 1.8, 0.3, 0xe6dfd0, W / 2 - 0.5, D / 2 - 0.16);
  box(1.2, 0.45, 0.4, 0x6b5a4a, -0.6, -D / 2 + 0.22);  // テレビ台
  box(0.9, 0.52, 0.05, 0x111214, -0.6, -D / 2 + 0.25, 0.72); // テレビ
}
room.visible = false;
scene.add(room);

// ---------- PCプレビュー ----------
const look = { yaw: 0, pitch: -0.05, down: false, x: 0, y: 0, moved: 0, id: null };
const walker = { x: 0, z: 0.3, keys: new Set() };
let eye = 1.6;
let hintTimer = 0;

function applyLook() {
  camera.position.set(walker.x, eye, walker.z);
  camera.rotation.set(look.pitch, look.yaw, 0, 'YXZ');
  camera.updateMatrixWorld();
}

function startPreview() {
  settings = readForm();
  saveSettings(settings);
  audio.init();
  audio.setVolume(settings.volume);
  state.xr = false;
  state.floorKnown = true;
  state.floorY = 0;
  titleEl.hidden = true;
  backBtn.hidden = false;
  hintEl.hidden = false;
  hintEl.classList.remove('fade');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(() => hintEl.classList.add('fade'), 6000);
  document.body.classList.add('preview');
  scene.background = new THREE.Color(0x202020);
  renderer.setClearColor(0x202020, 1);
  room.visible = true;
  look.yaw = 0;
  look.pitch = -0.05;
  walker.x = 0;
  walker.z = 0.3;
  eye = params.get('sit') === '1' ? 1.15 : 1.6;
  applyLook();
  beginRide();
}

function backToTitle() {
  state.mode = 'title';
  director.end();
  audio.stop();
  voice.cancel();
  endButton.hide();
  room.visible = false;
  document.body.classList.remove('preview');
  backBtn.hidden = true;
  hintEl.hidden = true;
  titleEl.hidden = false;
  writeForm(settings);
  startBtn.disabled = true;
  checkXR();
}

const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  if (state.xr || state.mode === 'title' || e.button !== 0) return;
  look.down = true;
  look.x = e.clientX;
  look.y = e.clientY;
  look.moved = 0;
  look.id = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', (e) => {
  if (!look.down || e.pointerId !== look.id) return;
  const dx = e.clientX - look.x, dy = e.clientY - look.y;
  look.x = e.clientX;
  look.y = e.clientY;
  look.moved += Math.abs(dx) + Math.abs(dy);
  const k = 0.0042;
  look.yaw += dx * k;
  look.pitch = THREE.MathUtils.clamp(look.pitch + dy * k, -1.45, 1.45);
  applyLook();
});
const endDrag = () => { look.down = false; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', (e) => {
  if (state.xr || state.mode === 'title') return;
  walker.keys.add(e.key.toLowerCase());
});
window.addEventListener('keyup', (e) => walker.keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => walker.keys.clear());

function updateWalker(dt) {
  const k = walker.keys;
  const fwd = (k.has('w') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0);
  const side = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
  if (!fwd && !side) return;
  const v = 1.1 * dt;
  walker.x += (-Math.sin(look.yaw) * fwd + Math.cos(look.yaw) * side) * v;
  walker.z += (-Math.cos(look.yaw) * fwd - Math.sin(look.yaw) * side) * v;
  walker.x = THREE.MathUtils.clamp(walker.x, -ROOMBOX.W / 2 + 0.2, ROOMBOX.W / 2 - 0.2);
  walker.z = THREE.MathUtils.clamp(walker.z, -ROOMBOX.D / 2 + 0.2, ROOMBOX.D / 2 - 0.2);
  applyLook();
}

window.addEventListener('resize', () => {
  if (renderer.xr.isPresenting) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

startBtn.addEventListener('click', startXR);
previewBtn.addEventListener('click', startPreview);
backBtn.addEventListener('click', quit);

// ---------- メインループ ----------
const clock = new THREE.Clock();

function frameStep(dt, frame) {
  if (state.mode === 'title') return;
  if (state.xr) {
    if (!state.ready) {
      state.ready = initXRFrame(frame);
      if (!state.ready) return;
    }
    updatePointers();
  } else {
    updateWalker(dt);
  }
  updateHead();
  director.update(dt);
  audio.setListener(camera.matrixWorld.elements);
  endButton.update(dt);
}

renderer.setAnimationLoop((t, frame) => {
  const dt = Math.min(clock.getDelta(), 0.05);
  frameStep(dt, frame);
  if (state.mode !== 'title') renderer.render(scene, camera);
});

// デバッグ・自動確認用
function lookAtPoint(x, y, z) {
  const d = new THREE.Vector3(x, y, z).sub(camera.position).normalize();
  look.yaw = Math.atan2(-d.x, -d.z);
  look.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
  applyLook();
}
window.__densha = {
  renderer, scene, camera, car, director, audio, voice, board, state, look, walker,
  get settings() { return settings; },
  applyLook, lookAtPoint, startPreview, backToTitle,
  frame: (dt = 1 / 60) => { frameStep(dt, null); renderer.render(scene, camera); },
};
