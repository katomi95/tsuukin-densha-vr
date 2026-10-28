// 開始前の設定。ブラウザに保存して次回も同じ値で始める（保存できない環境でも動く）。
const KEY = 'tsuukin-densha-vr-settings-v1';

// 混み具合。c：各段階で乗ってくる人数、minR：いちばん近くに立つ人までの距離（m）
// back：目の前に立つ人（後頭部）までの距離、phone：顔の近くに来るスマホまでの距離
export const CROWD = {
  light: { label: 'ほどほど', c: [4, 5, 6], minR: 0.75, back: 0.78, phone: 0.5 },
  normal: { label: '満員', c: [5, 8, 10], minR: 0.56, back: 0.6, phone: 0.42 },
  packed: { label: '超満員', c: [6, 11, 15], minR: 0.5, back: 0.54, phone: 0.38 },
};

// 部屋の広さ。R：乗客や吊り革を置く範囲の半径（最初に立った位置から）
export const ROOM = {
  small: { label: 'せまい', R: 1.6 },
  normal: { label: 'ふつう', R: 2.2 },
  large: { label: 'ひろい', R: 2.8 },
};

export const DEFAULTS = {
  crowd: 'normal',
  room: 'normal',
  volume: 0.8,
  voice: true,
};

export function clampSettings(s) {
  if (!CROWD[s.crowd]) s.crowd = DEFAULTS.crowd;
  if (!ROOM[s.room]) s.room = DEFAULTS.room;
  s.volume = Number.isFinite(+s.volume) ? Math.min(1, Math.max(0, +s.volume)) : DEFAULTS.volume;
  s.voice = !!s.voice;
  return s;
}

export function loadSettings() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
  } catch (e) {
    saved = {};
  }
  return clampSettings({ ...DEFAULTS, ...saved });
}

export function saveSettings(s) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {
    // 保存できなくても体験はできる
  }
}
