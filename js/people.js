// 乗客。三角形の少ないローポリ人形を、服・髪型・背丈・鞄・持ち物の組み合わせで毎回作る。
//  - ふつうの乗客は「体」と「頭」の2メッシュだけ（ポーズは作るときに焼き込む）。何十人いても重くならない。
//  - 席を譲る人・スマホを近づけてくる人だけは関節ごとにメッシュを分けて、動かせるようにする（rigged）。
// 乗客の正面は局所 +Z。足元が原点。
import * as THREE from '../vendor/three.module.min.js';
import { Parts, mat } from './geo.js';

const SKIN = [0xd6bea8, 0xcdb39c, 0xdcc6b2, 0xc6a991, 0xd2b9a5];
const HAIR = [0x161514, 0x1d1a18, 0x2b2420, 0x3e342c, 0x5d5751, 0x8a8680];
const SUIT = [0x1f2433, 0x2a2d33, 0x19191c, 0x45484e, 0x37332f, 0x26303f];
const CASUAL = [0xb3a283, 0x7b858d, 0x535e68, 0x6a4f4a, 0x3e4a41, 0xa29d92, 0xcfcac0, 0x857b94];
const PANTS = [0x2b3341, 0x383838, 0x6c614f, 0x232529, 0x8a8476];
const SHIRT = [0xe4e4e0, 0xc8d4e0, 0xe6e1d4];
const TIE = [0x58303a, 0x2e3c5a, 0x3d4930, 0x6a5a30, 0x454545, 0x5b5266];
const SHOES = [0x1a1817, 0x372a20, 0x252525];
const BAG = [0x1b1b1d, 0x3a2a1f, 0x2d3340, 0x57504a, 0x5c6450];

const darken = (hex, k) => new THREE.Color(hex).multiplyScalar(k).getHex();

// ---------- 見た目の組み合わせ ----------
// role：'any' のほか、決まった役（'phone' 'paper' 'back' 'bag' 'sit' など）を渡すとポーズや鞄を固定する
export function makeSpec(r, opts = {}) {
  const female = opts.female ?? r.chance(0.42);
  const type = female ? r.pick(['ol', 'ol', 'casual', 'student']) : r.pick(['salary', 'salary', 'salary', 'casual', 'student']);
  const suit = type === 'salary' || type === 'ol';
  const top = type === 'student' ? r.pick([0x1d2130, 0x222222, 0x2b2f3a]) : suit ? r.pick(SUIT) : r.pick(CASUAL);
  const spec = {
    female,
    type,
    height: female ? r.range(1.52, 1.69) : r.range(1.62, 1.84),
    girth: r.range(0.92, 1.12),
    skin: r.pick(SKIN),
    hairColor: r.chance(type === 'salary' ? 0.25 : 0.06) ? r.pick([0x5d5751, 0x8a8680]) : r.pick(HAIR.slice(0, 4)),
    hair: female ? r.pick(['long', 'bob', 'bun', 'long']) : r.pick(['short', 'side', 'side', 'short', type === 'salary' ? 'thin' : 'short']),
    top,
    shirt: r.pick(SHIRT),
    tie: type === 'salary' && r.chance(0.8) ? r.pick(TIE) : null,
    skirt: female && type !== 'casual' && r.chance(0.6),
    bottom: suit ? top : r.pick(PANTS),
    legs: r.chance(0.5) ? 0x2c2826 : null, // タイツ（スカートのとき）
    shoes: r.pick(SHOES),
    glasses: r.chance(0.3),
    mask: r.chance(0.28),
    earphones: r.chance(0.3),
    bag: r.pick(['brief', 'shoulder', 'backpack', 'backpackFront', null, type === 'student' ? 'backpack' : 'brief']),
    bagColor: r.pick(BAG),
    pose: r.pick(['phone', 'phone', 'phone', 'phone', 'idle', 'idle', 'paper', 'sleep', 'strap', 'strap']),
  };
  if (spec.hair === 'thin') spec.hairColor = r.pick([0x5d5751, 0x8a8680, 0x2b2420]);
  if (spec.pose === 'paper' || spec.pose === 'phone') {
    // 両手がふさがっている人は鞄を手に提げない
    if (spec.bag === 'brief') spec.bag = r.chance(0.5) ? 'shoulder' : 'backpack';
  }
  if (spec.pose === 'strap' && spec.bag === 'brief') spec.bag = 'shoulder';
  Object.assign(spec, opts);
  return spec;
}

