// 車内の設備：吊り革と握り棒、中吊り広告、車内案内表示（LED）、文字の板。
// 車内座標：プレイヤーが最初に立った（座った）床が原点、そのとき向いていた方が -Z。電車は X 方向に走る。
import * as THREE from '../vendor/three.module.min.js';
import { Parts, mat } from './geo.js';

const FONT = '"Noto Sans JP","Noto Sans CJK JP","Hiragino Sans","Yu Gothic","Meiryo",sans-serif';
const MAX_STRAPS = 96;

// ---------- 吊り革 ----------
class Straps {
  constructor() {
    this.items = []; // { x, z, barY, len, stage, show（0→1）, target, theta, omega, delay, yellow }
    this.mesh = null;
    this.bars = new THREE.Group();
    this.barMat = new THREE.MeshLambertMaterial({ color: 0xc9cdd2, flatShading: true });
  }

  build(ringY, barY) {
    this.ringY = ringY;
    this.barY = barY;
    const len = barY - ringY;
    const p = new Parts();
    // 原点が握り棒の高さ。帯と三角っぽい輪っか
    p.box(0xc4c8cc, 0.028, len - 0.05, 0.008, 0, -(len - 0.05) / 2, 0);
    p.box(0x6d7781, 0.04, 0.035, 0.03, 0, -0.012, 0);
    p.add(new THREE.TorusGeometry(0.062, 0.012, 4, 12), 0xf1f0ea, mat(0, -len - 0.055, 0));
    const geo = p.bake();
    p.dispose();
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.removeFromParent();
    }
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), MAX_STRAPS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.items = [];
    this.bars.clear();
  }

  // 握り棒1本と、そこに下がる吊り革を足す（まだ見えない）
  addBar(x0, x1, z, stage, rng, { spacing = 0.27, brackets = true } = {}) {
    const len = x1 - x0;
    if (len < 0.2) return;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, len, 8), this.barMat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set((x0 + x1) / 2, this.barY, z);
    bar.userData.stage = stage;
    bar.scale.y = 0.0001;
    bar.visible = false;
    this.bars.add(bar);
    if (brackets) {
      for (let x = x0 + 0.1; x <= x1 - 0.05; x += 0.9) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.32, 6), this.barMat);
        b.position.set(x - bar.position.x, 0, 0);
        // 棒（回転済み）の子なので、局所 x が上向き
        b.rotation.z = -Math.PI / 2;
        b.position.set(0, -(x - bar.position.x), 0);
        b.position.x = 0.16;
        bar.add(b);
      }
    }
    const n = Math.max(1, Math.floor(len / spacing));
    const pad = (len - (n - 1) * spacing) / 2;
    for (let i = 0; i < n && this.items.length < MAX_STRAPS; i++) {
      this.items.push({
        x: x0 + pad + i * spacing, z, stage, show: 0, target: 0, theta: 0, omega: 0,
        phase: rng() * 10, yellow: rng() < 0.12, delay: 0,
      });
    }
    this.mesh.count = this.items.length;
  }

  reveal(stage, stagger = 0.06) {
    let k = 0;
    for (const s of this.items) {
      if (s.stage !== stage) continue;
      s.target = 1;
      s.delay = (k++) * stagger;
    }
    for (const b of this.bars.children) if (b.userData.stage === stage) b.userData.target = 1;
  }

  hideAll(stagger = 0.03) {
    let k = 0;
    for (const s of this.items) {
      if (s.target === 0) continue;
      s.target = 0;
      s.delay = (k++) * stagger;
    }
    for (const b of this.bars.children) b.userData.target = 0;
  }

  countShown() {
    return this.items.filter((s) => s.target > 0).length;
  }

  // 新しく下がってきた本数（音を鳴らすため）を返す
  update(dt, t, lean, sway) {
    let dropped = 0;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const pos = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const white = new THREE.Color(1, 1, 1);
    const yellow = new THREE.Color(1.0, 0.82, 0.25);
    this.items.forEach((s, i) => {
      if (s.delay > 0) {
        s.delay -= dt;
      } else if (s.show !== s.target) {
        const before = s.show;
        s.show += Math.sign(s.target - s.show) * dt * (s.target ? 1.6 : 1.2);
        s.show = THREE.MathUtils.clamp(s.show, 0, 1);
        if (before === 0 && s.show > 0) dropped++;
      }
      // 揺れ：ブレーキの傾きの倍くらい振れて、ばねで戻る
      const target = -lean * 2.4 + sway * 0.05 * Math.sin(t * 1.3 + s.phase);
      s.omega += (-(s.theta - target) * 26 - s.omega * 2.2) * dt;
      s.theta += s.omega * dt;
      const k = s.show;
      // 巻き尺のように上から伸びる（少し行き過ぎて戻る）
      const ext = k <= 0 ? 0.0001 : 1 - Math.pow(1 - k, 3) + Math.sin(k * Math.PI) * 0.08;
      e.set(Math.sin(t * 0.9 + s.phase) * 0.02, 0, s.theta);
      q.setFromEuler(e);
      pos.set(s.x, this.barY, s.z);
      if (k <= 0) sc.set(0, 0, 0); // 出ていない吊り革は描かない
      else sc.set(1, ext, 1);
      m.compose(pos, q, sc);
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, s.yellow ? yellow : white);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    for (const b of this.bars.children) {
      const tg = b.userData.target || 0;
      b.scale.y += THREE.MathUtils.clamp(tg - b.scale.y, -dt * 1.2, dt * 2);
      b.scale.y = Math.max(0.0001, b.scale.y);
      b.visible = b.scale.y > 0.001;
    }
    return dropped;
  }
}

