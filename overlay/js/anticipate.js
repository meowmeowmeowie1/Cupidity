/* Cupidity anticipation engine — which positional does the player need NEXT?
 *
 * This mirrors Avarice's per-job rules (Util.cs Is<JOB>AnticipatedRear/Flank),
 * but where Avarice reads game memory (LastComboMove, job gauges, statuses),
 * we reconstruct the same state from the player's own log lines:
 *  - combo state   ← the player's weaponskill lines (30s window, like the game)
 *  - Coeurl's Fury ← Demolish grants 2, Snap Punch / Pouncing Coeurl spend 1
 *  - Kazematoi     ← Armor Crush grants 2 (cap 4), Aeolian Edge spends 1
 *  - Sen           ← Gekko/Mangetsu = Getsu, Kasha/Oka = Ka, Yukikaze = Setsu;
 *                    cleared by iaijutsu / Hagakure
 *  - statuses      ← gain/lose lines (26/30) on the player and on enemies
 *
 * Pure logic, no DOM: runs in the overlay and under node tests. Timestamps
 * are passed in (ms).
 */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CupidityAnticipate = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Action IDs marked (v) are from community references, unverified against a
  // live log — name matching below covers them on EN clients regardless.
  const ACTIONS = {
    // MNK
    'true strike': 53, 'twin snakes': 61, 'snap punch': 56, 'demolish': 66,
    'rising raptor': 36946 /* v */, 'pouncing coeurl': 36947 /* v */,
    // DRG
    'full thrust': 84, "heavens' thrust": 25771, 'disembowel': 87,
    'spiral blow': 36955 /* v */, 'chaos thrust': 88, 'chaotic spring': 25772,
    'fang and claw': 3554, 'wheeling thrust': 3556, 'drakesbane': 36952 /* v */,
    // NIN
    'gust slash': 2242, 'aeolian edge': 2255, 'armor crush': 3563,
    // SAM
    'jinpu': 7478, 'shifu': 7479, 'yukikaze': 7480, 'gekko': 7481,
    'kasha': 7482, 'mangetsu': 7484, 'oka': 7485, 'hagakure': 7495,
    'higanbana': 7489, 'tenka goken': 7488, 'midare setsugekka': 7487,
    'tendo goken': 36965 /* v */, 'tendo setsugekka': 36966 /* v */,
    // VPR
    "hunter's sting": 34608 /* v */, "swiftskin's sting": 34609 /* v */,
    'vicewinder': 34620 /* v */, "hunter's coil": 34621 /* v */,
    "swiftskin's coil": 34622 /* v */,
    // positional finishers that consume combo state
    'flanksting strike': 34610 /* v */, 'flanksbane fang': 34611 /* v */,
    'hindsting strike': 34612 /* v */, 'hindsbane fang': 34613 /* v */,
    'gibbet': 24382, 'gallows': 24383,
    "executioner's gibbet": 36970 /* v */, "executioner's gallows": 36971 /* v */,
  };
  const ID_TO_KEY = {};
  for (const k of Object.keys(ACTIONS)) ID_TO_KEY[ACTIONS[k]] = k;

  const STATUSES = {
    'soul reaver': 2587, 'executioner': 3858,
    'enhanced gibbet': 2588, 'enhanced gallows': 2589,
    'meikyo shisui': 1233,
    // Both *stung/*bane venoms of a side map to the same positional, so the
    // exact id↔name pairing inside a pair doesn't matter.
    'flankstung venom': 3645, 'flanksbane venom': 3646,
    'hindstung venom': 3647, 'hindsbane venom': 3648,
    'swiftscaled': null, "hunter's instinct": null,
    'trick attack': 3254, "kunai's bane": 3906,
  };
  const STATUS_ID_TO_KEY = {};
  for (const k of Object.keys(STATUSES)) {
    if (STATUSES[k] != null) STATUS_ID_TO_KEY[STATUSES[k]] = k;
  }

  const COMBO_WINDOW_MS = 30000; // the in-game combo timer
  const VICEWINDER_WINDOW_MS = 30000;

  const COMBO_SETTERS = new Set([
    'true strike', 'twin snakes', 'rising raptor',
    'full thrust', "heavens' thrust", 'disembowel', 'spiral blow',
    'chaos thrust', 'chaotic spring',
    'gust slash', 'jinpu', 'shifu',
    "hunter's sting", "swiftskin's sting",
  ]);
  // Anything that ends the tracked chain (positionals + chain enders).
  const COMBO_CLEARERS = new Set([
    'snap punch', 'demolish', 'pouncing coeurl',
    'fang and claw', 'wheeling thrust', 'drakesbane',
    'aeolian edge', 'armor crush',
    'gekko', 'kasha', 'yukikaze',
    'flanksting strike', 'flanksbane fang', 'hindsting strike', 'hindsbane fang',
  ]);

  const MNK_RAPTOR_GCDS = new Set(['true strike', 'twin snakes', 'rising raptor']);
  const SAM_IAIJUTSU = new Set([
    'higanbana', 'tenka goken', 'midare setsugekka', 'tendo goken',
    'tendo setsugekka', 'hagakure',
  ]);
  const VPR_FLANK_VENOMS = ['flankstung venom', 'flanksbane venom'];
  const VPR_REAR_VENOMS = ['hindstung venom', 'hindsbane venom'];

  function create() {
    const st = {
      combo: null,
      comboAt: 0,
      lastWeaponskill: null,
      lastWeaponskillAt: 0,
      coeurlFury: 0,
      kazematoi: 0,
      sen: { getsu: false, ka: false, setsu: false },
      self: {}, // status key → expiry ms (Infinity when duration unknown)
      enemies: {}, // targetId → { status key → expiry ms }
      vwCoils: null, // count of coils used since last Vicewinder
    };

    function reset() {
      st.combo = null;
      st.lastWeaponskill = null;
      st.coeurlFury = 0;
      st.kazematoi = 0;
      st.sen = { getsu: false, ka: false, setsu: false };
      st.self = {};
      st.enemies = {};
      st.vwCoils = null;
    }

    function keyOf(id, name) {
      return ID_TO_KEY[id] || (String(name || '').toLowerCase() in ACTIONS ? String(name).toLowerCase() : null);
    }
    function statusKeyOf(id, name) {
      const n = String(name || '').toLowerCase();
      return STATUS_ID_TO_KEY[id] || (n in STATUSES ? n : null);
    }

    function has(key, now) {
      return st.self[key] != null && st.self[key] > now;
    }
    function remaining(key, now) {
      return has(key, now) ? st.self[key] - now : 0;
    }
    function enemyHas(targetId, key, now) {
      const e = st.enemies[targetId];
      return !!(e && e[key] != null && e[key] > now);
    }

    function onPlayerAction(id, name, now) {
      const key = keyOf(id, name);
      if (!key) return;
      st.lastWeaponskill = key;
      st.lastWeaponskillAt = now;

      // gauges
      if (key === 'demolish') st.coeurlFury = 2;
      else if (key === 'snap punch' || key === 'pouncing coeurl')
        st.coeurlFury = Math.max(0, st.coeurlFury - 1);
      else if (key === 'armor crush') st.kazematoi = Math.min(4, st.kazematoi + 2);
      else if (key === 'aeolian edge') st.kazematoi = Math.max(0, st.kazematoi - 1);

      // sen
      if (key === 'gekko' || key === 'mangetsu') st.sen.getsu = true;
      else if (key === 'kasha' || key === 'oka') st.sen.ka = true;
      else if (key === 'yukikaze') st.sen.setsu = true;
      else if (SAM_IAIJUTSU.has(key)) st.sen = { getsu: false, ka: false, setsu: false };

      // Vicewinder chain
      if (key === 'vicewinder') st.vwCoils = 0;
      else if (key === "hunter's coil" || key === "swiftskin's coil") {
        if (st.vwCoils !== null) st.vwCoils++;
        if (st.vwCoils >= 2) st.vwCoils = null;
      }

      // combo chain
      if (COMBO_SETTERS.has(key)) {
        st.combo = key;
        st.comboAt = now;
      } else if (COMBO_CLEARERS.has(key)) {
        st.combo = null;
      }
    }

    function onSelfStatus(gained, id, name, duration, now) {
      const key = statusKeyOf(id, name);
      if (!key) return;
      if (gained) st.self[key] = duration ? now + duration * 1000 : Infinity;
      else delete st.self[key];
    }

    function onEnemyStatus(gained, targetId, id, name, duration, now) {
      const key = statusKeyOf(id, name);
      if (!key) return;
      if (gained) {
        (st.enemies[targetId] = st.enemies[targetId] || {})[key] = duration
          ? now + duration * 1000
          : Infinity;
      } else if (st.enemies[targetId]) {
        delete st.enemies[targetId][key];
      }
    }

    function combo(now) {
      if (st.combo && now - st.comboAt <= COMBO_WINDOW_MS) return st.combo;
      return null;
    }

    /* → { pos: 'rear'|'flank', why: string } | null */
    function get(now, targetId) {
      const c = combo(now);

      // MNK — after a raptor GCD, coeurl form is next: Pouncing/Snap (flank)
      // while Coeurl's Fury is stocked, Demolish (rear) when empty.
      if (c && MNK_RAPTOR_GCDS.has(c))
        return st.coeurlFury > 0
          ? { pos: 'flank', why: "Coeurl's Fury" }
          : { pos: 'rear', why: 'Demolish' };

      // DRG
      if (c === 'disembowel' || c === 'spiral blow')
        return { pos: 'rear', why: 'Chaotic Spring' };
      if (c === 'chaos thrust' || c === 'chaotic spring')
        return { pos: 'rear', why: 'Wheeling Thrust' };
      if (c === 'full thrust' || c === "heavens' thrust")
        return { pos: 'flank', why: 'Fang and Claw' };

      // NIN — after Gust Slash: Aeolian (rear) while Kazematoi is stocked
      // high or Trick/Kunai's Bane is running; Armor Crush (flank) to stock.
      if (c === 'gust slash') {
        const trick = enemyHas(targetId, 'trick attack', now) || enemyHas(targetId, "kunai's bane", now);
        return st.kazematoi > 3 || (st.kazematoi > 0 && trick)
          ? { pos: 'rear', why: 'Aeolian Edge' }
          : { pos: 'flank', why: 'Armor Crush' };
      }

      // SAM
      if (c === 'jinpu') return { pos: 'rear', why: 'Gekko' };
      if (c === 'shifu') return { pos: 'flank', why: 'Kasha' };
      if (has('meikyo shisui', now)) {
        if (st.sen.ka && !st.sen.getsu) return { pos: 'rear', why: 'Gekko (Meikyo)' };
        if (!st.sen.ka) return { pos: 'flank', why: 'Kasha (Meikyo)' };
      }

      // RPR — only while a Soul Reaver / Executioner charge is up.
      if (has('soul reaver', now) || has('executioner', now)) {
        if (has('enhanced gallows', now)) return { pos: 'rear', why: 'Gallows' };
        if (has('enhanced gibbet', now)) return { pos: 'flank', why: 'Gibbet' };
        return { pos: 'rear', why: 'Gallows' }; // no enhancement: convention
      }

      // VPR — Vicewinder chain: first coil by whichever buff runs out
      // sooner, then the other coil. Checked before the sting rule because
      // Vicewinder doesn't break the basic combo — the coil you're mid-way
      // through is what matters right now.
      if (st.vwCoils !== null && now - st.lastWeaponskillAt <= VICEWINDER_WINDOW_MS) {
        if (st.vwCoils === 0 && st.lastWeaponskill === 'vicewinder')
          return remaining('swiftscaled', now) <= remaining("hunter's instinct", now)
            ? { pos: 'rear', why: "Swiftskin's Coil" }
            : { pos: 'flank', why: "Hunter's Coil" };
        if (st.vwCoils === 1 && st.lastWeaponskill === "hunter's coil")
          return { pos: 'rear', why: "Swiftskin's Coil" };
        if (st.vwCoils === 1 && st.lastWeaponskill === "swiftskin's coil")
          return { pos: 'flank', why: "Hunter's Coil" };
      }

      // VPR — single-target chain: venom decides the finisher pair.
      if (c === "hunter's sting" || c === "swiftskin's sting") {
        if (VPR_FLANK_VENOMS.some((v) => has(v, now)))
          return { pos: 'flank', why: 'venom' };
        return { pos: 'rear', why: VPR_REAR_VENOMS.some((v) => has(v, now)) ? 'venom' : 'default' };
      }

      return null;
    }

    return { reset, onPlayerAction, onSelfStatus, onEnemyStatus, get, _state: st };
  }

  return { create, ACTIONS, STATUSES };
});
