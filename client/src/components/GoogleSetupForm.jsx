import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

// Step 2 of "Sign up with Google": Google has proven the email, now the person picks a
// username and a password. The account is only created when this form is submitted.
export default function GoogleSetupForm({ setup, onCancel }) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: setup.suggestedUsername || '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  async function handleSubmit(e) {
    e.preventDefault();
    if (!USERNAME_RE.test(form.username)) return setError('Username must be 3-20 letters, numbers or underscores');
    if (form.password.length < 8) return setError('Password must be at least 8 characters');
    if (form.password !== form.confirm) return setError('Passwords do not match');

    setBusy(true);
    setError('');
    try {
      const data = await api.googleComplete({
        setupToken: setup.setupToken,
        username: form.username,
        password: form.password,
      });
      await signIn(data);
      navigate('/chat');
    } catch (err) {
      setError(err.message);
      if (err.status === 401) onCancel(); // setup session expired: start again
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="auth-card" onSubmit={handleSubmit} noValidate>
      <div>
        <h1>Finish your account</h1>
        <p className="muted">
          Google confirmed your email. Choose a username and a password to finish signing up. Your encryption keys
          are generated in this browser, never on our server.
        </p>
      </div>

      <label>Email (from Google)
        <input type="email" value={setup.email} readOnly disabled />
      </label>
      <label>Username
        <input value={form.username} onChange={set('username')} autoComplete="username" maxLength={20} autoFocus />
      </label>
      <label>Password
        <input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" maxLength={72} />
      </label>
      <label>Confirm password
        <input type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" maxLength={72} />
      </label>

      {error && <div className="form-error" role="alert">{error}</div>}

      <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
        {busy ? 'Please wait…' : 'Create account'}
      </button>
      <button type="button" className="link-btn" onClick={onCancel} disabled={busy}>
        Use a different account
      </button>
    </form>
  );
}