// ---------- 骨組み ----------
// 背の高さ 1.70m のときの寸法で作り、rig 全体を拡大縮小する
const L_UPPER = 0.29;
const L_FORE = 0.3; // ひじ〜手のひらの中心

function bone(name, parent, x, y, z) {
  const b = new THREE.Object3D();
  b.name = name;
  b.position.set(x, y, z);
  b.userData.parts = new Parts();
  if (parent) parent.add(b);
  return b;
}

function buildRig(spec) {
  const rig = new THREE.Object3D();
  const B = {};
  B.hips = bone('hips', rig, 0, 0.86, 0);
  B.torso = bone('torso', B.hips, 0, 0, 0);
  B.neck = bone('neck', B.torso, 0, 0.58, 0);
  B.head = bone('head', B.neck, 0, 0.06, 0);
  const sw = spec.female ? 0.175 : 0.195;
  B.shoulderL = bone('shoulderL', B.torso, sw, 0.52, 0);
  B.elbowL = bone('elbowL', B.shoulderL, 0, -L_UPPER, 0);
  B.shoulderR = bone('shoulderR', B.torso, -sw, 0.52, 0);
  B.elbowR = bone('elbowR', B.shoulderR, 0, -L_UPPER, 0);
  B.thighL = bone('thighL', B.hips, 0.09, 0, 0);
  B.kneeL = bone('kneeL', B.thighL, 0, -0.39, 0);
  B.thighR = bone('thighR', B.hips, -0.09, 0, 0);
  B.kneeR = bone('kneeR', B.thighR, 0, -0.39, 0);
  const s = spec.height / 1.7;
  rig.scale.set(s * spec.girth, s, s * (0.5 + spec.girth * 0.5));
  // 太めの人も頭と手足の長さは同じに見えるよう、胴だけ横に広げた分を頭で戻す
  B.head.scale.set(1 / spec.girth, 1, 1 / (0.5 + spec.girth * 0.5));
  return { rig, B };
}

function addBody(spec, B) {
  const { top, bottom, skin } = spec;
  const P = (b) => b.userData.parts;
  const tw = spec.female ? 0.18 : 0.2;
  // 腰と胴（六角柱をつぶした形。正面が平ら）
  if (spec.skirt) {
    P(B.hips).prism(bottom, 0.165, 0.235, 0.5, 8, 0, -0.18, 0, { sz: 0.72 });
  } else {
    P(B.hips).box(bottom, 0.31, 0.16, 0.2, 0, 0.0, 0);
  }
  P(B.torso).prism(top, tw, 0.165, 0.56, 6, 0, 0.28, 0, { sz: 0.56, start: Math.PI / 6 });
  // シャツの襟元とネクタイ
  const isShirt = spec.type === 'salary' || spec.type === 'ol';
  if (isShirt) {
    P(B.torso).box(spec.shirt, 0.075, 0.17, 0.012, 0, 0.47, tw * 0.866 * 0.56 + 0.002);
    if (spec.tie) P(B.torso).box(spec.tie, 0.032, 0.3, 0.012, 0, 0.36, 0.0965);
  } else if (spec.type === 'student') {
    P(B.torso).box(0xd8d4c6, 0.06, 0.05, 0.012, 0, 0.535, 0.098);
    for (let i = 0; i < 4; i++) P(B.torso).box(0xb89a50, 0.014, 0.014, 0.01, 0, 0.45 - i * 0.1, 0.095);
  }
  P(B.neck).prism(skin, 0.045, 0.048, 0.1, 6, 0, 0.0, 0);
  // 腕
  for (const side of ['L', 'R']) {
    P(B['shoulder' + side]).prism(top, 0.05, 0.043, 0.3, 6, 0, -0.14, 0);
    const e = P(B['elbow' + side]);
    e.prism(top, 0.043, 0.037, 0.25, 6, 0, -0.12, 0);
    e.prism(isShirt ? spec.shirt : top, 0.037, 0.037, 0.02, 6, 0, -0.25, 0);
    e.box(skin, 0.035, 0.09, 0.07, 0, -0.3, 0);
  }
  // 脚
  const thighC = spec.skirt ? (spec.legs ?? skin) : bottom;
  const shinC = spec.skirt ? (spec.legs ?? skin) : bottom;
  for (const side of ['L', 'R']) {
    P(B['thigh' + side]).prism(thighC, 0.068, 0.055, 0.4, 6, 0, -0.2, 0);
    const k = P(B['knee' + side]);
    k.prism(shinC, spec.skirt ? 0.045 : 0.056, spec.skirt ? 0.036 : 0.047, 0.38, 6, 0, -0.19, 0);
    k.box(spec.shoes, 0.095, 0.07, 0.25, 0, -0.435, 0.045);
  }
}

