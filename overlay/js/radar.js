/* Cupidity radar — target-relative positional display on a <canvas>.
 *
 * The target sits at the center facing up. Quadrant wedges show front /
 * flanks / rear, the dashed ring is max melee range, and the dot is you.
 */
'use strict';
(function (root) {
  const COLORS = {
    front: 'rgba(140, 140, 150, 0.28)',
    flank: 'rgba(208, 135, 112, 0.38)',
    rear: 'rgba(180, 142, 220, 0.42)',
    frontActive: 'rgba(190, 190, 200, 0.65)',
    flankActive: 'rgba(240, 160, 120, 0.80)',
    rearActive: 'rgba(205, 160, 255, 0.85)',
    hitboxRing: 'rgba(255, 255, 255, 0.55)',
    meleeRing: 'rgba(120, 220, 160, 0.55)',
    meleeRingOut: 'rgba(240, 100, 100, 0.65)',
    player: '#ffe082',
    playerOut: '#ff8a80',
    facing: 'rgba(255, 255, 255, 0.75)',
    idle: 'rgba(255, 255, 255, 0.25)',
  };

  // Canvas angles, 0 = +x, y-down. Facing is up (-PI/2).
  const QUADRANTS = [
    { name: 'front', from: (-3 * Math.PI) / 4, to: -Math.PI / 4 },
    { name: 'flank', from: -Math.PI / 4, to: Math.PI / 4 }, // target's right
    { name: 'rear', from: Math.PI / 4, to: (3 * Math.PI) / 4 },
    { name: 'flank', from: (3 * Math.PI) / 4, to: (5 * Math.PI) / 4 }, // target's left
  ];

  class Radar {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
    }

    /* state: { hasTarget, rel, dist, hitbox, meleeReach, sector, mirror } */
    draw(state) {
      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      ctx.clearRect(0, 0, w, h);

      if (!state || !state.hasTarget) {
        ctx.beginPath();
        ctx.arc(cx, cy, w * 0.35, 0, 2 * Math.PI);
        ctx.strokeStyle = COLORS.idle;
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.setLineDash([]);
        return;
      }

      const hitbox = state.hitbox;
      const meleeRange = hitbox + state.meleeReach;
      const worldRadius = meleeRange + 3; // yalms shown edge-to-edge
      const pxPerYalm = (Math.min(w, h) / 2 - 6) / worldRadius;
      const hitboxPx = hitbox * pxPerYalm;
      const meleePx = meleeRange * pxPerYalm;

      // Quadrant wedges inside the hitbox ring.
      for (const q of QUADRANTS) {
        const active = state.sector === q.name;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, hitboxPx, q.from, q.to);
        ctx.closePath();
        ctx.fillStyle = COLORS[q.name + (active ? 'Active' : '')];
        ctx.fill();
      }

      // Hitbox ring.
      ctx.beginPath();
      ctx.arc(cx, cy, hitboxPx, 0, 2 * Math.PI);
      ctx.strokeStyle = COLORS.hitboxRing;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Quadrant boundary spokes.
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + hitboxPx * Math.cos(a), cy + hitboxPx * Math.sin(a));
        ctx.stroke();
      }

      const inMelee = state.dist <= meleeRange;

      // Max-melee ring.
      ctx.beginPath();
      ctx.arc(cx, cy, meleePx, 0, 2 * Math.PI);
      ctx.strokeStyle = inMelee ? COLORS.meleeRing : COLORS.meleeRingOut;
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.setLineDash([]);

      // Facing arrow.
      ctx.beginPath();
      ctx.moveTo(cx, cy - hitboxPx - 2);
      ctx.lineTo(cx - 5, cy - hitboxPx + 8);
      ctx.lineTo(cx + 5, cy - hitboxPx + 8);
      ctx.closePath();
      ctx.fillStyle = COLORS.facing;
      ctx.fill();

      // Player dot. rel > 0 means the target's left, drawn on the left
      // unless mirrored.
      if (state.rel != null) {
        const flip = state.mirror ? 1 : -1;
        const d = Math.min(state.dist, worldRadius) * pxPerYalm;
        const px = cx + flip * Math.sin(state.rel) * d;
        const py = cy - Math.cos(state.rel) * d;
        ctx.beginPath();
        ctx.arc(px, py, 4.5, 0, 2 * Math.PI);
        ctx.fillStyle = inMelee ? COLORS.player : COLORS.playerOut;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  root.CupidityRadar = { Radar, COLORS };
})(window);
