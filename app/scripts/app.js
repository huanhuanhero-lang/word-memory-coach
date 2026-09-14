/* 单词记忆教练｜主应用入口
 * 路由：基于 hash 的极简 SPA
 *   #/            首页
 *   #/card/:id    记忆教练卡
 *   #/dictation/:id  听写
 *   #/wrong       错词本
 *   #/record      学习记录
 *   #/settings    家长配置
 */

const App = {
  currentWordId: null,

  async init() {
    this.checkFirstRun();
    this.bindGlobal();
    this.render();
    window.addEventListener('hashchange', () => this.render());
  },

  /* 首次使用：数据存本机告知（D003 验收）+ 选择学校当前单元 */
  checkFirstRun() {
    const seen = localStorage.getItem('wordcoach.firstrun.seen');
    if (seen) return;
    setTimeout(() => {
      this.showModal({
        title: '欢迎使用单词记忆教练 👋',
        body: `
          <div class="notice">
            <strong>📦 你的数据存在本机浏览器</strong><br>
            ① 不会上传到任何服务器（保护孩子隐私）<br>
            ② 换设备/清缓存会丢数据<br>
            ③ 建议家长每周在【设置】里点"导出备份"
          </div>
          <div class="field">
            <label>给孩子起个昵称（仅本机显示）</label>
            <input id="firstrun-name" placeholder="例如：轩轩" value="我的孩子">
          </div>
          <div class="field">
            <label>👋 你家孩子学校<strong>当前学到</strong>第几单元？</label>
            <div class="unit-grid" id="firstrun-units">
              ${this.UNIT_IDS.map(id => `
                <button type="button" class="unit-chip" data-pick-unit="${id}">
                  ${id <= 3 ? 'Starter U' + id : 'Unit ' + (id - 3)}
                </button>
              `).join('')}
            </div>
            <p style="font-size:12px;color:var(--c-text-soft);margin-top:4px">
              不知道？先选 Starter U1 也行，进首页底部「📖 切换单元」随时可改。
            </p>
          </div>
        `,
        actions: [
          { text: '开始使用', primary: true, onClick: () => {
            const v = document.getElementById('firstrun-name').value.trim() || '我的孩子';
            const picked = this._firstRunUnit || 1;
            Store.updateCurrentProfile(p => {
              p.name = v;
              p.settings = { ...(p.settings || {}), current_unit: picked };
              return p;
            });
            localStorage.setItem('wordcoach.firstrun.seen', '1');
            this._firstRunUnit = null;
            this.invalidateWordsCache();
            this.closeModal();
            this.render();
          }}
        ]
      });
      this._bindFirstRunUnitPicker();
    }, 200);
  },

  _bindFirstRunUnitPicker() {
    const root = document.getElementById('firstrun-units');
    if (!root) return;
    root.addEventListener('click', (e) => {
      const t = e.target.closest('[data-pick-unit]');
      if (!t) return;
      const id = parseInt(t.getAttribute('data-pick-unit'));
      this._firstRunUnit = id;
      root.querySelectorAll('.unit-chip').forEach(el => el.classList.remove('active'));
      t.classList.add('active');
    });
  },

  bindGlobal() {
    document.addEventListener('click', (e) => {
      if (e.target.closest('.modal-mask') || e.target.closest('#global-modal')) {
        return;
      }
      const t = e.target.closest('[data-link]');
      if (t) {
        e.preventDefault();
        location.hash = t.getAttribute('data-link');
      }
      const a = e.target.closest('[data-action]');
      if (a) {
        const action = a.getAttribute('data-action');
        if (this.actions[action]) this.actions[action](a);
      }
    });
  },

  /* 路由分发 */
  async render() {
    const hash = location.hash.slice(1) || '/';
    const app = document.getElementById('app');
    TTS.stop();
    if (hash === '/' || hash === '') {
      this.renderHome(app);
    } else if (hash === '/today') {
      this.renderToday(app);
    } else if (hash.startsWith('/card/')) {
      this.currentWordId = hash.split('/')[2];
      this.renderCard(app, this.currentWordId);
    } else if (hash.startsWith('/dictation/')) {
      this.currentWordId = hash.split('/')[2];
      this.renderDictation(app, this.currentWordId);
    } else if (hash.startsWith('/dictation-batch/')) {
      const unitId = hash.split('/')[2];
      this.renderDictationBatch(app, parseInt(unitId));
    } else if (hash === '/wrong') {
      this.renderWrong(app);
    } else if (hash === '/record') {
      this.renderRecord(app);
    } else if (hash === '/settings') {
      this.renderSettings(app);
    } else {
      app.innerHTML = '<div class="card">页面不存在</div>';
    }
    this.renderProfileChip();
  },

  renderProfileChip() {
    const chip = document.getElementById('profile-chip');
    if (!chip) return;
    const p = Store.getCurrentProfile();
    chip.textContent = `👤 ${p.name}`;
  },

  /* ============ 首页 ============ */
  async renderHome(root) {
    const profile = Store.getCurrentProfile();
    const currentUnit = profile.settings.current_unit || 1;
    const data = await this.loadWords(currentUnit);
    const today = this.getPriorityQueue(data, await this.loadAllUnits(), profile);

    const unitName = data.meta?.unit || `Unit ${currentUnit}`;

    root.innerHTML = `
      <div class="home-hero">
        <div class="home-logo">🦊</div>
        <div class="home-title">单词记忆教练</div>
        <div class="home-today">今日 · ${today.length} 词</div>
        <button class="btn home-cta" data-link="/today">开始学习 🚀</button>
        <div class="home-subline">当前：${unitName} (${currentUnit}/10)</div>
      </div>
    `;
  },

  /* ============ 今日计划页 ============
   * 大数字展示今日总词数、新词/复习拆分、预计时长
   * 列出每个词的概要（单词 + 角标 + 含义）
   * CTA：开始学习第 1 词（学完后跳下一个，学完最后 1 词 → 跳批量听写） */
  async renderToday(root) {
    const profile = Store.getCurrentProfile();
    const seen = profile.words_state || {};
    const currentUnit = profile.settings.current_unit || 1;
    const data = await this.loadWords(currentUnit);
    const all = await this.loadAllUnits();
    const today = this.getPriorityQueue(data, all, profile);

    const unitName = data.meta?.unit || `Unit ${currentUnit}`;
    const total = today.length;
    const reviewCount = today.filter(w => w._studyType === 'review').length;
    const newCount = total - reviewCount;
    const minutes = total * 3;
    const dictQueue = this.getDictationQueue(data, profile, 5);

    if (total === 0) {
      root.innerHTML = `
        <div class="app-header">
          <div class="app-title">🎯 今日计划</div>
          <div class="app-profile" data-link="/">← 返回</div>
        </div>
        <div class="card">
          <div class="notice" style="background:#e8f5e9;border-left-color:var(--c-success);color:#1b5e20">
            🎉 <strong>${unitName}</strong> 全部学完啦！<br>
            <span style="font-size:13px">可以去「错词本」巩固，或在首页切到下一单元继续。</span>
          </div>
        </div>
      `;
      return;
    }

    root.innerHTML = `
      <div class="app-header">
        <div class="app-title">🎯 今日计划</div>
        <div class="app-profile" data-link="/">← 返回</div>
      </div>

      <div class="card" style="text-align:center;background:linear-gradient(135deg,#fff5e8 0%,#ffeed8 100%)">
        <div style="font-size:13px;color:var(--c-text-soft)">${unitName}</div>
        <div style="font-size:64px;font-weight:800;color:var(--c-primary);line-height:1.1;margin:8px 0">${total}<span style="font-size:24px;color:var(--c-text-soft);font-weight:600"> 个单词</span></div>
        <div style="display:flex;justify-content:center;gap:24px;font-size:14px;margin-top:8px">
          <span>🆕 <strong>${newCount}</strong> 新词</span>
          ${reviewCount > 0 ? `<span>🔁 <strong>${reviewCount}</strong> 复习</span>` : ''}
          <span>⏱ <strong>${minutes}</strong> 分钟</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">📝 今天要学的词</div>
        <p class="card-subtitle">按计划一个个学，每个词走完 9 步教练流程。学完后统一听写。</p>
        <div class="word-list">
          ${today.map((w, i) => `
            <li>
              <span>
                <span class="word-text">${i + 1}. ${w.word}</span>
                ${w._studyType === 'review'
                  ? '<span class="review-badge" style="margin-left:6px">🔁 复习</span>'
                  : (w.importance === 'key'
                      ? '<span class="importance-badge key" style="margin-left:6px">⭐</span>'
                      : '<span class="importance-badge normal" style="margin-left:6px">·</span>')}
              </span>
              <span class="word-meta">${w.meaning_zh}</span>
            </li>
          `).join('')}
        </div>
      </div>

      <button class="btn btn-block" data-link="/card/${today[0].id}">开始学习第 1 个 🚀</button>

      ${dictQueue.length > 0 ? `
        <div class="card" style="margin-top:16px;text-align:center">
          <div class="card-title" style="font-size:14px">✍️ 学完统一听写</div>
          <p class="card-subtitle">${dictQueue.length} 个 ⭐必会词已就绪。听写在全部单词学完后进行。</p>
          <button class="btn btn-ghost" data-link="/dictation-batch/${currentUnit}">提前开始听写</button>
        </div>
      ` : ''}
    `;
  },

  switchUnit(el) {
    // 已迁移至 actions.switchUnit（必须在 actions 字典里才能被全局 click 事件派发）
    if (window.__appDebug) console.warn('App.switchUnit 已废弃，请使用 actions.switchUnit');
  },

  /* D010：优先级队列 —— 候选池生词+复习词 → priority 公式 → 穿插规则
   * 替换 D008 的 getTodayWordQueue（保留作为兼容别名） */
  getPriorityQueue(data, all, profile) {
    const target = profile.settings.daily_words || 5;
    const seen = profile.words_state || {};
    const MAX_REVIEW = 2; // 复习词硬上限（D010）

    /* 候选池：当前 unit 未 seen 生词 + 跨 unit 已 seen 复习词 */
    const newWords = data.words
      .filter(w => !seen[w.id])
      .map(w => ({ ...w, _studyType: 'new', _priority: this.calcPriority(w, seen) }));

    const reviewPool = (all ? all.allWords : data.words)
      .filter(w => seen[w.id])
      .map(w => ({ ...w, _studyType: 'review', _priority: this.calcPriority(w, seen) }));

    /* 按 priority 倒序 */
    newWords.sort((a, b) => b._priority - a._priority);
    reviewPool.sort((a, b) => b._priority - a._priority);

    /* 穿插：取复习词 ≤ 2，余下补生词 */
    const result = [];
    const reviewTake = Math.min(MAX_REVIEW, reviewPool.length, target);
    result.push(...reviewPool.slice(0, reviewTake));
    result.push(...newWords.slice(0, target - reviewTake));

    return result.slice(0, target);
  },

  /* D010 priority 公式 */
  calcPriority(word, seen) {
    const s = seen[word.id] || {};
    let p = 0;
    p += (s.dictation_errors || 0) * 2;
    p += (s.recall_errors || 0) * 1.5;
    if (word.importance === 'key') p += 1;
    if (s.last_status === 'master') p -= 1;
    if (s.last_seen) {
      const days = (Date.now() - new Date(s.last_seen).getTime()) / 86400000;
      p += Math.min(days / 7, 2);
    } else {
      p += 0.5; // 新词基础分
    }
    return p;
  },

  /* D008 兼容：保留旧 API（首页/历史引用） */
  getTodayWordQueue(data, profile) {
    return this.getPriorityQueue(data, null, profile);
  },

  /* 跨所有 unit 的待复习词（D008：key 词优先 + last_seen 倒序） */
  getCrossUnitReviewQueue(allWords, profile, limit) {
    const seen = profile.words_state || {};
    return allWords
      .filter(w => seen[w.id] && seen[w.id].last_seen)
      .sort((a, b) => {
        const ak = a.importance === 'key' ? 0 : 1;
        const bk = b.importance === 'key' ? 0 : 1;
        if (ak !== bk) return ak - bk;
        return (seen[b.id].last_seen || '').localeCompare(seen[a.id].last_seen || '');
      })
      .slice(0, limit);
  },

  /* D008：只取 key 词的听写队列（当前 unit） */
  getDictationQueue(data, profile, limit) {
    const seen = profile.words_state || {};
    return data.words
      .filter(w => w.importance === 'key' && seen[w.id])
      .sort((a, b) => (seen[b.id].last_seen || '').localeCompare(seen[a.id].last_seen || ''))
      .slice(0, limit || 5);
  },

  /* ============ 记忆教练卡 ============ */
  async renderCard(root, wordId) {
    const all = await this.loadAllUnits();
    const word = all.allWords.find(w => w.id === wordId);
    if (!word) { root.innerHTML = '<div class="card">单词不存在</div>'; return; }
    this._viewedWord = word;
    this._dictWord = null;

    /* 用 today 队列填充 _currentQueue，让 stepDictationGate 知道下一个词是谁 */
    if (!App._currentQueue || !App._currentQueue.find(w => w.id === wordId)) {
      const profile = Store.getCurrentProfile();
      const currentUnit = profile.settings.current_unit || 1;
      const data = await this.loadWords(currentUnit);
      App._currentQueue = App.getPriorityQueue(data, App._lastAllUnits, profile);
    }

    const steps = ['听音', '跟读', '分段', '归位', '找特位', '合成', '主动回忆', '听写前跟读', '听写'];
    /* D010：复习词走 3 步快速通道（听音→主动回忆→听写），跳过精细加工 */
    const isReview = word._studyType === 'review';
    if (isReview) {
      steps.length = 0;
      steps.push('听音', '主动回忆', '听写前跟读', '听写');
    }
    /* D008：importance 角标 */
    const isKey = word.importance === 'key';
    const importanceBadge = isKey
      ? '<span class="importance-badge key">⭐ 必会</span>'
      : '<span class="importance-badge normal">· 了解</span>';
    const reviewBadge = isReview
      ? '<span class="review-badge">🔁 复习（快速通道）</span>'
      : '';
    const channelTip = isReview
      ? '<span class="importance-tip">跳过跟读/分段/归位/找特位/合成，直接检测记忆</span>'
      : (isKey ? '<span class="importance-tip">本词将进入听写环节</span>' : '<span class="importance-tip">本词只走 7 步，跳过听写</span>');
    root.innerHTML = `
      <div class="app-header">
        <div class="app-title">记忆教练卡</div>
        <div class="app-profile" data-link="/">← 返回</div>
      </div>

      <div class="importance-row">${reviewBadge} ${importanceBadge} ${channelTip}</div>

      <div class="steps" id="steps">
        ${steps.map((s, i) => `<div class="step ${i === 0 ? 'active' : ''}" data-step="${i}">${i+1}. ${s}</div>`).join('')}
      </div>

      <div id="step-content"></div>
    `;

    let currentStep = 0;
    const renderStep = (idx) => {
      document.querySelectorAll('#steps .step').forEach((el, i) => {
        el.classList.remove('active', 'done');
        if (i < idx) el.classList.add('done');
        if (i === idx) el.classList.add('active');
      });
      const c = document.getElementById('step-content');
      /* D010/D012：handler 数组按当前 steps（生词 9 步 / 复习 4 步）动态映射 */
      const handlers = [
        () => this.stepHear(c, word),
        () => this.stepFollow(c, word),
        () => this.stepSyllable(c, word),
        () => this.stepPhoneme(c, word),
        () => this.stepSpecial(c, word),
        () => this.stepCombine(c, word),
        () => this.stepRecall(c, word),
        () => this.stepPreDictationFollow(c, word),
        () => this.stepDictationGate(c, word)
      ];
      /* 复习词用快速通道映射（4 步） */
      const reviewHandlers = [
        () => this.stepHear(c, word),
        () => this.stepRecall(c, word),
        () => this.stepPreDictationFollow(c, word),
        () => this.stepDictationGate(c, word)
      ];
      (isReview ? reviewHandlers : handlers)[idx]();
    };
    window._nextStep = () => {
      if (currentStep < steps.length - 1) {
        currentStep++;
        renderStep(currentStep);
      } else {
        location.hash = '/';
      }
    };
    renderStep(0);
  },

  stepHear(root, word) {
    const repeat = Store.getCurrentProfile().settings.repeat || {};
    const earN = repeat.ear || 1;
    const exampleN = repeat.example || 1;
    root.innerHTML = `
      <div class="card">
        <div class="card-title">第 1 步｜听音</div>
        <div class="word-hero">
          <div class="word">${word.word}</div>
          <div class="ipa">${word.ipa}</div>
          <div class="meaning">${word.meaning_zh}（${word.pos}）</div>
        </div>
        <div class="dictation-controls">
          <button class="btn" data-action="playWord" data-kind="ear">🔊 听单词 ${earN > 1 ? `<span class="badge-times">× ${earN}</span>` : ''}</button>
          <button class="btn btn-ghost" data-action="playWord" data-kind="example">听例句 ${exampleN > 1 ? `<span class="badge-times">× ${exampleN}</span>` : ''}</button>
        </div>
        <p class="dictation-tip" style="margin-top:16px">仔细听发音和重音。${earN > 1 ? '本词将自动播 ' + earN + ' 遍。' : ''}不要急着看拼写。</p>
        <button class="btn btn-block" data-action="nextStep" style="margin-top:16px">听够了，下一步 →</button>
      </div>
    `;
  },

  stepFollow(root, word) {
    const repeat = Store.getCurrentProfile().settings.repeat || {};
    const followN = repeat.follow || 2;
    root.innerHTML = `
      <div class="card">
        <div class="card-title">第 2 步｜跟读</div>
        <div class="word-hero">
          <div class="word">${word.word}</div>
          <div class="meaning">${word.meaning_zh}</div>
        </div>
        <div class="dictation-controls">
          <button class="btn" data-action="playWord" data-kind="follow">🔊 跟读 ${followN > 1 ? `<span class="badge-times">× ${followN}</span>` : ''}</button>
        </div>
        <p class="dictation-tip" style="margin-top:16px">大声跟读，注意嘴型和重音位置。${followN > 1 ? '本词会自动播 ' + followN + ' 遍，第 2 遍开始跟读。' : ''}</p>
        <button class="btn btn-block" data-action="nextStep" style="margin-top:16px">跟读完成，下一步 →</button>
      </div>
    `;
  },

  stepSyllable(root, word) {
    const repeat = Store.getCurrentProfile().settings.repeat || {};
    const syllableN = repeat.syllable || 1;
    root.innerHTML = `
      <div class="card">
        <div class="card-title">第 3 步｜分段</div>
        <p class="card-subtitle">把单词拆成几段来记。点击每段听发音。</p>
        <div class="word-hero">
          <div class="word" style="font-size:32px">${word.word}</div>
        </div>
        <div class="syllables" id="syllables">
          ${word.syllables.map((s, i) => `<div class="syllable" data-idx="${i}">${s}</div>`).join('')}
        </div>
        <div class="dictation-controls">
          <button class="btn" data-action="playSyllableLoop">▶️ 逐段播放 ${syllableN > 1 ? `<span class="badge-times">× ${syllableN}</span>` : ''}</button>
        </div>
        <p class="dictation-tip" style="margin-top:12px">点击单个段可重复听那一段。</p>
        <button class="btn btn-block" data-action="nextStep" style="margin-top:16px">分段记住，下一步 →</button>
      </div>
    `;
    root.querySelectorAll('.syllable').forEach(el => {
      el.addEventListener('click', () => {
        root.querySelectorAll('.syllable').forEach(s => s.classList.remove('playing'));
        el.classList.add('playing');
        const gender = (Store.getCurrentProfile().settings || {}).tts_gender || 'female';
        TTS.speak(word.syllables[+el.dataset.idx], { rate: 0.65, lang: 'en', gender });
        setTimeout(() => el.classList.remove('playing'), 1000);
      });
    });
  },

  stepPhoneme(root, word) {
    root.innerHTML = `
      <div class="card">
        <div class="card-title">第 4 步｜音形对应（归位）</div>
        <p class="card-subtitle">每段声音对应哪些字母？</p>
        ${word.phoneme_map.map(p => `
          <div style="margin-bottom:12px">
            <div class="phoneme-row">
              <div class="phoneme">
                <div class="letters">${p.letters}</div>
                <div class="sound">${p.sound}</div>
              </div>
            </div>
            <p style="font-size:13px;color:var(--c-text-soft);text-align:center;margin-top:4px">${p.tip}</p>
          </div>
        `).join('')}
        <button class="btn btn-block" data-action="nextStep" style="margin-top:16px">记住了，下一步 →</button>
      </div>
    `;
  },

  stepSpecial(root, word) {
    root.innerHTML = `
      <div class="card">
        <div class="card-title">第 5 步｜找特位</div>
        <p class="card-subtitle">这个单词容易写错的地方：</p>
        ${(word.special || []).map(s => `
          <div class="special-tip">
            <strong>[${s.type}]</strong> ${s.text}
          </div>
        `).join('') || '<p class="dictation-tip">这个单词没有特别易错的地方。</p>'}
        <div class="dictation-controls" style="margin-top:16px">
          <button class="btn btn-ghost" data-action="playSlowWord">🐢 慢速再听</button>
        </div>
        <button class="btn btn-block" data-action="nextStep" style="margin-top:16px">找到特位，下一步 →</button>
      </div>
    `;
  },

  stepCombine(root, word) {
    const repeat = Store.getCurrentProfile().settings.repeat || {};
    const combineN = repeat.combine || 2;
    root.innerHTML = `
      <div class="card">
        <div class="card-title">第 6 步｜合成</div>
        <p class="card-subtitle">把刚才学的字母和声音合起来：</p>
        <div class="word-hero">
          <div class="word">${word.word}</div>
          <div class="ipa">${word.ipa}</div>
          <div class="meaning">${word.meaning_zh}</div>
        </div>
        <div class="dictation-controls">
          <button class="btn" data-action="playWord" data-kind="combine">🔊 听自己拼 ${combineN > 1 ? `<span class="badge-times">× ${combineN}</span>` : ''}</button>
        </div>
        <p class="dictation-tip" style="margin-top:16px">心里默念每个字母对应的声音，然后合起来读一遍。${combineN > 1 ? '本词会播 ' + combineN + ' 遍。' : ''}</p>
        <button class="btn btn-block" data-action="nextStep" style="margin-top:16px">合成完成，下一步 →</button>
      </div>
    `;
  },

  stepRecall(root, word) {
    root.innerHTML = `
      <div class="card">
        <div class="card-title">第 7 步｜主动回忆</div>
        <p class="card-subtitle">盖住答案，凭记忆拼写：</p>
        <div style="text-align:center;font-size:18px;color:var(--c-text-soft);margin:8px 0">
          ${word.meaning_zh}（${word.pos}）
        </div>
        <div style="text-align:center;font-size:14px;color:var(--c-text-soft);margin-bottom:8px">
          单词长度：<span class="hidden-answer" id="hint-length">${'•'.repeat(word.word.length)}</span>
          <button class="btn btn-sm btn-ghost" data-action="revealHint" style="margin-left:8px">看提示</button>
        </div>
        <input class="recall-input" id="recall-input" placeholder="在这里拼写单词..." autocomplete="off" spellcheck="false">
        <div class="dictation-controls">
          <button class="btn" data-action="checkRecall">✅ 提交</button>
          <button class="btn btn-ghost" data-action="playRecall">🔊 再听</button>
        </div>
        <div id="recall-feedback"></div>
        <p class="dictation-tip" style="margin-top:12px">错了也没关系，写完会自动入错词本 + 听写环节。</p>
      </div>
    `;
    setTimeout(() => document.getElementById('recall-input').focus(), 100);
  },

  /* D012：听写前跟读 —— 把"音→嘴"和"音→手"绑死 */
  stepPreDictationFollow(root, word) {
    const profile = Store.getCurrentProfile();
    const times = (profile.settings.repeat && profile.settings.repeat.dictation) || 1;
    root.innerHTML = `
      <div class="card">
        <div class="card-title">听写前跟读 🎤</div>
        <p class="card-subtitle">听慢速朗读 ${times} 次，然后跟读一遍。</p>
        <div style="text-align:center;font-size:48px;margin:24px 0">${word.word}</div>
        <div class="dictation-tip" style="text-align:center">
          🎧 系统会慢速朗读（语速 0.6）<br>
          🎤 然后你跟读一次
        </div>
        <button class="btn btn-block" data-action="startPreDictationFollow" style="margin-top:16px">▶ 开始跟读</button>
        <div id="pre-dictation-follow-feedback" style="margin-top:12px"></div>
      </div>
    `;
  },

  /* 第 9 步"听写门控"——不再是单词级听写入口
   * 改为：本词学完 → 跳到下一个词 / 全部学完后跳批量听写
   * 听写由用户在全部词学完后手动从"今日计划"页或首页进入
   * D008 兼容性：key 词仍会出现在批量听写队列里 */
  stepDictationGate(root, word) {
    Store.recordStudyLog({ word_id: word.id, word: word.word, study_type: word._studyType || 'new' });
    const isKey = word.importance === 'key';
    const queue = App._currentQueue || [];
    const idx = queue.findIndex(w => w.id === word.id);
    const isLast = idx === -1 || idx >= queue.length - 1;
    const next = isLast ? null : queue[idx + 1];

    let primaryBtn, primaryLink, primaryLabel, ghostBtn, ghostLink, ghostLabel;
    if (isLast) {
      primaryLabel = '全部学完！进入听写 ✍️';
      primaryLink = `/dictation-batch/${Store.getCurrentProfile().settings.current_unit || 1}`;
    } else {
      primaryLabel = `下一个：${next.word} →`;
      primaryLink = `/card/${next.id}`;
    }
    ghostLabel = '返回首页';
    ghostLink = '/';

    root.innerHTML = `
      <div class="card">
        <div class="card-title">🎉 1 个单词学完！</div>
        <p class="card-subtitle">
          ${isKey
            ? '⭐ 必会词 — 听写环节在<strong>全部学完后统一进行</strong>。'
            : '了解词 — 听写不是强制的，但你也可以在批量听写里挑战自己。'}
        </p>
        ${isLast ? `
          <div class="notice" style="background:#e8f5e9;border-left-color:var(--c-success);color:#1b5e20">
            🎉 <strong>今日计划全部完成！</strong><br>
            <span style="font-size:13px">现在统一听写 ${word.importance === 'key' ? '必会词' : '今日所有词'}。</span>
          </div>
        ` : `
          <div class="word-list" style="margin:12px 0">
            <li><span>本次学完</span><span class="badge master">${idx + 1} / ${queue.length}</span></li>
            <li><span>下一个</span><span class="word-text" style="font-size:14px">${next.word}</span></li>
          </div>
        `}
        <button class="btn btn-block" data-link="${primaryLink}" style="margin-top:16px">${primaryLabel}</button>
        <button class="btn btn-ghost btn-block" data-link="${ghostLink}" style="margin-top:8px">${ghostLabel}</button>
      </div>
    `;
  },

  /* ============ 听写页面（D001） ============ */
  /* ============ 批量听写（D011 简化：去掉拍照，纯列表 + 勾选） ============ */

  /* 批量听写：N 词 TTS 连读 + 提交前展示列表供勾选
   * 流程：当前 unit 全部 key 词（已 seen）→ 2 段式 TTS 朗读 → 列表逐词勾选 ✓/✗ → 提交
   * 拍照/OCR 留 v0.6+ 评估 */
  async renderDictationBatch(root, unitId) {
    const data = await this.loadWords(unitId);
    const profile = Store.getCurrentProfile();
    /* D008：只抽 key 词；已学过的才进听写（未 seen = 还没学） */
    const seen = profile.words_state || {};
    const queue = data.words
      .filter(w => w.importance === 'key' && seen[w.id])
      .map(w => ({ id: w.id, word: w.word, meaning_zh: w.meaning_zh }))
      .slice(0, 5);
    if (queue.length === 0) {
      root.innerHTML = `
        <div class="app-header">
          <div class="app-title">📝 批量听写</div>
          <div class="app-profile" data-link="/">← 返回</div>
        </div>
        <div class="card">
          <div class="card-title">没有可听写的单词</div>
          <p class="card-subtitle">先把今天的新词学完，再来听写吧 😊</p>
        </div>
      `;
      return;
    }
    this._dictQueue = queue;
    this._dictUnit = unitId;
    const settings = profile.settings || {};
    const gender = settings.tts_gender || 'female';
    root.innerHTML = `
      <div class="app-header">
        <div class="app-title">📝 批量听写</div>
        <div class="app-profile" data-link="/">← 返回</div>
      </div>
      <div class="card">
        <div class="card-title">第 1 步 · 听</div>
        <p class="card-subtitle">共 <strong>${queue.length}</strong> 个 ⭐必会词。屏幕不显示单词，靠耳朵听。</p>
        <div class="dictation-tip">
          🎧 <strong>第 1 段：全速连读</strong>（不重复，听清即可）<br>
          🎧 <strong>第 2 段：慢速逐词</strong>（每词读 2 遍）<br>
          📝 听完在第 2 步勾选哪些对、哪些错
        </div>
        <div class="word-list" style="margin:16px 0">
          <li><span>词数</span><span class="badge">${queue.length}</span></li>
          <li><span>预计时长</span><span class="badge">${Math.ceil(queue.length * 0.5)} 分钟</span></li>
        </div>
        <button class="btn btn-block" data-action="playBatchDictation" data-phase="1">▶ 开始听写（全速）</button>
        <button class="btn btn-ghost btn-block" data-action="playBatchDictation" data-phase="2" style="margin-top:8px">⏯ 听第 2 段（慢速）</button>
      </div>
      <div class="card">
        <div class="card-title">第 2 步 · 勾选</div>
        <p class="card-subtitle">听完在下方给每个词打勾 ✓ 或叉 ✗（不勾默认算"对"）。</p>
        <div class="grade-grid">
          ${queue.map((w, i) => `
            <div class="grade-item" data-word-id="${w.id}">
              <div class="grade-word">${i + 1}. ${w.word}</div>
              <div class="grade-meaning">${w.meaning_zh}</div>
              <div class="grade-actions">
                <button class="btn btn-grade correct" data-action="gradeDictation" data-word-id="${w.id}" data-grade="correct">✓ 对</button>
                <button class="btn btn-grade wrong" data-action="gradeDictation" data-word-id="${w.id}" data-grade="wrong">✗ 错</button>
              </div>
            </div>
          `).join('')}
        </div>
        <button class="btn btn-block" data-action="submitDictationGrade" style="margin-top:16px">提交批改</button>
      </div>
    `;
  },

  async renderDictation(root, wordId) {
    const all = await this.loadAllUnits();
    const word = all.allWords.find(w => w.id === wordId);
    if (!word) { root.innerHTML = '<div class="card">单词不存在</div>'; return; }
    this._dictWord = word;

    root.innerHTML = `
      <div class="app-header">
        <div class="app-title">听写环节</div>
        <div class="app-profile" data-link="/">← 返回</div>
      </div>

      <div class="card">
        <div class="dictation-stage">
          <div class="dictation-counter" id="dict-counter">第 <span id="cur">1</span> / <span id="total">1</span> 个</div>
          <p class="dictation-tip">拿起笔，听写完后点"写完了 ✍️"</p>
          <div class="dictation-controls">
            <button class="btn" data-action="playDictation">🔊 开始朗读</button>
            <button class="btn btn-ghost" data-action="replayDictation">↩ 重听</button>
            <button class="btn btn-ghost" data-action="slowDictation">🐢 慢速分段</button>
          </div>
          <div id="dict-feedback"></div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">写完后核对（自评 / 家长勾对）</div>
        <p class="card-subtitle">本机不拍照识别（D001 v0.1 范围），由孩子或家长确认</p>
        <div class="dictation-input">
          <input id="dict-typed" placeholder="把你写的输入到这（用于核对）" autocomplete="off" spellcheck="false">
        </div>
        <div class="dictation-controls">
          <button class="btn" data-action="dictCorrect" style="background:var(--c-success)">✅ 写对了</button>
          <button class="btn" data-action="dictWrong" style="background:var(--c-error)">❌ 写错了</button>
        </div>
        <button class="btn btn-ghost btn-block" data-action="dictSkip" style="margin-top:12px">跳过本词 → 下一张卡</button>
      </div>

      <div class="card" style="display:none" id="dict-done">
        <div class="card-title">🎉 听写完成</div>
        <p class="dictation-tip">已记录本次听写结果，错词会进入错词本并打"听写错"标签。</p>
        <button class="btn btn-block" data-link="/">回到首页</button>
      </div>
    `;

    this._dictWord = word;
  },

  /* ============ 错词本 ============ */
  async renderWrong(root) {
    const all = await this.loadAllUnits();
    const profile = Store.getCurrentProfile();
    const wrongEntries = Object.entries(profile.words_state)
      .filter(([id, w]) => w.last_status === 'wrong' || w.dictation_errors > 0)
      .sort((a, b) => b[1].last_seen.localeCompare(a[1].last_seen));

    root.innerHTML = `
      <div class="app-header">
        <div class="app-title">📕 错词本</div>
        <div class="app-profile" data-link="/">← 返回</div>
      </div>
      ${wrongEntries.length === 0 ? `
        <div class="card">
          <p class="dictation-tip">还没有错词，继续保持！</p>
        </div>
      ` : wrongEntries.map(([id, w]) => {
        const word = all.allWords.find(x => x.id === id);
        if (!word) return '';
        return `
          <div class="wrong-word">
            <div>
              <div class="word-text">${word.word} ${word.importance === 'key' ? '<span class="importance-badge key">⭐</span>' : ''}</div>
              <div class="word-meta">${word.meaning_zh} · ${w.dictation_errors > 0 ? '<span class="badge dictation-err">听写错</span>' : ''} ${w.recall_errors > 0 ? '<span class="badge review">拼错</span>' : ''}</div>
            </div>
            <button class="btn btn-sm" data-link="/card/${word.id}">复习</button>
          </div>
        `;
      }).join('')}
    `;
  },

  /* ============ 学习记录 ============ */
  async renderRecord(root) {
    const profile = Store.getCurrentProfile();
    await this.loadAllUnits();
    root.innerHTML = `
      <div class="app-header">
        <div class="app-title">📈 学习记录</div>
        <div class="app-profile" data-link="/">← 返回</div>
      </div>
      <div class="card">
        <div class="card-title">最近 20 次学习</div>
        ${profile.study_log.length === 0 ? '<p class="dictation-tip">还没有学习记录。</p>' : `
          <ul class="word-list">
            ${profile.study_log.slice(0, 20).map(log => `
              <li>
                <span class="word-text">${log.word}</span>
                <span class="word-meta">${new Date(log.at).toLocaleString('zh-CN')}</span>
              </li>
            `).join('')}
          </ul>
        `}
      </div>
      <div class="card">
        <div class="card-title">最近 20 次听写</div>
        ${profile.dictation_log.length === 0 ? '<p class="dictation-tip">还没有听写记录。</p>' : `
          <ul class="word-list">
            ${profile.dictation_log.slice(0, 20).map(log => `
              <li>
                <span class="word-text">${log.word}</span>
                <span class="word-meta">
                  ${log.correct ? '<span class="badge master">对</span>' : '<span class="badge dictation-err">错</span>'}
                  ${new Date(log.at).toLocaleString('zh-CN')}
                </span>
              </li>
            `).join('')}
          </ul>
        `}
      </div>
    `;
  },

  /* ============ 家长配置 ============ */
  renderSettings(root) {
    const profile = Store.getCurrentProfile();
    const s = profile.settings;
    root.innerHTML = `
      <div class="app-header">
        <div class="app-title">⚙️ 家长配置</div>
        <div class="app-profile" data-link="/">← 返回</div>
      </div>

      <div class="card">
        <div class="card-title">学习节奏</div>
        <div class="field">
          <label>每日学习单词数</label>
          <input id="set-words" type="number" min="3" max="20" value="${s.daily_words}">
        </div>
        <div class="field">
          <label>每日学习时长（分钟）</label>
          <input id="set-min" type="number" min="5" max="60" value="${s.daily_minutes}">
        </div>
        <div class="field">
          <label>听写每组词数</label>
          <input id="set-dict" type="number" min="3" max="10" value="${s.dictation_group_size}">
        </div>
      </div>

      <div class="card">
        <div class="card-title">🔊 发音（D005）</div>
        <p class="card-subtitle">每个环节的朗读遍数（1-3 遍）</p>
        ${[
          { key: 'ear', label: '🎧 听音（看单词）' },
          { key: 'example', label: '💬 听例句' },
          { key: 'follow', label: '🗣 跟读' },
          { key: 'syllable', label: '🔠 分段播放' },
          { key: 'combine', label: '🧩 合成朗读' },
          { key: 'dictation', label: '✍️ 听写朗读' }
        ].map(item => {
          const v = (s.repeat || {})[item.key] || 1;
          return `
            <div class="field stepper-field">
              <label>${item.label}</label>
              <div class="stepper" data-key="${item.key}">
                <button type="button" class="stepper-btn" data-action="stepper" data-delta="-1">−</button>
                <span class="stepper-val" id="stepper-val-${item.key}">${v}</span>
                <button type="button" class="stepper-btn" data-action="stepper" data-delta="1">+</button>
                <span class="stepper-hint">次</span>
              </div>
            </div>
          `;
        }).join('')}
        <div class="field">
          <label>听写朗读模式</label>
          <div class="toggle-row">
            <label class="toggle">
              <input type="checkbox" id="set-two-phase" ${s.dictation_two_phase !== false ? 'checked' : ''}>
              <span>连读 ${'\u00d7 '}${(s.repeat||{}).dictation || 2} 后，<strong>慢速分段</strong></span>
            </label>
          </div>
          <p style="font-size:12px;color:var(--c-text-soft);margin-top:4px">关闭后听写时只连读，不分段。</p>
        </div>
        <div class="field">
          <label>TTS 语速（0.5 慢 - 1.2 快）</label>
          <input id="set-rate" type="number" step="0.05" min="0.5" max="1.2" value="${s.tts_rate || 0.9}">
        </div>
        <div class="field">
          <label>TTS 声音（D006）</label>
          <select id="set-gender">
            <option value="female" ${(s.tts_gender||'female')==='female'?'selected':''}>👩 女声（推荐）</option>
            <option value="male" ${s.tts_gender==='male'?'selected':''}>👨 男声</option>
            <option value="auto" ${s.tts_gender==='auto'?'selected':''}>🔊 系统默认</option>
          </select>
          <p style="font-size:12px;color:var(--c-text-soft);margin-top:4px">本机未装对应声源时，会自动回退到系统默认声。</p>
        </div>
        <button class="btn btn-ghost" data-action="testTTS">🔊 试听 hello</button>
      </div>

      <div class="card">
        <div class="card-title">数据管理（务必定期备份）</div>
        <div class="notice">数据存本机浏览器，换设备/清缓存会丢。建议每周导出 1 次。</div>
        <div class="dictation-controls">
          <button class="btn" data-action="exportData">📥 导出备份</button>
          <button class="btn btn-ghost" data-action="triggerImport">📤 导入备份</button>
          <input type="file" id="import-file" accept=".json" style="display:none">
        </div>
        <div class="dictation-controls" style="margin-top:12px">
          <button class="btn btn-ghost" data-action="openProfileSwitcher">👤 切换/新增档案</button>
        </div>
      </div>

      <div class="card">
        <div class="card-title">版本信息</div>
        <p class="word-meta">单词记忆教练 v0.3（MVP 验证版）</p>
        <p class="word-meta" style="margin-top:6px">决策依据：D001 听写 / D002 HTML→小程序 / D003 数据分层</p>
      </div>

      <button class="btn btn-block" data-action="saveSettings" style="margin-top:16px">💾 保存设置</button>
    `;
  },

  /* ============ 通用动作 ============ */
  actions: {
    nextStep() { window._nextStep && window._nextStep(); },

    /* D012：听写前跟读 —— TTS 慢速 + 3 秒跟读倒计时 */
    startPreDictationFollow() {
      const w = App._viewedWord;
      if (!w) return;
      TTS.stop();
      const settings = Store.getCurrentProfile().settings || {};
      const times = (settings.repeat && settings.repeat.dictation) || 1;
      const fb = document.getElementById('pre-dictation-follow-feedback');
      if (fb) fb.innerHTML = '🎧 慢速朗读中…';
      TTS.playRepeat(w.word, { times, gapMs: 800, lang: 'en', rate: 0.6, gender: settings.tts_gender || 'female', onComplete: () => {
        if (fb) fb.innerHTML = '🎤 跟读一次（3 秒）…';
        setTimeout(() => {
          if (fb) fb.innerHTML = '✅ 跟读完成，进入听写';
          setTimeout(() => window._nextStep && window._nextStep(), 600);
        }, 3000);
      }});
    },

    /* D011：批量听写 TTS 播放 —— phase=1 全速连读 / phase=2 慢速逐词 2 次 */
    playBatchDictation(el) {
      const phase = parseInt(el?.getAttribute('data-phase') || '1');
      const queue = App._dictQueue;
      if (!queue || queue.length === 0) return;
      const settings = Store.getCurrentProfile().settings || {};
      const gender = settings.tts_gender || 'female';
      TTS.stop();
      if (phase === 1) {
        /* 全速连读（间隔 1.2s） */
        const text = queue.map(w => w.word).join(' ');
        App.toast('🎧 全速连读中…');
        TTS.speak(text, { lang: 'en', rate: 0.9, gender });
      } else {
        /* 慢速逐词 2 次（间隔 1.5s） */
        const seq = [];
        queue.forEach(w => seq.push(w.word, w.word));
        const text = seq.join(' ');
        App.toast('🎧 慢速逐词中…');
        TTS.speak(text, { lang: 'en', rate: 0.6, gender });
      }
    },

    /* D011 简化版：批改勾选（暂存到内存）+ 提交
     * 拍照上传 v0.6+ 评估时再加 */
    gradeDictation(el) {
      const wordId = el.getAttribute('data-word-id');
      const grade = el.getAttribute('data-grade');
      if (!App._dictGrades) App._dictGrades = {};
      App._dictGrades[wordId] = grade;
      const item = el.closest('.grade-item');
      if (item) {
        item.querySelectorAll('.btn-grade').forEach(b => b.classList.remove('selected'));
        el.classList.add('selected');
      }
    },

    /* D011 简化版：提交批改 —— 写错的入错词本 + 复习加权 */
    submitDictationGrade() {
      const grades = App._dictGrades || {};
      const queue = App._dictQueue || [];
      let correctCount = 0, wrongCount = 0;
      queue.forEach(w => {
        const g = grades[w.id] || 'correct';
        if (g === 'wrong') {
          wrongCount++;
          Store.recordWordResult(w.id, 'wrong', 'dictation');
          Store.recordDictationLog({ word_id: w.id, word: w.word, correct: false });
        } else {
          correctCount++;
          Store.recordWordResult(w.id, 'master', 'dictation');
        }
        Store.recordStudyLog({ word_id: w.id, word: w.word, study_type: 'dictation_batch' });
      });
      App._dictGrades = null;
      App.toast(`✅ 批改完成：${correctCount} 对 / ${wrongCount} 错`);
      if (wrongCount > 0) App.toast(`📕 ${wrongCount} 个错词已入错词本，下一轮会优先复习`);
      setTimeout(() => { location.hash = '/'; }, 1200);
    },

    /* D007：切换学习单元 */
    switchUnit(el) {
      const u = parseInt(el.getAttribute('data-unit'));
      if (!u) return;
      Store.updateCurrentProfile(p => {
        p.settings = { ...(p.settings || {}), current_unit: u };
        return p;
      });
      App.invalidateWordsCache();
      App.toast(`已切到 ${u <= 3 ? 'Starter U' + u : 'Unit ' + (u - 3)} ✅`);
      App.render();
    },

    /* D005：统一播放入口，按 data-kind 决定播放内容
     * kind: 'ear' / 'example' / 'follow' / 'combine'
     */
    playWord(el) {
      const w = App._viewedWord || App._dictWord;
      if (!w) return;
      TTS.stop();
      const kind = el?.getAttribute('data-kind') || 'ear';
      const settings = Store.getCurrentProfile().settings || {};
      const repeat = settings.repeat || {};
      const n = Math.max(1, Math.min(3, repeat[kind] || 1));
      const text = kind === 'example' ? w.example.en : w.word;
      const rate = kind === 'follow' ? 0.85 : 0.9;
      const gender = settings.tts_gender || 'female';
      TTS.playRepeat(text, { times: n, gapMs: 600, lang: 'en', rate, gender });
    },

    /* D005：分段 N 遍播放（按 repeat.syllable） */
    playSyllableLoop() {
      const w = App._viewedWord;
      if (!w) return;
      TTS.stop();
      const n = Math.max(1, Math.min(3, (Store.getCurrentProfile().settings.repeat || {}).syllable || 1));
      let round = 0;
      const next = () => {
        if (round >= n) return;
        round++;
        TTS.playSyllables(w.syllables, (seg) => {
          if (seg === null) setTimeout(next, 400);
        });
      };
      next();
    },

    /* 主动回忆页的"再听"按钮（默认听音设置） */
    playRecall() {
      const w = App._viewedWord;
      if (!w) return;
      TTS.stop();
      const gender = (Store.getCurrentProfile().settings || {}).tts_gender || 'female';
      TTS.speak(w.word, { rate: 0.85, lang: 'en', gender });
    },

    /* 找特位页的慢速再听 */
    playSlowWord() {
      const w = App._viewedWord;
      if (!w) return;
      TTS.stop();
      const gender = (Store.getCurrentProfile().settings || {}).tts_gender || 'female';
      TTS.speak(w.word, { rate: 0.6, lang: 'en', gender });
    },

    playDictation() {
      const w = App._dictWord;
      if (!w) return;
      TTS.stop();
      const s = Store.getCurrentProfile().settings;
      const times = Math.max(1, Math.min(3, (s.repeat || {}).dictation || 2));
      const twoPhase = s.dictation_two_phase !== false;
      const gender = s.tts_gender || 'female';
      TTS.playDictation(w.word, w.syllables, { times, twoPhase, gender });
    },

    replayDictation() {
      App.actions.playDictation();
    },

    slowDictation() {
      const w = App._dictWord;
      if (!w) return;
      TTS.stop();
      TTS.playSyllables(w.syllables);
    },

    revealHint() {
      const w = App._viewedWord;
      if (!w) return;
      const el = document.getElementById('hint-length');
      if (el) {
        el.textContent = w.word[0] + '_'.repeat(w.word.length - 2) + (w.word.length > 1 ? w.word[w.word.length - 1] : '');
        el.classList.add('revealed');
      }
    },

    checkRecall() {
      const w = App._viewedWord;
      if (!w) return;
      const input = document.getElementById('recall-input');
      const fb = document.getElementById('recall-feedback');
      const v = (input.value || '').trim().toLowerCase();
      if (v === w.word.toLowerCase()) {
        fb.innerHTML = '<div class="feedback ok">🎉 拼对了！</div>';
        Store.recordWordResult(w.id, 'master', 'recall');
        setTimeout(() => window._nextStep && window._nextStep(), 1000);
      } else {
        fb.innerHTML = `<div class="feedback err">正确拼写：<strong>${w.word}</strong>。已记入错词本。</div>`;
        Store.recordWordResult(w.id, 'wrong', 'recall');
      }
    },

    dictCorrect() {
      const w = App._dictWord;
      if (!w) return;
      Store.recordWordResult(w.id, 'master', 'dictation');
      Store.recordDictationLog({ word_id: w.id, word: w.word, correct: true });
      App._finishDictation();
    },

    dictWrong() {
      const w = App._dictWord;
      if (!w) return;
      const typed = (document.getElementById('dict-typed') || {}).value || '';
      Store.recordWordResult(w.id, 'wrong', 'dictation');
      Store.recordDictationLog({ word_id: w.id, word: w.word, correct: false, typed });
      App._finishDictation();
    },

    dictSkip() {
      location.hash = '/';
    },

    exportData() { Store.exportAll(); App.toast('备份已下载，请妥善保存'); },

    triggerImport() {
      const f = document.getElementById('import-file');
      if (f) f.click();
    },

    testTTS() {
      const gender = document.getElementById('set-gender')?.value || 'female';
      TTS.speak('hello, world', { lang: 'en', rate: parseFloat(document.getElementById('set-rate')?.value || 0.85), gender });
    },

    saveSettings() {
      const daily_words = parseInt(document.getElementById('set-words').value) || 5;
      const daily_minutes = parseInt(document.getElementById('set-min').value) || 15;
      const dictation_group_size = parseInt(document.getElementById('set-dict').value) || 5;
      const tts_rate = parseFloat(document.getElementById('set-rate').value) || 0.9;
      const tts_gender = document.getElementById('set-gender')?.value || 'female';
      const dictation_two_phase = document.getElementById('set-two-phase')?.checked !== false;
      // D005：收集 6 个 stepper 的当前值
      const repeat = {
        ear: 1, example: 1, follow: 2, syllable: 1, combine: 2, dictation: 2
      };
      ['ear','example','follow','syllable','combine','dictation'].forEach(k => {
        const el = document.getElementById('stepper-val-' + k);
        if (el) {
          const v = parseInt(el.textContent);
          if (!isNaN(v)) repeat[k] = Math.max(1, Math.min(3, v));
        }
      });
      Store.updateCurrentProfile(p => {
        const { dual_voice_mode, ...rest } = p.settings || {};
        p.settings = { ...rest, daily_words, daily_minutes, dictation_group_size, tts_rate, tts_gender, repeat, dictation_two_phase };
        return p;
      });
      App.toast('已保存 ✅');
    },

    /* D005：stepper 按钮点击（不保存，只更新 UI） */
    stepper(el) {
      const wrap = el.closest('.stepper');
      if (!wrap) return;
      const key = wrap.getAttribute('data-key');
      const valEl = document.getElementById('stepper-val-' + key);
      if (!valEl) return;
      const delta = parseInt(el.getAttribute('data-delta')) || 0;
      let v = parseInt(valEl.textContent) || 1;
      v = Math.max(1, Math.min(3, v + delta));
      valEl.textContent = v;
    },

    openProfileSwitcher() {
      const profiles = Store.listProfiles();
      const current = localStorage.getItem('wordcoach.currentProfile') || 'default';
      App.showModal({
        title: '切换 / 新增档案',
        body: `
          <p class="card-subtitle">家里多个孩子？每个孩子一个档案，数据互不干扰。</p>
          <div class="field">
            <label>选择当前档案</label>
            <select id="profile-select">
              ${profiles.map(n => `<option value="${n}" ${n === current ? 'selected' : ''}>${n}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label>新增档案（给孩子起名）</label>
            <input id="profile-new" placeholder="例如：轩轩/悦悦">
          </div>
        `,
        actions: [
          { text: '切换', onClick: () => {
            const sel = document.getElementById('profile-select').value;
            Store.switchProfile(sel);
            App.closeModal();
            App.render();
          }},
          { text: '新增并切换', primary: true, onClick: () => {
            const name = document.getElementById('profile-new').value.trim();
            if (!name) { alert('请输入名字'); return; }
            if (Store.createProfile(name)) {
              Store.switchProfile(name);
              App.closeModal();
              App.render();
            } else {
              alert('档案已存在');
            }
          }}
        ]
      });
    }
  },

  _finishDictation() {
    const done = document.getElementById('dict-done');
    if (done) done.style.display = 'block';
    done && done.scrollIntoView({ behavior: 'smooth' });
  },

  /* ============ 弹窗 ============ */
  showModal({ title, body, actions }) {
    let m = document.getElementById('global-modal');
    if (!m) {
      m = document.createElement('div');
      m.id = 'global-modal';
      m.className = 'modal-mask';
      document.body.appendChild(m);
    }
    App._modalActions = actions || [];
    const actionButtons = (actions || []).map((a, i) => {
      const cls = a.primary ? 'btn' : 'btn btn-ghost';
      const safeText = String(a.text || '').replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c]));
      return `<button type="button" class="${cls}" data-modal-idx="${i}">${safeText}</button>`;
    }).join('');
    m.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${title}</h3>
        ${body}
        <div class="modal-actions">${actionButtons}</div>
      </div>
    `;
    m.classList.add('show');
    m.querySelectorAll('[data-modal-idx]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const i = parseInt(btn.getAttribute('data-modal-idx'));
        const a = App._modalActions[i];
        if (a && a.onClick) a.onClick();
      });
    });
  },

  closeModal() {
    const m = document.getElementById('global-modal');
    if (m) m.classList.remove('show');
    App._modalActions = [];
  },

  /* 顶部轻提示（替代 alert，避免阻塞 UI） */
  toast(msg, ms = 1500) {
    let t = document.getElementById('global-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'global-toast';
      t.style.cssText = 'position:fixed;top:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:white;padding:10px 20px;border-radius:24px;font-size:14px;z-index:200;opacity:0;transition:opacity 0.2s;pointer-events:none;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._hideTimer);
    t._hideTimer = setTimeout(() => { t.style.opacity = '0'; }, ms);
  },

  /* ============ 加载词库 ============ */
  _wordsCache: {}, // unitId -> data
  UNIT_IDS: [1,2,3,4,5,6,7,8,9,10],
  async loadWords(unitId) {
    const id = unitId || Store.getCurrentProfile().settings.current_unit || 1;
    if (this._wordsCache[id]) return this._wordsCache[id];
    const res = await fetch(`data/unit${id}.json`);
    const data = await res.json();
    this._wordsCache[id] = data;
    return data;
  },
  async loadAllUnits() {
    const list = await Promise.all(this.UNIT_IDS.map(id => this.loadWords(id)));
    return { units: list, allWords: list.flatMap(d => d.words) };
  },
  invalidateWordsCache() { this._wordsCache = {}; }
};

/* 导入文件 */
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'import-file') {
    const f = e.target.files[0];
    if (!f) return;
    Store.importAll(f).then(() => {
      alert('导入成功 ✅');
      App.render();
    }).catch(err => alert('导入失败：' + err.message));
  }
});

document.addEventListener('DOMContentLoaded', () => App.init());
