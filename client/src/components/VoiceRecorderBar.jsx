import { useEffect, useRef, useState } from 'react';
import Icon from './Icons';

export const MAX_VOICE_MS = 90_000;
const BAR_COUNT = 30;

const pickMime = () =>
  ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((t) =>
    window.MediaRecorder?.isTypeSupported?.(t)
  );

export const formatDuration = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Mounting this component starts recording; unmounting always releases the microphone.
export default function VoiceRecorderBar({ onSend, onCancel, onError }) {
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState(() => Array(BAR_COUNT).fill(0.08));
  const controls = useRef({ finish: () => {} });
  const cb = useRef({});
  cb.current = { onSend, onCancel, onError }; // always call the latest handlers

  useEffect(() => {
    let disposed = false;
    let mode = 'cancel'; // what to do when the recorder stops: 'send' | 'cancel'
    let stream, recorder, audioCtx, raf, timer;
    const chunks = [];
    const startedAt = Date.now();

    const release = () => {
      cancelAnimationFrame(raf);
      clearInterval(timer);
      stream?.getTracks().forEach((t) => t.stop());
      audioCtx?.close().catch(() => {});
    };

    controls.current.finish = (nextMode) => {
      mode = nextMode;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      else {
        release();
        cb.current.onCancel();
      }
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (disposed) return release();

        const mimeType = pickMime();
        recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 });
        recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
        recorder.onstop = () => {
          const duration = Date.now() - startedAt;
          release();
          if (disposed) return;
          if (mode !== 'send') return cb.current.onCancel();
          if (duration < 700 || !chunks.length) {
            cb.current.onError('That recording was too short. Tap the mic, then speak.');
            return cb.current.onCancel();
          }
          cb.current.onSend(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }), Math.min(duration, MAX_VOICE_MS));
        };
        recorder.start(250);

        // Live level meter
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        audioCtx.createMediaStreamSource(stream).connect(analyser);
        const samples = new Uint8Array(analyser.fftSize);
        let last = 0;
        const tick = (now) => {
          if (now - last > 80) {
            last = now;
            analyser.getByteTimeDomainData(samples);
            let sum = 0;
            for (const v of samples) sum += ((v - 128) / 128) ** 2;
            const level = Math.min(1, Math.sqrt(sum / samples.length) * 4);
            setLevels((l) => [...l.slice(1), Math.max(0.08, level)]);
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        timer = setInterval(() => {
          const ms = Date.now() - startedAt;
          setElapsed(ms);
          if (ms >= MAX_VOICE_MS) controls.current.finish('send'); // auto-send at the limit
        }, 200);
      } catch (err) {
        if (disposed) return;
        cb.current.onError(
          err?.name === 'NotAllowedError'
            ? 'Microphone access is blocked. Allow it from the lock icon in your address bar, then try again.'
            : err?.name === 'NotFoundError'
              ? 'No microphone was found on this device.'
              : 'Could not start recording.'
        );
        cb.current.onCancel();
      }
    })();

    return () => {
      disposed = true;
      mode = 'cancel';
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      release();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="composer recorder" role="group" aria-label="Recording voice message">
      <button type="button" className="icon-btn danger" onClick={() => controls.current.finish('cancel')} aria-label="Discard recording">
        <Icon name="trash" />
      </button>
      <span className="rec-dot" aria-hidden="true" />
      <span className="rec-time">{formatDuration(elapsed)}</span>
      <div className="live-wave" aria-hidden="true">
        {levels.map((l, i) => (
          <i key={i} style={{ height: `${Math.round(l * 100)}%` }} />
        ))}
      </div>
      <button type="button" className="send-btn" onClick={() => controls.current.finish('send')} aria-label="Send voice message">
        <Icon name="send" size={20} />
      </button>
    </div>
  );
}
