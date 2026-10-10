import type { BilibiliVideoInfo } from "../types";
import { searchVideos } from "../services/bilibiliService";
import type { SearchProvider } from "./useSearchProvider";
import { usePaginatedSearch } from "./usePaginatedSearch";

const fetchPage = async (query: string, offset: number, limit: number): Promise<BilibiliVideoInfo[]> => {
  const response = await searchVideos(query, Math.floor(offset / limit) + 1, limit);
  if (response.code && response.code !== 0) throw new Error(response.message || "B 站搜索失败");
  return response.list || [];
};
const keyOf = (video: BilibiliVideoInfo) => video.bvid;

export interface BilibiliSearchProviderExtended extends SearchProvider {
  performSearch: (query: string) => Promise<void>;
  hasSearched: boolean;
  results: BilibiliVideoInfo[];
  error: string;
}

export const useBilibiliSearchProvider = (): BilibiliSearchProviderExtended => {
  const search = usePaginatedSearch({ limit: 20, fetchPage, keyOf });
  return { ...search, id: "bilibili", label: "B站", requiresExplicitSearch: true,
    search: async () => search.results };
};
