// 車内アナウンスの声。端末に入っている日本語の音声合成（Web Speech API）で読み上げる。
// 録音した声や実在の鉄道会社の放送は使わない。日本語の音声が無い環境では黙る
// （そのときも、チャイムと車内案内表示の文字でアナウンスは伝わる）。
export class Announcer {
  constructor() {
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    this.voice = null;
    this.enabled = true;
    this.silent = false; // 早送り中は黙る
    this.volume = 0.8;
    this._ready = this.supported ? this._findVoice() : Promise.resolve(null);
  }

  _findVoice() {
    return new Promise((resolve) => {
      const pick = () => {
        const list = window.speechSynthesis.getVoices() || [];
        const ja = list.filter((v) => /^ja(-|_|$)/i.test(v.lang));
        if (!ja.length) return null;
        // 自動放送らしく、落ち着いた女性の声があれば優先
        return ja.find((v) => /Kyoko|Haruka|Nanami|Ayumi|Sayaka|female|女性/i.test(v.name)) || ja[0];
      };
      let v = pick();
      if (v) {
        this.voice = v;
        resolve(v);
        return;
      }
      const done = () => {
        v = pick();
        if (v) {
          this.voice = v;
          window.speechSynthesis.removeEventListener('voiceschanged', done);
          resolve(v);
        }
      };
      window.speechSynthesis.addEventListener('voiceschanged', done);
      setTimeout(() => {
        window.speechSynthesis.removeEventListener('voiceschanged', done);
        if (!this.voice) this.voice = pick();
        resolve(this.voice);
      }, 2500);
    });
  }

  // 'ok' | 'no-api' | 'no-ja'
  async status() {
    if (!this.supported) return 'no-api';
    await this._ready;
    return this.voice ? 'ok' : 'no-ja';
  }

  get available() {
    return this.enabled && !this.silent && !!this.voice;
  }

  say(text) {
    if (!this.available) return false;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = this.voice;
      u.lang = this.voice.lang;
      u.rate = 0.9;
      u.pitch = 1.0;
      u.volume = Math.min(1, this.volume);
      window.speechSynthesis.speak(u);
      return true;
    } catch (e) {
      return false;
    }
  }

  cancel() {
    if (!this.supported) return;
    try {
      window.speechSynthesis.cancel();
    } catch (e) {
      // 何もしない
    }
  }
}
