import { useEffect, useState } from 'react';
import Avatar from './Avatar';
import Icon from './Icons';
import { safetyNumber } from '../crypto';

// Right-hand drawer: who this is, how to verify the encryption, and how to close the room.
export default function InfoPanel({ peer, room, myPublicKey, online, onClose, onLeave }) {
  const [groups, setGroups] = useState(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setGroups(null);
    if (peer.public_key && myPublicKey) safetyNumber(myPublicKey, peer.public_key).then(setGroups).catch(() => {});
  }, [peer.public_key, myPublicKey]);

  const since = room?.joined_at ? new Date(room.joined_at).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' }) : null;

  return (
    <aside className="info" aria-label="Chat details">
      <div className="info-head">
        <strong>Details</strong>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close details"><Icon name="x" /></button>
      </div>

      <div className="info-profile">
        <Avatar name={peer.username} size={84} online={online} />
        <h3>{peer.username}</h3>
        <span className={`status-pill ${online ? 'on' : ''}`}>{online ? 'Online now' : 'Offline'}</span>
      </div>

      <section className="info-card">
        <h4><Icon name="lock" size={16} /> End-to-end encrypted</h4>
        <p>Messages and voice notes are locked in your browser with AES-256-GCM. The server only stores scrambled data.</p>
      </section>

      <section className="info-card">
        <h4><Icon name="shield" size={16} /> Safety number</h4>
        {groups ? (
          <div className="safety" aria-label="Safety number">{groups.map((g) => <span key={g}>{g}</span>)}</div>
        ) : (
          <p className="muted">Not available until both of you have opened the app once.</p>
        )}
        <p>Compare this with {peer.username} on a call or in person. If the numbers match, nobody is intercepting your chat.</p>
      </section>

      <section className="info-card">
        <h4><Icon name="key" size={16} /> Room</h4>
        <p>{since ? `You've been in this room since ${since}.` : 'This is a private room for two.'}</p>
        {confirming ? (
          <div className="confirm">
            <p>Close this room? The whole conversation is deleted for both of you and can’t be restored.</p>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)}>Keep it</button>
              <button type="button" className="btn btn-danger" onClick={onLeave}>Close room</button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-danger-ghost" onClick={() => setConfirming(true)}>
            <Icon name="trash" size={18} /> Close room
          </button>
        )}
      </section>
    </aside>
  );
}
