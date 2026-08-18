import * as React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowLeft, Trash2, Zap } from 'lucide-react';
import {
  PixelBadge,
  PixelButton,
  PixelCard,
  PixelInput,
  PixelPanel,
  PixelSelect,
} from '../ui/primitives.js';
import { api } from '../net/socket.js';

interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  isDefault: boolean;
  keyLast4: string;
  timeoutMs: number;
}

interface TaskBinding {
  task: string;
  providerId: string | null;
}

const TASK_LABELS: Record<string, string> = {
  wordsearch_theme: 'Word Search themes',
  mystery_flavour: 'Mystery flavour text',
  puzzle_title: 'Puzzle titles',
};

export default function AdminAi(): React.ReactElement {
  const navigate = useNavigate();
  const [providers, setProviders] = React.useState<Provider[]>([]);
  const [tasks, setTasks] = React.useState<TaskBinding[]>([]);
  const [testing, setTesting] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({
    name: '',
    baseUrl: 'https://api.minimax.io/v1',
    apiKey: '',
    model: 'MiniMax-M3',
    isDefault: false,
  });
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    const res = await api<{ providers: Provider[]; tasks: TaskBinding[] }>(
      '/api/admin/ai/providers',
    );
    if (res.status === 401) {
      navigate('/admin/login');
      return;
    }
    setProviders(res.body.providers ?? []);
    setTasks(res.body.tasks ?? []);
  }, [navigate]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const addProvider = async (): Promise<void> => {
    setError(null);
    const res = await api<{ error?: string }>('/api/admin/ai/providers', {
      method: 'POST',
      body: JSON.stringify(form),
    });
    if (res.status !== 200) {
      setError(res.body?.error ?? 'Could not add that provider');
      return;
    }
    setForm((f) => ({ ...f, name: '', apiKey: '' }));
    await refresh();
    toast('Provider added');
  };

  const test = async (id: string): Promise<void> => {
    setTesting(id);
    const res = await api<{ ok: boolean; latencyMs: number; error?: string }>(
      `/api/admin/ai/providers/${id}/test`,
      { method: 'POST' },
    );
    setTesting(null);
    if (res.body.ok) toast(`OK — ${res.body.latencyMs}ms`);
    else toast(`Failed: ${String(res.body.error).slice(0, 120)}`);
  };

  const bind = async (task: string, providerId: string): Promise<void> => {
    await api(`/api/admin/ai/tasks/${task}`, {
      method: 'PUT',
      body: JSON.stringify({ providerId: providerId === 'none' ? null : providerId }),
    });
    await refresh();
    toast('Task rebound');
  };

  const remove = async (id: string): Promise<void> => {
    await api(`/api/admin/ai/providers/${id}`, { method: 'DELETE' });
    await refresh();
  };

  return (
    <main className="min-h-screen p-4 md:p-8 max-w-5xl mx-auto flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="font-display text-[18px]">AI providers</h1>
        <Link to="/admin">
          <PixelButton variant="ghost" size="sm">
            <ArrowLeft size={16} strokeWidth={3} className="lucide" />
            Back
          </PixelButton>
        </Link>
      </header>

      <p className="text-[13px] text-pa-ink-dim">
        Every provider is treated as an OpenAI-compatible <code>/chat/completions</code> endpoint.
        Adding one requires no code changes. Keys are encrypted at rest and never returned — only
        the last four characters are shown.
      </p>

      <PixelPanel title="Configured providers">
        {providers.length === 0 ? (
          <p className="text-[13px] text-pa-ink-dim">None yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {providers.map((p) => (
              <li key={p.id}>
                <PixelCard className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-display text-[12px]">{p.name}</span>
                      {p.isDefault && <PixelBadge tone="cyan">Default</PixelBadge>}
                      {!p.enabled && <PixelBadge tone="danger">Disabled</PixelBadge>}
                    </div>
                    <p className="text-[12px] text-pa-ink-dim truncate">
                      {p.model} · {p.baseUrl} · key ••••{p.keyLast4}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <PixelButton
                      variant="secondary"
                      size="sm"
                      disabled={testing === p.id}
                      onClick={() => void test(p.id)}
                    >
                      <Zap size={14} strokeWidth={3} className="lucide" />
                      {testing === p.id ? 'Testing…' : 'Test'}
                    </PixelButton>
                    <PixelButton variant="danger" size="sm" onClick={() => void remove(p.id)}>
                      <Trash2 size={14} strokeWidth={3} className="lucide" />
                    </PixelButton>
                  </div>
                </PixelCard>
              </li>
            ))}
          </ul>
        )}
      </PixelPanel>

      <PixelPanel title="Task routing">
        <div className="grid gap-4 md:grid-cols-3">
          {tasks.map((t) => (
            <PixelSelect
              key={t.task}
              label={TASK_LABELS[t.task] ?? t.task}
              value={t.providerId ?? 'none'}
              onValueChange={(v) => void bind(t.task, v)}
              options={[
                { value: 'none', label: 'Use default' },
                ...providers.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          ))}
        </div>
        <p className="mt-4 text-[12px] text-pa-ink-dim">
          If a bound provider fails, the room still starts using bundled fallback content, with a
          warning in the server log.
        </p>
      </PixelPanel>

      <PixelPanel title="Add a provider">
        <div className="grid gap-4 md:grid-cols-2">
          <PixelInput
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <PixelInput
            label="Model"
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
          />
          <PixelInput
            label="Base URL"
            value={form.baseUrl}
            onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
          />
          <PixelInput
            label="API key"
            type="password"
            value={form.apiKey}
            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
          />
        </div>
        <label className="mt-4 flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.isDefault}
            onChange={(e) => setForm({ ...form, isDefault: e.target.checked })}
            className="w-5 h-5 accent-[var(--color-pa-cyan)]"
          />
          <span className="text-[13px]">Make this the default provider</span>
        </label>
        {error && (
          <p role="alert" className="mt-4 text-pa-danger text-[13px]">
            {error}
          </p>
        )}
        <div className="mt-6">
          <PixelButton onClick={() => void addProvider()}>Add provider</PixelButton>
        </div>
      </PixelPanel>
    </main>
  );
}
