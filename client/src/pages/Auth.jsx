import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import Logo from '../components/Logo';
import GoogleButton from '../components/GoogleButton';
import GoogleSetupForm from '../components/GoogleSetupForm';
import ThemeToggle from '../components/ThemeToggle';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Auth({ mode }) {
  const isRegister = mode === 'register';
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '', identifier: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [setup, setSetup] = useState(null); // set when a NEW Google user must still pick a username + password

  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  function validate() {
    if (isRegister) {
      if (!USERNAME_RE.test(form.username)) return 'Username must be 3-20 letters, numbers or underscores';
      if (!EMAIL_RE.test(form.email)) return 'Enter a valid email address';
      if (form.password.length < 8) return 'Password must be at least 8 characters';
    } else if (!form.identifier || !form.password) {
      return 'Enter your username/email and password';
    }
    return '';
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const problem = validate();
    if (problem) return setError(problem);
    setBusy(true);
    setError('');
    try {
      const data = isRegister
        ? await api.register({ username: form.username, email: form.email, password: form.password })
        : await api.login({ identifier: form.identifier, password: form.password });
      await signIn(data);
      navigate('/chat');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Google sign-in handles both "login" and "register": new emails get an account automatically.
  async function handleGoogle(credential) {
    setBusy(true);
    setError('');
    try {
      const data = await api.googleLogin(credential);
      if (data.needsSetup) return setSetup(data);
      await signIn(data);
      navigate('/chat');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <header className="auth-top">
        <Link to="/" className="auth-logo" aria-label="SecureChat home"><Logo /></Link>
        <ThemeToggle />
      </header>

      <main className="auth-main">
        {setup ? (
          <GoogleSetupForm setup={setup} onCancel={() => setSetup(null)} />
        ) : (
        <form className="auth-card" onSubmit={handleSubmit} noValidate>
          <div className="seg" role="tablist" aria-label="Account">
            <Link role="tab" aria-selected={!isRegister} className={!isRegister ? 'on' : ''} to="/login">Login</Link>
            <Link role="tab" aria-selected={isRegister} className={isRegister ? 'on' : ''} to="/register">Register</Link>
          </div>

          <div>
            <h1>{isRegister ? 'Create your account' : 'Welcome back'}</h1>
            <p className="muted">
              {isRegister
                ? 'Your encryption keys are generated in this browser, never on our server.'
                : 'Log in to get back to your private rooms.'}
            </p>
          </div>

          <GoogleButton mode={mode} onCredential={handleGoogle} onError={setError} disabled={busy} />

          {isRegister ? (
            <>
              <label>Username
                <input value={form.username} onChange={set('username')} autoComplete="username" maxLength={20} />
              </label>
              <label>Email
                <input type="email" value={form.email} onChange={set('email')} autoComplete="email" maxLength={100} />
              </label>
            </>
          ) : (
            <label>Username or email
              <input value={form.identifier} onChange={set('identifier')} autoComplete="username" />
            </label>
          )}
          <label>Password
            <input
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete={isRegister ? 'new-password' : 'current-password'}
              maxLength={72}
            />
          </label>

          {error && <div className="form-error" role="alert">{error}</div>}

          <button className="btn btn-primary btn-block btn-lg" disabled={busy}>
            {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Login'}
          </button>
          <p className="auth-note">After signing in you can create a room, or join one with a code.</p>
        </form>
        )}
      </main>
    </div>
  );
}
