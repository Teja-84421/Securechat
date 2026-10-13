import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import Icon from './Icons';

// Create a room (and share its code) or join one with a code.
export default function RoomDialog({ initialTab = 'create', onClose, onChanged, onJoined }) {
  const [tab, setTab] = useState(initialTab);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [room, setRoom] = useState(null); // the room I just created
  const [code, setCode] = useState('');
  const [copied, setCopied] = useState('');
  const codeInput = useRef(null);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    if (tab === 'join') codeInput.current?.focus();
  }, [tab]);

  async function create() {
    setBusy(true);
    setError('');
    try {
      const { room } = await api.createRoom();
      setRoom(room);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function join(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { room } = await api.joinRoom(code);
      onChanged();
      onJoined(room);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function copy(kind, text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(''), 1800);
    } catch {
      setError('Couldn’t copy. Select the code and copy it by hand.');
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="room-title">
        <button type="button" className="icon-btn modal-x" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
        <h2 id="room-title">Start a private chat</h2>

        <div className="seg" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'on' : ''} onClick={() => { setTab('create'); setError(''); }}>
            Create a room
          </button>
          <button type="button" role="tab" aria-selected={tab === 'join'} className={tab === 'join' ? 'on' : ''} onClick={() => { setTab('join'); setError(''); }}>
            Join with a code
          </button>
        </div>

        {tab === 'create' ? (
          room ? (
            <div className="room-created">
              <p className="muted">Send this code to the person you want to chat with. The room stays open until they join.</p>
              <div className="code-tiles" aria-label={`Room code ${room.code}`}>
                {room.code.split('').map((c, i) => <span key={i}>{c}</span>)}
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-primary" onClick={() => copy('code', room.code)}>
                  <Icon name={copied === 'code' ? 'check' : 'copy'} size={18} /> {copied === 'code' ? 'Copied' : 'Copy code'}
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => copy('invite', `Join my private SecureChat room. Code: ${room.code}`)}>
                  <Icon name={copied === 'invite' ? 'check' : 'send'} size={18} /> {copied === 'invite' ? 'Copied' : 'Copy invite message'}
                </button>
              </div>
              <button type="button" className="link-btn" onClick={onClose}>Done, I’ll wait in the chat list</button>
            </div>
          ) : (
            <div className="room-intro">
              <p className="muted">
                A room is a private space for exactly two people. You get a six-character code, your friend enters it, and
                only then do you see each other. Nobody else can find you.
              </p>
              <button type="button" className="btn btn-primary btn-block btn-lg" onClick={create} disabled={busy}>
                <Icon name="key" size={20} /> {busy ? 'Creating…' : 'Create room'}
              </button>
            </div>
          )
        ) : (
          <form className="room-join" onSubmit={join}>
            <p className="muted">Enter the six-character code your friend sent you.</p>
            <input
              ref={codeInput}
              className="code-input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              placeholder="K7P2QX"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck="false"
              aria-label="Room code"
            />
            <button className="btn btn-primary btn-block btn-lg" disabled={busy || code.length !== 6}>
              <Icon name="enter" size={20} /> {busy ? 'Joining…' : 'Join room'}
            </button>
          </form>
        )}

        {error && <div className="form-error" role="alert">{error}</div>}
      </div>
    </div>
  );
}
