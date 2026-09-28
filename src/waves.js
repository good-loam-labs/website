// ASCII ocean: a perspective view of swell rolling toward the viewer, plus
// interactive ripples wherever the background is pressed.
//
// Everything lives on one world-space water plane (x across, z away from the
// viewer) seen through a pinhole camera. Ripples are simulated on a top-down
// grid over that plane, so they spread as true circles on the water — squashed
// into ellipses and slowed down with distance on screen — and they are summed
// with the swell into a single height field that is lit as one surface. The
// swell also carries ripples back and forth with its orbital motion.

const CHAR_W = 10;
const CHAR_H = 16;
const BG = '#111';

// Characters from calm/dark to crest/bright; index 0 = empty cell
const RAMP = [' ', '.', '.', ':', '-', '~', '=', '+', '*', '*', '#', '#'];
const LEVELS = RAMP.length;
const ALPHAS = RAMP.map((_, i) => (i === 0 ? 0 : 0.1 + (i / (LEVELS - 1)) * 0.65));

// Camera: screen row y (0..1) sees depth z = DEPTH / (y + HORIZON), i.e. the
// horizon sits just above the top of the screen. CAM_H is the camera height
// above the water; it sets how strongly circles are foreshortened.
const DEPTH = 1.6;
const HORIZON = 0.08;
const CAM_H = 1.2;

// Swell components in world space. dir is the travel angle (radians, 0 = toward
// the viewer). Speed follows deep-water dispersion (omega = sqrt(g * k)), so
// long waves outrun short ones like real ocean swell.
const G = 9.8;
const SWELL = [
  { k: 1.3, amp: 0.7,  dir: 0.0,   phase: 0.0 },
  { k: 1.9, amp: 0.35, dir: 0.22,  phase: 1.7 },
  { k: 2.9, amp: 0.16, dir: -0.35, phase: 4.1 },
  { k: 5.2, amp: 0.07, dir: 0.8,   phase: 2.3 },
  { k: 8.5, amp: 0.04, dir: -1.1,  phase: 5.2 },
].map((w) => ({ ...w, dx: Math.sin(w.dir), dz: Math.cos(w.dir), omega: Math.sqrt(G * w.k) * 0.35 }));
const ORBIT = 0.35;          // how far the swell sways the water (and its ripples) sideways

// Ripple simulation on the water plane
const SIM_HZ = 60;
const RIP_DX = 0.03;         // grid spacing in world units
const RIP_ZMAX = 10;         // ripples farther than this are too small to see
const RIPPLE_C2 = 0.19;      // (wave speed)^2 in cells/step — lower is slower, heavier water
const DAMPING = 0.996;
const SPONGE = 20;           // cells at the grid edge that absorb rings (open sea, no walls)
const RADIUS_SCALE = 0.018;  // splash radius units -> world units
const RIPPLE_GAIN = 0.5;     // how much ripples lift the surface

// Lighting of the combined surface (slopes are physical, in world units)
const FACING = 0.25;         // faces tilted toward the viewer catch sky light
const GLINT = 0.006;         // steep facets (ripple walls, sharp crests) sparkle ~ slope^2

