/* Cupidity app — wires OverlayPlugin events to the tracker, radar and UI. */
'use strict';
(function () {
  const Core = window.CupidityCore;
  const Data = window.CupidityData;
  const actionIndex = Core.buildActionIndex(Data.POSITIONAL_ACTIONS);

  // ---------- config ----------
  const CONFIG_KEY = 'cupidity-config-v1';
  const config = Object.assign(
    {
      simpleMode: true, // just the REAR/FLANK/FRONT readout + hit/miss flash
      hitboxRadius: Data.DEFAULTS.hitboxRadius,
      meleeReach: Data.DEFAULTS.meleeReach,
      mirror: false,
      soundOnMiss: true,
      soundOnHit: false,
      showFeed: true,
      showFlash: true, // the on-screen "Skill ✓ / ✗" splash
    },
    (() => {
      try {
        return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
      } catch (e) {
        return {};
      }
    })()
  );

  function saveConfig() {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch (e) {
      /* storage unavailable — run with in-memory config */
    }
  }

  // ---------- state ----------
  const state = {
    playerId: null,
    playerName: null,
    targetId: null,
    trueNorth: false,
    trueNorthTimer: null,
    demoAnticipated: null,
    stats: new Map(), // action name → {hit, miss}
    lastPoll: null,
    pollBusy: false,
  };

  // ---------- dom ----------
  const $ = (id) => document.getElementById(id);
  const radar = new window.CupidityRadar.Radar($('radar'));
  const sectorEl = $('sector');
  const rangeEl = $('range');
  const tnEl = $('tn-badge');
  const splashEl = $('splash');
  const feedEl = $('feed');
  const statsBody = $('stats-body');
  const statsTotal = $('stats-total');

  // ---------- sound ----------
  let audioCtx = null;
  function beep(freqs, dur) {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      let t = audioCtx.currentTime;
      for (const f of freqs) {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + dur);
        t += dur;
      }
    } catch (e) {
      /* audio unavailable */
    }
  }
  const missSound = () => beep([220, 165], 0.12);
  const hitSound = () => beep([880], 0.05);

  // ---------- feedback ----------
  let splashTimer = null;
  function showSplash(text, cls) {
    if (!config.showFlash) return;
    splashEl.textContent = text;
    splashEl.className = 'splash show ' + cls;
    clearTimeout(splashTimer);
    splashTimer = setTimeout(() => (splashEl.className = 'splash'), 1400);
  }

  function addFeed(text, cls) {
    if (!config.showFeed) return;
    const div = document.createElement('div');
    div.className = 'feed-item ' + cls;
    div.textContent = text;
    feedEl.prepend(div);
    while (feedEl.children.length > 6) feedEl.removeChild(feedEl.lastChild);
  }

  function renderStats() {
    statsBody.textContent = '';
    let hits = 0;
    let misses = 0;
    for (const [name, s] of state.stats) {
      hits += s.hit;
      misses += s.miss;
      const row = document.createElement('tr');
      const pct = s.hit + s.miss ? Math.round((100 * s.hit) / (s.hit + s.miss)) : 0;
      for (const cell of [name, s.hit, s.miss, pct + '%']) {
        const td = document.createElement('td');
        td.textContent = cell;
        row.appendChild(td);
      }
      statsBody.appendChild(row);
    }
    const total = hits + misses;
    statsTotal.textContent = total
      ? `${hits}/${total} (${Math.round((100 * hits) / total)}%)`
      : '—';
  }

  function resetStats() {
    state.stats.clear();
    renderStats();
  }

  // ---------- anticipated positional ----------
  // Mirrors Avarice's per-job rules; state is rebuilt from the player's own
  // log lines (combo chain, gauge counters, statuses). See anticipate.js.
  const anticipator = window.CupidityAnticipate.create();

  function activeAnticipated() {
    if (state.demoAnticipated) return { pos: state.demoAnticipated };
    return anticipator.get(Date.now(), state.targetId);
  }

  // ---------- positional result handling ----------
  function onAbilityLine(fields) {
    const line = Core.parseAbilityLine(fields);
    if (!line || line.sourceId !== state.playerId) return;
    if (line.targetIndex !== null && line.targetIndex !== 0) return; // count once

    anticipator.onPlayerAction(line.abilityId, line.abilityName, Date.now());

    const action = actionIndex.find(line.abilityId, line.abilityName);
    if (!action) return;

    const res = Core.classifyPositional(action, line, { trueNorth: state.trueNorth });
    if (res.hit === null) return; // dodged / unresolvable

    const s = state.stats.get(action.en) || { hit: 0, miss: 0 };
    res.hit ? s.hit++ : s.miss++;
    state.stats.set(action.en, s);
    renderStats();

    const via =
      res.method === 'true-north' ? 'TN' : res.method === 'packet' ? `+${res.bonusPercent}%` : res.sector || '';
    if (res.hit) {
      showSplash(`${action.en} ✓`, 'hit');
      if (config.soundOnHit) hitSound();
      addFeed(`✓ ${action.en} (${via})`, 'hit');
    } else {
      showSplash(`${action.en} ✗ ${action.pos.toUpperCase()}!`, 'miss');
      if (config.soundOnMiss) missSound();
      addFeed(`✗ ${action.en} — needed ${action.pos}, was ${res.sector || '?'}`, 'miss');
    }
  }

  function onStatusLine(fields) {
    const st = Core.parseStatusLine(fields);
    if (!st) return;

    if (st.targetId === state.playerId) {
      anticipator.onSelfStatus(st.gained, st.effectId, st.name, st.duration, Date.now());
    } else if (st.sourceId === state.playerId) {
      // The player's debuffs on enemies (Trick Attack / Kunai's Bane).
      anticipator.onEnemyStatus(st.gained, st.targetId, st.effectId, st.name, st.duration, Date.now());
      return;
    }
    if (st.targetId !== state.playerId) return;

    const tn = Data.STATUS.TRUE_NORTH;
    if (st.effectId !== tn.id && st.name !== tn.en) return;
    clearTimeout(state.trueNorthTimer);
    if (st.gained) {
      state.trueNorth = true;
      // Safety net in case the removal line is missed.
      if (st.duration) state.trueNorthTimer = setTimeout(() => (state.trueNorth = false), st.duration * 1000 + 500);
    } else {
      state.trueNorth = false;
    }
    tnEl.classList.toggle('on', state.trueNorth);
  }

  // ---------- live radar polling ----------
  async function pollPositions() {
    if (state.pollBusy || !state.playerId || !state.targetId) return;
    state.pollBusy = true;
    try {
      const data = await window.callOverlayHandler({
        call: 'getCombatants',
        ids: [state.playerId, state.targetId],
      });
      const list = (data && data.combatants) || [];
      const me = list.find((c) => c.ID === state.playerId);
      const tgt = list.find((c) => c.ID === state.targetId);
      state.lastPoll =
        me && tgt
          ? {
              player: { x: me.PosX, y: me.PosY },
              target: { x: tgt.PosX, y: tgt.PosY, heading: tgt.Heading },
            }
          : null;
    } catch (e) {
      state.lastPoll = null;
    } finally {
      state.pollBusy = false;
    }
  }

  function renderRadar() {
    const p = state.lastPoll;
    const hasTarget = !!(p && state.targetId);
    // Show nothing at all without a target (topbar stays reachable on hover).
    document.body.classList.toggle('no-target', !hasTarget);
    if (!hasTarget) {
      radar.draw({ hasTarget: false });
      // Only visible while the overlay is unlocked for placement.
      sectorEl.textContent = 'REAR';
      sectorEl.className = 'sector want ok';
      rangeEl.textContent = 'no target';
      rangeEl.className = 'range';
      return;
    }
    const rel = Core.relativeAngle(p.target, p.player);
    const sector = Core.sectorOf(rel);
    const dx = p.player.x - p.target.x;
    const dy = p.player.y - p.target.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    radar.draw({
      hasTarget: true,
      rel,
      dist,
      sector,
      hitbox: config.hitboxRadius,
      meleeReach: config.meleeReach,
      mirror: config.mirror,
    });

    // Big word: the positional you need next (green when you're standing in
    // it, red when not). Falls back to the current sector when the next
    // positional isn't knowable (MNK/NIN, or no combo in flight).
    const ant = activeAnticipated();
    if (ant) {
      const inPos = state.trueNorth || sector === ant.pos;
      sectorEl.textContent = ant.pos.toUpperCase();
      sectorEl.className = 'sector want ' + (inPos ? 'ok' : 'bad');
    } else {
      sectorEl.textContent = sector.toUpperCase();
      sectorEl.className = 'sector ' + sector;
    }

    const edge = dist - config.hitboxRadius;
    const inMelee = dist <= config.hitboxRadius + config.meleeReach;
    rangeEl.textContent = `${sector} · ${edge.toFixed(1)}y ${inMelee ? '· in melee' : '· OUT OF RANGE'}`;
    rangeEl.className = 'range' + (inMelee ? '' : ' out');
  }

  // ---------- config panel ----------
  function bindConfig() {
    const panel = $('config-panel');
    $('btn-config').addEventListener('click', () => panel.classList.toggle('open'));
    $('btn-reset').addEventListener('click', resetStats);

    const bindCheck = (id, key) => {
      const el = $(id);
      el.checked = config[key];
      el.addEventListener('change', () => {
        config[key] = el.checked;
        saveConfig();
      });
    };
    const bindNum = (id, key) => {
      const el = $(id);
      el.value = config[key];
      el.addEventListener('change', () => {
        const v = parseFloat(el.value);
        if (!Number.isNaN(v) && v > 0) {
          config[key] = v;
          saveConfig();
        }
      });
    };
    const applySimple = () => document.body.classList.toggle('simple', config.simpleMode);
    const simpleEl = $('cfg-simple');
    simpleEl.checked = config.simpleMode;
    simpleEl.addEventListener('change', () => {
      config.simpleMode = simpleEl.checked;
      saveConfig();
      applySimple();
    });
    applySimple();

    bindCheck('cfg-mirror', 'mirror');
    bindCheck('cfg-sound-miss', 'soundOnMiss');
    bindCheck('cfg-sound-hit', 'soundOnHit');
    bindCheck('cfg-feed', 'showFeed');
    bindCheck('cfg-flash', 'showFlash');
    bindNum('cfg-hitbox', 'hitboxRadius');
    bindNum('cfg-reach', 'meleeReach');
  }

  // ---------- demo mode (?demo=1) ----------
  function startDemo() {
    document.body.classList.add('demo');
    let t = 0;
    state.targetId = 1;
    state.demoAnticipated = 'rear';
    setInterval(() => {
      t += 0.05;
      const orbit = 4.5 + 3 * Math.sin(t / 3);
      state.lastPoll = {
        target: { x: 100, y: 100, heading: Core.normPi(t / 4) },
        player: { x: 100 + orbit * Math.sin(t), y: 100 + orbit * Math.cos(t) },
      };
      renderRadar();
    }, 50);
    setInterval(() => {
      const p = state.lastPoll;
      const rel = Core.relativeAngle(p.target, p.player);
      const hit = Core.sectorOf(rel) === 'rear';
      const s = state.stats.get('Demolish') || { hit: 0, miss: 0 };
      hit ? s.hit++ : s.miss++;
      state.stats.set('Demolish', s);
      renderStats();
      showSplash(hit ? 'Demolish ✓' : 'Demolish ✗ REAR!', hit ? 'hit' : 'miss');
      addFeed(hit ? '✓ Demolish (rear)' : `✗ Demolish — needed rear, was ${Core.sectorOf(rel)}`, hit ? 'hit' : 'miss');
    }, 2500);
  }

  // ---------- boot ----------
  function main() {
    // ?simple=1 / ?simple=0 overrides the saved setting (handy for keeping
    // two overlay instances with different modes).
    const simpleParam = /[?&]simple=([01])/.exec(window.location.search);
    if (simpleParam) config.simpleMode = simpleParam[1] === '1';

    bindConfig();
    renderStats();

    if (/[?&]demo=1/.test(window.location.search)) {
      startDemo();
      return;
    }

    window.addOverlayListener('ChangePrimaryPlayer', (msg) => {
      state.playerId = msg.charID;
      state.playerName = msg.charName;
      anticipator.reset();
    });

    window.addOverlayListener('EnmityTargetData', (msg) => {
      const t = msg.Target;
      state.targetId = t && t.ID ? t.ID : null;
      if (!state.targetId) state.lastPoll = null;
    });

    window.addOverlayListener('LogLine', (msg) => {
      const f = msg.line;
      if (!f) return;
      if (f[0] === '21' || f[0] === '22') onAbilityLine(f);
      else if (f[0] === '26' || f[0] === '30') onStatusLine(f);
    });

    window.addOverlayListener('ChangeZone', () => {
      resetStats();
      state.targetId = null;
      state.lastPoll = null;
      anticipator.reset();
    });

    // OverlayPlugin lock state (embedded mode): show chrome while unlocked.
    document.addEventListener('onOverlayStateUpdate', (e) => {
      document.body.classList.toggle('unlocked', !e.detail.isLocked);
    });

    window.startOverlayEvents();

    setInterval(pollPositions, 100);
    setInterval(renderRadar, 100);
  }

  main();
})();
