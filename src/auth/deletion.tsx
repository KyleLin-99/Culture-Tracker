import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

import { useAuth } from '@/auth/AuthProvider';
import { myDeletionRequest } from '@/lib/api';

type State = {
  /** True until we know whether this person asked to delete their account. */
  loading: boolean;
  /** When the account will be deleted, or null if no deletion is pending. */
  purgeAfter: string | null;
  refresh: () => Promise<void>;
};

const Ctx = createContext<State>({ loading: false, purgeAfter: null, refresh: async () => {} });

/** Knows whether the signed-in person has a deletion pending (they then see only the "keep or delete" screen). */
export function DeletionProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  // Remember which person the answer is for, so a different sign-in starts as "loading".
  const [known, setKnown] = useState<{ userId: string; purgeAfter: string | null } | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const r = await myDeletionRequest();
      setKnown({ userId, purgeAfter: r?.purge_after ?? null });
    } catch {
      setKnown({ userId, purgeAfter: null }); // offline: never lock anyone out
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let live = true;
    myDeletionRequest()
      .then((r) => live && setKnown({ userId, purgeAfter: r?.purge_after ?? null }))
      .catch(() => live && setKnown({ userId, purgeAfter: null })); // offline: never lock anyone out
    return () => {
      live = false;
    };
  }, [userId]);

  const loading = !!userId && known?.userId !== userId;
  const purgeAfter = known?.userId === userId ? known.purgeAfter : null;
  return <Ctx.Provider value={{ loading, purgeAfter, refresh }}>{children}</Ctx.Provider>;
}

export const useDeletion = () => useContext(Ctx);
