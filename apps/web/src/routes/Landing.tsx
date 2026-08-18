import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { GAME_IDS, GAME_REGISTRY } from '@puzzle-arena/shared';
import { PixelButton, PixelCard } from '../ui/primitives.js';
import { CodeInput } from '../ui/game-bits.js';
import { api, ensureGuest } from '../net/socket.js';

export default function Landing(): React.ReactElement {
  const navigate = useNavigate();
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [shake, setShake] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const submit = async (value?: string): Promise<void> => {
    const attempt = (value ?? code).replace(/\s/g, '').toUpperCase();
    if (attempt.length !== 6) {
      fail('Enter all six characters');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await api<{ status: string; error?: string }>(`/api/rooms/${attempt}`);
    setBusy(false);

    // An invalid or finished code never navigates away.
    if (res.status !== 200) return fail('No room with that code');
    if (res.body.status === 'finished' || res.body.status === 'abandoned') {
      return fail('That room has already finished');
    }
    await ensureGuest();
    navigate(`/r/${attempt}`);
  };

  const fail = (message: string): void => {
    setError(message);
    setShake(true);
    setTimeout(() => setShake(false), 200);
  };

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-10 p-6">
      <header className="text-center">
        <h1
          className="font-display text-pa-cyan leading-[1.3]"
          style={{ fontSize: 'clamp(20px, 7vw, 32px)' }}
        >
          PUZZLE
          <br />
          ARENA
        </h1>
        {/* The six games themselves, straight from the registry so this can
            never drift from what the host dashboard actually offers. */}
        <p className="mt-4 max-w-md text-pa-ink-dim">
          {GAME_IDS.map((id) => GAME_REGISTRY[id].title).join(' · ')}
        </p>
      </header>

      <PixelCard className="w-full max-w-md flex flex-col items-center gap-6">
        <span className="font-display text-[10px] uppercase text-pa-ink-dim">Room code</span>
        <div className={shake ? 'pa-shake' : undefined}>
          <CodeInput
            value={code}
            onChange={(v) => {
              setCode(v);
              setError(null);
            }}
            onComplete={(v) => void submit(v)}
            invalid={Boolean(error)}
            autoFocus
          />
        </div>

        {error && (
          <p role="alert" className="text-pa-danger text-[13px] text-center">
            {error}
          </p>
        )}

        <PixelButton
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? 'Checking…' : 'Play'}
        </PixelButton>
      </PixelCard>

      <PixelButton variant="ghost" size="sm" onClick={() => navigate('/admin/login')}>
        <LogIn size={16} strokeWidth={3} className="lucide" />
        Host a room
      </PixelButton>
    </main>
  );
}