// ---------- 中吊り広告 ----------
// 架空の広告。実在の会社・商品は出さない
const ADS = [
  (c, W, H) => {
    bg(c, W, H, '#f4f1ea');
    c.fillStyle = '#c8232c'; c.fillRect(0, 0, W, 78);
    txt(c, '週刊 帰宅', 22, 56, 54, '#fff', 900, 'left');
    txt(c, '10月28日号', W - 20, 50, 22, '#fff', 700, 'right');
    txt(c, '玄関で3時間', 24, 150, 48, '#111', 900, 'left');
    txt(c, '立ち尽くす人々', 24, 205, 48, '#111', 900, 'left');
    txt(c, '特集「家に着いてからが通勤」', 24, 262, 28, '#c8232c', 700, 'left');
    txt(c, '・今週の始発　・靴を脱ぐ勇気', 24, 305, 22, '#333', 500, 'left');
    txt(c, '定価 400円', W - 20, H - 22, 20, '#333', 700, 'right');
  },
  (c, W, H) => {
    bg(c, W, H, '#1d3a5f');
    txt(c, '駅から徒歩0分。', W / 2, 110, 52, '#fff', 900);
    txt(c, 'というか、駅。', W / 2, 180, 52, '#ffd34d', 900);
    txt(c, '新築1R・つり革付き・常時満員', W / 2, 250, 26, '#dfe8f2', 500);
    c.fillStyle = '#fff'; c.fillRect(0, H - 60, W, 60);
    txt(c, 'グランメゾン自宅前', W / 2, H - 20, 28, '#1d3a5f', 900);
  },
  (c, W, H) => {
    bg(c, W, H, '#fffbe6');
    txt(c, '「ただいま」から', W / 2, 105, 46, '#222', 900);
    txt(c, 'はじめる英会話。', W / 2, 165, 46, '#222', 900);
    txt(c, 'I\'m home. But I\'m on the train.', W / 2, 225, 24, '#555', 500);
    c.fillStyle = '#ef7d00'; c.fillRect(0, H - 70, W, 70);
    txt(c, 'イエニ・カエレズ英会話', W / 2, H - 24, 32, '#fff', 900);
  },
  (c, W, H) => {
    bg(c, W, H, '#e9f3ee');
    c.fillStyle = '#2f8a5b'; c.beginPath(); c.arc(105, H / 2, 70, 0, Math.PI * 2); c.fill();
    txt(c, '休', 105, H / 2 + 26, 76, '#fff', 900);
    txt(c, '休めない胃に。', 200, 140, 46, '#1f4d36', 900, 'left');
    txt(c, 'ヤスメナール', 200, 215, 44, '#2f8a5b', 900, 'left');
    txt(c, 'なお、休めるとは言っていません。', 200, 265, 20, '#476', 500, 'left');
  },
  (c, W, H) => {
    bg(c, W, H, '#ffffff');
    c.fillStyle = '#0a7d3e'; c.fillRect(0, 0, 26, H);
    txt(c, '定期券', 60, 90, 40, '#0a7d3e', 900, 'left');
    txt(c, '自宅 ⇔ 自宅', 60, 170, 58, '#111', 900, 'left');
    txt(c, '6か月　0円', 60, 245, 44, '#c8232c', 900, 'left');
    txt(c, '※ご自宅からはお降りになれません', 60, 300, 20, '#555', 500, 'left');
  },
  (c, W, H) => {
    bg(c, W, H, '#262626');
    txt(c, 'あなたの市場価値、', W / 2, 120, 42, '#fff', 900);
    txt(c, 'だいたい据え置き。', W / 2, 185, 42, '#7fd6ff', 900);
    txt(c, '転職ならウゴカーズ', W / 2, 280, 30, '#fff', 700);
  },
  (c, W, H) => {
    bg(c, W, H, '#fff7d6');
    c.strokeStyle = '#333'; c.lineWidth = 6;
    // ピクトグラム：リュックを前に抱えた人
    c.fillStyle = '#333';
    c.beginPath(); c.arc(100, 110, 26, 0, Math.PI * 2); c.fill();
    c.fillRect(78, 142, 44, 110);
    c.fillStyle = '#e07b00'; c.fillRect(120, 160, 32, 56);
    txt(c, 'リュックは前に。', 190, 150, 44, '#222', 900, 'left');
    txt(c, 'お部屋の中でも。', 190, 215, 44, '#222', 900, 'left');
    txt(c, 'ご協力をお願いいたします', 190, 270, 22, '#555', 500, 'left');
  },
  (c, W, H) => {
    bg(c, W, H, '#20184a');
    for (let i = 0; i < 40; i++) {
      c.fillStyle = `rgba(255,255,255,${0.3 + (i % 5) * 0.12})`;
      c.fillRect((i * 97) % W, (i * 53) % (H - 80), 3, 3);
    }
    txt(c, '寝る前に、', W / 2, 120, 46, '#fff', 900);
    txt(c, 'もう一駅。', W / 2, 185, 46, '#ffe17a', 900);
    txt(c, '快眠サプリ ネムレナイン', W / 2, 275, 28, '#cfc8ff', 700);
  },
  (c, W, H) => {
    bg(c, W, H, '#e8f4fb');
    txt(c, 'どこにも行かない旅。', W / 2, 115, 44, '#0b5d8a', 900);
    txt(c, '自宅 2泊3日', W / 2, 190, 52, '#111', 900);
    txt(c, '0円〜（交通費込み）', W / 2, 250, 30, '#c8232c', 700);
    txt(c, 'ウツツ・トラベル', W / 2, H - 22, 22, '#0b5d8a', 700);
  },
];
function bg(c, W, H, color) {
  c.fillStyle = color;
  c.fillRect(0, 0, W, H);
}
function txt(c, s, x, y, size, color, weight = 700, align = 'center') {
  c.font = `${weight} ${size}px ${FONT}`;
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = 'alphabetic';
  c.fillText(s, x, y);
}

