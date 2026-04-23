import { useEffect, useRef } from 'react';

/**
 * Cloudflare Turnstile widget.
 *
 * Site key comes from `VITE_TURNSTILE_SITE_KEY`. When unset (dev or
 * before the prod key is configured) the component renders nothing
 * and `onToken('')` is invoked once so the parent form clears any
 * stale token state. The api-worker mirrors this: with no
 * `TURNSTILE_SECRET_KEY` set it skips verification entirely.
 *
 * The script is loaded once per page; subsequent mounts reuse it.
 */

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'error-callback'?: () => void;
          'expired-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptLoaded: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (scriptLoaded) return scriptLoaded;
  scriptLoaded = new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('failed to load Turnstile script'));
    document.head.appendChild(s);
  });
  return scriptLoaded;
}

export function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!siteKey) {
      onToken('');
      return;
    }
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: (token) => onToken(token),
          'error-callback': () => onToken(''),
          'expired-callback': () => onToken(''),
        });
      })
      .catch((err) => {
        // Script load failed (e.g. tracker blocker). The api-worker
        // fail-opens on its own siteverify network errors, so we mirror
        // that behavior here and let the form proceed without a token.
        console.error('Turnstile script load failed', err);
        onToken('');
      });
    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
    // siteKey is sourced from import.meta.env (stable for the page life)
    // so it intentionally isn't in the dep array.
  }, [onToken]);

  if (!siteKey) return null;
  return <div ref={containerRef} style={{ marginTop: 8 }} />;
}
