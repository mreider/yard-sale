import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// Mock the api module before importing the page so the module graph
// picks up the stubs rather than calling real fetch().
vi.mock('../lib/api.js', () => {
  return {
    ApiError: class ApiError extends Error {
      status: number;
      code: string;
      constructor(status: number, code: string) {
        super(code);
        this.status = status;
        this.code = code;
      }
    },
    api: {
      listTokens: vi.fn().mockResolvedValue({ tokens: [] }),
      createToken: vi.fn(),
      deleteToken: vi.fn(),
    },
  };
});

// Provide a fully-populated AuthState so useAuth returns a confirmed
// user — avoids pulling in real /me fetch during the test.
vi.mock('../lib/auth.js', () => ({
  useAuth: () => ({
    user: {
      id: 'u1',
      username: 'tester',
      email: 'test@example.com',
      emailConfirmed: true,
      isAdmin: false,
      defaultLanguage: 'en',
      defaultTheme: 'conservative',
      createdAt: 0,
    },
    loading: false,
    refresh: vi.fn(),
    setUser: vi.fn(),
  }),
}));

import { api } from '../lib/api.js';
import { TokensPage } from './Tokens.js';

function wrap() {
  return render(
    <MemoryRouter>
      <TokensPage />
    </MemoryRouter>,
  );
}

describe('<TokensPage> create token', () => {
  beforeEach(() => {
    vi.mocked(api.createToken).mockReset();
  });

  /**
   * Regression for: "null is not an object (evaluating
   * 'E.currentTarget.reset()')". The form submit handler was calling
   * `e.currentTarget.reset()` *after* `await api.createToken()`, but
   * React nulls out SyntheticEvent fields once the handler returns —
   * so the ref was null by the time the await resolved. Fix: capture
   * `const form = e.currentTarget` synchronously, then `form.reset()`.
   *
   * We assert the observable consequence: after a successful submit
   * the Name input is cleared (because `form.reset()` ran). With the
   * bug, reset throws, the error is caught into `flash`, and the
   * input keeps whatever was typed. happy-dom doesn't replicate
   * React's null-out of SyntheticEvent fields, so checking the error
   * banner directly wouldn't catch it — but input cleared yes/no is
   * a tight proxy that works across DOM implementations.
   */
  test('clears the form after successful creation', async () => {
    vi.mocked(api.createToken).mockResolvedValue({
      token: {
        id: 't1',
        name: 'wunder',
        prefix: 'yrs_live_A',
        scope: 'write',
        expiresAt: null,
        lastUsedAt: null,
        lastUsedIp: null,
        createdAt: 0,
      },
      secret: 'yrs_live_ABCDEFGHIJ',
    });

    const user = userEvent.setup();
    wrap();

    // New UX: "+ New token" header button reveals the form. Click it.
    await user.click(screen.getByRole('button', { name: /new token/i }));

    const nameInput = screen.getByPlaceholderText(/name/i) as HTMLInputElement;
    await user.type(nameInput, 'wunder');
    expect(nameInput.value).toBe('wunder');

    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(api.createToken).toHaveBeenCalledWith({
        name: 'wunder',
        scope: 'write',
        expiry: 'none',
      });
    });

    // Success banner renders the secret.
    await waitFor(() => {
      expect(screen.getByText(/yrs_live_ABCDEFGHIJ/)).toBeTruthy();
    });

    // Form should collapse back to the "+ New token" button on success.
    // This is the modern equivalent of the old "input cleared" assertion —
    // it proves the form.reset() regression fix still holds, because a
    // throw inside the submit handler would leave the form open.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new token/i })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: /^create$/i })).toBeNull();

    expect(screen.queryByText(/null is not an object/i)).toBeNull();
    expect(screen.queryByText(/failed/i)).toBeNull();
  });

  test('surfaces a flash when createToken rejects', async () => {
    vi.mocked(api.createToken).mockRejectedValue(new Error('network down'));

    const user = userEvent.setup();
    wrap();

    await user.click(screen.getByRole('button', { name: /new token/i }));
    await user.type(screen.getByPlaceholderText(/name/i), 'wunder');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(screen.getByText(/network down/i)).toBeTruthy();
    });
  });
});