function adTexture(i) {
  const W = 512, H = 364;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  ADS[i % ADS.length](c, W, H);
  // 紙の縁と、ほんの少しの日焼け
  c.strokeStyle = 'rgba(0,0,0,0.25)';
  c.lineWidth = 4;
  c.strokeRect(2, 2, W - 4, H - 4);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

class Ads {
  constructor() {
    this.group = new THREE.Group();
    this.textures = ADS.map((_, i) => adTexture(i));
    this.items = [];
    this.opacity = 0;
    this.target = 0;
  }

  build(barY, spots, rng) {
    this.group.clear();
    this.items = [];
    const W = 0.515, H = 0.364;
    const geo = new THREE.PlaneGeometry(W, H);
    const wire = new THREE.MeshBasicMaterial({ color: 0x9a9fa5, transparent: true, opacity: 0 });
    let k = Math.floor(rng() * ADS.length);
    for (const s of spots) {
      const g = new THREE.Group();
      g.position.set(s.x, barY + 0.12 - H / 2, s.z);
      g.rotation.y = s.ry;
      for (const side of [0, 1]) {
        const m = new THREE.MeshBasicMaterial({ map: this.textures[k++ % ADS.length], transparent: true, opacity: 0, color: 0xe0e0e0, toneMapped: false });
        const p = new THREE.Mesh(geo, m);
        p.rotation.y = side * Math.PI;
        p.position.z = side ? -0.002 : 0.002;
        g.add(p);
        this.items.push(m);
      }
      const w = new THREE.Mesh(new THREE.BoxGeometry(W * 0.96, 0.012, 0.012), wire);
      w.position.y = H / 2 + 0.006;
      g.add(w);
      this.items.push(wire);
      g.userData.phase = rng() * 10;
      this.group.add(g);
    }
  }

  update(dt, t, lean) {
    this.opacity += THREE.MathUtils.clamp(this.target - this.opacity, -dt * 0.5, dt * 0.5);
    for (const m of this.items) m.opacity = this.opacity;
    this.group.visible = this.opacity > 0.005;
    for (const g of this.group.children) g.rotation.z = -lean * 1.2 + Math.sin(t * 0.8 + g.userData.phase) * 0.01;
  }
}

// ---------- 車内案内表示（LEDの電光掲示） ----------
export class Led {
  constructor() {
    this.W = 1024;
    this.H = 192;
    this.cv = document.createElement('canvas');
    this.cv.width = this.W;
    this.cv.height = this.H;
    this.ctx = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.minFilter = THREE.LinearFilter;
    this.group = new THREE.Group();
    this.mode = { type: 'off' };
    this.group.visible = false; // 電光掲示そのものも、電車が来るまでは無い
    this.scroll = 0;
    this.acc = 0;
    // ドット模様（あとで上から重ねる）
    const dots = document.createElement('canvas');
    dots.width = 6;
    dots.height = 6;
    const d = dots.getContext('2d');
    d.fillStyle = 'rgba(0,0,0,0.55)';
    d.fillRect(0, 0, 6, 1.5);
    d.fillRect(0, 0, 1.5, 6);
    this.dotPattern = this.ctx.createPattern(dots, 'repeat');
    this.draw();
  }

  // 前と後ろに1台ずつ（同じ表示）
  build(barY, dist) {
    this.group.clear();
    const frame = new THREE.MeshLambertMaterial({ color: 0x3a3d42 });
    const screen = new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false });
    for (const sz of [-1, 1]) {
      const g = new THREE.Group();
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.24, 0.07), frame);
      const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.1725), screen);
      sc.position.z = 0.036;
      g.add(box, sc);
      g.position.set(0, barY + 0.2, sz * dist);
      g.rotation.y = sz > 0 ? Math.PI : 0;
      this.group.add(g);
    }
  }

  // mode: { type: 'off' } | { type: 'scroll', text, color } | { type: 'next', head, name, kana, color }
  show(mode) {
    this.mode = mode;
    this.scroll = 0;
    this.draw();
  }

  draw() {
    const { ctx: c, W, H } = this;
    c.fillStyle = '#050505';
    c.fillRect(0, 0, W, H);
    const m = this.mode;
    const col = { orange: '#ff9a1f', green: '#6dff6a', red: '#ff4a3a', yellow: '#ffd23a' };
    if (m.type === 'scroll') {
      c.font = `700 120px ${FONT}`;
      c.textBaseline = 'middle';
      c.textAlign = 'left';
      c.fillStyle = col[m.color] || col.orange;
      const w = c.measureText(m.text).width;
      const x = W - this.scroll;
      c.fillText(m.text, x, H / 2 + 6);
      if (x + w < -20) this.scroll = 0;
    } else if (m.type === 'next') {
      c.font = `700 56px ${FONT}`;
      c.textBaseline = 'middle';
      c.textAlign = 'left';
      c.fillStyle = col.green;
      c.fillText(m.head, 36, H / 2 + 4);
      c.font = `900 130px ${FONT}`;
      c.fillStyle = col[m.color] || col.orange;
      c.textAlign = 'center';
      c.fillText(m.name, W / 2 + 70, H / 2 + 8);
      if (m.kana) {
        c.font = `700 40px ${FONT}`;
        c.fillStyle = col.green;
        c.textAlign = 'right';
        c.fillText(m.kana, W - 30, H - 30);
      }
    }
    c.fillStyle = this.dotPattern;
    c.fillRect(0, 0, W, H);
    this.tex.needsUpdate = true;
  }

  update(dt) {
    if (this.mode.type !== 'scroll') return;
    this.acc += dt;
    if (this.acc < 1 / 30) return;
    this.scroll += this.acc * 260;
    this.acc = 0;
    this.draw();
  }
}

