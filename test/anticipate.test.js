/* Tests for overlay/js/anticipate.js — per-job next-positional rules,
 * mirroring Avarice. Run with: node test/anticipate.test.js */
'use strict';
const assert = require('assert');
const Anticipate = require('../overlay/js/anticipate.js');

const TGT = 0x40001234;
let now = 1_000_000;
const tick = (ms = 2500) => (now += ms);

function fresh() {
  now = 1_000_000;
  return Anticipate.create();
}
// helpers: drive by name only (id fallback is tested separately)
const act = (a, name) => a.onPlayerAction(null, name, tick());
const buff = (a, name, dur) => a.onSelfStatus(true, null, name, dur || 0, now);
const unbuff = (a, name) => a.onSelfStatus(false, null, name, null, now);
const get = (a) => a.get(now, TGT);

// ---- SAM ----
{
  const a = fresh();
  assert.strictEqual(get(a), null);
  act(a, 'Jinpu');
  assert.strictEqual(get(a).pos, 'rear');
  act(a, 'Gekko'); // consumes combo, grants Getsu
  assert.strictEqual(get(a), null);
  act(a, 'Shifu');
  assert.strictEqual(get(a).pos, 'flank');
  now += 31000; // combo timer ran out
  assert.strictEqual(get(a), null);

  // Meikyo: no combo tracking; sen decides. Spend banked sen first, then
  // with no Ka → flank (Kasha).
  act(a, 'Midare Setsugekka');
  buff(a, 'Meikyo Shisui', 20);
  assert.strictEqual(get(a).pos, 'flank');
  act(a, 'Kasha'); // now Ka, no Getsu → rear (Gekko)
  assert.strictEqual(get(a).pos, 'rear');
  act(a, 'Gekko'); // both → nothing left
  assert.strictEqual(get(a), null);
  unbuff(a, 'Meikyo Shisui');

  // Iaijutsu clears sen.
  act(a, 'Midare Setsugekka');
  assert.deepStrictEqual(a._state.sen, { getsu: false, ka: false, setsu: false });
}

// ---- MNK ----
{
  const a = fresh();
  act(a, 'Twin Snakes'); // raptor GCD, fury 0 → rear (Demolish)
  assert.strictEqual(get(a).pos, 'rear');
  act(a, 'Demolish'); // fury = 2, combo consumed
  assert.strictEqual(get(a), null);
  act(a, 'Rising Raptor'); // fury 2 → flank
  assert.strictEqual(get(a).pos, 'flank');
  act(a, 'Pouncing Coeurl'); // fury 1
  act(a, 'True Strike'); // fury 1 → flank
  assert.strictEqual(get(a).pos, 'flank');
  act(a, 'Snap Punch'); // fury 0
  act(a, 'Twin Snakes');
  assert.strictEqual(get(a).pos, 'rear');
}

// ---- DRG ----
{
  const a = fresh();
  act(a, 'Disembowel');
  assert.strictEqual(get(a).pos, 'rear'); // Chaotic Spring
  act(a, 'Chaotic Spring');
  assert.strictEqual(get(a).pos, 'rear'); // Wheeling Thrust
  act(a, 'Wheeling Thrust');
  assert.strictEqual(get(a), null);
  act(a, "Heavens' Thrust");
  assert.strictEqual(get(a).pos, 'flank'); // Fang and Claw
  act(a, 'Fang and Claw');
  assert.strictEqual(get(a), null);
}

// ---- NIN ----
{
  const a = fresh();
  act(a, 'Gust Slash'); // kazematoi 0 → flank (Armor Crush)
  assert.strictEqual(get(a).pos, 'flank');
  act(a, 'Armor Crush'); // kazematoi 2
  act(a, 'Gust Slash'); // 1–3 stacks, no trick → still flank (bank more)
  assert.strictEqual(get(a).pos, 'flank');
  a.onEnemyStatus(true, TGT, null, 'Trick Attack', 15, now);
  assert.strictEqual(get(a).pos, 'rear'); // spend under Trick
  a.onEnemyStatus(false, TGT, null, 'Trick Attack', null, now);
  act(a, 'Armor Crush'); // kazematoi 4
  act(a, 'Gust Slash');
  assert.strictEqual(get(a).pos, 'rear'); // > 3 → don't overcap
}

// ---- RPR ----
{
  const a = fresh();
  buff(a, 'Enhanced Gallows', 30);
  assert.strictEqual(get(a), null, 'no hint without Soul Reaver');
  buff(a, 'Soul Reaver', 30);
  assert.strictEqual(get(a).pos, 'rear');
  unbuff(a, 'Enhanced Gallows');
  buff(a, 'Enhanced Gibbet', 30);
  assert.strictEqual(get(a).pos, 'flank');
  unbuff(a, 'Enhanced Gibbet');
  assert.strictEqual(get(a).pos, 'rear'); // unenhanced default
  unbuff(a, 'Soul Reaver');
  assert.strictEqual(get(a), null);
  buff(a, 'Executioner', 30); // DT gate works too
  assert.strictEqual(get(a).pos, 'rear');
}

// ---- VPR ----
{
  const a = fresh();
  act(a, "Hunter's Sting");
  assert.strictEqual(get(a).pos, 'rear'); // no venom → default rear
  buff(a, 'Flankstung Venom', 40);
  assert.strictEqual(get(a).pos, 'flank');
  act(a, 'Flanksting Strike');
  assert.strictEqual(get(a), null);
  unbuff(a, 'Flankstung Venom');
  buff(a, 'Hindsbane Venom', 40);
  act(a, "Swiftskin's Sting");
  assert.strictEqual(get(a).pos, 'rear');

  // Vicewinder chain: Swiftscaled shorter → Swiftskin's Coil (rear) first.
  buff(a, 'Swiftscaled', 10);
  buff(a, "Hunter's Instinct", 30);
  act(a, 'Vicewinder');
  assert.strictEqual(get(a).pos, 'rear');
  act(a, "Swiftskin's Coil");
  assert.strictEqual(get(a).pos, 'flank'); // other coil next
  act(a, "Hunter's Coil");
  // Both coils spent — falls back to the still-pending sting combo (the
  // Vicewinder chain doesn't break the basic combo).
  assert.deepStrictEqual(get(a), { pos: 'rear', why: 'venom' });
  act(a, 'Hindsbane Fang');
  assert.strictEqual(get(a), null);
}

// ---- id-based matching (names unavailable, e.g. non-EN client) ----
{
  const a = fresh();
  a.onPlayerAction(7478, 'ジンプウ', tick());
  assert.strictEqual(get(a).pos, 'rear');
  const b = fresh();
  b.onSelfStatus(true, 2587, '妖異の魂', 30, now);
  assert.strictEqual(get(b).pos, 'rear');
}

// ---- reset ----
{
  const a = fresh();
  act(a, 'Jinpu');
  a.reset();
  assert.strictEqual(get(a), null);
}

console.log('all anticipate tests passed');
