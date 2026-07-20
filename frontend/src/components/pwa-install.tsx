'use client';

import { useEffect, useState } from 'react';

// Registers the service worker and shows an "Add to Home Screen" banner
// when the browser fires beforeinstallprompt (Chrome/Edge on Android & desktop).
export function PwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<Event | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const onPrompt = (e: Event) => {
      e.preventDefault();
      // Don't nag users who dismissed it recently (7 days).
      const snoozedAt = Number(localStorage.getItem('pwa-install-snoozed') || 0);
      if (Date.now() - snoozedAt < 7 * 24 * 60 * 60 * 1000) return;
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  if (!deferredPrompt || dismissed) return null;

  const install = async () => {
    const promptEvent = deferredPrompt as Event & { prompt: () => Promise<void> };
    setDeferredPrompt(null);
    await promptEvent.prompt();
  };

  const snooze = () => {
    localStorage.setItem('pwa-install-snoozed', String(Date.now()));
    setDismissed(true);
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-border bg-card p-3 shadow-lg">
      <img src="/icons/icon-192.png" alt="" className="h-10 w-10 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">Install JSSF App</p>
        <p className="text-xs text-muted-foreground">Add to your home screen for quick access</p>
      </div>
      <button
        onClick={install}
        className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground"
      >
        Install
      </button>
      <button
        onClick={snooze}
        aria-label="Dismiss"
        className="px-1 text-lg leading-none text-muted-foreground"
      >
        ×
      </button>
    </div>
  );
}
