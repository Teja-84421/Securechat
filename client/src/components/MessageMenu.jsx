import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Icon from './Icons';

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const MORE_EMOJI = [
  '😀', '😁', '😅', '🤣', '😊', '😍', '😘', '😎', '🤔', '😴', '😭', '😡',
  '👏', '🙌', '👎', '👌', '✌️', '🤝', '💪', '🔥', '🎉', '💯', '✅', '❌',
  '💔', '💜', '⭐', '🥳', '🤯', '👀', '🫡', '🙈',
];

// Floating menu for one message. On phones it becomes a bottom sheet.
//   mode "full":  quick reactions + copy / edit / delete
//   mode "react": quick reactions only (the 😊 button next to a bubble)
export default function MessageMenu({ message, anchor, mode, myReaction, canEdit, onReact, onEdit, onCopy, onDelete, onClose }) {
  const [step, setStep] = useState('main'); // main | emoji | delete
  const [pos, setPos] = useState(null);
  const ref = useRef(null);
  const sheet = window.matchMedia('(max-width: 768px)').matches;
  const deleted = !!message.deletedAt;
  const canCopy = message.type === 'text' && !deleted && !!message.text;

  useLayoutEffect(() => {
    if (sheet || !ref.current) return;
    const { offsetWidth: w, offsetHeight: h } = ref.current;
    let top = anchor.top - h - 8;
    if (top < 8) top = Math.min(anchor.bottom + 8, window.innerHeight - h - 8);
    let left = message.mine ? anchor.right - w : anchor.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    setPos({ top, left });
  }, [anchor, message.mine, sheet, step]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const react = (emoji) => {
    onReact(emoji);
    onClose();
  };

  return (
    <>
      <div className={`menu-backdrop ${sheet ? 'dim' : ''}`} onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div
        ref={ref}
        className={`menu ${sheet ? 'sheet' : ''}`}
        style={sheet ? undefined : { top: pos?.top ?? -9999, left: pos?.left ?? -9999, visibility: pos ? 'visible' : 'hidden' }}
        role="menu"
      >
        {step === 'emoji' ? (
          <div className="emoji-grid">
            {MORE_EMOJI.map((e) => (
              <button key={e} type="button" onClick={() => react(e)} aria-label={`React ${e}`}>{e}</button>
            ))}
          </div>
        ) : step === 'delete' ? (
          <div className="menu-list">
            <p className="menu-title">Delete this message?</p>
            <button type="button" className="menu-item" onClick={() => { onDelete('me'); onClose(); }}>
              <Icon name="trash" size={18} /> Delete for me
            </button>
            {message.mine && !deleted && (
              <button type="button" className="menu-item danger" onClick={() => { onDelete('everyone'); onClose(); }}>
                <Icon name="ban" size={18} /> Delete for everyone
              </button>
            )}
            <button type="button" className="menu-item" onClick={() => setStep('main')}>
              <Icon name="back" size={18} /> Cancel
            </button>
          </div>
        ) : (
          <>
            {!deleted && (
              <div className="quick" role="group" aria-label="React to message">
                {QUICK_REACTIONS.map((e) => (
                  <button key={e} type="button" className={e === myReaction ? 'picked' : ''} onClick={() => react(e === myReaction ? null : e)} aria-label={`React ${e}`}>
                    {e}
                  </button>
                ))}
                <button type="button" className="more-emoji" onClick={() => setStep('emoji')} aria-label="More reactions">
                  <Icon name="plus" size={18} />
                </button>
              </div>
            )}
            {mode === 'full' && (
              <div className="menu-list">
                {canCopy && (
                  <button type="button" className="menu-item" onClick={() => { onCopy(); onClose(); }}>
                    <Icon name="copy" size={18} /> Copy
                  </button>
                )}
                {canEdit && (
                  <button type="button" className="menu-item" onClick={() => { onEdit(); onClose(); }}>
                    <Icon name="edit" size={18} /> Edit
                  </button>
                )}
                <button type="button" className="menu-item danger" onClick={() => setStep('delete')}>
                  <Icon name="trash" size={18} /> Delete
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
