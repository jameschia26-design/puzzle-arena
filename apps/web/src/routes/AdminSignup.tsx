import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PixelButton, PixelCard, PixelInput } from '../ui/primitives.js';
import { api } from '../net/socket.js';

export default function AdminSignup(): React.ReactElement {
  const navigate = useNavigate();
  const [form, setForm] = React.useState({
    name: '',
    email: '',
    password: '',
    signupCode: '',
  });
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    // Registration is gated by the signup code, server-side.
    const res = await api<{ error?: string }>('/api/admin/register', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    setBusy(false);
    if (res.status !== 200) {
      setError(res.body?.error ?? 'Registration failed');
      return;
    }
    navigate('/admin');
  };

  const signInWithGoogle = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ url?: string; error?: string }>('/api/auth/sign-in/social', {
        method: 'POST',
        body: JSON.stringify({
          provider: 'google',
          callbackURL: `${window.location.origin}/admin`,
        }),
      });
      if (res.body?.url) {
        window.location.href = res.body.url;
      } else {
        setError(res.body?.error ?? 'Google SSO is not configured on the server (GOOGLE_CLIENT_ID missing)');
        setBusy(false);
      }
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center p-6 pb-20 sm:pb-6">
      <PixelCard className="w-full max-w-md">
        <h1 className="font-display text-[18px] mb-6">Register as host</h1>

        <button
          type="button"
          onClick={signInWithGoogle}
          disabled={busy}
          className="w-full py-2.5 px-4 mb-1.5 flex items-center justify-center gap-3 border-2 border-pa-border bg-pa-surface hover:border-pa-cyan hover:bg-pa-surface-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
            <path
              fill="#EA4335"
              d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"
            />
            <path
              fill="#4285F4"
              d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"
            />
            <path
              fill="#FBBC05"
              d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3 0-.8.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12 0 14.5s.7 4.8 1.9 7.2l3.7-2.9z"
            />
            <path
              fill="#34A853"
              d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2.4-6.4-5.2L1.9 16.5C3.7 20.2 7.5 23.5 12 23.5z"
            />
          </svg>
          <span className="font-display text-[11px]">Continue with Google</span>
        </button>
        <p className="text-[11px] text-pa-ink-dim text-center italic mb-3">
          Google SSO is not yet available
        </p>

        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-pa-border" />
          <span className="text-[11px] text-pa-ink-dim uppercase font-display">OR</span>
          <div className="flex-1 h-px bg-pa-border" />
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4">
          <PixelInput label="Name" required value={form.name} onChange={set('name')} />
          <PixelInput
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={set('email')}
          />
          <PixelInput
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={form.password}
            onChange={set('password')}
          />
          <PixelInput
            label="Signup code"
            required
            value={form.signupCode}
            onChange={set('signupCode')}
          />
          {error && (
            <p role="alert" className="text-pa-danger text-[13px]">
              {error}
            </p>
          )}
          <PixelButton type="submit" size="lg" disabled={busy}>
            {busy ? 'Registering…' : 'Register with Code'}
          </PixelButton>
        </form>
        <p className="mt-6 text-[13px] text-pa-ink-dim">
          Already registered?{' '}
          <Link to="/admin/login" className="text-pa-cyan underline">
            Sign in
          </Link>
        </p>
      </PixelCard>
    </main>
  );
}
