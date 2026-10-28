// 車内アナウンスの声。VOICEVOX（No.7・アナウンス）で作った音声ファイルを WebAudio で鳴らす。
// 端末の音声合成（speechSynthesis）は Quest Browser では日本語の声が無く鳴らないため使わない。
// ファイルは voice/<key>.wav。読み込めなかった声は黙る（チャイムと電光掲示の文字は出る）。
export const VOICE_KEYS = [
  'manin', 'next', 'next2', 'delay1', 'delay2', 'delay3', 'brake', 'manner',
  'endless1', 'endless2', 'endless3', 'shuuten', 'shihatsu',
];

export class Announcer {
  constructor(audio) {
    this.audio = audio;
    this.buffers = new Map();
    this.enabled = true;
    this.silent = false; // 早送り中は黙る
    this.loading = null;
    this.playing = [];
  }

  // AudioContext ができてから呼ぶ（何度呼んでもよい）
  load() {
    if (this.loading || !this.audio.ctx) return this.loading;
    const ctx = this.audio.ctx;
    this.loading = Promise.all(VOICE_KEYS.map(async (k) => {
      try {
        const res = await fetch(`voice/${k}.wav`);
        if (!res.ok) throw new Error(res.status);
        const data = await res.arrayBuffer();
        const buf = await new Promise((ok, ng) => ctx.decodeAudioData(data, ok, ng));
        this.buffers.set(k, buf);
      } catch (e) {
        console.warn('アナウンスを読み込めませんでした', k, e);
      }
    }));
    return this.loading;
  }

  // 秒。まだ読み込めていなければ null
  duration(key) {
    const b = this.buffers.get(key);
    return b ? b.duration : null;
  }

  say(key) {
    if (!this.enabled || this.silent) return false;
    const b = this.buffers.get(key);
    if (!b) return false;
    const src = this.audio.playVoice(b);
    if (!src) return false;
    this.playing.push(src);
    src.onended = () => { this.playing = this.playing.filter((s) => s !== src); };
    return true;
  }

  cancel() {
    for (const s of this.playing) {
      try { s.stop(); } catch (e) { /* 止まっている */ }
    }
    this.playing = [];
  }
}
