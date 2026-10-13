import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import Avatar from '../components/Avatar';
import Icon from '../components/Icons';
import ThemeToggle from '../components/ThemeToggle';
import { toB64 } from '../crypto';

const SAMPLE = '7Hq2bV0xk9sLmR4e1ZpYt3uWcD8nQa6fJgXo5hKiEvA=';

// A chat window where the visitor types and sees the REAL AES-256-GCM ciphertext
// (throwaway key, generated in this tab) next to their message.
function ChatDemo() {
  const [text, setText] = useState('Yes. Only we can read this.');
  const [key, setKey] = useState(null);
  const [cipher, setCipher] = useState(SAMPLE);

  useEffect(() => {
    window.crypto?.subtle?.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt']).then(setKey).catch(() => {});
  }, []);

  useEffect(() => {
    if (!key) return;
    let current = true;
    (async () => {
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const data = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text || ' '));
      if (current) setCipher(toB64(data));
    })();
    return () => { current = false; };
  }, [key, text]);

  return (
    <div className="mockwin" aria-label="Live encryption demo">
      <div className="mockwin-head">
        <Avatar name="Maya" size={38} online />
        <div className="mockwin-title">
          <strong>Maya</strong>
          <small>Room K7P2QX</small>
        </div>
        <span className="e2e-badge"><Icon name="lock" size={14} /> Encrypted</span>
      </div>

      <div className="mockwin-body">
        <div className="bubble-row theirs pos-single">
          <div className="msg-col">
            <div className="bubble"><span className="text">Joined with your code. Is this really private?</span></div>
          </div>
        </div>
        <div className="bubble-row mine pos-single">
          <div className="msg-col">
            <div className="bubble"><span className="text">{text || '…'}</span></div>
            <div className="reactions"><span className="chip">❤️</span></div>
          </div>
        </div>
        <div className="cipher">
          <span><Icon name="lock" size={13} /> What the server stores for your message</span>
          <code>{cipher}</code>
        </div>
      </div>

      <label className="composer mock-composer">
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={70} spellCheck="false" aria-label="Type a message to encrypt" />
        <span className="send-btn" aria-hidden="true"><Icon name="send" size={19} /></span>
      </label>
    </div>
  );
}

const steps = [
  ['key', 'Create a room', 'You get a six-character code. The room is private to you and whoever you give it to.'],
  ['send', 'Share the code', 'Send it in any way you like. It works for one person, one time.'],
  ['lock', 'Chat in private', 'Once your friend joins, texts and voice notes are locked in your browsers before they travel.'],
];

const features = [
  ['key', 'Not a public directory', 'Nobody can browse users. You only ever see people you share a room with.'],
  ['edit', 'Edit and unsend', 'Fix a typo for 15 minutes, or delete a message for everyone.'],
  ['smile', 'Reactions', 'Answer any message with an emoji, like you do everywhere else.'],
  ['mic', 'Encrypted voice notes', 'Record, send and play at 1x, 1.5x or 2x speed.'],
  ['shield', 'Safety numbers', 'Compare six numbers with your friend to prove nobody is in the middle.'],
  ['moon', 'Light and dark', 'Pick the theme that is easy on your eyes. It is remembered.'],
];

export default function Landing() {
  return (
    <div className="landing">
      <header className="landing-nav">
        <Logo />
        <nav>
          <ThemeToggle />
          <Link className="btn btn-ghost" to="/login">Login</Link>
          <Link className="btn btn-primary" to="/register">Create account</Link>
        </nav>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <h1>Private rooms for two.</h1>
            <p>
              Create a room, share a six-character code, and talk. Every message and voice note is locked in your
              browser before it leaves, so the server only ever carries scrambled data.
            </p>
            <div className="hero-actions">
              <Link className="btn btn-primary btn-lg" to="/register">Start a private room</Link>
              <Link className="btn btn-ghost btn-lg" to="/login">I have an account</Link>
            </div>
            <p className="hero-hint">Try it on the right. Type anything and watch it turn into ciphertext.</p>
          </div>
          <ChatDemo />
        </section>

        <section className="how">
          <h2>How a room works</h2>
          <ol>
            {steps.map(([icon, title, text], i) => (
              <li key={title}>
                <span className="step-no">{i + 1}</span>
                <h3>{title}</h3>
                <p>{text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="features">
          {features.map(([icon, title, text]) => (
            <div className="feature" key={title}>
              <span className="feature-icon"><Icon name={icon} size={22} /></span>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="landing-foot">SecureChat, a Computer Networks project</footer>
    </div>
  );
}
