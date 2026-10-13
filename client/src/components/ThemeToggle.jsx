import { useTheme } from '../theme';
import Icon from './Icons';

export default function ThemeToggle({ className = 'icon-btn', withLabel = false }) {
  const [theme, toggle] = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button type="button" className={className} onClick={toggle} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={20} />
      {withLabel && <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>}
    </button>
  );
}
