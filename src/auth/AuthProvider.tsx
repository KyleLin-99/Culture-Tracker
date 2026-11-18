import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import type { Membership } from '@/domain/types';
import { supabase } from '@/lib/supabase';

type AuthState = {
  /** True until the stored session and membership have been checked. */
  loading: boolean;
  session: Session | null;
  /** The lab account the user belongs to; null until onboarding is done. */
  membership: Membership | null;
  reloadMembership: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef<string | null | undefined>(undefined);

  const loadMembership = useCallback(async (s: Session | null) => {
    if (!s) {
      setMembership(null);
      return;
    }
    const { data, error } = await supabase
      .from('members')
      .select('account_id, user_id, role, initials, accounts(name)')
      .eq('user_id', s.user.id)
      .maybeSingle();
    if (error) console.warn('Could not load membership', error.message);
    setMembership((data as Membership | null) ?? null);
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      userIdRef.current = data.session?.user.id ?? null;
      setSession(data.session);
      await loadMembership(data.session);
      if (active) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      const userId = s?.user.id ?? null;
      if (userId === userIdRef.current) return; // token refresh etc.: same user
      userIdRef.current = userId;
      // Hold the splash screen until we know whether this user has a lab account,
      // so a fresh sign-in doesn't flash the onboarding screen.
      setLoading(true);
      // Don't await Supabase calls inside this callback (it can deadlock the client).
      setTimeout(async () => {
        await loadMembership(s);
        if (active) setLoading(false);
      }, 0);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadMembership]);

  const value: AuthState = {
    loading,
    session,
    membership,
    reloadMembership: () => loadMembership(session),
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/** The signed-in member. Only call from screens inside the (app) group. */
export function useMembership(): Membership {
  const { membership } = useAuth();
  if (!membership) throw new Error('No lab account yet');
  return membership;
}