// ---------- 文字の板（タイトル、「お疲れさまでした」） ----------
export class TextBoard {
  constructor() {
    this.W = 1024;
    this.H = 512;
    this.cv = document.createElement('canvas');
    this.cv.width = this.W;
    this.cv.height = this.H;
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.material = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, opacity: 0, depthTest: false, depthWrite: false, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.5), this.material);
    this.mesh.renderOrder = 300;
    this.mesh.visible = false;
    this.target = 0;
    this.rate = 1;
  }

  // lines: [{ text, size, weight, color }]
  set(lines) {
    const c = this.cv.getContext('2d');
    const { W, H } = this;
    c.clearRect(0, 0, W, H);
    const grad = c.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.55);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grad;
    c.fillRect(0, 0, W, H);
    const total = lines.reduce((a, l) => a + l.size * 1.45, 0);
    let y = H / 2 - total / 2;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (const l of lines) {
      y += l.size * 0.725;
      c.font = `${l.weight || 700} ${l.size}px ${FONT}`;
      c.shadowColor = 'rgba(0,0,0,0.8)';
      c.shadowBlur = 12;
      c.fillStyle = l.color || '#f4f1ea';
      c.fillText(l.text, W / 2, y);
      y += l.size * 0.725;
    }
    c.shadowBlur = 0;
    this.tex.needsUpdate = true;
  }

  show(rate = 0.8) {
    this.target = 1;
    this.rate = rate;
    this.mesh.visible = true;
  }

  hide(rate = 0.8) {
    this.target = 0;
    this.rate = rate;
  }

  update(dt) {
    const o = this.material.opacity;
    this.material.opacity = THREE.MathUtils.clamp(o + Math.sign(this.target - o) * dt * this.rate, 0, 1);
    if (this.material.opacity <= 0 && this.target === 0) this.mesh.visible = false;
  }
}

