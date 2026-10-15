import { useEffect, useState, useCallback } from 'react';
import { api } from './api';

/** 목록 조회 공통. 로딩·오류를 매 화면에서 다시 쓰지 않게 합니다. */
export function useApi<T>(path: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(() => {
    setLoading(true);
    api<T>(path)
      .then((d) => { setData(d); setError(null); })
      .catch(setError)
      .finally(() => setLoading(false));
  }, [path]);

  useEffect(reload, [reload, ...deps]);
  return { data, error, loading, reload };
}
