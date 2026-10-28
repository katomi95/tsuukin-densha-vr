// 進行。帰宅 → 満員 → 終点 → 静寂 → 始発 → …（最後まで救済しない）
// 時刻は1周の中の秒数。CONFIG.T を書き換えれば間合いを調整できる。
// 座標はすべて車内座標（car.root の局所。床が y=0）。
import * as THREE from '../vendor/three.module.min.js';
import { Passenger, makeSpec, reachArm } from './people.js';
import { rng as makeRng } from './geo.js';

export const CONFIG = {
  T: {
    title: 1, titleOff: 6.5,
    manin: 7.5,          // 「まもなく、満員、満員です」（1周目だけ）
    straps1: 10,
    p1: 11, p1Gap: 2.6,
    depart1: 18,
    next1: 30, brake1: 34,
    door1: 42.5, p2: 44, p2Gap: 0.6, doorClose1: 50,
    depart2: 53,
    phone: 55,
    e1: 64,
    next2: 74, brake2: 77,
    door2: 86.5, p3: 88, p3Gap: 0.45, back: 89, closeStraps: 92, doorClose2: 94,
    depart3: 97,
    bag: 99,
    e2: 104,
    stop3: 114,
    delay1: 123, delay2: 130, delay3: 137,
    compressor: 141,
    e3: 144,
    resume: 166, shuuten: 168, arrive: 172,
    vanish: 172, vanishDur: 14, unequip: 182,
    silence: 188, otsukare: 190, otsukareOff: 196,
    shihatsu: 202, loop: 206, loopStart: 9.5,
  },
};

// アナウンスの文面
const ANN = {
  manin: 'まもなく、満員、満員です。',
  next: '次は、自宅、自宅です。お出口は、右側です。',
  next2: '次は、自宅、自宅です。お出口は、右側、もしくは、ございません。',
  delay1: 'ただいま、前の電車がつかえております。',
  delay2: 'お急ぎのところ、申し訳ございません。',
  delay3: 'なお、運転再開の見込みは、立っておりません。',
  brake: '急停車します。ご注意ください。',
  manner: '車内では、携帯電話をマナーモードに設定してください。',
  endless1: 'ただいま、運転を見合わせております。',
  endless2: '運転再開まで、今しばらくお待ちください。',
  endless3: '本日はご利用いただき、誠にありがとうございます。',
  shuuten: 'まもなく、終点です。',
  shihatsu: 'まもなく、始発駅です。',
};

const RINGTONES = ['marimba', 'bell', 'digital', 'melody', 'vibe', 'marimba', 'vibe'];

export class Director {
  // car：Car、audio：TrainAudio、voice：Announcer、board：TextBoard
  constructor(car, audio, voice, board) {
    this.car = car;
    this.audio = audio;
    this.voice = voice;
    this.board = board;
    this.people = new THREE.Group();
    car.root.add(this.people);
    this.list = [];
    this.tasks = [];
    this.active = false;
    this.time = 0;
    this.loop = 0;
    this.lean = 0;
    this.leanVel = 0;
    this.sway = 0;
    this.annBusy = 0;
    this.head = { local: new THREE.Vector3(0, 1.6, 0), world: new THREE.Vector3(0, 1.6, 0), fwd: new THREE.Vector3(0, 0, -1), height: 1.6 };
    this.forceEvents = null;
    this.ambientTimer = 2;
    this.ledIdle = false;
    this.ledTimer = 0;
    this.ledFlip = 0;
  }

  // crowd：CROWD の値、room：ROOM の値、ringY：吊り革の輪の高さ
  begin({ crowd, room, ringY, seed = Date.now() }) {
    this.end();
    this.crowd = crowd;
    this.R = room.R;
    this.ringY = ringY;
    this.rng = makeRng(seed);
    this.car.build({ R: this.R, ringY, rng: this.rng });
    this.env = { ringY, barY: this.car.barY };
    this.active = true;
    this.loop = 0;
    this._startLoop(0);
  }

  end() {
    this.active = false;
    for (const p of this.list) p.dispose();
    this.list = [];
    this.tasks = [];
    this.voice.cancel();
    this.car.led.show({ type: 'off' });
    this.car.led.group.visible = false;
    this.car.ads.target = 0;
    this.car.ads.opacity = 0;
    this.car.straps.items = [];
    if (this.car.straps.mesh) this.car.straps.mesh.count = 0;
    this.car.straps.bars.clear();
    this.board.hide(10);
  }

  // main から毎フレーム：プレイヤーの頭（車内座標・ワールド）と正面
  setHead(local, world, fwd, height) {
    this.head.local.copy(local);
    this.head.world.copy(world);
    this.head.fwd.copy(fwd);
    this.head.height = height;
  }

