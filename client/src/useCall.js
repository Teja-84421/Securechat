import { useCallback, useEffect, useRef, useState } from 'react';
import { primeAudio } from './audioRoute';

// Audio / video calls with WebRTC.
//
// - Signalling (who calls whom, SDP offer/answer, ICE candidates) goes through our Socket.IO server.
// - The call itself (audio/video) flows DIRECTLY between the two browsers, encrypted with DTLS-SRTP,
//   so the server never sees or carries the media.
// - STUN (a public Google server) lets each browser discover its public address (NAT traversal).
//   Strict networks may also need a TURN relay: set VITE_TURN_URL / _USERNAME / _CREDENTIAL (see README).

function buildIceServers() {
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const turn = import.meta.env.VITE_TURN_URL;
  if (turn) {
    servers.push({
      urls: turn.split(',').map((u) => u.trim()).filter(Boolean),
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_CREDENTIAL,
    });
  }
  return servers;
}
const ICE_SERVERS = buildIceServers();

const newCallId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

const getMedia = (kind) =>
  navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
  });

function mediaError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Allow microphone and camera access in your browser to make calls.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone or camera was found.';
    case 'NotReadableError':
      return 'Your microphone or camera is being used by another app.';
    default:
      return 'Could not start the call.';
  }
}

// Ringtone / ringback made with the Web Audio API (no audio files needed)
function createTone() {
  let ctx = null;
  let timer = null;
  const beep = (freq, start, dur, vol) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(vol, start + 0.02);
    gain.gain.linearRampToValueAtTime(0, start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  };
  const stop = () => {
    clearInterval(timer);
    timer = null;
    navigator.vibrate?.(0);
    if (ctx) {
      ctx.close().catch(() => {});
      ctx = null;
    }
  };
  const start = (kind) => {
    stop();
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume?.();
    } catch {
      return;
    }
    const play = () => {
      if (!ctx) return;
      const t = ctx.currentTime;
      if (kind === 'incoming') {
        navigator.vibrate?.([300, 150, 300]); // buzz in time with the ring (phones)
        beep(880, t, 0.18, 0.12);
        beep(660, t + 0.22, 0.18, 0.12);
        beep(880, t + 0.6, 0.18, 0.12);
        beep(660, t + 0.82, 0.18, 0.12);
      } else {
        beep(425, t, 1.0, 0.05);
      }
    };
    play();
    timer = setInterval(play, kind === 'incoming' ? 2400 : 3000);
  };
  return { start, stop };
}

