import { useEffect } from 'react';

const EMOJI = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😅', '😴', '😭',
  '😡', '🥳', '🤯', '🫡', '🙈', '👀', '👍', '👎', '👏', '🙌', '🙏', '🤝',
  '💪', '👌', '✌️', '🔥', '🎉', '💯', '✅', '❌', '❤️', '💜', '💔', '⭐',
];

// Small emoji popover for the composer
export default function EmojiPicker({ onPick, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div className="emoji-pop" role="dialog" aria-label="Emoji picker">
        <div className="emoji-grid">
          {EMOJI.map((e) => (
            <button key={e} type="button" onClick={() => onPick(e)} aria-label={e}>{e}</button>
          ))}
        </div>
      </div>
    </>
  );
}