  // ---------- 1周の段取り ----------
  _startLoop(startAt) {
    const T = CONFIG.T;
    const first = this.loop === 0;
    this.time = startAt;
    this.cues = [];
    this.special = {};
    this.vanished = false;
    for (const p of this.list) p.dispose();
    this.list = [];
    this.tasks = [];
    this.audio.setLevel(0.45);
    if (!first) {
      // 吊り革と握り棒をはじめから作り直す（前の周の「顔の横の吊り革」は消える）
      this.car.build({ R: this.R, ringY: this.ringY, rng: this.rng });
    }
    const at = (t, fn) => this.cues.push({ t, fn });
    if (first) {
      at(T.title, () => this._title());
      at(T.titleOff, () => this.board.hide(0.6));
      at(T.manin - 0.5, () => { this.car.led.group.visible = true; });
      at(T.manin, () => this.announce('manin', { led: 'orange' }));
    }
    at(T.straps1, () => this.car.straps.reveal(1, 0.12));
    const C = this.crowd.c;
    for (let i = 0; i < C[0]; i++) at(T.p1 + i * T.p1Gap, () => this.spawn({ rMin: 1.1, mode: 'fade' }));
    at(T.p1 + 3, () => this._ledIdle(true));
    at(T.depart1, () => this.audio.drive(0.7, 0.07));
    at(T.next1, () => this.announce('next'));
    at(T.brake1, () => this.audio.drive(0, 0.09));
    at(T.brake1 + 4.5, () => this.audio.brake(3.6));
    at(T.door1 - 0.5, () => this._arrived());
    at(T.door1, () => this._doors(true));
    // 第2段階：混雑
    at(T.p2, () => {
      this.audio.setLevel(0.65);
      this.car.ads.target = 1;
      this.car.straps.reveal(2, 0.05);
    });
    // 席を譲る人は、このあとの出来事で「譲る」ときだけ乗せる
    const plan = this._planEvents();
    this.plan = plan;
    if (plan.includes('seat')) at(T.p2 + 0.3, () => this._spawnSitter());
    for (let i = 0; i < C[1]; i++) at(T.p2 + 1 + i * T.p2Gap, () => this.spawn({ rMin: 0.78, mode: 'walk' }));
    at(T.doorClose1, () => this._doors(false));
    at(T.depart2, () => this.audio.drive(0.8, 0.07));
    at(T.phone, () => this._phoneGuy());
    at(T.e1, () => this.event(plan[0]));
    at(T.next2, () => this.announce('next2'));
    at(T.brake2, () => this.audio.drive(0, 0.09));
    at(T.brake2 + 4.5, () => this.audio.brake(3.6));
    at(T.door2 - 0.5, () => this._arrived());
    at(T.door2, () => this._doors(true));
    // 第3段階：超満員
    at(T.p3, () => this.audio.setLevel(0.9));
    for (let i = 0; i < C[2]; i++) at(T.p3 + i * T.p3Gap, () => this.spawn({ rMin: this.crowd.minR, mode: 'walk' }));
    at(T.back, () => this._backHead());
    at(T.closeStraps, () => this.car.addCloseStraps(this.head.local, this.head.fwd, this.rng));
    at(T.doorClose2, () => this._doors(false));
    at(T.depart3, () => {
      this.audio.drive(0.9, 0.08);
      this._earLeak();
    });
    at(T.bag, () => this._bagMan());
    at(T.e2, () => this.event(plan[1]));
    at(T.stop3, () => {
      this.audio.drive(0, 0.12);
      this.audio.brake(4);
    });
    at(T.stop3 + 8, () => this._ledIdle(true));
    at(T.delay1, () => this.announce('delay1', { led: 'red' }));
    at(T.delay2, () => this.announce('delay2', { led: 'red' }));
    at(T.delay3, () => this.announce('delay3', { led: 'red' }));
    at(T.compressor, () => this.audio.compressor(this._world(0, 0.2, this.R * 0.8), 7));
    at(T.e3, () => this.event(plan[2]));
    // 終点
    at(T.resume, () => this.audio.drive(0.35, 0.05));
    at(T.shuuten, () => {
      this.announce('shuuten', { led: 'orange', hold: true });
      this.car.led.show({ type: 'next', head: 'まもなく', name: '終点 自宅', color: 'orange' });
    });
    at(T.arrive, () => {
      this.audio.drive(0, 0.025);
      this.audio.setLevel(0.25);
    });
    at(T.vanish, () => this._vanishAll(T.vanishDur));
    at(T.unequip, () => {
      this.car.straps.hideAll(0.04);
      this.car.ads.target = 0;
    });
    at(T.silence - 1.2, () => this.audio.airRelease(this._world(0, 0.3, -1.5)));
    at(T.silence, () => {
      this.car.led.show({ type: 'off' });
      this.car.led.group.visible = false;
      this.ledIdle = false;
      this.audio.mute(true, 1.5);
    });
    at(T.otsukare, () => this._otsukare());
    at(T.otsukareOff, () => this.board.hide(0.5));
    at(T.shihatsu, () => {
      this.audio.mute(false, 0.3);
      this.car.led.group.visible = true;
      this.car.led.show({ type: 'next', head: 'まもなく', name: '始発 自宅', color: 'green' });
      this.announce('shihatsu', { hold: true });
    });
    at(T.loop, () => {
      this.loop++;
      this._startLoop(T.loopStart);
    });
    this.cues.sort((a, b) => a.t - b.t);
    this.cues = this.cues.filter((c) => c.t >= startAt);
  }

