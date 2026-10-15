import { useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import Icon from './Icons';
import { setSpeaker } from '../audioRoute';

// Full-screen call UI: incoming-call screen, "calling…" screen and the in-call view.
function attach(ref, stream) {
  if (ref.current && ref.current.srcObject !== (stream || null)) ref.current.srcObject = stream || null;
}

function Timer({ since }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <>{String(Math.floor(s / 60)).padStart(2, '0')}:{String(s % 60).padStart(2, '0')}</>;
}

export default function CallOverlay({ call, localStream, remoteStream, onAccept, onDecline, onHangup, onMute, onCamera, onSpeaker }) {
  const remoteRef = useRef(null);
  const localRef = useRef(null);

  const incoming = !!call && call.direction === 'in' && call.phase === 'ringing';
  const isVideo = call?.kind === 'video';
  const layoutKey = call ? `${call.callId}:${incoming}` : '';

  // (Re)attach the media streams whenever a stream or the layout changes
  useEffect(() => attach(remoteRef, remoteStream), [remoteStream, layoutKey]);
  useEffect(() => attach(localRef, localStream), [localStream, layoutKey]);

  // Speaker on = loudspeaker / full volume, off = earpiece / quieter (re-applied when the stream arrives)
  const speakerOn = call?.speaker !== false;
  useEffect(() => {
    if (remoteRef.current) setSpeaker(remoteRef.current, speakerOn);
  }, [speakerOn, remoteStream, layoutKey]);

  if (!call) return null;

  const { peer, kind, phase } = call;
  const hasRemoteVideo = isVideo && phase === 'active' && !!remoteStream;
  let status;
  if (incoming) status = `Incoming ${kind} call`;
  else if (phase === 'ringing') status = 'Calling…';
  else if (phase === 'connecting') status = 'Connecting…';
  else status = call.unstable ? 'Reconnecting…' : <Timer since={call.startedAt || Date.now()} />;

  return (
    <div className={`call-overlay ${hasRemoteVideo ? 'has-video' : ''}`} role="dialog" aria-modal="true" aria-label={`${kind} call with ${peer.username}`}>
      {/* The remote person: video fills the screen, audio plays through a hidden element */}
      {!incoming && (isVideo ? <video ref={remoteRef} className="call-remote" autoPlay playsInline /> : <audio ref={remoteRef} autoPlay />)}

      <div className="call-top">
        <strong>{peer.username}</strong>
        <span className="call-status">{status}</span>
        <span className="call-secure"><Icon name="lock" size={13} /> Encrypted, peer-to-peer</span>
      </div>

      {!hasRemoteVideo && (
        <div className="call-center">
          <span className={`call-avatar ${phase !== 'active' ? 'ringing' : ''}`}>
            <Avatar name={peer.username} size={120} />
          </span>
        </div>
      )}

      {/* My own camera (small picture-in-picture) */}
      {!incoming && isVideo && localStream && (
        <video ref={localRef} className={`call-local ${call.cameraOff ? 'cam-off' : ''}`} autoPlay playsInline muted />
      )}

      <div className="call-bar">
        {incoming ? (
          <>
            <button type="button" className="call-btn end" onClick={onDecline} aria-label="Decline call" title="Decline">
              <Icon name="phone" size={26} />
            </button>
            <button type="button" className="call-btn accept" onClick={onAccept} aria-label="Accept call" title="Accept">
              <Icon name={isVideo ? 'video' : 'phone'} size={26} />
            </button>
          </>
        ) : (
          <>
            {phase !== 'ringing' && (
              <button type="button" className={`call-btn ${call.muted ? 'off' : ''}`} onClick={onMute} aria-label={call.muted ? 'Unmute' : 'Mute'} aria-pressed={!!call.muted} title={call.muted ? 'Unmute' : 'Mute'}>
                <Icon name={call.muted ? 'micOff' : 'mic'} size={24} />
              </button>
            )}
            {phase !== 'ringing' && (
              <button type="button" className={`call-btn ${speakerOn ? 'on' : ''}`} onClick={onSpeaker} aria-label={speakerOn ? 'Turn speaker off' : 'Turn speaker on'} aria-pressed={speakerOn} title={speakerOn ? 'Speaker on' : 'Speaker off'}>
                <Icon name={speakerOn ? 'speaker' : 'speakerLow'} size={24} />
              </button>
            )}
            {isVideo && phase !== 'ringing' && (
              <button type="button" className={`call-btn ${call.cameraOff ? 'off' : ''}`} onClick={onCamera} aria-label={call.cameraOff ? 'Turn camera on' : 'Turn camera off'} aria-pressed={!!call.cameraOff} title={call.cameraOff ? 'Turn camera on' : 'Turn camera off'}>
                <Icon name={call.cameraOff ? 'videoOff' : 'video'} size={24} />
              </button>
            )}
            <button type="button" className="call-btn end" onClick={onHangup} aria-label={phase === 'ringing' ? 'Cancel call' : 'End call'} title={phase === 'ringing' ? 'Cancel' : 'End call'}>
              <Icon name="phone" size={26} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
