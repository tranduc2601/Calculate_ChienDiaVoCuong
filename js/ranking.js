// ==========================================
// RANKING / CHIA RƯƠNG (waterfall, sqrt…)
// ==========================================

export const DEFAULT_CHEST_CONFIG = {
  chests: [
    {
      id: 'R1',
      name: 'Rương 1',
      total_chests: 15,
      reserved_slots: 0,
      slots: [
        { criteria: 'kills', count: 10, label: 'Top Diệt' },
        { criteria: 'sabotage', count: 3, label: 'Top Phá' },
        { criteria: 'speed', count: 1, label: 'Top Tốc' }
      ],
      exclude_higher_chest: true
    },
    {
      id: 'R2',
      name: 'Rương 2',
      total_chests: 15,
      reserved_slots: 0,
      slots: [
        { criteria: 'kills', count: 8, label: 'Top Diệt' },
        { criteria: 'sabotage', count: 4, label: 'Top Phá' },
        { criteria: 'speed', count: 3, label: 'Top Tốc' }
      ],
      exclude_higher_chest: true
    },
    {
      id: 'R3',
      name: 'Rương 3',
      total_chests: 20,
      reserved_slots: 0,
      slots: [
        { criteria: 'kills', count: 15, label: 'Top Diệt' },
        { criteria: 'sabotage', count: 3, label: 'Top Phá' },
        { criteria: 'speed', count: 2, label: 'Top Tốc' }
      ],
      exclude_higher_chest: true
    },
    {
      id: 'R4',
      name: 'Rương 4',
      total_chests: 20,
      reserved_slots: 0,
      slots: [
        { criteria: 'kills', count: 15, label: 'Top Diệt' },
        { criteria: 'sabotage', count: 3, label: 'Top Phá' },
        { criteria: 'speed', count: 2, label: 'Top Tốc' }
      ],
      exclude_higher_chest: false
    }
  ]
};

export const CHEST_UI_ROW_META = [
  { id: 'R1', name: 'Rương 1', reserved_slots: 0, exclude_higher_chest: true },
  { id: 'R2', name: 'Rương 2', reserved_slots: 0, exclude_higher_chest: true },
  { id: 'R3', name: 'Rương 3', reserved_slots: 0, exclude_higher_chest: true },
  { id: 'R4', name: 'Rương 4', reserved_slots: 0, exclude_higher_chest: false }
];

export function getFirebaseChestConfig(state) {
  if (!state.meta) state.meta = {};
  const c = state.meta.firebaseChestConfig;
  if (c && Array.isArray(c.chests) && c.chests.length > 0) return c;
  return DEFAULT_CHEST_CONFIG;
}

export function getRuleMode(state) {
  const m = (state.meta && state.meta.ruleMode) || 'waterfall';
  return m;
}

export function metricValueForCriteria(m, criteria) {
  switch (criteria) {
    case 'kills': return Number(m.kills) || 0;
    case 'sabotage': return Number(m.destroy) || 0;
    case 'speed': return Number(m.towerWeek) || 0;
    default: return 0;
  }
}

export function calcWaterfall(membersRow, chestConfigDoc) {
  const chestsDef = (chestConfigDoc && chestConfigDoc.chests) ? chestConfigDoc.chests : [];
  const members = membersRow.map(m => ({
    ...m,
    kills: Number(m.kills) || 0,
    destroy: Number(m.destroy) || 0,
    towerWeek: Number(m.towerWeek) || 0
  }));
  const accountant = members.find(m => m.isAccountant);
  const awardedIds = new Set();
  const out = [];

  chestsDef.forEach((chest, idx) => {
    const groupsOut = [];
    const pinned = [];
    const reservedSlots = Math.max(0, Number(chest.reserved_slots) || 0);
    const slots = Array.isArray(chest.slots) ? chest.slots : [];
    const slotsTotal = slots.reduce((sum, s) => sum + (Math.max(0, Number(s.count) || 0)), 0);
    // Không dùng reserved_slots để cộng thêm tổng rương, tránh lệch x15 -> x16.
    const totalChests = Math.max(0, Number(chest.total_chests) || slotsTotal);
    let awardedInChest = 0;
    const hasAccountantPinnedR1 = chest.id === 'R1' && !!accountant;

    // R1: ghim kế toán ngay đầu và trừ vào tổng quota cạnh tranh.
    if (hasAccountantPinnedR1) {
      pinned.push(accountant);
      awardedIds.add(accountant.id);
      awardedInChest += 1;
    }

    slots.forEach((slot) => {
      const crit = slot.criteria || 'kills';
      const requested = Math.max(0, Number(slot.count) || 0);
      // R1: nếu kế toán đã nhận rương, bắt buộc trừ 1 vào Top Diệt.
      const adjustedRequested = (hasAccountantPinnedR1 && crit === 'kills')
        ? Math.max(0, requested - 1)
        : requested;
      const remaining = Math.max(0, totalChests - awardedInChest);
      const count = Math.min(adjustedRequested, remaining);
      const label = slot.label || crit;

      let availablePool = members.filter(m => !awardedIds.has(m.id));
      availablePool.sort((a, b) => metricValueForCriteria(b, crit) - metricValueForCriteria(a, crit));

      const picked = [];
      for (let i = 0; i < availablePool.length && picked.length < count; i++) {
        const mm = availablePool[i];
        picked.push(mm);
        awardedIds.add(mm.id);
        awardedInChest += 1;
      }
      groupsOut.push({ label, criteria: crit, list: picked });
    });

    // Hard validation chống tràn R1: nếu vẫn lố thì gọt từ cuối Top Diệt.
    if (chest.id === 'R1') {
      const diet = groupsOut.find((g) => g.criteria === 'kills')?.list || [];
      const pha = groupsOut.find((g) => g.criteria === 'sabotage')?.list || [];
      const toc = groupsOut.find((g) => g.criteria === 'speed')?.list || [];
      const totalAssignedR1 = pinned.length + diet.length + pha.length + toc.length;
      if (totalAssignedR1 > totalChests) {
        console.error(`[CRITICAL BUG] R1 Overflow! Configured: ${totalChests}, Actual: ${totalAssignedR1}. Forcing pop on Top Diệt.`);
        const topKillGroup = groupsOut.find((g) => g.criteria === 'kills' && Array.isArray(g.list));
        if (topKillGroup && topKillGroup.list.length > 0) {
          const removedUser = topKillGroup.list.pop();
          if (removedUser && removedUser.id != null) {
            awardedIds.delete(removedUser.id);
          }
        }
      }
    }

    out.push({
      id: chest.id || ('R' + (idx + 1)),
      name: chest.name || ('Rương ' + (idx + 1)),
      total_chests: totalChests,
      reserved_slots: reservedSlots,
      pinned,
      groups: groupsOut
    });
  });

  return out;
}

export function calculateRankings(membersRow, chestConfigDoc, ruleMode) {
  if (!chestConfigDoc || !Array.isArray(chestConfigDoc.chests) || chestConfigDoc.chests.length === 0) {
    console.warn('calculateRankings: chestConfig chưa sẵn sàng, bỏ qua.');
    return [];
  }
  switch (ruleMode) {
    case 'waterfall': return calcWaterfall(membersRow, chestConfigDoc);
    // case 'sqrt': return calcSqrt(membersRow, chestConfigDoc); // TODO
    default: return calcWaterfall(membersRow, chestConfigDoc);
  }
}
