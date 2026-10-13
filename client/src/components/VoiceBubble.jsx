import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icons';
import { formatDuration } from './VoiceRecorderBar';

const BARS = 34;
const RATES = [1, 1.5, 2];
let activeAudio = null; // only one voice message plays at a time

// Stable pseudo-waveform per message (the real audio is only downloaded on play)
function makeBars(seed) {
  let a = (seed * 2654435761) >>> 0;
  return Array.from({ length: BARS }, () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return 0.22 + r * 0.78;
  });
}

export default function VoiceBubble({ message, load }) {
  const [state, setState] = useState('idle'); // idle | loading | playing | paused | error
  const [progress, setProgress] = useState(0);
  const [rate, setRate] = useState(1);
  const audioRef = useRef(null);
  const bars = useMemo(() => makeBars(message.id), [message.id]);
  const totalSec = Math.max(1, message.durationMs / 1000);

  useEffect(
    () => () => {
      const a = audioRef.current;
      if (a) {
        a.pause();
        if (activeAudio === a) activeAudio = null;
      }
    },
    []
  );

  async function toggle() {
    if (state === 'loading') return;
    const existing = audioRef.current;
    if (existing && state === 'playing') return existing.pause();
    try {
      if (!existing) {
        setState('loading');
        const audio = new Audio(await load(message));
        audio.playbackRate = rate;
        audio.ontimeupdate = () => setProgress(Math.min(1, audio.currentTime / totalSec));
        audio.onplay = () => setState('playing');
        audio.onpause = () => setState((s) => (s === 'idle' ? s : 'paused'));
        audio.onended = () => {
          setState('idle');
          setProgress(0);
        };
        audioRef.current = audio;
      }
      if (activeAudio && activeAudio !== audioRef.current) activeAudio.pause();
      activeAudio = audioRef.current;
      await audioRef.current.play();
    } catch {
      audioRef.current = null;
      setState('error');
    }
  }

  function cycleRate() {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }

  const playing = state === 'playing';
  const shown = playing || state === 'paused' ? progress * message.durationMs : message.durationMs;

  return (
    <div className="voice">
      <button
        type="button"
        className="voice-btn"
        onClick={toggle}
        aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        disabled={state === 'loading'}
      >
        {state === 'loading' ? <span className="spinner" /> : <Icon name={playing ? 'pause' : 'play'} size={18} />}
      </button>
      <div className="wave" aria-hidden="true">
        {bars.map((h, i) => (
          <i key={i} className={i / BARS < progress ? 'on' : ''} style={{ height: `${Math.round(h * 100)}%` }} />
        ))}
      </div>
      <div className="voice-meta">
        <span>{state === 'error' ? 'Can’t play' : formatDuration(shown)}</span>
        {(playing || state === 'paused') && (
          <button type="button" className="rate" onClick={cycleRate} aria-label={`Playback speed ${rate}x`}>
            {rate}x
          </button>
        )}
      </div>
    </div>
  );
}
