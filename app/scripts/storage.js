/* localStorage 抽象层（D003）
 * 验收要求：用户数据 100% 存在 localStorage，Network 面板无任何外部请求。
 * Schema：profile / words_state / dictation_log / settings
 * 提供：get / set / export / import / 档案切换
 */

const STORAGE_KEY = 'wordcoach.v1';
const CURRENT_PROFILE_KEY = 'wordcoach.currentProfile';

const DEFAULT_SCHEMA = {
  version: 1,
  profiles: {
    default: {
      name: '我的孩子',
      created_at: new Date().toISOString(),
      settings: {
        daily_minutes: 15,
        daily_words: 5,
        dictation_group_size: 5,
        reward_mode: 'badge',
        tts_rate: 0.9,
        tts_voice: '',
        tts_gender: 'female', // 'female' | 'male' | 'auto'（D006：默认女声）
        current_unit: 1, // D007：当前学习单元（家长/学生手动切换）
        // D005：每个 TTS 场景遍数（1-3）
        repeat: {
          ear: 1,      // 听音（看单词听）
          example: 1,  // 听例句
          follow: 2,   // 跟读
          syllable: 1, // 分段
          combine: 2,  // 合成
          dictation: 2 // 听写朗读
        },
        dictation_two_phase: true  // 听写是否分两段（连读+分段）
      },
      words_state: {},
      dictation_log: [],
      study_log: []
    }
  }
};

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SCHEMA);
    const parsed = JSON.parse(raw);
    if (!parsed.profiles) return structuredClone(DEFAULT_SCHEMA);
    return parsed;
  } catch (e) {
    console.warn('[storage] 读取失败，使用默认 schema', e);
    return structuredClone(DEFAULT_SCHEMA);
  }
}

function saveAll(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    if (e.name === 'QuotaExceededError') {
      alert('本机存储已满，请到设置页导出备份后清理旧数据。');
    } else {
      console.error('[storage] 保存失败', e);
    }
  }
}

function getCurrentProfileName() {
  return localStorage.getItem(CURRENT_PROFILE_KEY) || 'default';
}

function setCurrentProfileName(name) {
  localStorage.setItem(CURRENT_PROFILE_KEY, name);
}

function getCurrentProfile() {
  const all = loadAll();
  const name = getCurrentProfileName();
  if (!all.profiles[name]) {
    all.profiles[name] = structuredClone(DEFAULT_SCHEMA.profiles.default);
    saveAll(all);
  }
  return all.profiles[name];
}

function updateCurrentProfile(updater) {
  const all = loadAll();
  const name = getCurrentProfileName();
  all.profiles[name] = updater(all.profiles[name]) || all.profiles[name];
  saveAll(all);
  return all.profiles[name];
}

function listProfiles() {
  return Object.keys(loadAll().profiles);
}

function createProfile(name) {
  const all = loadAll();
  if (all.profiles[name]) return false;
  all.profiles[name] = structuredClone(DEFAULT_SCHEMA.profiles.default);
  all.profiles[name].name = name;
  all.profiles[name].created_at = new Date().toISOString();
  saveAll(all);
  return true;
}

function switchProfile(name) {
  const all = loadAll();
  if (!all.profiles[name]) return false;
  setCurrentProfileName(name);
  return true;
}

/* ============ 导出 / 导入（D003 兜底） ============ */
function exportAll() {
  const all = loadAll();
  const current = getCurrentProfileName();
  const payload = {
    exported_at: new Date().toISOString(),
    app: 'wordcoach',
    schema_version: 1,
    current_profile: current,
    data: all
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wordcoach-backup-${current}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importAll(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const payload = JSON.parse(e.target.result);
        if (payload.app !== 'wordcoach') throw new Error('不是本应用的备份文件');
        if (!payload.data || !payload.data.profiles) throw new Error('数据格式错误');
        saveAll(payload.data);
        if (payload.current_profile && payload.data.profiles[payload.current_profile]) {
          setCurrentProfileName(payload.current_profile);
        }
        resolve(payload);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsText(file);
  });
}

