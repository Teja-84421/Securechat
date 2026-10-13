import Logo from './Logo';
import Icon from './Icons';
import Avatar from './Avatar';
import ThemeToggle from './ThemeToggle';

// Slim navigation rail on desktop, bottom tab bar on phones
export default function Rail({ user, connected, unreadTotal, onNewRoom, onSignOut }) {
  return (
    <nav className="rail" aria-label="Main">
      <span className="rail-logo"><Logo size={34} text={false} /></span>
      <div className="rail-main">
        <button type="button" className="rail-btn active" aria-label="Chats" title="Chats">
          <Icon name="chat" size={22} />
          {unreadTotal > 0 && <i className="rail-dot" />}
          <span>Chats</span>
        </button>
        <button type="button" className="rail-btn" onClick={onNewRoom} aria-label="New room" title="New room">
          <Icon name="key" size={22} />
          <span>Rooms</span>
        </button>
      </div>
      <div className="rail-foot">
        <ThemeToggle className="rail-btn" withLabel />
        <button type="button" className="rail-btn" onClick={onSignOut} aria-label="Log out" title={`Log out ${user.username}`}>
          <Icon name="logout" size={22} />
          <span>Exit</span>
        </button>
        <span className="rail-me" title={`${user.username}, ${connected ? 'connected' : 'reconnecting'}`}>
          <Avatar name={user.username} size={38} online={connected} />
        </span>
      </div>
    </nav>
  );
}
