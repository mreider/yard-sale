import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from 'react';
import { ApiError, type PublicUser, api } from './api.js';

interface AuthState {
  user: PublicUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setUser: (u: PublicUser | null) => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  // useCallback so the reference is stable across re-renders. Without
  // this, any consumer that lists `refresh` in a useEffect dep array
  // (e.g. Confirm.tsx) re-fires its effect every time AuthProvider
  // re-renders — which happens as soon as refresh() itself flips user
  // state, producing a feedback loop. setUser / setLoading from
  // useState are already reference-stable.
  const refresh = useCallback(async () => {
    try {
      const { user } = await api.me();
      setUser(user);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setUser(null);
      else console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return <Ctx.Provider value={{ user, loading, refresh, setUser }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const s = useContext(Ctx);
  if (!s) throw new Error('useAuth must be used inside <AuthProvider>');
  return s;
}
