import { useCallback, useState } from "react";
import { BilibiliVideoInfo } from "../types";
import { searchVideos } from "../services/bilibiliService";
import { SearchProvider, SearchResultItem } from "./useSearchProvider";

const LIMIT = 20;

export interface BilibiliSearchProviderExtended extends SearchProvider {
  performSearch: (query: string) => Promise<void>;
  hasSearched: boolean;
  results: BilibiliVideoInfo[];
  error: string;
}

export const useBilibiliSearchProvider = (): BilibiliSearchProviderExtended => {
  const [results, setResults] = useState<BilibiliVideoInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState("");

  const performSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setHasSearched(false);
      setError("");
      return;
    }

    setIsLoading(true);
    setHasSearched(true);
    setResults([]);
    setHasMore(true);
    setError("");

    try {
      const searchResult = await searchVideos(trimmed, 1, LIMIT);
      setResults(searchResult.list || []);
      setHasMore((searchResult.list || []).length >= LIMIT);
      if (searchResult.code && searchResult.code !== 0) {
        setError(searchResult.message || "B 站搜索失败");
      }
    } catch (reason) {
      console.error("Bilibili search failed:", reason);
      setHasMore(false);
      setError(reason instanceof Error ? reason.message : "B 站搜索失败");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMore = useCallback(
    async (
      query: string,
      offset: number,
      limit: number,
    ): Promise<SearchResultItem[]> => {
      if (isLoading || !hasMore) return [];

      setIsLoading(true);
      try {
        const page = Math.floor(offset / limit) + 1;
        const searchResult = await searchVideos(query, page, limit);
        const next = searchResult.list || [];
        if (next.length === 0) {
          setHasMore(false);
        } else {
          setResults((prev) => [...prev, ...next]);
        }
        if (searchResult.code && searchResult.code !== 0) {
          setError(searchResult.message || "B 站搜索失败");
        }
        return next;
      } catch (reason) {
        console.error("Bilibili load more failed:", reason);
        setHasMore(false);
        setError(reason instanceof Error ? reason.message : "B 站加载更多失败");
        return [];
      } finally {
        setIsLoading(false);
      }
    },
    [hasMore, isLoading],
  );

  return {
    id: "bilibili",
    label: "B站",
    requiresExplicitSearch: true,
    isLoading,
    hasMore,
    hasSearched,
    results,
    error,
    search: async () => results,
    loadMore,
    performSearch,
  };
};
