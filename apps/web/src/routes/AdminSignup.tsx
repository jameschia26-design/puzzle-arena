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

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <PixelCard className="w-full max-w-md">
        <h1 className="font-display text-[18px] mb-6">Register as host</h1>
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
            {busy ? 'Registering…' : 'Register'}
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
