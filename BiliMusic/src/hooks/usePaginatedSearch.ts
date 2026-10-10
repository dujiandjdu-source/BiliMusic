import { useCallback, useEffect, useRef, useState } from "react";

interface SearchOptions<T> {
  limit: number;
  fetchPage: (query: string, offset: number, limit: number) => Promise<T[]>;
  keyOf: (item: T) => string;
}

/** Discard stale responses and lock pagination before React publishes loading state. */
export const usePaginatedSearch = <T,>({ limit, fetchPage, keyOf }: SearchOptions<T>) => {
  const [results, setResults] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState("");
  const requestRef = useRef({ generation: 0, query: "", offset: 0, busy: false, hasMore: true });
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      requestRef.current.generation += 1;
      requestRef.current.busy = false;
    };
  }, []);

  const requestPage = useCallback(async (query: string, offset: number, pageLimit: number, replace: boolean) => {
    const state = requestRef.current;
    const generation = state.generation;
    state.busy = true;
    setIsLoading(true);
    setError("");
    const current = () => aliveRef.current && generation === requestRef.current.generation;
    try {
      const page = await fetchPage(query, offset, pageLimit);
      if (!current()) return [];
      state.offset = offset;
      state.hasMore = page.length >= pageLimit;
      setHasMore(state.hasMore);
      setResults((previous) => {
        const rows = replace ? [] : [...previous];
        const seen = new Set(rows.map(keyOf));
        for (const item of page) {
          const key = keyOf(item);
          if (!seen.has(key)) { seen.add(key); rows.push(item); }
        }
        return rows;
      });
      return page;
    } catch (reason) {
      if (!current()) return [];
      state.hasMore = false;
      setHasMore(false);
      setError(reason instanceof Error ? reason.message : "搜索失败");
      return [];
    } finally {
      if (current()) { state.busy = false; setIsLoading(false); }
    }
  }, [fetchPage, keyOf]);

  const performSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    const generation = requestRef.current.generation + 1;
    requestRef.current = { generation, query: trimmed, offset: 0, busy: false, hasMore: true };
    setResults([]);
    setError("");
    setHasMore(true);
    setHasSearched(Boolean(trimmed));
    if (!trimmed) { setIsLoading(false); return; }
    await requestPage(trimmed, 0, limit, true);
  }, [limit, requestPage]);

  const loadMore = useCallback(async (query: string, _offset: number, pageLimit: number) => {
    const state = requestRef.current;
    if (state.busy || !state.hasMore || !state.query || state.query !== query.trim()) return [];
    return requestPage(state.query, state.offset + pageLimit, pageLimit, false);
  }, [requestPage]);

  return { results, isLoading, hasMore, hasSearched, error, performSearch, loadMore };
};
