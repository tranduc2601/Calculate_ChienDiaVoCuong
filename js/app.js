import {
  load,
  registerUIHooks,
  ensureWeek,
  getCloudCfg,
  connectCloud,
  state,
  cloud,
  saveFirebaseConfig,
  clearFirebaseConfig,
  disconnectCloud,
  syncNow
} from './database.js';
import * as ui from './ui.js';

export { state, cloud } from './database.js';

export function initApp() {
  registerUIHooks({
    updateWeekLabelView: ui.updateWeekLabelView,
    renderBXH: ui.renderBXH,
    renderMemberList: ui.renderMemberList,
    renderEntryList: ui.renderEntryList,
    renderHistory: ui.renderHistory,
    toast: ui.toast,
    fillChestCfgUI: ui.fillChestCfgUI,
    updateChestRulesSummary: ui.updateChestRulesSummary,
    markStartupConnected: ui.markStartupConnected,
    stopConnectPromptLoop: ui.stopConnectPromptLoop,
    hideConnectPromptModal: ui.hideConnectPromptModal
  });

  load();
  ensureWeek();
  ui.renderBXH();
  ui.renderMemberList();
  ui.renderEntryList();
  ui.applyViewModeFromUrl();

  try {
    const cfg = getCloudCfg();
    const el = document.getElementById('inp-fb-config');
    if (cfg && el) el.value = JSON.stringify(cfg);
  } catch (e) {}

  setTimeout(() => {
    if (getCloudCfg() && !cloud.enabled) {
      ui.startAutoConnectFallback();
      connectCloud();
    }
  }, 500);

  window.addEventListener('load', () => {
    if (state.meta && state.meta.manualRange) {
      const s = state.meta.manualRange.startMs;
      const e = state.meta.manualRange.endMs;
      const toVal = (ms) => {
        const d = new Date(ms);
        const pad = (x) => String(x).padStart(2, '0');
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };
      const inpStart = document.getElementById('manual-start');
      const inpEnd = document.getElementById('manual-end');
      if (inpStart && s) inpStart.value = toVal(s);
      if (inpEnd && e) inpEnd.value = toVal(e);
    }
    ui.updateWeekLabelView();
    ui.fillChestCfgUI();
    ui.updateChestRulesSummary();
    ['inp-kill', 'inp-destroy', 'inp-speed-total'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('keydown', ui.handleEntryInputEnter);
    });
  });

  Object.assign(window, {
    showPage: ui.showPage,
    manualConnectFromFallback: ui.manualConnectFromFallback,
    handleAtOpenList: ui.handleAtOpenList,
    renderEntryList: ui.renderEntryList,
    openBulkInputModal: ui.openBulkInputModal,
    toggleAdd: ui.toggleAdd,
    closeEntryForm: ui.closeEntryForm,
    saveEntry: ui.saveEntry,
    addMember: ui.addMember,
    bulkAddMembers: ui.bulkAddMembers,
    bulkCheckMembers: ui.bulkCheckMembers,
    renderMemberList: ui.renderMemberList,
    saveFirebaseConfig,
    clearFirebaseConfig,
    disconnectCloud,
    syncNow,
    resetWeek: ui.resetWeek,
    newWeekSummary: ui.newWeekSummary,
    copyBXH: ui.copyBXH,
    applyManualRange: ui.applyManualRange,
    clearManualRange: ui.clearManualRange,
    unlockAdminChestConfig: ui.unlockAdminChestConfig,
    saveRuleModeFromUI: ui.saveRuleModeFromUI,
    saveChestCfg: ui.saveChestCfg,
    confirmModalApply: ui.confirmModalApply,
    confirmModalSkip: ui.confirmModalSkip,
    confirmModalCancelAll: ui.confirmModalCancelAll,
    applyBulkInput: ui.applyBulkInput,
    closeBulkInputModal: ui.closeBulkInputModal,
    connectPromptConnect: ui.connectPromptConnect,
    connectPromptLater: ui.connectPromptLater,
    applyEditMember: ui.applyEditMember,
    closeEditMemberModal: ui.closeEditMemberModal,
    copyWeekHistoryJsonByIndex: ui.copyWeekHistoryJsonByIndex,
    undoLog: ui.undoLog,
    editMember: ui.editMember,
    deleteMember: ui.deleteMember,
    setAccountant: ui.setAccountant,
    openTowerEntryFromMembers: ui.openTowerEntryFromMembers,
    selectForEntry: ui.selectForEntry
  });
}

initApp();