  // 3回の出来事を選ぶ。1つ目と2つ目は走行中、3つ目は停車中
  _planEvents() {
    if (this.forceEvents) return this.forceEvents.slice(0, 3).concat(['gaze', 'gaze', 'gaze']).slice(0, 3);
    const r = this.rng;
    const pickFrom = (arr, used) => {
      const c = arr.filter((e) => !used.includes(e));
      return c.length ? r.pick(c) : r.pick(arr);
    };
    const used = [];
    const e1 = pickFrom(['brake', 'manner', 'gaze'], used); used.push(e1);
    const e2 = pickFrom(['brake', 'manner', 'gaze', 'seat'], used); used.push(e2);
    const e3 = pickFrom(['delay', 'delay', 'seat', 'manner', 'gaze'], used);
    return [e1, e2, e3];
  }

  _title() {
    this.board.set([
      { text: '通勤電車VR', size: 120, weight: 900 },
      { text: '', size: 24 },
      { text: 'おかえりなさい。', size: 46, weight: 500 },
      { text: '今日も一日お疲れさまでした。', size: 46, weight: 500 },
    ]);
    this._boardInFront(1.5);
    this.board.show(0.7);
  }

  _otsukare() {
    this.board.set([{ text: 'お疲れさまでした', size: 96, weight: 700 }]);
    this._boardInFront(1.6);
    this.board.show(0.5);
  }

  // 文字の板を、今見ている方向の正面に（水平。少しだけ下げる）
  _boardInFront(dist) {
    const h = this.head.local, f = this.head.fwd;
    const m = this.board.mesh;
    this.car.root.add(m);
    m.position.set(h.x + f.x * dist, h.y - 0.05, h.z + f.z * dist);
    m.lookAt(this.car.root.localToWorld(new THREE.Vector3(h.x, h.y - 0.05, h.z)));
  }

  // ---------- アナウンス ----------
  // アナウンスの長さ（声のファイルが読めていればその長さ、無ければ文字数から）
  _annDur(key) {
    return this.voice.duration(key) ?? 2.2 + ANN[key].length * 0.17;
  }

  // チャイム → 声と電光掲示。前のアナウンスと重ならないようにずらす。key は ANN のキー
  announce(key, { led = 'orange', chime = true, hold = false } = {}) {
    const text = ANN[key];
    const wait = Math.max(0, this.annBusy - this.time);
    const dur = this._annDur(key) + (chime ? 1.2 : 0);
    this.annBusy = this.time + wait + dur + 0.8;
    this.tasks.push({
      t: -wait,
      started: false,
      update: (task, dt) => {
        task.t += dt;
        if (task.t < 0) return false;
        if (!task.started) {
          task.started = true;
          if (chime) this.audio.announceChime(this._world(0, this.car.barY, -Math.min(this.R, 2)));
          this._ledIdle(false);
          if (!hold) this.car.led.show({ type: 'scroll', text: text.replace(/。$/, ''), color: led });
        }
        if (task.t >= (chime ? 1.2 : 0) && !task.said) {
          task.said = true;
          this.voice.say(key);
        }
        if (task.t >= dur + 2) {
          if (!hold) this._ledIdle(true);
          return true;
        }
        return false;
      },
    });
  }

  _ledIdle(on) {
    this.ledIdle = on;
    this.ledTimer = 0;
    if (on) this._ledIdleShow();
  }

  _ledIdleShow() {
    const stopped = this.audio.speed < 0.02 && this.time > CONFIG.T.door1;
    if (this.ledFlip++ % 2 === 0) this.car.led.show({ type: 'next', head: stopped ? 'ただいま' : '次は', name: '自宅', kana: 'じたく', color: 'orange' });
    else this.car.led.show({ type: 'scroll', text: 'この電車は　各駅停車　自宅 行きです　　Bound for HOME', color: 'green' });
  }

  _arrived() {
    this.audio.airRelease(this._world(0, 0.3, -1.5));
    this.ledFlip = 0;
    this._ledIdle(true);
  }

  _doors(open) {
    const pos = this._world(0, 1.0, -Math.min(this.R, 2) - 0.2);
    this.audio.doorChime(pos, !open);
    this.tasks.push({ t: 0, update: (task, dt) => {
      task.t += dt;
      if (task.t > (open ? 0.6 : 1.8)) {
        this.audio.door(pos, open);
        return true;
      }
      return false;
    } });
  }

  // ---------- 乗客 ----------
  _world(x, y, z) {
    return this.car.root.localToWorld(new THREE.Vector3(x, y, z));
  }

