import * as React from 'react';
import { motion } from 'framer-motion';
import { Share, X } from 'lucide-react';
import { PixelButton } from './primitives.js';
import { snapIn, useReducedMotion } from './motion.js';

const DISMISSED_KEY = 'pa:install-dismissed';

/** Chrome/Edge fire this instead of showing their own banner once we preventDefault. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isStandalone = (): boolean =>
  window.matchMedia('(display-mode: standalone)').matches ||
  // iOS Safari predates the display-mode media query for home-screen apps.
  (navigator as { standalone?: boolean }).standalone === true;

const isIos = (): boolean =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS 13+ reports itself as a Mac; the touch points give it away.
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isSafari = (): boolean =>
  /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(navigator.userAgent);

/**
 * Offers to install the app to the home screen.
 *
 * Two very different platforms hide behind one banner. Chrome hands us a
 * `beforeinstallprompt` event we can fire on demand, so there the button really
 * installs. iOS Safari has no such API at all — the only route is Share → Add
 * to Home Screen — so there the banner can only teach the gesture.
 */
export function InstallPrompt(): React.ReactElement | null {
  const reduced = useReducedMotion();
  const [deferred, setDeferred] = React.useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(
    () => localStorage.getItem(DISMISSED_KEY) === '1',
  );

  React.useEffect(() => {
    if (isStandalone()) return;

    const onPrompt = (event: Event): void => {
      // Suppress the browser's own mini-infobar and keep the event for later.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);

    const onInstalled = (): void => {
      setDeferred(null);
      localStorage.setItem(DISMISSED_KEY, '1');
    };
    window.addEventListener('appinstalled', onInstalled);

    // iOS never fires the event, so offer the manual route instead — but only
    // in Safari, which is the only iOS browser that can install anything.
    if (isIos() && isSafari()) setShowIosHelp(true);

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const close = (): void => {
    setDismissed(true);
    localStorage.setItem(DISMISSED_KEY, '1');
  };

  const install = async (): Promise<void> => {
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    setDeferred(null);
    if (outcome === 'accepted') localStorage.setItem(DISMISSED_KEY, '1');
  };

  if (dismissed || isStandalone()) return null;
  if (!deferred && !showIosHelp) return null;

  return (
    <motion.div
      {...snapIn(reduced)}
      role="dialog"
      aria-label="Install Puzzle Arena"
      /*
       * Above the room's bottom tab bar, and clear of the iPhone home
       * indicator. Fixed rather than sticky so it does not shift the board.
       */
      className="fixed inset-x-2 bottom-2 z-[60] border-2 border-pa-cyan bg-pa-surface pa-shadow p-3
                 sm:left-auto sm:right-4 sm:w-[360px]"
      style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex items-start gap-3">
        <img src="/icon-192.png" alt="" width={40} height={40} className="shrink-0 border-2 border-pa-border" />
        <div className="min-w-0 flex-1">
          <p className="font-display text-[11px] uppercase">Install Puzzle Arena</p>
          <p className="mt-1 text-[12px] text-pa-ink-dim">
            {showIosHelp ? (
              <>
                Tap <Share size={12} strokeWidth={3} className="lucide inline align-[-2px]" /> Share,
                then <strong className="text-pa-ink">Add to Home Screen</strong>.
              </>
            ) : (
              'Play full screen from your home screen, with no browser bars in the way.'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Dismiss"
          className="grid min-h-[44px] min-w-[44px] shrink-0 cursor-pointer place-items-center border-2 border-pa-border"
        >
          <X size={14} strokeWidth={3} className="lucide" />
        </button>
      </div>

      {deferred && (
        <div className="mt-3 flex gap-2">
          <PixelButton size="sm" onClick={() => void install()}>
            Install
          </PixelButton>
          <PixelButton size="sm" variant="ghost" onClick={close}>
            Not now
          </PixelButton>
        </div>
      )}
    </motion.div>
  );
}
