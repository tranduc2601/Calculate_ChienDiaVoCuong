import {
  state,
  cloud,
  getStats,
  getTowerWeekFor,
  ensureWeek,
  saveAll,
  bumpUpdatedAt,
  connectCloud,
  disconnectCloud,
  getCloudCfg,
  saveFirebaseConfig,
  clearFirebaseConfig,
  syncNow,
  getWeekAnchorMs,
  getWeekId,
  formatWeekLabel,
  upsertMemberHistoryV2,
  removeMemberHistoryV2,
  getMemberHistoryV2Doc
} from './database.js';
import {
  calculateRankings,
  getFirebaseChestConfig,
  getRuleMode,
  DEFAULT_CHEST_CONFIG,
  CHEST_UI_ROW_META
} from './ranking.js';

export function updateWeekLabelView() {
  const lbl = document.getElementById('bxh-week-label');
  if (!lbl) return;
  const meta = state.meta || {};
  let label = '';
  if (meta.manualRange && meta.manualRange.startMs && meta.manualRange.endMs) {
    const s = new Date(meta.manualRange.startMs);
    const e = new Date(meta.manualRange.endMs);
    const f = (x) => x.toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    label = `Khung thủ công: ${f(s)} → ${f(e)}`;
  } else {
    label = meta.weekLabel || 'Cập nhật tự động theo tuần';
  }
  if (meta.updatedAt) {
    const t = new Date(meta.updatedAt);
    const tStr = t.toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
    label += ` • Lần cập nhật gần nhất: ${tStr}`;
  }
  lbl.textContent = label;
}

export function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.remove('active');
    if ((b.getAttribute('onclick') || '').includes("showPage('" + pageId + "')")) b.classList.add('active');
  });
  const pageEl = document.getElementById('page-' + pageId);
  if (pageEl) pageEl.classList.add('active');

  if(pageId === 'members') renderMemberList();
  if(pageId === 'enter') renderEntryList();
  if(pageId === 'bxh') renderBXH();
  if(pageId === 'history') renderHistory();
  if(pageId === 'settings') {
    checkSettingsConnectPrompt();
    updateChestRulesSummary();
  }
}

export function toast(msg) {
  const durationMs = arguments.length > 1 ? Number(arguments[1]) || 2500 : 2500;
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), durationMs);
}

// ==========================================
// 3. MEMBER MANAGEMENT
// ==========================================
export function addMember() {
  const name = document.getElementById('inp-new-member').value.trim();
  if(!name) return;
  if(state.members.some(m => m.name.toLowerCase() === name.toLowerCase())) {
    toast('Tên thành viên đã tồn tại.'); return;
  }
  const id = 'mb_' + Date.now();
  state.members.push({id, name, joinedAt: Date.now(), isAccountant: false});
  state.stats[id] = {kills:0, destroy:0, tower:0, towerWeek:0, speed_start:0, speed_end:0, speed_total:0};
  ensureWeek();
  state.towerBase[id] = { weekAnchorMs: state.meta.weekAnchorMs, baseTotal: 0 };
  logMemberChange('add', { memberId: id, name });
  bumpUpdatedAt();
  saveAll();
  document.getElementById('inp-new-member').value = '';
  renderMemberList();
  toast('Đã thêm: ' + name);
}

export function addMemberWithName(rawName) {
  const name = (rawName || '').trim();
  if (!name) return false;
  if(state.members.some(m => m.name.toLowerCase() === name.toLowerCase())) {
    return false;
  }
  const id = 'mb_' + Date.now() + Math.floor(Math.random()*1000);
  state.members.push({id, name, joinedAt: Date.now(), isAccountant: false});
  state.stats[id] = {kills:0, destroy:0, tower:0, towerWeek:0, speed_start:0, speed_end:0, speed_total:0};
  ensureWeek();
  state.towerBase[id] = { weekAnchorMs: state.meta.weekAnchorMs, baseTotal: 0 };
  logMemberChange('add', { memberId: id, name });
  bumpUpdatedAt();
  saveAll();
  return true;
}

export function deleteMember(id) {
  if(confirm('Chắc chắn muốn xóa thành viên này và toàn bộ dữ liệu của họ?')) {
    const m = state.members.find(x => x.id === id);
    state.members = state.members.filter(mb => mb.id !== id);
    delete state.stats[id];
    if (state.towerBase) delete state.towerBase[id];
    if (m) logMemberChange('remove', { memberId: id, name: m.name });
    if (state.members.length === 0) cloud.allowEmptyStateWrite = true;
    bumpUpdatedAt();
    saveAll();
    renderMemberList();
    toast('Đã xóa thành viên.');
  }
}

export function deleteMemberInternal(id) {
  const m = state.members.find(x => x.id === id);
  state.members = state.members.filter(mb => mb.id !== id);
  delete state.stats[id];
  if (state.towerBase) delete state.towerBase[id];
  if (m) logMemberChange('remove', { memberId: id, name: m.name });
  if (state.members.length === 0) cloud.allowEmptyStateWrite = true;
  bumpUpdatedAt();
  saveAll();
}

