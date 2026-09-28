// Success animation: the typed email breaks into monospace characters that
// arc down onto the ocean (each one splashing where it lands), the form sinks
// after them with one big splash, and the thank-you surfaces in its place.

const GRAVITY = 1800;   // px/s^2
const STAGGER = 28;     // ms between characters leaving the field
const MAX_STAGGER = 320;
const SINK_MS = 220;    // how long a landed character takes to go under
const MONO = '"Courier New", Consolas, monospace'; // same face as the ocean

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Screen position of each visible character's centre inside a text input
function charPositions(input) {
  const cs = getComputedStyle(input);
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = cs.font;
  const r = input.getBoundingClientRect();
  const left = r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) - input.scrollLeft;
  const y = r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop)
    + (input.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / 2;
  const text = input.value;
  const out = [];
  for (let i = 0; i < text.length; i++) {
    const x0 = left + ctx.measureText(text.slice(0, i)).width;
    const x = x0 + ctx.measureText(text[i]).width / 2;
    if (x < r.left || x > r.right) continue; // scrolled out of view
    out.push({ ch: text[i], x, y, font: cs.font });
  }
  return out;
}

// Throw the characters; resolves once the last one has gone under
function throwChars(input, water, floor) {
  const chars = charPositions(input);
  if (!chars.length) return Promise.resolve();

  const layer = document.createElement('div');
  layer.className = 'bottle';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);

  const n = chars.length;
  const stagger = Math.min(STAGGER, MAX_STAGGER / n);
  const r = input.closest('form').getBoundingClientRect();
  const cx = r.left + r.width / 2;
  // Letters scatter across a band of water below the form, far enough apart
  // that each splash reads as its own ring
  const band = Math.min(innerWidth - 32, Math.max(260, n * 26), 560);

  const bits = chars.map((c, i) => {
    const el = document.createElement('span');
    el.textContent = c.ch;
    el.style.font = c.font;
    el.style.left = `${c.x}px`;
    el.style.top = `${c.y}px`;
    layer.appendChild(el);
    const u = n > 1 ? i / (n - 1) : 0.5;
    const landX = cx + (u - 0.5) * band + (Math.random() - 0.5) * 14;
    const landY = floor + Math.random() * 150;
    const vy = -(260 + Math.random() * 120);
    // Solve the arc so the letter lands exactly on its spot
    const t = (-vy + Math.sqrt(vy * vy + 2 * GRAVITY * (landY - c.y))) / GRAVITY;
    return {
      el,
      ox: c.x, oy: c.y,
      x: c.x, y: c.y,
      vx: (landX - c.x) / t,
      vy,
      spin: (Math.random() - 0.5) * 540,
      rot: 0,
      start: i * stagger,
      landY,
      state: 'wait', // wait → fly → sink → done
      t: 0,
    };
  });
  input.classList.add('emptied');

  return new Promise((resolve) => {
    let t0 = 0;
    let prev = 0;
    function frame(now) {
      if (!t0) t0 = prev = now;
      const el = now - t0;
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      let alive = 0;

      for (const b of bits) {
        if (b.state === 'done') continue;
        alive++;
        if (b.state === 'wait') {
          if (el < b.start) continue;
          b.state = 'fly';
          b.el.classList.add('mono');
          b.el.style.fontFamily = MONO;
        }
        if (b.state === 'fly') {
          b.vy += GRAVITY * dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          b.rot += b.spin * dt;
          // Shrinks a touch as it falls away toward the water
          const fall = Math.max(0, b.y - b.oy) / (b.landY - b.oy);
          const s = 1.1 - 0.3 * fall;
          b.el.style.transform = `translate(-50%, -50%) translate(${b.x - b.ox}px, ${b.y - b.oy}px) rotate(${b.rot}deg) scale(${s})`;
          if (b.vy > 0 && b.y >= b.landY) {
            b.y = b.landY;
            b.state = 'sink';
            b.t = now;
            water.splash(b.x, b.y, 0.7, 2);
          }
        } else if (b.state === 'sink') {
          const k = Math.min(1, (now - b.t) / SINK_MS);
          const dx = b.x - b.ox;
          const dy = b.y - b.oy + k * 6;
          b.el.style.transform = `translate(-50%, -50%) translate(${dx}px, ${dy}px) rotate(${b.rot * (1 - k * 0.5)}deg) scale(${0.8 * (1 - k * 0.3)}, ${0.8 * (1 - k)})`;
          b.el.style.opacity = String(1 - k);
          if (k >= 1) b.state = 'done';
        }
      }

      if (alive) requestAnimationFrame(frame);
      else {
        layer.remove();
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

// Swap the form for the thank-you line, animated or not
function reveal(form, thanks, text, animate) {
  form.classList.add('gone');
  thanks.textContent = text;
  thanks.classList.add(animate ? 'rising' : 'shown');
}

export async function celebrate({ form, input, thanks, water, text, reduceMotion }) {
  form.inert = true;
  form.setAttribute('aria-hidden', 'true');
  if (reduceMotion) {
    reveal(form, thanks, text, false);
    return;
  }
  const r = form.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  // Characters land a little below the form, spread in depth
  const floor = Math.min(r.bottom + 50, innerHeight - 170);

  const thrown = throwChars(input, water, floor);
  water.calm(0.12, 900);
  // The form follows its letters down as they start to land, then hits the
  // water with one big splash: rings and spray from its centre, while the
  // stilled swell lets them read across the screen
  await wait(420);
  form.classList.add('sink');
  await wait(450);
  water.unveil(0.35, 300);
  water.spray(cx, cy, 36);
  [[2.4, 6], [1.7, 5], [1.2, 4], [0.9, 4]].forEach(([strength, radius], i) => {
    setTimeout(() => water.splash(cx, cy, strength, radius), i * 170);
  });
  await wait(620);
  reveal(form, thanks, text, true);
  await wait(450);
  water.unveil(1, 1200);
  water.calm(1, 1400);
  await thrown;
}