  // 空いている場所を探す（プレイヤーの頭のまわり、部屋の範囲内、ほかの人と重ならない）
  // height を渡すと、背の高い人は吊り革の輪の真下を避ける（顔に輪が刺さらないように）
  _findSpot(rMin, rMax, { sep = 0.46, tries = 40, around = null, height = 0 } = {}) {
    const h = around || this.head.local;
    const r = this.rng;
    const rings = height > this.ringY - 0.12 ? this.car.straps.items : [];
    for (let i = 0; i < tries; i++) {
      const rr = Math.sqrt(r.range(rMin * rMin, rMax * rMax));
      const a = r() * Math.PI * 2;
      const x = h.x + Math.cos(a) * rr, z = h.z + Math.sin(a) * rr;
      if (Math.hypot(x, z) > this.R - 0.15) continue;
      if (this.list.some((p) => !p.leaving && Math.hypot(p.x - x, p.z - z) < sep)) continue;
      if (rings.some((s) => Math.abs(s.z - z) < 0.16 && Math.abs(s.x - x) < 0.14)) continue;
      return { x, z };
    }
    return null;
  }

  _yawFor(x, z) {
    const h = this.head.local;
    const dx = x - h.x, dz = z - h.z;
    const d = Math.hypot(dx, dz);
    const r = this.rng;
    const away = Math.atan2(dx, dz);
    const side = (r.chance(0.5) ? 1 : -1) * Math.PI / 2;
    let yaw;
    if (d < 1.0) yaw = r.chance(0.5) ? away : side;
    else {
      const k = r();
      yaw = k < 0.3 ? away : k < 0.7 ? side : away + Math.PI;
    }
    return yaw + r.range(-0.35, 0.35);
  }

  _add(spec, { rigged = false } = {}) {
    const p = new Passenger(spec, { rigged, env: this.env });
    this.people.add(p.root);
    this.list.push(p);
    return p;
  }

  spawn({ rMin, mode = 'fade', spec = {} }) {
    const sp = makeSpec(this.rng, spec);
    const spot = this._findSpot(rMin, this.R - 0.2, { height: sp.height });
    if (!spot) return null;
    const p = this._add(sp);
    p.place(spot.x, spot.z, this._yawFor(spot.x, spot.z));
    if (mode === 'walk') {
      // 部屋の外側（ドアの方）から歩いてくる
      const a = Math.atan2(spot.z, spot.x) * 0.5 + Math.atan2(-1, 0) * 0.5;
      const r0 = this.R + 0.3;
      p.walkFrom(Math.cos(a) * r0, Math.sin(a) * r0, 0.45);
      p.appearRate = 1.2;
      p.steps = 0;
    } else {
      p.appearRate = 0.6;
      this.audio.rustle(this._world(spot.x, 1.1, spot.z), 0.7);
    }
    return p;
  }

  // 新しい人が立つ場所にいる人を、そっと押しのける
  _makeRoom(x, z, radius = 0.45, except = null) {
    for (const p of this.list) {
      if (p === except || p.leaving || p.role) continue;
      const dx = p.x - x, dz = p.z - z;
      const d = Math.hypot(dx, dz);
      if (d >= radius) continue;
      const k = d > 1e-3 ? 1 / d : 1;
      let nx = x + (d > 1e-3 ? dx * k : 1) * (radius + 0.05);
      let nz = z + (d > 1e-3 ? dz * k : 0) * (radius + 0.05);
      const rr = Math.hypot(nx, nz);
      if (rr > this.R - 0.15) {
        // 部屋の外に出てしまうなら、いなくなってもらう
        p.leave(0.8);
        continue;
      }
      p.moveTo(nx, nz, 0.2);
    }
  }

  // 頭を基準に「前に a、右に b」の車内座標
  _rel(a, b) {
    const h = this.head.local, f = this.head.fwd;
    return { x: h.x + f.x * a - f.z * b, z: h.z + f.z * a + f.x * b };
  }

  _fwdYaw() {
    return Math.atan2(this.head.fwd.x, this.head.fwd.z);
  }

  // 目の前に立つ人（後頭部がちょうど目の高さ）
  _backHead() {
    const s = this._rel(this.crowd.back, 0.03);
    if (Math.hypot(s.x, s.z) > this.R - 0.1) return;
    this._makeRoom(s.x, s.z, 0.5);
    const height = THREE.MathUtils.clamp(this.head.height + 0.1, 1.5, 1.9);
    const p = this._add(makeSpec(this.rng, { height, pose: this.rng.pick(['phone', 'idle', 'strap']), hair: this.rng.pick(['short', 'side', 'bob', 'long']), bag: 'shoulder' }));
    p.role = 'back';
    p.place(s.x, s.z, this._fwdYaw() + this.rng.range(-0.15, 0.15));
    const from = this._rel(this.crowd.back + 0.1, 1.2);
    p.walkFrom(from.x, from.z, 0.3);
    p.appearRate = 1;
    this.special.back = p;
  }