export function startWaves(canvas) {
  const ctx = canvas.getContext('2d');
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let W, H, cols, rows, focal;
  let worldX, worldZ, fade; // per-cell / per-row precomputed geometry
  let height;               // per-cell surface height, rebuilt each frame
  let lightBuf;             // per-cell brightness, rebuilt each frame
  let gw, gh, gx0, gz0;     // ripple grid size and world origin
  let rippleA, rippleB;     // current / previous ripple buffers
  let damp;                 // per-cell damping (sponge near the grid edges)
  let buckets;              // per-level lists of cell indices, reused each frame
  let swell = 1;            // ambient swell strength, eased toward swellTarget
  let swellTarget = 1;
  let swellRate = 0;        // per-ms easing step
  let now = 0;              // swell time in seconds, for mapping splashes
  let centre;               // per-cell distance from screen centre (elliptical, 1 = edge of the clear zone)
  let veil = 1;             // how strongly water is dimmed behind the text, eased toward veilTarget
  let veilTarget = 1;
  let veilRate = 0;
  const drops = [];         // flying droplet particles { x, y, vx, vy, landY, ch }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    cols = Math.ceil(W / CHAR_W) + 1;
    rows = Math.ceil(H / CHAR_H) + 1;
    const n = cols * rows;
    // Pinhole focal length (px) consistent with the depth mapping and camera height
    focal = (DEPTH * H) / CAM_H;

    worldX = new Float32Array(n);
    centre = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const c = i % cols;
      const r = (i - c) / cols;
      centre[i] = Math.hypot(((c + 0.5) * CHAR_W - W / 2) / (0.7 * W), ((r + 0.5) * CHAR_H - H / 2) / (0.7 * H));
    }
    worldZ = new Float32Array(rows);
    fade = new Float32Array(rows);
    for (let r = 0; r < rows; r++) {
      const yn = (r * CHAR_H) / H;
      const z = DEPTH / (yn + HORIZON);
      worldZ[r] = z;
      fade[r] = 0.22 + 0.78 * Math.pow(Math.min(1, yn), 0.8);
      for (let c = 0; c < cols; c++) {
        worldX[r * cols + c] = ((c + 0.5) * CHAR_W - W / 2) * z / focal;
      }
    }

    // Ripple grid covers the visible water out to RIP_ZMAX, plus a sponge margin
    const margin = (SPONGE + 2) * RIP_DX;
    const xHalf = (W / 2) * RIP_ZMAX / focal + margin;
    gz0 = worldZ[rows - 1] - margin;
    gx0 = -xHalf;
    gw = Math.ceil((2 * xHalf) / RIP_DX) + 1;
    gh = Math.ceil((RIP_ZMAX + margin - gz0) / RIP_DX) + 1;
    rippleA = new Float32Array(gw * gh);
    rippleB = new Float32Array(gw * gh);
    damp = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const edge = Math.min(i, j, gw - 1 - i, gh - 1 - j);
        const s = Math.min(1, edge / SPONGE);
        damp[j * gw + i] = DAMPING * (0.86 + 0.14 * s * s);
      }
    }

    height = new Float32Array(n);
    lightBuf = new Float32Array(n);
    buckets = Array.from({ length: LEVELS }, () => []);
    if (reduceMotion) render(0);
  }

  function smooth(x) { return x * x * (3 - 2 * x); }

  // Sideways sway of the water at a world point from the swell's orbital motion
  function orbit(x, z, t) {
    let ox = 0;
    let oz = 0;
    for (let w = 0; w < SWELL.length; w++) {
      const s = SWELL[w];
      const c = Math.cos(s.k * (s.dx * x + s.dz * z) + s.omega * t + s.phase) * s.amp * ORBIT * swell;
      ox -= s.dx * c;
      oz -= s.dz * c;
    }
    return [ox, oz];
  }

  // Push the water down in a small disc around the point seen at a screen position
  function disturb(px, py, strength, radius) {
    const z = DEPTH / (Math.max(0, py) / H + HORIZON);
    if (z > RIP_ZMAX) return;
    const x = (px - W / 2) * z / focal;
    // The screen shows water that the swell has swayed here; splash that water
    const [ox, oz] = orbit(x, z, now);
    const cx = (x + ox - gx0) / RIP_DX;
    const cz = (z + oz - gz0) / RIP_DX;
    // At least a few cells wide, or the grid rings with its own numerical noise
    const R = Math.max(2.6, (radius * RADIUS_SCALE) / RIP_DX);
    const i0 = Math.max(1, Math.floor(cx - R));
    const i1 = Math.min(gw - 2, Math.ceil(cx + R));
    const j0 = Math.max(1, Math.floor(cz - R));
    const j1 = Math.min(gh - 2, Math.ceil(cz + R));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const d = Math.hypot(i - cx, j - cz) / R;
        if (d < 1) rippleA[j * gw + i] -= strength * (0.5 + 0.5 * Math.cos(d * Math.PI));
      }
    }
  }

  function stepRipples() {
    // Two-buffer wave equation, next = 2*cur - prev + c^2 * laplacian(cur),
    // with the isotropic 9-point laplacian so rings stay round on the square grid
    for (let j = 1; j < gh - 1; j++) {
      const row = j * gw;
      for (let i = 1; i < gw - 1; i++) {
        const k = row + i;
        const a = rippleA[k];
        const edges = rippleA[k - 1] + rippleA[k + 1] + rippleA[k - gw] + rippleA[k + gw];
        const corners = rippleA[k - gw - 1] + rippleA[k - gw + 1] + rippleA[k + gw - 1] + rippleA[k + gw + 1];
        const lap = (4 * edges + corners - 20 * a) / 6;
        rippleB[k] = (2 * a - rippleB[k] + RIPPLE_C2 * lap) * damp[k];
      }
    }
    const tmp = rippleA;
    rippleA = rippleB;
    rippleB = tmp;
  }

  // Build the combined swell + ripple surface and light it from its slope
  function computeSurface(t) {
    const inv = 1 / RIP_DX;
    // The clear zone behind the text slowly breathes in and out
    const breathe = reduceMotion ? 1 : 1 + 0.06 * Math.sin((t * Math.PI) / 4);
    for (let r = 0; r < rows; r++) {
      const z = worldZ[r];
      const row = r * cols;
      const f = fade[r];
      for (let c = 0; c < cols; c++) {
        const i = row + c;
        const x = worldX[i];
        let h = 0;
        let hx = 0;
        let hz = 0;
        let ox = 0;
        let oz = 0;
        for (let w = 0; w < SWELL.length; w++) {
          const s = SWELL[w];
          // Waves travel toward the viewer (increasing screen y = decreasing z)
          const p = s.k * (s.dx * x + s.dz * z) + s.omega * t + s.phase;
          const sn = Math.sin(p);
          const cs = Math.cos(p);
          // Sharp crests, broad troughs — a cheap trochoidal profile
          const v = (sn + 1) * 0.5;
          const v2 = v * v;
          h += s.amp * (v2 * v2 * 2.4 - 0.5);
          const dh = s.amp * 4.8 * v2 * v * cs * s.k;
          hx += dh * s.dx;
          hz += dh * s.dz;
          const o = cs * s.amp * ORBIT;
          ox -= s.dx * o;
          oz -= s.dz * o;
        }
        h *= swell;
        hx *= swell;
        hz *= swell;

        // Sample the ripple grid (bilinear) where the swell has carried the water
        const fx = (x + ox * swell - gx0) * inv;
        const fz = (z + oz * swell - gz0) * inv;
        const ix = fx | 0;
        const iz = fz | 0;
        if (ix >= 0 && iz >= 0 && ix < gw - 1 && iz < gh - 1) {
          const tx = fx - ix;
          const tz = fz - iz;
          const k = iz * gw + ix;
          const a = rippleA[k];
          const b = rippleA[k + 1];
          const d = rippleA[k + gw];
          const e = rippleA[k + gw + 1];
          const near = a + (b - a) * tx;
          const far = d + (e - d) * tx;
          h += (near + (far - near) * tz) * RIPPLE_GAIN;
          hx += ((b - a) + ((e - d) - (b - a)) * tz) * inv * RIPPLE_GAIN;
          hz += (far - near) * inv * RIPPLE_GAIN;
        }
        height[i] = h;

        // One lighting model for the whole surface: faces turned toward the
        // viewer catch the sky, and steep facets (ripple walls, sharp crests) glint
        const light = Math.min(1, Math.max(0, 0.18 + h * 0.6 - hz * FACING));
        const glint = (hx * hx + hz * hz) * GLINT;
        // Dim the water behind the text. Done per character rather than with a
        // CSS gradient, which bands visibly on a dark background.
        const d = centre[i] / breathe;
        const dim = d < 0.35 ? 0.9 - d : d < 0.65 ? 0.55 * (1 - smooth((d - 0.35) / 0.3)) : 0;
        lightBuf[i] = (light * light * f + glint * Math.max(f, 0.6)) * (1 - dim * veil);
      }
    }
  }

  function render(time) {
    const t = time * 0.001;
    now = t;
    computeSurface(t);

    for (const b of buckets) b.length = 0;
    for (let i = cols; i < lightBuf.length; i++) {
      const level = Math.round(Math.min(1, lightBuf[i]) * (LEVELS - 1));
      if (level > 0) buckets[level].push(i);
    }

    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);
    ctx.font = `${CHAR_H - 2}px "Courier New", Consolas, monospace`;
    ctx.textBaseline = 'top';

    for (let l = 1; l < LEVELS; l++) {
      const list = buckets[l];
      if (!list.length) continue;
      ctx.fillStyle = `rgba(210, 215, 220, ${ALPHAS[l]})`;
      const ch = RAMP[l];
      for (let j = 0; j < list.length; j++) {
        const i = list[j];
        const c = i % cols;
        const r = (i - c) / cols;
        // Bob characters with the surface so rows undulate like liquid
        ctx.fillText(ch, c * CHAR_W, r * CHAR_H - height[i] * 4);
      }
    }

    if (drops.length) ctx.font = `bold ${CHAR_H}px "Courier New", Consolas, monospace`;
    for (const d of drops) {
      ctx.fillStyle = `rgba(232, 236, 240, ${Math.min(0.9, d.life)})`;
      ctx.fillText(d.ch, d.x, d.y);
    }
  }

  // Droplets arc under gravity and patter back into the water where they land
  function stepDrops(dt) {
    for (let j = drops.length - 1; j >= 0; j--) {
      const d = drops[j];
      d.vy += 0.0016 * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.life = Math.min(1, d.life + dt * 0.006);
      if (d.vy > 0 && d.y > d.landY) {
        disturb(d.x, d.y, 0.8, 2);
        drops.splice(j, 1);
      }
    }
  }

  function ease(v, target, step) {
    return Math.abs(target - v) <= step ? target : v + Math.sign(target - v) * step;
  }

  // Fixed-rate ripple simulation so it behaves the same at 60 Hz and 120 Hz
  let last = 0;
  let acc = 0;
  function frame(time) {
    const dt = Math.min(100, time - (last || time));
    acc += dt;
    last = time;
    swell = ease(swell, swellTarget, swellRate * dt);
    veil = ease(veil, veilTarget, veilRate * dt);
    while (acc >= 1000 / SIM_HZ) {
      stepRipples();
      stepDrops(1000 / SIM_HZ);
      acc -= 1000 / SIM_HZ;
    }
    render(time);
    requestAnimationFrame(frame);
  }

  // Interaction: press drops a stone, dragging trails a finger through water
  let dragging = false;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    disturb(e.clientX, e.clientY, 3, 5);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) disturb(e.clientX, e.clientY, 0.4, 3);
  });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointercancel', () => { dragging = false; });

  window.addEventListener('resize', resize);
  resize();
  if (!reduceMotion) requestAnimationFrame(frame);

  // Let other UI drop a stone into the water at a screen point
  return {
    splash(x, y, strength = 3, radius = 5) { disturb(x, y, strength, radius); },
    // Throw a spray of ASCII droplets up from a point; they fall back as ripples
    spray(x, y, count = 24) {
      for (let j = 0; j < count; j++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 2;
        const v = 0.45 + Math.random() * 0.5;
        drops.push({
          x, y,
          vx: Math.cos(a) * v * 0.9,
          vy: Math.sin(a) * v,
          landY: y + (Math.random() - 0.3) * 60,
          life: 0.3,
          ch: "'.,`*o"[Math.floor(Math.random() * 6)],
        });
      }
    },
    // Ease the ambient swell toward a strength (0 = glassy, 1 = normal) over ms
    calm(target, ms = 400) {
      swellTarget = target;
      swellRate = Math.abs(target - swell) / Math.max(1, ms);
    },
    // Ease how much the water is dimmed behind the text (1 = normal, 0 = none)
    unveil(target, ms = 400) {
      veilTarget = target;
      veilRate = Math.abs(target - veil) / Math.max(1, ms);
    },
  };
}
