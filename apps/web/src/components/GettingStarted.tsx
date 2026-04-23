import { useState } from 'react';
import { Link } from 'react-router-dom';
import { type ApiSale, type PublicUser, api } from '../lib/api.js';

/**
 * Progress card shown on /sales until the new user finishes getting
 * started. Steps are strictly linear — only the first incomplete step
 * shows its action button, so there's never ambiguity about "what do
 * I do next." Auto-hides once all complete; user can also dismiss
 * early via the × button.
 *
 * Completion state for the first four steps is derived from server
 * data (user + sales). "Share the link" has no server-side signal, so
 * we mark it done when the user clicks the "Copy blurb" action. Both
 * the explicit dismissal and the "shared" flag persist in localStorage
 * so the card doesn't reappear on later visits.
 */

const DISMISS_KEY = 'yrdsl:onboarding-dismissed';
const SHARED_KEY = 'yrdsl:onboarding-shared';

export function GettingStarted({
  user,
  sales,
}: {
  user: PublicUser;
  sales: ApiSale[];
}) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === 'true');
  const [shared, setShared] = useState(() => localStorage.getItem(SHARED_KEY) === 'true');
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const firstPublished = sales.find((s) => s.publishedAt);
  const done = {
    signedUp: true,
    confirmed: user.emailConfirmed,
    hasSale: sales.length > 0,
    hasPublished: !!firstPublished,
    shared,
  };
  const allDone = Object.values(done).every(Boolean);

  if (dismissed || allDone) return null;

  // Index of the first incomplete step — that one gets the action.
  const stepsCompleted: boolean[] = [
    done.signedUp,
    done.confirmed,
    done.hasSale,
    done.hasPublished,
    done.shared,
  ];
  const activeIdx = stepsCompleted.findIndex((c) => !c);

  async function resend() {
    setBusy(true);
    setFlash(null);
    try {
      const r = await api.resendConfirmation();
      setFlash(
        r.devConfirmUrl
          ? `Dev stub. Confirm URL: ${r.devConfirmUrl}`
          : 'Confirmation email re-sent.',
      );
    } catch (err) {
      setFlash(err instanceof Error ? err.message : 'Failed to resend.');
    } finally {
      setBusy(false);
    }
  }

  async function copyShareBlurb() {
    if (!firstPublished) return;
    const origin = window.location.origin;
    const url = `${origin}/${user.username}/${firstPublished.slug}`;
    const blurb = `Cleaning out some stuff. First crack for anyone interested:\n${url}`;
    try {
      await navigator.clipboard.writeText(blurb);
      localStorage.setItem(SHARED_KEY, 'true');
      setShared(true);
      setFlash('Copied. Paste it anywhere you share things.');
    } catch {
      setFlash('Could not copy — select and copy the URL manually.');
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
  }

  return (
    <div className="card getting-started">
      <div className="gs-head">
        <h2>Getting started</h2>
        <button type="button" className="gs-dismiss" onClick={dismiss} aria-label="Dismiss">
          ×
        </button>
      </div>
      <ol className="gs-steps">
        <Step done={done.signedUp} label="Account created" />
        <Step
          done={done.confirmed}
          label="Confirm your email"
          action={
            !done.confirmed && activeIdx === 1 ? (
              <button type="button" className="btn ghost tiny" onClick={resend} disabled={busy}>
                {busy ? 'Resending…' : 'Resend link'}
              </button>
            ) : null
          }
          hint={!done.confirmed ? `We sent a link to ${user.email}.` : null}
        />
        <Step
          done={done.hasSale}
          label="Create your first sale"
          action={
            !done.hasSale && activeIdx === 2 ? (
              <span className="gs-hint">Use the form below ↓</span>
            ) : null
          }
        />
        <Step
          done={done.hasPublished}
          label="Publish a sale"
          action={
            !done.hasPublished && activeIdx === 3 && sales[0] ? (
              <Link to={`/sales/${sales[0].id}`} className="btn ghost tiny">
                Open "{sales[0].siteName}" →
              </Link>
            ) : null
          }
        />
        <Step
          done={done.shared}
          label="Share the link"
          action={
            !done.shared && activeIdx === 4 ? (
              <button type="button" className="btn ghost tiny" onClick={copyShareBlurb}>
                Copy share blurb
              </button>
            ) : null
          }
        />
      </ol>
      {flash && <div className="gs-flash">{flash}</div>}
    </div>
  );
}

function Step({
  done,
  label,
  action,
  hint,
}: {
  done: boolean;
  label: string;
  action?: React.ReactNode;
  hint?: string | null;
}) {
  return (
    <li className={`gs-step ${done ? 'done' : ''}`}>
      <span className="gs-check" aria-hidden="true">
        {done ? '✓' : '○'}
      </span>
      <span className="gs-label">{label}</span>
      {hint && <span className="gs-hint">{hint}</span>}
      {action && <span className="gs-action">{action}</span>}
    </li>
  );
}