  // 鞄がゆっくり視界に入ってくる人（大きなリュックを背負って、こちらに背を向ける）
  _bagMan() {
    const a = Math.max(0.55, this.crowd.minR + 0.02);
    const end = this._rel(a, 0.15);
    const start = this._rel(a, 1.1);
    if (Math.hypot(start.x, start.z) > this.R - 0.1) {
      const s2 = this._rel(a, 0.8);
      Object.assign(start, s2);
    }
    this._makeRoom(start.x, start.z, 0.45);
    const height = THREE.MathUtils.clamp(this.head.height + 0.15, 1.6, 1.9);
    const p = this._add(makeSpec(this.rng, { height, pose: 'phone', bag: 'backpack', bagColor: this.rng.pick([0x2d3340, 0x1b1b1d, 0x5c6450]) }));
    p.role = 'bag';
    p.place(start.x, start.z, this._fwdYaw() + 0.25);
    p.appearRate = 0.7;
    this.tasks.push({ t: 0, update: (task, dt) => {
      task.t += dt;
      if (task.t > 2.5 && !task.moving) {
        task.moving = true;
        this._makeRoom(end.x, end.z, 0.45, p);
        p.moveTo(end.x, end.z, 0.065);
      }
      if (task.moving && !task.step && p.path) {
        task.stepT = (task.stepT || 0) + dt;
        if (task.stepT > 2.2) {
          task.stepT = 0;
          this.audio.rustle(this._world(p.position.x, 1.2, p.position.z), 0.8);
        }
      }
      return task.moving && !p.path;
    } });
  }

  // スマホを顔の近くに持ってくる人（横に立って、自分の画面を見ているだけ）
  _phoneGuy() {
    const side = this.rng.chance(0.5) ? 1 : -1;
    const spot = this._rel(0.22, side * 0.5);
    if (Math.hypot(spot.x, spot.z) > this.R - 0.1) return;
    this._makeRoom(spot.x, spot.z, 0.5);
    const p = this._add(makeSpec(this.rng, { pose: 'idle', bag: 'backpack', glasses: true, mask: false, height: THREE.MathUtils.clamp(this.head.height + 0.08, 1.55, 1.85) }), { rigged: true });
    p.role = 'phone';
    // プレイヤーと同じ向き。プレイヤー側の手でスマホを持つ
    p.place(spot.x, spot.z, this._fwdYaw());
    const from = this._rel(0.3, side * 1.5);
    p.walkFrom(from.x, from.z, 0.35);
    p.appearRate = 1;
    const B = p.B;
    // プレイヤー側の腕：side=+1（右に立つ）なら、その人の左手（局所 +X）が近い
    const arm = side > 0 ? { s: B.shoulderL, e: B.elbowL, pole: new THREE.Vector3(0.7, -0.5, -0.3) } : { s: B.shoulderR, e: B.elbowR, pole: new THREE.Vector3(-0.7, -0.5, -0.3) };
    const phone = makePhone();
    arm.e.add(phone.group);
    phone.group.position.set(0, -0.33, 0.02);
    p.phone = phone;
    const T = { lift: 4, hold: 11, lower: 3 };
    const tgt = new THREE.Vector3();
    const low = new THREE.Vector3();
    this.special.phone = p;
    this.tasks.push({ t: 0, update: (task, dt) => {
      task.t += dt;
      if (p.gone) return true;
      const t = task.t - 3.5;
      // 腰の前 → 顔の近く（ゆっくり）→ 戻す
      let k = 0;
      if (t > 0 && t < T.lift) k = ease(t / T.lift);
      else if (t >= T.lift && t < T.lift + T.hold) k = 1;
      else if (t >= T.lift + T.hold) k = 1 - ease(Math.min(1, (t - T.lift - T.hold) / T.lower));
      p.setPose('idle');
      p.yawObj.updateMatrixWorld(true);
      // 体の前、腰の高さ（ワールド）
      low.set(side * 0.12, 1.0 * p.spec.height / 1.7, 0.3);
      p.yawObj.localToWorld(low);
      // 顔の近く：プレイヤーの頭の前（距離 phone）、少し横
      const H = this.head.world;
      const f = this.head.fwd.clone().transformDirection(this.car.root.matrixWorld);
      const rr = new THREE.Vector3(-f.z, 0, f.x);
      tgt.copy(H).addScaledVector(f, this.crowd.phone).addScaledVector(rr, side * 0.1);
      tgt.y -= 0.06;
      const hand = low.clone().lerp(tgt, k);
      reachArm(arm.s, arm.e, hand, arm.pole);
      p.headBase.copy(p.B.head.quaternion);
      // 画面はプレイヤーの方ではなく、持ち主の顔の方へ（たまたま見えてしまう）
      p.headObj.updateMatrixWorld(true);
      const eye = new THREE.Vector3(0, 0.1, 0.05);
      p.headObj.localToWorld(eye);
      // 持ち主の目とプレイヤーの目の間を向ける（どちらからも見える）
      eye.lerp(H, 0.55);
      phone.group.lookAt(eye);
      phone.scroll(dt);
      if (k > 0.5) p.gazeTarget = 0;
      return false;
    } });
  }

  // 席を譲る人（はじめは何もない所に座っている）
  _spawnSitter() {
    const side = this.rng.chance(0.5) ? 1 : -1;
    const spot = this._rel(1.0, side * 0.35);
    if (Math.hypot(spot.x, spot.z) > this.R - 0.3) return;
    this._makeRoom(spot.x, spot.z, 0.55);
    const p = this._add(makeSpec(this.rng, { pose: 'sit', female: this.rng.chance(0.5), bag: null, skirt: false }), { rigged: true });
    p.role = 'sitter';
    p.side = side;
    // こちらを向いて座っている
    p.place(spot.x, spot.z, this._fwdYaw() + Math.PI);
    p.appearRate = 0.5;
    p.setPose('sit');
    p.headBase.copy(p.B.head.quaternion);
    this.special.sitter = p;
  }

