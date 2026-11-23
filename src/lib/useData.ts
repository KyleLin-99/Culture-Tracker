import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { errorMessage } from './supabase';

/**
 * Loads data when the screen gains focus (so going back shows fresh data),
 * and again whenever `key` changes (e.g. the item id in the URL).
 * Milestone 2 replaces these network reads with reads from the local database.
 */
export function useData<T>(load: () => Promise<T>, key = '') {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Always call the latest `load` without re-subscribing on every render.
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(async () => {
    try {
      setError(null);
      setData(await loadRef.current());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
      // `key` isn't read here on purpose: listing it re-runs the load when it changes.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reload, key]),
  );

  return { data, error, loading, reload };
}
