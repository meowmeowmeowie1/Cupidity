/* Cupidity data — positional actions and statuses.
 *
 * pos: which quadrant the bonus requires ('rear' | 'flank').
 *
 * pctRule 'nonzero': the action's ONLY potency bonus is the positional, so
 * the packet's bonus-percent byte is an exact hit/miss signal (pct > 0 ⟺
 * positional hit). Actions with combo bonuses (SAM, NIN, DRG Chaotic Spring)
 * or status-conditional potency (RPR Enhanced buffs, VPR venoms, MNK fury)
 * would pollute that byte, so they resolve by packet geometry instead.
 *
 * verify: true marks action IDs taken from community references but not yet
 * confirmed against a live network log. Matching also falls back to the
 * English name, so an incorrect ID only affects non-English clients.
 *
 * Current as of patch 7.x (Dawntrail). When a patch changes positionals,
 * edit this table — no other code changes needed.
 */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CupidityData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const POSITIONAL_ACTIONS = [
    // Monk
    { id: 56, en: 'Snap Punch', job: 'MNK', pos: 'flank', pctRule: 'nonzero' },
    { id: 36947, en: 'Pouncing Coeurl', job: 'MNK', pos: 'flank', verify: true },
    { id: 66, en: 'Demolish', job: 'MNK', pos: 'rear', pctRule: 'nonzero' },

    // Dragoon (Fang and Claw / Wheeling Thrust keep positionals until
    // Drakesbane replaces them at level 64)
    { id: 88, en: 'Chaos Thrust', job: 'DRG', pos: 'rear' },
    { id: 25772, en: 'Chaotic Spring', job: 'DRG', pos: 'rear' },
    { id: 3554, en: 'Fang and Claw', job: 'DRG', pos: 'flank', pctRule: 'nonzero' },
    { id: 3556, en: 'Wheeling Thrust', job: 'DRG', pos: 'rear', pctRule: 'nonzero' },

    // Ninja (Kazematoi potency rides on Aeolian Edge, so geometry only)
    { id: 2255, en: 'Aeolian Edge', job: 'NIN', pos: 'rear' },
    { id: 3563, en: 'Armor Crush', job: 'NIN', pos: 'flank' },

    // Samurai
    { id: 7481, en: 'Gekko', job: 'SAM', pos: 'rear' },
    { id: 7482, en: 'Kasha', job: 'SAM', pos: 'flank' },

    // Reaper (Enhanced Gibbet/Gallows potency is status-conditional)
    { id: 24382, en: 'Gibbet', job: 'RPR', pos: 'flank' },
    { id: 24383, en: 'Gallows', job: 'RPR', pos: 'rear' },
    { id: 36970, en: "Executioner's Gibbet", job: 'RPR', pos: 'flank', verify: true },
    { id: 36971, en: "Executioner's Gallows", job: 'RPR', pos: 'rear', verify: true },

    // Viper (venom statuses add potency)
    { id: 34610, en: 'Flanksting Strike', job: 'VPR', pos: 'flank', verify: true },
    { id: 34611, en: 'Flanksbane Fang', job: 'VPR', pos: 'flank', verify: true },
    { id: 34612, en: 'Hindsting Strike', job: 'VPR', pos: 'rear', verify: true },
    { id: 34613, en: 'Hindsbane Fang', job: 'VPR', pos: 'rear', verify: true },
  ];

  const STATUS = {
    TRUE_NORTH: { id: 0x4e2, en: 'True North' },
  };

  const DEFAULTS = {
    // Enemy hitbox radius is not exposed to external tools, so the radar ring
    // is configurable. 5y suits most raid bosses; small trash is ~2y.
    hitboxRadius: 5.0,
    // Melee reach past the hitbox ring.
    meleeReach: 3.5,
  };

  return { POSITIONAL_ACTIONS, STATUS, DEFAULTS };
});
