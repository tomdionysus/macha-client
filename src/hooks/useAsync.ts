import { useEffect, useState } from 'react';

export interface AsyncState<T> {
  value?: T;
  error?: Error;
  loading: boolean;
}

export function useAsync<T>(factory: () => Promise<T>, dependencies: readonly unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ loading: true });

  useEffect(() => {
    let active = true;
    setState({ loading: true });
    factory()
      .then((value) => active && setState({ value, loading: false }))
      .catch((error: unknown) => {
        if (!active) return;
        setState({ error: error instanceof Error ? error : new Error(String(error)), loading: false });
      });
    return () => {
      active = false;
    };
    // Factory is intentionally controlled by the caller's explicit dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);

  return state;
}
