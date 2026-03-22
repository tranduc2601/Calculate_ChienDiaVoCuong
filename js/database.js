// ==========================================
// DATA STATE, LOCAL STORAGE & FIREBASE
// ==========================================
import { DEFAULT_CHEST_CONFIG } from './ranking.js';

let uiHooks = {};

export function registerUIHooks(h) {
  uiHooks = h || {};
}

export let state = {
  members: [], // {id, name, joinedAt, isAccountant?}
  stats: {},   // {id: {kills, destroy, tower, towerWeek?, speed_start?, speed_end?, speed_total?}}
  logs: [],    // {logId, memberId, type(kill/destroy/tower), amount, oldVal, time, extra?}
  towerBase: {}, // {id: {weekAnchorMs, baseTotal}}
  meta: {
    updatedAt: 0,
    weekAnchorMs: 0, // computed "week start" anchor (Mon 21:00)
    weekLabel: "",
    manualRange: null, // {startMs, endMs}
    firebaseChestConfig: null, // { chests: [...] } từ Firebase settings/chest_config
    ruleMode: 'waterfall', // từ Firebase settings/rule_mode
    currentWeekId: ""
  },
  memberLogs: [], // {id, kind, payload, time}
  weekHistory: [] // {id, weekAnchorMs, label, createdAt, text}
};

export const STORAGE_KEY = 'minhchu_v4';
export const CLOUD_CFG_KEY = 'minhchu_cloud_cfg_v1';

export function saveLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

export function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { state = JSON.parse(raw); } catch(e) {}
  }
  // Ensure stats object exists for backward compatibility
  state.members.forEach(m => {
    if(!state.stats[m.id]) state.stats[m.id] = {kills:0, destroy:0, tower:0, towerWeek:0, speed_start:0, speed_end:0, speed_total:0};
    if (typeof state.stats[m.id].towerWeek === 'undefined') {
      state.stats[m.id].towerWeek = 0;
    }
    if (typeof state.stats[m.id].speed_start === 'undefined') state.stats[m.id].speed_start = 0;
    if (typeof state.stats[m.id].speed_end === 'undefined') state.stats[m.id].speed_end = state.stats[m.id].tower || 0;
    if (typeof state.stats[m.id].speed_total === 'undefined') state.stats[m.id].speed_total = state.stats[m.id].towerWeek || 0;
  });
  if (!state.meta) state.meta = { updatedAt: 0, weekAnchorMs: 0, weekLabel: "" };
  if (typeof state.meta.ruleMode === 'undefined') state.meta.ruleMode = 'waterfall';
  if (!state.towerBase) state.towerBase = {};
  if (!state.memberLogs) state.memberLogs = [];
  if (!state.weekHistory) state.weekHistory = [];
  // Chỉ cho phép 1 kế toán: giữ người đầu tiên được đánh dấu
  const accountants = state.members.filter(m => m.isAccountant);
  if (accountants.length > 1) {
    state.members.forEach(m => { m.isAccountant = false; });
    state.members.find(m => m.id === accountants[0].id).isAccountant = true;
  }
}

export function getStats(id) {
  const s = state.stats[id] || {kills:0, destroy:0, tower:0, towerWeek:0, speed_start:0, speed_end:0, speed_total:0};
  if (typeof s.speed_total === 'undefined') s.speed_total = s.towerWeek || 0;
  if (typeof s.speed_start === 'undefined') s.speed_start = 0;
  if (typeof s.speed_end === 'undefined') s.speed_end = s.tower || 0;
  return s;
}

