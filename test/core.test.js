/* Tests for overlay/js/core.js against real log lines from cactbot's
 * LogGuide.md. Run with: node test/core.test.js */
'use strict';
const assert = require('assert');
const Core = require('../overlay/js/core.js');
const Data = require('../overlay/js/data.js');

// Real auto-attack line (LogGuide): Potato Chippy → Right Foreleg.
const AUTO_ATTACK =
  '21|2021-07-27T12:46:22.9530000-04:00|10FF0002|Potato Chippy|07|Attack|40024FC5|Right Foreleg|710003|3910000|0|0|0|0|0|0|0|0|0|0|0|0|0|0|378341|380640|8840|10000|0|1000|-6.37015|-7.477235|10.54466|0.02791069|26396|26396|10000|10000|0|1000|-5.443688|-1.163282|10.54466|-2.9113|0000DB6E|0|1|00||01|07|07|0.100|34BC'.split('|');

// Real Aeolian Edge line (LogGuide): combo + positional, direct hit, 68% bonus.
const AEOLIAN =
  '21|2022-09-13T17:25:12.4790000-07:00|10827569|Name Removed|8CF|Aeolian Edge|4000A062|Hegemone|44714003|37120000|A3D|9F8000|53D|9F8000|11B|8CF8000|0|0|0|0|0|0|0|0|1|1|0|0|0|0|-6.37|-7.47|10.5|0.027|1|1|0|0|0|0|-5.44|-1.16|10.5|-2.91|0000DB6E|0|1|00||01|8CF|8CF|0.100|34BC'.split('|');

// ---- angle math ----
{
  // Heading convention: h = atan2(dx, dy). From the auto-attack line the
  // caster (-5.44, -1.16) faces heading -2.9113 and its target sits at
  // (-6.37, -7.48) — the caster must be facing it (attacks require facing).
  const casterToTarget = Core.headingFromTo(-5.443688, -1.163282, -6.37015, -7.477235);
  assert.ok(Math.abs(Core.normPi(casterToTarget - -2.9113)) < 0.15, 'heading convention broken');

  assert.strictEqual(Core.sectorOf(0), 'front');
  assert.strictEqual(Core.sectorOf(Math.PI), 'rear');
  assert.strictEqual(Core.sectorOf(-Math.PI), 'rear');
  assert.strictEqual(Core.sectorOf(Math.PI / 2), 'flank');
  assert.strictEqual(Core.sectorOf(-Math.PI / 2), 'flank');
  assert.strictEqual(Core.sectorOf(Math.PI / 4 - 0.01), 'front');
  assert.strictEqual(Core.sectorOf(Math.PI / 4 + 0.01), 'flank');
  assert.strictEqual(Core.sectorOf((3 * Math.PI) / 4 + 0.01), 'rear');
}

// ---- ability line parsing ----
{
  const line = Core.parseAbilityLine(AUTO_ATTACK);
  assert.ok(line, 'auto attack line parses');
  assert.strictEqual(line.sourceId, 0x10ff0002);
  assert.strictEqual(line.abilityId, 0x07);
  assert.strictEqual(line.abilityName, 'Attack');
  assert.strictEqual(line.targetId, 0x40024fc5);
  assert.strictEqual(line.target.x, -6.37015);
  assert.strictEqual(line.target.heading, 0.02791069);
  assert.strictEqual(line.source.heading, -2.9113);
  assert.strictEqual(line.targetIndex, 0);

  // Attacker is in front of this target (rel ≈ +0.12 rad).
  const rel = Core.relativeAngle(line.target, line.source);
  assert.strictEqual(Core.sectorOf(rel), 'front');

  assert.strictEqual(Core.parseAbilityLine(['20', 'x']), null);
  assert.strictEqual(Core.parseAbilityLine(null), null);
}

