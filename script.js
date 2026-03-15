// ==========================================
// 1. DATA STATE & STORAGE
// ==========================================
let state = {
  members: [], // {id, name, joinedAt, isAccountant?}
  stats: {},   // {id: {kills, destroy, tower}}
  logs: [],    // {logId, memberId, type(kill/destroy/tower), amount, oldVal, time}
  towerBase: {}, // {id: {weekAnchorMs, baseTotal}}
  meta: {
    updatedAt: 0,
    weekAnchorMs: 0, // computed "week start" anchor (Mon 21:00)
    weekLabel: "",
    manualRange: null // {startMs, endMs}
  },
  memberLogs: [] // {id, kind, payload, time}
};

const STORAGE_KEY = 'minhchu_v4';
const CLOUD_CFG_KEY = 'minhchu_cloud_cfg_v1';

function saveLocal() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function load() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { state = JSON.parse(raw); } catch(e) {}
  }
  // Ensure stats object exists for backward compatibility
  state.members.forEach(m => {
    if(!state.stats[m.id]) state.stats[m.id] = {kills:0, destroy:0, tower:0};
  });
  if (!state.meta) state.meta = { updatedAt: 0, weekAnchorMs: 0, weekLabel: "" };
  if (!state.towerBase) state.towerBase = {};
  if (!state.memberLogs) state.memberLogs = [];
  // Chỉ cho phép 1 kế toán: giữ người đầu tiên được đánh dấu
  const accountants = state.members.filter(m => m.isAccountant);
  if (accountants.length > 1) {
    state.members.forEach(m => { m.isAccountant = false; });
    state.members.find(m => m.id === accountants[0].id).isAccountant = true;
  }
}

function getStats(id) { return state.stats[id] || {kills:0, destroy:0, tower:0}; }