// ---------- 車両全体 ----------
export class Car {
  constructor() {
    this.root = new THREE.Group();
    this.straps = new Straps();
    this.ads = new Ads();
    this.led = new Led();
    this.root.add(this.straps.bars, this.ads.group, this.led.group);
  }

  // R：使ってよい半径（部屋の広さ）、ringY：吊り革の輪の高さ
  build({ R, ringY, rng }) {
    const barY = ringY + 0.38;
    this.R = R;
    this.ringY = ringY;
    this.barY = barY;
    const S = this.straps;
    S.build(ringY, barY);
    this.root.add(S.mesh);
    const span = (z) => Math.sqrt(Math.max(0, R * R - z * z)) - 0.15;
    for (const z of [-0.7, 0.7]) S.addBar(-span(z), span(z), z, 1, rng);
    for (const z of [-1.45, 1.45]) if (span(z) > 0.4) S.addBar(-span(z), span(z), z, 2, rng);
    // 広告：真ん中の列（電車の進む方を向く）と、その前後の列
    const spots = [];
    for (const x of [-1.45, -0.65, 0.65, 1.45]) if (Math.abs(x) < span(0) - 0.2) spots.push({ x, z: 0, ry: Math.PI / 2 });
    for (const z of [-1.08, 1.08]) for (const x of [-1.2, -0.4, 0.4, 1.2]) if (Math.abs(x) < span(z) - 0.25) spots.push({ x, z, ry: Math.PI / 2 });
    this.ads.build(barY, spots, rng);
    this.led.build(barY, Math.min(R, 2.0));
  }

  // 顔のすぐ横の吊り革（第3段階）。head：車内座標の頭、f：正面（車内座標の水平単位ベクトル）
  addCloseStraps(head, f, rng) {
    const r = { x: -f.z, z: f.x };
    const S = this.straps;
    for (const side of [1, -1]) {
      const x = head.x + r.x * side * 0.3 + f.x * 0.06;
      const z = head.z + r.z * side * 0.3 + f.z * 0.06;
      S.addBar(x - 0.13, x + 0.13, z, 3, rng, { spacing: 0.26, brackets: false });
    }
    S.reveal(3, 0.5);
  }

  update(dt, t, lean, sway) {
    const dropped = this.straps.update(dt, t, lean, sway);
    this.ads.update(dt, t, lean);
    this.led.update(dt);
    return dropped;
  }
}
