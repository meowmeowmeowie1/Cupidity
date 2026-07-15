/* Cupidity core — pure log-line parsing + positional math.
 *
 * No DOM and no OverlayPlugin dependencies: this file runs both in the
 * browser overlay and under `node test/core.test.js`.
 */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CupidityCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const TAU = Math.PI * 2;

  // FFXIV headings satisfy h = atan2(dx, dy) toward the faced point (0 faces
  // +y), so a heading compares directly against atan2 between two positions.
  function normPi(a) {
    a %= TAU;
    if (a > Math.PI) a -= TAU;
    if (a < -Math.PI) a += TAU;
    return a;
  }

  function headingFromTo(x0, y0, x1, y1) {
    return Math.atan2(x1 - x0, y1 - y0);
  }

  // Signed angle of `actor` around `target`, relative to the target's facing.
  // 0 = directly in front, ±PI = directly behind, positive = target's left.
  function relativeAngle(target, actor) {
    return normPi(headingFromTo(target.x, target.y, actor.x, actor.y) - target.heading);
  }

  // The 360° around a target splits into four 90° quadrants; "flank" is
  // either side quadrant.
  function sectorOf(rel) {
    const a = Math.abs(rel);
    if (a <= Math.PI / 4) return 'front';
    if (a >= (3 * Math.PI) / 4) return 'rear';
    return 'flank';
  }

  const EFFECT = { DODGE: 0x01, DAMAGE: 0x03, HEAL: 0x04, BLOCK: 0x05, PARRY: 0x06 };

  // Ability line (21/22) field indices in the OverlayPlugin LogLine `line`
  // array (index 1 is the timestamp). See cactbot's LogGuide.md.
  const F = {
    TYPE: 0,
    SOURCE_ID: 2, SOURCE_NAME: 3,
    ABILITY_ID: 4, ABILITY_NAME: 5,
    TARGET_ID: 6, TARGET_NAME: 7,
    EFFECTS: 8, // 8 flags/value pairs → indices 8..23
    TARGET_X: 30, TARGET_Y: 31, TARGET_Z: 32, TARGET_HEADING: 33,
    SOURCE_X: 40, SOURCE_Y: 41, SOURCE_Z: 42, SOURCE_HEADING: 43,
    SEQUENCE: 44, TARGET_INDEX: 45, TARGET_COUNT: 46,
  };

  function toNum(s) {
    if (s === '' || s == null) return null;
    const n = Number(s);
    return Number.isNaN(n) ? null : n;
  }

  function actorAt(f, xi) {
    const x = toNum(f[xi]);
    const y = toNum(f[xi + 1]);
    if (x === null || y === null) return null;
    return { x, y, z: toNum(f[xi + 2]), heading: toNum(f[xi + 3]) };
  }

  function parseAbilityLine(f) {
    if (!Array.isArray(f)) return null;
    if (f[F.TYPE] !== '21' && f[F.TYPE] !== '22') return null;
    if (f.length <= F.TARGET_COUNT) return null;
    const effects = [];
    for (let i = 0; i < 8; i++) {
      const flags = parseInt(f[F.EFFECTS + i * 2], 16);
      if (!Number.isNaN(flags)) effects.push({ flags, valueHex: f[F.EFFECTS + i * 2 + 1] || '' });
    }
    return {
      kind: f[F.TYPE] === '21' ? 'single' : 'aoe',
      sourceId: parseInt(f[F.SOURCE_ID], 16),
      sourceName: f[F.SOURCE_NAME],
      abilityId: parseInt(f[F.ABILITY_ID], 16),
      abilityName: f[F.ABILITY_NAME],
      targetId: parseInt(f[F.TARGET_ID], 16),
      targetName: f[F.TARGET_NAME],
      effects,
      target: actorAt(f, F.TARGET_X),
      source: actorAt(f, F.SOURCE_X),
      sequence: f[F.SEQUENCE],
      targetIndex: toNum(f[F.TARGET_INDEX]),
    };
  }

  // 26|ts|effectId|name|duration|sourceId|sourceName|targetId|targetName|count|…
  // 30|ts|effectId|name|?|sourceId|sourceName|targetId|targetName|count|…
  function parseStatusLine(f) {
    if (!Array.isArray(f)) return null;
    if (f[0] !== '26' && f[0] !== '30') return null;
    if (f.length < 9) return null;
    return {
      gained: f[0] === '26',
      effectId: parseInt(f[2], 16),
      name: f[3],
      duration: f[0] === '26' ? toNum(f[4]) : null,
      sourceId: parseInt(f[5], 16),
      targetId: parseInt(f[7], 16),
    };
  }

  // Damage value scrambling per the LogGuide: pad to 4 bytes AABBCCDD; the
  // value is AABB unless CC carries the 0x40 "big number" bit, in which case
  // the bytes DD AA BB form the value (e.g. 423F400F → 0F423F = 999999).
  function unscrambleDamage(hex) {
    const v = String(hex || '0').padStart(8, '0');
    const a = parseInt(v.slice(0, 2), 16);
    const b = parseInt(v.slice(2, 4), 16);
    const c = parseInt(v.slice(4, 6), 16);
    const d = parseInt(v.slice(6, 8), 16);
    if (Number.isNaN(a + b + c + d)) return null;
    if (c & 0x40) return (d << 16) | (a << 8) | b;
    return (a << 8) | b;
  }

  // First damage-ish effect pair of an ability line. Flags AABBCCDD:
  //   DD effect type, CC severity (0x20 crit, 0x40 direct hit),
  //   AA percent of the final damage contributed by positional and/or combo
  //   bonuses — computed server-side, so it is ground truth.
  function damageEffect(effects) {
    for (const e of effects || []) {
      const kind = e.flags & 0xff;
      if (kind === EFFECT.DAMAGE || kind === EFFECT.DODGE || kind === EFFECT.BLOCK || kind === EFFECT.PARRY) {
        const sev = (e.flags >>> 8) & 0xff;
        return {
          kind,
          crit: !!(sev & 0x20),
          directHit: !!(sev & 0x40),
          bonusPercent: (e.flags >>> 24) & 0xff,
          amount: unscrambleDamage(e.valueHex),
        };
      }
    }
    return null;
  }

  /* Decide hit/miss for one use of a positional action.
   *
   * Precedence:
   *  1. True North active → hit (the game waives facing entirely).
   *  2. pctRule 'nonzero' + a clean damage effect → the server's own
   *     bonus-percent byte decides. Only used for actions whose sole potency
   *     bonus is the positional, where pct>0 ⟺ positional hit — exact.
   *  3. Geometry from the packet's own positions/headings. These are the
   *     server-snapshot values carried in the same ability line, not a
   *     client-side poll, so this is accurate to the packet.
   */
  function classifyPositional(action, line, opts = {}) {
    const dmg = damageEffect(line.effects);
    let rel = null;
    let sector = null;
    if (line.target && line.source && line.target.heading != null) {
      rel = relativeAngle(line.target, line.source);
      sector = sectorOf(rel);
    }
    const geoHit = sector === null ? null : sector === action.pos;
    const res = {
      hit: null,
      method: 'unknown',
      rel,
      sector,
      geoHit,
      damage: dmg,
      bonusPercent: dmg && dmg.kind === EFFECT.DAMAGE ? dmg.bonusPercent : null,
    };
    if (dmg && dmg.kind === EFFECT.DODGE) {
      res.method = 'dodged';
      return res;
    }
    if (opts.trueNorth) {
      res.hit = true;
      res.method = 'true-north';
      return res;
    }
    if (action.pctRule === 'nonzero' && dmg && dmg.kind === EFFECT.DAMAGE) {
      res.hit = dmg.bonusPercent > 0;
      res.method = 'packet';
      return res;
    }
    if (geoHit !== null) {
      res.hit = geoHit;
      res.method = 'geometry';
      return res;
    }
    return res;
  }

  function buildActionIndex(actions) {
    const byId = new Map();
    const byName = new Map();
    for (const a of actions) {
      if (a.id != null) byId.set(a.id, a);
      byName.set(a.en.toLowerCase(), a);
    }
    return {
      find(id, name) {
        return byId.get(id) || byName.get(String(name || '').toLowerCase()) || null;
      },
    };
  }

  return {
    TAU, normPi, headingFromTo, relativeAngle, sectorOf, EFFECT,
    parseAbilityLine, parseStatusLine, unscrambleDamage, damageEffect,
    classifyPositional, buildActionIndex,
  };
});