// ==========================================
// WEEK / TOWER RULES (Mon 21:00 → Sun 21:00)
// ==========================================
function getWeekAnchorMs(nowMs = Date.now()) {
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

function formatWeekLabel(anchorMs) {
  const start = new Date(anchorMs);
  const end = new Date(anchorMs + 6 * 24 * 3600 * 1000);
  const f = (x) => x.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
  return `${f(start)} (T2 21:00) → ${f(end)} (CN 21:00)`;
}

function ensureWeek() {
  const anchor = getWeekAnchorMs();
  if (!state.meta) state.meta = { updatedAt: 0, weekAnchorMs: 0, weekLabel: "" };
  if (state.meta.weekAnchorMs !== anchor) {
    state.meta.weekAnchorMs = anchor;
    state.meta.weekLabel = formatWeekLabel(anchor);
    // Reset tower baselines to current totals (first open after week start)
    state.members.forEach(m => {
      const s = getStats(m.id);
      state.towerBase[m.id] = { weekAnchorMs: anchor, baseTotal: s.tower || 0 };
    });
    bumpUpdatedAt();
    saveAll();
  }
  updateWeekLabelView();
}

function updateWeekLabelView() {
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

function getTowerWeekFor(memberId) {
  const anchor = state.meta?.weekAnchorMs || getWeekAnchorMs();
  const s = getStats(memberId);
  const base = state.towerBase?.[memberId];
  if (!base || base.weekAnchorMs !== anchor) {
    // New member, or missing baseline → start counting from now / join time
    if (!state.towerBase) state.towerBase = {};
    state.towerBase[memberId] = { weekAnchorMs: anchor, baseTotal: s.tower || 0 };
    bumpUpdatedAt();
    saveAll();
    return 0;
  }
  return Math.max(0, (s.tower || 0) - (base.baseTotal || 0));
}

// ==========================================
// 2. NAVIGATION & UI HELPERS
// ==========================================
function showPage(pageId) {
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
  if(pageId === 'settings') checkSettingsConnectPrompt();
}

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

// ==========================================
// 3. MEMBER MANAGEMENT
// ==========================================
function addMember() {
  const name = document.getElementById('inp-new-member').value.trim();
  if(!name) return;
  if(state.members.some(m => m.name.toLowerCase() === name.toLowerCase())) {
    toast('Tên thành viên đã tồn tại.'); return;
  }
  const id = 'mb_' + Date.now();
  state.members.push({id, name, joinedAt: Date.now(), isAccountant: false});
  state.stats[id] = {kills:0, destroy:0, tower:0};
  ensureWeek();
  state.towerBase[id] = { weekAnchorMs: state.meta.weekAnchorMs, baseTotal: 0 };
  logMemberChange('add', { memberId: id, name });
  bumpUpdatedAt();
  saveAll();
  document.getElementById('inp-new-member').value = '';
  renderMemberList();
  toast('Đã thêm: ' + name);
}

function addMemberWithName(rawName) {
  const name = (rawName || '').trim();
  if (!name) return false;
  if(state.members.some(m => m.name.toLowerCase() === name.toLowerCase())) {
    return false;
  }
  const id = 'mb_' + Date.now() + Math.floor(Math.random()*1000);
  state.members.push({id, name, joinedAt: Date.now(), isAccountant: false});
  state.stats[id] = {kills:0, destroy:0, tower:0};
  ensureWeek();
  state.towerBase[id] = { weekAnchorMs: state.meta.weekAnchorMs, baseTotal: 0 };
  logMemberChange('add', { memberId: id, name });
  bumpUpdatedAt();
  saveAll();
  return true;
}

function deleteMember(id) {
  if(confirm('Chắc chắn muốn xóa thành viên này và toàn bộ dữ liệu của họ?')) {
    const m = state.members.find(x => x.id === id);
    state.members = state.members.filter(mb => mb.id !== id);
    delete state.stats[id];
    if (state.towerBase) delete state.towerBase[id];
    if (m) logMemberChange('remove', { memberId: id, name: m.name });
    bumpUpdatedAt();
    saveAll();
    renderMemberList();
    toast('Đã xóa thành viên.');
  }
}

function deleteMemberInternal(id) {
  const m = state.members.find(x => x.id === id);
  state.members = state.members.filter(mb => mb.id !== id);
  delete state.stats[id];
  if (state.towerBase) delete state.towerBase[id];
  if (m) logMemberChange('remove', { memberId: id, name: m.name });
  bumpUpdatedAt();
  saveAll();
}

function renderMemberList() {
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
              <td><span class="member-name">${m.name}</span></td>
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
                <button class="btn btn-sm" onclick="renameMember('${m.id}')" title="Đổi tên"><i class="fa-solid fa-pen"></i></button>
                <button class="btn btn-sm btn-red" onclick="deleteMember('${m.id}')" title="Xóa">Xóa</button>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function renameMember(id) {
  const m = state.members.find(x => x.id === id);
  if (!m) return;
  const newNameRaw = prompt('Nhập tên mới cho thành viên:', m.name);
  if (newNameRaw === null) return;
  const newName = newNameRaw.trim();
  if (!newName || newName === m.name) return;
  if (state.members.some(x => x.id !== id && x.name.toLowerCase() === newName.toLowerCase())) {
    toast('Tên mới đã tồn tại, hãy chọn tên khác.');
    return;
  }
  const oldName = m.name;
  m.name = newName;
  logMemberChange('rename', { memberId: id, oldName, newName });
  bumpUpdatedAt();
  saveAll();
  renderMemberList();
  renderEntryList();
  renderBXH();
  toast('Đã đổi tên.');
}

function setAccountant(id) {
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

function toggleAccountant(id) {
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
function parseBulkNames() {
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

function bulkAddMembers() {
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

function bulkCheckMembers() {
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

function showNextBulkOp() {
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

function hideConfirmModal() {
  const modal = document.getElementById('confirm-modal');
  if (modal) modal.style.display = 'none';
}

function confirmModalApply() {
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

function confirmModalSkip() {
  showNextBulkOp();
}

function confirmModalCancelAll() {
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

function toggleAdd(type) {
  modeAdd[type] = !modeAdd[type];
  const btn = document.getElementById('btn-add-' + type);
  const inp = document.getElementById('inp-' + type);
  btn.classList.toggle('active', modeAdd[type]);
  inp.placeholder = modeAdd[type] ? "Nhập số cần CỘNG THÊM..." : "Nhập số thay thế (Ghi đè)...";
}

function renderEntryList() {
  const query = document.getElementById('search-entry').value.toLowerCase();
  const list = state.members.filter(m => m.name.toLowerCase().includes(query));
  
  const container = document.getElementById('entry-member-list');
  container.innerHTML = list.map(m => `
    <div class="list-item ${activeMemberId === m.id ? 'selected' : ''}" onclick="selectForEntry('${m.id}')">
      <span class="member-name">${m.name}</span>
      <span style="font-size:0.8rem; color:var(--text-dim)">Chọn ➔</span>
    </div>
  `).join('');
}

function selectForEntry(id) {
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
  const inpStart = document.getElementById('inp-tower-start');
  const inpEnd = document.getElementById('inp-tower-end');
  if (inpStart) inpStart.value = '';
  if (inpEnd) inpEnd.value = '';
  
  document.getElementById('entry-form').style.display = 'block';
  renderEntryList(); // re-render to highlight selected
}

function closeEntryForm() {
  activeMemberId = null;
  document.getElementById('entry-form').style.display = 'none';
  renderEntryList();
}

function logAction(memberId, type, amount, oldVal) {
  state.logs.unshift({
    logId: 'log_' + Date.now() + Math.random(),
    memberId, type, amount, oldVal,
    time: new Date().getTime()
  });
  if(state.logs.length > 50) state.logs.pop(); // Keep only last 50
}

function logMemberChange(kind, payload) {
  if (!state.memberLogs) state.memberLogs = [];
  state.memberLogs.unshift({
    id: 'ml_' + Date.now() + Math.random(),
    kind,
    payload,
    time: Date.now()
  });
  if (state.memberLogs.length > 200) state.memberLogs.pop();
}

function saveEntry() {
  // 1. Chống spam: Vô hiệu hóa nút ngay khi vừa click
  const saveBtn = document.querySelector('#entry-form .btn-gold');
  if (saveBtn.disabled) return; // Đang khóa thì không cho bấm tiếp

  if (!activeMemberId) return;
  
  // 2. Fix lỗi mất thông số: Đảm bảo dữ liệu gốc luôn có đủ 3 chỉ số
  if (!state.stats[activeMemberId]) {
    state.stats[activeMemberId] = { kills: 0, destroy: 0, tower: 0 };
  }
  const s = state.stats[activeMemberId];
  // Chống lỗi "undefined" nếu lỡ thành viên cũ bị thiếu dữ liệu
  if (typeof s.kills === 'undefined' || isNaN(s.kills)) s.kills = 0;
  if (typeof s.destroy === 'undefined' || isNaN(s.destroy)) s.destroy = 0;
  if (typeof s.tower === 'undefined' || isNaN(s.tower)) s.tower = 0;

  // Lấy dữ liệu từ các ô nhập
  const inKill = parseInt(document.getElementById('inp-kill').value);
  const inDes = parseInt(document.getElementById('inp-destroy').value);
  const inTowStart = parseInt(document.getElementById('inp-tower-start')?.value);
  const inTowEnd = parseInt(document.getElementById('inp-tower-end')?.value);
  
  let changed = false;

  // Xử lý Diệt địch
  if (!isNaN(inKill)) {
    let old = s.kills;
    s.kills = modeAdd.kill ? old + inKill : inKill;
    logAction(activeMemberId, 'kill', inKill, old);
    changed = true;
  }
  
  // Xử lý Phá thành
  if (!isNaN(inDes)) {
    let old = s.destroy;
    s.destroy = modeAdd.destroy ? old + inDes : inDes;
    logAction(activeMemberId, 'destroy', inDes, old);
    changed = true;
  }
  
  // Xử lý Tháp: nhập đầu tuần & cuối tuần rồi tự tính chênh lệch
  if (!isNaN(inTowStart) || !isNaN(inTowEnd)) {
    if (isNaN(inTowStart) || isNaN(inTowEnd)) {
      toast('Vui lòng nhập đủ cả ĐẦU TUẦN và CUỐI TUẦN cho tháp.');
      return;
    }
    if (inTowEnd < inTowStart) {
      toast('Số cuối tuần phải lớn hơn hoặc bằng số đầu tuần.');
      return;
    }
    const weekGain = inTowEnd - inTowStart;
    const old = s.tower;
    s.tower = inTowEnd; // lưu tổng hiện tại
    // chỉnh lại baseline cho tuần hiện tại bằng giá trị đầu tuần
    const anchor = state.meta?.weekAnchorMs || getWeekAnchorMs();
    if (!state.towerBase) state.towerBase = {};
    state.towerBase[activeMemberId] = { weekAnchorMs: anchor, baseTotal: inTowStart };
    logAction(activeMemberId, 'tower', weekGain, old);
    changed = true;
  }

  // 3. Xử lý cảnh báo nếu không nhập gì
  if (!changed) { 
    toast('⚠️ Bạn chưa nhập số nào vào ô!'); 
    return; 
  }

  // 4. Khóa nút và đổi text để báo hiệu đang lưu
  saveBtn.disabled = true;
  saveBtn.innerHTML = '⏳ Đang xử lý...';
  saveBtn.style.opacity = '0.7';

  // Lưu vào bộ nhớ máy
  bumpUpdatedAt();
  saveAll();

  // Hiển thị thông báo Thành Công
  toast('Đã lưu.');
  
  // 5. Tự động mở khóa nút và Đóng Form sau 0.5 giây
  setTimeout(() => {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Lưu thông số';
    saveBtn.style.opacity = '1';
    
    // Đóng form và làm mới danh sách thành viên bên ngoài
    closeEntryForm(); 
  }, 500);
}

// ==========================================
// 5. HISTORY & UNDO
// ==========================================
function renderHistory() {
  const container = document.getElementById('history-content');
  const statLogs = state.logs || [];
  const memberLogs = state.memberLogs || [];
  if(statLogs.length === 0 && memberLogs.length === 0) { 
    container.innerHTML = '<div style="padding:1rem; text-align:center">Chưa có dữ liệu.</div>'; 
    return; 
  }
  
  const typeNames = { kill: 'Diệt địch', destroy: 'Phá thành', tower: 'Tháp canh' };
  
  const statTable = statLogs.length ? `
    <h4 style="font-family:'Cinzel',serif; font-size:0.9rem; color:var(--gold); margin-bottom:0.4rem;">Nhập liệu chỉ số</h4>
    <table>
      <thead><tr><th>Thời gian</th><th>Thành viên</th><th>Thao tác</th><th>Hoàn tác</th></tr></thead>
      <tbody>
        ${statLogs.map(log => {
          const mName = state.members.find(m => m.id === log.memberId)?.name || 'Đã xóa';
          const time = new Date(log.time).toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'});
          const actionText = log.type === 'tower' 
            ? `Cập nhật thành <b>${log.amount}</b>` 
            : `Cộng thêm <b>${log.amount}</b>`;

          return `
            <tr>
              <td style="color:var(--text-dim); font-size:0.8rem">${time}</td>
              <td class="member-name">${mName}</td>
              <td><span style="font-size:0.8rem">${typeNames[log.type]}</span><br>${actionText}</td>
              <td><button class="btn btn-sm btn-red" onclick="undoLog('${log.logId}')">Undo</button></td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  ` : '';

  const memberTable = memberLogs.length ? `
    <h4 style="font-family:'Cinzel',serif; font-size:0.9rem; color:var(--gold); margin:1rem 0 0.4rem;">Lịch sử thành viên</h4>
    <table>
      <thead><tr><th>Thời gian</th><th>Thành viên</th><th>Thao tác</th></tr></thead>
      <tbody>
        ${memberLogs.map(log => {
          const time = new Date(log.time).toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit'});
          const p = log.payload || {};
          let name = p.name || '';
          if (!name && p.memberId) {
            const m = state.members.find(x => x.id === p.memberId);
            if (m) name = m.name;
          }
          let action = '';
          if (log.kind === 'add') {
            action = 'Thêm thành viên';
          } else if (log.kind === 'remove') {
            action = 'Xóa thành viên';
          } else if (log.kind === 'rename') {
            action = `Đổi tên từ <b>${p.oldName}</b> thành <b>${p.newName}</b>`;
          } else if (log.kind === 'accountant') {
            action = p.value ? 'Đặt làm kế toán' : 'Bỏ kế toán';
          }
          return `
            <tr>
              <td style="color:var(--text-dim); font-size:0.8rem">${time}</td>
              <td class="member-name">${name}</td>
              <td style="font-size:0.85rem">${action}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  ` : '';

  container.innerHTML = statTable + memberTable;
}

function undoLog(logId) {
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

// ==========================================
// 6. LEADERBOARD (BXH) LOGIC
// ==========================================
function computeBXH() {
  ensureWeek();
  const data = state.members.map(m => {
    const s = getStats(m.id);
    return {
      ...m,
      ...s,
      towerWeek: getTowerWeekFor(m.id)
    };
  });
  
  const byKill = [...data].sort((a,b) => b.kills - a.kills);
  const byDes  = [...data].sort((a,b) => b.destroy - a.destroy);
  const byTow  = [...data].sort((a,b) => b.towerWeek - a.towerWeek);

  // Helper để lọc ra những người chưa nhận rương
  const exclude = (list, excludeIds) => list.filter(m => !excludeIds.has(m.id));

  // --- RƯƠNG 1 ---
  // Nếu có Kế toán: ghim Kế toán + Top 9 diệt địch (không tính Kế toán)
  // Nếu không có Kế toán: Top 10 diệt địch
  const accountant = state.members.find(m => m.isAccountant);
  let r1_accountant = null;
  let r1_kill = [];
  if (accountant) {
    r1_accountant = data.find(d => d.id === accountant.id) || null;
    const withoutAcc = byKill.filter(m => m.id !== accountant.id);
    r1_kill = withoutAcc.slice(0, 9);
  } else {
    r1_kill = byKill.slice(0, 10);
  }
  const set_r1 = new Set([
    ...r1_kill.map(m => m.id),
    ...(r1_accountant ? [r1_accountant.id] : [])
  ]);

  // --- RƯƠNG 2 ---
  const r2_kill = exclude(byKill, set_r1).slice(0, 5);
  const set_r2_kill = new Set(r2_kill.map(m=>m.id));
  const r2_tower = exclude(byTow, new Set([...set_r1, ...set_r2_kill])).slice(0, 5);
  const set_r2 = new Set([...set_r2_kill, ...r2_tower.map(m=>m.id)]);

  // --- RƯƠNG 3 ---
  const all_r12 = new Set([...set_r1, ...set_r2]);
  const r3_des = exclude(byDes, all_r12).slice(0, 10);
  const set_r3_des = new Set(r3_des.map(m=>m.id));
  const r3_tower = exclude(byTow, new Set([...all_r12, ...set_r3_des])).slice(0, 5);
  const set_r3 = new Set([...set_r3_des, ...r3_tower.map(m=>m.id)]);

  // --- RƯƠNG 4 ---
  const all_r123 = new Set([...all_r12, ...set_r3]);
  const r4_tow = exclude(byTow, all_r123).slice(0, 5);
  const set_r4_tow = new Set(r4_tow.map(m=>m.id));
  const r4_kill = exclude(byKill, new Set([...all_r123, ...set_r4_tow])).slice(0, 5);
  const set_r4_kill = new Set(r4_kill.map(m=>m.id));
  const r4_des = exclude(byDes, new Set([...all_r123, ...set_r4_tow, ...set_r4_kill])).slice(0, 5);

  return { r1_accountant, r1_kill, r2_kill, r2_tower, r3_des, r3_tower, r4_tow, r4_kill, r4_des };
}

function buildTable(list, valKey, suffix, opts) {
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
              Tổng tháp: <b>${(m.tower || 0).toLocaleString()}</b>
            </div>
          </td>
          <td align="right" style="color:var(--text-main); white-space:nowrap;">
            ${m[valKey].toLocaleString()} ${suffix}
          </td>
        </tr>
      `;
      }).join('')}
    </table>
  `;
}

function renderBXH() {
  ensureWeek();
  const r = computeBXH();
  const accountantMember = state.members.find(m => m.isAccountant);
  const hasAccountant = !!accountantMember;
  const accountantRow = r.r1_accountant ? `
    <tr class="row-accountant">
      <td width="30"><span class="rank-num rank-kt" title="Kế Toán">K</span></td>
      <td>
        <div class="member-name">${r.r1_accountant.name}
          <span class="badge-accountant" title="Slot Kế Toán"><i class="fa-solid fa-coins"></i> Kế toán</span>
        </div>
        <div style="font-size:0.75rem; color:var(--text-dim); margin-top:0.1rem;">
          Tổng diệt: <b>${(r.r1_accountant.kills || 0).toLocaleString()}</b> • 
          Tổng phá: <b>${(r.r1_accountant.destroy || 0).toLocaleString()}</b> • 
          Tổng tháp: <b>${(r.r1_accountant.tower || 0).toLocaleString()}</b>
        </div>
      </td>
      <td align="right" style="color:var(--text-main); white-space:nowrap;">
        ${(r.r1_accountant.kills || 0).toLocaleString()} điểm
      </td>
    </tr>
  ` : '';

  const accountantLine = accountantMember
    ? `<div style="font-size:0.8rem; color:var(--text-dim); padding:0.5rem; border-top:1px solid var(--border)">Kế toán đã chọn: <a href="#" onclick="showPage('members'); return false;" class="link-accountant">${accountantMember.name}</a> (ghim cố định trong Rương 1)</div>`
    : '<div style="font-size:0.8rem; color:var(--text-dim); padding:0.5rem; border-top:1px solid var(--border)">Chưa chọn kế toán — <a href="#" onclick="showPage(\'members\'); return false;" class="link-accountant">Chọn tại trang Thành viên</a> (sẽ được ghim ở đầu Rương 1)</div>';

  document.getElementById('bxh-content').innerHTML = `
    <div class="card">
      <div class="card-title"><span class="badge b-r1">RƯƠNG 1 (x10)</span></div>
      <div style="font-size:0.7rem; color:var(--text-dim); margin-bottom:0.5rem">
        ${hasAccountant ? 'Kế toán (ghim cố định) + Top 9 diệt địch' : 'Top 10 diệt địch'}
      </div>
      <table>
        <tbody>
          ${accountantRow}
        </tbody>
      </table>
      ${buildTable(r.r1_kill, 'kills', 'điểm')}
      ${accountantLine}
    </div>

    <div class="card">
      <div class="card-title"><span class="badge b-r2">RƯƠNG 2 (x10)</span></div>
      <div style="font-size:0.7rem; color:var(--text-dim); margin-bottom:0.5rem">TOP 5 DIỆT ĐỊCH (Tiếp)</div>
      ${buildTable(r.r2_kill, 'kills', 'điểm')}
      <div style="font-size:0.7rem; color:var(--text-dim); margin:1rem 0 0.5rem 0">TOP 5 THÁP CANH</div>
      ${buildTable(r.r2_tower, 'towerWeek', 'lượt')}
    </div>

    <div class="card">
      <div class="card-title"><span class="badge b-r3">RƯƠNG 3 (x15)</span></div>
      <div style="font-size:0.7rem; color:var(--text-dim); margin-bottom:0.5rem">TOP 10 PHÁ THÀNH</div>
      ${buildTable(r.r3_des, 'destroy', 'điểm')}
      <div style="font-size:0.7rem; color:var(--text-dim); margin:1rem 0 0.5rem 0">TOP 5 THÁP CANH (Tiếp)</div>
      ${buildTable(r.r3_tower, 'towerWeek', 'lượt')}
    </div>

    <div class="card">
      <div class="card-title"><span class="badge b-r4">RƯƠNG 4 (x15)</span></div>
      <div style="font-size:0.7rem; color:var(--text-dim); margin-bottom:0.5rem">TOP 5 THÁP CANH (Tiếp)</div>
      ${buildTable(r.r4_tow, 'towerWeek', 'lượt')}
      <div style="font-size:0.7rem; color:var(--text-dim); margin:1rem 0 0.5rem 0">TOP 5 DIỆT ĐỊCH (Tiếp)</div>
      ${buildTable(r.r4_kill, 'kills', 'điểm')}
      <div style="font-size:0.7rem; color:var(--text-dim); margin:1rem 0 0.5rem 0">TOP 5 PHÁ THÀNH (Tiếp)</div>
      ${buildTable(r.r4_des, 'destroy', 'điểm')}
    </div>
  `;
}

// ==========================================
// 7. SETTINGS & UTILS
// ==========================================
function resetWeek() {
  if(confirm('Hành động này sẽ đưa TOÀN BỘ điểm Diệt, Phá, Tháp của TẤT CẢ thành viên về 0. Bạn có chắc không?')) {
    state.members.forEach(m => { state.stats[m.id] = {kills:0, destroy:0, tower:0}; });
    state.logs = []; // Xoá luôn lịch sử
    bumpUpdatedAt();
    saveAll();
    renderBXH();
    toast('Đã reset dữ liệu.');
  }
}

function copyBXH() {
  const r = computeBXH();
  let txt = `TỔNG KẾT RƯƠNG LIÊN MINH\n\n`;
  
  const accountant = r.r1_accountant;
  if (accountant) {
    txt += `RƯƠNG 1 (Kế toán + Top 9 Diệt):\n`;
    txt += `0. ${accountant.name} [Kế toán] (Diệt: ${accountant.kills.toLocaleString()}, Phá: ${accountant.destroy.toLocaleString()}, Tháp: ${accountant.tower.toLocaleString()})\n`;
    r.r1_kill.forEach((m,i)=> txt += `${i+1}. ${m.name} (Diệt: ${m.kills.toLocaleString()}, Phá: ${m.destroy.toLocaleString()}, Tháp: ${m.tower.toLocaleString()})\n`);
  } else {
    txt += `RƯƠNG 1 (Top 10 Diệt):\n`;
    r.r1_kill.forEach((m,i)=> txt += `${i+1}. ${m.name} (Diệt: ${m.kills.toLocaleString()}, Phá: ${m.destroy.toLocaleString()}, Tháp: ${m.tower.toLocaleString()})\n`);
  }
  
  txt += `\nRƯƠNG 2:\n[Diệt]\n`;
  r.r2_kill.forEach((m,i)=> txt += `${i+1}. ${m.name} (Diệt: ${m.kills.toLocaleString()}, Phá: ${m.destroy.toLocaleString()}, Tháp: ${m.tower.toLocaleString()})\n`);
  txt += `[Tháp]\n`;
  r.r2_tower.forEach((m,i)=> txt += `${i+1}. ${m.name} (${m.towerWeek} lượt trong tuần, tổng tháp: ${m.tower.toLocaleString()})\n`);
  
  txt += `\nRƯƠNG 3:\n[Phá Thành]\n`;
  r.r3_des.forEach((m,i)=> txt += `${i+1}. ${m.name} (Diệt: ${m.kills.toLocaleString()}, Phá: ${m.destroy.toLocaleString()}, Tháp: ${m.tower.toLocaleString()})\n`);
  txt += `[Tháp]\n`;
  r.r3_tower.forEach((m,i)=> txt += `${i+1}. ${m.name} (${m.towerWeek} lượt trong tuần, tổng tháp: ${m.tower.toLocaleString()})\n`);
  
  txt += `\nRƯƠNG 4:\n[Tháp]\n`;
  r.r4_tow.forEach((m,i)=> txt += `${i+1}. ${m.name} (${m.towerWeek} lượt trong tuần, tổng tháp: ${m.tower.toLocaleString()})\n`);
  txt += `[Diệt]\n`;
  r.r4_kill.forEach((m,i)=> txt += `${i+1}. ${m.name} (Diệt: ${m.kills.toLocaleString()}, Phá: ${m.destroy.toLocaleString()}, Tháp: ${m.tower.toLocaleString()})\n`);
  txt += `[Phá Thành]\n`;
  r.r4_des.forEach((m,i)=> txt += `${i+1}. ${m.name} (Diệt: ${m.kills.toLocaleString()}, Phá: ${m.destroy.toLocaleString()}, Tháp: ${m.tower.toLocaleString()})\n`);

  navigator.clipboard.writeText(txt).then(() => toast('Đã copy BXH.'));
}

// ==========================================
// 8. QUICK INPUT UX
// ==========================================
function handleAtOpenList(ev) {
  if (ev.key === '@') {
    ev.preventDefault();
    ev.target.value = '';
    renderEntryList();
    const list = document.getElementById('entry-member-list');
    if (list) list.scrollTop = 0;
  }
}

// ==========================================
// 9. CLOUD SYNC (Firebase/Firestore)
// ==========================================
let cloud = {
  enabled: false,
  app: null,
  auth: null,
  db: null,
  unsub: null,
  lastRemoteUpdatedAt: 0,
  writeTimer: null
};

function bumpUpdatedAt() {
  if (!state.meta) state.meta = { updatedAt: 0, weekAnchorMs: 0, weekLabel: "" };
  state.meta.updatedAt = Date.now();
  updateWeekLabelView();
}

function saveAll() {
  saveLocal();
  scheduleCloudWrite();
}

function getCloudCfg() {
  try { return JSON.parse(localStorage.getItem(CLOUD_CFG_KEY) || 'null'); } catch(e) { return null; }
}

function setCloudStatus(txt) {
  const el = document.getElementById('cloud-status');
  if (el) el.textContent = txt;
}

function saveFirebaseConfig() {
  const raw = (document.getElementById('inp-fb-config')?.value || '').trim();
  if (!raw) { toast('Chưa có config để lưu.'); return; }
  try {
    const cfg = parseFirebaseConfigFromText(raw);
    if (!cfg.projectId) throw new Error('Missing projectId');
    localStorage.setItem(CLOUD_CFG_KEY, JSON.stringify(cfg));
    toast('Đã lưu config.');
  } catch(e) {
    toast('Config không hợp lệ (cần có projectId).');
  }
}

function parseFirebaseConfigFromText(text) {
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

function clearFirebaseConfig() {
  localStorage.removeItem(CLOUD_CFG_KEY);
  const el = document.getElementById('inp-fb-config');
  if (el) el.value = '';
  toast('Đã xóa config.');
}

async function connectCloud() {
  const cfg = getCloudCfg();
  if (!cfg) { toast('Bạn cần dán Firebase config trước.'); return false; }
  if (!window.firebase?.initializeApp) { toast('Thiếu Firebase SDK (không load được).'); return false; }

  try {
    if (!cloud.app) cloud.app = firebase.initializeApp(cfg);
    cloud.auth = firebase.auth();
    cloud.db = firebase.firestore();
    await cloud.auth.signInAnonymously();
    cloud.enabled = true;
    setCloudStatus('Đã kết nối');
    startCloudListener();
    scheduleCloudWrite(true);
    stopConnectPromptLoop();
    hideConnectPromptModal();
    toast('Cloud đã sẵn sàng.');
    return true;
  } catch (e) {
    cloud.enabled = false;
    setCloudStatus('Lỗi kết nối');
    toast('Không kết nối được Cloud. Kiểm tra config/rules Firebase.');
    return false;
  }
}

function disconnectCloud() {
  if (cloud.unsub) { try { cloud.unsub(); } catch(e) {} }
  cloud.unsub = null;
  cloud.enabled = false;
  setCloudStatus('Đã ngắt');
  stopConnectPromptLoop();
  toast('Đã ngắt Cloud.');
}

let connectPromptTimer = null;
let connectPromptTimeout = null;
function showConnectPromptModal() {
  const modal = document.getElementById('connect-prompt-modal');
  if (modal) modal.style.display = 'flex';
}
function hideConnectPromptModal() {
  const modal = document.getElementById('connect-prompt-modal');
  if (modal) modal.style.display = 'none';
}
function connectPromptConnect() {
  hideConnectPromptModal();
  connectCloud();
}
function connectPromptLater() {
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
function startConnectPromptLoop() {
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
function stopConnectPromptLoop() {
  if (connectPromptTimer) { clearInterval(connectPromptTimer); connectPromptTimer = null; }
  if (connectPromptTimeout) { clearTimeout(connectPromptTimeout); connectPromptTimeout = null; }
}
function checkSettingsConnectPrompt() {
  if (cloud.enabled) return;
  if (!getCloudCfg()) return;
  showConnectPromptModal();
  startConnectPromptLoop();
}

function cloudDocRef() {
  // One shared doc for the whole alliance
  return cloud.db.collection('minhchu_bxh').doc('state');
}

function startCloudListener() {
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
      renderBXH();
      renderMemberList();
      renderEntryList();
      renderHistory();
      toast('Đã cập nhật dữ liệu mới từ Cloud.');
    } catch(e) {}
  });
}

function scheduleCloudWrite(force = false) {
  if (!cloud.enabled) return;
  if (cloud.writeTimer) clearTimeout(cloud.writeTimer);
  cloud.writeTimer = setTimeout(() => writeCloud(force), force ? 0 : 800);
}

async function writeCloud(force = false) {
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

function syncNow() {
  if (!cloud.enabled) { toast('Chưa kết nối Cloud.'); return; }
  bumpUpdatedAt();
  saveAll();
  toast('Đang đồng bộ...');
}

// ==========================================
// 10. MANUAL TIME RANGE
// ==========================================
function applyManualRange() {
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

function clearManualRange() {
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

// ==========================================
// INIT
// ==========================================
load();
ensureWeek();
renderBXH();
renderMemberList();
renderEntryList();
applyViewModeFromUrl();

// Load config into UI (if exists)
try {
  const cfg = getCloudCfg();
  const el = document.getElementById('inp-fb-config');
  if (cfg && el) el.value = JSON.stringify(cfg);
} catch(e) {}

// Tự kết nối Cloud khi đã có config
setTimeout(() => {
  if (getCloudCfg() && !cloud.enabled) connectCloud();
}, 500);

// Khôi phục khung thời gian thủ công (nếu có)
window.addEventListener('load', () => {
  if (state.meta && state.meta.manualRange) {
    const s = state.meta.manualRange.startMs;
    const e = state.meta.manualRange.endMs;
    const toVal = (ms) => {
      const d = new Date(ms);
      const pad = (x) => String(x).padStart(2,'0');
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const inpStart = document.getElementById('manual-start');
    const inpEnd = document.getElementById('manual-end');
    if (inpStart && s) inpStart.value = toVal(s);
    if (inpEnd && e) inpEnd.value = toVal(e);
  }
  updateWeekLabelView();
});

function applyViewModeFromUrl() {
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
}