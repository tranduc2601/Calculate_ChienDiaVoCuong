// ==========================================
// RANKING / CHIA RƯƠNG (waterfall, sqrt…)
// ==========================================

export const DEFAULT_CHEST_CONFIG = {
  chests: [
    {
      id: 'R1',
      name: 'Rương 1',
      total_chests: 15,
      reserved_slots: 1,
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
  { id: 'R1', name: 'Rương 1', reserved_slots: 1, exclude_higher_chest: true },
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
    const normalizedTotal = reservedSlots + slots.reduce((sum, s) => sum + (Math.max(0, Number(s.count) || 0)), 0);
    let awardedInChest = 0;

    if (reservedSlots > 0 && accountant && chest.id === 'R1') {
      pinned.push(accountant);
      awardedIds.add(accountant.id);
      awardedInChest += 1;
    }

    slots.forEach((slot) => {
      const crit = slot.criteria || 'kills';
      const requested = Math.max(0, Number(slot.count) || 0);
      const remaining = Math.max(0, normalizedTotal - awardedInChest);
      const count = Math.min(requested, remaining);
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

    out.push({
      id: chest.id || ('R' + (idx + 1)),
      name: chest.name || ('Rương ' + (idx + 1)),
      total_chests: normalizedTotal,
      reserved_slots: reservedSlots,
      pinned,
      groups: groupsOut
    });
  });

  return out;
}

export function calculateRankings(membersRow, chestConfigDoc, ruleMode) {
  switch (ruleMode) {
    case 'waterfall': return calcWaterfall(membersRow, chestConfigDoc);
    // case 'sqrt': return calcSqrt(membersRow, chestConfigDoc); // TODO
    default: return calcWaterfall(membersRow, chestConfigDoc);
  }
}