function addHead(spec, parts) {
  const { skin, hairColor: hc } = spec;
  const p = parts;
  p.ball(skin, 0.1, 0, 0.1, 0, { sx: 0.92, sy: 1.1, sz: 0.98 });
  p.box(skin, 0.022, 0.04, 0.03, 0, 0.09, 0.096);
  p.box(skin, 0.02, 0.045, 0.03, 0.093, 0.1, 0);
  p.box(skin, 0.02, 0.045, 0.03, -0.093, 0.1, 0);
  // 目は細く、眉はまっすぐ、口は一文字。くまが少し
  for (const sx of [1, -1]) {
    p.box(0x2a2421, 0.024, 0.008, 0.01, sx * 0.036, 0.116, 0.089);
    p.box(darken(skin, 0.8), 0.026, 0.006, 0.006, sx * 0.036, 0.104, 0.091);
    p.box(darken(hc, 1.0), 0.032, 0.007, 0.008, sx * 0.036, 0.142, 0.09);
  }
  if (spec.mask) {
    p.box(0xeeeeea, 0.13, 0.08, 0.035, 0, 0.058, 0.082);
  } else {
    p.box(0x8f7062, 0.038, 0.006, 0.008, 0, 0.047, 0.088);
  }
  if (spec.glasses) {
    const fc = 0x2b2b2b;
    for (const sx of [1, -1]) {
      p.box(fc, 0.046, 0.005, 0.005, sx * 0.036, 0.13, 0.101);
      p.box(fc, 0.046, 0.005, 0.005, sx * 0.036, 0.102, 0.101);
      p.box(fc, 0.005, 0.03, 0.005, sx * 0.059, 0.116, 0.1);
      p.box(fc, 0.005, 0.03, 0.005, sx * 0.013, 0.116, 0.101);
      p.box(fc, 0.004, 0.004, 0.1, sx * 0.062, 0.122, 0.05);
    }
  }
  if (spec.earphones) {
    p.ball(0xf2f2f0, 0.013, 0.1, 0.098, 0.012, { detail: 0 });
    p.ball(0xf2f2f0, 0.013, -0.1, 0.098, 0.012, { detail: 0 });
  }
  // 髪
  const cap = (rx = -0.35) => p.cap(hc, 0.106, 0, 0.115, -0.006, { sx: 0.98, sy: 0.92, sz: 1.04, rx });
  switch (spec.hair) {
    case 'thin':
      p.box(hc, 0.19, 0.08, 0.05, 0, 0.09, -0.078);
      p.box(hc, 0.025, 0.06, 0.08, 0.092, 0.115, -0.02);
      p.box(hc, 0.025, 0.06, 0.08, -0.092, 0.115, -0.02);
      break;
    case 'side':
      cap();
      p.box(hc, 0.18, 0.1, 0.05, 0, 0.085, -0.075);
      p.box(hc, 0.09, 0.025, 0.035, 0.03, 0.188, 0.07, 0, 0, 0.2);
      break;
    case 'long':
      cap(-0.25);
      p.box(hc, 0.2, 0.32, 0.05, 0, -0.0, -0.08);
      p.box(hc, 0.03, 0.24, 0.09, 0.096, 0.02, -0.02);
      p.box(hc, 0.03, 0.24, 0.09, -0.096, 0.02, -0.02);
      break;
    case 'bob':
      cap(-0.25);
      p.box(hc, 0.21, 0.16, 0.05, 0, 0.05, -0.075);
      p.box(hc, 0.035, 0.15, 0.1, 0.095, 0.06, -0.005);
      p.box(hc, 0.035, 0.15, 0.1, -0.095, 0.06, -0.005);
      break;
    case 'bun':
      cap(-0.3);
      p.box(hc, 0.18, 0.1, 0.05, 0, 0.09, -0.075);
      p.ball(hc, 0.045, 0, 0.19, -0.09, { detail: 0 });
      break;
    default:
      cap();
      p.box(hc, 0.18, 0.1, 0.05, 0, 0.085, -0.075);
  }
}

