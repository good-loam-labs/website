import { startWaves } from './waves.js';
import { celebrate } from './celebrate.js';

const water = startWaves(document.getElementById('waves'));

const ENDPOINT = import.meta.env.VITE_FORM_ENDPOINT;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const form = document.getElementById('demo-form');
const input = document.getElementById('email');
const button = form.querySelector('button');
const status = document.getElementById('form-status');
const thanks = document.getElementById('thanks');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const THANKS = 'thank you — we’ll be in touch';

// Pressing the email field splashes the water under the pointer; keyboard
// focus (Tab) splashes from the field's centre instead.
let pointerFocus = false;
input.addEventListener('pointerdown', (e) => {
  pointerFocus = true;
  water.splash(e.clientX, e.clientY);
});
input.addEventListener('focus', () => {
  if (!pointerFocus) {
    const r = input.getBoundingClientRect();
    water.splash(r.left + r.width / 2, r.top + r.height / 2);
  }
  pointerFocus = false;
});

function setStatus(text, isError = false, pending = false) {
  status.textContent = text;
  status.classList.toggle('error', isError);
  status.classList.toggle('pending', pending);
}

// Lock the form while the request is in flight
function setSending(on) {
  button.disabled = on;
  input.readOnly = on;
  form.classList.toggle('sending', on);
}

async function sendEmail(email) {
  // Local preview without a form service: fake the round trip.
  // Add ?fail to the URL to preview the error path.
  if (!ENDPOINT) {
    await new Promise((r) => setTimeout(r, 900));
    if (new URLSearchParams(location.search).has('fail')) throw new Error('simulated failure');
    return;
  }
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, source: 'goodloamlabs-demo-request' }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = input.value.trim();

  if (!EMAIL_RE.test(email)) {
    setStatus('please enter a valid email', true);
    input.focus();
    return;
  }
  // Honeypot filled → silently pretend success
  if (form.elements._gotcha.value) {
    celebrate({ form, input, thanks, water, text: THANKS, reduceMotion: true });
    return;
  }
  if (!ENDPOINT && !import.meta.env.DEV) {
    setStatus('form endpoint is not configured', true);
    console.error('Set VITE_FORM_ENDPOINT at build time (see README).');
    return;
  }

  setSending(true);
  setStatus('sending…', false, true);

  try {
    await sendEmail(email);
  } catch (err) {
    console.error(err);
    setSending(false);
    setStatus('something went wrong, please try again', true);
    const r = input.getBoundingClientRect();
    water.splash(r.left + r.width / 2, r.bottom, 1.5, 3);
    return;
  }

  setStatus('');
  await celebrate({ form, input, thanks, water, text: THANKS, reduceMotion });
  form.reset();
});
