import { useMemo, useRef } from 'react';
import Icon from './Icons';
import VoiceBubble from './VoiceBubble';

const formatTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// WhatsApp-style ticks on my own messages: one = sent, two = delivered, two blue = seen
function Ticks({ m }) {
  const status = m.readAt ? 'read' : m.deliveredAt ? 'delivered' : 'sent';
  const label = { sent: 'Sent', delivered: 'Delivered', read: 'Seen' }[status];
  return (
    <span className={`ticks ${status}`} title={status === 'read' ? `Seen ${new Date(m.readAt).toLocaleString()}` : label} aria-label={label}>
      <Icon name={status === 'sent' ? 'check' : 'checks'} size={15} />
    </span>
  );
}

// pos: where this bubble sits in a run of messages from the same person (single | first | middle | last)
export default function MessageBubble({ m, myId, pos = 'single', onOpenMenu, onToggleReaction, loadVoice }) {
  const bubbleRef = useRef(null);
  const pressTimer = useRef(null);
  const deleted = !!m.deletedAt;
  const broken = m.type === 'text' && !deleted && m.text === null;

  // Group reactions by emoji: 👍 2, ❤️ 1 …
  const groups = useMemo(() => {
    const map = new Map();
    for (const r of m.reactions) {
      const g = map.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false };
      g.count += 1;
      if (r.user_id === myId) g.mine = true;
      map.set(r.emoji, g);
    }
    return [...map.values()];
  }, [m.reactions, myId]);

  const open = (mode) => onOpenMenu(m, bubbleRef.current.getBoundingClientRect(), mode);

  // Long-press (touch) and right-click both open the menu
  const startPress = () => {
    pressTimer.current = setTimeout(() => open('full'), 450);
  };
  const endPress = () => clearTimeout(pressTimer.current);

  return (
    <div className={`bubble-row ${m.mine ? 'mine' : 'theirs'} pos-${pos}`}>
      <div className="msg-tools">
        {!deleted && (
          <button type="button" className="tool-btn" onClick={() => open('react')} aria-label="React to message">
            <Icon name="smile" size={18} />
          </button>
        )}
        <button type="button" className="tool-btn" onClick={() => open('full')} aria-label="Message options">
          <Icon name="chevron" size={18} />
        </button>
      </div>

      <div className="msg-col">
        <div
          ref={bubbleRef}
          className={`bubble ${m.type === 'voice' && !deleted ? 'is-voice' : ''} ${broken ? 'broken' : ''} ${deleted ? 'deleted' : ''}`}
          onContextMenu={(e) => {
            e.preventDefault();
            open('full');
          }}
          onTouchStart={startPress}
          onTouchEnd={endPress}
          onTouchMove={endPress}
          onTouchCancel={endPress}
        >
          {deleted ? (
            <span className="deleted-note">
              <Icon name="ban" size={15} /> {m.mine ? 'You deleted this message' : 'This message was deleted'}
            </span>
          ) : m.type === 'voice' ? (
            <VoiceBubble message={m} load={loadVoice} />
          ) : (
            <span className="text">{m.text ?? '⚠ Could not decrypt (keys on this device don’t match)'}</span>
          )}
          <span className="meta">
            {m.editedAt && !deleted && <em>edited</em>}
            <time title={new Date(m.time).toLocaleString()}>{formatTime(m.time)}</time>
            {m.mine && !deleted && <Ticks m={m} />}
          </span>
        </div>

        {groups.length > 0 && (
          <div className="reactions">
            {groups.map((g) => (
              <button
                key={g.emoji}
                type="button"
                className={`chip ${g.mine ? 'mine-react' : ''}`}
                onClick={() => onToggleReaction(m, g.emoji)}
                aria-label={`${g.emoji} ${g.count}${g.mine ? ', your reaction' : ''}`}
              >
                <span>{g.emoji}</span>
                {g.count > 1 && <small>{g.count}</small>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