  // ---------- 出来事 ----------
  event(name) {
    switch (name) {
      case 'brake': return this._evBrake();
      case 'gaze': return this._evGaze();
      case 'manner': return this._evManner();
      case 'seat': return this._evSeat();
      case 'delay': return this._evDelay();
      default: return null;
    }
  }

  // 急ブレーキ：乗客だけが一斉に傾く（視点や部屋は揺らさない）
  _evBrake() {
    this.announce('brake', { led: 'red' });
    const resume = this.audio.target;
    this.tasks.push({ t: 0, update: (task, dt) => {
      task.t += dt;
      if (task.t > 3.4 && !task.braked) {
        task.braked = true;
        this.audio.drive(Math.max(0, this.audio.speed - 0.45), 0.4);
        this.audio.brake(2.2, true);
        // 吊り革がカタカタ、衣擦れ、よろける足音
        for (let i = 0; i < 6; i++) {
          const p = this.rng.pick(this.list);
          if (p) {
            this.audio.rustle(this._world(p.position.x, 1.1, p.position.z), 1.2);
            this.audio.footstep(this._world(p.position.x, 0.05, p.position.z), 0.8);
          }
        }
        const S = this.car.straps.items.filter((s) => s.show > 0.5);
        for (let i = 0; i < Math.min(6, S.length); i++) {
          const s = this.rng.pick(S);
          this.audio.strapClack(this._world(s.x, this.car.ringY, s.z), 1);
        }
      }
      if (task.t > 9 && !task.resumed) {
        task.resumed = true;
        if (resume > 0.05) this.audio.drive(resume, 0.06);
        return true;
      }
      return false;
    } });
  }

  // 隣の乗客がゆっくりこちらを向き、黙って見つめ、何事もなかったように戻る
  _evGaze() {
    const h = this.head.local, f = this.head.fwd;
    const cands = this.list.filter((p) => {
      if (p.leaving || p.appear < 1 || p.role === 'phone' || p.role === 'back' || p.role === 'bag') return false;
      // 「隣の人」：真正面ではなく、斜め前〜横にいる人（視界の端から、ゆっくりこちらを向く）
      const dx = p.position.x - h.x, dz = p.position.z - h.z;
      const d = Math.hypot(dx, dz);
      const c = (dx * f.x + dz * f.z) / d;
      return d > 0.5 && d < 1.3 && c > 0.25 && c < 0.92;
    });
    if (!cands.length) return;
    cands.sort((a, b) => Math.hypot(a.position.x - h.x, a.position.z - h.z) - Math.hypot(b.position.x - h.x, b.position.z - h.z));
    const p = cands[0];
    p.gazeSpeed = 0.3;
    p.gazeTarget = 1;
    this.audio.rustle(this._world(p.position.x, 1.3, p.position.z), 0.5);
    this.tasks.push({ t: 0, update: (task, dt) => {
      task.t += dt;
      if (task.t > 8.5 && p.gazeTarget > 0) {
        p.gazeSpeed = 0.45;
        p.gazeTarget = 0;
      }
      return task.t > 12;
    } });
  }

  // マナーモードのお願い → 直後に、何人もの着信音が一斉に鳴る
  _evManner() {
    this.announce('manner');
    const dur = this._annDur('manner') + 1.2;
    this.tasks.push({ t: 0, update: (task, dt) => {
      task.t += dt;
      if (task.t < dur + 0.6) return false;
      const h = this.head.local;
      const ps = this.list.filter((p) => !p.leaving).sort((a, b) => Math.hypot(a.position.x - h.x, a.position.z - h.z) - Math.hypot(b.position.x - h.x, b.position.z - h.z));
      const n = Math.min(ps.length, 4 + Math.floor(this.rng() * 3));
      const kinds = RINGTONES.slice();
      for (let i = 0; i < n; i++) {
        const p = ps[Math.min(ps.length - 1, i * 2)];
        const kind = kinds.splice(Math.floor(this.rng() * kinds.length), 1)[0] || 'vibe';
        const y = p.spec.pose === 'phone' ? 1.1 : 0.9;
        const delay = this.rng() * 0.4;
        const len = 4 + this.rng() * 3.5;
        this.tasks.push({ t: -delay, update: (tk, d2) => {
          tk.t += d2;
          if (tk.t < 0) return false;
          this.audio.ringtone(this._world(p.position.x, y, p.position.z), kind, len);
          return true;
        } });
      }
      return true;
    } });
  }

