import { z } from 'zod';
import { isValidEmail } from '../validation/email.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../validation/password.js';
import { USERNAME_RE } from '../validation/username.js';

export const SignupBody = z.object({
  email: z.string().refine(isValidEmail, 'invalid_email'),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  username: z.string().regex(USERNAME_RE).optional(),
  /** Required during invite-only beta unless the email matches BOOTSTRAP_ADMIN_EMAIL. */
  inviteCode: z.string().min(4).max(64).optional(),
  /** Cloudflare Turnstile token. Required iff TURNSTILE_SECRET_KEY is set on the worker. */
  turnstileToken: z.string().max(2048).optional(),
});
export type SignupBody = z.infer<typeof SignupBody>;

export const LoginBody = z.object({
  email: z.string().refine(isValidEmail, 'invalid_email'),
  password: z.string().min(1).max(PASSWORD_MAX_LENGTH),
});
export type LoginBody = z.infer<typeof LoginBody>;

export const ConfirmQuery = z.object({
  token: z.string().min(10).max(120),
});
export type ConfirmQuery = z.infer<typeof ConfirmQuery>;

export const ForgotBody = z.object({
  email: z.string().refine(isValidEmail, 'invalid_email'),
});
export type ForgotBody = z.infer<typeof ForgotBody>;

export const ResetBody = z.object({
  token: z.string().min(10).max(120),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
});
export type ResetBody = z.infer<typeof ResetBody>;
