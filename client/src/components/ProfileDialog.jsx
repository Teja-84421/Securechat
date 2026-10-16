import { useEffect, useState } from 'react';
import { api } from '../api';
import Avatar from './Avatar';
import Icon from './Icons';
import { useTheme } from '../theme';
import { useInstall } from '../install';

function signInMethod(u) {
  if (u.has_google && u.has_password) return 'Google and password';
  if (u.has_google) return 'Google';
  return 'Email and password';
}

// "My profile": the account details, fetched fresh from the server when opened.
export default function ProfileDialog({ user, connected, onClose, onSignOut }) {
  const [details, setDetails] = useState(user);
  const [error, setError] = useState('');
  const [theme, toggleTheme] = useTheme();
  const { canInstall, iosHint, promptInstall } = useInstall();

  useEffect(() => {
    api.me().then(({ user: fresh }) => setDetails((d) => ({ ...d, ...fresh }))).catch(() => setError('Could not refresh your details.'));
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const joined = details.created_at
    ? new Date(details.created_at).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })
    : '…';

  const rows = [
    ['Username', details.username],
    ['Email', details.email],
    ['Signs in with', details.has_google === undefined ? '…' : signInMethod(details)],
    ['Member since', joined],
    ['Encryption keys', details.public_key ? 'Active in this browser' : 'Not set up yet'],
  ];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <button type="button" className="icon-btn modal-x" onClick={onClose} aria-label="Close">
          <Icon name="x" />
        </button>
        <h2 id="profile-title">My profile</h2>

        <div className="profile-head">
          <Avatar name={details.username} size={84} online={connected} />
          <h3>{details.username}</h3>
          <span className={`status-pill ${connected ? 'on' : ''}`}>{connected ? 'Online' : 'Reconnecting…'}</span>
        </div>

        <dl className="profile-list">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        {error && <div className="form-error" role="alert">{error}</div>}

        <div className="profile-actions">
          <button type="button" className="btn btn-ghost" onClick={toggleTheme}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} /> {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          {canInstall && (
            <button type="button" className="btn btn-ghost" onClick={promptInstall}>
              <Icon name="download" size={18} /> Install app
            </button>
          )}
        </div>
        {!canInstall && iosHint && <p className="muted profile-hint">To install: tap Share, then “Add to Home Screen”.</p>}

        <button type="button" className="btn btn-ghost btn-danger-ghost" onClick={onSignOut}>
          <Icon name="logout" size={18} /> Log out
        </button>
      </div>
    </div>
  );
}
