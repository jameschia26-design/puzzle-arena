import * as React from 'react';
import { toast } from 'sonner';
import { Bot, Dice5, Rocket } from 'lucide-react';
import {
  PixelBadge,
  PixelButton,
  PixelCard,
  PixelDialog,
  PixelInput,
  PixelPanel,
  PixelPopover,
  PixelSelect,
  PixelTooltip,
  SegmentedProgress,
} from '../ui/primitives.js';
import { CodeInput, Countdown, PlayerChip, SeatAvatar } from '../ui/game-bits.js';
import { CrtToggle } from '../ui/crt.js';
import { SEAT_COLORS } from '../ui/seat.js';

/**
 * Every primitive in every variant and state on one page — the visual proof
 * surface for the plan's interface verification. Dev only.
 */
export default function UiGallery(): React.ReactElement {
  const [dialog, setDialog] = React.useState(false);
  const [code, setCode] = React.useState('AB3');
  const [select, setSelect] = React.useState('normal');
  const [text, setText] = React.useState('Hello');

  return (
    <main className="min-h-screen p-6 md:p-10 max-w-5xl mx-auto flex flex-col gap-8">
      <header>
        <h1 className="font-display text-pa-cyan" style={{ fontSize: 32, lineHeight: 1.3 }}>
          UI GALLERY
        </h1>
        <p className="text-pa-ink-dim mt-2">
          Square corners, 2px borders, a 4px hard shadow that presses to 2px, a 3px cyan focus
          ring, and Press Start 2P confined to labels and headings.
        </p>
      </header>

      <Section title="Type scale">
        <div className="flex flex-col gap-2">
          <p className="font-display" style={{ fontSize: 32, lineHeight: 1.3 }}>
            Logo 32
          </p>
          <p className="font-display" style={{ fontSize: 18, lineHeight: 1.5 }}>
            Heading 18
          </p>
          <p className="font-display" style={{ fontSize: 14, lineHeight: 1.5 }}>
            Heading 14
          </p>
          <p className="font-display text-[10px] uppercase">Button / label 10</p>
          <p className="font-display text-[24px] tabular">00:42</p>
          <p>Body 15 — all prose, logs and chat use Space Grotesk.</p>
          <p className="tabular" style={{ fontWeight: 600, fontSize: 20 }}>
            Grid digits 1234567890
          </p>
          <p className="text-[12px]">Small print 12</p>
        </div>
      </Section>

      <Section title="Buttons — every variant, size and state">
        <div className="flex flex-col gap-4">
          {(['primary', 'secondary', 'danger', 'ghost'] as const).map((variant) => (
            <div key={variant} className="flex flex-wrap items-center gap-3">
              <PixelButton variant={variant} size="sm">
                {variant} sm
              </PixelButton>
              <PixelButton variant={variant} size="md">
                {variant} md
              </PixelButton>
              <PixelButton variant={variant} size="lg">
                {variant} lg
              </PixelButton>
              <PixelButton variant={variant} disabled>
                disabled
              </PixelButton>
              <PixelButton variant={variant}>
                <Rocket size={16} strokeWidth={3} className="lucide" />
                with icon
              </PixelButton>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Inputs">
        <div className="grid gap-4 md:grid-cols-2">
          <PixelInput label="Text" value={text} onChange={(e) => setText(e.target.value)} />
          <PixelInput label="With error" value="oops" error="Something is wrong" readOnly />
          <PixelSelect
            label="Select"
            value={select}
            onValueChange={setSelect}
            options={[
              { value: 'easy', label: 'Easy' },
              { value: 'normal', label: 'Normal' },
              { value: 'hard', label: 'Hard' },
            ]}
          />
          <PixelSelect
            label="Disabled select"
            value="easy"
            onValueChange={() => undefined}
            options={[{ value: 'easy', label: 'Easy' }]}
            disabled
          />
        </div>
      </Section>

      <Section title="CodeInput">
        <div className="flex flex-col gap-4">
          <CodeInput value={code} onChange={setCode} />
          <CodeInput value="XY" onChange={() => undefined} invalid />
        </div>
      </Section>

      <Section title="Badges and chips">
        <div className="flex flex-wrap items-center gap-3">
          <PixelBadge>default</PixelBadge>
          <PixelBadge tone="success">success</PixelBadge>
          <PixelBadge tone="danger">danger</PixelBadge>
          <PixelBadge tone="amber">amber</PixelBadge>
          <PixelBadge tone="cyan">cyan</PixelBadge>
          <PlayerChip seat={0} displayName="Ada Lovelace" />
          <PlayerChip seat={1} displayName="Turing" isTurn />
          <PlayerChip seat={2} displayName="Hopper" isBot />
          <PlayerChip seat={3} displayName="Offline" connected={false} />
        </div>
      </Section>

      <Section title="Seats — colour is never the only signal">
        <div className="flex flex-wrap gap-3">
          {SEAT_COLORS.map((_, seat) => (
            <SeatAvatar key={seat} seat={seat} displayName={`Player ${seat + 1}`} size={44} />
          ))}
          <SeatAvatar seat={0} displayName="Emoji" avatar="🚀" size={44} />
          <SeatAvatar seat={1} displayName="Bot" isBot size={44} />
        </div>
      </Section>

      <Section title="SegmentedProgress — 10 discrete blocks, never a smooth fill">
        <div className="flex flex-col gap-3 max-w-md">
          {[0, 0.15, 0.4, 0.75, 1].map((v) => (
            <SegmentedProgress key={v} value={v} />
          ))}
          <SegmentedProgress value={0.6} color="var(--color-pa-magenta)" />
        </div>
      </Section>

      <Section title="Countdown">
        <div className="flex flex-wrap items-center gap-6">
          <Countdown endsAt={Date.now() + 5 * 60_000} />
          <Countdown endsAt={Date.now() + 20_000} />
          <Countdown endsAt={null} />
        </div>
      </Section>

      <Section title="Overlays">
        <div className="flex flex-wrap items-center gap-3">
          <PixelButton onClick={() => setDialog(true)}>Open dialog</PixelButton>
          <PixelTooltip content="This is a tooltip explaining why a thing is disabled">
            <PixelButton variant="ghost" disabled>
              Hover me
            </PixelButton>
          </PixelTooltip>
          <PixelPopover trigger={<PixelButton variant="secondary">Settings popover</PixelButton>}>
            <CrtToggle />
          </PixelPopover>
          <PixelButton variant="ghost" onClick={() => toast('COPIED')}>
            Fire a toast
          </PixelButton>
        </div>
        <PixelDialog
          open={dialog}
          onOpenChange={setDialog}
          title="A dialog"
          footer={
            <>
              <PixelButton variant="ghost" onClick={() => setDialog(false)}>
                Cancel
              </PixelButton>
              <PixelButton onClick={() => setDialog(false)}>Confirm</PixelButton>
            </>
          }
        >
          <p>Panels appear with a 2-frame scale snap, never a fade.</p>
        </PixelDialog>
      </Section>

      <Section title="Surfaces">
        <div className="grid gap-4 md:grid-cols-2">
          <PixelCard>
            <p className="font-display text-[12px] mb-2">PixelCard</p>
            <p className="text-[13px] text-pa-ink-dim">
              Hard 4px shadow, 2px border, zero radius.
            </p>
          </PixelCard>
          <PixelPanel title="PixelPanel" action={<PixelBadge tone="cyan">action</PixelBadge>}>
            <p className="text-[13px]">With a header and an action slot.</p>
          </PixelPanel>
        </div>
      </Section>

      <Section title="Icons at 16 and 24, strokeWidth 3">
        <div className="flex items-center gap-4">
          <Bot size={16} strokeWidth={3} className="lucide" />
          <Bot size={24} strokeWidth={3} className="lucide" />
          <Dice5 size={16} strokeWidth={3} className="lucide" />
          <Dice5 size={24} strokeWidth={3} className="lucide" />
        </div>
      </Section>

      <Section title="Contrast floor">
        <div className="grid gap-3 md:grid-cols-2">
          <div className="bg-pa-bg border-2 border-pa-border p-4">
            <p className="text-pa-ink">pa-ink on pa-bg (~14:1)</p>
            <p className="text-pa-ink-dim">pa-ink-dim on pa-bg</p>
          </div>
          <div className="bg-pa-surface border-2 border-pa-border p-4">
            <p className="text-pa-ink">pa-ink on pa-surface</p>
            <p className="text-pa-ink-dim">pa-ink-dim on pa-surface (~4.6:1)</p>
          </div>
        </div>
      </Section>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-[14px] border-b-2 border-pa-border pb-2">{title}</h2>
      {children}
    </section>
  );
}
