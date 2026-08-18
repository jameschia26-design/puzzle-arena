import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import * as Dialog from '@radix-ui/react-dialog';
import * as Select from '@radix-ui/react-select';
import * as Tooltip from '@radix-ui/react-tooltip';
import * as Popover from '@radix-ui/react-popover';
import { motion } from 'framer-motion';
import { Check, ChevronDown, X } from 'lucide-react';
import { Toaster as SonnerToaster } from 'sonner';
import { cn } from './cn.js';
import { snapIn, useReducedMotion } from './motion.js';

/* ------------------------------------------------------------------ */
/* PixelButton                                                         */
/* ------------------------------------------------------------------ */

const buttonVariants = cva(
  // Disabled has to *look* disabled: without this a greyed-out action reads as
  // live and a player taps a button that will never respond.
  'font-display uppercase inline-flex items-center justify-center gap-2 border-2 pa-shadow pa-press select-none cursor-pointer ' +
    'disabled:cursor-not-allowed disabled:opacity-40 disabled:saturate-50',
  {
    variants: {
      variant: {
        primary: 'bg-pa-cyan text-pa-bg border-pa-cyan',
        secondary: 'bg-pa-violet text-pa-ink border-pa-violet',
        danger: 'bg-pa-danger text-pa-bg border-pa-danger',
        ghost: 'bg-pa-surface text-pa-ink border-pa-border',
      },
      size: {
        // Every interactive target is at least 44px tall.
        sm: 'text-[10px] px-3 min-h-[44px]',
        md: 'text-[10px] px-4 min-h-[48px]',
        lg: 'text-[12px] px-6 min-h-[56px]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface PixelButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const PixelButton = React.forwardRef<HTMLButtonElement, PixelButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
PixelButton.displayName = 'PixelButton';

/* ------------------------------------------------------------------ */
/* Surfaces                                                            */
/* ------------------------------------------------------------------ */

export function PixelCard({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('bg-pa-surface border-2 border-pa-border pa-shadow p-4', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function PixelPanel({
  className,
  title,
  action,
  children,
}: {
  className?: string;
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.section
      {...snapIn(reduced)}
      className={cn('bg-pa-surface border-2 border-pa-border pa-shadow', className)}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b-2 border-pa-border px-4 py-3">
          {title ? <h2 className="font-display text-[14px] leading-6">{title}</h2> : <span />}
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </motion.section>
  );
}

export function PixelBadge({
  children,
  tone = 'default',
  className,
}: {
  children: React.ReactNode;
  tone?: 'default' | 'success' | 'danger' | 'amber' | 'cyan';
  className?: string;
}) {
  const tones: Record<string, string> = {
    default: 'border-pa-border text-pa-ink-dim',
    success: 'border-pa-success text-pa-success',
    danger: 'border-pa-danger text-pa-danger',
    amber: 'border-pa-amber text-pa-amber',
    cyan: 'border-pa-cyan text-pa-cyan',
  };
  return (
    <span
      className={cn(
        'font-display text-[10px] uppercase border-2 px-2 py-1 inline-flex items-center gap-1',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Inputs                                                              */
/* ------------------------------------------------------------------ */

export const PixelInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { label?: string; error?: string }
>(({ className, label, error, id, ...props }, ref) => {
  const generated = React.useId();
  const inputId = id ?? generated;
  return (
    <div className="flex flex-col gap-2">
      {label && (
        <label htmlFor={inputId} className="font-display text-[10px] uppercase text-pa-ink-dim">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={cn(
          'bg-pa-bg border-2 border-pa-border text-pa-ink px-3 min-h-[48px] w-full',
          'placeholder:text-pa-ink-dim/60',
          error && 'border-pa-danger',
          className,
        )}
        {...props}
      />
      {error && <p className="text-pa-danger text-[12px]">{error}</p>}
    </div>
  );
});
PixelInput.displayName = 'PixelInput';

export function PixelSelect({
  value,
  onValueChange,
  options,
  label,
  className,
  disabled,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: { value: string; label: string }[];
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {label && <span className="font-display text-[10px] uppercase text-pa-ink-dim">{label}</span>}
      <Select.Root value={value} onValueChange={onValueChange} disabled={disabled}>
        <Select.Trigger
          className={cn(
            'bg-pa-bg border-2 border-pa-border text-pa-ink px-3 min-h-[48px]',
            'flex items-center justify-between gap-2 font-display text-[10px] uppercase',
            'disabled:opacity-45 disabled:cursor-not-allowed',
            className,
          )}
        >
          <Select.Value />
          <Select.Icon>
            <ChevronDown size={16} strokeWidth={3} className="lucide" />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            position="popper"
            sideOffset={4}
            className="bg-pa-surface border-2 border-pa-border pa-shadow z-50"
          >
            <Select.Viewport className="p-1">
              {options.map((option) => (
                <Select.Item
                  key={option.value}
                  value={option.value}
                  className={cn(
                    'font-display text-[10px] uppercase px-3 py-3 cursor-pointer outline-none',
                    'data-[highlighted]:bg-pa-surface-2 data-[highlighted]:text-pa-cyan',
                    'flex items-center justify-between gap-3',
                  )}
                >
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator>
                    <Check size={14} strokeWidth={3} className="lucide" />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog, tooltip, popover                                            */
/* ------------------------------------------------------------------ */

export function PixelDialog({
  open,
  onOpenChange,
  title,
  children,
  footer,
  closable = true,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  closable?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* No fade: panels appear with a 2-frame scale snap. */}
        <Dialog.Overlay className="fixed inset-0 bg-pa-shadow/80 z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2"
          onEscapeKeyDown={(e) => !closable && e.preventDefault()}
          onPointerDownOutside={(e) => !closable && e.preventDefault()}
        >
          <motion.div
            {...snapIn(reduced)}
            className="bg-pa-surface border-2 border-pa-border pa-shadow"
          >
            <header className="flex items-center justify-between border-b-2 border-pa-border px-4 py-3">
              <Dialog.Title className="font-display text-[14px]">{title}</Dialog.Title>
              {closable && (
                <Dialog.Close aria-label="Close" className="p-2 cursor-pointer">
                  <X size={16} strokeWidth={3} className="lucide" />
                </Dialog.Close>
              )}
            </header>
            <div className="p-4 max-h-[70vh] overflow-y-auto">{children}</div>
            {footer && (
              <footer className="flex flex-wrap justify-end gap-2 border-t-2 border-pa-border p-4">
                {footer}
              </footer>
            )}
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function PixelTooltip({
  content,
  children,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
}) {
  if (!content) return <>{children}</>;
  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        {/* asChild would swallow a disabled button's pointer events, so wrap. */}
        <Tooltip.Trigger asChild>
          <span className="inline-flex">{children}</span>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            sideOffset={6}
            className="bg-pa-surface-2 border-2 border-pa-border pa-shadow-sm px-3 py-2 text-[12px] max-w-[280px] z-50"
          >
            {content}
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}

export function PixelPopover({
  trigger,
  children,
}: {
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          sideOffset={6}
          align="end"
          className="bg-pa-surface border-2 border-pa-border pa-shadow p-4 z-50 w-[260px]"
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/* ------------------------------------------------------------------ */
/* SegmentedProgress                                                   */
/* ------------------------------------------------------------------ */

/** Ten discrete blocks, never a smooth fill. */
export function SegmentedProgress({
  value,
  color = 'var(--color-pa-cyan)',
  className,
  label,
}: {
  value: number;
  color?: string;
  className?: string;
  label?: string;
}) {
  const filled = Math.round(Math.max(0, Math.min(1, value)) * 10);
  return (
    <div
      className={cn('flex gap-[2px]', className)}
      role="progressbar"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? 'Progress'}
    >
      {Array.from({ length: 10 }, (_, i) => (
        <span
          key={i}
          className="h-3 flex-1 border-2"
          style={{
            backgroundColor: i < filled ? color : 'transparent',
            borderColor: i < filled ? color : 'var(--color-pa-border)',
          }}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Toaster                                                             */
/* ------------------------------------------------------------------ */

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: 'var(--color-pa-surface)',
          border: '2px solid var(--color-pa-border)',
          borderRadius: 0,
          boxShadow: '4px 4px 0 var(--color-pa-shadow)',
          color: 'var(--color-pa-ink)',
          fontFamily: 'var(--font-body)',
        },
      }}
    />
  );
}
