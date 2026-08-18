import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PixelButton, PixelCard, PixelInput } from '../ui/primitives.js';
import { api } from '../net/socket.js';

export default function AdminLogin(): React.ReactElement {
  const navigate = useNavigate();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Sign-in stays on the Better Auth handler, untouched.
    const res = await api('/api/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (res.status !== 200) {
      setError('Those credentials were not accepted');
      return;
    }
    navigate('/admin');
  };

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <PixelCard className="w-full max-w-md">
        <h1 className="font-display text-[18px] mb-6">Host sign in</h1>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <PixelInput
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <PixelInput
            label="Password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-pa-danger text-[13px]">
              {error}
            </p>
          )}
          <PixelButton type="submit" size="lg" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </PixelButton>
        </form>
        <p className="mt-6 text-[13px] text-pa-ink-dim">
          No account?{' '}
          <Link to="/admin/signup" className="text-pa-cyan underline">
            Register with a signup code
          </Link>
        </p>
      </PixelCard>
    </main>
  );
}
