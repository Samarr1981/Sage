'use client';

import { useEffect } from 'react';

export function SaveStatusToast({ message, tone, onDismiss }: {
  message: string;
  tone: 'error' | 'warning';
  onDismiss: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 8000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const color = tone === 'error' ? 'var(--red)' : 'var(--yellow)';

  return (
    <div
      role="alert"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%-2rem)] max-w-md px-4 py-3 rounded-lg border text-sm flex items-start gap-3 animate-fade-in"
      style={{ borderColor: color, background: 'var(--surface)', color: 'var(--text-primary)' }}
    >
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1.5" style={{ background: color }} />
      <p className="flex-1 leading-relaxed">{message}</p>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors"
      >
        ✕
      </button>
    </div>
  );
}