// 手に持つ物・身につける鞄
function addBag(spec, B) {
  const c = spec.bagColor;
  const t = B.torso.userData.parts;
  switch (spec.bag) {
    case 'brief': {
      const e = B.elbowL.userData.parts;
      e.box(c, 0.08, 0.28, 0.4, 0, -0.5, 0.0);
      e.box(c, 0.02, 0.05, 0.1, 0, -0.35, 0);
      break;
    }
    case 'shoulder':
      t.box(c, 0.08, 0.24, 0.32, 0.235, -0.02, 0.0);
      t.box(darken(c, 0.8), 0.03, 0.66, 0.012, 0.02, 0.3, 0.104, 0, 0, 0.62);
      t.box(darken(c, 0.8), 0.03, 0.66, 0.012, 0.02, 0.3, -0.104, 0, 0, 0.62);
      break;
    case 'backpack':
      t.box(c, 0.3, 0.4, 0.15, 0, 0.3, -0.17);
      t.box(darken(c, 1.2), 0.24, 0.12, 0.04, 0, 0.18, -0.255);
      t.box(darken(c, 0.7), 0.04, 0.34, 0.012, 0.1, 0.36, 0.1);
      t.box(darken(c, 0.7), 0.04, 0.34, 0.012, -0.1, 0.36, 0.1);
      break;
    case 'backpackFront':
      t.box(c, 0.3, 0.4, 0.15, 0, 0.26, 0.18);
      t.box(darken(c, 1.2), 0.24, 0.12, 0.04, 0, 0.14, 0.265);
      break;
    default:
      break;
  }
}

function addPhone(parts) {
  parts.box(0x1c1c1e, 0.072, 0.148, 0.01, 0, -0.33, 0.03, -0.5);
  parts.box(0xbcd3ea, 0.064, 0.13, 0.003, 0, -0.33 + 0.0, 0.0365, -0.5);
}