export function useCall({ socketRef, connected, onNotice }) {
  // call: null | { callId, peer: {id, username}, kind, direction: 'in'|'out', phase: 'ringing'|'connecting'|'active',
  //                startedAt, muted, cameraOff, speaker, unstable }
  const [call, setCall] = useState(null);
  const [localStream, setLocalStream] = useState(null);
  const [remoteStream, setRemoteStream] = useState(null);

  const callRef = useRef(null); // always the latest call (used inside socket / WebRTC callbacks)
  const pcRef = useRef(null);
  const localRef = useRef(null);
  const queued = useRef([]); // ICE candidates that arrived before the remote description
  const toneRef = useRef(null);
  const dropTimer = useRef(null);
  const wakeRef = useRef(null);

  // Keep the phone's screen on during a call (otherwise it locks and the call can drop)
  const holdScreen = async () => {
    try {
      if (!wakeRef.current && navigator.wakeLock) {
        wakeRef.current = await navigator.wakeLock.request('screen');
        wakeRef.current.addEventListener?.('release', () => {
          wakeRef.current = null;
        });
      }
    } catch {
      /* not supported, or the battery saver said no: the call still works */
    }
  };
  const releaseScreen = () => {
    wakeRef.current?.release?.().catch(() => {});
    wakeRef.current = null;
  };
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;

  const tone = () => (toneRef.current ??= createTone());
  const notice = (text) => text && noticeRef.current?.(text);
  const send = useCallback((event, data) => socketRef.current?.emit(event, data, () => {}), [socketRef]);

  const update = useCallback((patch) => {
    const next = patch === null ? null : { ...callRef.current, ...patch };
    callRef.current = next;
    setCall(next);
  }, []);

  // Stop everything: ringtone, peer connection, camera and microphone
  const cleanup = useCallback(() => {
    toneRef.current?.stop();
    releaseScreen();
    clearTimeout(dropTimer.current);
    if (pcRef.current) {
      pcRef.current.onicecandidate = pcRef.current.ontrack = pcRef.current.onconnectionstatechange = null;
      pcRef.current.close();
      pcRef.current = null;
    }
    localRef.current?.getTracks().forEach((t) => t.stop());
    localRef.current = null;
    queued.current = [];
    setLocalStream(null);
    setRemoteStream(null);
    callRef.current = null;
    setCall(null);
  }, []);

  // Finish the call from this side (optionally telling the server and showing a message)
  const end = useCallback(
    (message, tellServer = true) => {
      const cur = callRef.current;
      if (cur && tellServer) send('call:end', { callId: cur.callId });
      cleanup();
      notice(message);
    },
    [cleanup, send]
  );

  const createPeer = useCallback(() => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pcRef.current = pc;
    localRef.current?.getTracks().forEach((t) => pc.addTrack(t, localRef.current));

    pc.onicecandidate = (e) => {
      const cur = callRef.current;
      if (e.candidate && cur) send('call:signal', { callId: cur.callId, data: { type: 'candidate', candidate: e.candidate.toJSON() } });
    };
    pc.ontrack = (e) => setRemoteStream(e.streams[0] || new MediaStream([e.track]));
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        clearTimeout(dropTimer.current);
        tone().stop();
        holdScreen();
        update({ phase: 'active', startedAt: callRef.current?.startedAt || Date.now(), unstable: false });
      } else if (state === 'disconnected') {
        update({ unstable: true });
        clearTimeout(dropTimer.current);
        dropTimer.current = setTimeout(() => end('The connection was lost.'), 10000);
      } else if (state === 'failed') {
        end('The call could not connect. On strict networks a TURN server may be needed.');
      }
    };
    return pc;
  }, [send, update, end]);

  const flushCandidates = async (pc) => {
    const list = queued.current;
    queued.current = [];
    for (const c of list) {
      try {
        await pc.addIceCandidate(c);
      } catch {
        /* a stale candidate is harmless */
      }
    }
  };

  // ---- Incoming socket events ----
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected) return undefined;

    const onIncoming = ({ callId, from, username, kind }) => {
      if (callRef.current) return send('call:reject', { callId }); // already busy
      update({ callId, peer: { id: from, username }, kind, direction: 'in', phase: 'ringing', muted: false, cameraOff: false, speaker: true });
      tone().start('incoming');
    };

    // The other person picked up: we (the caller) create the WebRTC offer
    const onAccepted = async ({ callId }) => {
      if (callRef.current?.callId !== callId) return;
      tone().stop();
      update({ phase: 'connecting' });
      try {
        const pc = createPeer();
        await pc.setLocalDescription(await pc.createOffer());
        send('call:signal', { callId, data: { type: 'offer', sdp: pc.localDescription.sdp } });
      } catch {
        end('Could not start the call.');
      }
    };

    const onSignal = async ({ callId, data }) => {
      const cur = callRef.current;
      if (!cur || cur.callId !== callId || !data) return;
      try {
        if (data.type === 'offer' && typeof data.sdp === 'string') {
          const pc = pcRef.current || createPeer();
          await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
          await flushCandidates(pc);
          await pc.setLocalDescription(await pc.createAnswer());
          send('call:signal', { callId, data: { type: 'answer', sdp: pc.localDescription.sdp } });
        } else if (data.type === 'answer' && typeof data.sdp === 'string' && pcRef.current) {
          await pcRef.current.setRemoteDescription({ type: 'answer', sdp: data.sdp });
          await flushCandidates(pcRef.current);
        } else if (data.type === 'candidate' && data.candidate) {
          const pc = pcRef.current;
          if (pc?.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
          else queued.current.push(data.candidate);
        }
      } catch {
        end('Could not set up the call.');
      }
    };

    const onEnded = ({ callId, reason }) => {
      const cur = callRef.current;
      if (!cur || cur.callId !== callId) return;
      const name = cur.peer.username;
      const missed = cur.direction === 'in' && cur.phase === 'ringing';
      let text = 'Call ended';
      if (reason === 'declined') text = `${name} declined the call`;
      else if (reason === 'no-answer') text = missed ? `Missed call from ${name}` : `${name} didn’t answer`;
      else if (reason === 'cancelled') text = `Missed call from ${name}`;
      else if (reason === 'disconnected') text = `${name} got disconnected`;
      else if (reason === 'other-device') text = '';
      cleanup();
      notice(text);
    };

    socket.on('call:incoming', onIncoming);
    socket.on('call:accepted', onAccepted);
    socket.on('call:signal', onSignal);
    socket.on('call:ended', onEnded);
    return () => {
      socket.off('call:incoming', onIncoming);
      socket.off('call:accepted', onAccepted);
      socket.off('call:signal', onSignal);
      socket.off('call:ended', onEnded);
    };
  }, [connected, socketRef, send, update, createPeer, cleanup, end]);

  // The wake lock is released when the app goes to the background: take it again when we're back
  useEffect(() => {
    const again = () => document.visibilityState === 'visible' && callRef.current?.phase === 'active' && holdScreen();
    document.addEventListener('visibilitychange', again);
    return () => document.removeEventListener('visibilitychange', again);
  }, []);

  // If the signalling connection drops, the server ends the call for the other person too: end it here as well
  useEffect(() => {
    if (!connected && callRef.current) end('Connection lost.', false);
  }, [connected, end]);

  // Leaving the page ends the call
  useEffect(
    () => () => {
      const cur = callRef.current;
      if (cur) socketRef.current?.emit('call:end', { callId: cur.callId });
      cleanup();
    },
    [cleanup, socketRef]
  );

  // Only offer the flip-camera button when the device has more than one camera
  const detectFlip = (callId) => {
    if (callRef.current?.kind !== 'video') return;
    navigator.mediaDevices
      ?.enumerateDevices()
      .then((devices) => {
        if (callRef.current?.callId === callId) update({ canFlip: devices.filter((d) => d.kind === 'videoinput').length > 1 });
      })
      .catch(() => {});
  };

  // ---- Actions used by the UI ----
  const startCall = useCallback(
    async (peer, kind) => {
      if (callRef.current) return;
      primeAudio(); // inside the tap, so the phone lets the call's sound play
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
        notice('Calls need a modern browser on a secure (HTTPS) connection.');
        return;
      }
      const callId = newCallId();
      update({ callId, peer: { id: peer.id, username: peer.username }, kind, direction: 'out', phase: 'ringing', muted: false, cameraOff: false, speaker: true });
      let stream;
      try {
        stream = await getMedia(kind);
      } catch (err) {
        if (callRef.current?.callId === callId) cleanup();
        notice(mediaError(err));
        return;
      }
      if (callRef.current?.callId !== callId) {
        stream.getTracks().forEach((t) => t.stop()); // cancelled while the permission prompt was open
        return;
      }
      localRef.current = stream;
      setLocalStream(stream);
      detectFlip(callId);
      tone().start('outgoing');
      socketRef.current?.emit('call:invite', { to: peer.id, kind, callId }, (res) => {
        if (!res?.ok && callRef.current?.callId === callId) {
          cleanup();
          notice(res?.error || 'Could not place the call.');
        }
      });
    },
    [socketRef, update, cleanup]
  );

  const accept = useCallback(async () => {
    const cur = callRef.current;
    if (!cur || cur.direction !== 'in' || cur.phase !== 'ringing') return;
    primeAudio(); // inside the tap, so the phone lets the call's sound play
    tone().stop();
    update({ phase: 'connecting' });
    let stream;
    try {
      stream = await getMedia(cur.kind);
    } catch (err) {
      send('call:reject', { callId: cur.callId });
      if (callRef.current?.callId === cur.callId) cleanup();
      notice(mediaError(err));
      return;
    }
    if (callRef.current?.callId !== cur.callId) {
      stream.getTracks().forEach((t) => t.stop()); // the caller hung up while we were allowing access
      return;
    }
    localRef.current = stream;
    setLocalStream(stream);
    detectFlip(cur.callId);
    socketRef.current?.emit('call:accept', { callId: cur.callId }, (res) => {
      if (!res?.ok && callRef.current?.callId === cur.callId) {
        cleanup();
        notice(res?.error || 'This call is no longer available.');
      }
    });
  }, [socketRef, send, update, cleanup]);

  const decline = useCallback(() => {
    const cur = callRef.current;
    if (cur) send('call:reject', { callId: cur.callId });
    cleanup();
  }, [send, cleanup]);

  const hangup = useCallback(() => end(null, true), [end]);

  const toggleMute = useCallback(() => {
    const track = localRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    update({ muted: !track.enabled });
  }, [update]);

  // Front <-> back camera (video calls on phones)
  const switchCamera = useCallback(async () => {
    const cur = callRef.current;
    const stream = localRef.current;
    if (!cur || cur.kind !== 'video' || !stream) return;
    const next = cur.facing === 'environment' ? 'user' : 'environment';
    const ask = (facing) =>
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } } });
    const old = stream.getVideoTracks()[0];
    old?.stop(); // most phones can only open one camera at a time
    let fresh;
    let facing = next;
    try {
      fresh = await ask(next);
    } catch {
      try {
        facing = cur.facing || 'user';
        fresh = await ask(facing); // couldn't switch: go back to the camera we had
      } catch {
        notice('Could not switch the camera.');
        return;
      }
    }
    if (callRef.current?.callId !== cur.callId) {
      fresh.getTracks().forEach((t) => t.stop());
      return;
    }
    const track = fresh.getVideoTracks()[0];
    track.enabled = !cur.cameraOff;
    const sender = pcRef.current?.getSenders().find((s) => s.track?.kind === 'video' || (!s.track && old));
    try {
      await sender?.replaceTrack(track);
    } catch {
      /* the picture may freeze for the other person, but the call goes on */
    }
    if (old) stream.removeTrack(old);
    stream.addTrack(track);
    setLocalStream(new MediaStream(stream.getTracks())); // a new object so the preview re-attaches
    update({ facing });
  }, [update]);

  const toggleCamera = useCallback(() => {
    const track = localRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    update({ cameraOff: !track.enabled });
  }, [update]);

  // The overlay applies this to the element that plays the other person's voice (see audioRoute.js)
  const toggleSpeaker = useCallback(() => {
    if (callRef.current) update({ speaker: callRef.current.speaker === false });
  }, [update]);

  return { call, localStream, remoteStream, startCall, accept, decline, hangup, toggleMute, toggleCamera, toggleSpeaker, switchCamera };
}
