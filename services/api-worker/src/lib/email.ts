import type { Env } from '../env.js';

interface SendArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface SendResult {
  stubbed: boolean;
  id?: string;
  /** Dev-mode aid: the outbound text, returned to the caller so tests can assert on it. */
  debug?: { subject: string; text: string };
}

/**
 * Send a transactional email via Resend (https://resend.com).
 *
 * - If `RESEND_API_KEY` is unset, falls back to a stub that logs the message and
 *   returns it in the response. this is the default for local dev.
 * - `EMAIL_FROM` is the sender identity. During beta we use `onboarding@resend.dev`
 *   (Resend's testing sender, no domain verification needed). In production we
 *   switch to `noreply@send.yrdsl.app` once the DNS records are verified.
 */
export async function sendMail(env: Env, args: SendArgs): Promise<SendResult> {
  if (!env.RESEND_API_KEY) {
    console.log(`[mail-stub] to=${args.to} subject=${args.subject}\n${args.text}`);
    return { stubbed: true, debug: { subject: args.subject, text: args.text } };
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [args.to],
      subject: args.subject,
      text: args.text,
      html: args.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`resend send failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { id?: string };
  return { stubbed: false, id: data.id };
}