/* ============ 单词掌握度更新 ============ */
function recordWordResult(wordId, status, source = 'recall') {
  return updateCurrentProfile((p) => {
    const now = new Date().toISOString();
    if (!p.words_state[wordId]) {
      p.words_state[wordId] = {
        first_seen: now,
        attempts: 0,
        master_count: 0,
        last_seen: null,
        last_status: null,
        dictation_errors: 0,
        recall_errors: 0
      };
    }
    const w = p.words_state[wordId];
    w.attempts += 1;
    w.last_seen = now;
    w.last_status = status;
    if (status === 'master') w.master_count += 1;
    if (source === 'dictation' && status === 'wrong') w.dictation_errors += 1;
    if (source === 'recall' && status === 'wrong') w.recall_errors += 1;
    return p;
  });
}

function recordDictationLog(entry) {
  return updateCurrentProfile((p) => {
    p.dictation_log.unshift({
      ...entry,
      at: new Date().toISOString()
    });
    if (p.dictation_log.length > 200) p.dictation_log.length = 200;
    return p;
  });
}

function recordStudyLog(entry) {
  return updateCurrentProfile((p) => {
    p.study_log.unshift({
      ...entry,
      study_type: entry.study_type || 'new',
      at: new Date().toISOString()
    });
    if (p.study_log.length > 200) p.study_log.length = 200;
    return p;
  });
}

/* D011：保存听写作业本照片（压缩后 Base64 存 localStorage）
 * 入参：{ unit_id, word_ids: [], data_url: 'data:image/jpeg;base64,...' }
 * 返回：photo_id（时间戳） */
function recordDictationPhoto(photo) {
  const photo_id = 'photo_' + Date.now();
  return updateCurrentProfile((p) => {
    if (!p.dictation_photos) p.dictation_photos = [];
    p.dictation_photos.unshift({
      ...photo,
      photo_id,
      taken_at: new Date().toISOString()
    });
    if (p.dictation_photos.length > 10) p.dictation_photos.length = 10;
    return p;
  }).then(() => photo_id);
}

/* D011：按 unit_id 取最近一张照片（错词本查图用） */
function getLatestPhotoForUnit(unit_id) {
  const p = getCurrentProfile();
  const list = p.dictation_photos || [];
  return list.find(ph => ph.unit_id === unit_id) || null;
}

/* D011：按 photo_id 取照片 */
function getDictationPhoto(photo_id) {
  const p = getCurrentProfile();
  return (p.dictation_photos || []).find(ph => ph.photo_id === photo_id) || null;
}

function getStats() {
  const p = getCurrentProfile();
  const total = Object.keys(p.words_state).length;
  const mastered = Object.values(p.words_state).filter(w => w.last_status === 'master').length;
  const wrong = Object.values(p.words_state).filter(w => w.last_status === 'wrong').length;
  const dictationErrors = Object.values(p.words_state).filter(w => w.dictation_errors > 0).length;
  /* D010：复习统计（今日） */
  const today = new Date().toISOString().slice(0, 10);
  const todayLog = (p.study_log || []).filter(e => (e.at || '').slice(0, 10) === today);
  const reviewToday = todayLog.filter(e => e.study_type === 'review').length;
  const newToday = todayLog.filter(e => e.study_type !== 'review').length;
  return { total, mastered, wrong, dictationErrors, studyCount: p.study_log.length, reviewToday, newToday };
}

/* ============ 暴露 API ============ */
window.Store = {
  loadAll, saveAll,
  getCurrentProfile, updateCurrentProfile,
  listProfiles, createProfile, switchProfile,
  exportAll, importAll,
  recordWordResult, recordDictationLog, recordStudyLog,
  recordDictationPhoto, getLatestPhotoForUnit, getDictationPhoto,
  getStats
};
