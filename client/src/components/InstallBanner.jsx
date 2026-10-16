import { useState } from 'react';
import { useInstall } from '../install';
import Icon from './Icons';

const KEY = 'securechat_install_dismissed';

// A small, dismissible card that offers to put SecureChat on the home screen
export default function InstallBanner() {
  const { canInstall, iosHint, promptInstall } = useInstall();
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  if (hidden || (!canInstall && !iosHint)) return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="install-banner" role="region" aria-label="Install SecureChat">
      <span className="install-ico"><Icon name="download" size={20} /></span>
      <div className="install-text">
        <strong>Get the app</strong>
        <small>
          {canInstall ? 'Full screen, faster to open, works like a normal app.' : 'Tap the Share button, then “Add to Home Screen”.'}
        </small>
      </div>
      {canInstall && (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => promptInstall().then((ok) => ok && dismiss())}>
          Install
        </button>
      )}
      <button type="button" className="icon-btn small" onClick={dismiss} aria-label="Dismiss">
        <Icon name="x" size={16} />
      </button>
    </div>
  );
}