// ---------- ポーズ ----------
// 骨ごとの回転 [x, y, z] と腰の高さ。
const POSES = {
  idle: { hipsY: 0.86, b: { shoulderL: [-0.04, 0, 0.07], shoulderR: [-0.04, 0, -0.07], elbowL: [-0.12, 0, 0], elbowR: [-0.12, 0, 0] } },
  phone: { hipsY: 0.86, b: { shoulderL: [-0.25, 0, -0.22], elbowL: [-1.35, 0, 0], shoulderR: [-0.3, 0, 0.28], elbowR: [-1.5, 0, 0], head: [0.5, 0, 0] } },
  paper: { hipsY: 0.86, b: { shoulderL: [-0.7, 0, -0.12], elbowL: [-1.05, 0, 0], shoulderR: [-0.7, 0, 0.12], elbowR: [-1.05, 0, 0], head: [0.3, 0, 0] } },
  sleep: { hipsY: 0.86, b: { shoulderL: [0, 0, 0.05], shoulderR: [0, 0, -0.05], elbowL: [-0.1, 0, 0], elbowR: [-0.1, 0, 0], head: [0.55, 0, 0.18] } },
  strap: { hipsY: 0.86, b: { shoulderL: [-0.04, 0, 0.07], elbowL: [-0.15, 0, 0], head: [0.15, 0, 0] } },
  sit: {
    hipsY: 0.47,
    b: {
      thighL: [-1.5, 0, 0.04], kneeL: [1.45, 0, 0], thighR: [-1.5, 0, -0.04], kneeR: [1.45, 0, 0], torso: [-0.06, 0, 0],
      shoulderL: [-0.35, 0, -0.15], elbowL: [-1.0, 0, 0], shoulderR: [-0.35, 0, 0.15], elbowR: [-1.0, 0, 0], head: [0.42, 0, 0],
    },
  },
};
const BONES = ['hips', 'torso', 'neck', 'head', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'thighL', 'kneeL', 'thighR', 'kneeR'];

function applyPose(B, pose, k = 1, from = null) {
  const P = POSES[pose] || POSES.idle;
  const F = from ? POSES[from] || POSES.idle : null;
  const get = (Q, n) => (Q && Q.b[n]) || [0, 0, 0];
  for (const n of BONES) {
    const a = get(P, n);
    const f = F ? get(F, n) : a;
    B[n].rotation.set(f[0] + (a[0] - f[0]) * k, f[1] + (a[1] - f[1]) * k, f[2] + (a[2] - f[2]) * k);
  }
  const hy = F ? F.hipsY + (P.hipsY - F.hipsY) * k : P.hipsY;
  B.hips.position.y = hy;
}

// 2関節の腕を target（ワールド座標）へ伸ばす。pole：ひじを向けたい方向（胴の局所）
const _t = new THREE.Vector3();
const _d = new THREE.Vector3();
const _u = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _qi = new THREE.Quaternion();
export function reachArm(shoulder, elbow, targetWorld, pole) {
  const parent = shoulder.parent;
  parent.updateMatrixWorld(true);
  _t.copy(targetWorld);
  parent.worldToLocal(_t);
  _d.copy(_t).sub(shoulder.position);
  const D = THREE.MathUtils.clamp(_d.length(), 0.08, (L_UPPER + L_FORE) * 0.995);
  _d.normalize();
  const cosA = THREE.MathUtils.clamp((L_UPPER * L_UPPER + D * D - L_FORE * L_FORE) / (2 * L_UPPER * D), -1, 1);
  const a = Math.acos(cosA);
  _ax.crossVectors(_d, pole);
  if (_ax.lengthSq() < 1e-6) _ax.set(1, 0, 0);
  _ax.normalize();
  // ひじが pole の側に出るほうを選ぶ
  _u.copy(_d).applyAxisAngle(_ax, a);
  const u2 = _d.clone().applyAxisAngle(_ax, -a);
  if (u2.dot(pole) > _u.dot(pole)) _u.copy(u2);
  shoulder.quaternion.setFromUnitVectors(_down, _u);
  // ひじ → 手
  const E = shoulder.position.clone().addScaledVector(_u, L_UPPER);
  const f = _t.clone().sub(E).normalize();
  _qi.copy(shoulder.quaternion).invert();
  f.applyQuaternion(_qi);
  elbow.quaternion.setFromUnitVectors(_down, f);
}