export function getWeekId(dateMs = Date.now()) {
  const d = new Date(dateMs);
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function getWeekAnchorMs(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const day = d.getDay(); // 0=Sun..6=Sat
  const hour = d.getHours();
  const minute = d.getMinutes();

  // Move to Monday of "current week"
  // If it's Sunday (0), go back 6 days; else go back (day-1)
  const diffToMon = (day === 0) ? -6 : (1 - day);
  const mon = new Date(d);
  mon.setDate(d.getDate() + diffToMon);
  mon.setHours(21, 0, 0, 0);

  // If before Monday 21:00 of this week, anchor should be previous week
  if (nowMs < mon.getTime()) {
    mon.setDate(mon.getDate() - 7);
  }
  return mon.getTime();
}

export function formatWeekLabel(anchorMs) {
  const start = new Date(anchorMs);
  const end = new Date(anchorMs + 6 * 24 * 3600 * 1000);
  const f = (x) => x.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  return `${f(start)} (T2 21:00) → ${f(end)} (CN 21:00)`;
}

export function ensureWeek() {
  const anchor = getWeekAnchorMs();
  if (!state.meta) state.meta = { updatedAt: 0, weekAnchorMs: 0, weekLabel: "" };
  if (state.meta.weekAnchorMs !== anchor) {
    state.meta.weekAnchorMs = anchor;
    state.meta.weekLabel = formatWeekLabel(anchor);
    state.meta.currentWeekId = getWeekId(anchor);
    // Reset tower baselines to current totals (first open after week start)
    state.members.forEach(m => {
      const s = getStats(m.id);
      state.towerBase[m.id] = { weekAnchorMs: anchor, baseTotal: s.tower || 0 };
    });
    bumpUpdatedAt();
    saveAll();
  }
  if (!state.meta.currentWeekId) state.meta.currentWeekId = getWeekId(state.meta.weekAnchorMs || anchor);
  uiHooks.updateWeekLabelView?.();
}

export function getTowerWeekFor(memberId) {
  const s = getStats(memberId);
  return Math.max(0, s.towerWeek || 0);
}

export let cloud = {
  enabled: false,
  app: null,
  auth: null,
  db: null,
  unsub: null,
  weeklyUnsub: null,
  chestCfgUnsub: null,
  ruleUnsub: null,
  lastRemoteUpdatedAt: 0,
  writeTimer: null
};

export function bumpUpdatedAt() {
  if (!state.meta) state.meta = { updatedAt: 0, weekAnchorMs: 0, weekLabel: "" };
  state.meta.updatedAt = Date.now();
  uiHooks.updateWeekLabelView?.();
}

export function saveAll() {
  saveLocal();
  scheduleCloudWrite();
}

export function getCloudCfg() {
  try { return JSON.parse(localStorage.getItem(CLOUD_CFG_KEY) || 'null'); } catch(e) { return null; }
}

export function setCloudStatus(txt) {
  const el = document.getElementById('cloud-status');
  if (el) el.textContent = txt;
}

export function saveFirebaseConfig() {
  const raw = (document.getElementById('inp-fb-config')?.value || '').trim();
  if (!raw) { uiHooks.toast?.('Chưa có config để lưu.'); return; }
  try {
    const cfg = parseFirebaseConfigFromText(raw);
    if (!cfg.projectId) throw new Error('Missing projectId');
    localStorage.setItem(CLOUD_CFG_KEY, JSON.stringify(cfg));
    uiHooks.toast?.('Đã lưu config.');
  } catch(e) {
    uiHooks.toast?.('Config không hợp lệ (cần có projectId).');
  }
}

export function parseFirebaseConfigFromText(text) {
  // Accept either:
  // 1) Pure JSON: {"apiKey":"...","projectId":"..."}
  // 2) Full Firebase snippet that contains: const firebaseConfig = { ... };
  // 3) Just an object literal: { apiKey: "...", projectId: "..." }
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('Empty');

  // Fast path: valid JSON already
  try {
    const asJson = JSON.parse(trimmed);
    if (asJson && typeof asJson === 'object') return asJson;
  } catch(e) {}

  // Try extract object literal
  let objText = '';
  const m = trimmed.match(/firebaseConfig\s*=\s*\{[\s\S]*?\};?/);
  if (m) {
    const start = m[0].indexOf('{');
    const end = m[0].lastIndexOf('}');
    objText = m[0].slice(start, end + 1);
  } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    objText = trimmed;
  } else {
    throw new Error('Not JSON');
  }

  // Convert JS object literal → JSON (quote keys, remove trailing commas)
  const jsonish = objText
    .replace(/(\r\n|\r)/g, '\n')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([,{]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');

  const cfg = JSON.parse(jsonish);
  return cfg;
}

export function clearFirebaseConfig() {
  localStorage.removeItem(CLOUD_CFG_KEY);
  const el = document.getElementById('inp-fb-config');
  if (el) el.value = '';
  uiHooks.toast?.('Đã xóa config.');
}

export async function connectCloud() {
  const cfg = getCloudCfg();
  if (!cfg) { uiHooks.toast?.('Bạn cần dán Firebase config trước.'); return false; }
  if (!window.firebase?.initializeApp) { uiHooks.toast?.('Thiếu Firebase SDK (không load được).'); return false; }

  try {
    if (!cloud.app) cloud.app = firebase.initializeApp(cfg);
    cloud.auth = firebase.auth();
    cloud.db = firebase.firestore();
    await cloud.auth.signInAnonymously();
    cloud.enabled = true;
    setCloudStatus('Đã kết nối');
    startCloudListener();
    await ensureChestConfigFromRemote();
    scheduleCloudWrite(true);
    uiHooks.markStartupConnected?.();
    uiHooks.stopConnectPromptLoop?.();
    uiHooks.hideConnectPromptModal?.();
    uiHooks.toast?.('Cloud đã sẵn sàng.');
    return true;
  } catch (e) {
    cloud.enabled = false;
    setCloudStatus('Lỗi kết nối');
    uiHooks.toast?.('Không kết nối được Cloud. Kiểm tra config/rules Firebase.');
    return false;
  }
}

export function disconnectCloud() {
  if (cloud.unsub) { try { cloud.unsub(); } catch(e) {} }
  if (cloud.weeklyUnsub) { try { cloud.weeklyUnsub(); } catch(e) {} }
  if (cloud.chestCfgUnsub) { try { cloud.chestCfgUnsub(); } catch(e) {} }
  if (cloud.ruleUnsub) { try { cloud.ruleUnsub(); } catch(e) {} }
  cloud.unsub = null;
  cloud.weeklyUnsub = null;
  cloud.chestCfgUnsub = null;
  cloud.ruleUnsub = null;
  cloud.enabled = false;
  setCloudStatus('Đã ngắt');
  uiHooks.stopConnectPromptLoop?.();
  uiHooks.toast?.('Đã ngắt Cloud.');
}

export function cloudDocRef() {
  // One shared doc for the whole alliance
  return cloud.db.collection('minhchu_bxh').doc('state');
}

export function startCloudListener() {
  if (!cloud.enabled) return;
  if (cloud.unsub) return;

  cloud.unsub = cloudDocRef().onSnapshot((snap) => {
    if (!snap.exists) return;
    const remote = snap.data();
    if (!remote?.payload) return;
    const remoteUpdatedAt = remote.updatedAt || 0;
    if (remoteUpdatedAt <= (state.meta?.updatedAt || 0)) return;
    try {
      state = remote.payload;
      if (!state.meta) state.meta = { updatedAt: remoteUpdatedAt, weekAnchorMs: 0, weekLabel: "" };
      cloud.lastRemoteUpdatedAt = remoteUpdatedAt;
      saveLocal(); // cache
      uiHooks.renderBXH?.();
      uiHooks.renderMemberList?.();
      uiHooks.renderEntryList?.();
      uiHooks.renderHistory?.();
      uiHooks.toast?.('Đã cập nhật dữ liệu mới từ Cloud.');
    } catch(e) {}
  });
  if (!cloud.weeklyUnsub) {
    cloud.weeklyUnsub = cloud.db.collection('weekly_history').limit(200).onSnapshot((snap) => {
      const rows = [];
      snap.forEach((doc) => rows.push(doc.data()));
      rows.sort((a, b) => (Number(b.closed_at || b.created_at) || 0) - (Number(a.closed_at || a.created_at) || 0));
      state.weekHistory = rows.map((x) => ({
        id: x.week_id,
        week_id: x.week_id,
        label: x.week_id,
        createdAt: x.closed_at || x.created_at || Date.now(),
        closed_at: x.closed_at || x.created_at,
        rule_mode: x.rule_mode,
        chest_config_snapshot: x.chest_config_snapshot,
        members: x.members,
        summary: x.summary,
        data: x
      }));
      saveLocal();
      uiHooks.renderHistory?.();
    });
  }
  if (!cloud.chestCfgUnsub) {
    cloud.chestCfgUnsub = cloud.db.collection('settings').doc('chest_config').onSnapshot((snap) => {
      if (!snap.exists) return;
      state.meta.firebaseChestConfig = snap.data();
      saveLocal();
      uiHooks.renderBXH?.();
      uiHooks.fillChestCfgUI?.();
      uiHooks.updateChestRulesSummary?.();
    });
  }
  if (!cloud.ruleUnsub) {
    cloud.ruleUnsub = cloud.db.collection('settings').doc('rule_mode').onSnapshot((snap) => {
      if (!snap.exists) return;
      state.meta.ruleMode = snap.data().rule_mode || 'waterfall';
      const sel = document.getElementById('rule-mode-select');
      if (sel) sel.value = state.meta.ruleMode;
      saveLocal();
      uiHooks.renderBXH?.();
    });
  }
}

export function scheduleCloudWrite(force = false) {
  if (!cloud.enabled) return;
  if (cloud.writeTimer) clearTimeout(cloud.writeTimer);
  cloud.writeTimer = setTimeout(() => writeCloud(force), force ? 0 : 800);
}

export async function writeCloud(force = false) {
  if (!cloud.enabled) return;
  const localUpdatedAt = state.meta?.updatedAt || 0;
  if (!force && localUpdatedAt <= cloud.lastRemoteUpdatedAt) return;
  try {
    await cloudDocRef().set({
      updatedAt: localUpdatedAt,
      payload: state
    }, { merge: true });
  } catch(e) {
    setCloudStatus('Lỗi ghi');
  }
}

export function syncNow() {
  if (!cloud.enabled) { uiHooks.toast?.('Chưa kết nối Cloud.'); return; }
  bumpUpdatedAt();
  saveAll();
  uiHooks.toast?.('Đang đồng bộ...');
}

export async function ensureChestConfigFromRemote() {
  if (!cloud.enabled || !cloud.db) {
    uiHooks.fillChestCfgUI?.();
    return;
  }
  try {
    const ref = cloud.db.collection('settings').doc('chest_config');
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : null;
    const chests = data?.chests;
    if (!snap.exists || !Array.isArray(chests) || chests.length === 0) {
      await ref.set(DEFAULT_CHEST_CONFIG);
      if (!state.meta) state.meta = {};
      state.meta.firebaseChestConfig = DEFAULT_CHEST_CONFIG;
      saveLocal();
    } else {
      if (!state.meta) state.meta = {};
      state.meta.firebaseChestConfig = data;
      saveLocal();
    }
  } catch (e) {
    uiHooks.toast?.('Không đọc/ghi được settings/chest_config. Kiểm tra rules Firestore.');
  }
  uiHooks.fillChestCfgUI?.();
  uiHooks.renderBXH?.();
  uiHooks.updateChestRulesSummary?.();
}