export function renderMemberList() {
  const query = (document.getElementById('search-member')?.value || '').toLowerCase();
  const sortBy = document.getElementById('member-sort-by')?.value || 'name';
  let list = state.members.filter(m => m.name.toLowerCase().includes(query));

  const towerWeek = (id) => getTowerWeekFor(id);
  if (sortBy === 'kills') list = [...list].sort((a, b) => (getStats(b.id).kills || 0) - (getStats(a.id).kills || 0));
  else if (sortBy === 'destroy') list = [...list].sort((a, b) => (getStats(b.id).destroy || 0) - (getStats(a.id).destroy || 0));
  else if (sortBy === 'tower') list = [...list].sort((a, b) => towerWeek(b.id) - towerWeek(a.id));
  else list = [...list].sort((a, b) => a.name.localeCompare(b.name));

  const container = document.getElementById('full-member-list');
  if (list.length === 0) { container.innerHTML = '<div class="members-empty">Không tìm thấy ai.</div>'; return; }

  container.innerHTML = `
    <table class="members-table">
      <thead>
        <tr>
          <th>Tên</th>
          <th class="num"><i class="fa-solid fa-skull" title="Diệt lính"></i></th>
          <th class="num"><i class="fa-solid fa-chess-rook" title="Phá thành"></i></th>
          <th class="num"><i class="fa-solid fa-tower-observation" title="Tháp tuần"></i></th>
          <th class="col-ke-toan">Kế toán</th>
          <th class="col-actions"></th>
        </tr>
      </thead>
      <tbody>
        ${list.map(m => {
          const s = getStats(m.id);
          const tw = towerWeek(m.id);
          const accountantOnly = state.members.some(x => x.isAccountant) ? '' : ' (chọn 1 người)';
          return `
            <tr>
              <td>
                <span class="member-name" onclick="openTowerEntryFromMembers('${m.id}')" title="Nhấn để nhập tháp tuần">
                  ${m.name}
                </span>
              </td>
              <td class="num">${(s.kills || 0).toLocaleString()}</td>
              <td class="num">${(s.destroy || 0).toLocaleString()}</td>
              <td class="num">${tw.toLocaleString()}</td>
              <td class="col-ke-toan">
                <label class="accountant-radio">
                  <input type="radio" name="accountant" ${m.isAccountant ? 'checked' : ''} onchange="setAccountant('${m.id}')" title="Chọn làm kế toán${accountantOnly}">
                  <span class="radio-label"><i class="fa-solid fa-coins"></i></span>
                </label>
              </td>
              <td class="col-actions">
                <button class="btn btn-sm" onclick="editMember('${m.id}')" title="Chỉnh sửa thông số"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-sm btn-red" onclick="deleteMember('${m.id}')" title="Xóa">Xóa</button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

export function editMember(id) {
  const m = state.members.find(x => x.id === id);
  if (!m) return;
  const s = getStats(id);

  const idEl = document.getElementById('edit-member-id');
  const nameEl = document.getElementById('edit-member-name');
  const killEl = document.getElementById('edit-member-kills');
  const desEl = document.getElementById('edit-member-destroy');
  const towEndEl = document.getElementById('edit-member-tower-end');
  const speedTotEl = document.getElementById('edit-member-speed-total');
  const modal = document.getElementById('edit-member-modal');
  if (!idEl || !nameEl || !killEl || !desEl || !towEndEl || !speedTotEl || !modal) return;

  idEl.value = id;
  nameEl.value = m.name;
  killEl.value = s.kills || 0;
  desEl.value = s.destroy || 0;
  towEndEl.value = s.tower || 0;
  speedTotEl.value = (s.speed_total != null ? s.speed_total : s.towerWeek) || 0;

  modal.style.display = 'flex';
  nameEl.focus();
}

export function closeEditMemberModal() {
  const modal = document.getElementById('edit-member-modal');
  if (modal) modal.style.display = 'none';
}

export function applyEditMember() {
  const idEl = document.getElementById('edit-member-id');
  const nameEl = document.getElementById('edit-member-name');
  const killEl = document.getElementById('edit-member-kills');
  const desEl = document.getElementById('edit-member-destroy');
  const towEndEl = document.getElementById('edit-member-tower-end');
  const speedTotEl = document.getElementById('edit-member-speed-total');
  if (!idEl || !nameEl || !killEl || !desEl || !towEndEl || !speedTotEl) return;

  const id = idEl.value;
  const m = state.members.find(x => x.id === id);
  if (!m) { closeEditMemberModal(); return; }
  const s = getStats(id);
  const anchor = state.meta?.weekAnchorMs || getWeekAnchorMs();

  const newName = (nameEl.value || '').trim() || m.name;
  if (state.members.some(x => x.id !== id && x.name.toLowerCase() === newName.toLowerCase())) {
    toast('Tên mới đã tồn tại, hãy chọn tên khác.');
    return;
  }

  const killsRaw = (killEl.value || '').trim();
  const destroyRaw = (desEl.value || '').trim();
  const towerEndRaw = (towEndEl.value || '').trim();
  const speedTotRaw = (speedTotEl.value || '').trim();

  const newKills = killsRaw === '' ? (Number(s.kills) || 0) : Math.max(0, parseInt(killsRaw, 10) || 0);
  const newDestroy = destroyRaw === '' ? (Number(s.destroy) || 0) : Math.max(0, parseInt(destroyRaw, 10) || 0);
  const newTowerEnd = towerEndRaw === '' ? (Number(s.tower) || 0) : Math.max(0, parseInt(towerEndRaw, 10) || 0);
  const weekGain = speedTotRaw === '' ? (Number(s.towerWeek) || 0) : Math.max(0, parseInt(speedTotRaw, 10) || 0);
  const speedTotalVal = weekGain;
  const baseTotal = Math.max(0, newTowerEnd - weekGain);

  const oldName = m.name;
  if (newName !== oldName) {
    m.name = newName;
    logMemberChange('rename', { memberId: id, oldName, newName });
  }

  state.stats[id] = {
    kills: newKills,
    destroy: newDestroy,
    tower: newTowerEnd,
    towerWeek: Math.max(0, weekGain),
    speed_start: null,
    speed_end: null,
    speed_total: speedTotalVal
  };
  if (!state.towerBase) state.towerBase = {};
  state.towerBase[id] = { weekAnchorMs: anchor, baseTotal };

  bumpUpdatedAt();
  saveAll();
  syncMemberHistoryV2ForMember(id);
  renderMemberList();
  renderEntryList();
  renderBXH();
  closeEditMemberModal();
  toast('Đã cập nhật thông tin thành viên.');
}

export function setAccountant(id) {
  const m = state.members.find(x => x.id === id);
  if (!m) return;
  state.members.forEach(mb => { mb.isAccountant = (mb.id === id); });
  logMemberChange('accountant', { memberId: id, name: m.name, value: true });
  bumpUpdatedAt();
  saveAll();
  renderMemberList();
  renderBXH();
  toast('Đã đặt ' + m.name + ' làm kế toán.');
}

export function toggleAccountant(id) {
  const m = state.members.find(x => x.id === id);
  if (!m) return;
  if (m.isAccountant) {
    m.isAccountant = false;
    logMemberChange('accountant', { memberId: id, name: m.name, value: false });
  } else {
    setAccountant(id);
    return;
  }
  bumpUpdatedAt();
  saveAll();
  renderMemberList();
  renderBXH();
}

// BULK MEMBER OPERATIONS
export function parseBulkNames() {
  const raw = (document.getElementById('bulk-member-input')?.value || '').split('\n');
  const names = [];
  const seen = new Set();
  raw.forEach(line => {
    const name = line.trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  });
  return names;
}

export function bulkAddMembers() {
  const names = parseBulkNames();
  if (!names.length) { toast('Chưa có tên nào trong ô hàng loạt.'); return; }
  let added = 0;
  names.forEach(n => {
    if (addMemberWithName(n)) added++;
  });
  renderMemberList();
  renderEntryList();
  renderBXH();
  if (added === 0) toast('Tất cả tên đã tồn tại, không có ai được thêm.');
  else toast('Đã thêm ' + added + ' thành viên mới.');
}

let bulkOpsQueue = [];
let bulkOpsCurrent = null;
let bulkOpsSkipAll = false;

export function bulkCheckMembers() {
  const names = parseBulkNames();
  if (!names.length) { toast('Chưa có tên nào trong ô hàng loạt.'); return; }

  const desiredSet = new Map();
  names.forEach(n => desiredSet.set(n.toLowerCase(), n));

  const existing = state.members.map(m => ({
    id: m.id,
    name: m.name,
    key: m.name.toLowerCase()
  }));

  const toAdd = [];
  desiredSet.forEach((orig, key) => {
    if (!existing.some(e => e.key === key)) {
      toAdd.push({ kind: 'add', name: orig });
    }
  });

  const toRemove = [];
  existing.forEach(e => {
    if (!desiredSet.has(e.key)) {
      toRemove.push({ kind: 'remove', id: e.id, name: e.name });
    }
  });

  bulkOpsQueue = [...toAdd, ...toRemove];
  bulkOpsSkipAll = false;

  if (!bulkOpsQueue.length) {
    toast('Danh sách trùng hoàn toàn, không có gì thay đổi.');
    return;
  }
  showNextBulkOp();
}

export function showNextBulkOp() {
  if (bulkOpsSkipAll) {
    hideConfirmModal();
    return;
  }
  bulkOpsCurrent = bulkOpsQueue.shift() || null;
  if (!bulkOpsCurrent) { hideConfirmModal(); toast('Đã xử lý xong danh sách.'); return; }

  const titleEl = document.getElementById('confirm-modal-title');
  const bodyEl = document.getElementById('confirm-modal-body');
  const modal = document.getElementById('confirm-modal');
  if (!titleEl || !bodyEl || !modal) return;

  if (bulkOpsCurrent.kind === 'add') {
    titleEl.textContent = 'Thêm thành viên mới?';
    bodyEl.innerHTML = `Tên: <b>${bulkOpsCurrent.name}</b><br>Bạn có muốn thêm vào danh sách liên minh không?`;
  } else if (bulkOpsCurrent.kind === 'remove') {
    titleEl.textContent = 'Loại bỏ thành viên?';
    bodyEl.innerHTML = `Tên: <b>${bulkOpsCurrent.name}</b><br>Tên này KHÔNG còn trong danh sách nhập. Bạn có muốn xóa khỏi hệ thống không?`;
  }
  modal.style.display = 'flex';
}

export function hideConfirmModal() {
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.style.display = 'none';
}

export function confirmModalApply() {
  if (!bulkOpsCurrent) { hideConfirmModal(); return; }
  if (bulkOpsCurrent.kind === 'add') {
    addMemberWithName(bulkOpsCurrent.name);
  } else if (bulkOpsCurrent.kind === 'remove') {
    deleteMemberInternal(bulkOpsCurrent.id);
  }
  renderMemberList();
  renderEntryList();
  renderBXH();
  showNextBulkOp();
}

export function confirmModalSkip() {
  showNextBulkOp();
}

export function confirmModalCancelAll() {
  bulkOpsQueue = [];
  bulkOpsCurrent = null;
  bulkOpsSkipAll = true;
  hideConfirmModal();
}

// ==========================================
// 4. DATA ENTRY (NHẬP LIỆU)
// ==========================================
let activeMemberId = null;
let modeAdd = { kill: true, destroy: true }; // True = Cộng dồn, False = Thay thế
let entryHighlightedIndex = -1;
let entryListEscClosed = false;

export function toggleAdd(type) {
  modeAdd[type] = !modeAdd[type];
  const btn = document.getElementById('btn-add-' + type);
  const inp = document.getElementById('inp-' + type);
  btn.classList.toggle('active', modeAdd[type]);
  inp.placeholder = modeAdd[type] ? "Nhập số cần CỘNG THÊM..." : "Nhập số thay thế (Ghi đè)...";
}

export function renderEntryList() {
  const query = document.getElementById('search-entry').value.toLowerCase();
  const list = state.members.filter(m => m.name.toLowerCase().includes(query));
  
  const container = document.getElementById('entry-member-list');
  if (entryListEscClosed) {
    container.innerHTML = '';
    return;
  }
  if (list.length === 0) {
    entryHighlightedIndex = -1;
    container.innerHTML = '';
    return;
  }
  if (entryHighlightedIndex >= list.length) entryHighlightedIndex = list.length - 1;
  if (entryHighlightedIndex < -1) entryHighlightedIndex = -1;
  container.innerHTML = list.map(m => `
    <div class="list-item ${activeMemberId === m.id ? 'selected' : ''}" data-entry-id="${m.id}" onclick="selectForEntry('${m.id}')">
      <span class="member-name">${m.name}</span>
      <span style="font-size:0.8rem; color:var(--text-dim)">Chọn ➔</span>
    </div>
  `).join('');
  if (entryHighlightedIndex >= 0) {
    const rows = container.querySelectorAll('.list-item');
    const row = rows[entryHighlightedIndex];
    if (row) {
      row.classList.add('selected');
      row.scrollIntoView({ block: 'nearest' });
    }
  }
}

export function selectForEntry(id) {
  activeMemberId = id;
  const m = state.members.find(x => x.id === id);
  const s = getStats(id);
  const weekVal = getTowerWeekFor(id);
  
  document.getElementById('form-title').innerHTML = `Đang thao tác: <strong style="color:var(--gold-light)">${m.name}</strong>`;
  document.getElementById('cur-kill').textContent = s.kills.toLocaleString();
  document.getElementById('cur-destroy').textContent = s.destroy.toLocaleString();
  const elWeek = document.getElementById('cur-tower-week');
  const elTotal = document.getElementById('cur-tower-total');
  if (elWeek) elWeek.textContent = weekVal.toLocaleString();
  if (elTotal) elTotal.textContent = (s.tower || 0).toLocaleString();
  
  // Clear inputs
  document.getElementById('inp-kill').value = '';
  document.getElementById('inp-destroy').value = '';
  const inpDirect = document.getElementById('inp-speed-total');
  if (inpDirect) inpDirect.value = '';
  
  document.getElementById('entry-form').style.display = 'block';
  renderEntryList(); // re-render to highlight selected
  setTimeout(() => {
    document.getElementById('inp-kill')?.focus();
  }, 50);
}

export function closeEntryForm() {
  activeMemberId = null;
  document.getElementById('entry-form').style.display = 'none';
  renderEntryList();
}

export function logAction(memberId, type, amount, oldVal, extra) {
  state.logs.unshift({
    logId: 'log_' + Date.now() + Math.random(),
    memberId, type, amount, oldVal,
    extra: extra || null,
    time: new Date().getTime()
  });
  if(state.logs.length > 50) state.logs.pop(); // Keep only last 50
}

export function logMemberChange(kind, payload) {
  if (!state.memberLogs) state.memberLogs = [];
  state.memberLogs.unshift({
    id: 'ml_' + Date.now() + Math.random(),
    kind,
    payload,
    time: Date.now()
  });
  if (state.memberLogs.length > 200) state.memberLogs.pop();
}

export function getEntryMemberOrder() {
  const query = (document.getElementById('search-entry')?.value || '').toLowerCase();
  return state.members.filter(m => m.name.toLowerCase().includes(query));
}

export function syncMemberHistoryV2ForMember(memberId, overrides) {
  const m = state.members.find((x) => x.id === memberId);
  if (!m) return;
  const s = getStats(memberId);
  const chestMap = buildMemberChestMap(computeBXH());
  const now = Date.now();
  const record = {
    name: m.name,
    kills: Number(s.kills) || 0,
    sabotage: Number(s.destroy) || 0,
    speed_total: Number(s.towerWeek) || 0,
    speed_start: s.speed_start == null ? null : Number(s.speed_start) || 0,
    speed_end: s.speed_end == null ? null : Number(s.speed_end) || 0,
    chest: chestMap[memberId] || '',
    last_updated: now,
    ...(overrides || {})
  };
  upsertMemberHistoryV2(memberId, record).then(() => {
    renderHistory();
  }).catch(() => {});
}

export function applyEntryChanges() {
  if (!activeMemberId) return { changed: false };
  if (!state.stats[activeMemberId]) {
    state.stats[activeMemberId] = { kills: 0, destroy: 0, tower: 0, towerWeek: 0, speed_start: 0, speed_end: 0, speed_total: 0 };
  }
  const s = state.stats[activeMemberId];
  if (typeof s.kills === 'undefined' || isNaN(s.kills)) s.kills = 0;
  if (typeof s.destroy === 'undefined' || isNaN(s.destroy)) s.destroy = 0;
  if (typeof s.tower === 'undefined' || isNaN(s.tower)) s.tower = 0;
  if (typeof s.towerWeek === 'undefined' || isNaN(s.towerWeek)) s.towerWeek = 0;

  const inKill = parseInt(document.getElementById('inp-kill').value, 10);
  const inDes = parseInt(document.getElementById('inp-destroy').value, 10);
  const rawTowTotalDirect = document.getElementById('inp-speed-total')?.value;

  let changed = false;

  if (!isNaN(inKill)) {
    const old = Number(s.kills) || 0;
    const add = Number(inKill) || 0;
    s.kills = modeAdd.kill ? old + add : add;
    logAction(activeMemberId, 'kill', inKill, old);
    changed = true;
  }

  if (!isNaN(inDes)) {
    const old = Number(s.destroy) || 0;
    const add = Number(inDes) || 0;
    s.destroy = modeAdd.destroy ? old + add : add;
    logAction(activeMemberId, 'destroy', inDes, old);
    changed = true;
  }

  const directTrim = (rawTowTotalDirect || '').trim();
  const hasDirect = directTrim !== '' && !isNaN(parseInt(directTrim, 10));
  if (hasDirect) {
    const directTotal = Math.max(0, parseInt(directTrim, 10) || 0);
    const old = Number(s.towerWeek) || 0;
    s.towerWeek = directTotal;
    s.speed_total = directTotal;
    s.speed_start = null;
    s.speed_end = null;
    logAction(activeMemberId, 'tower', directTotal, old, { mode: 'direct' });
    changed = true;
  }

  return { changed };
}

export function saveEntry(opts) {
  opts = opts || {};
  const saveBtn = document.querySelector('#entry-form .btn-gold');
  if (saveBtn && saveBtn.disabled) return;
  if (!activeMemberId) return;

  const res = applyEntryChanges();
  if (res.error) return;

  const focusSearchAfter = !!opts.focusSearchAfter;
  if (!res.changed && !focusSearchAfter) {
    toast('⚠️ Bạn chưa nhập số nào vào ô!');
    return;
  }

  if (res.changed) {
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '⏳ Đang xử lý...';
      saveBtn.style.opacity = '0.7';
    }
    bumpUpdatedAt();
    saveAll();
    syncMemberHistoryV2ForMember(activeMemberId);
    toast('Đã lưu.');
  }

  const curId = activeMemberId;
  const advanceNext = !!opts.advanceNext;

  const restoreBtn = () => {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Lưu thông số';
      saveBtn.style.opacity = '1';
    }
  };

  if (focusSearchAfter) {
    setTimeout(() => {
      restoreBtn();
      const sea = document.getElementById('search-entry');
      if (sea) {
        sea.focus();
        sea.select();
      }
      document.getElementById('inp-kill').value = '';
      document.getElementById('inp-destroy').value = '';
      const inpDirect = document.getElementById('inp-speed-total');
      if (inpDirect) inpDirect.value = '';
      const m = state.members.find((x) => x.id === curId);
      if (m) {
        const s = getStats(curId);
        const weekVal = getTowerWeekFor(curId);
        document.getElementById('cur-kill').textContent = s.kills.toLocaleString();
        document.getElementById('cur-destroy').textContent = s.destroy.toLocaleString();
        const elWeek = document.getElementById('cur-tower-week');
        const elTotal = document.getElementById('cur-tower-total');
        if (elWeek) elWeek.textContent = weekVal.toLocaleString();
        if (elTotal) elTotal.textContent = (s.tower || 0).toLocaleString();
      }
    }, 50);
    return;
  }

  if (!res.changed) return;

  setTimeout(() => {
    restoreBtn();
    if (advanceNext) {
      const order = getEntryMemberOrder();
      const idx = order.findIndex(m => m.id === curId);
      const next = idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null;
      if (next) {
        selectForEntry(next.id);
        const k = document.getElementById('inp-kill');
        if (k) k.focus();
      } else {
        closeEntryForm();
      }
    } else {
      closeEntryForm();
    }
  }, 450);
}

