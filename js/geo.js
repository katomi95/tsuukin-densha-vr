// 色つきの部品（箱・円柱・球…）をまとめて1つのジオメトリにする道具。
// 乗客や吊り革は「頂点色＋フラットシェーディング」のローポリで描くので、テクスチャは使わない。
import * as THREE from '../vendor/three.module.min.js';

const _c = new THREE.Color();
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// 部品のリスト。add() した順に積んでおき、bake(行列) で1つにする
export class Parts {
  constructor() {
    this.list = []; // { geo（インデックスなし・位置/法線のみ）, color }
  }

  add(geo, color, m) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (m) g.applyMatrix4(m);
    this.list.push({ geo: g, color: typeof color === 'number' ? color : color.getHex() });
    geo.dispose();
    return this;
  }

  box(color, w, h, d, x, y, z, rx, ry, rz) {
    return this.add(new THREE.BoxGeometry(w, h, d), color, mat(x, y, z, rx, ry, rz));
  }

  // 局所 y に伸びる角柱（seg 角形）。rt：上の半径、rb：下の半径、sz：奥行きのつぶし
  prism(color, rt, rb, h, seg, x, y, z, { sz = 1, rx = 0, ry = 0, rz = 0, start = 0 } = {}) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, false, start), color, mat(x, y, z, rx, ry, rz, 1, 1, sz));
  }

  ball(color, r, x, y, z, { sx = 1, sy = 1, sz = 1, detail = 1, rx = 0, ry = 0, rz = 0 } = {}) {
    return this.add(new THREE.IcosahedronGeometry(r, detail), color, mat(x, y, z, rx, ry, rz, sx, sy, sz));
  }

  // 上半分だけの球（髪の毛の帽子）
  cap(color, r, x, y, z, { sx = 1, sy = 1, sz = 1, rx = 0, cut = 0.5, seg = 9 } = {}) {
    return this.add(new THREE.SphereGeometry(r, seg, 4, 0, Math.PI * 2, 0, Math.PI * cut), color, mat(x, y, z, rx, 0, 0, sx, sy, sz));
  }

  get empty() {
    return this.list.length === 0;
  }

  // m をかけて1つのジオメトリに（位置・法線・頂点色）
  bake(m) {
    let n = 0;
    for (const p of this.list) n += p.geo.attributes.position.count;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const nm = m ? new THREE.Matrix3().getNormalMatrix(m) : null;
    const v = new THREE.Vector3();
    let o = 0;
    for (const p of this.list) {
      const P = p.geo.attributes.position, N = p.geo.attributes.normal;
      _c.setHex(p.color); // sRGB → リニア
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i);
        if (m) v.applyMatrix4(m);
        pos[o * 3] = v.x; pos[o * 3 + 1] = v.y; pos[o * 3 + 2] = v.z;
        v.fromBufferAttribute(N, i);
        if (nm) v.applyMatrix3(nm).normalize();
        nor[o * 3] = v.x; nor[o * 3 + 1] = v.y; nor[o * 3 + 2] = v.z;
        col[o * 3] = _c.r; col[o * 3 + 1] = _c.g; col[o * 3 + 2] = _c.b;
        o++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }

  dispose() {
    for (const p of this.list) p.geo.dispose();
    this.list = [];
  }
}

// 乱数（再現できるように種つき）
export function rng(seed) {
  let s = seed >>> 0 || 1;
  const r = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  r.chance = (p) => r() < p;
  return r;
}
