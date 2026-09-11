/* TTS 工具（D005：每个场景遍数可配置；D006：女声/男声可选）
 * 兜底方案：浏览器 TTS（webkitSpeechSynthesis / speechSynthesis）
 * 慢速通过 rate 实现
 * 跨设备：iOS Safari 首次需要用户手势激活
 * D005：playRepeat 统一所有场景的 N 遍播放
 * D006：pickVoice(gender, lang) 按名称启发式选女声/男声，无法确定时回退系统默认
 */

const TTS = {
  ready: false,
  voices: { en: [], zh: [] },
  preferred: { en: null, zh: null },

  // D006：常见女声/男声关键字（覆盖中英文主流 TTS 引擎）
  FEMALE_HINTS: [
    'female', 'woman', 'girl', 'samantha', 'victoria', 'karen', 'moira', 'tessa',
    'fiona', 'kathy', 'sara', 'ava', 'allison', 'susan', 'vicki', 'paulina',
    'tingting', 'yating', 'xiaoxiao', 'xiaoyi', 'xiaoyou', 'xiaomeng', 'yunxi',
    'yunyang', '晓晓', '晓伊', '晓悠', '晓梦', '云希', '云扬'
  ],
  MALE_HINTS: [
    'male', 'man', 'boy', 'daniel', 'alex', 'fred', 'tom', 'david', 'mark',
    'aaron', 'oliver', 'rishi', 'liam', 'guy', 'russell', 'gordon',
    'kangkang', 'yunhao', '云浩', '云健', '云枫'
  ],

  init() {
    if (this.ready) return;
    if (!('speechSynthesis' in window)) {
      console.warn('[TTS] 当前浏览器不支持 Web Speech API');
      return;
    }
    const load = () => {
      const all = speechSynthesis.getVoices();
      if (!all.length) return;
      this.voices.en = all.filter(v => v.lang.startsWith('en'));
      this.voices.zh = all.filter(v => v.lang.startsWith('zh'));
      this.preferred.en = this.voices.en[0] || null;
      this.preferred.zh = this.voices.zh[0] || null;
      this.ready = true;
    };
    load();
    speechSynthesis.onvoiceschanged = load;
  },

  /* D006：判断一条 voice 是不是女声/男声（按 name 启发式） */
  isFemale(voice) {
    if (!voice) return false;
    const n = (voice.name + ' ' + (voice.voiceURI || '')).toLowerCase();
    return this.FEMALE_HINTS.some(h => n.includes(h.toLowerCase()));
  },
  isMale(voice) {
    if (!voice) return false;
    const n = (voice.name + ' ' + (voice.voiceURI || '')).toLowerCase();
    return this.MALE_HINTS.some(h => n.includes(h.toLowerCase()));
  },

  /* D006：按性别从某语种列表中选一个 voice
   *   gender: 'female' | 'male' | 'auto'
   *   lang:   'en' | 'zh'
   * 找不到匹配时回退到该语种第一个 voice
   */
  pickVoice(gender = 'female', lang = 'en') {
    const list = this.voices[lang] || [];
    if (!list.length) return null;
    if (gender === 'auto' || !gender) {
      return this.preferred[lang] || list[0];
    }
    const filter = gender === 'female' ? v => this.isFemale(v) : v => this.isMale(v);
    const matched = list.find(filter);
    if (matched) return matched;
    return this.preferred[lang] || list[0];
  },

  speak(text, { lang = 'en', rate = 0.85, pitch = 1, voice = null, gender = 'female', onend } = {}) {
    if (!('speechSynthesis' in window)) {
      onend && onend();
      return;
    }
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang === 'en' ? 'en-US' : 'zh-CN';
    u.rate = rate;
    u.pitch = pitch;
    let v = voice;
    if (!v) v = this.pickVoice(gender, lang);
    if (v) u.voice = v;
    // 找不到匹配 voice 时，靠 pitch 兜底
    if (!v && typeof u.pitch === 'number') {
      u.pitch = gender === 'female' ? 1.15 : (gender === 'male' ? 0.85 : 1);
    }
    if (onend) u.onend = onend;
    speechSynthesis.speak(u);
  },

  stop() {
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  },

  /* D005：N 遍重复播放（onend 串联，不用 setTimeout 估算）
   * options:
   *   times  - 重复次数，默认 1
   *   gapMs  - 两次之间的停顿毫秒，默认 600
   *   lang/rate/pitch/voice/gender - 同 speak
   *   onProgress(i) - 第 i 次开始时回调（i 从 1 开始）
   *   onComplete - 全部完成
   */
  playRepeat(text, {
    times = 1,
    gapMs = 600,
    lang = 'en',
    rate = 0.9,
    pitch = 1,
    voice = null,
    gender = 'female',
    onProgress,
    onComplete
  } = {}) {
    if (!('speechSynthesis' in window)) {
      onComplete && onComplete();
      return;
    }
    if (times < 1) times = 1;
    let i = 0;
    const next = () => {
      if (i >= times) {
        onComplete && onComplete();
        return;
      }
      i++;
      onProgress && onProgress(i);
      this.speak(text, { lang, rate, pitch, voice, gender, onend: () => {
        if (i < times) {
          setTimeout(next, gapMs);
        } else {
          onComplete && onComplete();
        }
      }});
    };
    next();
  },

  /* 听写专用：连读 + （可选）分段慢读
   * dictationTimes - 连读次数
   * twoPhase - true = 连读完后停顿再慢速分段；false = 只连读
   * syllables - 分段数组
   */
  playDictation(word, syllables, { times = 2, twoPhase = true, gender = 'female', onComplete } = {}) {
    if (!('speechSynthesis' in window)) {
      onComplete && onComplete();
      return;
    }
    let syllableIdx = 0;
    const playSyllablePhase = (onDone) => {
      if (!twoPhase || !syllables || !syllables.length) {
        onDone && onDone();
        return;
      }
      const nextSyl = () => {
        if (syllableIdx >= syllables.length) {
          onDone && onDone();
          return;
        }
        const s = syllables[syllableIdx++];
        this.speak(s, { lang: 'en', rate: 0.65, gender, onend: () => {
          setTimeout(nextSyl, 200);
        }});
      };
      setTimeout(nextSyl, 600);
    };
    this.playRepeat(word, { times, gapMs: 800, lang: 'en', rate: 0.9, gender, onComplete: () => {
      playSyllablePhase(onComplete);
    }});
  },

  /* 分段逐个播放一个词的音节
   * syllables: ['syl-1', 'syl-2', ...]
   * onSegment(seg, idx) - 每段开始时回调（seg=null 表示一组播完）
   * options.gapMs  - 段间停顿，默认 200
   * options.rate   - 段语速，默认 0.65
   * options.gender - 性别，默认 'female'
   */
  playSyllables(syllables, onSegment, { gapMs = 200, rate = 0.65, gender = 'female' } = {}) {
    if (!('speechSynthesis' in window)) {
      onSegment && onSegment(null, -1);
      return;
    }
    if (!syllables || !syllables.length) {
      onSegment && onSegment(null, -1);
      return;
    }
    let i = 0;
    const next = () => {
      if (i >= syllables.length) {
        onSegment && onSegment(null, i);
        return;
      }
      const s = syllables[i];
      onSegment && onSegment(s, i);
      this.speak(s, { lang: 'en', rate, gender, onend: () => {
        setTimeout(next, gapMs);
      }});
      i++;
    };
    next();
  }
};

window.TTS = TTS;
TTS.init();
