import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import type { Membership } from '@/domain/types';
import { supabase } from '@/lib/supabase';
import { clearLocalCopy, unsentChangeCount } from '@/offline/engine';

import { checkLabSwitch, pickCurrentLab, sortByLabName } from './currentLab';

/** Remembers which lab you were working in (a convenience; fine if storage is unavailable). */
const CURRENT_LAB = 'current-lab';

type AuthState = {
  /** True until the stored session and membership have been checked. */
  loading: boolean;
  session: Session | null;
  /** The lab you're working in; null until you create or join one. */
  membership: Membership | null;
  /** Every lab you belong to, by name. */
  memberships: Membership[];
  /** Reloads your labs; pass an id to switch to that lab (e.g. one just joined). */
  reloadMembership: (selectId?: string) => Promise<void>;
  /**
   * Works in another lab. On a phone this replaces its local copy, so it refuses
   * while changes are still waiting to be sent.
   */
  switchLab: (accountId: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef<string | null | undefined>(undefined);

  const loadMembership = useCallback(async (s: Session | null, selectId?: string) => {
    if (!s) {
      setMemberships([]);
      setCurrentId(null);
      return;
    }
    const { data, error } = await supabase
      .from('members')
      .select('account_id, user_id, role, initials, accounts(name)')
      .eq('user_id', s.user.id);
    if (error) console.warn('Could not load memberships', error.message);
    const list = sortByLabName((data as Membership[] | null) ?? []);
    const saved = selectId ?? (await AsyncStorage.getItem(CURRENT_LAB).catch(() => null));
    const pick = pickCurrentLab(list, saved);
    setMemberships(list);
    setCurrentId(pick?.account_id ?? null);
    if (pick) await AsyncStorage.setItem(CURRENT_LAB, pick.account_id).catch(() => {});
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

  const membership = memberships.find((m) => m.account_id === currentId) ?? null;

  const value: AuthState = {
    loading,
    session,
    membership,
    memberships,
    reloadMembership: (selectId?: string) => loadMembership(session, selectId),
    switchLab: async (accountId: string) => {
      if (!(await checkLabSwitch(accountId, currentId, unsentChangeCount))) return;
      setCurrentId(accountId);
      await AsyncStorage.setItem(CURRENT_LAB, accountId).catch(() => {});
    },
    signOut: async () => {
      await supabase.auth.signOut();
      await clearLocalCopy(); // the lab's records don't stay on a signed-out phone
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