// ---- damage effect decoding ----
{
  const line = Core.parseAbilityLine(AEOLIAN);
  const dmg = Core.damageEffect(line.effects);
  assert.strictEqual(dmg.kind, Core.EFFECT.DAMAGE);
  assert.strictEqual(dmg.crit, false);
  assert.strictEqual(dmg.directHit, true);
  assert.strictEqual(dmg.bonusPercent, 0x44); // 68% combo+positional bonus
  assert.strictEqual(dmg.amount, 0x3712); // 14098

  // Plain auto attack: no bonus percent.
  const aa = Core.damageEffect(Core.parseAbilityLine(AUTO_ATTACK).effects);
  assert.strictEqual(aa.bonusPercent, 0);
  assert.strictEqual(aa.amount, 0x0391);

  // "Big number" scrambling from the LogGuide: 423F400F → 999999.
  assert.strictEqual(Core.unscrambleDamage('423F400F'), 999999);
  assert.strictEqual(Core.unscrambleDamage('37120000'), 14098);
  assert.strictEqual(Core.unscrambleDamage('1000'), 0);
}

// ---- status lines ----
{
  const gain = Core.parseStatusLine(
    '26|2021-04-26T14:36:09.4340000-04:00|4E2|True North|10.00|10FF0001|Tini Poutini|10FF0001|Tini Poutini|00|111111|111111'.split('|')
  );
  assert.strictEqual(gain.gained, true);
  assert.strictEqual(gain.effectId, Data.STATUS.TRUE_NORTH.id);
  assert.strictEqual(gain.duration, 10);
  assert.strictEqual(gain.targetId, 0x10ff0001);

  const lose = Core.parseStatusLine(
    '30|2021-04-26T14:36:19.4340000-04:00|4E2|True North|0.00|10FF0001|Tini Poutini|10FF0001|Tini Poutini|00'.split('|')
  );
  assert.strictEqual(lose.gained, false);
}

// ---- classification ----
{
  const index = Core.buildActionIndex(Data.POSITIONAL_ACTIONS);
  const demolish = index.find(66, 'Demolish');
  assert.strictEqual(demolish.pos, 'rear');
  assert.strictEqual(index.find(999999, 'demolish'), demolish, 'name fallback');
  assert.strictEqual(index.find(1, 'Fire IV'), null);

  const mkLine = (flags, relDeg) => {
    // Target at origin facing +y; place source at angle relDeg around it.
    const rad = (relDeg * Math.PI) / 180;
    return {
      effects: [{ flags, valueHex: '1230000' }],
      target: { x: 0, y: 0, heading: 0 },
      source: { x: 5 * Math.sin(rad), y: 5 * Math.cos(rad), heading: 0 },
    };
  };

  // Packet rule: Demolish (pctRule nonzero) — bonus byte decides.
  let r = Core.classifyPositional(demolish, mkLine(0x0f000003, 0)); // pct 15, geo front
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.method, 'packet');
  r = Core.classifyPositional(demolish, mkLine(0x00000003, 180)); // pct 0, geo rear
  assert.strictEqual(r.hit, false, 'packet byte outranks geometry');

  // True North outranks everything.
  r = Core.classifyPositional(demolish, mkLine(0x00000003, 0), { trueNorth: true });
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.method, 'true-north');

  // Geometry rule: Gekko (combo action, no pctRule).
  const gekko = index.find(7481, 'Gekko');
  r = Core.classifyPositional(gekko, mkLine(0x38000003, 179));
  assert.strictEqual(r.hit, true);
  assert.strictEqual(r.method, 'geometry');
  assert.strictEqual(r.sector, 'rear');
  r = Core.classifyPositional(gekko, mkLine(0x38000003, 90));
  assert.strictEqual(r.hit, false);
  assert.strictEqual(r.sector, 'flank');

  // Dodged: unresolvable.
  r = Core.classifyPositional(demolish, mkLine(0x00000001, 180));
  assert.strictEqual(r.hit, null);
  assert.strictEqual(r.method, 'dodged');
}

console.log('all core tests passed');