  // 席を譲られる（そこに椅子はない。座るよう促しもしない）
  _evSeat() {
    const p = this.special.sitter;
    if (!p || p.leaving) return this._evGaze();
    const seat = { x: p.x, z: p.z };
    // 立ってから半歩横へ
    const h = this.head.local;
    const toP = new THREE.Vector2(h.x - p.x, h.z - p.z).normalize();
    const sideV = new THREE.Vector2(-toP.y, toP.x).multiplyScalar(p.side || 1);
    const step = { x: p.x + sideV.x * 0.42, z: p.z + sideV.y * 0.42 };
    this._makeRoom(step.x, step.z, 0.4, p);
    const arm = (p.side || 1) > 0 ? { s: p.B.shoulderR, e: p.B.elbowR, pole: new THREE.Vector3(-0.6, -0.6, 0) } : { s: p.B.shoulderL, e: p.B.elbowL, pole: new THREE.Vector3(0.6, -0.6, 0) };
    const rest = new THREE.Vector3();
    const seatW = new THREE.Vector3();
    this.tasks.push({ t: 0, update: (task, dt) => {
      task.t += dt;
      const t = task.t;
      if (t < 2.4) {
        // 立ち上がる（立つ途中で前かがみ）
        const k = ease(t / 2.4);
        p.setPose('idle', k, 'sit');
        p.B.torso.rotation.x += Math.sin(k * Math.PI) * 0.45;
        if (!task.r1) {
          task.r1 = true;
          this.audio.rustle(this._world(p.position.x, 0.8, p.position.z), 1.2);
        }
      } else if (t < 4.6) {
        p.setPose('idle');
        if (!task.moved) {
          task.moved = true;
          p.moveTo(step.x, step.z, 0.2);
          this.audio.footstep(this._world(p.position.x, 0.05, p.position.z), 0.7);
        }
      } else if (t < 12) {
        // こちらを見て、空いた（何もない）場所を手で示す
        p.setPose('idle');
        if (!task.g) {
          task.g = true;
          p.gazeSpeed = 0.6;
          p.gazeTarget = 1;
        }
        const k = ease(Math.min(1, (t - 4.6) / 1.4)) * (t > 10.5 ? 1 - ease((t - 10.5) / 1.5) : 1);
        p.yawObj.updateMatrixWorld(true);
        rest.set(0, 0.8 * p.spec.height / 1.7, 0.05).applyMatrix4(p.yawObj.matrixWorld);
        seatW.copy(this._world(seat.x, 0.62, seat.z));
        const target = rest.clone().lerp(seatW, k * 0.85);
        reachArm(arm.s, arm.e, target, arm.pole);
      } else {
        p.setPose('idle');
        if (!task.end) {
          task.end = true;
          p.gazeSpeed = 0.4;
          p.gazeTarget = 0;
        }
      }
      p.headBase.copy(p.B.head.quaternion);
      return t > 16;
    } });
  }

  // 終わらない遅延
  _evDelay() {
    this.announce('endless1', { led: 'red' });
    this.tasks.push({ t: 0, update: (task, dt) => {
      task.t += dt;
      if (task.t > 9 && !task.a) {
        task.a = true;
        this.announce('endless2', { led: 'red' });
      }
      if (task.t > 18 && !task.b) {
        task.b = true;
        this.announce('endless3', { led: 'orange' });
        return true;
      }
      return false;
    } });
  }

  // イヤホンの音漏れ（近くの、イヤホンをしている人から）
  _earLeak() {
    const h = this.head.local;
    const c = this.list.filter((p) => p.spec.earphones && !p.leaving && Math.hypot(p.position.x - h.x, p.position.z - h.z) < 1.3);
    if (!c.length) return;
    const p = c[0];
    this.leakP = p;
    this.audio.startLeak('leak', this._world(p.position.x, p.spec.height - 0.1, p.position.z));
  }

  // 一人ずつ消えていく
  _vanishAll(dur) {
    const h = this.head.local;
    // 遠い人から
    const ps = this.list.filter((p) => !p.leaving).sort((a, b) => Math.hypot(b.position.x - h.x, b.position.z - h.z) - Math.hypot(a.position.x - h.x, a.position.z - h.z));
    const gap = dur / Math.max(1, ps.length);
    ps.forEach((p, i) => {
      this.tasks.push({ t: -i * gap, update: (task, dt) => {
        task.t += dt;
        if (task.t < 0) return false;
        p.leave(1.0);
        if (p === this.leakP) this.audio.stopLeak('leak');
        return true;
      } });
    });
  }

