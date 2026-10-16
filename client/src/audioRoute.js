// Speaker on / off for calls.
//
// The two modes must sound clearly different, like on a normal phone call:
//   SPEAKER ON   loud and full: the voice is boosted (with a limiter so it never distorts)
//   SPEAKER OFF  "held to the ear": much quieter and narrower, like a phone earpiece
//
// How it works (Web Audio): the other person's voice goes  source -> filters -> gain -> limiter -> output.
// That works the same on Android, iPhone and laptops (changing <audio>.volume does NOT work on iPhones, and on
// Android it barely changes anything, which is why the old speaker button seemed to do nothing).
//
// If a phone's browser exposes a real "earpiece" and "speaker" output (Chrome on some Android phones) we switch the
// real output instead. If the browser can't do either, we fall back to plain volume.

const SPEAKER = { gain: 1.5, highpass: 20, lowpass: 20000 }; // loud, full range
const EARPIECE = { gain: 0.15, highpass: 320, lowpass: 3400 }; // 20 dB quieter, thin "phone" sound
const FALLBACK_QUIET_VOLUME = 0.15;

let ctx = null;
const graphs = new Map(); // <audio>/<video> element -> its Web Audio chain
const wanted = new Map(); // element -> the mode (on/off) we were last asked for

// Create/resume the audio engine INSIDE a tap (Call / Accept). Phones only allow sound that starts from a tap.
export function primeAudio() {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      ctx.addEventListener('statechange', onContextState);
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {});
  } catch {
    ctx = null;
  }
}

// If the phone pauses our audio engine (incoming phone call, lock screen), play the plain element instead
function onContextState() {
  for (const g of graphs.values()) g.el.muted = ctx.state === 'running';
  // The engine just finished waking up: apply the mode that was asked for while it was still starting
  if (ctx.state === 'running') wanted.forEach((on, el) => setSpeaker(el, on));
}

function teardown(el) {
  const g = graphs.get(el);
  if (!g) return;
  try {
    g.source.disconnect();
    g.highpass.disconnect();
    g.lowpass.disconnect();
    g.gain.disconnect();
    g.limiter.disconnect();
  } catch {
    /* already disconnected */
  }
  graphs.delete(el);
  el.muted = false;
}

function build(el) {
  const stream = el.srcObject;
  if (!ctx || ctx.state !== 'running' || !stream || !stream.getAudioTracks().length) return null;
  const existing = graphs.get(el);
  if (existing && existing.stream === stream) return existing;
  teardown(el);

  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  const lowpass = ctx.createBiquadFilter();
  lowpass.type = 'lowpass';
  const gain = ctx.createGain();
  const limiter = ctx.createDynamicsCompressor(); // stops the boosted voice from clipping
  limiter.threshold.value = -2; // only catches the very loudest peaks, so ON stays clearly louder than OFF
  limiter.knee.value = 2;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.1;

  const source = ctx.createMediaStreamSource(stream);
  source.connect(highpass).connect(lowpass).connect(gain).connect(limiter).connect(ctx.destination);
  const g = { el, stream, source, highpass, lowpass, gain, limiter };
  graphs.set(el, g);
  el.muted = true; // the element stays attached (needed by Chrome) but the sound now comes from the chain above
  return g;
}

// A real earpiece + loudspeaker pair (phones that expose them): switch the actual output
async function findPhoneOutputs() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outs = devices.filter((d) => d.kind === 'audiooutput');
    const earpiece = outs.find((d) => /ear\s?piece|receiver/i.test(d.label));
    const speaker = outs.find((d) => /speaker/i.test(d.label) && !/head|ear|bluetooth/i.test(d.label));
    return earpiece && speaker ? { earpiece, speaker } : null;
  } catch {
    return null;
  }
}

// Returns 'routed' (real output switched), 'webaudio' (boost/quiet chain) or 'volume' (plain fallback)
export async function setSpeaker(el, on) {
  if (!el) return 'volume';
  wanted.set(el, on);

  if ('setSinkId' in el) {
    const phone = await findPhoneOutputs();
    if (phone) {
      try {
        teardown(el);
        await el.setSinkId((on ? phone.speaker : phone.earpiece).deviceId);
        el.volume = 1;
        return 'routed';
      } catch {
        /* fall through to the other options */
      }
    }
  }

  const g = build(el);
  if (g) {
    const p = on ? SPEAKER : EARPIECE;
    const t = ctx.currentTime;
    g.gain.gain.setTargetAtTime(p.gain, t, 0.04); // short fade so the switch has no click
    g.highpass.frequency.setTargetAtTime(p.highpass, t, 0.04);
    g.lowpass.frequency.setTargetAtTime(p.lowpass, t, 0.04);
    return 'webaudio';
  }

  el.volume = on ? 1 : FALLBACK_QUIET_VOLUME;
  return 'volume';
}

// Call finished: disconnect everything
export function releaseSpeaker() {
  for (const el of [...graphs.keys()]) teardown(el);
  wanted.clear();
}

// For tests: look at the chain of an element
export const _graphFor = (el) => graphs.get(el) || null;
export const _context = () => ctx;