// ==========================================
// 5. HISTORY & UNDO
// ==========================================
export function copyWeekHistoryJsonByIndex(idx) {
  const w = state.weekHistory[idx];
  if (!w) return;
  const snap = w.data || w;
  navigator.clipboard.writeText(JSON.stringify(snap, null, 2)).then(() => toast('Đã copy JSON tuần.'));
}

export function renderHistoryBXH(snapshot) {
  if (!snapshot || !snapshot.members) return '<div class="card">Không có snapshot BXH.</div>';
  const cfg = snapshot.chest_config_snapshot || { chests: [] };
  const rule = snapshot.rule_mode || 'waterfall';
  const rows = (snapshot.members || []).map((m) => ({
    id: m.member_id || m.name,
    name: m.name,
    kills: Number(m.kills) || 0,
    destroy: Number(m.sabotage) || 0,
    towerWeek: Number(m.speed) || 0,
    isAccountant: !!m.isAccountant
  }));
  const chests = calculateRankings(rows, cfg, rule);
  return renderBXHCardsFromChests(chests);
}

export function renderHistory() {
  const container = document.getElementById('history-content');
  const historyV2 = getMemberHistoryV2Doc();
  const membersMap = historyV2.members && typeof historyV2.members === 'object' ? historyV2.members : {};
  const memberRows = Object.entries(membersMap)
    .map(([memberId, row]) => ({ memberId, ...(row || {}) }))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));
  const memberTable = memberRows.length ? `
    <h4 style="font-family:'Cinzel',serif; font-size:0.9rem; color:var(--gold); margin-bottom:0.4rem;">Lịch sử tuần hiện tại (${historyV2.week_id || ''})</h4>
    <table>
      <thead><tr><th>Tên</th><th class="num">Diệt</th><th class="num">Phá</th><th class="num">Tốc</th><th>Rương</th><th></th></tr></thead>
      <tbody>
        ${memberRows.map((row) => `
          <tr>
            <td class="member-name">${row.name || ''}</td>
            <td class="num">${(Number(row.kills) || 0).toLocaleString()}</td>
            <td class="num">${(Number(row.sabotage) || 0).toLocaleString()}</td>
            <td class="num">${(Number(row.speed_total) || 0).toLocaleString()}</td>
            <td>${row.chest || ''}</td>
            <td style="white-space:nowrap;">
              <button class="btn btn-sm" onclick="editHistoryMember('${row.memberId}')"><i class="fa-solid fa-pen"></i> Edit</button>
              <button class="btn btn-sm btn-red" onclick="deleteHistoryMember('${row.memberId}')">Xóa</button>
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  ` : '<div style="padding:1rem; text-align:center">Chưa có dữ liệu lịch sử tuần hiện tại.</div>';

  const weekHistory = state.weekHistory || [];
  const weekCards = weekHistory.length ? `
    <h4 style="font-family:'Cinzel',serif; font-size:0.9rem; color:var(--gold); margin:1rem 0 0.4rem;">Lịch sử BXH theo tuần</h4>
    <div class="week-history-list">
      ${weekHistory.map((w, idx) => {
        const snap = w.data || w;
        const weekId = snap.week_id || w.week_id || '';
        const closed = snap.closed_at || w.closed_at || w.createdAt || Date.now();
        const tStr = new Date(closed).toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
        const sum = snap.summary || {};
        const bxhHtml = renderHistoryBXH(snap);
        return `
        <details class="week-history-card card" style="margin-bottom:0.75rem;">
          <summary style="cursor:pointer; list-style:none;">
            <div style="font-weight:700;color:var(--gold);">Tuần ${weekId} — Chốt: ${tStr}</div>
            <div style="font-size:0.75rem;color:var(--text-dim);margin-top:0.25rem;">
              Tổng diệt: ${(sum.total_kills||0).toLocaleString()} | Tổng phá: ${(sum.total_sabotage||0).toLocaleString()} | Tổng tốc: ${(sum.total_speed||0).toLocaleString()}
            </div>
          </summary>
          <div style="margin-top:0.75rem;">${bxhHtml}</div>
          <div style="margin-top:0.5rem;text-align:right;">
            <button type="button" class="btn btn-sm" onclick="copyWeekHistoryJsonByIndex(${idx})">Copy JSON</button>
          </div>
        </details>`;
      }).join('')}
    </div>
  ` : '';

  container.innerHTML = memberTable + weekCards;
}

export function editHistoryMember(memberId) {
  const historyV2 = getMemberHistoryV2Doc();
  const row = historyV2.members?.[memberId];
  if (!row) return;
  const idEl = document.getElementById('edit-history-member-id');
  const nameEl = document.getElementById('edit-history-member-name');
  const killEl = document.getElementById('edit-history-member-kills');
  const sabEl = document.getElementById('edit-history-member-sabotage');
  const speedEl = document.getElementById('edit-history-member-speed-total');
  const chestEl = document.getElementById('edit-history-member-chest');
  const modal = document.getElementById('edit-history-member-modal');
  if (!idEl || !nameEl || !killEl || !sabEl || !speedEl || !chestEl || !modal) return;
  idEl.value = memberId;
  nameEl.value = row.name || '';
  killEl.value = Number(row.kills) || 0;
  sabEl.value = Number(row.sabotage) || 0;
  speedEl.value = Number(row.speed_total) || 0;
  chestEl.value = row.chest || '';
  modal.style.display = 'flex';
}

export function closeHistoryMemberEditModal() {
  const modal = document.getElementById('edit-history-member-modal');
  if (modal) modal.style.display = 'none';
}

export async function applyHistoryMemberEdit() {
  const idEl = document.getElementById('edit-history-member-id');
  const nameEl = document.getElementById('edit-history-member-name');
  const killEl = document.getElementById('edit-history-member-kills');
  const sabEl = document.getElementById('edit-history-member-sabotage');
  const speedEl = document.getElementById('edit-history-member-speed-total');
  const chestEl = document.getElementById('edit-history-member-chest');
  if (!idEl || !nameEl || !killEl || !sabEl || !speedEl || !chestEl) return;
  const memberId = idEl.value;
  const record = {
    name: (nameEl.value || '').trim(),
    kills: Math.max(0, parseInt(killEl.value || '0', 10) || 0),
    sabotage: Math.max(0, parseInt(sabEl.value || '0', 10) || 0),
    speed_total: Math.max(0, parseInt(speedEl.value || '0', 10) || 0),
    speed_start: null,
    speed_end: null,
    chest: (chestEl.value || '').trim(),
    last_updated: Date.now()
  };
  await upsertMemberHistoryV2(memberId, record);
  closeHistoryMemberEditModal();
  renderHistory();
  toast('Đã cập nhật lịch sử thành viên.');
}

export async function deleteHistoryMember(memberId) {
  const historyV2 = getMemberHistoryV2Doc();
  const row = historyV2.members?.[memberId];
  if (!row) return;
  if (!confirm(`Xóa thành viên ${row.name || memberId} khỏi lịch sử tuần này?`)) return;
  await removeMemberHistoryV2(memberId);
  renderHistory();
  toast('Đã xóa khỏi lịch sử tuần này.');
}

export function undoLog(logId) {
  const logIndex = state.logs.findIndex(l => l.logId === logId);
  if(logIndex === -1) return;
  const log = state.logs[logIndex];
  
  // Undo logic
  if(state.stats[log.memberId]) {
    if(log.type === 'tower') {
      state.stats[log.memberId].tower = log.oldVal; // Revert to old value
    } else {
      // It was an addition, so we subtract
      state.stats[log.memberId][log.type] -= log.amount; 
      if(state.stats[log.memberId][log.type] < 0) state.stats[log.memberId][log.type] = 0;
    }
  }
  
  // Remove log
  state.logs.splice(logIndex, 1);
  bumpUpdatedAt();
  saveAll();
  renderHistory();
  toast('Đã hoàn tác.');
}

export function computeBXH() {
  ensureWeek();
  const cfg = getFirebaseChestConfig(state);
  const ruleMode = getRuleMode(state);
  const data = state.members.map(m => {
    const s = getStats(m.id);
    return {
      ...m,
      ...s,
      towerWeek: getTowerWeekFor(m.id)
    };
  });
  return calculateRankings(data, cfg, ruleMode);
}

export function valKeyFromCriteria(crit) {
  if (crit === 'sabotage') return 'destroy';
  if (crit === 'speed') return 'towerWeek';
  return 'kills';
}

export function buildTable(list, valKey, suffix, opts) {
  opts = opts || {};
  if(list.length === 0) return '<div style="font-size:0.8rem; color:var(--text-dim); padding:0.5rem">Chưa có dữ liệu</div>';
  return `
    <table>
      ${list.map((m,i) => {
        const accountantBadge = (opts.showAccountant && m.isAccountant)
          ? ' <span class="badge-accountant" title="Slot Kế Toán"><i class="fa-solid fa-coins"></i> Kế toán</span>'
          : '';
        return `
        <tr class="${m.isAccountant && opts.showAccountant ? 'row-accountant' : ''}">
          <td width="30"><span class="rank-num ${i<3?'rank-'+(i+1):''}">${i+1}</span></td>
          <td>
            <div class="member-name">${m.name}${accountantBadge}</div>
            <div style="font-size:0.75rem; color:var(--text-dim); margin-top:0.1rem;">
              Tổng diệt: <b>${(m.kills || 0).toLocaleString()}</b> • 
              Tổng phá: <b>${(m.destroy || 0).toLocaleString()}</b> • 
              Lượt tháp tuần: <b>${(m.towerWeek || 0).toLocaleString()}</b> (tổng trong game: <b>${(m.tower || 0).toLocaleString()}</b>)
            </div>
          </td>
          <td align="right" style="color:var(--text-main); white-space:nowrap;">
            ${(Number(m[valKey]) || 0).toLocaleString()} ${suffix}
          </td>
        </tr>
      `;
      }).join('')}
    </table>
  `;
}

export function renderBXHCardsFromChests(chests) {
  const metricLabel = { kills: 'điểm', destroy: 'điểm', towerWeek: 'lượt' };
  const badgeCls = ['b-r1', 'b-r2', 'b-r3', 'b-r4'];
  if (!chests || !chests.length) {
    return '<div class="card">Chưa có cấu hình rương (đồng bộ từ Firebase: settings/chest_config).</div>';
  }
  return chests.map((chest, idx) => {
    const totalPhy = Number(chest.total_chests) || 0;
    const pinnedRows = (chest.pinned || []).length ? `
      <table><tbody>
      ${(chest.pinned || []).map(m => `
        <tr class="row-accountant">
          <td width="30"><span class="rank-num rank-kt">K</span></td>
          <td><div class="member-name">${m.name} <span class="badge-accountant"><i class="fa-solid fa-coins"></i> Kế toán</span></div></td>
          <td align="right">${(m.kills || 0).toLocaleString()} điểm</td>
        </tr>`).join('')}
      </tbody></table>
    ` : '';
    const groupBlocks = (chest.groups || []).map(g => {
      const vk = valKeyFromCriteria(g.criteria);
      return `
      <div style="font-size:0.7rem; color:var(--text-dim); margin:0.7rem 0 0.35rem 0">${g.label || g.criteria}</div>
      ${buildTable(g.list || [], vk, metricLabel[vk] || '')}
    `;
    }).join('');
    return `
      <div class="card">
        <div class="card-title"><span class="badge ${badgeCls[idx] || 'b-r4'}">${chest.name} (x${totalPhy})</span></div>
        ${pinnedRows}
        ${groupBlocks}
      </div>
    `;
  }).join('');
}

export function renderBXH() {
  ensureWeek();
  const chests = computeBXH();
  document.getElementById('bxh-content').innerHTML = renderBXHCardsFromChests(chests);
}

export function resetWeek() {
  if(confirm('Hành động này sẽ đưa TOÀN BỘ điểm Diệt, Phá, Tháp của TẤT CẢ thành viên về 0. Bạn có chắc không?')) {
    state.members.forEach(m => { state.stats[m.id] = {kills:0, destroy:0, tower:0, towerWeek:0, speed_start:0, speed_end:0, speed_total:0}; });
    state.logs = []; // Xoá luôn lịch sử
    bumpUpdatedAt();
    saveAll();
    renderBXH();
    toast('Đã reset dữ liệu.');
  }
}

export function copyBXH() {
  const chests = computeBXH();
  let txt = `TỔNG KẾT RƯƠNG LIÊN MINH\n\n`;
  chests.forEach((chest) => {
    txt += `${chest.name}:\n`;
    (chest.pinned || []).forEach((m, i) => {
      txt += `K${i + 1}. ${m.name} [Kế toán]\n`;
    });
    (chest.groups || []).forEach((g) => {
      txt += `[${g.label || g.criteria}]\n`;
      (g.list || []).forEach((m, i) => {
        txt += `${i + 1}. ${m.name} (Diệt: ${(m.kills || 0).toLocaleString()}, Phá: ${(m.destroy || 0).toLocaleString()}, Tăng tốc tuần: ${(m.towerWeek || 0).toLocaleString()})\n`;
      });
    });
    txt += `\n`;
  });

  navigator.clipboard.writeText(txt).then(() => toast('Đã copy BXH.'));
}

export function openTowerEntryFromMembers(id) {
  showPage('enter');
  selectForEntry(id);
  document.getElementById('entry-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

export function newWeekSummary() {
  ensureWeek();
  openNewWeekModal();
}
export function buildMemberChestMap(chestsOut) {
  const map = {};
  (chestsOut || []).forEach((ch) => {
    const cid = ch.id || '';
    (ch.pinned || []).forEach((m) => {
      if (map[m.id] === undefined) map[m.id] = cid;
    });
    (ch.groups || []).forEach((g) => {
      (g.list || []).forEach((m) => {
        if (map[m.id] === undefined) map[m.id] = cid;
      });
    });
  });
  return map;
}

export function buildWeeklySnapshotDoc() {
  const anchor = state.meta?.weekAnchorMs || getWeekAnchorMs();
  const week_id = state.meta?.currentWeekId || getWeekId(anchor);
  const cfgSnap = JSON.parse(JSON.stringify(getFirebaseChestConfig(state)));
  const rule_mode = getRuleMode(state);
  const dataRows = state.members.map((m) => {
    const s = getStats(m.id);
    return {
      member_id: m.id,
      name: m.name,
      kills: Number(s.kills) || 0,
      sabotage: Number(s.destroy) || 0,
      speed: Number(s.towerWeek) || 0,
      speed_start: s.speed_start == null ? null : Number(s.speed_start) || 0,
      speed_end: s.speed_end == null ? null : Number(s.speed_end) || 0,
      speed_total: Number(s.speed_total) || 0,
      isAccountant: !!m.isAccountant
    };
  });
  const chestsForAssign = calculateRankings(
    state.members.map((m) => {
      const s = getStats(m.id);
      return { ...m, ...s, towerWeek: getTowerWeekFor(m.id) };
    }),
    cfgSnap,
    rule_mode
  );
  const chestMap = buildMemberChestMap(chestsForAssign);
  const members = dataRows.map((row) => ({
    ...row,
    chest: chestMap[row.member_id] || ''
  }));
  const summary = members.reduce(
    (acc, m) => {
      acc.total_kills += Number(m.kills) || 0;
      acc.total_sabotage += Number(m.sabotage) || 0;
      acc.total_speed += Number(m.speed) || 0;
      return acc;
    },
    { total_kills: 0, total_sabotage: 0, total_speed: 0 }
  );
  const closed_at = Date.now();
  return {
    week_id,
    closed_at,
    rule_mode,
    chest_config_snapshot: cfgSnap,
    members,
    summary
  };
}

export async function saveWeeklyHistoryRecord(doc) {
  if (!state.weekHistory) state.weekHistory = [];
  state.weekHistory.unshift({
    id: doc.week_id,
    week_id: doc.week_id,
    weekAnchorMs: state.meta?.weekAnchorMs || getWeekAnchorMs(),
    label: doc.week_id,
    createdAt: doc.closed_at,
    closed_at: doc.closed_at,
    rule_mode: doc.rule_mode,
    chest_config_snapshot: doc.chest_config_snapshot,
    members: doc.members,
    summary: doc.summary,
    data: doc
  });
  if (state.weekHistory.length > 50) state.weekHistory.pop();
  if (cloud.enabled && cloud.db) {
    await cloud.db.collection('weekly_history').doc(doc.week_id).set(doc, { merge: true });
  }
}

export async function finalizeCurrentWeekAndReset() {
  const shouldSyncCloud = arguments.length > 0 ? !!arguments[0] : false;
  try {
    const doc = buildWeeklySnapshotDoc();
    await saveWeeklyHistoryRecord(doc);
    state.members.forEach((m) => {
      state.stats[m.id] = {
        kills: 0,
        destroy: 0,
        tower: 0,
        towerWeek: 0,
        speed_total: 0,
        speed_start: null,
        speed_end: null
      };
    });
    const nextAnchor = (state.meta?.weekAnchorMs || getWeekAnchorMs()) + 7 * 24 * 3600 * 1000;
    state.meta.weekAnchorMs = nextAnchor;
    state.meta.weekLabel = formatWeekLabel(nextAnchor);
    state.meta.currentWeekId = getWeekId(nextAnchor);
    if (cloud.enabled && cloud.db && shouldSyncCloud) {
      await cloud.db.collection('settings').doc('current_week').set({
        current_week: state.meta.currentWeekId,
        updated_at: Date.now()
      }, { merge: true });
      const membersPayload = {};
      state.members.forEach((m) => {
        const s = getStats(m.id);
        membersPayload[m.id] = {
          name: m.name,
          kills: Number(s.kills) || 0,
          sabotage: Number(s.destroy) || 0,
          speed_total: Number(s.towerWeek) || 0,
          speed_start: null,
          speed_end: null,
          chest: '',
          last_updated: Date.now()
        };
      });
      await cloud.db.collection('minhchu_bxh').doc('current_week').set({
        week_id: state.meta.currentWeekId,
        updated_at: Date.now(),
        members: membersPayload
      });
    }
    bumpUpdatedAt();
    saveAll();
    renderBXH();
    renderHistory();
    closeNewWeekModal();
    toast('Đã cập nhật tuần mới ✓', 3000);
  } catch (e) {
    toast('Lỗi khi cập nhật tuần mới.');
  }
}

let newWeekModalStep = 1;
export function openNewWeekModal() {
  newWeekModalStep = 1;
  renderNewWeekModalStep();
  const modal = document.getElementById('new-week-modal');
  if (modal) modal.style.display = 'flex';
}
export function closeNewWeekModal() {
  const modal = document.getElementById('new-week-modal');
  if (modal) modal.style.display = 'none';
}
export function nextNewWeekModalStep() {
  newWeekModalStep = 2;
  renderNewWeekModalStep();
}
export function skipNewWeekSync() {
  finalizeCurrentWeekAndReset(false);
}
export function syncAndFinalizeNewWeek() {
  finalizeCurrentWeekAndReset(true);
}
export function renderNewWeekModalStep() {
  const titleEl = document.getElementById('new-week-modal-title');
  const bodyEl = document.getElementById('new-week-modal-body');
  const actionsEl = document.getElementById('new-week-modal-actions');
  if (!titleEl || !bodyEl || !actionsEl) return;
  if (newWeekModalStep === 1) {
    titleEl.textContent = 'Cập nhật tuần mới';
    bodyEl.innerHTML = 'Thao tác này sẽ:<br>✓ Lưu dữ liệu tuần hiện tại vào Lịch sử<br>✓ Reset toàn bộ số liệu về 0<br>Bạn có chắc chắn không?';
    actionsEl.innerHTML = `
      <button type="button" class="btn btn-red" onclick="closeNewWeekModal()">Huỷ</button>
      <button type="button" class="btn btn-gold" onclick="nextNewWeekModalStep()">Tiếp tục →</button>
    `;
    return;
  }
  titleEl.textContent = 'Đồng bộ dữ liệu?';
  bodyEl.innerHTML = 'Bạn có muốn đồng bộ lên Firebase để các thiết bị khác (điện thoại) cũng được cập nhật ngay không?';
  actionsEl.innerHTML = `
    <button type="button" class="btn btn-red" onclick="skipNewWeekSync()">Bỏ qua</button>
    <button type="button" class="btn btn-gold" onclick="syncAndFinalizeNewWeek()">Đồng bộ &amp; Hoàn tất</button>
  `;
}


export function handleAtOpenList(ev) {
  if (ev.key === '@') {
    ev.preventDefault();
    ev.target.value = '';
    entryListEscClosed = false;
    entryHighlightedIndex = -1;
    renderEntryList();
    const list = document.getElementById('entry-member-list');
    if (list) list.scrollTop = 0;
    return;
  }
  const isSearch = ev.target && ev.target.id === 'search-entry';
  if (!isSearch) return;
  const order = getEntryMemberOrder();
  if (!order.length) return;
  if (ev.key === 'ArrowDown') {
    ev.preventDefault();
    entryListEscClosed = false;
    entryHighlightedIndex = Math.min(order.length - 1, entryHighlightedIndex + 1);
    renderEntryList();
    return;
  }
  if (ev.key === 'ArrowUp') {
    ev.preventDefault();
    entryListEscClosed = false;
    entryHighlightedIndex = Math.max(0, entryHighlightedIndex - 1);
    renderEntryList();
    return;
  }
  if (ev.key === 'Enter' && entryHighlightedIndex >= 0) {
    ev.preventDefault();
    const selected = order[entryHighlightedIndex];
    if (selected) {
      selectForEntry(selected.id);
      document.getElementById('inp-kill')?.focus();
    }
    return;
  }
  if (ev.key === 'Escape') {
    ev.preventDefault();
    entryListEscClosed = true;
    entryHighlightedIndex = -1;
    renderEntryList();
  }
}

export function handleEntrySearchInput() {
  entryListEscClosed = false;
  entryHighlightedIndex = -1;
  renderEntryList();
}
export function handleEntryInputEnter(ev) {
  if (ev.key !== 'Enter') return;
  ev.preventDefault();
  const id = ev.target?.id;
  const order = ['inp-kill', 'inp-destroy', 'inp-speed-total'];
  const pos = order.indexOf(id);
  if (pos >= 0 && pos < order.length - 1) {
    document.getElementById(order[pos + 1])?.focus();
  } else if (pos === order.length - 1) {
    saveEntry({ focusSearchAfter: true });
  }
}

export function openBulkInputModal() {
  const m = document.getElementById('bulk-input-modal');
  clearBulkErrorLog();
  if (m) m.style.display = 'flex';
}
export function closeBulkInputModal() {
  const m = document.getElementById('bulk-input-modal');
  clearBulkErrorLog();
  if (m) m.style.display = 'none';
}

export function clearBulkErrorLog() {
  const el = document.getElementById('bulk-error-log');
  if (el) el.textContent = '';
}

export function applyBulkInput() {
  const raw1 = (document.getElementById('bulk-inp-kill-des')?.value || '').split('\n');
  const raw2 = (document.getElementById('bulk-inp-speed')?.value || '').split('\n');
  const nameToMember = new Map();
  state.members.forEach((m) => nameToMember.set(m.name.trim().toLowerCase(), m));

  const touched = new Set();
  let skipped = 0;
  const unmatched = [];
  const errorLines = [];

  raw1.forEach((line, idx) => {
    const t = line.trim();
    if (!t) return;
    const match = t.match(/^(.+?)\s+(\d[\d,]*)\s+(\d[\d,]*)$/);
    if (!match) {
      skipped++;
      return;
    }
    const name = match[1].trim();
    const val1 = Number(match[2].replace(/,/g, ''));
    const val2 = Number(match[3].replace(/,/g, ''));
    const m = nameToMember.get(name.toLowerCase());
    if (!m) {
      unmatched.push(name);
      errorLines.push(`Dòng ${idx + 1}: "${t}" — Không tìm thấy thành viên`);
      skipped++;
      return;
    }
    const s = getStats(m.id);
    s.kills = (Number(s.kills) || 0) + (Number(val1) || 0);
    s.destroy = (Number(s.destroy) || 0) + (Number(val2) || 0);
    touched.add(m.id);
  });

  raw2.forEach((line, idx) => {
    const t = line.trim();
    if (!t) return;
    const match = t.match(/^(.+?)\s+(\d[\d,]*)$/);
    if (!match) {
      skipped++;
      return;
    }
    const name = match[1].trim();
    const val = Number(match[2].replace(/,/g, ''));
    const m = nameToMember.get(name.toLowerCase());
    if (!m) {
      if (!unmatched.includes(name)) unmatched.push(name);
      errorLines.push(`Dòng ${idx + 1}: "${t}" — Không tìm thấy thành viên`);
      skipped++;
      return;
    }
    const s = getStats(m.id);
    const add = Number(val) || 0;
    s.towerWeek = (Number(s.towerWeek) || 0) + add;
    s.speed_total = (Number(s.speed_total) || 0) + add;
    if (s.speed_start != null && s.speed_end != null) {
      const ss = Number(s.speed_start) || 0;
      s.tower = ss + (Number(s.towerWeek) || 0);
      s.speed_end = s.tower;
    }
    touched.add(m.id);
  });

  bumpUpdatedAt();
  saveAll();
  touched.forEach((id) => syncMemberHistoryV2ForMember(id));
  renderBXH();
  renderMemberList();
  renderEntryList();
  const logEl = document.getElementById('bulk-error-log');
  if (logEl) {
    logEl.textContent = errorLines.length ? errorLines.join('\n') : '';
  }
  toast(`Đã cập nhật ${touched.size} thành viên, bỏ qua ${skipped} dòng.`);
  if (unmatched.length) {
    toast('Đã ghi log lỗi tên không khớp.');
  }
}

let connectPromptTimer = null;
let connectPromptTimeout = null;
let startupFallbackTimer = null;
let startupFallbackDone = false;
export function showConnectPromptModal() {
  const modal = document.getElementById('connect-prompt-modal');
  if (modal) modal.style.display = 'flex';
}
export function hideConnectPromptModal() {
  const modal = document.getElementById('connect-prompt-modal');
  if (modal) modal.style.display = 'none';
}
export function connectPromptConnect() {
  hideConnectPromptModal();
  connectCloud();
}
export function connectPromptLater() {
  hideConnectPromptModal();
  if (connectPromptTimeout) clearTimeout(connectPromptTimeout);
  connectPromptTimeout = setTimeout(() => {
    connectPromptTimeout = null;
    if (document.getElementById('page-settings')?.classList.contains('active') && !cloud.enabled && getCloudCfg()) {
      showConnectPromptModal();
      startConnectPromptLoop();
    }
  }, 8000);
}
export function startConnectPromptLoop() {
  stopConnectPromptLoop();
  connectPromptTimer = setInterval(() => {
    if (!document.getElementById('page-settings')?.classList.contains('active') || cloud.enabled) {
      stopConnectPromptLoop();
      return;
    }
    if (!getCloudCfg()) return;
    showConnectPromptModal();
  }, 15000);
}
export function stopConnectPromptLoop() {
  if (connectPromptTimer) { clearInterval(connectPromptTimer); connectPromptTimer = null; }
  if (connectPromptTimeout) { clearTimeout(connectPromptTimeout); connectPromptTimeout = null; }
}
export function checkSettingsConnectPrompt() {
  if (cloud.enabled) return;
  if (!getCloudCfg()) return;
  showConnectPromptModal();
  startConnectPromptLoop();
}
export function showStartupConnectOverlay(show) {
  const wrap = document.getElementById('startup-connect');
  if (!wrap) return;
  wrap.style.display = show ? 'flex' : 'none';
}
export function markStartupConnected() {
  startupFallbackDone = true;
  if (startupFallbackTimer) clearTimeout(startupFallbackTimer);
  const btn = document.getElementById('startup-connect-btn');
  if (btn) btn.style.display = 'none';
  showStartupConnectOverlay(false);
}
export function startAutoConnectFallback() {
  if (!getCloudCfg()) return;
  startupFallbackDone = false;
  showStartupConnectOverlay(true);
  const btn = document.getElementById('startup-connect-btn');
  if (btn) btn.style.display = 'none';
  startupFallbackTimer = setTimeout(() => {
    if (cloud.enabled || startupFallbackDone) return;
    const text = document.getElementById('startup-loading-text');
    if (text) text.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Tự động kết nối chưa hoàn tất.';
    if (btn) btn.style.display = 'inline-block';
  }, 3000);
}
export async function manualConnectFromFallback() {
  const ok = await connectCloud();
  if (ok) markStartupConnected();
}

export function applyManualRange() {
  const inpStart = document.getElementById('manual-start');
  const inpEnd = document.getElementById('manual-end');
  if (!inpStart || !inpEnd) return;
  const vStart = inpStart.value;
  const vEnd = inpEnd.value;
  if (!vStart || !vEnd) {
    toast('Vui lòng nhập đầy đủ thời gian Bắt đầu và Kết thúc.');
    return;
  }
  const startMs = Date.parse(vStart);
  const endMs = Date.parse(vEnd);
  if (isNaN(startMs) || isNaN(endMs)) {
    toast('Định dạng thời gian không hợp lệ.');
    return;
  }
  if (endMs <= startMs) {
    toast('Thời gian kết thúc phải lớn hơn thời gian bắt đầu.');
    return;
  }
  if (!state.meta) state.meta = {};
  state.meta.manualRange = { startMs, endMs };
  bumpUpdatedAt();
  saveAll();
  renderBXH();
}

export function clearManualRange() {
  if (state.meta) {
    state.meta.manualRange = null;
  }
  bumpUpdatedAt();
  saveAll();
  renderBXH();
  const inpStart = document.getElementById('manual-start');
  const inpEnd = document.getElementById('manual-end');
  if (inpStart) inpStart.value = '';
  if (inpEnd) inpEnd.value = '';
}

export function updateChestRulesSummary() {
  const el = document.getElementById('chest-rules-summary');
  if (!el) return;
  const c = getFirebaseChestConfig(state);
  const parts = (c.chests || []).map((ch) => {
    const slots = ch.slots || [];
    const sum = slots.reduce((a, s) => a + (Number(s.count) || 0), 0);
    return `${ch.name || ch.id || '?'} (${sum} slot đã cài)`;
  });
  el.textContent = parts.length ? parts.join(' · ') : 'Chưa có cấu hình — kết nối Firebase và lưu từ Admin.';
}

export function slotCountFromChestForCrit(ch, crit) {
  const sl = (ch.slots || []).find((s) => (s.criteria || '') === crit);
  return Math.max(0, Number(sl?.count) || 0);
}

export function readChestSimpleFormToDoc() {
  return {
    chests: CHEST_UI_ROW_META.map((meta, i) => {
      const nk = Math.max(0, parseInt(document.getElementById(`chest-ui-${i}-kills`)?.value || '0', 10) || 0);
      const ns = Math.max(0, parseInt(document.getElementById(`chest-ui-${i}-sabotage`)?.value || '0', 10) || 0);
      const nt = Math.max(0, parseInt(document.getElementById(`chest-ui-${i}-speed`)?.value || '0', 10) || 0);
      const reserved = meta.reserved_slots;
      // Tổng rương phải đúng bằng tổng slot cạnh tranh (không cộng thêm reserved).
      const total_chests = nk + ns + nt;
      return {
        id: meta.id,
        name: meta.name,
        total_chests,
        reserved_slots: reserved,
        exclude_higher_chest: meta.exclude_higher_chest,
        slots: [
          { criteria: 'kills', count: nk, label: 'Top Diệt' },
          { criteria: 'sabotage', count: ns, label: 'Top Phá' },
          { criteria: 'speed', count: nt, label: 'Top Tốc' }
        ]
      };
    })
  };
}

export function fillChestCfgUI() {
  const sel = document.getElementById('rule-mode-select');
  if (sel) sel.value = getRuleMode(state);
  const fallback = DEFAULT_CHEST_CONFIG.chests;
  const remote = state.meta?.firebaseChestConfig?.chests;
  for (let i = 0; i < 4; i++) {
    const ch = (remote && remote[i]) || fallback[i] || {};
    const setEl = (suffix, val) => {
      const el = document.getElementById(`chest-ui-${i}-${suffix}`);
      if (el) el.value = val;
    };
    setEl('kills', slotCountFromChestForCrit(ch, 'kills'));
    setEl('sabotage', slotCountFromChestForCrit(ch, 'sabotage'));
    setEl('speed', slotCountFromChestForCrit(ch, 'speed'));
  }
}

export async function saveChestCfg() {
  if (!state.meta) state.meta = {};
  const doc = readChestSimpleFormToDoc();
  state.meta.firebaseChestConfig = doc;
  if (cloud.enabled && cloud.db) {
    try {
      await cloud.db.collection('settings').doc('chest_config').set(doc);
      bumpUpdatedAt();
      saveAll();
      renderBXH();
      updateChestRulesSummary();
      toast('Đã lưu cấu hình lên máy chủ thành công!');
    } catch (e) {
      toast('Lỗi ghi Firebase. Kiểm tra rules (settings/chest_config).');
    }
  } else {
    bumpUpdatedAt();
    saveAll();
    renderBXH();
    updateChestRulesSummary();
    toast('Chưa kết nối Firebase — đã lưu cục bộ trên trình duyệt.');
  }
}

export async function saveRuleModeFromUI() {
  const sel = document.getElementById('rule-mode-select');
  const v = sel ? sel.value : 'waterfall';
  if (!state.meta) state.meta = {};
  state.meta.ruleMode = v;
  if (cloud.enabled && cloud.db) {
    await cloud.db.collection('settings').doc('rule_mode').set({ rule_mode: v, updated_at: Date.now() }, { merge: true });
  }
  bumpUpdatedAt();
  saveAll();
  renderBXH();
  toast('Đã lưu chế độ tính BXH.');
}

export function unlockAdminChestConfig() {
  const pass = document.getElementById('admin-password')?.value || '';
  if (pass === 'admin123') {
    const panel = document.getElementById('admin-chest-panel');
    if (panel) panel.style.display = 'block';
    fillChestCfgUI();
    updateChestRulesSummary();
  } else {
    alert('Mật khẩu không đúng');
  }
}

export function applyViewModeFromUrl() {
  const q = new URLSearchParams(location.search);
  const view = (q.get('view') || '').toLowerCase();
  if (!view) return;
  const navBtns = Array.from(document.querySelectorAll('.nav .nav-btn'));
  const show = new Set();
  if (view === 'leader' || view === 'bxh') show.add('bxh');
  if (view === 'entry') show.add('enter').add('members').add('history').add('settings');
  if (show.size === 0) return;

  navBtns.forEach(btn => {
    const onclick = btn.getAttribute('onclick') || '';
    const m = onclick.match(/showPage\('([^']+)'\)/);
    const pageId = m ? m[1] : '';
    if (!show.has(pageId)) btn.style.display = 'none';
  });
  if (show.has('bxh')) {
    showPage('bxh');
  } else {
    const first = Array.from(show)[0];
    if (first) showPage(first);
  }
  if ((location.pathname || '').toLowerCase().includes('/admin')) {
    showPage('settings');
  }
}