  // ---------- 毎フレーム ----------
  update(dt) {
    if (!this.active) return;
    this.time += dt;
    while (this.cues.length && this.cues[0].t <= this.time) {
      const c = this.cues.shift();
      c.fn();
      if (!this.active) return;
    }
    this.tasks = this.tasks.filter((task) => !task.update(task, dt));

    // 加速・減速で乗客が傾く（ばね）。視点は動かさない
    const accel = this.audio.update(dt);
    const target = THREE.MathUtils.clamp(-accel * 0.35, -0.2, 0.2);
    this.leanVel += (-(this.lean - target) * 30 - this.leanVel * 4.5) * dt;
    this.lean += this.leanVel * dt;
    this.sway = this.audio.speed * (0.6 + 0.4 * Math.sin(this.time * 0.9));

    const ctx = { dt, t: this.time, lean: this.lean, sway: this.sway, headWorld: this.head.world, headHeight: this.head.height };
    for (const p of this.list) {
      p.update(ctx);
      // 歩いているあいだの足音
      if (p.path && p.walking > 0.2) {
        p.stepT = (p.stepT || 0) + dt;
        if (p.stepT > 0.55) {
          p.stepT = 0;
          this.audio.footstep(this._world(p.position.x, 0.05, p.position.z), 0.5);
        }
      }
    }
    const gone = this.list.filter((p) => p.gone);
    if (gone.length) {
      for (const p of gone) p.dispose();
      this.list = this.list.filter((p) => !p.gone);
    }
    if (this.leakP && !this.leakP.gone) this.audio.moveLeak('leak', this._world(this.leakP.position.x, this.leakP.spec.height - 0.1, this.leakP.position.z));

    const dropped = this.car.update(dt, this.time, this.lean, this.sway);
    if (dropped) this.audio.strapClack(this._world(this.head.local.x, this.car.barY, this.head.local.z - 0.5), Math.min(1, 0.4 + dropped * 0.1));

    // 衣擦れ（人が多いほど頻繁に）
    this.ambientTimer -= dt;
    if (this.ambientTimer <= 0) {
      const live = this.list.filter((p) => !p.leaving && p.appear > 0.5);
      this.ambientTimer = live.length ? this.rng.range(3, 7) / Math.sqrt(live.length / 3) : 3;
      if (live.length) {
        const p = this.rng.pick(live);
        this.audio.rustle(this._world(p.position.x, 1.0, p.position.z), 0.6);
        if (this.audio.speed > 0.3 && this.rng.chance(0.3)) {
          const S = this.car.straps.items.filter((s) => s.show > 0.9);
          if (S.length) {
            const s = this.rng.pick(S);
            this.audio.strapClack(this._world(s.x, this.car.ringY, s.z), 0.4);
          }
        }
      }
    }

    // 電光掲示のふだんの表示（10秒ごとに切り替え）
    if (this.ledIdle) {
      this.ledTimer += dt;
      if (this.ledTimer > 10) {
        this.ledTimer = 0;
        this._ledIdleShow();
      }
    }
    this.board.update(dt);
  }

  // 早送り（確認用）。音と声を止めたまま、その周の t 秒まで進める（周をまたいだら止まる）
  fastForward(t) {
    const a = this.audio.silent, v = this.voice.silent;
    this.audio.silent = true;
    this.voice.silent = true;
    const loop = this.loop;
    while (this.time < t && this.active && this.loop === loop) this.update(0.05);
    this.audio.silent = a;
    this.voice.silent = v;
  }
}

function ease(k) {
  k = Math.min(1, Math.max(0, k));
  return k * k * (3 - 2 * k);
}

// 顔の近くに来るスマホ（乗換案内の画面。中身は架空）
function makePhone() {
  const W = 256, H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.074, 0.152, 0.009), new THREE.MeshLambertMaterial({ color: 0x1c1c1e }));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.138), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.position.z = 0.0048;
  group.add(body, screen);
  let off = 0;
  let acc = 0;
  const F = '"Noto Sans JP","Noto Sans CJK JP","Hiragino Sans","Yu Gothic",sans-serif';
  const draw = () => {
    c.fillStyle = '#f5f6f8';
    c.fillRect(0, 0, W, H);
    // 下のリスト（ゆっくりスクロール）
    const rows = ['自宅 → 自宅', '自宅 → 自宅', '自宅 → 自宅', '自宅 → 自宅'];
    for (let i = 0; i < 8; i++) {
      const y = 200 + i * 76 - (off % 76);
      c.fillStyle = '#fff';
      c.fillRect(10, y, W - 20, 66);
      c.fillStyle = '#222';
      c.font = `700 22px ${F}`;
      c.textAlign = 'left';
      c.fillText(rows[i % rows.length], 22, y + 28);
      c.fillStyle = '#d33';
      c.font = `500 17px ${F}`;
      c.fillText('運転見合わせ', 22, y + 54);
      c.fillStyle = '#888';
      c.textAlign = 'right';
      c.fillText('所要 —分', W - 22, y + 54);
    }
    // 上の固定部分
    c.fillStyle = '#1f6fd1';
    c.fillRect(0, 0, W, 62);
    c.fillStyle = '#fff';
    c.font = `700 24px ${F}`;
    c.textAlign = 'center';
    c.fillText('乗換案内', W / 2, 40);
    c.fillStyle = '#fff';
    c.fillRect(0, 62, W, 130);
    c.fillStyle = '#111';
    c.font = `900 34px ${F}`;
    c.fillText('自宅 → 自宅', W / 2, 112);
    c.fillStyle = '#d33';
    c.font = `700 20px ${F}`;
    c.fillText('到着時刻：未定', W / 2, 150);
    c.fillStyle = '#777';
    c.font = `500 15px ${F}`;
    c.fillText('乗換 ∞回', W / 2, 176);
    tex.needsUpdate = true;
  };
  draw();
  return {
    group,
    scroll(dt) {
      acc += dt;
      if (acc < 0.1) return;
      off += acc * 25;
      acc = 0;
      draw();
    },
  };
}