// ---------- 乗客 ----------
// root（車内座標の位置）→ lean（ブレーキで傾く。足元が支点）→ yawObj（向き）→ 体
export class Passenger {
  // env: { ringY, barY } 吊り革の高さ（つかまるポーズ用）
  constructor(spec, { rigged = false, env } = {}) {
    this.spec = spec;
    this.rigged = rigged;
    this.root = new THREE.Object3D();
    this.lean = new THREE.Object3D();
    this.yawObj = new THREE.Object3D();
    this.root.add(this.lean);
    this.lean.add(this.yawObj);
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, alphaHash: true, opacity: 0 });
    this.meshes = [];

    const { rig, B } = buildRig(spec);
    this.rig = rig;
    this.B = B;
    addBody(spec, B);
    addHead(spec, B.head.userData.parts);
    addBag(spec, B);
    const pose = spec.pose === 'strap' ? 'strap' : spec.pose;
    if (pose === 'phone') addPhone(B.elbowR.userData.parts);
    applyPose(B, pose);
    this.yawObj.add(rig);
    rig.updateMatrixWorld(true);

    // つり革につかまる人：右手を吊り革の高さへ。吊り革そのものも体と一緒に作る
    this.extra = new Parts(); // yawObj 基準の部品
    if (spec.pose === 'strap' && env) {
      const hand = new THREE.Vector3(-0.12, env.ringY + 0.03, 0.14);
      reachArm(B.shoulderR, B.elbowR, hand, new THREE.Vector3(-0.6, -0.2, -0.6));
      rig.updateMatrixWorld(true);
      const top = Math.max(env.barY, hand.y + 0.12);
      this.extra.add(new THREE.TorusGeometry(0.06, 0.011, 4, 10), 0xf1f0ea, mat(hand.x, hand.y - 0.01, hand.z, 0, Math.PI / 2));
      this.extra.box(0x7f8a95, 0.028, top - hand.y - 0.06, 0.006, hand.x, (top + hand.y + 0.06) / 2, hand.z, 0, Math.PI / 2);
    }
    // 新聞：両手の間に、縦に二つ折り
    if (spec.pose === 'paper') {
      const hl = new THREE.Vector3(0, -0.3, 0).applyMatrix4(B.elbowL.matrixWorld);
      const hr = new THREE.Vector3(0, -0.3, 0).applyMatrix4(B.elbowR.matrixWorld);
      const c = hl.clone().add(hr).multiplyScalar(0.5);
      const inv = new THREE.Matrix4().copy(rig.matrixWorld).invert();
      c.applyMatrix4(inv);
      const p = B.hips.userData.parts; // hips は回転なし・高さだけ。rig 局所からの差を引いて置く
      const y = c.y - B.hips.position.y + 0.17;
      const z = c.z + 0.03;
      p.box(0xdcd8cc, 0.2, 0.4, 0.004, 0.095, y, z, 0, -0.32);
      p.box(0xdcd8cc, 0.2, 0.4, 0.004, -0.095, y, z, 0, 0.32);
      for (let i = 0; i < 4; i++) {
        p.box(0x55524c, 0.15, i === 0 ? 0.03 : 0.012, 0.006, 0.095, y + 0.15 - i * 0.05, z, 0, -0.32);
        p.box(0x55524c, 0.15, 0.012, 0.006, -0.095, y + 0.14 - i * 0.06, z, 0, 0.32);
      }
    }

    if (rigged) this._buildRigged();
    else this._buildBaked();

    // 状態
    this.x = 0;
    this.z = 0;
    this.yaw = 0;
    this.path = null;     // { x0, z0, x1, z1, t, dur }
    this.appear = 0;      // 0→1 で現れる
    this.appearRate = 0.8;
    this.leaving = false;
    this.gone = false;
    this.near = 1;        // 頭が近づいたときに透かす
    this.gaze = 0;        // 0〜1：プレイヤーの方を向く度合い
    this.gazeTarget = 0;
    this.gazeSpeed = 0.5;
    this.leanFactor = 0.7 + Math.random() * 0.6;
    this.phase = Math.random() * 100;
    this.walking = 0;
    this.headBase = (this.headObj || B.head).quaternion.clone();
    this.bodyTurn = 0;
  }

  _buildBaked() {
    const rig = this.rig;
    const inv = new THREE.Matrix4().copy(this.yawObj.matrixWorld).invert();
    const body = new Parts();
    for (const p of this.extra.list) body.add(p.geo, p.color, null);
    rig.traverse((o) => {
      if (!o.userData.parts || o === this.B.head) return;
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
      for (const p of o.userData.parts.list) body.add(p.geo, p.color, m);
    });
    const bodyMesh = new THREE.Mesh(body.bake(), this.material);
    body.dispose();
    // 頭は別メッシュ（こちらを向くため）
    const head = this.B.head;
    const headObj = new THREE.Object3D();
    const m = new THREE.Matrix4().multiplyMatrices(inv, head.matrixWorld);
    m.decompose(headObj.position, headObj.quaternion, headObj.scale);
    const headMesh = new THREE.Mesh(head.userData.parts.bake(), this.material);
    head.userData.parts.dispose();
    headObj.add(headMesh);
    this.yawObj.remove(rig);
    this.yawObj.add(bodyMesh, headObj);
    this.headObj = headObj;
    this.meshes.push(bodyMesh, headMesh);
    rig.traverse((o) => o.userData.parts && o.userData.parts.dispose());
  }

  _buildRigged() {
    this.rig.traverse((o) => {
      const p = o.userData.parts;
      if (!p || p.empty) return;
      const mesh = new THREE.Mesh(p.bake(), this.material);
      p.dispose();
      o.add(mesh);
      this.meshes.push(mesh);
    });
    this.headObj = this.B.head;
  }

  setPose(name, k = 1, from = null) {
    if (!this.rigged) return;
    applyPose(this.B, name, k, from);
  }

  place(x, z, yaw) {
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.root.position.set(x, 0, z);
    this.yawObj.rotation.y = yaw;
  }

  // 外側から歩いて位置につく
  walkFrom(x0, z0, speed = 0.3) {
    const d = Math.hypot(this.x - x0, this.z - z0);
    this.path = { x0, z0, x1: this.x, z1: this.z, t: 0, dur: Math.max(0.5, d / speed) };
    this.root.position.set(x0, 0, z0);
  }

  moveTo(x1, z1, speed = 0.15) {
    const d = Math.hypot(x1 - this.root.position.x, z1 - this.root.position.z);
    this.path = { x0: this.root.position.x, z0: this.root.position.z, x1, z1, t: 0, dur: Math.max(0.5, d / speed) };
    this.x = x1;
    this.z = z1;
  }

  leave(rate = 1.2) {
    this.leaving = true;
    this.appearRate = rate;
  }

  get position() {
    return this.root.position;
  }

  // 頭の中心（車内座標）
  headPoint(out) {
    return out.set(0, 0.1, 0).applyMatrix4(this.headObj.matrixWorld);
  }

  // ctx: { lean（ブレーキの傾き）, sway（走行の揺れ）, head（プレイヤーの頭・ワールド）, dt, t }
  update(ctx) {
    const { dt } = ctx;
    if (this.leaving) {
      this.appear = Math.max(0, this.appear - dt * this.appearRate);
      if (this.appear <= 0) this.gone = true;
    } else {
      this.appear = Math.min(1, this.appear + dt * this.appearRate);
    }
    // 歩く（足は動かさず、少し上下に揺れながらすべるように）
    this.walking = 0;
    if (this.path) {
      const p = this.path;
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      const e = k * k * (3 - 2 * k);
      this.root.position.set(p.x0 + (p.x1 - p.x0) * e, 0, p.z0 + (p.z1 - p.z0) * e);
      this.walking = Math.sin(k * Math.PI);
      if (k >= 1) this.path = null;
    }
    const bob = this.walking ? Math.abs(Math.sin(ctx.t * 7 + this.phase)) * 0.012 * this.walking : 0;
    this.lean.position.y = bob;
    // ブレーキで傾く（車内の X 方向）と、走行中の小さな揺れ
    const sway = ctx.sway * (0.6 + 0.4 * Math.sin(ctx.t * 0.7 + this.phase));
    this.lean.rotation.z = -(ctx.lean * this.leanFactor + sway * 0.02);
    this.lean.rotation.x = Math.sin(ctx.t * 0.31 + this.phase) * 0.006;

    // こちらを向く
    this.gaze += THREE.MathUtils.clamp(this.gazeTarget - this.gaze, -dt * this.gazeSpeed, dt * this.gazeSpeed);
    this._updateHead(ctx);

    // プレイヤーの頭が近いときは透かす（ぶつかったように見せない）
    this.root.updateMatrixWorld(true);
    const hp = this.headPoint(_hp);
    const H = ctx.headWorld;
    const dh = hp.distanceTo(H);
    const me = this.root.matrixWorld.elements;
    const dBody = Math.hypot(me[12] - H.x, me[14] - H.z);
    const near = Math.min(dh / 0.32, ctx.headHeight < this.spec.height + 0.1 ? dBody / 0.3 : 9);
    const target = THREE.MathUtils.clamp((near - 0.6) / 0.6, 0.18, 1);
    this.near += (target - this.near) * Math.min(1, dt * 6);
    const o = this.appear * this.near;
    this.material.opacity = o;
    this.root.visible = o > 0.01;
  }

  _updateHead(ctx) {
    const h = this.headObj;
    if (this.gaze <= 0.001) {
      h.quaternion.copy(this.headBase);
      this._idleHead(ctx);
      this.yawObj.rotation.y = this.yaw;
      return;
    }
    // 頭の親の座標で、プレイヤーの頭への方向
    const parent = h.parent;
    parent.updateMatrixWorld(true);
    _hp.copy(ctx.headWorld);
    parent.worldToLocal(_hp);
    _hp.sub(h.position);
    _hp.y -= 0.1;
    let yaw = Math.atan2(_hp.x, _hp.z);
    const pitch = -Math.atan2(_hp.y, Math.hypot(_hp.x, _hp.z));
    // 首が回りきらない分は体ごと回る
    const lim = 1.05;
    const extra = Math.abs(yaw) > lim ? (Math.abs(yaw) - lim) * Math.sign(yaw) : 0;
    this.bodyTurn += (extra * this.gaze - this.bodyTurn) * Math.min(1, ctx.dt * 1.5);
    this.yawObj.rotation.y = this.yaw + this.bodyTurn;
    yaw = THREE.MathUtils.clamp(yaw, -lim, lim);
    _e.set(THREE.MathUtils.clamp(pitch, -0.5, 0.6), yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    h.quaternion.copy(this.headBase).slerp(_q, this.gaze);
  }

  _idleHead(ctx) {
    // ほとんど動かない。ときどき、ほんの少しだけ首が傾く
    const t = ctx.t + this.phase;
    _e.set(Math.sin(t * 0.23) * 0.02 + (this.spec.pose === 'sleep' ? Math.max(0, Math.sin(t * 0.4)) * 0.18 : 0), Math.sin(t * 0.17) * 0.03, 0);
    _q.setFromEuler(_e);
    this.headObj.quaternion.multiply(_q);
    if (this.bodyTurn) {
      this.bodyTurn *= Math.max(0, 1 - ctx.dt * 1.5);
      if (Math.abs(this.bodyTurn) < 1e-3) this.bodyTurn = 0;
      this.yawObj.rotation.y = this.yaw + this.bodyTurn;
    }
  }

  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    this.material.dispose();
    this.root.removeFromParent();
  }
}
const _hp = new THREE.Vector3();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
